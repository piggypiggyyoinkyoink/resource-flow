import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,makeNode,makeEdge,normalize} from '../public/model.mjs';
import {connectionStatus,canAttachEndpoint} from '../public/connections.mjs';
import {importedEdgeShape} from '../public/geometry.mjs';
import {Simulation} from '../public/sim.mjs';

function diagram() {
  const project=blank();
  project.nodes=[makeNode('source',{id:'a',x:0,y:0}),makeNode('pool',{id:'b',x:200,y:0,initial:'5'})];
  return project;
}

test('disconnected endpoints retain world positions when saving and reopening',()=>{
  const project=diagram();
  project.edges=[makeEdge('flow','','b',{id:'f',sourcePoint:{x:0,y:80}})];
  const saved=normalize(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.edges[0].source,'');
  assert.deepEqual(saved.edges[0].sourcePoint,{x:0,y:80});
  const status=connectionStatus(saved);
  assert.equal(status.connected.size,0);
  assert.deepEqual(status.issues,['Resource flow f has a disconnected origin.']);
});

test('both endpoints may be free even in a diagram without nodes',()=>{
  const project=blank();
  project.edges=[makeEdge('flow','','',{id:'f',sourcePoint:{x:0,y:0},targetPoint:{x:100,y:80}})];
  const saved=normalize(JSON.parse(JSON.stringify(project)));
  const run=new Simulation(saved,'test');
  assert.equal(run.issues.size,2);
  assert.deepEqual(run.advance().values,{});
});

test('invalid IDs or absent/nonfinite free positions still fail normalization',()=>{
  for (const props of [{},{sourcePoint:{x:NaN,y:10}},{sourcePoint:{x:10,y:Infinity}}]) {
    const project=diagram();project.edges=[makeEdge('flow','','b',props)];
    assert.throws(()=>normalize(project),/missing endpoint/);
  }
  const project=diagram();project.edges=[makeEdge('flow','missing','b',{sourcePoint:{x:0,y:0}})];
  assert.throws(()=>normalize(project),/missing endpoint/);
});

test('free endpoints are drawn at their saved position without the node inset',()=>{
  const shape=importedEdgeShape({routing:'straight',points:[],label:null},{x:0,y:0,r:28},{x:100,y:0,r:0});
  assert.equal(shape.d,'M 28 0 L 100 0');
  assert.deepEqual(shape.end,{x:100,y:0});
});

test('disconnected flows and State links are reported and skipped safely by the simulator',()=>{
  const project=diagram();
  project.edges=[makeEdge('flow','a','',{id:'f',targetPoint:{x:100,y:100}}),
    makeEdge('state','a','',{id:'s',mode:'add',targetPoint:{x:130,y:100}})];
  const run=new Simulation(project,'test');
  assert.equal(run.issues.size,2);assert.equal(run.flow.length,0);assert.equal(run.states.length,0);
  assert.equal(run.advance().values.b,5);
});

test('State links attached to incomplete connections are skipped until the connection is repaired',()=>{
  const project=diagram();
  const flow=makeEdge('flow','a','',{id:'f',formula:'3',targetPoint:{x:100,y:100}});
  project.edges=[flow,makeEdge('state','a','f',{id:'s',mode:'overwrite'})];
  let status=connectionStatus(project);
  assert.equal(status.connected.size,0);assert.equal(status.issues.length,2);
  assert.ok(status.issues.some(issue=>issue.includes('incomplete')));
  flow.target='b';flow.targetPoint=null;
  status=connectionStatus(project);
  assert.equal(status.connected.size,2);assert.deepEqual(status.issues,[]);
  assert.equal(new Simulation(project,'test').issues.size,0);
});

test('endpoint drops accept nodes for flows and permit other connections only for State links',()=>{
  const project=diagram();project.nodes.push(makeNode('text',{id:'text'}));
  const flow=makeEdge('flow','a','b',{id:'f'}), state=makeEdge('state','a','b',{id:'s'});
  project.edges=[flow,state];
  assert.equal(canAttachEndpoint(project,flow,'target','node','b'),true);
  assert.equal(canAttachEndpoint(project,flow,'target','node','a'),true);
  assert.equal(canAttachEndpoint(project,flow,'target','node','text'),false);
  assert.equal(canAttachEndpoint(project,flow,'target','edge','s'),false);
  assert.equal(canAttachEndpoint(project,state,'target','edge','f'),true);
  assert.equal(canAttachEndpoint(project,state,'target','edge','missing'),false);
});

test('State link drops prevent self references, duplicate edge anchors and dependency cycles',()=>{
  const project=diagram();
  const flow=makeEdge('flow','a','b',{id:'f'}), state=makeEdge('state','a','f',{id:'s'});
  project.edges=[flow,state,makeEdge('state','b','s',{id:'dependent'})];
  assert.equal(canAttachEndpoint(project,state,'source','edge','s'),false);
  assert.equal(canAttachEndpoint(project,state,'source','edge','f'),false);
  assert.equal(canAttachEndpoint(project,state,'source','edge','dependent'),false);
  assert.equal(canAttachEndpoint(project,state,'target','edge','f'),true);
});

test('imported cyclic connection references are diagnosed instead of recursing or crashing',()=>{
  const project=diagram();
  project.edges=[makeEdge('state','a','s2',{id:'s1',mode:'overwrite'}),makeEdge('state','b','s1',{id:'s2',mode:'overwrite'})];
  const run=new Simulation(normalize(project),'test');
  assert.equal(run.states.length,0);assert.equal(run.issues.size,2);
  assert.doesNotThrow(()=>run.advance());
});

test('resource pulls from a node without resource stock do not crash after reconnecting',()=>{
  const project=diagram();project.nodes[0]=makeNode('register',{id:'a',initial:'9'});project.nodes[1].trigger='auto';
  project.edges=[makeEdge('flow','a','b',{id:'f'})];
  const run=new Simulation(project,'test');
  assert.equal(run.advance().values.b,5);
});
