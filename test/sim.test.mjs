import test from 'node:test';
import assert from 'node:assert/strict';
import {blank, example, makeNode, makeEdge, makeResource, normalize} from '../public/model.mjs';
import {compile, seeded} from '../public/formula.mjs';
import {Simulation} from '../public/sim.mjs';
import {diagramId} from '../server.mjs';

const node=(type,id,props={})=>makeNode(type,{id,label:id,...props});
const flow=(from,to,formula='1',props={})=>makeEdge('flow',from,to,{formula,...props});
const state=(from,to,mode,formula,props={})=>makeEdge('state',from,to,{mode,formula,...props});
function model(nodes,edges) {return {...blank(),nodes,edges};}
function values(sim,id,steps) {
  return Array.from({length:steps},()=>sim.advance().values[id]);
}
test('formula precedence, comparisons, short circuit and dice',()=>{
  const scope=new Map([['v',5]]);
  assert.equal(compile('round(-2^2 + 2^3^2 + v / 2, 1)')(scope,Math.random),510.5);
  assert.equal(compile('v ≥ 3 and v <= 5 ? 10 : unknown')(scope,Math.random),10);
  assert.equal(compile('1d8 + D4')(scope,()=>0),2);
  assert.throws(()=>compile('evaluate(1)'),/Unsupported function/);
  assert.throws(()=>compile('evil(1)'),/Unsupported/);
});

test('fix rounds to the nearest integer and mod uses mathematical modulo',()=>{
  const evaluate=formula=>compile(formula)(new Map(),()=>0.9);
  assert.equal(evaluate('fix(3.7)'),4);
  assert.equal(evaluate('fix(-3.7)'),-4);
  assert.equal(evaluate('randomInt(1,fix(3.8))'),3);
  assert.equal(evaluate('mod(11,3)'),2);
  assert.equal(evaluate('mod(-5,3)'),1);
  assert.equal(evaluate('-5 mod 3'),1);
  assert.equal(evaluate('mod(11,0)'),11);
});

test('non-finite formulas return zero while expression errors still report issues',()=>{
  const data=model([
    node('register','register',{initial:'9',formula:'7 / (step - 1)'}),
    node('register','nan',{formula:'floor(0 / 0)'}),
  ],[]);
  const run=new Simulation(data);
  assert.deepEqual(values(run,'register',2),[0,7]);
  assert.equal(run.value('nan'),0);
  assert.equal(run.expr('-1 / 0',6),0);
  assert.equal(run.expr('Infinity',6),0);
  assert.equal(run.expr('NaN',6),0);
  assert.equal(run.issues.size,0);
  assert.equal(run.expr('missingVariable',6),6);
  assert.match([...run.issues][0],/Unknown variable missingVariable/);
});

test('passive registers hold their value while auto registers evaluate once per step',()=>{
  const data=model([
    node('register','passive',{formula:'random()'}),
    node('register','auto',{formula:'random()',trigger:'auto'}),
  ],[]);
  const run=new Simulation(data);
  const initial=run.history[0].values.passive;
  let calls=0;
  run.rng=()=>++calls/10;
  const frames=Array.from({length:3},()=>run.advance().values);
  assert.deepEqual(frames.map(e=>e.passive),[initial,initial,initial]);
  assert.deepEqual(frames.map(e=>e.auto),[0.1,0.2,0.3]);
  assert.equal(calls,3);
});

test('passive registers react to linked inputs including an unused alias without rerolling on feedback',()=>{
  const data=model([
    node('source','tick'),node('pool','level',{initial:'1'}),
    node('pool','strength',{initial:'10'}),
    node('register','enemy',{formula:'s * random(1.2,1.3)'}),
  ],[
    flow('tick','level','step == 3 ? 1 : 0'),
    flow('tick','strength','step == 5 ? 1 : 0'),
    state('strength','enemy','input','s'),
    state('level','enemy','input','_'),
    state('enemy','strength','overwrite',''),
  ]);
  const run=new Simulation(data);
  const initial=run.history[0].values.enemy;
  let calls=0;
  run.rng=()=>{calls++;return 0.5;};
  const enemy=values(run,'enemy',6);
  assert.deepEqual(enemy.slice(0,2),[initial,initial]);
  assert.notEqual(enemy[2],initial);
  assert.equal(enemy[3],enemy[2]);
  assert.ok(enemy[4]>enemy[3]);
  assert.equal(enemy[5],enemy[4]);
  assert.equal(calls,2);
});

