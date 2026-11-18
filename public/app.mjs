import {blank, example, normalize, makeNode, makeEdge, makeResource, kinds, stateKinds, triggerModes, palette, fallback} from './model.mjs';
import {Simulation} from './sim.mjs';
import {comparison} from './formula.mjs';
import {importedEdgeShape, routePoints, containsBox, simplifyPoints, straightenCorners, snapAlignment, snapWaypoint, closestPathPosition, edgeLabelPoint} from './geometry.mjs';
import {readDiagram} from './import.mjs';
import {icon, innerIcon} from './icons.mjs';
import {toggleItem, commonProperty, setProperty} from './selection.mjs';
import {stateLinkColor, componentColor, setColorPreset, setCustomColor, setResourceColor} from './colors.mjs';

const $=id=>document.getElementById(id);
const svgNS='http://www.w3.org/2000/svg';
const storageKey='resource-flow-project-v1';
const plotTypes=new Set(['pool','register','delay','queue','converter']);
const resourceNodeTypes=new Set(['pool','source','sink','converter','gate','delay','queue','trader']);
const triggers={passive:'Passive',auto:'Auto',click:'On click',enable:'On enable',start:'On start',agent:'Agentic'};
const nodeColors={register:'#b5a4ff',end:'#f3a3ae'};
const entries=Object.entries;
const shorten=(s,len)=>s.length>len?s.slice(0,len-1)+'…':s;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const valueText=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:3});
const tint=(element,key,value)=>element.style.setProperty(key,value);
const diagram=$('diagram'), canvas=$('canvas'), graph=$('graph');

function element(node,attrs,children) {
  for (const [key,value] of entries(attrs)) {
    if (key==='text') node.textContent=value;
    else if (value!=null) node.setAttribute(key,value);
  }
  node.append(...children);
  return node;
}
const el=(tag,attrs={},children=[])=>element(document.createElement(tag),attrs,children);
const svg=(tag,attrs={},children=[])=>element(document.createElementNS(svgNS,tag),attrs,children);
function iconButton(name,label,handler,cls='icon-button') {
  const b=el('button',{type:'button',title:label,class:cls,'aria-label':label});
  b.innerHTML=icon(name);
  b.addEventListener('click',handler);
  return b;
}

let project,demo=false;
try {
  const saved=localStorage.getItem(storageKey);
  if (saved) project=normalize(JSON.parse(saved));
} catch {}
if (!project) {project=example();demo=true;}
let selected=demo?{kind:'node',id:'stock'}:null;
let tool={kind:'select'},from=null,drag=null,space=false,timer=null,toastTimer=null,importTask=null;
let view={x:0,y:0,scale:1},sim,preview=null,chartVisible=new Map(),forecastTask=null;
const undo=[],redo=[];
const waypointCache=new Map();
let alignmentGuides=[];

const selectionItems=()=>selected?.kind==='multiple'?selected.items:
  selected&&['node','edge'].includes(selected.kind)?[selected]:[];
const isSelected=(kind,id)=>selectionItems().some(item=>item.kind===kind&&item.id===id);
function setSelection(items) {
  selected=items.length>1?{kind:'multiple',items}:items[0]||null;
}

