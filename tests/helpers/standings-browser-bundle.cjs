/* Bundle real Live pages with synthetic auth/Group/Next history for read-only browser QA. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
module.exports = function standingsBrowserBundle() {
  const sources = {}, maps = {};
  const special = {
    'next/navigation': `const React=require('react');
      function useLocation() { return React.useSyncExternalStore(fn => { window.addEventListener('popstate',fn); return () => window.removeEventListener('popstate',fn); }, () => location.pathname+location.search); }
      exports.usePathname=()=>new URL(useLocation(),'http://standings.test').pathname;
      exports.useSearchParams=()=>new URLSearchParams(new URL(useLocation(),'http://standings.test').search);`,
    '@/components/AppNav': `const React=require('react'); exports.__esModule=true; exports.default=()=>React.createElement('nav',{className:'sm:hidden',style:{position:'fixed',bottom:0,height:80,width:'100%',left:0,background:'#101827'},'aria-label':'Fixture bottom navigation'},'111 Sports');`,
    '@/components/providers/GroupProvider': `exports.useGroupContext=()=>window.fixtureGroup;`,
  };
  const oldTs = require.extensions['.ts'], oldTsx = require.extensions['.tsx'];
  require.extensions['.ts'] ??= () => {}; require.extensions['.tsx'] ??= () => {};
  function add(filename, supplied) {
    if (sources[filename]) return filename;
    let source = supplied ?? fs.readFileSync(filename, 'utf8');
    if (/\.tsx?$/.test(filename)) source = ts.transpileModule(source, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    sources[filename] = source; maps[filename] = {};
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const request = match[1]; if (request.endsWith('.development.js')) continue;
      maps[filename][request] = special[request] ? add(path.join(root, `virtual-${request.replaceAll('/', '-')}.js`), special[request])
        : add(createRequire(filename).resolve(request.startsWith('@/') ? path.join(root, request.slice(2)) : request));
    }
    return filename;
  }
  try {
    const nba = add(path.join(root, 'components/live-scores/NbaLiveScores.tsx'));
    const nfl = add(path.join(root, 'components/live-scores/NflLiveScores.tsx'));
    const ncaa = add(path.join(root, 'app/ncaa-pickem/scores/page.tsx'));
    const react = add(require.resolve('react')), client = add(require.resolve('react-dom/client'));
    return `const process={env:{NODE_ENV:'production'}}; const global=globalThis;
      const sources=${JSON.stringify(sources)}, maps=${JSON.stringify(maps)}, cache={};
      function load(id) { if(cache[id]) return cache[id].exports; const m=cache[id]={exports:{}};
        new Function('require','module','exports',sources[id])(r=>load(maps[id][r]),m,m.exports); return m.exports; }
      window.React=load(${JSON.stringify(react)}); window.ReactDOMClient=load(${JSON.stringify(client)});
      window.LivePages={nba:load(${JSON.stringify(nba)}).default,nfl:load(${JSON.stringify(nfl)}).default,ncaa:load(${JSON.stringify(ncaa)}).default};
      for(const method of ['pushState','replaceState']) { const original=history[method].bind(history); history[method]=(...args)=>{original(...args); dispatchEvent(new PopStateEvent('popstate'));}; }`;
  } finally {
    if (oldTs) require.extensions['.ts'] = oldTs; else delete require.extensions['.ts'];
    if (oldTsx) require.extensions['.tsx'] = oldTsx; else delete require.extensions['.tsx'];
  }
};
