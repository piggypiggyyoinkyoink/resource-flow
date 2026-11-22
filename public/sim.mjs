import {compile, comparison, seeded} from './formula.mjs';
import {fallback, variableName} from './model.mjs';

const sum = map => [...map.values()].reduce((total,n)=>total+n,0);
const add = (map,key,n) => {
  const value = (map.get(key)||0)+n;
  map.delete(key);
  if (Math.abs(value) > 1e-9) map.set(key,value);
};
const by = (items,key) => {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item[key])) map.set(item[key],[]);
    map.get(item[key]).push(item);
  }
  return map;
};
const holdings = new Set(['pool','converter','delay','queue']);
const clean = n => Number(n.toPrecision(12));
const tickTypes = new Set(['source','pool','sink','gate','converter','delay','queue','register','end']);

export class Simulation {
  constructor(project, seed=null, {retainHistory=true}={}) {
    this.project = project;
    this.rng = seed==null||String(seed).trim()===''?Math.random:seeded(seed);
    this.retainHistory = retainHistory;
    this.step = 0;
    this.ended = '';
    this.issues = new Set(project.warnings);
    this.nodes = new Map(project.nodes.map(n=>[n.id,n]));
    this.endConditions = project.nodes.filter(n=>n.type==='end');
    this.edges = new Map(project.edges.map(e=>[e.id,e]));
    this.flow = project.edges.filter(e=>e.type==='flow');
    this.states = project.edges.filter(e=>e.type==='state');
    this.incoming = by(this.flow,'target');
    this.outgoing = by(this.flow,'source');
    this.control = by(this.states,'target');
    this.stateOverwrites = by(this.states.filter(e=>e.mode==='overwrite' && this.edges.get(e.target)?.type==='state'),'target');
    this.edgeOverwrites = new Map();
    this.resolvingOverwrites = new Set();
    this.overwrittenRegisters = new Set();
    this.stocks = new Map();
    this.buffer = new Map();
    this.registers = new Map();
    this.registerInputs = new Map();
    this.gateCount = new Map();
    this.gateRemainders = new Map();
    this.runtime = new Map();
    this.previousRuntime = new Map();
    this.clicks = new Map();
    this.pending = new Set();
    this.triggerAttempts = new Set();
    this.enabledBefore = new Map();
    this.lastModifiers = new Map();
    this.nameScope = new Map();
    this.base = new Map([['step',0],['time',0]]);
    this.events = [];
    this.activity = new Map();
    this.activeEdges = new Set();
    this.disabledRegisterOutputs = new Set();
    for (const v of project.variables) {
      if (!/^[a-z_$][\w$]*$/i.test(v.name)) this.issues.add('Invalid parameter name ' + v.name);
      else this.base.set(v.name, 0);
    }
    this.variables();
    for (const n of project.nodes) {
      if (!tickTypes.has(n.type) && n.type !== 'text') this.issues.add(n.label + ': ' + n.type + ' has no local simulation behavior.');
      if (n.trigger === 'agent') this.issues.add(n.label + ': Machinations\' agentic triggers are not supported.');
      if (holdings.has(n.type)) {
        this.stocks.set(n.id,new Map());
        if (n.type === 'delay' || n.type === 'queue') this.buffer.set(n.id,[]);
        if (n.type === 'pool') {
          for (const item of n.initialResources.length ? n.initialResources : [{resource:n.resource,value:n.initial}]) {
            add(this.stocks.get(n.id),item.resource,this.expr(item.value,0,n));
          }
        }
      }
      if (n.type === 'register') this.registers.set(n.id,this.expr(n.initial,0,n));
    }
    this.refreshNames();
    this.evaluateRegisters();
    this.history = [this.snapshot()];
  }

  variables() {
    for (const v of this.project.variables) {
      if (this.base.has(v.name)) this.base.set(v.name,this.expr(v.formula,0,v,this.base));
    }
  }

  expr(formula, otherwise=0, item={}, given) {
    if (!String(formula).trim()) return otherwise;
    try {
      const result = Number(compile(formula)(given || this.scope(item),this.rng));
      return Number.isFinite(result) ? result : 0;
    } catch(error) {
      this.issues.add((item.label || item.name || item.id || 'Formula') + ' · ' + formula + ' · ' + error.message);
      return otherwise;
    }
  }