function renderView() {
  graph.setAttribute('transform','translate('+view.x+' '+view.y+') scale('+view.scale+')');
  $('zoom-level').textContent=Math.round(view.scale*100)+'%';
  $('dots').setAttribute('x',view.x%22);
  $('dots').setAttribute('y',view.y%22);
}
function fit() {
  const width=diagram.clientWidth,height=diagram.clientHeight;
  if (!width||!height) return;
  if (!project.nodes.length) view={x:width/2,y:height/2,scale:1};
  else {
    const xs=project.nodes.map(n=>n.x),ys=project.nodes.map(n=>n.y);
    for (const e of project.edges) {
      const shape=edgeLayoutCache.get(e.id);
      if (!shape) continue;
      const pad=Math.min(edgeSummary(e).length,25)*3.2;
      xs.push(shape.mid.x-pad,shape.mid.x+pad);
      ys.push(shape.mid.y);
      for (const p of shape.bounds||[]) {xs.push(p.x);ys.push(p.y);}
    }
    const x1=Math.min(...xs)-58,x2=Math.max(...xs)+58,y1=Math.min(...ys)-45,y2=Math.max(...ys)+62;
    const scale=clamp(Math.min((width-32)/(x2-x1),(height-48)/(y2-y1)),.045,1.26);
    view={x:width/2-(x1+x2)/2*scale,y:(height-12)/2-(y1+y2)/2*scale,scale};
  }
  renderView();
  renderEditorOverlay();
}
function localPoint(event) {
  const box=diagram.getBoundingClientRect();
  return {x:event.clientX-box.left,y:event.clientY-box.top};
}
const world=p=>({x:(p.x-view.x)/view.scale,y:(p.y-view.y)/view.scale});
function zoom(factor,point={x:diagram.clientWidth/2,y:diagram.clientHeight/2}) {
  const locked=world(point),scale=clamp(view.scale*factor,.04,4);
  view={x:point.x-locked.x*scale,y:point.y-locked.y*scale,scale};
  renderView();
  renderEditorOverlay();
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent=message;
  $('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,4100);
}
function saveLocal() {
  try {
    localStorage.setItem(storageKey,JSON.stringify(project));
    $('save-status').lastElementChild.textContent='Saved locally';
  } catch {
    $('save-status').lastElementChild.textContent='Use Save file';
    toast('Browser storage is unavailable. Save a project file to keep your work.');
  }
}
function stop() {clearTimeout(timer);timer=null;}
function resetSim() {stop();preview=null;sim=new Simulation(project,$('seed').value);}
function record(previous) {undo.push(previous);if(undo.length>60)undo.shift();redo.length=0;}
function change(mutator,{preserveSim=false}={}) {
  record(structuredClone(project));
  mutator();
  if (!preserveSim) resetSim();
  saveLocal();
  renderAll();
}
function restore(source,destination) {
  if (!source.length) return;
  destination.push(structuredClone(project));
  project=source.pop();
  waypointCache.clear();
  selected=null;from=null;tool={kind:'select'};
  resetSim();saveLocal();renderAll();
}
function load(newProject,message) {
  waypointCache.clear();
  change(()=>{project=newProject;selected=null;from=null;tool={kind:'select'};chartVisible=new Map();});
  fit();
  if (message) toast(message);
}
function setTool(kind,value) {
  tool=(tool.kind===kind&&tool.value===value)?{kind:'select'}:{kind,value};
  from=null;
  alignmentGuides=[];
  renderTools();renderGraph();
}
function renderTools() {
  for (const b of document.querySelectorAll('[data-tool]')) {
    const active=tool.kind===b.dataset.tool&&tool.value===b.dataset.value;
    b.classList.toggle('is-active',active);
    b.setAttribute('aria-pressed',active);
  }
  for (const name of ['select','pan']) {
    $(name).classList.toggle('is-active',tool.kind===name);
    $(name).setAttribute('aria-pressed',tool.kind===name);
  }
  canvas.dataset.mode=space?'pan':tool.kind;
  const hint=$('tool-hint');
  hint.hidden=!['node','edge'].includes(tool.kind);
  if (tool.kind==='node') hint.textContent='Click canvas to place '+kinds[tool.value].toLowerCase();
  if (tool.kind==='edge') hint.textContent=(from?'Choose the destination':'Choose the origin')+' · Esc to cancel';
  $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
}
const resourceColor=id=>project.resources.find(r=>r.id===id)?.color||palette[6];
const nodeColor=n=>componentColor(n,project.resources,n.resource!==fallback?resourceColor(n.resource):nodeColors[n.type]||palette[6]);
function sideRow(kind,id,label,mark) {
  const arrow=el('span');arrow.innerHTML=icon('chevron');
  const row=el('button',{class:'side-item'+(selected?.kind===kind&&selected.id===id?' is-active':''),title:label},
    [mark,el('span',{text:label}),arrow]);
  row.addEventListener('click',()=>select(kind,id));
  return row;
}
function swatch(color) {
  const mark=el('span',{class:'swatch'});
  tint(mark,'--swatch',color);
  return mark;
}
function renderSidebar() {
  $('resource-list').replaceChildren(...project.resources.map(r=>sideRow('resource',r.id,r.name,swatch(r.color))));
  const list=project.variables.map((v,i)=>sideRow('parameter',i,v.name,el('span',{text:'ƒ'})));
  $('variable-list').replaceChildren(...(list.length?list:[el('div',{class:'side-note',text:'No parameters'})]));
}

let edgeLayoutCache=new Map();
function edgeLayout() {
  const points=new Map(project.nodes.map(n=>[n.id,{x:n.x,y:n.y,r:n.type==='text'?8:28}]));
  const edges=new Map(project.edges.map(e=>[e.id,e])), lines=new Map();
  function remember(edge,shape) {
    if (edge.labelPosition!=null || edge.route?.label) {
      const path=svg('path',{d:shape.d});
      shape.mid=edgeLabelPoint(edge,path);
    }
    lines.set(edge.id,shape);
    return shape;
  }
  function layout(edge,chain=new Set()) {
    if (lines.has(edge.id)) return lines.get(edge.id);
    if (chain.has(edge.id)) return null;
    chain.add(edge.id);
    const point=id=>points.get(id)||(edges.has(id)?layout(edges.get(id),chain)?.mid:null);
    const a=point(edge.source),b=point(edge.target);
    chain.delete(edge.id);
    if (!a||!b) return null;
    const imported=edge.route&&importedEdgeShape(edge.route,a,b);
    if (imported) return remember(edge,imported);
    let start,end,control;
    if (edge.source===edge.target) {
      start={x:a.x+19,y:a.y-19};end={x:a.x-19,y:a.y-19};
      control={x:a.x,y:a.y-65-Math.abs(edge.bend)};
    } else {
      const x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y)||1;
      control={x:(a.x+b.x)/2-y/length*edge.bend,y:(a.y+b.y)/2+x/length*edge.bend};
      const ray=p=>{
        const d=Math.hypot(control.x-p.x,control.y-p.y)||1;
        const radius=Math.min(d*.85,p.r||13);
        return {x:p.x+(control.x-p.x)/d*radius,y:p.y+(control.y-p.y)/d*radius};
      };
      start=ray(a);end=ray(b);
    }
    const mid={x:(start.x+end.x)/4+control.x/2,y:(start.y+end.y)/4+control.y/2};
    const result={d:'M '+start.x+' '+start.y+' Q '+control.x+' '+control.y+' '+end.x+' '+end.y,mid,end,
      angle:Math.atan2(end.y-control.y,end.x-control.x)*180/Math.PI,a,b};
    return remember(edge,result);
  }
  for (const edge of project.edges) layout(edge);
  return lines;
}
function edgeSummary(e, liveValue) {
  const live = liveValue!==undefined;
  if (e.type==='flow') return (live?valueText(liveValue):e.formula)+(e.interval&&e.interval!=='1'?' / '+e.interval:'');
  if (e.mode==='input') return 'as '+e.formula+(live?' = '+valueText(liveValue):'');
  if (live && (e.mode==='enable'||e.mode==='triggerIf')) {
    return (e.mode==='triggerIf'?'if ':'')+comparison(e.formula,liveValue);
  }
  if (e.mode==='trigger') {
    if (e.triggerOn==='chance') return (live?valueText(liveValue):e.formula)+'%';
    return triggerModes[e.triggerOn] || triggerModes.change;
  }
  if (live) return valueText(liveValue);
  if (e.mode==='overwrite') return stateKinds.overwrite;
  if (e.mode==='triggerIf') return 'if '+e.formula;
  return e.formula||stateKinds[e.mode];
}
function renderGraph() {
  const current=document.activeElement?.closest?.('[data-kind]');
  const focusKey=current?.dataset.id;
  $('canvas-empty').hidden=project.nodes.length>0;
  const nodesCount=project.nodes.length,edgesCount=project.edges.length;
  $('counts').textContent=nodesCount+(nodesCount===1?' node':' nodes')+' · '+edgesCount+(edgesCount===1?' connection':' connections');
  const lines=edgeLayoutCache=edgeLayout();
  const resourceTints=new Map(project.nodes.filter(n=>resourceNodeTypes.has(n.type))
    .map(n=>[n.id,resourceColor(n.resourceFilter[0]||n.resource)]));
  const edges=[];
  for (const e of project.edges) {
    const shape=lines.get(e.id);
    if (!shape) continue;
    const liveValue=sim.step>0?sim.edgeOverwrites.get(e.id):undefined;
    const gated=sim.disabledRegisterOutputs.has(e.id);
    const {d,mid,end,angle}=shape,label=shorten(edgeSummary(e,liveValue),25);
    const width=Math.max(24,label.length*6.35+15);
    const css='edge '+e.type+(isSelected('edge',e.id)?' selected':'')+(from===e.id?' connecting':'')+
      (sim.activeEdges.has(e.id)?' active':'')+(liveValue!==undefined?' overwritten':'')+(gated?' gated':'');
    const name=(e.type==='state'?'State connection ':'Resource connection ')+(e.label||edgeSummary(e))+
      (liveValue!==undefined?' · Live overwrite '+valueText(liveValue):'')+(gated?' · Origin register disabled':'');
    const group=svg('g',{class:css,'data-id':e.id,'data-kind':'edge',tabindex:0,role:'button','aria-label':name},[
      svg('title',{text:name}),svg('path',{d,class:'wire'}),svg('path',{d,class:'wire-hit'}),
      svg('path',{d:'M 0 0 L -9 4 L -7 0 L -9 -4 Z',class:'tip',transform:'translate('+end.x+' '+end.y+') rotate('+angle+')'}),
      svg('g',{transform:'translate('+mid.x+' '+mid.y+')','data-label':''},[
        svg('rect',{x:-width/2,y:-10,width,height:20,rx:6,class:'wire-label'}),
        svg('text',{x:0,y:1,class:'wire-text',text:label}),
      ]),
    ]);
    const edgeTint=e.type==='state'?componentColor(e,project.resources,stateLinkColor):resourceTints.get(e.source);
    if (edgeTint) tint(group,'--edge-tint',edgeTint);
    edges.push(group);
  }
  $('edges').replaceChildren(...edges);
  const values=sim.history.at(-1).values;
  const nodes=project.nodes.map(n=>{
    const primary=n.type==='pool';
    const register=n.type==='register';
    const value=values[n.id];
    const resourceTint=resourceTints.get(n.id);
    const cls='node '+n.type+(isSelected('node',n.id)?' selected':'')+
      (from===n.id?' connecting':'')+(n.trigger==='click'?' queued':'')+(resourceTint?' resource-node':'');
    const group=svg('g',{class:cls,transform:'translate('+n.x+' '+n.y+')','data-id':n.id,'data-kind':'node',
      tabindex:0,role:'button','aria-label':kinds[n.type]+' '+n.label+(register?' · '+valueText(value):'')});
    tint(group,'--node-tint',resourceTint||nodeColor(n));
    group.append(svg('title',{text:n.label+' · '+kinds[n.type]+(values[n.id]!==undefined?' · '+valueText(values[n.id]):'')}));
    if (n.type!=='text') {
      group.append(svg('rect',{x:-28,y:-28,width:56,height:56,rx:10,class:'halo'}));
      if (primary) {
        group.append(svg('circle',{r:22,class:'shape'}),svg('text',{x:0,y:4.6,class:'count',text:shorten(valueText(values[n.id]??0),7)}));
      } else {
        group.append(svg('rect',{x:-23,y:-23,width:46,height:46,rx:9,class:'node-bg'}));
        const symbol=svg('svg',{x:register?-8:-15,y:register?-21:-15,width:register?16:30,height:register?16:30,
          viewBox:'0 0 24 24',class:'type-symbol',
          fill:'none','stroke-width':1.5,'stroke-linecap':'round','stroke-linejoin':'round'});
        symbol.innerHTML=innerIcon(n.type);
        group.append(symbol);
        if (register) {
          const formatted=valueText(value);
          const text=formatted.length>10?value.toExponential(2):formatted;
          group.append(svg('text',{x:0,y:11,class:'count register-value',text,
            textLength:text.length>6?38:null,lengthAdjust:'spacingAndGlyphs'}));
        }
      }
      if (n.trigger==='auto') {
        const bolt=svg('svg',{x:17,y:-34,width:13,height:13,viewBox:'0 0 24 24',class:'trigger'});
        bolt.innerHTML=innerIcon('bolt').replace('fill="currentColor"','');
        group.append(bolt);
      }
      if (n.trigger==='click') group.append(svg('circle',{cx:22,cy:-24,r:3.5,class:'trigger'}));
    }
    const rows=(n.label||kinds[n.type]).split(/\n/).flatMap(part=>{
      if (n.type==='text') return [shorten(part,50)];
      if (part.length<=23) return [part];
      const split=part.lastIndexOf(' ',23);
      return split>4?[part.slice(0,split),shorten(part.slice(split+1),25)]:[shorten(part,25)];
    }).slice(0,3);
    const offset=n.labelOffset;
    group.append(svg('text',{class:'caption',y:offset?offset.y+15:n.type==='text'?4:43},
      rows.map((part,i)=>svg('tspan',{x:offset?.x??0,dy:i?15:0,text:part}))));
    return group;
  });
  $('nodes').replaceChildren(...nodes);
  renderEditorOverlay();
  if (focusKey) [...nodes,...edges].find(n=>n.dataset.id===focusKey)?.focus({preventScroll:true});
}

