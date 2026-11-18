import {blank, makeNode, makeEdge, makeResource, fallback, color, normalize, kinds, variableName} from './model.mjs';

const cellTypes = {
  mxSourceShapeCell:'source', mxPoolShapeCell:'pool', mxDrainShapeCell:'sink', mxSinkShapeCell:'sink',
  mxGateShapeCell:'gate', mxConverterShapeCell:'converter', mxTraderShapeCell:'trader',
  mxMachinationRegisterCell:'register', mxRegisterShapeCell:'register', mxDelayShapeCell:'delay',
  mxEndConditionShapeCell:'end', mxTextCell:'text',
};
const take = (el,...keys) => keys.map(key=>el?.getAttribute(key)).find(x=>x!=null && x!=='') ?? '';
const checked = value => /^(1|true|yes|enabled)$/i.test(value);
const textOf = el => el?.textContent?.trim() || '';
const decode = text => new DOMParser().parseFromString(
  String(text||'').replace(/<br\s*\/?>|<\/(?:p|div)>/gi,' '), 'text/html').body.textContent.replace(/\s+/g,' ').trim();
const numeric = value => /^[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?$/i.test(value);
const decodeFormula = value => value.replace(/&(gt|lt|amp|nbsp|quot|apos);/gi,
  (_,key)=>({gt:'>',lt:'<',amp:'&',nbsp:' ',quot:'"',apos:"'"})[key.toLowerCase()]).trim();
const typeKey = value => value.toLowerCase().replace(/[\s_-]/g,'');
const xmlPoint = el => {
  const x = take(el,'x'), y = take(el,'y');
  return numeric(x) && numeric(y) ? {x:Number(x),y:Number(y)} : null;
};
const child = (el,...tags) => Array.from(el?.children||[]).find(item=>tags.includes(item.tagName));
const comparisons = new Map([
  ['greaterthan','>'], ['greaterorequal','>='], ['equal','=='],
  ['notequal','!='], ['lessthan','<'], ['lessorequal','<='],
]);
const triggerParams = new Map([
  ['anychange','change'], ['givenchance','chance'], ['chance','chance'],
  ['receivingresource','gain'], ['gain','gain'], ['sendingresource','loss'], ['loss','loss'],
  ['failedaction','failed'], ['failed','failed'], ['reversetrigger','failed'],
]);

function resourceFactory(project) {
  return (key, name=key, tint) => {
    if (!key) return fallback;
    const existing = project.resources.find(r=>r.id===key);
    if (existing) {
      if (tint && existing.id!==fallback) existing.color=color(tint,existing.color);
      return existing.id;
    }
    project.resources.push(makeResource(name,color(tint,'#a692ff'),key));
    return key;
  };
}

function activation(raw,type) {
  const value = raw.toLowerCase().replace(/[\s_-]/g,'');
  const modes = {
    automatic:'auto',auto:'auto',interactive:'click',onclick:'click',passive:'passive',
    onenable:'enable', onenabled:'enable', enable:'enable', onstart:'start', startup:'start', start:'start',
    agentic:'agent', agent:'agent',
  };
  return modes[value] ?? (type==='source' ? 'auto' : 'passive');
}

function edgeMode(value, formula, typed, params='') {
  const name = typeKey(value);
  if (name==='modifyvalue') return typeKey(params)==='overwrite' ? 'overwrite' : 'unsupported';
  if (/reverse|failed/.test(name) || formula==='!') return 'reverse';
  if (/triggerif|conditionaltrigger/.test(name)) return 'triggerIf';
  if (/split|weightedtrigger/.test(name)) return 'split';
  if (name==='trigger' || formula==='*' || name==='3') return 'trigger';
  if (/variable|input/.test(name) || name==='6') return 'input';
  if (/^(4|condition|activator|enable|enablewhile)$/.test(name) || /^[<>!≥≤≠]|^==|\.\./.test(formula)) return 'enable';
  if (/overwrite|assign|setvalue/.test(name) || /^=(?!=)/.test(formula)) return 'overwrite';
  if (/multiply/.test(name)) return 'multiply';
  if (['','1','2','modifier','node','formula','add','changevalue','changeformula'].includes(name) && /^[+-]|\d/.test(formula)) return 'add';
  return typed ? 'unsupported' : 'add';
}

function bounds(el,key) {
  const value = take(el,key);
  return ['-9999','9999','-Infinity','Infinity'].includes(value) ? '' : value;
}

function xmlModel(xml, title, origin, rendered) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('This XML uses an unsupported document type.');
  const doc = new DOMParser().parseFromString(xml,'application/xml');
  const root = doc.querySelector('mxGraphModel');
  if (doc.querySelector('parsererror') || !root) throw Error('Machinations model XML could not be read.');
  const project = blank(title || take(root,'name','title') || 'Imported Machinations model');
  project.steps = Number(take(root,'diagram_time_steps_limit','steps'))||30;
  project.origin = origin || '';
  const ensure = resourceFactory(project);
  for (const r of root.querySelectorAll('resources > resource, resources > Resource, resources > add')) {
    const key = take(r,'name','id');
    ensure(key,take(r,'displayName','label')||key,take(r,'color'));
  }
  const resource = el => {
    const child = [...el.children].find(e=>/^(resource|Resource)$/.test(e.tagName) && !/filter/i.test(take(e,'as')));
    const key = take(el,'resource','resourceId') || take(child,'name','id');
    return ensure(key,take(child,'displayName')||key,take(child,'color'));
  };
  const filter = el => {
    const label = take(el,'resourceFilter','filterResource','filteredResource');
    const child = [...el.children].find(e=>/resource/i.test(e.tagName) && /filter/i.test(take(e,'as')));
    const colored = checked(take(el,'colorCoding','filterEnabled','useResourceFilter'));
    return label ? ensure(label) : child ? ensure(take(child,'name','id'),take(child,'displayName','name'),take(child,'color')) : colored ? resource(el) : '';
  };
  const rootTree = [...root.children].find(e=>e.tagName==='root');
  if (!rootTree) throw Error('The model XML has no graph root.');
  const cells = [...rootTree.querySelectorAll('[id]')].filter(c=>/Cell$/.test(c.tagName));
  for (const node of cells) {
    const tag = node.tagName;
    if (/ConnectionCell$/.test(tag)) continue;
    const geo = [...node.children].find(n=>n.tagName==='mxGeometry');
    let type = cellTypes[tag];
    if (!type && geo && (checked(take(node,'vertex')) || tag!=='mxCell')) type='unknown';
    if (!type || !geo) continue;
    if (type==='delay' && checked(take(node,'queue','isQueue'))) type='queue';
    const style = take(node,'style');
    const action = take(node,'actionMode','direction').toLowerCase();
    const distribution = take(node,'distributionMode','distribution');
    const capacity = take(node,'capacity','maxCapacity');
    const register = type==='register';
    const valueIsLabel = node.hasAttribute('formula') || checked(take(node,'isInteractive'));
    const label = register ? take(node,'label','displayLabel','name') || (valueIsLabel?take(node,'value'):'') :
      take(node,'value','label','name');
    const formula = register && !valueIsLabel ? take(node,'value') : take(node,'formula');
    const x=Number(take(geo,'x'))+Number(take(geo,'width')||46)/2;
    const y=Number(take(geo,'y'))+Number(take(geo,'height')||46)/2;
    const labelPoint=register && label ? xmlPoint(child(geo,'labelPoint')) : null;
    const initial = take(node,'number','initialValue','initialAmount','initialQuantity') || '0';
    const initialResources = [];
    for (const item of node.querySelectorAll('resourceAmounts > *, initialResources > *, resources > *')) {
      const key=take(item,'name','resource','id');
      const value=take(item,'number','value','amount','quantity');
      if (key && value) initialResources.push({resource:ensure(key,take(item,'displayName')||key,take(item,'color')),value});
    }
    const rawMode = checked(take(node,'isInteractive')) ? 'interactive' : checked(take(node,'updateInEachStep')) ? 'automatic' : take(node,'activation','triggerMode');
    project.nodes.push(makeNode(type,{
      id:take(node,'id'), x,y,labelOffset:labelPoint&&{x:labelPoint.x-x,y:labelPoint.y-y},
      label:decode(label)||kinds[type]+' '+take(node,'id'), formula, initial, capacity:capacity==='-1'?'':capacity,
      min:bounds(node,'minValue'), max:bounds(node,'maxValue'), initialResources,
      trigger:activation(rawMode,type), direction:action.includes('push') || type==='source' || ['delay','queue'].includes(type)&&!action ? 'push':'pull',
      all:action.includes('all'), resource:resource(node), resourceFilter:filter(node)?[filter(node)]:[],
      overflow:/sink|discard|drain/.test(take(node,'overflow'))?'sink':'block', condition:take(node,'condition','conditionFormula'),
      distribution:/dice|random/.test(distribution)?'random':'deterministic',
      stepValue:take(node,'step','stepValue')||'1', conversion:/multiple/i.test(take(node,'conversion'))?'multiple':'single',
      ignoreDisabled:take(node,'ignoreDisabledInputs')!=='0',
      color:color(/(?:^|;)strokeColor=(#[0-9a-f]{6})/i.exec(style)?.[1],''),
      note:decode(take(node,'description','note')) || (type==='unknown' ? 'Imported XML node type: '+tag:''),
    }));
    if (rawMode && !/^(auto(matic)?|interactive|on[-_ ]?click|passive|on[-_ ]?enable(d)?|enable|on[-_ ]?start|startup|start|agent(ic)?)$/i.test(rawMode)) {
      project.warnings.push('Unmapped trigger mode "'+rawMode+'" on '+take(node,'id')+'.');
    }
  }
  for (const el of cells.filter(c=>/ConnectionCell$/.test(c.tagName))) {
    const state = /StateConnection/.test(el.tagName);
    const formType = take(el,'formulaType').toLowerCase();
    const val = take(el,'formulaValue');
    const val2 = take(el,'formulaValue2');
    let formula = decodeFormula(take(el,'formula'));
    let label = decode(take(el,'value','label'));
    let mode = 'enable';
    let triggerOn;
    if (state) {
      const rawMode = take(el,'stateConnectionType','connectionType','formulaType','type');
      const params = take(el,'formulaTypeParams');
      const comparison = typeKey(rawMode)==='condition' ? comparisons.get(typeKey(params)) : undefined;
      if (!formula && val) formula=decodeFormula(val);
      if (!formula && typeKey(rawMode)!=='modifyvalue' && (rawMode || /^[=<>!+*-]/.test(label))) {
        formula=label;
        label='';
      }
      mode = edgeMode(rawMode,formula,Boolean(rawMode),params);
      if (mode==='unsupported') project.warnings.push('State connection '+take(el,'id')+' uses an unmapped type ('+rawMode+').');
      if (mode==='trigger' && params) {
        triggerOn = triggerParams.get(typeKey(params));
        if (!triggerOn) {
          project.warnings.push('State connection '+take(el,'id')+' uses an unmapped trigger mode ('+params+').');
          mode = 'unsupported';
        }
      }
      if (comparison && val) formula=comparison+' '+decodeFormula(val);
      if (mode==='enable' && val2 && /between|range/i.test(rawMode+' '+params)) formula=val+'..'+val2;
    } else {
      if (formType==='chance') formula=(val||'0')+'%';
      else if (formType==='dice roll'||formType==='dice') formula=(val||'1')+'D'+(val2||'6');
      else if (formType==='all') formula='all';
      else if (/between/.test(formType)) formula=val+'..'+val2;
      else formula=val||formula||'1';
    }
    const source=take(el,'source'), target=take(el,'target');
    const geo=el.querySelector('mxGeometry');
    const waypoints=Array.from(geo?.children||[]).find(p=>p.tagName==='Array' && take(p,'as')==='points');
    const route={
      routing:/orthogonal|elbow|segmentEdgeStyle/i.test(take(el,'style'))?'orthogonal':'straight',
      points:Array.from(waypoints?.children||[]).filter(p=>['point','mxPoint'].includes(p.tagName)).map(xmlPoint).filter(Boolean),
      label:xmlPoint(child(geo,'formulaPoint'))||xmlPoint(child(geo,'labelPoint')),
    };
    project.edges.push(makeEdge(state?'state':'flow',source,target,{
      id:take(el,'id'), label, formula, mode, triggerOn, route, interval:take(el,'interval')||'1', chanceAmount:val2||'1',
      resource:filter(el), condition:take(el,'condition'), decimals:checked(take(el,'allowDecimals')),
      min:bounds(el,'minValue'), max:bounds(el,'maxValue'), shuffle:checked(take(el,'shuffleSource')),
      transfer:/instant/.test(take(el,'resourceTransfer','transfer'))?'instant':'interval',
      note:decode(take(el,'description','note')),
    }));
  }
  discardDangling(project);
  if (Array.isArray(rendered)) attachRenderedRoutes(project,rendered);
  const variableGroups = [...root.children].filter(e=>/customvariable|globalvariable|parameter/i.test(e.tagName+' '+take(e,'as')));
  for (const group of variableGroups) {
    const entries = [group,...group.querySelectorAll('[name]')];
    for (const item of entries) {
      const name=take(item,'name','label');
      const formula=take(item,'formula','value','expression');
      if (/json|sheet|market|http|feed/i.test(take(item,'type','source')+' '+formula)) {
        project.warnings.push('External parameter '+(name||'(unnamed)')+' requires a local replacement.');
      } else if (name&&formula) project.variables.push({name,formula});
    }
    if (entries.length===1 && !take(group,'name')) project.warnings.push('A parameter block could not be decoded.');
  }
  return normalize(project);
}

function attachRenderedRoutes(project, rendered) {
  const paths=new Map(rendered.map(path=>[path.id,path]));
  const anchors=new Map(project.nodes.map(({id,x,y})=>[id,{x,y}]));
  for (const edge of project.edges) {
    const anchor=edge.route.label||paths.get(edge.id)?.center;
    if (anchor) anchors.set(edge.id,anchor);
  }
  let missing=0;
  for (const edge of project.edges) {
    const path=paths.get(edge.id), source=anchors.get(edge.source), target=anchors.get(edge.target);
    if (path && source && target) edge.route.rendered={...path,source,target};
    else missing++;
  }
  if (missing) project.warnings.push('Used saved routing for '+missing+' connections whose exact paths were unavailable in the preview.');
}

function discardDangling(project) {
  let remaining = project.edges, before;
  do {
    before=remaining.length;
    const ids=new Set([...project.nodes,...remaining].map(n=>n.id));
    remaining=remaining.filter(e=>ids.has(e.source)&&ids.has(e.target));
  } while(remaining.length!==before);
  if (remaining.length!==project.edges.length) project.warnings.push((project.edges.length-remaining.length)+' connections had unresolved endpoints and were omitted.');
  project.edges = remaining;
}

const translation = value => {
  const match = /translate\(\s*([-.\d]+)[,\s]+([-.\d]+)\s*\)/.exec(value||'');
  return match ? [+match[1],+match[2]] : null;
};
const getPoint = (path,distance) => { const p=path.getPointAtLength(distance); return [p.x,p.y]; };
const dist = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);

function pathGeometry(path) {
  try {
    const length=path.getTotalLength();
    if (!(length>0)) return null;
    const points=[];
    const divisions=Math.min(140,Math.max(2,Math.ceil(length/12)));
    for (let i=0;i<=divisions;i++) points.push(getPoint(path,length*i/divisions));
    return {points,start:points[0],end:points.at(-1)};
  } catch {
    const parts=take(path,'d').match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number) || [];
    if (parts.length<4) return null;
    const start=parts.slice(0,2), end=parts.slice(-2);
    return {points:[start,end],start,end};
  }
}

