import test from 'node:test';
import assert from 'node:assert/strict';
import {blank, makeNode, makeEdge, normalize} from '../public/model.mjs';
import {toggleItem, commonProperty, setProperty} from '../public/selection.mjs';

test('Ctrl-click selection toggles objects without replacing or mutating the remaining selection',()=>{
  const node={kind:'node',id:'a'}, edge={kind:'edge',id:'b'};
  const initial=[node], selected=toggleItem(initial,edge);
  assert.deepEqual(selected,[node,edge]);
  assert.deepEqual(initial,[node]);
  assert.deepEqual(toggleItem(selected,node),[edge]);
  assert.deepEqual(toggleItem([node],node),[]);
  assert.deepEqual(toggleItem(initial,{kind:'edge',id:'a'}),[node,{kind:'edge',id:'a'}]);
});

test('bulk property controls distinguish shared values from differing values and compare resource stacks by value',()=>{
  const items=[
    {label:'Swordsman Spawner',resource:'enemies',trigger:'auto',initialResources:[{resource:'enemies',value:'3'}]},
    {label:'Gunman Spawner',resource:'enemies',trigger:'auto',initialResources:[{resource:'enemies',value:'3'}]},
    {label:'Brute Spawner',resource:'enemies',trigger:'auto',initialResources:[{resource:'enemies',value:'5'}]},
  ];
  assert.equal(commonProperty(items,'label'),false);
  assert.equal(commonProperty(items,'resource'),true);
  assert.equal(commonProperty(items,'trigger'),true);
  assert.equal(commonProperty(items,'initialResources'),false);
  assert.equal(commonProperty(items.slice(0,2),'initialResources'),true);
  assert.equal(commonProperty([],'resource'),false);
});

test('bulk edits copy array values separately for every selected object',()=>{
  const nodes=[makeNode('pool'),makeNode('pool')], value=[{resource:'enemies',value:'3'}];
  setProperty(nodes,'initialResources',value);
  assert.equal(commonProperty(nodes,'initialResources'),true);
  nodes[0].initialResources[0].value='9';
  assert.equal(nodes[1].initialResources[0].value,'3');
  assert.equal(value[0].value,'3');
});

test('Register and State link colours survive saving and reject invalid colours',()=>{
  const project=blank();
  project.nodes=[makeNode('register',{id:'r',color:'#12ab34'}),makeNode('pool',{id:'p'})];
  project.edges=[makeEdge('state','r','p',{color:'#ee4455'})];
  const saved=normalize(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.nodes[0].color,'#12ab34');
  assert.equal(saved.edges[0].color,'#ee4455');
  project.nodes[0].color='url(invalid)';project.edges[0].color='red';
  const invalid=normalize(project);
  assert.equal(invalid.nodes[0].color,'');
  assert.equal(invalid.edges[0].color,'');
  delete project.edges[0].color;
  assert.equal(normalize(project).edges[0].color,'');
});