test('passive registers track named formula inputs and keep explicit feedback stable',()=>{
  const data=model([
    node('pool','strength',{label:'Enemy Strength',initial:'10'}),
    node('pool','other',{label:'Other',initial:'2'}),
    node('register','enemy',{formula:'enemy_strength.runtime + other'}),
  ],[state('enemy','strength','overwrite','')]);
  const run=new Simulation(data);
  assert.deepEqual(values(run,'enemy',2),[12,12]);
  run.stocks.get('other').set('default',3);
  assert.deepEqual(values(run,'enemy',2),[15,15]);
});

test('an activator gates an overwrite of another connection',()=>{
  const data=model([
    node('source','s'),node('pool','p'),node('register','value',{formula:'4'}),
    node('register','control',{formula:'step - 1'}),
  ],[
    flow('s','p','1',{id:'transfer'}),
    state('value','transfer','overwrite','1',{id:'overwrite'}),
    state('control','overwrite','enable','> 0'),
  ]);
  const run=new Simulation(data);
  assert.deepEqual(values(run,'p',3),[1,5,9]);
});

test('a register with an enable condition only sends outputs while the condition holds',()=>{
  const data=model([
    node('source','s'),node('pool','p'),
    node('register','level',{formula:'step == 2 ? 5 : 4'}),
    node('register','spawn',{formula:'step + 6'}),
    node('register','dependent',{formula:'a + 1'}),
  ],[
    flow('s','p','0',{id:'transfer'}),
    state('level','spawn','enable','>= 5'),
    state('spawn','transfer','overwrite','',{id:'overwrite'}),
    state('spawn','dependent','input','a',{id:'input'}),
  ]);
  const run=new Simulation(data);
  const frames=Array.from({length:3},()=>{
    const {values}=run.advance();
    return [values.spawn,values.p,values.dependent,run.edgeOverwrites.get('transfer'),
      [...run.disabledRegisterOutputs]];
  });
  assert.deepEqual(frames,[
    [7,0,1,undefined,['overwrite','input']],
    [8,8,9,8,[]],
    [9,8,1,undefined,['overwrite','input']],
  ]);
  assert.equal(run.issues.size,0);
});

test('overwrite copies a changing origin to pools and calculated registers',()=>{
  const data=model([
    node('register','origin',{formula:'step == 2 ? 0 : step + 6'}),
    node('pool','pool',{initial:'80'}),
    node('register','register',{formula:'99'}),
  ],[
    state('origin','pool','overwrite',''),
    state('origin','register','overwrite',''),
  ]);
  data.edges[0].formula='3';
  const imported=normalize(data);
  assert.equal(imported.edges[0].formula,'');
  const run=new Simulation(imported);
  assert.equal(run.value('pool'),80);
  const pairs=Array.from({length:3},()=>{
    const {values}=run.advance();
    return [values.pool,values.register];
  });
  assert.deepEqual(pairs,[[7,7],[0,0],[9,9]]);
});

test('an overwritten resource connection uses the origin without evaluating the old rate',()=>{
  const data=model([
    node('source','s'),node('pool','p'),
    node('register','amount',{formula:'step == 2 ? 0 : step + 4'}),
  ],[
    flow('s','p','unknownFunction(1)',{id:'transfer'}),
    state('amount','transfer','overwrite',''),
  ]);
  const run=new Simulation(data);
  assert.deepEqual(values(run,'p',3),[5,5,12]);
  assert.equal(run.issues.size,0);
});

test('overwrite replaces a register input value while its activator holds',()=>{
  const data=model([
    node('register','original',{formula:'9'}),
    node('register','replacement',{formula:'step == 1 ? 0 : 6'}),
    node('register','result',{formula:'m + 2'}),
    node('pool','maxHealth',{label:'Player Max Health',initial:'60'}),
    node('register','control',{formula:'step <= 2 ? 100 : 0'}),
  ],[
    state('original','result','input','m',{id:'input'}),
    state('replacement','input','overwrite','',{id:'overwrite'}),
    state('control','overwrite','enable','> 0.25*player_max_health.runtime'),
  ]);
  const run=new Simulation(data);
  const frames=Array.from({length:3},()=>{
    const {values}=run.advance();
    return [values.result,run.edgeOverwrites.get('input')];
  });
  assert.deepEqual(frames,[[2,0],[8,6],[11,undefined]]);
  assert.equal(run.issues.size,0);
});

test('overwrite replaces the comparison threshold while preserving its operator',()=>{
  const data=model([
    node('source','s'),node('pool','p'),node('pool','stock',{initial:'5'}),
    node('register','threshold',{formula:'step == 1 ? 3 : 7'}),
  ],[
    flow('s','p','2',{id:'transfer'}),
    state('stock','transfer','enable','> 10',{id:'comparison'}),
    state('threshold','comparison','overwrite',''),
  ]);
  assert.deepEqual(values(new Simulation(data),'p',2),[2,2]);
});