function editablePoints(edge,shape) {
  if (edge.route && shape.d!==edge.route.rendered?.d) return routePoints(edge.route,shape.a,shape.b);
  const cached=waypointCache.get(edge.id);
  if (cached?.d===shape.d) return cached.points;
  const path=$('edges').querySelector('[data-id="'+CSS.escape(edge.id)+'"] .wire');
  const length=path.getTotalLength(), count=Math.min(1024,Math.max(1,Math.ceil(length/5)));
  const sampled=Array.from({length:count+1},(_,i)=>{
    const p=path.getPointAtLength(length*i/count);
    return {x:p.x,y:p.y};
  });
  const points=straightenCorners([{...shape.a},...simplifyPoints(sampled,1).slice(1,-1),{...shape.b}]);
  waypointCache.set(edge.id,{d:shape.d,points});
  return points;
}

function editRoute(edge,points) {
  edge.route={routing:'straight',points:points.slice(1,-1).map(p=>({x:p.x,y:p.y})),label:edge.route?.label||null};
  edge.bend=0;
}

function renderEditorOverlay() {
  $('alignment-guides').replaceChildren(...alignmentGuides.map(guide=>svg('line',{
    ...guide,class:'alignment-guide','vector-effect':'non-scaling-stroke',
  })));
  const handles=[];
  if (drag?.kind!=='marquee') for (const item of selectionItems().filter(item=>item.kind==='edge')) {
    const edge=project.edges.find(e=>e.id===item.id), shape=edgeLayoutCache.get(item.id);
    if (!edge||!shape) continue;
    const points=editablePoints(edge,shape);
    const path=$('edges').querySelector('[data-id="'+CSS.escape(edge.id)+'"] .wire');
    const start=path.getPointAtLength(0), end=path.getPointAtLength(path.getTotalLength());
    for (const p of [start,end]) handles.push(svg('circle',{
      cx:p.x,cy:p.y,r:3.5/view.scale,class:'waypoint-end','vector-effect':'non-scaling-stroke',
    }));
    for (let i=1;i<points.length-1;i++) handles.push(svg('circle',{
      cx:points[i].x,cy:points[i].y,r:5/view.scale,class:'waypoint'+(drag?.kind==='waypoint'&&drag.target.id===edge.id&&drag.index===i&&drag.snapped?' snapped':''),
      'data-waypoint':i,'data-edge':edge.id,'vector-effect':'non-scaling-stroke',tabindex:0,role:'button',
      'aria-label':'Waypoint '+i+' of '+(edge.label||edge.id),
    },[svg('title',{text:'Drag to move. Double-click to remove.'})]));
    for (let i=0;i<points.length-1;i++) {
      const a=i?points[i]:start, b=i===points.length-2?end:points[i+1];
      if (Math.hypot(a.x-b.x,a.y-b.y)*view.scale<36) continue;
      handles.push(svg('circle',{
        cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,r:3.5/view.scale,class:'waypoint-insert',
        'data-insert-waypoint':i+1,'data-edge':edge.id,'vector-effect':'non-scaling-stroke',
      },[svg('title',{text:'Drag to add a waypoint.'})]));
    }
  }
  $('waypoint-handles').replaceChildren(...handles);
}

function labelled(name,control) {
  control.setAttribute('aria-label',name);
  return el('label',{},[el('span',{text:name}),control]);
}
function inputField(name,value,onChange,options={}) {
  const input=el(options.multiline?'textarea':'input',{
    type:options.multiline?null:options.type||'text',placeholder:options.placeholder,
    min:options.min,max:options.max,step:options.step,
    class:options.mono?'formula-field':null,rows:options.multiline?3:null,maxlength:options.multiline?2000:1000,
  });
  input.value=value;
  input.addEventListener('change',()=>{
    if (input.reportValidity()) onChange(input.value);
    else input.value=value;
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!options.multiline)input.blur();});
  return labelled(name,input);
}
function selectField(name,value,options,onChange) {
  const control=el('select',{},options.map(([id,label])=>el('option',{value:id,text:label})));
  control.value=value;
  control.addEventListener('change',()=>onChange(control.value));
  return labelled(name,control);
}
function check(name,value,onChange) {
  const input=el('input',{type:'checkbox'});
  input.checked=value;
  input.addEventListener('change',()=>onChange(input.checked));
  return el('label',{class:'checkbox'},[input,document.createTextNode(name)]);
}
function action(label,handler) {
  const b=el('button',{class:'button sub-button',text:label});
  b.addEventListener('click',handler);
  return b;
}
const note=text=>el('p',{class:'field-note',text});
const pane=(title,...children)=>children.some(Boolean)?el('div',{class:'inspector-group'},[el('h3',{text:title}),...children.filter(Boolean)]):null;
const pair=(...children)=>children.some(Boolean)?el('div',{class:'pair'},children.filter(Boolean)):null;
const resOpts=(all='')=>[...(all?[['',all]]:[]),...project.resources.map(r=>[r.id,r.name])];

