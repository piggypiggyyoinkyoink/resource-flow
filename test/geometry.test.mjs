import test from 'node:test';
import assert from 'node:assert/strict';
import {blank, makeEdge, makeNode, normalize} from '../public/model.mjs';
import {importedEdgeShape, routePoints, containsBox, simplifyPoints, straightenCorners, snapAlignment, snapWaypoint, closestPathPosition} from '../public/geometry.mjs';

function polylinePath(points) {
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
  return {
    getTotalLength:()=>lengths.reduce((a,b)=>a+b,0),
    getPointAtLength(offset) {
      for (let i=0;i<lengths.length;i++) {
        if (lengths[i]&&offset<=lengths[i]) {
          const a=points[i], b=points[i+1], t=offset/lengths[i];
          return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
        }
        offset-=lengths[i];
      }
      return points.at(-1);
    },
  };
}

test('connector labels project onto horizontal, vertical and diagonal lines and stop at endpoints',()=>{
  const horizontal=polylinePath([{x:0,y:0},{x:100,y:0}]);
  assert.ok(Math.abs(closestPathPosition(horizontal,{x:73,y:90})-.73)<.00001);
  assert.equal(closestPathPosition(horizontal,{x:-50,y:30}),0);
  assert.equal(closestPathPosition(horizontal,{x:180,y:-80}),1);
  const vertical=polylinePath([{x:20,y:0},{x:20,y:100}]);
  assert.ok(Math.abs(closestPathPosition(vertical,{x:80,y:37})-.37)<.00001);
  const diagonal=polylinePath([{x:0,y:0},{x:100,y:100}]);
  assert.ok(Math.abs(closestPathPosition(diagonal,{x:90,y:10})-.5)<.00001);
});

test('connector labels follow routed bends instead of the straight line between endpoints',()=>{
  const path=polylinePath([{x:0,y:0},{x:100,y:0},{x:100,y:100}]);
  assert.ok(Math.abs(closestPathPosition(path,{x:130,y:60})-.8)<.00001);
  assert.ok(Math.abs(closestPathPosition(path,{x:40,y:-30})-.2)<.00001);
  assert.ok(Math.abs(closestPathPosition(path,{x:120,y:-20})-.5)<.00001);
  assert.equal(closestPathPosition(polylinePath([{x:10,y:10},{x:10,y:10}]),{x:50,y:60}),0);
});

test('connector label projection refines points on the actual curve',()=>{
  const path={
    getTotalLength:()=>Math.PI*100,
    getPointAtLength:s=>({x:100*Math.cos(s/100),y:100*Math.sin(s/100)}),
  };
  const position=closestPathPosition(path,{x:150,y:150});
  assert.ok(Math.abs(position-.25)<.00001);
  const p=path.getPointAtLength(position*path.getTotalLength());
  assert.ok(Math.abs(Math.hypot(p.x,p.y)-100)<1e-9);
});

test('label positions survive saving and reopening without changing connector geometry',()=>{
  const project=blank();
  project.nodes=[makeNode('source',{id:'a',x:0,y:0}),makeNode('pool',{id:'b',x:200,y:100})];
  project.edges=[makeEdge('flow','a','b',{bend:80,labelPosition:.73})];
  const saved=normalize(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.edges[0].labelPosition,.73);
  assert.equal(saved.edges[0].bend,80);
  assert.equal(saved.edges[0].route,null);
  for (const [input,expected] of [[undefined,null],[null,null],[NaN,null],[-1,0],[2,1],[0,0],[1,1]]) {
    project.edges[0].labelPosition=input;
    assert.equal(normalize(project).edges[0].labelPosition,expected);
  }
});

