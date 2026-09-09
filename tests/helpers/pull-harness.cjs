// Minimal DOM/event adapter for exercising the real gesture with React control markup.
const { attachPullToRefresh } = require('../../lib/client/pullToRefresh.ts');
function element(node, parent = null) {
  const props = node.props ?? {};
  return {
    parent,
    matches(selector) {
      return selector.split(',').some(part => {
        const match = part.trim().match(/^([a-z]+)?(?:\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\])?$/);
        if (!match) throw new Error(`Unsupported test selector: ${part}`);
        const [, tag, attr, value] = match;
        return (!tag || node.type === tag) && (!attr || (props[attr] !== undefined &&
          (value === undefined || String(props[attr]) === value)));
      });
    },
    closest(selector) { return this.matches(selector) ? this : parent?.closest(selector) ?? null; },
  };
}
function pullHarness(onRefresh = async () => ({ status: 'success' }), options = {}) {
  const listeners = new Map();
  const target = { contains: () => true,
    addEventListener: (type, handler, options) => listeners.set(type, { handler, options }),
    removeEventListener: type => listeners.delete(type) };
  const document = { scrollingElement: { scrollTop: 0 }, querySelector: () => null,
    documentElement: { style: { getPropertyValue: () => '', getPropertyPriority: () => '',
      setProperty() {}, removeProperty() {} } } };
  const context = { enabled: true, isRefreshing: false, scopeKey: 'group-a:nba:1' };
  const dispose = attachPullToRefresh({ ...options, target, document, getContext: () => context, onChange() {}, onRefresh });
  function emit(type, target, x = 0, y = 0, cancelable = true) {
    const listener = listeners.get(type);
    const event = { target, cancelable, defaultPrevented: false,
      touches: type === 'touchend' ? [] : [{ identifier: 0, clientX: x, clientY: y }],
      preventDefault() { if (cancelable && !listener?.options.passive) this.defaultPrevented = true; } };
    listener?.handler(event);
    return event;
  }
  return { emit, dispose, document, context };
}
module.exports = { element, pullHarness };