function header(title,sub,kind,onDelete) {
  const glyph=el('span',{class:'selection-icon'});
  glyph.innerHTML=icon(kind);
  const items=[glyph,el('div',{},[el('strong',{text:title,title}),el('small',{text:sub})])];
  if (onDelete) items.push(iconButton('trash','Delete '+sub.toLowerCase(),onDelete,'icon-button delete'));
  return el('div',{class:'selection-header'},items);
}
function select(kind,id,toggle=false) {
  if (toggle) setSelection(toggleItem(selectionItems(),{kind,id}));
  else selected={kind,id};
  renderGraph();renderSidebar();renderInspector();
}
function deleteSelection() {
  if (!selected) return;
  const {kind,id}=selected;
  if (kind==='resource'&&id===fallback) return;
  change(()=>{
    if (kind==='resource') {
      const linked=[...project.nodes,...project.edges].filter(item=>item.colorResource===id);
      for (const item of linked) setCustomColor([item],componentColor(item,project.resources));
      project.resources=project.resources.filter(r=>r.id!==id);
      for (const n of project.nodes) {
        if (n.resource===id) n.resource=fallback;
        n.resourceFilter=n.resourceFilter.filter(r=>r!==id);
        n.initialResources=n.initialResources.map(r=>r.resource===id?{...r,resource:fallback}:r);
      }
      for (const e of project.edges) if (e.resource===id) e.resource='';
    }
    if (kind==='parameter') project.variables.splice(id,1);
    if (kind==='node'||kind==='edge'||kind==='multiple') {
      const removed=new Set(selectionItems().map(item=>item.id));
      let changed=true;
      while (changed) {
        changed=false;
        for (const e of project.edges) if (!removed.has(e.id)&&(removed.has(e.source)||removed.has(e.target))) {
          removed.add(e.id);changed=true;
        }
      }
      project.nodes=project.nodes.filter(n=>!removed.has(n.id));
      project.edges=project.edges.filter(e=>!removed.has(e.id));
    }
    selected=null;
  });
}
function fields(items) {
  const item=items[0], common=(...keys)=>keys.every(key=>commonProperty(items,key));
  const edit=(mutator,options)=>change(()=>items.forEach(mutator),options);
  const set=(key,value,options)=>change(()=>setProperty(items,key,value),options);
  return {
    set,edit,common,
    field:(label,key,options)=>common(key)?inputField(label,item[key],v=>set(key,v),options):null,
    menu:(label,key,options)=>common(key)?selectField(label,item[key],options,v=>set(key,v)):null,
    flag:(label,key)=>common(key)?check(label,item[key],v=>set(key,v)):null,
  };
}
function colorInspector(items,defaultColor) {
  if (!commonProperty(items,'color')||!commonProperty(items,'colorResource')) return null;
  const item=items[0], color=componentColor(item,project.resources,defaultColor);
  const presets=project.resources.map(r=>['resource:'+r.id,r.name+' ('+r.color+')']);
  const set=value=>change(()=>setCustomColor(items,value),{preserveSim:true});
  const picker=inputField('Custom colour',color,set,{type:'color'});
  return pane('Appearance',
    selectField('Colour preset',item.colorResource?'resource:'+item.colorResource:item.color?'custom':'',
      [['','Default colour'],...presets,['custom','Custom colour']],value=>{
        if (value==='custom') {
          set(color);
          $('properties').querySelector('input[type=color]').click();
        } else if (value.startsWith('resource:')) {
          const resource=project.resources.find(r=>r.id===value.slice(9));
          if (resource) change(()=>setColorPreset(items,resource),{preserveSim:true});
        } else set('');
      }),picker);
}
function nodeInspector(n,items=[n]) {
  const {set,edit,common,field,menu,flag}=fields(items), multiple=items.length>1;
  const isPool=n.type==='pool',isRegister=n.type==='register';
  const registerOrEnd=isRegister||n.type==='end';
  const live=multiple?null:el('div',{class:'field-note'},['Current value ',el('strong',{class:'sim-value',id:'inspector-value',text:valueText(sim.value(n.id))})]);
  const inventory=common('initialResources')?n.initialResources.map((entry,i)=>el('div',{class:'resource-amount'},[
    selectField('Resource',entry.resource,resOpts(),value=>edit(item=>{item.initialResources[i].resource=value;})),
    inputField('Quantity',entry.value,value=>edit(item=>{item.initialResources[i].value=value;}),{mono:true}),
    iconButton('close','Remove initial resource',()=>edit(item=>{
      item.initialResources.splice(i,1);
      if (!item.initialResources.length) item.initial='0';
    })),
  ])):[];
  const addStack=common('initialResources','resource','initial')?action('Add initial resource',()=>edit(item=>{
    if (!item.initialResources.length) item.initialResources.push({resource:item.resource,value:item.initial});
    item.initialResources.push({resource:project.resources.find(r=>r.id!==item.resource)?.id||fallback,value:'0'});
  })):null;
  const behavior=n.type==='text'?null:pane('Behavior',
    menu('Trigger','trigger',entries(triggers)),
    ['pool','delay','queue'].includes(n.type)?menu('Direction','direction',[['pull','Pull resources'],['push','Push resources']]):null,
    ['source','pool','gate','sink','delay','queue'].includes(n.type)?flag('All or nothing','all'):null,
    n.type==='gate'?menu('Distribution','distribution',[['deterministic','Deterministic'],['random','Random']]):null,
    n.type==='converter'?menu('Conversion','conversion',[['single','Single per step'],['multiple','Multiple per step']]):null,
    n.type==='converter'?flag('Ignore disabled inputs','ignoreDisabled'):null,
    field('Condition','condition',{placeholder:'When true, e.g. step >= 2',mono:true}),
    !multiple&&n.trigger==='click'?action(isRegister?'Increase next step':'Fire next step',()=>queueNode(n.id,1)):null,
    !multiple&&n.trigger==='click'&&isRegister?action('Decrease next step',()=>queueNode(n.id,-1)):null,
  );
  const resourceGroup=resourceNodeTypes.has(n.type)?pane('Resources',
    menu(n.type==='converter'?'Output resource':'Resource','resource',resOpts()),
    isPool?pair(items.every(item=>!item.initialResources.length)?field('Initial quantity','initial',{mono:true}):null,
      field('Capacity','capacity',{placeholder:'Unlimited',mono:true})):null,
    isPool?menu('Overflow','overflow',[['block','Block incoming'],['sink','Discard excess']]):null,
    isPool&&common('resourceFilter')?selectField('Accepted resource',n.resourceFilter[0]||'',resOpts('Any resource'),v=>set('resourceFilter',v?[v]:[])):null,
    isPool?live:null,...inventory,isPool?addStack:null,
  ):null;
  const formulaGroup=registerOrEnd||['delay','queue'].includes(n.type)?pane('Formula',
    field('Expression','formula',{placeholder:n.type==='end'?'e.g. stock >= 10':'e.g. a * 2',mono:true}),
    isRegister?pair(field('Initial value','initial',{mono:true}),field('Click increment','stepValue',{mono:true})):null,
    isRegister?pair(field('Minimum','min',{mono:true}),field('Maximum','max',{mono:true})):null,
    isRegister?live:null,
    isRegister?note('A state connection of type Register input supplies a variable such as a.'):null,
    ['delay','queue'].includes(n.type)?note('The output connection controls the delay when connected.'):null,
  ):null;
  return [
    header(multiple?items.length+' nodes selected':n.label,kinds[n.type],n.type,deleteSelection),
    multiple?el('p',{class:'field-note selection-note',text:'Changes apply to all selected nodes. Only matching properties are shown.'}):null,
    pane('General',field('Label','label',n.type==='text'?{multiline:true}:{}),
      n.type==='unknown'||n.type==='trader'?menu('Node type','type',entries(kinds)):null),
    isRegister?colorInspector(items,nodeColor(n)):null,behavior,resourceGroup,formulaGroup,
    pane('Notes',field('Note','note',{multiline:true,placeholder:'Add context for this node'})),
  ].filter(Boolean);
}
function edgeInspector(e,items=[e]) {
  const {set,edit,common,field,menu,flag}=fields(items), multiple=items.length>1;
  const state=e.type==='state';
  const components=[
    ...project.nodes.filter(n=>n.type!=='text').map(n=>[n.id,n.label+' · '+kinds[n.type]]),
    ...(state?project.edges.filter(x=>!items.includes(x)).map(x=>[x.id,x.label||edgeSummary(x)]):[]),
  ];
  const endOptions=key=>components.filter(([id])=>items.every(item=>id!==item[key==='source'?'target':'source'])||project.nodes.some(n=>n.id===id));
  const formulaLabel=state?e.mode==='input'?'Variable name':e.mode==='enable'||e.mode==='triggerIf'?'Comparison':'Formula':'Amount formula';
  const reconnect=(key,value)=>edit(item=>{item[key]=value;item.route=null;});
  return [
    header(multiple?items.length+' connections selected':e.label||edgeSummary(e),state?'State connection':'Resource connection',e.type,deleteSelection),
    multiple?el('p',{class:'field-note selection-note',text:'Changes apply to all selected connections. Only matching properties are shown.'}):null,
    state?colorInspector(items,stateLinkColor):null,
    pane('Endpoints',common('source')?selectField('Origin',e.source,endOptions('source'),v=>reconnect('source',v)):null,
      common('target')?selectField('Destination',e.target,endOptions('target'),v=>reconnect('target',v)):null,field('Label','label',{placeholder:'Optional'})),
    pane('Behavior',
      state&&common('mode')?selectField('Type',e.mode,entries(stateKinds),v=>{
        edit(item=>{
          item.mode=v;
          const defaults={trigger:'*',input:'a',enable:'> 0',triggerIf:'> 0',add:'+1',multiply:'10%',split:'1'};
          item.formula=defaults[v]??'';
          if (v==='trigger') item.triggerOn='change';
          else delete item.triggerOn;
        });
      }):null,
      state&&common('mode','triggerOn')&&e.mode==='trigger'?selectField('Trigger on',e.triggerOn,entries(triggerModes),v=>edit(item=>{
        item.triggerOn=v;
        item.formula=v==='chance'?'100':'*';
      })):null,
      state&&common('mode','triggerOn')&&e.mode==='trigger'&&e.triggerOn==='chance'?field('Chance (%)','formula',{type:'number',min:0,max:100,step:'any'}):null,
      state&&(!common('mode')||['trigger','overwrite'].includes(e.mode))?null:field(formulaLabel,'formula',{mono:true,placeholder:state?'>= 3':'1, 2D6, 50%, or all'}),
      state&&common('mode')&&e.mode==='overwrite'?note("Copies the origin's current value."):null,
      state?null:pair(field('Interval','interval',{mono:true}),items.every(item=>item.formula.endsWith('%'))?field('Amount on success','chanceAmount',{mono:true}):null),
      state?null:pair(field('Minimum','min',{mono:true}),field('Maximum','max',{mono:true})),
      state?null:menu('Transfer timing','transfer',[['interval','Flow'],['instant','Instant']]),
      state?null:flag('Allow decimals','decimals'),state?null:flag('Shuffle resource types','shuffle'),
      menu('Resource filter','resource',resOpts('Any resource')),
      field('Condition','condition',{placeholder:'e.g. step >= 2',mono:true})),
    pane('Notes',field('Note','note',{multiline:true,placeholder:'Add context for this connection'})),
  ].filter(Boolean);
}
function renderInspector() {
  let list=[];
  if (selected?.kind==='multiple') {
    const nodes=selected.items.filter(item=>item.kind==='node').length;
    const edges=selected.items.length-nodes;
    const kind=selected.items[0].kind;
    const items=selected.items.map(item=>(item.kind==='node'?project.nodes:project.edges).find(object=>object.id===item.id));
    if (items.every(Boolean)&&selected.items.every(item=>item.kind===kind)&&items.every(item=>item.type===items[0].type)) {
      list=kind==='node'?nodeInspector(items[0],items):edgeInspector(items[0],items);
    } else list=[header(selected.items.length+' objects selected','Selection','cursor',deleteSelection),
      pane('Selection',note(nodes+' nodes and '+edges+' connections'),note('Select objects of the same type to edit their matching properties together.'))];
  } else if (selected?.kind==='node') {
    const node=project.nodes.find(n=>n.id===selected.id);
    if (node) list=nodeInspector(node);
  } else if (selected?.kind==='edge') {
    const e=project.edges.find(e=>e.id===selected.id);
    if (e) list=edgeInspector(e);
  } else if (selected?.kind==='resource') {
    const r=project.resources.find(r=>r.id===selected.id);
    if (r) list=[header(r.name,'Resource','pool',r.id===fallback?null:deleteSelection),
      pane('Resource',inputField('Name',r.name,value=>change(()=>{r.name=value.trim()||'Resource';})),
        inputField('Color',r.color,value=>change(()=>{setResourceColor(project,r,value);},{preserveSim:true}),{type:'color'}),
        note(project.nodes.filter(n=>n.resource===r.id).length+' nodes use this resource.'))];
  } else if (selected?.kind==='parameter') {
    const v=project.variables[selected.id];
    if (v) list=[header(v.name,'Parameter','register',deleteSelection),pane('Parameter',inputField('Name',v.name,value=>{
      if (!/^[a-z_$][\w$]*$/i.test(value)||project.variables.some(other=>other!==v&&other.name===value)) {
        toast('Use a unique name beginning with a letter or underscore.');renderInspector();return;
      }
      change(()=>{v.name=value;});
    },{mono:true}),inputField('Expression',v.formula,value=>change(()=>{v.formula=value;}),{mono:true}),
    note('Use this name in a formula, condition, or initial quantity.'))];
  }
  if (!list.length) list=[el('div',{class:'inspector-empty',text:'Select a node, connection, or resource to edit its properties.'})];
  $('properties').replaceChildren(...list);
}

