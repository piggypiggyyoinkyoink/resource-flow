import {spawn} from 'node:child_process';
import {access, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

async function browserPath() {
  const configured = process.env.RESOURCE_FLOW_BROWSER;
  const candidates = configured ? [configured] : [];
  if (process.platform==='win32') {
    for (const dir of [process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(join(dir,'Google','Chrome','Application','chrome.exe'),
        join(dir,'Microsoft','Edge','Application','msedge.exe'));
    }
  } else if (process.platform==='darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push('/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge');
  }
  for (const location of candidates) {
    try {
      await access(location);
      return resolve(location);
    } catch {}
  }
}

function devtools(browser) {
  const pending = new Map();
  let sequence = 0, buffer = '', failed = false;
  const fail = error => {
    failed = true;
    for (const {reject} of pending.values()) reject(error);
    pending.clear();
  };
  browser.once('error',fail);
  browser.once('exit',()=>fail(Error('The preview browser exited.')));
  browser.stdio[3].on('error',fail);
  browser.stdio[4].on('error',fail);
  browser.stdio[4].setEncoding('utf8').on('data',chunk=>{
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0'))!==-1) {
      let message;
      try { message = JSON.parse(buffer.slice(0,end)); } catch {}
      buffer = buffer.slice(end+1);
      const request = pending.get(message?.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  return (method,params={},sessionId)=>new Promise((resolve,reject)=>{
    if (failed) {
      reject(Error('The preview browser is unavailable.'));
      return;
    }
    const id = ++sequence;
    pending.set(id,{resolve,reject});
    browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
  });
}

function previewPaths(expectedPath) {
  if (location.origin!=='https://my.machinations.io' || location.pathname!==expectedPath) return [];
  return Array.from(document.querySelectorAll('svg.m-ground-work-svg .m-connection-line')).flatMap(path=>{
    const id = path.closest('[data-nodeid]')?.getAttribute('data-nodeid');
    const d = path.getAttribute('d');
    if (!id || !d) return [];
    const length = path.getTotalLength();
    if (!length) return [];
    const end = path.getPointAtLength(length);
    const prev = path.getPointAtLength(Math.max(0,length-1));
    const center = path.getPointAtLength(length/2);
    const {x,y,width,height} = path.getBBox();
    return [{id,d,end:{x:end.x,y:end.y},center:{x:center.x,y:center.y},
      angle:Math.atan2(end.y-prev.y,end.x-prev.x)*180/Math.PI,
      bounds:[{x,y},{x:x+width,y:y+height}]}];
  });
}

export async function captureRenderedLayout(id, expectedCount) {
  const binary = await browserPath();
  if (!binary || !expectedCount) return [];
  const scratch = resolve(tmpdir());
  const prefix = join(scratch,'resource-flow-preview-');
  const profile = await mkdtemp(prefix);
  const browser = spawn(binary,[
    '--headless','--no-startup-window','--no-first-run','--no-default-browser-check',
    '--disable-extensions','--disable-background-networking','--disable-crashpad','--disable-gpu',
    '--disable-breakpad','--disable-dev-shm-usage','--do-not-de-elevate','--disable-edgeupdater',
    '--no-service-autorun','--disable-component-update','--disable-sync',
    '--disable-gpu-compositing','--disable-software-rasterizer','--in-process-gpu',
    '--password-store=basic','--remote-debugging-pipe','--user-data-dir='+profile,
  ],{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
  browser.stderr.resume();
  const command = devtools(browser);
  const closed = new Promise(resolve=>browser.once('close',resolve));
  let timeout, latest=[];
  try {
    const deadline = new Promise(resolve=>{
      timeout = setTimeout(()=>resolve(latest),8500);
    });
    const layout = async()=>{
      const {targetId} = await command('Target.createTarget',{url:'about:blank'});
      const {sessionId} = await command('Target.attachToTarget',{targetId,flatten:true});
      const path = '/e/diagram/'+encodeURIComponent(id);
      await command('Page.navigate',{
        url:'https://my.machinations.io'+path+'?hosted=1&diagram=1&description=0&theme=dark&fit=auto',
      },sessionId);
      const expression = '('+previewPaths.toString()+')('+JSON.stringify(path)+')';
      for (let attempt=0;attempt<26;attempt++) {
        try {
          const result = await command('Runtime.evaluate',{expression,returnByValue:true},sessionId);
          const value = result.result?.value;
          if (Array.isArray(value) && value.length>=latest.length) latest=value;
          if (latest.length>=expectedCount) break;
        } catch {
          if (browser.exitCode!==null) break;
        }
        await delay(220);
      }
      return latest;
    };
    return await Promise.race([layout(),deadline]);
  } finally {
    clearTimeout(timeout);
    await Promise.race([command('Browser.close').catch(()=>{}),closed,delay(500)]);
    await Promise.race([closed,delay(750)]);
    if (browser.exitCode===null) {
      browser.kill();
      await Promise.race([closed,delay(300)]);
    }
    if (resolve(profile).startsWith(prefix)) {
      await rm(profile,{recursive:true,force:true,maxRetries:2,retryDelay:100}).catch(()=>{});
    }
  }
}
