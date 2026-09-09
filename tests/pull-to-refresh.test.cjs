const assert = require('node:assert/strict');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const { attachPullToRefresh } = require('../lib/client/pullToRefresh.ts');
const { createRefreshScope } = require('../lib/client/refreshScope.ts');
const { usePullToRefresh } = require('../lib/client/usePullToRefresh.ts');
const { host } = require('./helpers/scores-harness.cjs');
function fixture() {
  const listeners = new Map(), properties = new Map([['overscroll-behavior-y', ['auto', 'important']]]);
  const style = {
    getPropertyValue: key => properties.get(key)?.[0] ?? '',
    getPropertyPriority: key => properties.get(key)?.[1] ?? '',
    setProperty: (key, value, priority = '') => properties.set(key, [value, priority]),
    removeProperty: key => properties.delete(key),
  };
  const target = { contains: element => element.inside !== false,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const document = { documentElement: { style }, scrollingElement: { scrollTop: 0 }, querySelector: () => null };
  let context = { enabled: true, isRefreshing: false, scopeKey: 'a' }, calls = 0, state;
  const refresh = async () => { calls++; return { status: 'success' }; };
  const options = { target, document, getContext: () => context, onChange: next => { state = next; }, onRefresh: refresh };
  const clean = attachPullToRefresh(options);
  const emit = (name, x = 0, y = 0, count = name === 'touchend' ? 0 : 1, excluded = false) => {
    const touches = Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y }));
    listeners.get(name)?.({ touches, target: { closest: () => excluded }, cancelable: true, preventDefault() {} });
  };
  return { emit, clean, target, document, properties, options, listeners,
    setContext: change => { context = { ...context, ...change }; }, calls: () => calls, state: () => state };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('valid top pull triggers once; repeated end and concurrent pull are ignored', async () => {
  const f = fixture(); f.emit('touchstart'); f.emit('touchmove', 0, 75);
  assert.equal(f.state().armed, true);
  f.emit('touchend'); f.emit('touchend');
  f.emit('touchstart'); f.emit('touchmove', 0, 90); f.emit('touchend');
  await tick(); assert.equal(f.calls(), 1); f.clean();
});
for (const [name, sequence] of [
  ['short pull', f => { f.emit('touchstart'); f.emit('touchmove', 0, 69); }],
  ['mid-page start, even after reaching top', f => { f.document.scrollingElement.scrollTop = 100; f.emit('touchstart'); f.document.scrollingElement.scrollTop = 0; f.emit('touchmove', 0, 100); }],
  ['horizontal/diagonal intent', f => { f.emit('touchstart'); f.emit('touchmove', 50, 60); f.emit('touchmove', 50, 120); }],
  ['reversal', f => { f.emit('touchstart'); f.emit('touchmove', 0, 100); f.emit('touchmove', 0, 60); f.emit('touchmove', 0, 120); }],
  ['touchcancel', f => { f.emit('touchstart'); f.emit('touchmove', 0, 90); f.emit('touchcancel'); }],
  ['multi-touch start', f => { f.emit('touchstart', 0, 0, 2); f.emit('touchmove', 0, 90); }],
  ['multi-touch during pull', f => { f.emit('touchstart'); f.emit('touchmove', 0, 90, 2); }],
  ['disabled/locked', f => { f.setContext({ enabled: false }); f.emit('touchstart'); f.emit('touchmove', 0, 90); }],
  ['already refreshing', f => { f.setContext({ isRefreshing: true }); f.emit('touchstart'); f.emit('touchmove', 0, 90); }],
  ['excluded control/strip', f => { f.emit('touchstart', 0, 0, 1, true); f.emit('touchmove', 0, 90); }],
  ['modal open', f => { f.document.querySelector = () => ({}); f.emit('touchstart'); f.emit('touchmove', 0, 90); }],
  ['scope changed', f => { f.emit('touchstart'); f.emit('touchmove', 0, 90); f.setContext({ scopeKey: 'b' }); }],
]) test(`${name} never refreshes`, async () => {
  const f = fixture(); sequence(f); f.emit('touchend'); await tick();
  assert.equal(f.calls(), 0); assert.deepEqual(f.state(), { distance: 0, armed: false }); f.clean();
});
test('cleanup restores exact document policy and listeners; queued release cannot run after cleanup', async () => {
  const f = fixture(); assert.equal(f.properties.get('overscroll-behavior-y')[0], 'contain');
  f.emit('touchstart'); f.emit('touchmove', 0, 90); f.emit('touchend'); f.clean(); await tick();
  assert.equal(f.calls(), 0); assert.deepEqual(f.properties.get('overscroll-behavior-y'), ['auto', 'important']);
  assert.equal(f.listeners.size, 0);
});
test('hook resets a pending gesture and restores policy when scope changes or becomes disabled', () => {
  const f = fixture(); f.clean(); global.document = f.document;
  const h = host(usePullToRefresh);
  const props = { targetRef: { current: f.target }, enabled: true, isRefreshing: false, scopeKey: 'a', onRefresh: f.options.onRefresh };
  h.render(props, true); f.emit('touchstart'); f.emit('touchmove', 0, 90);
  assert.equal(h.render(props).armed, true);
  h.render({ ...props, scopeKey: 'b' }, true);
  assert.equal(h.render({ ...props, scopeKey: 'b' }).distance, 0);
  h.render({ ...props, scopeKey: 'b', enabled: false }, true);
  assert.deepEqual(f.properties.get('overscroll-behavior-y'), ['auto', 'important']); h.unmount(); delete global.document;
});
test('scope generations reject Group/sport/slate changes, A-B-A and unmount', () => {
  const scope = createRefreshScope('group-a:nba:1'); const old = scope.capture();
  scope.update('group-b:nfl:2'); scope.update('group-a:nba:1'); assert.equal(old(), false);
  const latest = scope.capture(); assert.equal(latest(), true); scope.invalidate(); assert.equal(latest(), false);
});
test('disposed listeners cannot emit state or refresh even if a caller retained a listener', async () => {
  const f = fixture(); const start = f.listeners.get('touchstart'), move = f.listeners.get('touchmove'), end = f.listeners.get('touchend');
  f.clean(); const previousState = f.state();
  start({ touches: [{ identifier: 0, clientX: 0, clientY: 0 }], target: { closest: () => false } });
  move({ touches: [{ identifier: 0, clientX: 0, clientY: 100 }], cancelable: true, preventDefault() {} });
  end({ touches: [] }); await tick();
  assert.equal(f.calls(), 0); assert.equal(f.state(), previousState);
});
test('cleanup removes temporary policy when no inline policy existed', () => {
  const f = fixture(); f.clean(); f.properties.clear();
  const dispose = attachPullToRefresh(f.options); dispose();
  assert.equal(f.properties.has('overscroll-behavior-y'), false);
});
test('polling becoming busy cancels the active pull without showing gesture feedback', () => {
  const f = fixture(); f.clean(); global.document = f.document;
  const h = host(usePullToRefresh);
  const props = { targetRef: { current: f.target }, enabled: true, isRefreshing: false, scopeKey: 'a', onRefresh: f.options.onRefresh };
  h.render(props, true); f.emit('touchstart'); f.emit('touchmove', 0, 90);
  h.render({ ...props, isRefreshing: true }, true);
  assert.equal(h.render({ ...props, isRefreshing: true }).distance, 0);
  assert.equal(f.listeners.size, 0); h.unmount(); delete global.document;
});