  value(id, resource='') {
    if (this.registers.has(id)) return this.registers.get(id);
    const stock = this.stocks.get(id);
    if (stock) return resource ? stock.get(resource)||0 : sum(stock);
    return this.runtime.get(id) ?? this.previousRuntime.get(id) ?? 0;
  }

  refreshNames() {
    const scope = new Map(this.base);
    const sources = new Map();
    const setName = (name,value,source) => {
      scope.set(name,value);
      sources.set(name,source);
    };
    for (const n of this.project.nodes) {
      const value = this.value(n.id);
      if (n.label && !scope.has(n.label)) setName(n.label,value,n.id);
      const name = variableName(n.label);
      if (name && !scope.has(name)) setName(name,value,n.id);
      if (name && !scope.has(name + '.runtime')) setName(name + '.runtime',value,n.id);
      setName('n_' + n.id.replace(/[^\w]/g,'_'),value,n.id);
    }
    for (const e of this.flow) {
      const name = variableName(e.label);
      if (name) setName(name + '.runtime',this.value(e.id),e.id);
      setName('e_' + e.id.replace(/[^\w]/g,'_') + '.runtime',this.value(e.id),e.id);
    }
    this.nameScope = scope;
    this.nameSources = sources;
  }

  scope(item, x=this.value(item.id), resolve, trail, inputs) {
    const scope = new Map(this.nameScope.size ? this.nameScope : this.base);
    scope.set('x',x);
    scope.set('value',x);
    for (const edge of this.control.get(item.id) || []) if (edge.mode==='input') {
      const name = edge.formula.trim() || 'a';
      let value = 0, source;
      if (!this.nameScope.size || this.enabled(edge,trail)) {
        const overwrite = this.stateOverride(edge,resolve,trail);
        value = overwrite ?? this.originValue(edge,resolve);
        if (overwrite===undefined) source=edge.source;
      } else {
        this.edgeOverwrites.delete(edge.id);
      }
      scope.set(name,value);
      scope.set(name + '.runtime',value);
      inputs?.push({name,source,resource:edge.resource,value});
    }
    return scope;
  }

  originValue(edge, resolve) {
    return resolve && this.registers.has(edge.source) ? resolve(edge.source) : this.value(edge.source,edge.resource);
  }

  stateOverride(edge, resolve, trail) {
    const overwrites = this.stateOverwrites.get(edge.id);
    if (!overwrites || !this.nameScope.size || this.resolvingOverwrites.has(edge.id)) return undefined;
    this.resolvingOverwrites.add(edge.id);
    try {
      const overwrite = overwrites.findLast(e=>this.enabled(e,trail));
      if (!overwrite) {
        this.edgeOverwrites.delete(edge.id);
        return undefined;
      }
      const value = this.originValue(overwrite,resolve);
      this.edgeOverwrites.set(edge.id,value);
      return value;
    } finally {
      this.resolvingOverwrites.delete(edge.id);
    }
  }

  registerInputsChanged(node, inputs, scope) {
    const aliases = new Set(inputs.flatMap(({name})=>[name,name + '.runtime']));
    const references = new Set();
    for (const formula of [node.formula,node.min,node.max].filter(Boolean)) {
      try {
        for (const name of compile(formula).references) references.add(name);
      } catch {
        // Formula errors are reported by expr when the register is evaluated.
      }
    }
    for (const name of references) {
      const key = scope.has(name) ? name : name.toLowerCase();
      const source = this.nameSources.get(key);
      if (key==='x' || key==='value' || source===node.id || aliases.has(key)) continue;
      inputs.push({source,resource:'',value:scope.get(key)});
    }
    const previous = this.registerInputs.get(node.id);
    this.registerInputs.set(node.id,inputs);
    return !previous || previous.length!==inputs.length ||
      inputs.some((input,index)=>!Object.is(input.value,previous[index].value));
  }

