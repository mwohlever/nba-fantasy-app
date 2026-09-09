/* Minimal hook host for testing page-owned callbacks/state without browser data writes. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '../..');
let current = null;
const context = { pathname: '/lineups/scores', sport: 'nba', group: 'group-a', loading: false, switching: false };
const mockedReact = { ...React,
  useState(initial) {
    if (!current) return React.useState(initial);
    const host = current, i = host.cursor++;
    if (!(i in host.values)) host.values[i] = typeof initial === 'function' ? initial() : initial;
    return [host.values[i], next => { host.values[i] = typeof next === 'function' ? next(host.values[i]) : next; }];
  },
  useRef(initial) {
    if (!current) return React.useRef(initial);
    const host = current, i = host.cursor++;
    return host.values[i] ??= { current: initial };
  },
  useMemo(fn) { return current ? fn() : React.useMemo(fn, []); },
  useEffect(fn, deps) {
    if (!current) return React.useEffect(fn, deps);
    const host = current, i = host.cursor++;
    const previous = host.values[i];
    if (!previous || !deps || deps.some((v, j) => !Object.is(v, previous.deps?.[j]))) {
      host.effects.push(() => { previous?.cleanup?.(); host.values[i] = { deps, cleanup: fn() }; });
    }
  },
};
const load = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request.includes('client/usePullToRefresh') && context.capturePull) return { usePullToRefresh: options => { context.pullOptions = options; return { distance: 0, armed: false }; } };
  if (request === 'react') return mockedReact;
  if (request === 'next/navigation') return { usePathname: () => context.pathname, useSearchParams: () => new URLSearchParams({ sport: context.sport }) };
  if (request.includes('providers/GroupProvider')) return { useGroupContext: () => ({
    groupContext: { group: { id: context.group }, team: context.team == null ? null : { id: context.team } }, isLoading: context.loading, isSwitchingGroup: context.switching,
  }) };
  if (request.includes('providers/SportProvider')) return { useSelectedSport: () => ({ selectedSport: context.sport, setSelectedSport() {} }) };
  return load.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
};
function host(component) {
  const state = { cursor: 0, values: [], effects: [] };
  return {
    render(props, effects = false) {
      state.cursor = 0; state.effects = []; current = state;
      let tree;
      try { tree = component(props); } finally { current = null; }
      if (effects) state.effects.forEach(fn => fn());
      return tree;
    },
    unmount() { state.values.forEach(value => value?.cleanup?.()); },
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
module.exports = { host, nodes, context, React };
