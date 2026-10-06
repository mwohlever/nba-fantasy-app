/* Render the actual Slate Manager component with fixture navigation/auth context. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
module.exports = function slateAdminBrowserBundle() {
  const sources = {}, maps = {};
  const special = {
    'next/navigation': `const router={replace:()=>{},push:()=>{}};exports.useRouter=()=>router;`,
    'next/link': `const React=require('react');exports.__esModule=true;exports.default=props=>React.createElement('a',props);`,
    '@/components/AppNav': `exports.__esModule=true;exports.default=()=>null;`,
    '@/components/providers/SportProvider': `exports.useSelectedSport=()=>({selectedSport:window.fixtureSport});`,
    '@/components/golf/GolfSalarySetup': `exports.__esModule=true;exports.default=()=>null;`,
    '@/components/golf/GolfPeriodSetup': `exports.__esModule=true;exports.default=()=>null;`,
  };
  const oldTs = require.extensions['.ts'], oldTsx = require.extensions['.tsx'];
  require.extensions['.ts'] ??= () => {}; require.extensions['.tsx'] ??= () => {};
  function add(filename, supplied) {
    if (sources[filename]) return filename;
    let code = supplied ?? fs.readFileSync(filename, 'utf8');
    if (/\.tsx?$/.test(filename)) code = ts.transpileModule(code, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    sources[filename] = code; maps[filename] = {};
    for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const id = match[1]; if (id.endsWith('.development.js')) continue;
      maps[filename][id] = special[id] ? add(path.join(root, `virtual-${id.replaceAll('/', '-')}.js`), special[id])
        : add(createRequire(filename).resolve(id.startsWith('@/') ? path.join(root, id.slice(2)) : id));
    }
    return filename;
  }
  try {
    const page = add(path.join(root, 'app/admin/slates/page.tsx'));
    const react = add(require.resolve('react')), client = add(require.resolve('react-dom/client'));
    return `const process={env:{NODE_ENV:'production'}};const global=globalThis;
      const sources=${JSON.stringify(sources)},maps=${JSON.stringify(maps)},cache={};
      function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};
        new Function('require','module','exports',sources[id])(r=>load(maps[id][r]),m,m.exports);return m.exports;}
      window.React=load(${JSON.stringify(react)});window.ReactDOMClient=load(${JSON.stringify(client)});
      window.SlateAdmin=load(${JSON.stringify(page)}).default;`;
  } finally {
    if (oldTs) require.extensions['.ts'] = oldTs; else delete require.extensions['.ts'];
    if (oldTsx) require.extensions['.tsx'] = oldTsx; else delete require.extensions['.tsx'];
  }
};
