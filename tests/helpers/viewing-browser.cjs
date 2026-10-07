/* eslint-disable @typescript-eslint/no-require-imports */
/* Synthetic browser URL/storage adapter; never represents authenticated testing. */
const { context } = require('./scores-harness.cjs');
function installViewingBrowser(pathname, search = '', entries = {}, autoNavigate = true) {
  const memory = new Map(Object.entries(entries));
  const navigation = [];
  context.pathname = pathname;
  context.search = search;
  function navigate(href, method) {
    navigation.push({ href, method });
    if (autoNavigate) {
      const url = new URL(href, 'http://test');
      context.pathname = url.pathname;
      context.search = url.search;
    }
  }
  context.navigate = navigate;
  if (global.window) delete global.window.localStorage;
  global.window = { ...global.window, location: {
    get pathname() { return context.pathname; },
    get search() { return context.search; },
  }, localStorage: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key),
  }, history: {
    pushState: (_state, _title, href) => navigate(href, 'push'),
    replaceState: (_state, _title, href) => navigate(href, 'replace'),
  }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  return { memory, navigation, navigate };
}
module.exports = { installViewingBrowser };
