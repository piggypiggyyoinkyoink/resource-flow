export const stateLinkColor='#7b818a';

export function importedColor(value) {
  const text=String(value||'').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return '#'+[...text.slice(1)].map(c=>c+c).join('').toLowerCase();
  const rgb=/^rgba?\(\s*([\d.]+)(%?)[,\s]+([\d.]+)(%?)[,\s]+([\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(text);
  if (!rgb || rgb[7]!==undefined&&Number(rgb[7])===0) return '';
  return '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,Math.round(Number(rgb[i])*(rgb[i+1]?2.55:1)))).toString(16).padStart(2,'0')).join('');
}

export function normalizeAppearance(item,resources,inferPreset=false) {
  const color=/^#[0-9a-f]{6}$/i.test(item.color||'')?item.color:'';
  const preset=resources.find(resource=>resource.id===item.colorResource);
  if (preset) return {color:preset.color,colorResource:preset.id};
  // Older projects saved presets as hex values. Only infer an unambiguous match.
  const matches=inferPreset&&!Object.hasOwn(item,'colorResource')&&color
    ?resources.filter(resource=>resource.color.toLowerCase()===color.toLowerCase()):[];
  return {color,colorResource:matches.length===1?matches[0].id:''};
}

export function componentColor(item,resources,otherwise='') {
  return resources.find(resource=>resource.id===item.colorResource)?.color||item.color||otherwise;
}

export function setColorPreset(items,resource) {
  for (const item of items) {item.colorResource=resource.id;item.color=resource.color;}
}

export function setCustomColor(items,color) {
  for (const item of items) {item.colorResource='';item.color=color;}
}

export function setResourceColor(project,resource,color) {
  resource.color=color;
  for (const item of [...project.nodes,...project.edges]) {
    if (item.colorResource===resource.id) item.color=color;
  }
}
