export function point(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return {x:value.x,y:value.y};
}

export function normalizeRoute(value) {
  if (!value || typeof value!=='object') return null;
  const route = {
    routing:value.routing==='orthogonal'?'orthogonal':'straight',
    points:Array.isArray(value.points)?value.points.map(point).filter(Boolean):[],
    label:point(value.label),
  };
  const path = value.rendered;
  if (path && typeof path.d==='string' && path.d.length<32000 &&
      /^\s*[Mm][MmZzLlHhVvCcSsQqTtAaEe0-9.,+\-\s]+$/.test(path.d)) {
    const {source,target,center,end} = Object.fromEntries(
      ['source','target','center','end'].map(key=>[key,point(path[key])]));
    if (source && target && center && end && Number.isFinite(path.angle)) {
      route.rendered = {d:path.d,source,target,center,end,angle:path.angle,
        bounds:Array.isArray(path.bounds)?path.bounds.slice(0,2).map(point).filter(Boolean):[]};
    }
  }
  return route;
}

const same = (a,b) => a.x===b.x && a.y===b.y;
const distance = (a,b) => Math.hypot(b.x-a.x,b.y-a.y);
const coordinates = p => p.x+' '+p.y;

export function closestPathPosition(path,p) {
  const length=path.getTotalLength();
  if (!length) return 0;
  const count=Math.min(1024,Math.max(1,Math.ceil(length/8)));
  const squared=offset=>{
    const q=path.getPointAtLength(offset);
    return (q.x-p.x)**2+(q.y-p.y)**2;
  };
  let best=0, nearest=squared(0);
  for (let i=1;i<=count;i++) {
    const offset=length*i/count, distance=squared(offset);
    if (distance<nearest) {best=offset;nearest=distance;}
  }
  // Refine against the actual SVG path so curves and rounded corners stay exact.
  for (let step=length/count/2;step>.0001;step/=2) {
    for (const offset of [Math.max(0,best-step),Math.min(length,best+step)]) {
      const distance=squared(offset);
      if (distance<nearest) {best=offset;nearest=distance;}
    }
  }
  return best/length;
}

export function edgeLabelPoint(edge,path) {
  if (edge.labelPosition==null) {
    if (!edge.route?.label) return null;
    // Convert legacy imported coordinates before the connector can be edited.
    edge.labelPosition=closestPathPosition(path,edge.route.label);
  }
  const p=path.getPointAtLength(path.getTotalLength()*edge.labelPosition);
  return {x:p.x,y:p.y};
}

function orthogonal(points) {
  const route = [points[0]];
  let horizontal;
  for (const to of points.slice(1)) {
    const from = route.at(-1);
    const dx = to.x-from.x, dy = to.y-from.y;
    if (dx && dy) {
      const turn = horizontal===undefined ? Math.abs(dx)>=Math.abs(dy) : !horizontal;
      route.push(turn?{x:to.x,y:from.y}:{x:from.x,y:to.y});
      horizontal = !turn;
    } else if (dx || dy) horizontal=Boolean(dx);
    route.push(to);
  }
  return route;
}

function trimEnd(point,towards) {
  const length = distance(point,towards) || 1;
  const inset = Math.min(length*.45,point.r??13);
  return {x:point.x+(towards.x-point.x)*inset/length,y:point.y+(towards.y-point.y)*inset/length};
}

function halfway(points) {
  const lengths = points.slice(1).map((p,i)=>distance(points[i],p));
  let remaining = lengths.reduce((a,b)=>a+b,0)/2;
  for (let i=0;i<lengths.length;i++) {
    const length=lengths[i];
    if (length && remaining<=length) {
      const a=points[i], b=points[i+1], ratio=remaining/length;
      return {x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio};
    }
    remaining-=length;
  }
  return points[0];
}

export function routePoints(route,a,b) {
  const control=[a,...route.points,b];
  const routed=route.routing==='orthogonal'?orthogonal(control):control;
  return routed.filter((p,i)=>!i||!same(p,routed[i-1])).map(p=>({...p}));
}

export function containsBox(area,box) {
  return box.x>=area.x && box.y>=area.y &&
    box.x+box.width<=area.x+area.width && box.y+box.height<=area.y+area.height;
}