function renderPlot() {
  const data=preview||sim.history;
  const choices=project.nodes.filter(n=>plotTypes.has(n.type));
  const defaultSeries=new Set(choices.filter(n=>n.type!=='converter').slice(0,3).map(n=>n.id));
  if (!defaultSeries.size&&choices.length) defaultSeries.add(choices[0].id);
  const visible=choices.filter(n=>chartVisible.get(n.id)??defaultSeries.has(n.id));
  const colors=new Map(choices.map((n,i)=>[n.id,n.resource!==fallback?resourceColor(n.resource):palette[i%palette.length]]));
  $('legend').replaceChildren(...choices.map(n=>{
    const show=chartVisible.get(n.id)??defaultSeries.has(n.id);
    const b=el('button',{'aria-pressed':show,title:n.label},[swatch(colors.get(n.id)),document.createTextNode(shorten(n.label,21))]);
    b.addEventListener('click',()=>{chartVisible.set(n.id,!show);renderPlot();});
    return b;
  }));
  if (!visible.length) {
    $('plot').textContent=choices.length?'Select a series to plot.':'Add a pool, register, converter, delay, or queue to plot its values.';
    return;
  }
  const w=Math.max(270,$('plot').clientWidth-28),h=Math.max(66,$('plot').clientHeight-5);
  const left=38,right=w-13,top=10,bottom=h-20;
  const plot=svg('svg',{viewBox:'0 0 '+w+' '+h,role:'img','aria-label':preview?'Example simulation preview':'Simulation values by step'});
  let max=1,min=0;
  for (const frame of data) for (const n of visible) {
    const value=frame.values[n.id]||0;
    max=Math.max(max,value);min=Math.min(min,value);
  }
  const steps=Math.max(preview?data.at(-1).step:project.steps,data.at(-1).step,1);
  const x=s=>left+s/steps*(right-left),y=v=>bottom-(v-min)/(max-min)*(bottom-top);
  for (let j=0;j<=4;j++) {
    const value=min+(max-min)*j/4,yp=y(value);
    plot.append(svg('line',{x1:left,x2:right,y1:yp,y2:yp,class:'plot-grid'}),
      svg('text',{x:left-7,y:yp+3.4,'text-anchor':'end',class:'plot-label',text:shorten(valueText(value),8)}));
  }
  for (let j=0;j<=Math.min(6,steps);j++) {
    const s=Math.round(steps*j/Math.min(6,steps)),xp=x(s);
    plot.append(svg('line',{x1:xp,x2:xp,y1:top,y2:bottom,class:'plot-grid'}),
      svg('text',{x:xp,y:h-5,'text-anchor':'middle',class:'plot-label',text:s}));
  }
  for (const n of visible) {
    const line=[];
    const stride=Math.max(1,Math.ceil(data.length/(w*2)));
    const coord=frame=>x(frame.step).toFixed(2)+' '+y(frame.values[n.id]||0).toFixed(2);
    for (let i=0;i<data.length;i+=stride) line.push((i===0?'M':'L')+coord(data[i]));
    const frame=data.at(-1);
    line.push('L'+coord(frame));
    plot.append(svg('path',{d:line.join(' '),class:'plot-path',stroke:colors.get(n.id)}),
      svg('circle',{cx:x(frame.step),cy:y(frame.values[n.id]||0),r:3,fill:colors.get(n.id)}));
  }
  $('plot').replaceChildren(plot);
}
function renderSim() {
  $('step-status').textContent=preview?'Example preview':'Step '+sim.step+(sim.ended?' · Ended':'');
  $('step-status').title=sim.ended?'Ended by '+sim.ended:'';
  $('play').firstElementChild.innerHTML=icon(timer?'pause':'play');
  $('play').lastElementChild.textContent=timer?'Pause':'Play';
  $('step').disabled=!!sim.ended||sim.step>=project.steps;
  $('play').disabled=!timer&&(!!sim.ended||sim.step>=project.steps);
  $('issues').hidden=!sim.issues.size;
  $('issues').title=sim.issues.size+' diagram '+(sim.issues.size===1?'issue':'issues');
  $('csv').disabled=sim.step===0;
  if (selected?.kind==='node'&&$('inspector-value')) $('inspector-value').textContent=valueText(sim.value(selected.id));
  renderPlot();
}
function renderAll() {
  $('title').value=project.title;
  $('max-steps').value=project.steps;
  renderTools();renderSidebar();renderGraph();renderInspector();renderSim();renderView();
}

