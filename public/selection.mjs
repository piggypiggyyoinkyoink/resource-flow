export function toggleItem(items,item) {
  return items.some(other=>other.kind===item.kind&&other.id===item.id)
    ?items.filter(other=>other.kind!==item.kind||other.id!==item.id):[...items,item];
}

export function commonProperty(items,key) {
  if (!items.length) return false;
  const value=JSON.stringify(items[0][key]);
  return items.every(item=>JSON.stringify(item[key])===value);
}

export function setProperty(items,key,value) {
  for (const item of items) item[key]=structuredClone(value);
}

export function editorOptions(options,current,unsupported=[]) {
  return options.filter(([id])=>!unsupported.includes(id)||id===current)
    .map(([id,label])=>({id,label,unsupported:unsupported.includes(id)}));
}
