/* Bundle the actual admin page with fixture navigation; no application credentials. */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

module.exports = function adminBrowserBundle() {
  const sources = {}, maps = {};
  const special = {
    'next/link': `const React=require('react');exports.__esModule=true;exports.default=props=>React.createElement('a',props);`,
    '@/components/AppNav': `exports.__esModule=true;exports.default=()=>null;`,
  };
  const oldTs = require.extensions['.ts'], oldTsx = require.extensions['.tsx'];
  require.extensions['.ts'] ??= () => {};
  require.extensions['.tsx'] ??= () => {};
  function add(filename, supplied) {
    if (sources[filename]) return filename;
    let source = supplied ?? fs.readFileSync(filename, 'utf8');
    if (filename.endsWith('.module.css')) {
      source = `module.exports=${JSON.stringify(Object.fromEntries([...source.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]])))};`;
    }
    if (/\.tsx?$/.test(filename)) source = ts.transpileModule(source, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    sources[filename] = source; maps[filename] = {};
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const request = match[1];
      if (request.endsWith('.development.js')) continue;
      maps[filename][request] = special[request]
        ? add(path.join(root, `virtual-${request.replaceAll('/', '-')}.js`), special[request])
        : add(createRequire(filename).resolve(request.startsWith('@/') ? path.join(root, request.slice(2)) : request));
    }
    return filename;
  }
  try {
    const page = add(path.join(root, 'app/admin/nba-skins/page.tsx'));
    const react = add(require.resolve('react')), client = add(require.resolve('react-dom/client'));
    return `const process={env:{NODE_ENV:'production'}},global=globalThis;
      const sources=${JSON.stringify(sources)},maps=${JSON.stringify(maps)},cache={};
      function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};
        new Function('require','module','exports',sources[id])(r=>load(maps[id][r]),m,m.exports);return m.exports;}
      const React=load(${JSON.stringify(react)}),ReactDOMClient=load(${JSON.stringify(client)});
      ReactDOMClient.createRoot(document.getElementById('app')).render(React.createElement(load(${JSON.stringify(page)}).default));`;
  } finally {
    if (oldTs) require.extensions['.ts'] = oldTs; else delete require.extensions['.ts'];
    if (oldTsx) require.extensions['.tsx'] = oldTsx; else delete require.extensions['.tsx'];
  }
};
