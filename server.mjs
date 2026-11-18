import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureRenderedLayout } from './rendered-layout.mjs';

const files = new Map([
  ['/', ['index.html','text/html']], ['/style.css', ['style.css','text/css']],
  ['/app.mjs', ['app.mjs','text/javascript']], ['/model.mjs', ['model.mjs','text/javascript']],
  ['/sim.mjs', ['sim.mjs','text/javascript']], ['/formula.mjs', ['formula.mjs','text/javascript']],
  ['/geometry.mjs', ['geometry.mjs','text/javascript']],
  ['/import.mjs', ['import.mjs','text/javascript']], ['/icons.mjs', ['icons.mjs','text/javascript']],
]);

export function diagramId(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Enter a valid Machinations diagram URL.'); }
  const hosts = ['my.machinations.io', 'machinations.io', 'www.machinations.io', 'app.machinations.io'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) {
    throw Error('Enter an HTTPS Machinations diagram URL.');
  }
  const match = /^\/(?:d\/[^/]+|e(?:\/diagram)?|community\/diagrams|diagram\/open-public|diagram|open-public\/[^/]+)\/([a-z0-9_-]{16,100})\/?$/i.exec(url.pathname);
  if (!match) throw Error('Use a diagram share link or an embed link that contains the diagram ID.');
  return match[1];
}

export async function fetchDiagram(value) {
  const id = diagramId(value);
  const response = await fetch('https://my.machinations.io/diagram/open-public/' + encodeURIComponent(id), {
    headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw Error('Machinations could not open this diagram publicly. Use a public share link or import a local file.');
  }
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 20_000_000) {
      await reader.cancel();
      throw Error('The remote diagram exceeds 20 MB.');
    }
    parts.push(value);
  }
  const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!data.success || typeof data.content?.xml !== 'string') {
    throw Error('This diagram did not expose an editable model publicly. Import a local model or captured SVG.');
  }
  return { title: data.content.filename, xml: data.content.xml, url: value };
}

export function start(port = 4177) {
  const server = createServer(async (req, res) => {
    const respond = (status, type, body) => {
      res.writeHead(status, {
        'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      });
      res.end(body);
    };
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers['sec-fetch-site'] === 'cross-site') {
      return respond(403, 'text/plain', 'This editor only accepts same-site requests to localhost.');
    }
    if (req.method !== 'GET') return respond(405, 'text/plain', 'Method not allowed.');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') return respond(204, 'text/plain', '');
    if (url.pathname === '/import-url') {
      try {
        const data = await fetchDiagram(url.searchParams.get('url'));
        const count = [...data.xml.matchAll(/<mx(?:State|Resource)ConnectionCell\b/g)].length;
        const rendered = await captureRenderedLayout(diagramId(data.url),count).catch(()=>[]);
        return respond(200, 'application/json', JSON.stringify({...data,rendered}));
      } catch (error) {
        const message = ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
          ? 'Could not reach Machinations. Check the connection or import a local file.' : error.message;
        return respond(400, 'application/json', JSON.stringify({ error: message }));
      }
    }
    const file = files.get(url.pathname);
    if (!file) return respond(404, 'text/plain', 'Not found.');
    try {
      respond(200, file[1], await readFile(new URL('./public/' + file[0], import.meta.url)));
    } catch {
      respond(500, 'text/plain', 'The editor file could not be loaded.');
    }
  });
  return server.listen(port, '127.0.0.1');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4177);
  const server = start(port);
  server.on('listening', () => {
    const address = 'http://127.0.0.1:' + server.address().port;
    console.log('Resource Flow is running at ' + address);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      execFile('explorer.exe', [address], { windowsHide: true }, () => {});
    }
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use. Set PORT to use another port.' : error.message);
    process.exitCode = 1;
  });
}
