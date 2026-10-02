/* Build the real NCAA modal and shared PBP into an isolated browser fixture. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
module.exports = function footballBrowserBundle() {
  const sources = {}, maps = {};
  const oldTs = require.extensions['.ts'], oldTsx = require.extensions['.tsx'];
  require.extensions['.ts'] ??= () => {};
  require.extensions['.tsx'] ??= () => {};
  function add(filename) {
    if (sources[filename]) return filename;
    let source = fs.readFileSync(filename, 'utf8');
    if (/\.tsx?$/.test(filename)) source = ts.transpileModule(source, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    sources[filename] = source; maps[filename] = {};
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const request = match[1];
      if (request.endsWith('.development.js')) continue; // The fixture runs React's production entry.
      maps[filename][request] = add(createRequire(filename).resolve(request.startsWith('@/') ? path.join(root, request.slice(2)) : request));
    }
    return filename;
  }
  try {
    const entry = add(path.join(root, 'components/live-scores/FootballPlayByPlay.tsx'));
    const ncaa = add(path.join(root, 'components/ncaa/NcaaGameCenterModal.tsx'));
    const react = add(require.resolve('react')), client = add(require.resolve('react-dom/client'));
    return `const process = { env: { NODE_ENV: 'production' } }; const global = globalThis;
      const sources = ${JSON.stringify(sources)}, maps = ${JSON.stringify(maps)}, cache = {};
      function load(id) {
        if (cache[id]) return cache[id].exports;
        const m = cache[id] = { exports: {} };
        new Function('require', 'module', 'exports', sources[id])(r => load(maps[id][r]), m, m.exports);
        return m.exports;
      }
      window.FootballPbp = load(${JSON.stringify(entry)}).default;
      window.NcaaGameCenter = load(${JSON.stringify(ncaa)}).default;
      window.React = load(${JSON.stringify(react)});
      window.ReactDOMClient = load(${JSON.stringify(client)});`;
  } finally {
    if (oldTs) require.extensions['.ts'] = oldTs; else delete require.extensions['.ts'];
    if (oldTsx) require.extensions['.tsx'] = oldTsx; else delete require.extensions['.tsx'];
  }
};
