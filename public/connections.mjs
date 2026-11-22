export const endpointKeys=['source','target'];

export function connectionStatus(project) {
  const nodes=new Set(project.nodes.map(n=>n.id));
  const edges=new Map(project.edges.map(e=>[e.id,e])), resolved=new Map(), visiting=new Set();
  const endpointConnected=(edge,key)=>nodes.has(edge[key])||
    edge.type==='state'&&edges.has(edge[key])&&complete(edges.get(edge[key]));
  function complete(edge) {
    if (resolved.has(edge.id)) return resolved.get(edge.id);
    if (visiting.has(edge.id)) return false;
    visiting.add(edge.id);
    const connected=endpointKeys.every(key=>endpointConnected(edge,key));
    visiting.delete(edge.id);
    resolved.set(edge.id,connected);
    return connected;
  }
  const connected=new Set(project.edges.filter(complete).map(e=>e.id));
  const issues=[];
  for (const edge of project.edges) for (const key of endpointKeys) {
    if (endpointConnected(edge,key)) continue;
    const name=(edge.type==='state'?'State link ':'Resource flow ')+(edge.label||edge.id);
    const end=key==='source'?'origin':'destination';
    issues.push(edge.type==='state'&&edges.has(edge[key])
      ?name+' has its '+end+' attached to an incomplete or cyclic connection.'
      :name+' has a disconnected '+end+'.');
  }
  return {connected,issues};
}

export function canAttachEndpoint(project,edge,key,kind,id) {
  if (kind==='node') return project.nodes.some(n=>n.id===id&&n.type!=='text');
  if (kind!=='edge'||edge.type!=='state'||id===edge.id||id===edge[key==='source'?'target':'source']) return false;
  const edges=new Map(project.edges.map(e=>[e.id,e])), seen=new Set();
  function dependsOnCurrent(current) {
    if (current===edge.id) return true;
    if (seen.has(current)||!edges.has(current)) return false;
    seen.add(current);
    return endpointKeys.some(key=>dependsOnCurrent(edges.get(current)[key]));
  }
  return edges.has(id)&&!dependsOnCurrent(id);
}
