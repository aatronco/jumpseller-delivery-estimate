(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Store = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'eta:comuna';

  function createStore(opts) {
    var storage = opts.storage || null;
    var target = opts.eventTarget || null;
    var memory = null;

    function get() {
      try {
        var raw = storage && storage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* blocked or corrupted: fall through */ }
      return memory;
    }

    function set(comuna) {
      memory = comuna;
      try { if (storage) storage.setItem(KEY, JSON.stringify(comuna)); } catch (e) { /* memory only */ }
      if (target) {
        var Ctor = (target.defaultView && target.defaultView.CustomEvent) ||
          (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
        if (Ctor) target.dispatchEvent(new Ctor('eta:comuna-changed', { detail: comuna }));
      }
    }

    return { get: get, set: set };
  }

  return { createStore: createStore, KEY: KEY };
});