  evaluateRegisters({updateAuto=true}={}) {
    const done = new Set(), stack = new Set();
    const resolve = id => {
      const node = this.nodes.get(id);
      const current = this.registers.get(id);
      if (done.has(id) || this.overwrittenRegisters.has(id) || !node.formula || node.trigger==='click') return current;
      const auto = node.trigger==='auto';
      if (auto && !updateAuto) return current;
      if (stack.has(id)) {
        this.issues.add(node.label + ': circular register inputs use the previous value.');
        return current;
      }
      stack.add(id);
      const inputs = [];
      const scope = this.scope(node,current,resolve,undefined,auto?undefined:inputs);
      if (auto || this.registerInputsChanged(node,inputs,scope)) {
        const result = this.expr(node.formula,current,node,scope);
        const next = this.bound(node,result);
        this.registers.set(id,next);
        this.markChange(node,next-current);
      }
      stack.delete(id);
      done.add(id);
      return this.registers.get(id);
    };
    for (const id of this.registers.keys()) resolve(id);
    this.refreshNames();
  }

  bound(item,n) {
    if (item.min !== '') n = Math.max(this.expr(item.min,-Infinity,item),n);
    if (item.max !== '') n = Math.min(this.expr(item.max,Infinity,item),n);
    return n;
  }

  enabled(item, trail = new Set()) {
    if (trail.has(item.id)) {
      this.issues.add('Circular activator at ' + (item.label || item.id) + '.');
      return false;
    }
    trail.add(item.id);
    try {
      const origin = item.type==='state' && this.nodes.get(item.source);
      if (origin?.type==='register' && !this.enabled(origin,trail)) return false;
      if (item.condition && !this.expr(comparison(item.condition),0,item,this.scope(item,undefined,undefined,trail))) {
        return false;
      }
      return (this.control.get(item.id)||[]).every(edge => {
        if (edge.mode !== 'enable' || !this.enabled(edge,trail)) return true;
        const x = this.value(edge.source,edge.resource);
        const formula = comparison(edge.formula,this.stateOverride(edge,undefined,trail));
        return Boolean(this.expr(formula,0,edge,this.scope(edge,x,undefined,trail)));
      });
    } finally {
      trail.delete(item.id);
    }
  }

  queueClick(id, amount=1) {
    const n = this.nodes.get(id);
    if (n?.trigger === 'click') this.clicks.set(id,amount);
  }

  applyModifiers() {
    this.modifiers = new Map();
    for (const edge of this.states) {
      if (!['add','multiply','overwrite'].includes(edge.mode)) continue;
      const target = this.nodes.get(edge.target) || this.edges.get(edge.target);
      if (target.type==='state' || !this.enabled(edge) || !this.enabled(target)) continue;
      const value = this.originValue(edge);
      if (edge.mode==='overwrite') {
        if (target.type==='flow') {
          this.edgeOverwrites.set(target.id,value);
          this.modifiers.delete(target.id);
        } else if (target.type==='pool' || target.type==='register') {
          this.setModifiedValue(target,value,edge);
          if (target.type==='register') this.overwrittenRegisters.add(target.id);
        }
        continue;
      }
      const before = this.lastModifiers.get(edge.id)||0;
      const raw = String(this.stateOverride(edge) ?? edge.formula).trim();
      const percent = raw.endsWith('%');
      const factor = percent ? this.expr(raw.slice(0,-1),0,edge)/100 : this.expr(raw || '1',0,edge);
      const delta = (value-before)*factor;
      this.lastModifiers.set(edge.id,value);
      if (target.type==='pool' || target.type==='register') {
        const base = this.value(target.id);
        const next = edge.mode==='multiply' && value!==before ? base*(1+delta) : base+delta;
        this.setModifiedValue(target,next,edge);
      } else if (target.type==='flow') {
        if (!this.modifiers.has(target.id)) this.modifiers.set(target.id,[]);
        this.modifiers.get(target.id).push({mode:edge.mode,value:value*factor,percent});
      }
    }
  }