export function simplifyPoints(points,tolerance=1) {
  if (points.length<3) return points.map(p=>({...p}));
  const keep=new Set([0,points.length-1]), pending=[[0,points.length-1]];
  while (pending.length) {
    const [first,last]=pending.pop(), a=points[first], b=points[last];
    const dx=b.x-a.x, dy=b.y-a.y, length=dx*dx+dy*dy;
    let farthest=tolerance*tolerance, index;
    for (let i=first+1;i<last;i++) {
      const p=points[i];
      const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
      const squared=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
      if (squared>farthest) {farthest=squared;index=i;}
    }
    if (index!==undefined) {
      keep.add(index);
      pending.push([first,index],[index,last]);
    }
  }
  return [...keep].sort((a,b)=>a-b).map(i=>({...points[i]}));
}

export function straightenCorners(points,maxSize=24) {
  if (points.length<3) return points;
  const result=[points[0]];
  const horizontal=(a,b)=>Math.abs(b.y-a.y)<=Math.max(.05,distance(a,b)*.02);
  const vertical=(a,b)=>Math.abs(b.x-a.x)<=Math.max(.05,distance(a,b)*.02);
  for (let i=1;i<points.length-1;i++) {
    const before=result.at(-1),from=points[i];
    let corner,last=i;
    for (let j=i+1;j<points.length-1&&distance(from,points[j])<=maxSize;j++) {
      const to=points[j],after=points[j+1];
      let candidate;
      if (horizontal(before,from)&&vertical(to,after)) candidate={x:after.x,y:before.y};
      else if (vertical(before,from)&&horizontal(to,after)) candidate={x:before.x,y:after.y};
      if (candidate&&distance(candidate,from)<=maxSize&&distance(candidate,to)<=maxSize) {
        corner=candidate;last=j;
      }
    }
    result.push(corner||from);
    i=last;
  }
  result.push(points.at(-1));
  return result;
}

export function snapAlignment(moving,anchors,tolerance) {
  let dx=0, dy=0, vertical, horizontal, nearestX=tolerance, nearestY=tolerance;
  for (const p of moving) for (const anchor of anchors) {
    const x=anchor.x-p.x, y=anchor.y-p.y;
    if (Math.abs(x)<=nearestX) {dx=x;nearestX=Math.abs(x);vertical={p,anchor};}
    if (Math.abs(y)<=nearestY) {dy=y;nearestY=Math.abs(y);horizontal={p,anchor};}
  }
  const guides=[];
  if (vertical) {
    const {p,anchor}=vertical;
    guides.push({x1:anchor.x,y1:Math.min(p.y+dy,anchor.y)-36,x2:anchor.x,y2:Math.max(p.y+dy,anchor.y)+36});
  }
  if (horizontal) {
    const {p,anchor}=horizontal;
    guides.push({x1:Math.min(p.x+dx,anchor.x)-36,y1:anchor.y,x2:Math.max(p.x+dx,anchor.x)+36,y2:anchor.y});
  }
  return {dx,dy,guides};
}

export function snapWaypoint(p,previous,next,tolerance) {
  const snap=snapAlignment([p],[previous,next],tolerance);
  const aligned={x:p.x+snap.dx,y:p.y+snap.dy};
  if (snap.guides.length===2) return {...aligned,guides:snap.guides,snapped:true};
  const a={x:previous.x-p.x,y:previous.y-p.y}, b={x:next.x-p.x,y:next.y-p.y};
  const lengths=Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y);
  const center={x:(previous.x+next.x)/2,y:(previous.y+next.y)/2};
  const radius=distance(previous,next)/2, length=distance(center,p);
  if (lengths && length && Math.abs((a.x*b.x+a.y*b.y)/lengths)<Math.sin(5*Math.PI/180) && Math.abs(radius-length)<=tolerance) {
    return {x:center.x+(p.x-center.x)*radius/length,y:center.y+(p.y-center.y)*radius/length,guides:[],snapped:true};
  }
  if (snap.guides.length) return {...aligned,guides:snap.guides,snapped:true};
  return {...p,guides:[],snapped:false};
}

export function importedEdgeShape(route,a,b) {
  const path=route.rendered;
  if (path && same(a,path.source) && same(b,path.target)) {
    return {d:path.d,mid:route.label||path.center,end:path.end,angle:path.angle,bounds:path.bounds,a,b};
  }
  const points=routePoints(route,a,b);
  if (points.length<2) return null;
  points[0]=trimEnd(a,points[1]);
  const prior=points.at(-2);
  const end=trimEnd(b,prior);
  points[points.length-1]=end;
  return {
    d:'M '+points.map(coordinates).join(' L '),mid:route.label||halfway(points),end,
    angle:Math.atan2(end.y-prior.y,end.x-prior.x)*180/Math.PI,
    bounds:points,a,b,
  };
}
