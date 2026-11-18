import {normalizeRoute, point} from './geometry.mjs';
import {normalizeAppearance} from './colors.mjs';

export const kinds = {
  source: 'Source', pool: 'Pool', sink: 'Sink', gate: 'Gate', converter: 'Converter',
  register: 'Register', delay: 'Delay', queue: 'Queue', end: 'End condition',
  trader: 'Trader', text: 'Text', unknown: 'Unknown node',
};
export const stateKinds = {
  enable: 'Enable while', trigger: 'Trigger', triggerIf: 'Trigger if',
  input: 'Register input', add: 'Add modifier', multiply: 'Multiply modifier', overwrite: 'Overwrite',
  split: 'Split trigger', unsupported: 'Unsupported',
};
export const triggerModes = {
  change: 'Any change', chance: 'Chance', gain: 'Gain', loss: 'Loss', failed: 'Failed action',
};
export const palette = ['#55d9ad', '#a692ff', '#fbc87a', '#6baaff', '#f38a9f', '#62d3e8', '#bbc3d4'];
export const fallback = 'default';
const id = prefix => prefix + crypto.randomUUID().slice(0, 12);
const object = value => value && typeof value === 'object' ? value : {};
const string = (value, defaultValue = '') => value == null ? defaultValue : String(value);
const number = (value, defaultValue = 0) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : defaultValue;
const choice = (value, values, defaultValue) => values.includes(value) ? value : defaultValue;
export const color = (value, otherwise = palette[0]) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : otherwise;

export function makeNode(type, props = {}) {
  const node = {
    id: id('n'), type, label: kinds[type], x: 0, y: 0, color: '', colorResource: '', resource: fallback,
    trigger: type === 'source' ? 'auto' : 'passive',
    direction: ['source', 'delay', 'queue'].includes(type) ? 'push' : 'pull',
    all: false, initial: '0', capacity: '', min: '', max: '', formula: '', condition: '',
    overflow: 'block', distribution: 'deterministic', conversion: 'single',
    resourceFilter: [], stepValue: '1', initialResources: [], ignoreDisabled: true, note: '',
  };
  return { ...node, ...props };
}

export function makeEdge(type, source, target, props = {}) {
  const edge = {
    id: id('e'), type, source, target, label: '', color: '', colorResource: '', formula: type === 'state' ? '> 0' : '1',
    condition: '', mode: 'enable', chanceAmount: '1', interval: '1', transfer: 'interval',
    decimals: false, min: '', max: '', resource: '', shuffle: false, bend: 0, labelPosition: null, note: '', ...props,
  };
  if (edge.type==='state' && edge.mode==='overwrite') edge.formula='';
  if (edge.type==='state' && (edge.mode==='trigger' || edge.mode==='reverse')) {
    // Older saves stored imported chance percentages as the trigger formula.
    const formula = String(props.formula ?? '').trim();
    edge.triggerOn = edge.mode==='reverse' ? 'failed' : Object.hasOwn(triggerModes,props.triggerOn) ? props.triggerOn :
      formula==='!' ? 'failed' : /^\d+(?:\.\d+)?%?$/.test(formula) ? 'chance' : 'change';
    edge.mode = 'trigger';
    edge.formula = edge.triggerOn==='chance' ? formula.replace(/%$/,'') || '0' : '*';
  }
  return edge;
}

export const makeResource = (name, tint, resourceId = id('r')) => ({id: resourceId, name, color: tint});

export function blank(title = 'Untitled diagram') {
  return {
    version: 1, title, steps: 30,
    resources: [makeResource('Default', palette[6], fallback)],
    nodes: [], edges: [], variables: [], warnings: [],
  };
}