function stepSimulation() {
  preview=null;
  if (sim.step<project.steps&&!sim.ended) sim.advance();
  if (sim.step>=project.steps||sim.ended) stop();
  renderGraph();renderSim();
}
function startPlay() {
  if (timer) {stop();renderSim();return;}
  preview=null;
  const tick=()=>{
    stepSimulation();
    if (timer) timer=setTimeout(tick,Number($('speed').value));
  };
  timer=setTimeout(tick,15);
  renderSim();
}
function queueNode(id,direction) {
  preview=null;sim.queueClick(id,direction);renderSim();
  toast('Queued '+project.nodes.find(n=>n.id===id).label+' for the next step.');
}
function graphClick(kind,id) {
  if (tool.kind==='edge') {
    if (kind==='edge'&&tool.value==='flow') {toast('Resource connections join two nodes.');return;}
    if (!from) {from=id;renderTools();renderGraph();return;}
    if (kind==='edge'&&from===id) {toast('Choose a different connection or a node.');return;}
    const e=makeEdge(tool.value,from,id,{bend:from===id?26:0});
    change(()=>{project.edges.push(e);selected={kind:'edge',id:e.id};from=null;tool={kind:'select'};});
  } else if (tool.kind==='select') {
    select(kind,id);
    if (kind==='node'&&(timer||sim.step>0)&&!sim.ended&&project.nodes.find(n=>n.id===id)?.trigger==='click') queueNode(id,1);
  }
}

function selectionBounds() {
  const bounds=[];
  for (const group of $('nodes').children) {
    const node=project.nodes.find(n=>n.id===group.dataset.id), box=group.getBBox();
    bounds.push({kind:'node',id:node.id,box:{x:node.x+box.x,y:node.y+box.y,width:box.width,height:box.height}});
  }
  for (const group of $('edges').children) {
    const mid=edgeLayoutCache.get(group.dataset.id).mid, box=group.querySelector('[data-label]').getBBox();
    bounds.push({kind:'edge',id:group.dataset.id,box:{x:mid.x+box.x,y:mid.y+box.y,width:box.width,height:box.height}});
  }
  return bounds;
}

function renderSelection() {
  for (const group of [...$('nodes').children,...$('edges').children]) {
    group.classList.toggle('selected',isSelected(group.dataset.kind,group.dataset.id));
  }
  renderEditorOverlay();
}

function nodeSnap(points,excluded,event) {
  if (event.altKey) return {dx:0,dy:0,guides:[]};
  return snapAlignment(points,project.nodes.filter(n=>!excluded.has(n.id)),7/view.scale);
}