test('a named pool runtime can limit capacity and gate an overwrite',()=>{
  const data=model([
    node('source','s'),node('pool','p',{capacity:'player_max_health.runtime'}),
    node('pool','maxHealth',{label:'Player Max Health',initial:'60'}),
    node('register','value',{formula:'80'}),
  ],[
    flow('s','p','20',{id:'transfer'}),
    state('value','transfer','overwrite','1',{id:'overwrite'}),
    state('p','overwrite','enable','> 0.25*player_max_health.runtime'),
  ]);
  const run=new Simulation(data);
  assert.deepEqual(values(run,'p',2),[20,60]);
  assert.equal(run.issues.size,0);
});

test('example advances without errors',()=>{
  const run=new Simulation(example());
  assert.deepEqual(values(run,'stock',4),[5,6,7,8]);
  assert.deepEqual(run.history.map(x=>x.values.shelf),[0,1,2,3,2]);
  assert.equal(run.issues.size,0);
});

test('fixed steps, capacity and interval on a source',()=>{
  const run=new Simulation(model([node('source','s'),node('pool','p',{capacity:'5'})],[flow('s','p','3',{interval:'2'})]));
  assert.deepEqual(values(run,'p',6),[0,3,3,5,5,5]);
});

test('all-or-nothing pull reserves stock across input edges',()=>{
  const run=new Simulation(model([
    node('pool','stock',{initial:'5'}),node('pool','other',{initial:'2'}),
    node('sink','sink',{trigger:'auto',all:true}),
  ],[flow('stock','sink','3'),flow('other','sink','3')]));
  assert.equal(run.advance().values.stock,5);
  assert.equal(run.value('other'),2);
  assert.equal(run.events.length,0);
});

test('an automatic drain triggers once per draining step and rolls chance only then',()=>{
  const run=new Simulation(model([
    node('pool','damage',{initial:'7'}),node('pool','empty'),node('sink','drain',{trigger:'auto'}),
    node('source','refill',{trigger:'auto'}),node('source','food',{trigger:'passive'}),
    node('source','ammo',{trigger:'passive'}),node('pool','shop'),
  ],[
    flow('damage','drain','all',{condition:'step >= 2'}),flow('empty','drain','all',{condition:'step >= 2'}),
    flow('refill','damage','3',{condition:'step == 4'}),flow('food','shop'),flow('ammo','shop'),
    state('drain','food','trigger','*',{id:'food-trigger'}),
    state('drain','ammo','trigger','33',{id:'ammo-trigger',triggerOn:'chance'}),
  ]));
  const rolls=[0.329,0.33];
  let count=0;
  run.rng=()=>rolls[count++];
  const active=Array.from({length:7},()=>{
    run.advance();
    return ['food-trigger','ammo-trigger'].filter(id=>run.activeEdges.has(id));
  });
  assert.deepEqual(active,[[],['food-trigger','ammo-trigger'],[],[],['food-trigger'],[],[]]);
  assert.equal(count,2);
  assert.deepEqual(run.history.map(t=>t.values.shop),[0,0,0,2,2,2,3,3]);
});

test('gain and loss triggers distinguish resource types and register value changes',()=>{
  const data=model([
    node('pool','stock',{initialResources:[{resource:'gold',value:'1'}]}),
    node('source','source',{resource:'gold',trigger:'start'}),node('sink','sink',{trigger:'auto'}),
    node('register','score',{formula:'2 - stock',trigger:'auto'}),node('source','target',{trigger:'passive'}),
  ],[
    flow('source','stock'),flow('stock','sink','1',{condition:'step == 2'}),
    state('stock','target','trigger','*',{id:'gain',triggerOn:'gain',resource:'gold'}),
    state('stock','target','trigger','*',{id:'loss',triggerOn:'loss',resource:'gold'}),
    state('stock','target','trigger','*',{id:'wrong',triggerOn:'gain',resource:'silver'}),
    state('score','target','trigger','*',{id:'score-down',triggerOn:'loss'}),
    state('score','target','trigger','*',{id:'score-up',triggerOn:'gain'}),
  ]);
  data.resources.push(makeResource('Gold','#bbaa00','gold'),makeResource('Silver','#bbbbbb','silver'));
  const run=new Simulation(normalize(data));
  const active=()=>[...run.activeEdges].filter(id=>run.edges.get(id).type==='state');
  run.advance();
  assert.deepEqual(active(),['gain']);
  run.advance();
  assert.deepEqual(active(),['loss','score-down']);
  run.advance();
  assert.deepEqual(active(),['score-up']);
  run.advance();
  assert.deepEqual(active(),[]);
});