const { element, pullHarness } = require('./helpers/pull-harness.cjs');
for (const [name, node, parent] of [
  ['ordinary button', { type: 'button' }],
  ['player action', { type: 'button' }, { type: 'div', props: { 'data-pull-refresh-exclude': true } }],
  ['explicit opt-out wins over opt-in', { type: 'button', props: { 'data-scores-pull-start': 'true', 'data-pull-refresh-exclude': true } }],
  ['settings summary', { type: 'summary' }],
  ['modal control', { type: 'button', props: { 'data-scores-pull-start': 'true' } }, { type: 'div', props: { role: 'dialog' } }],
  ['link inside opt-in', { type: 'a' }, { type: 'button', props: { 'data-scores-pull-start': 'true' } }],
]) test(`${name} remains excluded with Scores opt-in support`, async () => {
  let calls = 0;
  const f = pullHarness(async () => { calls++; return { status: 'success' }; });
  const target = element(node, parent ? element(parent) : null);
  f.emit('touchstart', target); f.emit('touchmove', target, 0, 100); f.emit('touchend', target);
  await tick(); assert.equal(calls, 0); f.dispose();
});
test('completed opted-in pull cancels native touch-end click before hook cleanup; tap does not', async () => {
  let calls = 0;
  const f = pullHarness(async () => { calls++; return { status: 'success' }; });
  const target = element({ type: 'span' }, element({ type: 'button', props: { 'data-scores-pull-start': 'true' } }));
  f.emit('touchstart', target);
  assert.equal(f.emit('touchend', target).defaultPrevented, false);
  f.emit('touchstart', target); f.emit('touchmove', target, 0, 90);
  assert.equal(f.emit('touchend', target).defaultPrevented, true);
  await tick(); assert.equal(calls, 1);
  f.dispose();
});
test('browser-owned noncancelable row release never refreshes alongside a possible native click', async () => {
  let calls = 0;
  const f = pullHarness(async () => { calls++; return { status: 'success' }; });
  const target = element({ type: 'button', props: { 'data-scores-pull-start': 'true' } });
  f.emit('touchstart', target); f.emit('touchmove', target, 0, 90);
  assert.equal(f.emit('touchend', target, 0, 90, false).defaultPrevented, false);
  await tick(); assert.equal(calls, 0); f.dispose();
});
