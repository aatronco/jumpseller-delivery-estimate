(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Data = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var QUOTE_URL = 'https://api.jumpseller.com/landing/estimate_rates.json';

  function createData(opts) {
    var rules = opts.rules;
    var timeoutMs = opts.timeoutMs || 10000;
    var ttlMs = opts.ttlMs || 6 * 3600e3;
    var emptyTtlMs = opts.emptyTtlMs || 10 * 60e3;
    var productCache = {};

    function readCache(key) {
      try { var raw = opts.storage && opts.storage.getItem(key); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    }
    function writeCache(key, value) {
      try { if (opts.storage) opts.storage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }

    function loadProduct(productId) {
      if (!productCache[productId]) {
        productCache[productId] = opts.fetch('/api/products/' + productId + '.json')
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      }
      return productCache[productId];
    }

    function weightFor(productId, variantId) {
      var cartP = Promise.resolve().then(opts.getCart).catch(function () { return null; });
      return Promise.all([cartP, loadProduct(productId)]).then(function (res) {
        var cart = rules.cartWeight(res[0], productId, variantId);
        var item = rules.variantWeight(res[1], variantId);
        return Math.round((cart.kg + (cart.containsCurrent ? 0 : item)) * 1000) / 1000;
      });
    }

    function quote(comuna, kg) {
      var weight = rules.roundKg(kg);
      var box = opts.box.length + 'x' + opts.box.width + 'x' + opts.box.height;
      var key = 'eta:q:' + opts.origin.id + ':' + box + ':' + opts.services.join(',') + '|' + comuna.id + '|' + weight;
      var cached = readCache(key);
      if (cached && Array.isArray(cached.quotes)) {
        var ttl = cached.quotes.length ? ttlMs : emptyTtlMs;
        if (opts.now() - cached.t < ttl) return Promise.resolve(cached.quotes);
      }
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      var body = { rates: {
        origin_address: { country: 'CL', region: opts.origin.region, municipality: opts.origin.id },
        shipping_address: { country: 'CL', region: comuna.region, municipality: comuna.id },
        packages_dimensions: [{ length: opts.box.length, width: opts.box.width, height: opts.box.height, weight: weight }],
      } };
      return opts.fetch(QUOTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(function (rates) {
          var quotes = rules.filterHomeDelivery(rates, opts.services);
          writeCache(key, { t: opts.now(), quotes: quotes });
          return quotes;
        });
      }).catch(function () {
        // An error behaves like [] for later calls (short TTL); this call still resolves null.
        writeCache(key, { t: opts.now(), quotes: [] });
        return null;
      }).finally(function () { clearTimeout(timer); });
    }

    return { weightFor: weightFor, quote: quote };
  }

  return { createData: createData, QUOTE_URL: QUOTE_URL };
});