test('failed action detects an unsatisfied pull and legacy trigger settings survive reload',()=>{
  const data=model([
    node('pool','stock',{initial:'1'}),node('sink','drain',{trigger:'auto',all:true}),
    node('source','target',{trigger:'passive'}),
  ],[
    flow('stock','drain','2',{condition:'step > 1'}),
    {id:'failure',type:'state',source:'drain',target:'target',mode:'reverse'},
    {id:'chance',type:'state',source:'drain',target:'target',mode:'trigger',formula:'33'},
  ]);
  const project=normalize(JSON.parse(JSON.stringify(normalize(data))));
  assert.deepEqual(project.edges.slice(1).map(e=>[e.mode,e.triggerOn,e.formula]),[
    ['trigger','failed','*'],['trigger','chance','33'],
  ]);
  const run=new Simulation(project);
  run.advance();
  assert.equal(run.activeEdges.size,0);
  run.advance();
  assert.deepEqual([...run.activeEdges],['failure']);
  assert.equal(run.value('stock'),1);
});

test('buffer releases on arrival plus configured delay, and a queue serializes releases',()=>{
  for (const type of ['delay','queue']) {
    const run=new Simulation(model([
      node('source','s',{trigger:'start'}),node(type,'wait',{direction:'push'}),node('pool','p'),
    ],[flow('s','wait','2'),flow('wait','p','2')]));
    assert.deepEqual(values(run,'p',5),type==='delay'?[0,0,2,2,2]:[0,0,1,1,2]);
  }
});
test('condition that targets a resource connection can use a register input',()=>{
  const tx=flow('s','p','2',{id:'flow'});
  const run=new Simulation(model([
    node('source','s'),node('pool','p'),node('register','r',{formula:'step^2'}),
    node('register','limit',{formula:'9'}),
  ],[tx,state('r','flow','enable','>= threshold',{id:'conditional'}),
    state('limit','conditional','input','threshold')]));
  assert.deepEqual(values(run,'p',5),[0,0,2,4,6]);
  assert.equal(run.issues.size,0);
});
test('weighted sorting gate and conversion use the same step',()=>{
  const moss=makeResource('Moss','#123456','moss'), fuel=makeResource('Fuel','#123456','fuel');
  const data=model([
    node('source','s',{resource:'moss',trigger:'start'}),node('gate','g'),
    node('pool','a'),node('converter','b',{resource:'fuel'}),node('pool','p'),
  ],[flow('s','g','8'),flow('g','a','1'),flow('g','b','3'),flow('b','p','1')]);
  data.resources.push(moss,fuel);
  const run=new Simulation(normalize(data));
  const result=run.advance();
  assert.equal(result.values.a,2);
  assert.deepEqual(result.resources.p,{fuel:1});
});
test('resource filter, modifiers, triggers and end condition',()=>{
  const data=model([
    node('source','s',{trigger:'start',resource:'a'}),node('pool','p',{initial:'1',resource:'a'}),
    node('source','s2',{trigger:'passive',resource:'b'}),node('pool','output',{resourceFilter:['b']}),
    node('pool','score'),node('end','stop'),
  ],[flow('s','p'),flow('s2','output','2'),state('p','s2','trigger','*'),state('p','score','add','+2'),
    state('output','stop','enable','>= 2')]);
  data.resources.push(makeResource('A','#123456','a'),makeResource('B','#123456','b'));
  const run=new Simulation(normalize(data));
  assert.equal(run.advance().values.score,2);
  const final=run.advance();
  assert.equal(final.values.score,4);
  assert.deepEqual(final.resources.output,{b:2});
  assert.equal(run.ended,'stop');
  assert.equal(run.advance().step,2);
});
test('same seed produces same stochastic history',()=>{
  const diagram=model([node('source','s'),node('pool','p')],[flow('s','p','2D6')]);
  const a=values(new Simulation(diagram,'A'),'p',20), b=values(new Simulation(diagram,'A'),'p',20);
  assert.deepEqual(a,b);
  assert.notDeepEqual(a,values(new Simulation(diagram,'B'),'p',20));
  assert.equal(seeded('a')(),seeded('a')());
});
test('public URLs are validated before constructing a fixed-host request',()=>{
  const id='c7d816ec919c11f189880abc5ce0dcc9';
  assert.equal(diagramId('https://my.machinations.io/d/diagram/'+id+'?hideHeaderbar=true'),id);
  assert.equal(diagramId('https://my.machinations.io/e/'+id),id);
  for (const url of ['http://127.0.0.1/', 'https://example.com/d/test/'+id, 'https://name@my.machinations.io/d/test/'+id]) {
    assert.throws(()=>diagramId(url),/HTTPS Machinations/);
  }
});