diagram.addEventListener('pointerdown',event=>{
  if (![0,1].includes(event.button)) return;
  if (drag) return;
  const hit=event.target.closest('[data-kind]'),point=localPoint(event);
  const handle=event.target.closest('[data-waypoint],[data-insert-waypoint]');
  const selection=selected;
  if (space||tool.kind==='pan'||event.button===1) {
    drag={kind:'pan',start:point,x:view.x,y:view.y,pointer:event.pointerId};
  } else if (tool.kind==='node') {
    const p=world(point),snap=nodeSnap([p],new Set(),event);
    const n=makeNode(tool.value,{x:p.x+snap.dx,y:p.y+snap.dy});
    alignmentGuides=[];
    change(()=>{project.nodes.push(n);selected={kind:'node',id:n.id};tool={kind:'select'};});
    return;
  } else if (tool.kind==='select'&&(event.ctrlKey||event.metaKey)&&(hit||handle)) {
    select(hit?.dataset.kind||'edge',hit?.dataset.id||handle.dataset.edge,true);
    event.preventDefault();
    return;
  } else if (handle&&tool.kind==='select') {
    const target=project.edges.find(e=>e.id===handle.dataset.edge);
    const points=editablePoints(target,edgeLayoutCache.get(target.id)).map(p=>({...p}));
    const insert=handle.hasAttribute('data-insert-waypoint');
    const index=Number(insert?handle.dataset.insertWaypoint:handle.dataset.waypoint);
    const origin=insert?world(point):points[index];
    drag={kind:'waypoint',target,start:point,points,index,insert,origin,pointer:event.pointerId};
  } else if (hit&&tool.kind==='select'&&hit.dataset.kind==='node') {
    const n=project.nodes.find(n=>n.id===hit.dataset.id);
    if (!isSelected('node',n.id)) select('node',n.id);
    const movingIds=new Set(selectionItems().filter(item=>item.kind==='node').map(item=>item.id));
    const nodes=project.nodes.filter(n=>movingIds.has(n.id)).map(n=>({target:n,x:n.x,y:n.y}));
    const routes=project.edges.filter(e=>movingIds.has(e.source)&&movingIds.has(e.target)).map(target=>{
      const shape=edgeLayoutCache.get(target.id);
      return shape?{target,points:editablePoints(target,shape),label:target.route?.label||shape.mid}:null;
    }).filter(Boolean);
    const labels=project.edges.filter(e=>isSelected('edge',e.id)).map(target=>({target,origin:edgeLayoutCache.get(target.id)?.mid})).filter(item=>item.origin);
    drag={kind:'node',target:n,start:point,nodes,routes,labels,movingIds,pointer:event.pointerId};
  } else if (hit&&tool.kind==='select'&&event.target.closest('[data-label]')) {
    const e=project.edges.find(e=>e.id===hit.dataset.id);
    drag={kind:'edge',target:e,start:point,geo:edgeLayoutCache.get(e.id),path:hit.querySelector('.wire'),pointer:event.pointerId};
  } else if (hit) {
    graphClick(hit.dataset.kind,hit.dataset.id);
    return;
  } else if (tool.kind==='select') {
    drag={kind:'marquee',start:point,origin:world(point),bounds:selectionBounds(),pointer:event.pointerId};
    selected=null;
    renderSelection();renderSidebar();renderInspector();
  } else {
    selected=null;from=null;renderAll();return;
  }
  drag.selection=selection;
  event.preventDefault();
  (drag.kind==='waypoint'?handle:diagram).setPointerCapture(event.pointerId);
});
diagram.addEventListener('pointermove',event=>{
  if (!drag) {
    if (tool.kind==='node') {
      alignmentGuides=nodeSnap([world(localPoint(event))],new Set(),event).guides;
      renderEditorOverlay();
    }
    return;
  }
  if (drag.pointer!==event.pointerId) return;
  const p=localPoint(event),dx=p.x-drag.start.x,dy=p.y-drag.start.y;
  if (!drag.moved&&Math.hypot(dx,dy)<4) return;
  if (!drag.moved&&!['pan','marquee'].includes(drag.kind)) {
    if (drag.kind==='waypoint') diagram.setPointerCapture(event.pointerId);
    drag.before=structuredClone(project);
    if (drag.kind!=='node') selected={kind:'edge',id:drag.target.id};
    if (drag.kind==='waypoint'&&drag.insert) drag.points.splice(drag.index,0,drag.origin);
  }
  drag.moved=true;
  if (drag.kind==='pan') {
    view.x=drag.x+dx;view.y=drag.y+dy;renderView();return;
  }
  if (drag.kind==='marquee') {
    const cursor=world(p),origin=drag.origin;
    const area={x:Math.min(origin.x,cursor.x),y:Math.min(origin.y,cursor.y),width:Math.abs(cursor.x-origin.x),height:Math.abs(cursor.y-origin.y)};
    setSelection(drag.bounds.filter(item=>containsBox(area,item.box)).map(({kind,id})=>({kind,id})));
    $('selection-area').replaceChildren(svg('rect',{...area,class:'selection-area','vector-effect':'non-scaling-stroke'}));
    renderSelection();renderInspector();return;
  }
  alignmentGuides=[];
  if (drag.kind==='node') {
    const proposed=drag.nodes.map(n=>({x:n.x+dx/view.scale,y:n.y+dy/view.scale}));
    const snap=nodeSnap(proposed,drag.movingIds,event);
    const offset={x:dx/view.scale+snap.dx,y:dy/view.scale+snap.dy};
    alignmentGuides=snap.guides;
    for (const n of drag.nodes) {n.target.x=n.x+offset.x;n.target.y=n.y+offset.y;}
    for (const route of drag.routes) {
      editRoute(route.target,route.points.map(p=>({x:p.x+offset.x,y:p.y+offset.y})));
      route.target.route.label={x:route.label.x+offset.x,y:route.label.y+offset.y};
    }
    if (drag.labels.length) {
      const lines=edgeLayout();
      for (const {target,origin} of drag.labels) {
        const shape=lines.get(target.id);
        if (shape) target.labelPosition=closestPathPosition(svg('path',{d:shape.d}),{x:origin.x+offset.x,y:origin.y+offset.y});
      }
    }
  } else if (drag.kind==='waypoint') {
    const point={x:drag.origin.x+dx/view.scale,y:drag.origin.y+dy/view.scale};
    const snapped=event.altKey?{...point,guides:[],snapped:false}:
      snapWaypoint(point,drag.points[drag.index-1],drag.points[drag.index+1],8/view.scale);
    alignmentGuides=snapped.guides;
    drag.snapped=snapped.snapped;
    drag.points[drag.index]={x:snapped.x,y:snapped.y};
    editRoute(drag.target,drag.points);
  } else if (drag.kind==='edge' && drag.geo) {
    const {x,y}=drag.geo.mid;
    drag.target.labelPosition=closestPathPosition(drag.path,{x:x+dx/view.scale,y:y+dy/view.scale});
  }
  renderGraph();
});
function finishPointer(event) {
  if (!drag||drag.pointer!==event.pointerId) return;
  const done=drag;drag=null;
  alignmentGuides=[];
  $('selection-area').replaceChildren();
  if (diagram.hasPointerCapture(done.pointer)) diagram.releasePointerCapture(done.pointer);
  if (event.type==='pointercancel') {
    if (done.before) {
      for (const node of project.nodes) {
        const before=done.before.nodes.find(n=>n.id===node.id);
        node.x=before.x;node.y=before.y;
      }
      for (const edge of project.edges) {
        const before=done.before.edges.find(e=>e.id===edge.id);
        edge.bend=before.bend;edge.route=structuredClone(before.route);edge.labelPosition=before.labelPosition;
      }
    }
    selected=done.selection;
    renderAll();return;
  }
  if (done.kind==='pan') {renderEditorOverlay();return;}
  if (done.kind==='marquee') {renderAll();return;}
  if (done.moved) {record(done.before);saveLocal();renderAll();}
  else if(done.kind!=='waypoint') graphClick(done.kind,done.target.id);
}
diagram.addEventListener('pointerup',finishPointer);
diagram.addEventListener('pointercancel',finishPointer);
diagram.addEventListener('pointerleave',()=>{
  if (!drag) {alignmentGuides=[];renderEditorOverlay();}
});
function removeWaypoint(handle) {
  const edge=project.edges.find(e=>e.id===handle.dataset.edge),shape=edgeLayoutCache.get(edge?.id);
  if (!edge||!shape) return;
  const points=editablePoints(edge,shape),index=Number(handle.dataset.waypoint);
  if (index<1||index>=points.length-1) return;
  change(()=>{
    editRoute(edge,points.filter((_,i)=>i!==index));
    selected={kind:'edge',id:edge.id};
  },{preserveSim:true});
}
diagram.addEventListener('dblclick',event=>{
  const handle=event.target.closest('[data-waypoint]');
  if (handle) {event.preventDefault();removeWaypoint(handle);}
});
diagram.addEventListener('wheel',event=>{
  event.preventDefault();
  if (drag) return;
  zoom(Math.exp(clamp(-event.deltaY*.0018,-.65,.65)),localPoint(event));
},{passive:false});
diagram.addEventListener('keydown',event=>{
  const handle=event.target.closest('[data-waypoint]');
  if (handle&&['Delete','Backspace'].includes(event.key)) {
    event.preventDefault();event.stopPropagation();removeWaypoint(handle);return;
  }
  const hit=event.target.closest('[data-kind]');
  if (hit&&(event.key==='Enter'||event.key===' ')) {
    event.preventDefault();event.stopPropagation();graphClick(hit.dataset.kind,hit.dataset.id);
  }
});

function download(name,text,type) {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const link=el('a',{href:url,download:name});
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const filename=()=>project.title.trim().replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^[.-]+|[.-]+$/g,'')||'diagram';
const saveFile=()=>download(filename()+'.json',JSON.stringify(project,null,2)+'\n','application/json;charset=utf-8');
function csv() {
  const keys=Object.keys(sim.history[0].values),quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  const labels=keys.map(id=>{
    const label=project.nodes.find(n=>n.id===id)?.label||id;
    return /^[=+\-@\t\r]/.test(label)?"'"+label:label;
  });
  const lines=[['Step',...labels].map(quote).join(',')];
  for (const row of sim.history) lines.push([row.step,...keys.map(id=>row.values[id]??'')].join(','));
  download(filename()+'.csv',lines.join('\r\n')+'\r\n','text/csv;charset=utf-8');
}
function applyImport(text,details) {
  const parsed=readDiagram(text,details);
  load(parsed,'Imported '+parsed.nodes.length+' nodes and '+parsed.edges.length+' connections.');
  $('import-dialog').close();
}
function importError(error) {$('import-error').textContent=error.message||'Could not import this diagram.';}

