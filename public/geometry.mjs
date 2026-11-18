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
  const inset = Math.min(length*.45,point.r||13);
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

export function importedEdgeShape(route,a,b) {
  const path=route.rendered;
  if (path && same(a,path.source) && same(b,path.target)) {
    return {d:path.d,mid:route.label||path.center,end:path.end,angle:path.angle,bounds:path.bounds,a,b};
  }
  const control=[a,...route.points,b];
  const routed=route.routing==='orthogonal'?orthogonal(control):control;
  const points=routed.filter((p,i)=>!i||!same(p,routed[i-1]));
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
