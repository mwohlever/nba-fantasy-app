import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const cache = new Map();
function moduleUrl(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename);
  // Next owns this build-time guard; plain Node tests have no Client Components.
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText.replace(/import ["']server-only["'];?/g, '').replace(/from ['"](\.\.?\/[^'"]+)['"]/g, (_, spec) => `from '${moduleUrl(path.resolve(path.dirname(filename), spec + '.ts'))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  cache.set(filename, url); return url;
}
export const importTs = filename => import(moduleUrl(filename));