export function normalize(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw Error('This file does not contain a Resource Flow project.');
  if (raw.nodes.length > 4000 || raw.edges.length > 8000) throw Error('This diagram exceeds the supported canvas size.');
  const project = blank(string(raw.title, 'Untitled diagram'));
  project.steps = Math.max(1, Math.min(9999, Math.floor(number(raw.steps, 30))));
  const ids = new Set();
  const takeId = value => {
    const key = string(value);
    if (!key || ids.has(key)) throw Error('The diagram contains a missing or duplicate component ID.');
    ids.add(key);
    return key;
  };
  if (Array.isArray(raw.resources)) {
    const unique = new Set();
    project.resources = raw.resources.map(item => {
      const r = object(item);
      const key = string(r.id);
      if (!key || unique.has(key)) throw Error('The diagram contains a missing or duplicate resource ID.');
      unique.add(key);
      return makeResource(string(r.name, 'Resource'), color(r.color), key);
    });
    if (!unique.has(fallback)) project.resources.unshift(makeResource('Default', palette[6], fallback));
  }
  const resourceIds = new Set(project.resources.map(r => r.id));
  project.nodes = raw.nodes.map(item => {
    const n = object(item);
    const type = Object.hasOwn(kinds, n.type) ? n.type : 'unknown';
    return makeNode(type, {
      id: takeId(n.id), label: string(n.label, kinds[type]), x: number(n.x), y: number(n.y),
      labelOffset:point(n.labelOffset),
      resource: resourceIds.has(n.resource) ? n.resource : fallback, ...normalizeAppearance(n,project.resources,type==='register'),
      trigger: choice(n.trigger, ['auto','passive','click','enable','start','agent'], 'passive'),
      direction: choice(n.direction, ['push','pull'], type === 'source' ? 'push' : 'pull'),
      all: !!n.all, initial: string(n.initial, '0'), capacity: string(n.capacity), min: string(n.min),
      max: string(n.max), formula: string(n.formula), condition: string(n.condition), note: string(n.note),
      overflow: choice(n.overflow, ['block','sink'], 'block'), distribution: choice(n.distribution, ['deterministic','random'], 'deterministic'),
      conversion: choice(n.conversion, ['single','multiple'], 'single'), stepValue: string(n.stepValue, '1'),
      ignoreDisabled: n.ignoreDisabled !== false,
      resourceFilter: Array.isArray(n.resourceFilter) ? n.resourceFilter.filter(x => resourceIds.has(x)) : [],
      initialResources: Array.isArray(n.initialResources) ? n.initialResources.filter(x => resourceIds.has(x?.resource)).map(x => ({resource:x.resource, value:string(x.value,'0')})) : [],
    });
  });
  project.edges = raw.edges.map(item => {
    const e = object(item);
    const type = e.type === 'state' ? 'state' : 'flow';
    return makeEdge(type, string(e.source), string(e.target), {
      id: takeId(e.id), label: string(e.label), ...normalizeAppearance(e,project.resources,type==='state'), formula: string(e.formula, type === 'state' ? '> 0' : '1'),
      mode: Object.hasOwn(stateKinds, e.mode) || e.mode==='reverse' ? e.mode : 'enable', condition: string(e.condition),
      triggerOn: e.triggerOn,
      interval: string(e.interval, '1'), transfer: choice(e.transfer, ['interval','instant'], 'interval'),
      chanceAmount: string(e.chanceAmount, '1'), decimals: !!e.decimals, min: string(e.min), max: string(e.max),
      resource: resourceIds.has(e.resource) ? e.resource : '', shuffle: !!e.shuffle, bend: number(e.bend),
      labelPosition:Number.isFinite(e.labelPosition)?Math.max(0,Math.min(1,e.labelPosition)):null,
      route:normalizeRoute(e.route), note: string(e.note),
    });
  });
  for (const edge of project.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw Error('Connection ' + edge.id + ' has a missing endpoint.');
  }
  project.variables = Array.isArray(raw.variables) ? raw.variables.map(v => ({
    name: string(v?.name), formula: string(v?.formula, '0'),
  })) : [];
  project.warnings = Array.isArray(raw.warnings) ? raw.warnings.map(String) : [];
  project.origin = string(raw.origin);
  return project;
}

export function example() {
  const project = blank('Potion workshop');
  const herb = makeResource('Herbs', palette[0], 'herbs');
  const potion = makeResource('Potions', palette[1], 'potions');
  project.resources.push(herb, potion);
  project.nodes = [
    makeNode('source', {id:'garden', label:'Herb garden', x:90,y:145,resource:herb.id}),
    makeNode('pool', {id:'stock', label:'Herb stock', x:287,y:145,resource:herb.id, initial:'4',capacity:'50'}),
    makeNode('converter', {id:'brew', label:'Brew potion', x:475,y:145,resource:potion.id,trigger:'auto'}),
    makeNode('pool', {id:'shelf', label:'Potion shelf', x:662,y:145,resource:potion.id,initial:'0',capacity:'25'}),
    makeNode('sink', {id:'orders', label:'Customer orders', x:662,y:330,resource:potion.id,trigger:'auto'}),
    makeNode('register', {id:'target', label:'Order threshold', x:445,y:330,formula:'3'}),
  ];
  project.edges = [
    makeEdge('flow','garden','stock',{id:'grow',formula:'3'}),
    makeEdge('flow','stock','brew',{id:'ingredients',formula:'2'}),
    makeEdge('flow','brew','shelf',{id:'bottles',formula:'1'}),
    makeEdge('flow','shelf','orders',{id:'sell',formula:'2',interval:'2'}),
    makeEdge('state','shelf','orders',{id:'minimum',formula:'>= threshold',bend:-108}),
    makeEdge('state','target','minimum',{id:'goal',mode:'input',formula:'threshold'}),
  ];
  return project;
}

export const variableName = label => String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g,'');

