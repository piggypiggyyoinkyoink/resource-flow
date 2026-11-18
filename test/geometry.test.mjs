import test from 'node:test';
import assert from 'node:assert/strict';
import {blank, makeEdge, makeNode, normalize} from '../public/model.mjs';
import {importedEdgeShape} from '../public/geometry.mjs';

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