  setModifiedValue(node, value, edge) {
    const next = this.bound(node,Math.min(this.capacity(node),value));
    const before = this.value(node.id);
    // Consume this register's own feedback write without retriggering it.
    const feedback = (this.registerInputs.get(edge.source)||[]).filter(input=>
      input.source===node.id && Object.is(input.value,this.value(node.id,input.resource)));
    if (node.type==='register') this.registers.set(node.id,next);
    else add(this.stocks.get(node.id),edge.resource||node.resource,next-before);
    this.markChange(node,next-before,edge.resource||node.resource);
    for (const input of feedback) input.value = this.value(node.id,input.resource);
  }

  capacity(node) {
    return node.capacity === '' || node.capacity === '-1' ? Infinity : Math.max(0,this.expr(node.capacity,Infinity,node));
  }

  due(edge) {
    return this.step % Math.max(1,Math.floor(this.expr(edge.interval,1,edge))) === 0;
  }

  flowFormula(edge) {
    return String(this.edgeOverwrites.get(edge.id) ?? edge.formula).trim();
  }

  rate(edge, weight=false) {
    const key = edge.id + '|' + weight;
    const raw = this.flowFormula(edge);
    const dynamic = /\.runtime\b/.test(raw);
    if (!dynamic && this.rates.has(key)) return this.rates.get(key);
    let value;
    if (raw.toLowerCase()==='all') value = Infinity;
    else if (raw.endsWith('%') && !weight) {
      const chance = this.expr(raw.slice(0,-1),0,edge);
      value = chance <= 100 && this.rng()*100 < chance ? this.expr(edge.chanceAmount,1,edge) : 0;
    } else value = raw ? this.expr(raw.replace(/%$/,''),0,edge) : 1;
    for (const m of this.modifiers.get(edge.id)||[]) {
      if (m.mode==='add') value=m.percent ? value*(1+m.value) : value+m.value;
      if (m.mode==='multiply') value*=1+m.value;
    }
    value = Math.max(0,this.bound(edge,value));
    if (!weight && !edge.decimals) value = Math.round(value);
    if (!dynamic) this.rates.set(key,value);
    return value;
  }

  canUse(edge) {
    const source = this.nodes.get(edge.source), target = this.nodes.get(edge.target);
    if (!source || !target) return false;
    return this.edgeEnabled.get(edge.id) && this.nodeEnabled.get(source.id) && this.nodeEnabled.get(target.id);
  }