function segmentDistance(point,a,b) {
  const dx=b[0]-a[0], dy=b[1]-a[1];
  const scale=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
  return dist(point,[a[0]+dx*scale,a[1]+dy*scale]);
}

function labelBounds(edge) {
  const object=edge.querySelector('foreignObject.m-display-label');
  const point=translation(take(object?.parentElement,'transform'));
  const width=Number(take(object,'width')),height=Number(take(object,'height'));
  if (!point||!width||!height) return null;
  return [point[0],point[1],point[0]+width,point[1]+height];
}

function labelDistance([x,y],bounds) {
  if (!bounds) return Infinity;
  const [left,top,right,bottom]=bounds;
  return Math.hypot(Math.max(left-x,x-right,0),Math.max(top-y,y-bottom,0));
}

function svgModel(input,title) {
  // The canvas uses structural attributes. Inline styling and embedded assets are not needed.
  const doc=new DOMParser().parseFromString(input.replace(
    /\s(?:style|src|srcset|href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,''),'text/html');
  const canvas=doc.querySelector('svg.m-ground-work-svg') || doc.querySelector('svg');
  const group=canvas?.querySelector('g.nodes') || canvas;
  if (!group) throw Error('No Machinations diagram SVG was found in this file.');
  const project = blank(title || 'Imported Machinations SVG');
  project.warnings.push('SVG import reconstructs visible content. Review inferred endpoints and resource assignments. Register formulas, capacities and other hidden settings may be missing.');
  const ensure=resourceFactory(project);
  const data=[...group.querySelectorAll('g[data-nodeid]')];
  const paths=[];
  for (const el of data) {
    const id=take(el,'data-nodeid');
    if (el.classList.contains('m-connection-shape')) {
      const line=el.querySelector('.m-connection-line');
      const shape=line&&pathGeometry(line);
      if (shape) paths.push({el,id,line,bounds:labelBounds(el),...shape});
      continue;
    }
    const body=[...el.children].find(e=>translation(take(e,'transform')));
    const point=body&&translation(take(body,'transform'));
    if (!point) continue;
    const icon=body.querySelector('.m-node-icon-view') || body;
    const silhouette=icon.querySelector('ellipse, rect, path');
    const d=take(silhouette,'d');
    let type='unknown';
    if (body.classList.contains('m-end-condition-shape')) type='end';
    else if (body.classList.contains('m-register-shape')) type='register';
    else if (silhouette?.localName==='ellipse') type='pool';
    else if (d.startsWith('M -21.55 17.12')) type='source';
    else if (d.startsWith('M -21.55 -17.12')) type='sink';
    else if (d.startsWith('M -18.17 21.67')) type='converter';
    else if (el.querySelector('.m-display-descriptive-label-div') && !silhouette) type='text';
    const label=textOf(el.querySelector('.m-label-span, .descriptiveLabelInnerLabel')) || kinds[type]+' '+id;
    const badge=el.querySelector('.m-pool-resource-mark');
    const resourceName=/\b(?:can hold|makes|produces|accepts|converts to|contains)\s+(.+?)\.?$/i.exec(textOf(badge?.querySelector('title')))?.[1];
    const tint=take(badge?.querySelector('svg circle'),'fill')||take(silhouette,'stroke')||take(body,'stroke');
    const value=textOf(icon.querySelector('text'));
    project.nodes.push(makeNode(type,{
      id,label,x:point[0],y:point[1],trigger:activation(take(el.querySelector('.triggers'),'aria-label')||'passive',type),
      color:color(take(silhouette,'stroke')||take(body,'stroke'), ''),
      resource:resourceName?ensure('svg_'+variableName(resourceName),resourceName,tint):fallback,
      initial:numeric(value)?value:'0',
      note:type==='register'?'Check the original register formula. The diagram SVG typically contains a rendered value or icon.':'',
    }));
  }
  if (!project.nodes.length) throw Error('The SVG does not contain identifiable Machinations nodes.');
  for (const path of paths) {
    const {el,line}=path;
    const state=line.hasAttribute('stroke-dasharray') || !!el.querySelector('.m-sc-label');
    const endpoints = [];
    for (const point of [path.start,path.end]) {
      const nodes=project.nodes.filter(n=>n.type!=='text').map(n=>[n.id,dist(point,[n.x,n.y])]).sort((a,b)=>a[1]-b[1]);
      const nearest=nodes[0];
      if (nearest && nearest[1]<39) { endpoints.push(nearest[0]); continue; }
      let best=null, distance=25;
      if (state) for (const other of paths) {
        if (other===path) continue;
        const badgeDistance=labelDistance(point,other.bounds)+3;
        if (badgeDistance<distance) {best=other.id;distance=badgeDistance;}
        for(let j=1;j<other.points.length;j++) {
          const d=segmentDistance(point,other.points[j-1],other.points[j]);
          if (d<distance) { best=other.id;distance=d; }
        }
      }
      endpoints.push(best ||(nearest?.[1]<63 ? nearest[0] : ''));
    }
    const badge=el.querySelector('.m-display-inner-formula-div');
    const value=textOf(el.querySelector('.m-pill-value')) || (badge?.firstChild?.textContent || '').trim();
    const code=textOf(el.querySelector('.m-pill-code'));
    const resourcePill=el.querySelector('.m-pill-flow');
    const filterName=take(resourcePill,'title').replace(/ can travel on this connection\.$/i,'')||textOf(resourcePill);
    let formula=value || (state?'x != 0':'1'), mode='enable';
    let triggerOn;
    if (state) {
      const chance=/^(?:chance\s+)?(\d+(?:\.\d+)?)\s*%(?:\s+chance)?$/i.exec(value);
      triggerOn = triggerParams.get(typeKey(value.replace(/^trigger(?: on)?\s+/i,'')));
      if (/^input as /i.test(value)) { mode='input';formula=code||value.replace(/^input as /i,''); }
      else if (/^enable while\s*/i.test(value)) { mode='enable';formula=value.replace(/^enable while\s*/i,''); }
      else if (/^trigger if\s*/i.test(value)) { mode='triggerIf';formula=value.replace(/^trigger if\s*/i,''); }
      else if (/^overwrite/i.test(value)) mode='overwrite';
      else if (chance) { mode='trigger';triggerOn='chance';formula=chance[1]; }
      else if (triggerOn || /^trigger$|^\*+$/i.test(value)) { mode='trigger';formula='*'; }
      else if (/^change (value|formula)\s*/i.test(value)) { mode='add';formula=code||value.replace(/^change (value|formula)\s*/i,'')||'1'; }
      else mode=edgeMode('',formula,false);
    } else if (!value) {
      const clone=badge?.cloneNode(true);
      clone?.querySelectorAll('.m-pill-flow, .m-pill-glyph, svg').forEach(item=>item.remove());
      formula=textOf(clone)||'1';
    }
    if (!state) {
      const range=/^(\d+)\s+to\s+(\d+)$/i.exec(formula);
      if (range && el.querySelector('.m-pill-dice')) {
        const count=Number(range[1]), faces=Number(range[2])/count;
        if (count>0 && Number.isInteger(faces)) formula=count+'D'+faces;
      }
    }
    const a=path.start,b=path.end, p=path.points[Math.floor(path.points.length/2)];
    const bend=2*((p[0]-a[0])*(a[1]-b[1])+(p[1]-a[1])*(b[0]-a[0]))/(dist(a,b)||1);
    const [source,target]=endpoints;
    project.edges.push(makeEdge(state?'state':'flow',source,target,{
      id:path.id, mode, formula, triggerOn, bend:Math.max(-260,Math.min(260,bend)),
      resource:filterName?ensure('svg_'+variableName(filterName),filterName):'',
    }));
  }
  discardDangling(project);
  const unknown=project.nodes.filter(n=>n.type==='unknown').length;
  if (unknown) project.warnings.push(unknown+' SVG node shapes need their type set in the inspector.');
  return normalize(project);
}

export function readDiagram(source,{name='',url='',rendered}={}) {
  if (source.length>20_000_000) throw Error('Diagram files must be smaller than 20 MB.');
  const text=source.replace(/^\uFEFF/,'').trim();
  if (text.startsWith('{')) {
    const data=JSON.parse(text);
    if (typeof data.xml==='string' || typeof data.content?.xml==='string') {
      const model=data.content||data;
      return xmlModel(model.xml,model.filename||model.title||name,url||model.url,rendered);
    }
    return normalize(data);
  }
  if (/<mxGraphModel(?:\s|>)/i.test(text)) return xmlModel(text,name,url,rendered);
  if (/<svg\b/i.test(text)) return svgModel(text,name);
  throw Error('Choose a local project JSON, Machinations XML, or captured diagram SVG/HTML.');
}

