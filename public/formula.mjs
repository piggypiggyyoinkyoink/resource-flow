const modulo = (a,b) => b===0 ? a : a-b*Math.floor(a/b);

const binary = {
  or:[1,(a,b)=>a||b()], '||':[1,(a,b)=>a||b()],
  xor:[2,(a,b)=>Boolean(a)!==Boolean(b())],
  and:[3,(a,b)=>a&&b()], '&&':[3,(a,b)=>a&&b()],
  '==':[4,(a,b)=>a===b()], '!=':[4,(a,b)=>a!==b()], '<':[5,(a,b)=>a<b()],
  '<=':[5,(a,b)=>a<=b()], '>':[5,(a,b)=>a>b()], '>=':[5,(a,b)=>a>=b()],
  '+':[6,(a,b)=>a+b()], '-':[6,(a,b)=>a-b()], '*':[7,(a,b)=>a*b()],
  '/':[7,(a,b)=>a/b()], '%':[7,(a,b)=>a%b()], mod:[7,(a,b)=>modulo(a,b())], '^':[9,(a,b)=>a**b()],
};
const funcs = Object.fromEntries([
  'abs','acos','asin','atan','atan2','ceil','cos','exp','floor','hypot','log10','log2','max','min','sign','sin','sqrt','tan','trunc',
].map(name=>[name,Math[name]]));
Object.assign(funcs, {
  log:(x,b)=>b===undefined?Math.log(x):Math.log(x)/Math.log(b), ln:Math.log,
  pow:Math.pow, sum:(...xs)=>xs.flat().reduce((a,b)=>a+b,0), mean:(...xs)=>{
    const numbers=xs.flat();
    return numbers.reduce((a,b)=>a+b,0)/numbers.length;
  },
  min:(...xs)=>Math.min(...xs.flat()), max:(...xs)=>Math.max(...xs.flat()),
  round:(x,d=0)=>Math.round(x*10**d)/10**d, fix:Math.round, mod:modulo,
  clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),
  larger:(a,b)=>+(a>b), largerEq:(a,b)=>+(a>=b), smaller:(a,b)=>+(a<b), smallerEq:(a,b)=>+(a<=b),
  equal:(a,b)=>+(a===b), unequal:(a,b)=>+(a!==b), ifElse:(c,a,b)=>c?a:b,
});
const constants = {pi:Math.PI, e:Math.E, true:1, false:0, infinity:Infinity, nan:NaN};
const tokens = /\s*(?:(\d*d\d+)(?![\w.])|((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|([a-z_$][\w$]*(?:\.[a-z_$][\w$]*)*)|(>=|<=|==|!=|\|\||&&|[()[\]+*/%^<>=,?:!-]))/iy;
const cache = new Map();

export function seeded(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.codePointAt(0), 16777619);
  return () => {
    let t = state = (state + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function compile(expression) {
  const source = String(expression).trim().replaceAll('≥','>=').replaceAll('≤','<=').replaceAll('≠','!=').replaceAll('−','-').replaceAll('×','*').replaceAll('÷','/').replaceAll('**','^');
  if (cache.has(source)) return cache.get(source);
  if (source.length > 1800) throw Error('Formula is too long.');
  const items = [];
  let pos = 0;
  while (pos < source.length) {
    tokens.lastIndex = pos;
    const t = tokens.exec(source);
    if (!t) throw Error('Unexpected formula syntax at ' + source.slice(pos, pos + 18));
    items.push(t[1] ? {dice:t[1]} : t[2] ? {number:Number(t[2])} : t[3] ? {name:t[3], key:t[3].toLowerCase()} : {key:t[4]});
    pos = tokens.lastIndex;
  }
  let i = 0;
  const references = new Set();
  const peek = () => items[i]?.key;
  const eat = key => peek() === key && !!items[i++];
  const need = key => { if (!eat(key)) throw Error('Expected ' + key + ' in formula.'); };

  function atom() {
    if (eat('[')) {
      const array = [];
      if (!eat(']')) {
        do { array.push(expr()); } while (eat(','));
        need(']');
      }
      return (scope,rng)=>array.map(item=>item(scope,rng));
    }
    if (eat('(')) {
      const inside = expr();
      need(')');
      return inside;
    }
    const t = items[i++];
    if (!t) throw Error('Expected a value in formula.');
    if (t.number !== undefined) return () => t.number;
    if (t.dice) {
      const [count,faces] = t.dice.toLowerCase().split('d');
      const n = Number(count || 1), k = Number(faces);
      if (n < 1 || n > 1000 || k < 1 || k > 1e9) throw Error('Dice count or sides out of range.');
      return (scope,rng) => {
        let total = 0;
        for (let j=0;j<n;j++) total += 1+Math.floor(rng()*k);
        return total;
      };
    }
    if (['+','-','!','not'].includes(t.key)) {
      const value = expr(8);
      if (t.key === '+') return (s,r)=>+value(s,r);
      if (t.key === '-') return (s,r)=>-value(s,r);
      return (s,r)=>!value(s,r);
    }
    if (!t.name) throw Error('Unexpected token ' + t.key + ' in formula.');
    if (eat('(')) {
      const args = [];
      if (!eat(')')) {
        do { args.push(expr()); } while (eat(','));
        need(')');
      }
      if (t.key === 'if' || t.key === 'ifelse') {
        if (args.length !== 3) throw Error('if requires three arguments.');
        return (s,r)=>args[0](s,r)?args[1](s,r):args[2](s,r);
      }
      if (t.key === 'pickrandom') return (scope,rng) => {
        const options=args[0]?.(scope,rng);
        if (!Array.isArray(options)||!options.length) throw Error('pickRandom requires a nonempty array.');
        const distribution=args[1]?.(scope,rng);
        if (distribution===undefined) return options[Math.floor(rng()*options.length)];
        if (!Array.isArray(distribution)||distribution.length!==options.length||distribution.some(n=>n<0)) {
          throw Error('pickRandom weights must match the array.');
        }
        const total=distribution.reduce((a,b)=>a+b,0);
        if (!(total>0)) throw Error('pickRandom weights must have a positive sum.');
        let roll=rng()*total;
        return options[distribution.findIndex(n=>(roll-=n)<0)];
      };
      if (t.key === 'random' || t.key === 'randomint') return (scope,rng) => {
        const numbers = args.map(arg=>arg(scope,rng));
        const low = numbers.length > 1 ? numbers[0] : 0;
        const high = numbers.at(-1) ?? (t.key==='randomint'?2:1);
        const result = low + rng()*(high-low);
        return t.key === 'randomint' ? Math.floor(result) : result;
      };
      const name = Object.keys(funcs).find(x=>x.toLowerCase()===t.key);
      if (!name) throw Error('Unsupported function ' + t.name + '().');
      return (scope,rng)=>funcs[name](...args.map(arg=>arg(scope,rng)));
    }
    references.add(t.name);
    return (scope) => {
      if (scope.has(t.name)) return scope.get(t.name);
      if (scope.has(t.key)) return scope.get(t.key);
      if (Object.hasOwn(constants,t.key)) return constants[t.key];
      throw Error('Unknown variable ' + t.name + '.');
    };
  }
  function expr(min=0) {
    let left = atom();
    while (Object.hasOwn(binary,peek()) && binary[peek()][0] >= min) {
      let op = items[i++].key;
      const [precedence, run] = binary[op];
      const previous = left;
      const right = expr(precedence + (op === '^' ? 0 : 1));
      left = (scope,rng) => run(previous(scope,rng), () => right(scope,rng));
    }
    if (min === 0 && eat('?')) {
      const yes = expr();
      need(':');
      const no = expr();
      const test = left;
      return (s,r)=>test(s,r)?yes(s,r):no(s,r);
    }
    return left;
  }

  const fn = expr();
  if (i !== items.length) throw Error('Unexpected trailing formula syntax.');
  fn.references = references;
  if (cache.size >= 2000) cache.clear();
  cache.set(source,fn);
  return fn;
}

export function comparison(expression, threshold) {
  const raw = String(expression).trim();
  if (!raw && threshold===undefined) return 'x != 0';
  const range = /^(.+?)\s*\.\.\s*(.+)$/.exec(raw);
  if (range) return 'x >= (' + (threshold ?? range[1]) + ') and x <= (' + range[2] + ')';
  if (threshold!==undefined) {
    const operator = /^[!<>=≥≤≠]=?/.exec(raw)?.[0];
    if (operator) return 'x ' + (operator==='='?'==':operator) + ' ' + threshold;
    return raw ? String(threshold) : 'x != ' + threshold;
  }
  if (/^[!<>=≥≤≠]/.test(raw)) return 'x ' + raw.replace(/^=(?!=)/,'==');
  return raw;
}