  plan(edges, full, override) {
    const reservations = new Map(), rooms = new Map(), moves = [];
    let expected = false, complete = true;
    for (const e of edges) {
      if (!this.canUse(e) || !this.due(e)) continue;
      const from = this.nodes.get(e.source), to = this.nodes.get(e.target);
      const minted = from.type==='source' || override?.mint;
      const stock = override?.stock || this.available.get(from.id);
      if (!override && this.buffer.has(from.id)) continue;
      const allowed = type => (!e.resource || type===e.resource) && (!to.resourceFilter.length || to.resourceFilter.includes(type));
      const sources = minted ? [[from.resource,Infinity]] : [...(stock||[])].reverse();
      const request = override?.amount ?? this.rate(e);
      if (request === Infinity && minted) {
        this.issues.add((e.label||e.id) + ': “all” requires a pool with a finite resource supply.');
        continue;
      }
      if (request > 0) expected = true;
      let remaining = request;
      let options = sources.filter(([type])=>allowed(type));
      if (e.shuffle) options = options.map(entry=>[this.rng(),entry]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
      const room = () => to.overflow==='sink' || !this.stocks.has(to.id) ? Infinity :
        Math.max(0,this.capacity(to)-this.value(to.id)-(rooms.get(to.id)||0));
      for (const [type,total] of options) {
        const key = from.id + '\0' + type;
        const count = Math.min(Math.max(0,total-(reservations.get(key)||0)),remaining,room());
        if (!(count>0)) continue;
        reservations.set(key,(reservations.get(key)||0)+count);
        rooms.set(to.id,(rooms.get(to.id)||0)+count);
        moves.push({e,from,to,type,count,minted,stock});
        remaining -= count;
        if (remaining<=1e-9) break;
      }
      if (Number.isFinite(request) && remaining>1e-9) {
        if (full) return {moves:[],expected,full:false};
        complete = false;
      }
    }
    return {moves,expected,full:complete};
  }

  commit(plan, chain=new Set()) {
    const moved = new Map();
    for (const tx of plan.moves) {
      if (this.ended) break;
      const {e,from,to,type,count,minted,stock} = tx;
      if (!minted) {
        add(stock,type,-count);
        const actual = this.stocks.get(from.id);
        if (actual && actual!==stock) add(actual,type,-count);
      }
      const before = this.runtime.get(e.id)||0;
      this.runtime.set(e.id,before+count);
      const name = variableName(e.label);
      if (name) this.nameScope.set(name+'.runtime',before+count);
      this.nameScope.set('e_'+e.id.replace(/[^\w]/g,'_')+'.runtime',before+count);
      this.activeEdges.add(e.id);
      this.mark(from.id,'out',count,type);
      this.mark(to.id,'in',count,type);
      moved.set(e.id,(moved.get(e.id)||0)+count);
      this.events.push({id:e.id,amount:count,resource:type});
      this.receive(to,type,count,e,chain);
      this.checkEndConditions();
    }
    return moved;
  }

  mark(id,direction,value,resource='') {
    if (!this.activity.has(id)) this.activity.set(id,{in:0,out:0,acted:false,failed:false,resources:new Map()});
    const event = this.activity.get(id);
    if (typeof event[direction]==='boolean') event[direction]=value;
    else {
      event[direction]+=value;
      if (resource) {
        if (!event.resources.has(resource)) event.resources.set(resource,{in:0,out:0});
        event.resources.get(resource)[direction]+=value;
      }
    }
  }

  markChange(node,delta,resource=node.resource) {
    if (delta>0) this.mark(node.id,'in',delta,resource);
    if (delta<0) this.mark(node.id,'out',-delta,resource);
  }

  receive(node,type,count,edge,chain) {
    if (node.type==='gate') {
      if (!this.checkEndConditions()) this.routeGate(node,type,count,chain);
      return;
    }
    if (!this.stocks.has(node.id)) return;
    const accepted = Math.max(0,Math.min(count,this.capacity(node)-this.value(node.id)));
    add(this.stocks.get(node.id),type,accepted);
    if (node.type==='converter') {
      if (!this.delivered.has(node.id)) this.delivered.set(node.id,new Map());
      const ledger = this.delivered.get(node.id);
      if (!ledger.has(edge.id)) ledger.set(edge.id,new Map());
      add(ledger.get(edge.id),type,accepted);
    }
    if (this.buffer.has(node.id) && accepted>0) {
      const output = (this.outgoing.get(node.id)||[])[0];
      const rate = output ? this.rate(output) : this.expr(node.formula,1,node);
      const delay = Number.isFinite(rate) ? Math.max(1,Math.round(rate)) : 1;
      const list = this.buffer.get(node.id);
      if (node.type==='queue') {
        const last = list.at(-1);
        const done = last ? last.due+(Math.ceil(last.count)-1)*last.delay : this.step;
        list.push({type,count:accepted,delay,due:Math.max(this.step,done)+delay});
      } else list.push({type,count:accepted,due:this.step+delay,delay});
    }
  }

  pick(weighted,node,amount=1) {
    const total = weighted.reduce((s,x)=>s+x[1],0);
    if (!(total>0)) return null;
    if (node.distribution==='random') {
      let roll = this.rng()*total;
      for (const [edge,w] of weighted) {
        roll -= w;
        if (roll<0) return edge;
      }
      return weighted.at(-1)[0];
    }
    const remainder = this.gateRemainders.get(node.id)||new Map();
    this.gateRemainders.set(node.id,remainder);
    let best=-Infinity, winner=null;
    for (const [edge,weight] of weighted) {
      const key = edge?.id || 'discard';
      const current = (remainder.get(key)||0)+weight*amount/total;
      remainder.set(key,current);
      if (current>best+1e-9) { best=current; winner=edge; }
    }
    const key = winner?.id || 'discard';
    remainder.set(key,(remainder.get(key)||0)-amount);
    return winner;
  }

  routeGate(node,type,amount,chain) {
    if (chain.has(node.id)) {
      this.issues.add(node.label + ': a same-step gate cycle was stopped.');
      return;
    }
    chain = new Set([...chain,node.id]);
    const edges = (this.outgoing.get(node.id)||[]).filter(e=>this.canUse(e)&&this.due(e));
    const conditional = edges.filter(e=>e.mode==='enable' && /^[<>=!≥≤≠]|\.\./.test(this.flowFormula(e)));
    const weighted = edges.filter(e=>!conditional.includes(e)).map(e=>[e,this.rate(e,true)]).filter(([,w])=>w>0&&Number.isFinite(w));
    if (weighted.length && weighted.every(([e])=>this.flowFormula(e).endsWith('%')) && node.distribution==='deterministic') {
      const total = weighted.reduce((s,x)=>s+x[1],0);
      if (total < 100) weighted.push([null,100-total]);
    }
    if (amount > 100000) this.issues.add(node.label + ': gate work is limited to 100,000 tokens per arrival.');
    const routed = new Map();
    for (let i=0;i<Math.min(amount,100000);i++) {
      const count=Math.min(1,amount-i);
      const index=(this.gateCount.get(node.id)||0)+1;
      this.gateCount.set(node.id,index);
      const edge = this.pick(weighted,node,count);
      if (edge) add(routed,edge,count);
      for (const e of conditional) if (this.expr(comparison(this.flowFormula(e)),0,e,this.scope(e,index))) add(routed,e,count);
    }
    for (const edge of edges) {
      if (this.ended) break;
      const count=routed.get(edge);
      if (!count) continue;
      this.commit(this.plan([edge],false,{stock:new Map([[type,count]]),amount:count}),chain);
    }
  }

  release(node) {
    const list = this.buffer.get(node.id);
    const edge = (this.outgoing.get(node.id)||[])[0];
    if (!edge || !this.canUse(edge) || !this.due(edge)) return;
    for (const batch of list) {
      if (this.ended) break;
      if (batch.due > this.step) {
        if (node.type==='queue') break;
        continue;
      }
      if (batch.count<=0) continue;
      const quantity = node.type==='queue' ? Math.min(batch.count,1) : batch.count;
      const stock = this.stocks.get(node.id);
      const selected = new Map([[batch.type,Math.min(quantity,stock.get(batch.type)||0)]]);
      const moved = this.commit(this.plan([edge],false,{stock:selected,amount:quantity})).get(edge.id)||0;
      batch.count -= moved;
      if (node.type==='queue') {
        if (moved>0) batch.due=this.step+batch.delay;
        break;
      }
    }
    this.buffer.set(node.id,list.filter(batch=>batch.count>1e-9));
  }

  convert(node, mayPull) {
    const input = this.incoming.get(node.id)||[];
    const output = this.outgoing.get(node.id)||[];
    const active = input.filter(e=>this.canUse(e));
    if (!active.length || !output.length || (!node.ignoreDisabled && active.length!==input.length)) return false;
    let worked=false;
    for (let iteration=0;iteration<10000;iteration++) {
      const arrivals = this.delivered.get(node.id) || new Map();
      const matching = active.every(e=>sum(arrivals.get(e.id)||new Map())>0);
      const paid = matching ? {moves:[],expected:true,full:true} : mayPull ? this.plan(active,true) : {moves:[],full:false};
      if (!paid.full || !paid.expected) break;
      const costs = new Map();
      for (const {type,count} of paid.moves) add(costs,type,count);
      if (matching) {
        for (const inputEdge of active) for (const [type,count] of arrivals.get(inputEdge.id)) add(costs,type,count);
      }
      if (!costs.size) break;
      if (!matching) this.commit(paid);
      if (this.ended) return true;
      const production = this.plan(output,false,{mint:true});
      if (!production.moves.length && production.expected) {
        // Keep delivered ingredients for a later attempt when an output unblocks.
        if (!matching && paid.moves.length) this.mark(node.id,'failed',true);
        break;
      }
      for (const [type,count] of costs) add(this.stocks.get(node.id),type,-count);
      this.delivered.set(node.id,new Map());
      if (this.checkEndConditions()) return true;
      this.commit(production);
      worked=true;
      if (this.ended || node.conversion==='single') break;
      if (iteration===9999) this.issues.add(node.label + ': multiple conversion reached the per-step iteration limit.');
    }
    return worked;
  }

  act(node) {
    this.mark(node.id,'acted',true);
    if (node.type==='register') {
      const click = this.clicks.get(node.id)||0;
      const before = this.value(node.id);
      const next = this.bound(node,before+click*this.expr(node.stepValue,1,node));
      this.registers.set(node.id,next);
      this.markChange(node,next-before);
      return;
    }
    if (node.type==='converter') {
      if (!this.convert(node,true)) this.mark(node.id,'failed',true);
      return;
    }
    if (this.buffer.has(node.id) && node.direction==='push') return;
    const direction = node.type==='source' ? 'push' : ['sink','gate'].includes(node.type) ? 'pull' : node.direction;
    const edges = (direction==='push' ? this.outgoing : this.incoming).get(node.id)||[];
    const plan = this.plan(edges,node.all);
    this.commit(plan);
    if (plan.expected && (!plan.moves.length || !plan.full && direction==='pull')) this.mark(node.id,'failed',true);
  }

  triggers({endOnly=false}={}) {
    const split = by(this.states.filter(e=>e.mode==='split'),'source');
    for (const edge of this.states) {
      if (this.ended) return;
      if (this.triggerAttempts.has(edge.id)) continue;
      if (!['trigger','triggerIf'].includes(edge.mode) || !this.nodes.has(edge.target)) continue;
      if (endOnly && this.nodes.get(edge.target).type!=='end') continue;
      const event = this.activity.get(edge.source);
      if (!event || !this.enabled(edge)) continue;
      const isSink = this.nodes.get(edge.source)?.type==='sink';
      const {in:gain=0,out:loss=0} = (edge.resource ? event.resources.get(edge.resource) : event) || {};
      if (edge.mode==='triggerIf') {
        if (!(gain || loss || event.acted && !isSink && !edge.resource)) continue;
        const x = this.value(edge.source,edge.resource);
        if (!this.expr(comparison(edge.formula,this.stateOverride(edge)),0,edge,this.scope(edge,x))) continue;
      } else if (edge.triggerOn==='failed') {
        if (!event.failed) continue;
      } else {
        const changed = edge.triggerOn==='gain' ? gain : edge.triggerOn==='loss' ? loss : gain || loss;
        if (!changed) continue;
        if (edge.triggerOn==='chance') {
          this.triggerAttempts.add(edge.id);
          const chance = this.stateOverride(edge) ?? this.expr(edge.formula,0,edge);
          if (chance<=0 || chance>100 || chance<100 && this.rng()*100>=chance) continue;
        }
      }
      this.triggerAttempts.add(edge.id);
      this.activeEdges.add(edge.id);
      if (this.nodes.get(edge.target).type==='end') this.ended=this.nodes.get(edge.target).label || 'End condition';
      else this.pending.add(edge.target);
    }
    for (const [id,edges] of split) {
      if (this.ended) return;
      if (this.triggerAttempts.has(id)) continue;
      if (endOnly && !edges.some(e=>this.nodes.get(e.target)?.type==='end')) continue;
      const event = this.activity.get(id);
      const node = this.nodes.get(id);
      if (!node || !event || !(event.in||event.out||event.acted&&!event.failed&&node.type!=='sink')) continue;
      const options = edges.filter(e=>this.enabled(e) && this.nodes.has(e.target))
        .map(e=>[e,this.stateOverride(e) ?? this.expr(e.formula.replace(/%$/,''),1,e)]).filter(([,n])=>n>0);
      if (!options.length) continue;
      this.triggerAttempts.add(id);
      const choice = this.pick(options,{...node,id:'split_'+id});
      if (choice) {
        this.activeEdges.add(choice.id);
        if (this.nodes.get(choice.target).type==='end') this.ended=this.nodes.get(choice.target).label || 'End condition';
        else this.pending.add(choice.target);
      }
    }
  }

  checkEndConditions(pending=this.pending) {
    if (this.ended || !this.endConditions.length) return Boolean(this.ended);
    this.refreshNames();
    this.evaluateRegisters({updateAuto:false});
    for (const node of this.endConditions) {
      const conditional = node.condition || (this.control.get(node.id)||[]).some(e=>e.mode==='enable');
      if (conditional && this.enabled(node) || node.formula && this.expr(comparison(node.formula),0,node) || pending.has(node.id)) {
        this.ended=node.label || 'End condition';
        return true;
      }
    }
    this.triggers({endOnly:true});
    return Boolean(this.ended);
  }

  runActions(pending) {
    const actions=[];
    for (const node of this.project.nodes) {
      const allowed = this.nodeEnabled.get(node.id);
      const previously = this.enabledBefore.get(node.id);
      this.enabledBefore.set(node.id,allowed);
      if (!allowed || !tickTypes.has(node.type) || node.type==='end') continue;
      if (pending.has(node.id) || node.trigger==='auto' || node.trigger==='start'&&this.step===1 ||
          node.trigger==='enable'&&!previously || node.trigger==='click'&&this.clicks.has(node.id)) actions.push(node);
    }
    const acted = new Set();
    for (const node of actions.filter(n=>n.type==='sink')) {
      this.act(node);
      acted.add(node.id);
      if (this.checkEndConditions(pending)) return;
    }
    for (const node of this.project.nodes) if (this.buffer.has(node.id) && this.nodeEnabled.get(node.id)) {
      this.release(node);
      if (this.checkEndConditions(pending)) return;
    }
    for (const node of actions.filter(n=>n.type!=='sink')) {
      this.act(node);
      acted.add(node.id);
      if (this.checkEndConditions(pending)) return;
    }
    for (let i=0;i<this.project.nodes.length;i++) {
      let changed = false;
      for (const node of this.project.nodes) if (node.type==='converter' && this.nodeEnabled.get(node.id) &&
          (!acted.has(node.id) || this.activity.get(node.id)?.failed) && this.delivered.get(node.id)?.size) {
        if (this.convert(node,false)) {
          acted.add(node.id);
          this.mark(node.id,'failed',false);
          changed = true;
        }
        if (this.checkEndConditions(pending)) return;
      }
      if (!changed) break;
    }
  }

  snapshot() {
    return {
      step:this.step,
      values:Object.fromEntries(this.project.nodes.filter(n=>holdings.has(n.type)||n.type==='register').map(n=>[n.id,clean(this.value(n.id))])),
      resources:Object.fromEntries([...this.stocks].map(([id,values])=>[id,Object.fromEntries(values)])),
    };
  }

  advance() {
    if (this.ended) return this.history.at(-1);
    this.step++;
    this.edgeOverwrites.clear();
    this.overwrittenRegisters.clear();
    this.previousRuntime = this.runtime;
    this.runtime = new Map();
    this.base.set('step',this.step);
    this.base.set('time',this.step);
    this.variables();
    this.activity = new Map();
    this.rates = new Map();
    this.activeEdges = new Set();
    this.events = [];
    this.triggerAttempts.clear();
    this.refreshNames();
    this.evaluateRegisters();
    this.applyModifiers();
    this.refreshNames();
    this.available = new Map([...this.stocks].map(([key,stock])=>[key,new Map(stock)]));
    this.nodeEnabled = new Map(this.project.nodes.map(n=>[n.id,this.enabled(n)]));
    this.edgeEnabled = new Map(this.flow.map(e=>[e.id,this.enabled(e)]));
    this.disabledRegisterOutputs = new Set(this.project.edges.filter(e=>
      this.registers.has(e.source) && !this.nodeEnabled.get(e.source)).map(e=>e.id));
    this.delivered ||= new Map();
    const pending = this.pending;
    this.pending = new Set();
    if (!this.checkEndConditions(pending)) this.runActions(pending);
    if (!this.ended) {
      this.refreshNames();
      this.evaluateRegisters({updateAuto:false});
      this.triggers();
      this.checkEndConditions(pending);
    }
    this.clicks.clear();
    const result = this.snapshot();
    if (this.retainHistory) this.history.push(result);
    else this.history[0]=result;
    return result;
  }
}

