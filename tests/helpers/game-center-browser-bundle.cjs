/* Real Game Centers with only Group identity replaced; no auth or database access. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
module.exports = function gameCenterBrowserBundle({ nbaLive = false, nflLive = false } = {}) {
  const sources = {}, maps = {};
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
      maps[filename][request] = (nbaLive || nflLive) && request === 'next/navigation'
        ? add(path.join(root, 'virtual-nba-live-navigation.js'), `const React=require('react');
          const subscribe=notify=>{window.addEventListener('popstate',notify);return()=>window.removeEventListener('popstate',notify)};
          exports.usePathname=()=>React.useSyncExternalStore(subscribe,()=>location.pathname);
          exports.useSearchParams=()=>new URLSearchParams(React.useSyncExternalStore(subscribe,()=>location.search));
          exports.useRouter=()=>({push:href=>history.pushState(null,'',href),replace:href=>history.replaceState(null,'',href)});`)
        : (nbaLive || nflLive) && request === '@/components/AppNav'
        ? add(path.join(root, 'virtual-nba-live-nav.js'), 'exports.__esModule=true;exports.default=()=>null;')
        : request.includes('providers/GroupProvider')
        ? add(path.join(root, 'virtual-game-center-group.js'), 'exports.useGroupContext=()=>window.fixtureGroup;')
        : add(createRequire(filename).resolve(request.startsWith('@/') ? path.join(root, request.slice(2)) : request));
    }
    return filename;
  }
  try {
    const entries = {
      nfl: 'components/live-scores/NflGameCenter.tsx',
      'nfl-modal': 'components/live-scores/NflGameCenterModal.tsx',
      ncaa: 'components/ncaa/NcaaGameCenterModal.tsx',
      bracket: 'components/bracket/BracketGameCenterModal.tsx',
      nba: 'components/live-scores/NbaGameCenter.tsx',
      'nba-modal': 'components/live-scores/NbaGameCenterModal.tsx',
      ...(nflLive ? { 'nfl-live': 'components/live-scores/NflLiveScores.tsx' } : {}),
      ...(nbaLive ? { 'nba-live': 'components/live-scores/NbaLiveScores.tsx' } : {}),
    };
    const ids = Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, add(path.join(root, file))]));
    const react = add(require.resolve('react')), client = add(require.resolve('react-dom/client'));
    return `const process={env:{NODE_ENV:'production'}}; const global=globalThis;
      const sources=${JSON.stringify(sources)}, maps=${JSON.stringify(maps)}, cache={};
      function load(id) { if(cache[id]) return cache[id].exports; const m=cache[id]={exports:{}};
        new Function('require','module','exports',sources[id])(r=>load(maps[id][r]),m,m.exports); return m.exports; }
      window.React=load(${JSON.stringify(react)}); window.ReactDOMClient=load(${JSON.stringify(client)});
      window.GameCenters=Object.fromEntries(Object.entries(${JSON.stringify(ids)}).map(([name,id])=>[name,load(id).default]));`;
  } finally {
    if (oldTs) require.extensions['.ts'] = oldTs; else delete require.extensions['.ts'];
    if (oldTsx) require.extensions['.tsx'] = oldTsx; else delete require.extensions['.tsx'];
  }
};
