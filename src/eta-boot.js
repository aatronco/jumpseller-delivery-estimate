(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Boot = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_BOX = { length: 30, width: 20, height: 10 };

  function readConfig(ds, comunas, rules, warn) {
    warn = warn || function (m) { if (typeof console !== 'undefined') console.warn(m); };
    var origin = rules.resolveComunas([ds.origin || 'Santiago'], comunas, warn)[0] ||
      rules.resolveComunas(['Santiago'], comunas)[0];
    var dims = String(ds.box || '').split('x').map(Number);
    var box = dims.length === 3 && dims.every(function (n) { return n > 0; })
      ? { length: dims[0], width: dims[1], height: dims[2] } : DEFAULT_BOX;
    return {
      origin: origin,
      cutoffMin: rules.parseCutoff(ds.cutoff || '14:00', warn),
      dispatchDays: rules.parseList(ds.days).map(Number).filter(function (n) { return n >= 0 && n <= 6; }),
      holidays: rules.parseList(ds.holidays),
      flatComunaIds: rules.resolveComunas(rules.parseList(ds.flatComunas), comunas, warn).map(function (c) { return c.id; }),
      flatTiers: rules.parseTable(ds.flatTable, warn),
      showCountdown: ds.countdown === '1',
      box: box,
      services: rules.parseServices(ds.services),
    };
  }

  function start(o) {
    var doc = o.doc, cfg = o.config, rules = o.rules, ui = o.ui;
    var widget = doc.querySelector('[data-eta-widget]');
    var labels = doc.querySelectorAll('[data-eta-label]');
    var panelEl = doc.querySelector('[data-eta-panel]');
    var seq = 0;
    var last = null; // { comuna, kg, flat, quotes } from the latest completed update

    var panel = panelEl && ui.mountPanel(panelEl, {
      comunas: o.comunas, rules: rules,
      onPick: function (c) { o.store.set(c); },
      geolocate: o.geolocate || function () { return Promise.resolve(null); },
    });
    doc.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-eta-open]');
      if (t && panel) { e.preventDefault(); panel.open(); }
    });

    function renderPriced(comuna, flat, quotes) {
      var pick = rules.pickPrice(flat, quotes);
      if (pick.price == null) { ui.renderWidget(widget, { kind: 'unavailable', comuna: comuna }, rules); return; }
      ui.renderWidget(widget, { kind: 'priced', comuna: comuna, price: pick.price, source: pick.source,
        promise: pick.source === 'flat' ? rules.promiseDay(o.now(), cfg) : null, showCountdown: cfg.showCountdown }, rules);
    }

    function update() {
      var mySeq = ++seq;
      last = null;
      var comuna = o.store.get();
      labels.forEach(function (l) { ui.renderLabel(l, comuna); });
      if (!widget) return Promise.resolve();
      if (!comuna) { ui.renderWidget(widget, { kind: 'no-comuna' }, rules); return Promise.resolve(); }

      var productId = widget.getAttribute('data-product-id');
      return o.data.weightFor(productId, o.getVariantId()).then(function (kg) {
        if (mySeq !== seq) return;
        var flat = rules.flatRate(comuna.id, kg, cfg);
        var render = function (quotes) {
          if (mySeq !== seq) return;
          last = { comuna: comuna, kg: kg, flat: flat, quotes: quotes };
          renderPriced(comuna, flat, quotes);
        };
        if (flat != null) render([]); else ui.renderWidget(widget, { kind: 'loading', comuna: comuna }, rules);
        return o.data.quote(comuna, kg).then(render);
      }).catch(function (err) {
        if (typeof console !== 'undefined') console.warn('[eta] update failed', err);
        if (mySeq === seq) ui.renderWidget(widget, { kind: 'unavailable', comuna: comuna }, rules);
      });
    }

    // Timer tick: only the day promise depends on the clock, so re-render it from
    // the stored result instead of re-fetching the cart and quotes.
    function refreshPromise() {
      if (!last || rules.pickPrice(last.flat, last.quotes).source !== 'flat') return;
      renderPriced(last.comuna, last.flat, last.quotes);
    }

    doc.addEventListener('eta:comuna-changed', function () { update(); });
    doc.addEventListener('change', function (e) {
      var t = e.target && e.target.closest && e.target.closest('product-form, form[name="buy"]');
      if (t) o.win.setTimeout(update, 0);
    });
    var counter = doc.querySelector('.theme-cart-counter');
    if (counter && o.win.MutationObserver) {
      new o.win.MutationObserver(function () { update(); })
        .observe(counter, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    if (o.win.setInterval && !o.noInterval) o.win.setInterval(refreshPromise, 60000);

    return { update: update, refreshPromise: refreshPromise };
  }

  function getCartPromise(win) {
    return new Promise(function (resolve) {
      if (!win.Jumpseller || !win.Jumpseller.getCart) { resolve(null); return; }
      setTimeout(function () { resolve(null); }, 3000); // getCart may never call back
      win.Jumpseller.getCart({ callback: function (c) { resolve(c && Array.isArray(c.products) ? c : null); } });
    });
  }

  function geolocate(win, comunas, rules, ui) {
    return new Promise(function (resolve) {
      if (!win.navigator.geolocation) { resolve(null); return; }
      win.navigator.geolocation.getCurrentPosition(function (pos) {
        var url = 'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=10' +
          '&lat=' + pos.coords.latitude + '&lon=' + pos.coords.longitude;
        win.fetch(url).then(function (r) { return r.json(); })
          .then(function (j) { resolve(ui.geoToComuna(j, comunas, rules)); })
          .catch(function () { resolve(null); });
      }, function () { resolve(null); }, { timeout: 10000 });
    });
  }

  function getVariantIdFrom(doc, from) {
    var pf = (from && from.closest && from.closest('product-form')) || doc.querySelector('product-form');
    if (pf && pf.variant && pf.variant.id != null) return String(pf.variant.id);
    var el = doc.querySelector('form[name="buy"] [name="variant_id"], form[name="buy"] [name="variant"]');
    return el && el.value ? el.value : null;
  }

  function autoStart(win) {
    var doc = win.document;
    var cfgEl = doc.getElementById('eta-config');
    if (!cfgEl || !win.Eta) return;
    var E = win.Eta;
    var storage = null;
    try { storage = win.localStorage; } catch (e) { storage = null; }
    var config = readConfig(cfgEl.dataset, E.Comunas, E.Rules);
    var app = start({
      doc: doc, win: win, config: config, comunas: E.Comunas, rules: E.Rules, ui: E.UI,
      store: E.Store.createStore({ storage: storage, eventTarget: doc }),
      data: E.Data.createData({
        rules: E.Rules, fetch: win.fetch.bind(win), storage: storage,
        getCart: function () { return getCartPromise(win); },
        now: function () { return Date.now(); },
        origin: config.origin, box: config.box, services: config.services,
      }),
      now: function () { return new Date(); },
      getVariantId: function () { return getVariantIdFrom(doc, doc.querySelector('[data-eta-widget]')); },
      geolocate: function () { return geolocate(win, E.Comunas, E.Rules, E.UI); },
    });
    app.update();
  }

  if (typeof window !== 'undefined' && typeof module === 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { autoStart(window); });
    else autoStart(window);
  }

  return { readConfig: readConfig, start: start, getVariantIdFrom: getVariantIdFrom };
});