for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML=icon(element.dataset.icon);
const nodeTools=['source','pool','sink','gate','converter','register','delay','queue','end','text'];
for (const [container,kind,list] of [
  ['node-tools','node',nodeTools.map(type=>[type,kinds[type]])],
  ['edge-tools','edge',[['flow','Resource flow'],['state','State link']]],
]) for (const [key,label] of list) {
  const glyph=el('span');glyph.innerHTML=icon(key);
  const b=el('button',{type:'button',class:'tool','data-tool':kind,'data-value':key},[glyph,el('span',{text:label})]);
  b.addEventListener('click',()=>setTool(kind,key));
  $(container).append(b);
}
$('resource-add').addEventListener('click',()=>change(()=>{
  const r=makeResource('Resource '+project.resources.length,palette[(project.resources.length-1)%palette.length]);
  project.resources.push(r);selected={kind:'resource',id:r.id};
}));
$('variable-add').addEventListener('click',()=>change(()=>{
  let n=project.variables.length+1;
  while(project.variables.some(v=>v.name==='parameter_'+n)) n++;
  project.variables.push({name:'parameter_'+n,formula:'0'});selected={kind:'parameter',id:project.variables.length-1};
}));
$('title').addEventListener('change',e=>change(()=>{project.title=e.target.value.trim()||'Untitled diagram';},{preserveSim:true}));
$('select').addEventListener('click',()=>setTool('select'));
$('pan').addEventListener('click',()=>setTool('pan'));
$('zoom-in').addEventListener('click',()=>zoom(1.25));
$('zoom-out').addEventListener('click',()=>zoom(1/1.25));
$('fit').addEventListener('click',fit);
$('undo').addEventListener('click',()=>restore(undo,redo));
$('redo').addEventListener('click',()=>restore(redo,undo));
$('new').addEventListener('click',()=>load(blank(),'Created a blank diagram. Use Undo to return.'));
$('save').addEventListener('click',saveFile);
$('csv').addEventListener('click',csv);
$('seed').addEventListener('change',()=>{resetSim();renderGraph();renderSim();});
$('max-steps').addEventListener('change',e=>change(()=>{
  project.steps=clamp(Math.floor(Number(e.target.value)||1),1,9999);
},{preserveSim:true}));
$('step').addEventListener('click',stepSimulation);
$('play').addEventListener('click',startPlay);
$('reset').addEventListener('click',()=>{resetSim();renderGraph();renderSim();});
$('load-example').addEventListener('click',()=>{load(example(),'Loaded Potion workshop.');$('help-dialog').close();});
$('help').addEventListener('click',()=>$('help-dialog').showModal());
$('issues').addEventListener('click',()=>{
  $('issue-list').replaceChildren(...[...sim.issues].map(issue=>el('li',{text:issue})));
  $('issues-dialog').showModal();
});
$('forecast').addEventListener('click',()=>{
  stop();renderSim();
  $('forecast-info').textContent='Up to '+project.steps+' steps per run. On-click nodes wait for manual input in Play.';
  $('forecast-result').replaceChildren();
  $('forecast-dialog').showModal();
});
$('forecast-dialog').addEventListener('close',()=>{if(forecastTask)forecastTask.cancelled=true;});
$('forecast-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if (forecastTask) return;
  const button=event.target.querySelector('button');
  const count=clamp(Math.floor(Number($('forecast-count').value)),1,1000);
  const task={cancelled:false};
  forecastTask=task;
  button.disabled=true;
  const runs=project.nodes.filter(n=>plotTypes.has(n.type)).map(n=>({node:n,values:[]}));
  const summary=$('forecast-result');
  let completed=0,issues=0;
  let deadline=performance.now()+23;
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
  try {
    for (let i=0;i<count&&!task.cancelled;i++) {
      const run=new Simulation(project,$('seed').value+' / '+i,{retainHistory:false});
      for (let step=0;step<project.steps&&!run.ended&&!task.cancelled;step++) {
        run.advance();
        if (performance.now()>deadline) {
          summary.textContent='Run '+(i+1)+' of '+count+' · Step '+run.step;
          await yieldFrame();
          deadline=performance.now()+23;
        }
      }
      if (task.cancelled) return;
      if (run.step===project.steps) completed++;
      if (run.issues.size) issues++;
      for (const row of runs) row.values.push(run.value(row.node.id));
    }
    if (task.cancelled) return;
    const table=el('table',{class:'forecast-table'});
    table.append(el('thead',{},[el('tr',{},['Series','Min','Median','Max'].map(text=>el('th',{text,scope:'col'})))]));
    table.append(el('tbody',{},runs.map(row=>{
      row.values.sort((a,b)=>a-b);
      const middle=Math.floor(row.values.length/2);
      const median=(row.values[middle]+row.values[Math.floor((row.values.length-1)/2)])/2;
      return el('tr',{},[el('th',{text:row.node.label,scope:'row'}),
        ...[row.values[0],median,row.values.at(-1)].map(n=>el('td',{text:valueText(n)}))]);
    })));
    summary.replaceChildren(el('p',{text:completed+' of '+count+' runs reached step '+project.steps+
      (issues?' · '+issues+' runs reported diagram issues.':'.')}),table);
  } catch (error) {
    summary.textContent='Forecast stopped. '+error.message;
  } finally {
    button.disabled=false;
    forecastTask=null;
  }
});
$('import').addEventListener('click',()=>{
  $('import-error').textContent='';$('import-dialog').showModal();
});
$('import-dialog').addEventListener('close',()=>{importTask?.abort();importTask=null;});
for (const close of document.querySelectorAll('[data-close]')) close.addEventListener('click',()=>close.closest('dialog').close());
$('import-file').addEventListener('change',async ({target})=>{
  const file=target.files[0];
  if (!file) return;
  try {
    if (file.size>20_000_000) throw Error('Diagram files must be smaller than 20 MB.');
    const text=await file.text();
    if ($('import-dialog').open) applyImport(text,{name:file.name.replace(/\.[^.]+$/,'')});
  } catch(error) {importError(error);}
  finally {target.value='';}
});
$('paste-import').addEventListener('click',()=>{
  try {applyImport($('import-text').value,{});} catch(error) {importError(error);}
});
$('url-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=event.target.querySelector('button[type=submit]');
  if (importTask) return;
  const task=new AbortController();
  importTask=task;
  const url=$('import-url').value.trim();
  $('import-error').textContent='';
  submit.disabled=true;submit.textContent='Fetching…';
  try {
    const res=await fetch('/import-url?url='+encodeURIComponent(url),{signal:task.signal});
    const body=await res.json();
    if (!res.ok) throw Error(body.error);
    if (!task.signal.aborted&&$('import-dialog').open) applyImport(body.xml,{name:body.title,url,rendered:body.rendered});
  } catch(error) {
    if (!task.signal.aborted) importError(error);
  } finally {
    if (importTask===task) importTask=null;
    submit.disabled=false;submit.textContent='Import';
  }
});
document.addEventListener('keydown',event=>{
  if (event.target.closest('input,textarea,select,button')||document.querySelector('dialog[open]')) return;
  const key=event.key.toLowerCase();
  if (drag&&(['escape','delete','backspace'].includes(key)||(event.ctrlKey||event.metaKey)&&['z','y'].includes(key))) {
    finishPointer({type:'pointercancel',pointerId:drag.pointer});
  }
  if (event.ctrlKey||event.metaKey) {
    if (key==='z'||key==='y') {
      event.preventDefault();
      const reverse=event.shiftKey||key==='y';
      restore(reverse?redo:undo,reverse?undo:redo);
    }
    if (key==='s') {event.preventDefault();saveFile();}
    return;
  }
  if (key==='escape') {tool={kind:'select'};from=null;renderTools();renderGraph();}
  if (key==='delete'||key==='backspace') {event.preventDefault();deleteSelection();}
  if (key==='v') setTool('select');
  if (key==='h') setTool('pan');
  if (key==='f') fit();
  if (event.code==='Space') {event.preventDefault();space=true;renderTools();}
});
window.addEventListener('keyup',event=>{if(event.code==='Space'&&space){space=false;renderTools();}});
window.addEventListener('blur',()=>{
  if (drag) finishPointer({type:'pointercancel',pointerId:drag.pointer});
  if (space) {space=false;renderTools();}
});

resetSim();
if (demo) {
  const run=new Simulation(project,$('seed').value);
  for (let i=0;i<12;i++) run.advance();
  preview=run.history;
}
renderAll();
requestAnimationFrame(fit);
new ResizeObserver(renderPlot).observe($('plot'));

