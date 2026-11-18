import test from 'node:test';
import assert from 'node:assert/strict';
import {blank, makeNode, makeEdge, makeResource, normalize} from '../public/model.mjs';
import {stateLinkColor, importedColor, componentColor, setColorPreset, setCustomColor, setResourceColor} from '../public/colors.mjs';

function projectWithColors() {
  const project=blank();
  project.resources.push(makeResource('Enemies','#ee4455','enemies'),makeResource('Allies','#4488ee','allies'));
  project.nodes=[makeNode('register',{id:'r'}),makeNode('pool',{id:'p'})];
  project.edges=[makeEdge('state','r','p',{id:'s'})];
  return project;
}

test('imported XML and computed SVG colours normalize to picker-compatible hex values',()=>{
  for (const [value,expected] of [
    ['#2196F3','#2196f3'],['#abc','#aabbcc'],['rgb(33, 150, 243)','#2196f3'],
    ['rgb(100% 0% 50%)','#ff007f'],['rgba(33, 150, 243, 1)','#2196f3'],
    ['rgba(0, 0, 0, 0)',''],['none',''],['url(https://invalid)',''],
  ]) assert.equal(importedColor(value),expected);
});

test('State links use neutral graphite grey when no custom colour or preset is set',()=>{
  const project=projectWithColors();
  assert.equal(componentColor(project.edges[0],project.resources,stateLinkColor),'#7b818a');
});

test('resource colour changes update bound Registers and State links without changing custom colours',()=>{
  const project=projectWithColors(), resource=project.resources.find(r=>r.id==='enemies');
  const register=project.nodes[0], link=project.edges[0];
  setColorPreset([register,link],resource);
  const custom=makeNode('register',{id:'custom'});
  setCustomColor([custom],resource.color);project.nodes.push(custom);
  setResourceColor(project,resource,'#11aa22');
  assert.equal(register.color,'#11aa22');assert.equal(link.color,'#11aa22');
  assert.equal(componentColor(link,project.resources),'#11aa22');
  assert.equal(custom.color,'#ee4455');assert.equal(custom.colorResource,'');
  const saved=normalize(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.nodes[0].colorResource,'enemies');assert.equal(saved.edges[0].colorResource,'enemies');
  setResourceColor(saved,saved.resources.find(r=>r.id==='enemies'),'#334455');
  assert.equal(saved.nodes[0].color,'#334455');assert.equal(saved.edges[0].color,'#334455');
  assert.equal(saved.nodes.find(n=>n.id==='custom').color,'#ee4455');
});

test('resource IDs distinguish presets with identical colours',()=>{
  const project=projectWithColors();
  project.resources.find(r=>r.id==='allies').color='#ee4455';
  setColorPreset([project.nodes[0]],project.resources.find(r=>r.id==='enemies'));
  setColorPreset([project.edges[0]],project.resources.find(r=>r.id==='allies'));
  const saved=normalize(JSON.parse(JSON.stringify(project)));
  setResourceColor(saved,saved.resources.find(r=>r.id==='allies'),'#123456');
  assert.equal(saved.nodes[0].color,'#ee4455');assert.equal(saved.edges[0].color,'#123456');
});

test('older saved hex presets migrate only when the matching resource is unambiguous',()=>{
  const project=projectWithColors();
  for (const item of [project.nodes[0],project.edges[0]]) {item.color='#EE4455';delete item.colorResource;}
  const migrated=normalize(project);
  assert.equal(migrated.nodes[0].colorResource,'enemies');assert.equal(migrated.edges[0].colorResource,'enemies');
  project.resources.push(makeResource('Another red','#ee4455','other'));
  assert.equal(normalize(project).edges[0].colorResource,'');
  project.edges[0].colorResource='';
  assert.equal(normalize(project).edges[0].colorResource,'');
});

test('missing preset resources fall back to the saved colour and existing bindings refresh stale cached colours',()=>{
  const project=projectWithColors();
  Object.assign(project.edges[0],{color:'#123456',colorResource:'missing'});
  Object.assign(project.nodes[0],{color:'#123456',colorResource:'enemies'});
  const saved=normalize(project);
  assert.equal(saved.edges[0].colorResource,'');assert.equal(saved.edges[0].color,'#123456');
  assert.equal(saved.nodes[0].color,'#ee4455');
});