test('imported paths and register label positions survive saving and reopening',()=>{
  const source={x:20,y:25}, target={x:160,y:90};
  const label={x:83,y:61};
  const d='M 34 25 L 83 25 A 8 8 0 0 1 91 33 L 91 90 L 146 90';
  const project=blank();
  project.nodes=[
    makeNode('register',{id:'r', ...source,label:'Enemy Strength Modifier',labelOffset:{x:2,y:28}}),
    makeNode('pool',{id:'p', ...target}),
  ];
  project.edges=[makeEdge('state','r','p',{route:{
    routing:'orthogonal',label,points:[{x:91,y:25},{x:91,y:90}],
    rendered:{d,source,target,center:{x:91,y:63},end:{x:146,y:90},angle:0},
  }})];
  const saved=normalize(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.nodes[0].label,'Enemy Strength Modifier');
  assert.deepEqual(saved.nodes[0].labelOffset,{x:2,y:28});
  const route=saved.edges[0].route;
  assert.deepEqual(route.points,[{x:91,y:25},{x:91,y:90}]);
  const exact=importedEdgeShape(route,source,target);
  assert.equal(exact.d,d);
  assert.deepEqual(exact.mid,label);
  const moved=importedEdgeShape(route,{x:20,y:10},target);
  assert.notEqual(moved.d,d);
  assert.ok(moved.d.includes('91 25 L 91 90'));
});

test('saved routing renders every waypoint when no rendered preview is available',()=>{
  const points=[{x:70,y:20},{x:70,y:75},{x:140,y:75}];
  const shape=importedEdgeShape({routing:'straight',points,label:null},{x:10,y:20},{x:180,y:75});
  assert.equal(shape.d,'M 23 20 L 70 20 L 70 75 L 140 75 L 167 75');
  assert.deepEqual(shape.end,{x:167,y:75});
});

test('selection requires full enclosure of node and label bounds',()=>{
  const area={x:-10,y:20,width:100,height:80};
  assert.equal(containsBox(area,{x:-10,y:20,width:100,height:80}),true);
  assert.equal(containsBox(area,{x:0,y:40,width:10,height:10}),true);
  assert.equal(containsBox(area,{x:0,y:95,width:10,height:10}),false);
  assert.equal(containsBox(area,{x:-11,y:20,width:100,height:80}),false);
});

test('editable orthogonal routes expose every corner and deleting one creates a straight segment',()=>{
  const a={x:0,y:0}, b={x:200,y:100};
  const points=routePoints({routing:'orthogonal',points:[{x:100,y:50}]},a,b);
  assert.deepEqual(points,[a,{x:100,y:0},{x:100,y:50},{x:200,y:50},b]);
  points.splice(2,1);
  const shape=importedEdgeShape({routing:'straight',points:points.slice(1,-1)},a,b);
  assert.ok(shape.d.includes('100 0 L 200 50'));
});

test('path simplification removes redundant samples and retains visible bends',()=>{
  const sampled=[{x:0,y:0},{x:50,y:0},{x:100,y:0},{x:100,y:50},{x:100,y:100}];
  assert.deepEqual(simplifyPoints(sampled,1),[{x:0,y:0},{x:100,y:0},{x:100,y:100}]);
  assert.deepEqual(sampled[1],{x:50,y:0});
  const rounded=[{x:0,y:0},{x:90,y:0},{x:97,y:3},{x:100,y:10},{x:100,y:100}];
  assert.deepEqual(straightenCorners(rounded),[{x:0,y:0},{x:100,y:0},{x:100,y:100}]);
});

test('alignment snaps a group to nearby node centres within the supplied tolerance',()=>{
  const moving=[{x:43,y:70},{x:93,y:120}];
  const snap=snapAlignment(moving,[{x:100,y:70}],8);
  assert.equal(snap.dx,7);
  assert.equal(snap.dy,0);
  assert.equal(snap.guides.length,2);
  assert.equal(snapAlignment(moving,[{x:100,y:70}],4).dx,0);
});

test('waypoints snap to adjacent axes and to a nearby rotated right angle',()=>{
  const axis=snapWaypoint({x:96,y:5},{x:0,y:0},{x:100,y:100},8);
  assert.equal(axis.x,100);
  assert.equal(axis.y,0);
  const a={x:0,y:0}, b={x:100,y:0};
  const rotated=snapWaypoint({x:50,y:48},a,b,4);
  assert.equal(rotated.snapped,true);
  const dot=(a.x-rotated.x)*(b.x-rotated.x)+(a.y-rotated.y)*(b.y-rotated.y);
  assert.ok(Math.abs(dot)<1e-9);
  assert.equal(snapWaypoint({x:50,y:25},a,b,4).snapped,false);
  const nearEndpoint=snapWaypoint({x:2,y:16},a,b,4);
  assert.ok(Math.abs((a.x-nearEndpoint.x)*(b.x-nearEndpoint.x)+(a.y-nearEndpoint.y)*(b.y-nearEndpoint.y))<1e-9);
});
