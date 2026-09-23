(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Rules = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var noop = function () {};

  function normalizeComuna(name) {
    return String(name || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function parseList(text) {
    return String(text || '').split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function parseTable(text, warn) {
    warn = warn || noop;
    var tiers = [];
    parseList(text).forEach(function (line) {
      var m = line.match(/^(\*|\d+(?:\.\d+)?)\s*=\s*([\d.]+)$/);
      if (!m) { warn('[eta] invalid flat-rate line: ' + line); return; }
      tiers.push({
        maxKg: m[1] === '*' ? Infinity : parseFloat(m[1]),
        price: parseInt(m[2].replace(/\./g, ''), 10),
      });
    });
    return tiers.sort(function (a, b) { return a.maxKg - b.maxKg; });
  }

  function resolveComunas(names, comunas, warn) {
    warn = warn || noop;
    var index = {};
    comunas.forEach(function (c) { index[normalizeComuna(c.name)] = c; });
    var out = [];
    names.forEach(function (name) {
      var c = index[normalizeComuna(name)];
      if (c) out.push(c); else warn('[eta] unknown comuna: ' + name);
    });
    return out;
  }

  function flatRate(comunaId, kg, cfg) {
    if (cfg.flatComunaIds.indexOf(String(comunaId)) === -1) return null;
    for (var i = 0; i < cfg.flatTiers.length; i++) {
      if (kg <= cfg.flatTiers[i].maxKg) return cfg.flatTiers[i].price;
    }
    return null;
  }

  function parseClp(text) {
    var digits = String(text == null ? '' : text).replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  function formatClp(n) {
    return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function parseServices(text) {
    return parseList(text).map(function (s) {
      var parts = s.split(':');
      return parts[0].trim().toLowerCase() + ':' + (parts[1] || '').trim().toUpperCase();
    });
  }

  function filterHomeDelivery(rates, services) {
    if (!Array.isArray(rates)) return [];
    var out = [];
    rates.forEach(function (r) {
      var key = String(r.fulfillment_company).toLowerCase() + ':' + String(r.service_code).toUpperCase();
      var amount = parseClp(r.amount);
      if (services.indexOf(key) !== -1 && amount > 0) {
        out.push({ company: r.fulfillment_company, label: r.service_label, amount: amount });
      }
    });
    return out;
  }

  function pickPrice(flat, quotes) {
    var best = null;
    (quotes || []).forEach(function (q) { if (best === null || q.amount < best) best = q.amount; });
    if (flat != null && (best === null || flat <= best)) return { price: flat, source: 'flat' };
    if (best !== null) return { price: best, source: 'courier' };
    return { price: null, source: null };
  }

  function cartWeight(cart, productId, variantId) {
    var lines = (cart && Array.isArray(cart.products)) ? cart.products : [];
    var kg = 0;
    var containsCurrent = false;
    lines.forEach(function (l) {
      kg += (Number(l.weight) || 0) * (Number(l.qty) || 0);
      if (String(l.product_id) === String(productId) &&
          String(l.variant_id == null ? '' : l.variant_id) === String(variantId == null ? '' : variantId)) {
        containsCurrent = true;
      }
    });
    return { kg: Math.round(kg * 1000) / 1000, containsCurrent: containsCurrent };
  }

  function variantWeight(product, variantId) {
    if (!product) return 0;
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) {
      if (String(variants[i].id) === String(variantId) && Number(variants[i].weight) > 0) {
        return Number(variants[i].weight);
      }
    }
    return Number(product.weight) || 0;
  }

  function roundKg(kg) {
    return Math.max(0.5, Math.ceil(kg * 2) / 2);
  }

  var WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function parseCutoff(text, warn) {
    var m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) { (warn || noop)('[eta] invalid cutoff: ' + text); return 840; }
    return (+m[1]) * 60 + (+m[2]);
  }

  function localParts(now, timeZone) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(now).forEach(function (p) { parts[p.type] = p.value; });
    return {
      date: parts.year + '-' + parts.month + '-' + parts.day,
      weekday: WEEKDAY_INDEX[parts.weekday],
      minutes: (+parts.hour) * 60 + (+parts.minute),
    };
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
  }

  function promiseDay(now, cfg) {
    var local = localParts(now, cfg.timeZone || 'America/Santiago');
    var isDispatch = function (date, weekday) {
      return cfg.dispatchDays.indexOf(weekday) !== -1 && cfg.holidays.indexOf(date) === -1;
    };
    if (isDispatch(local.date, local.weekday) && local.minutes < cfg.cutoffMin) {
      return { kind: 'today', label: 'hoy', minutesLeft: cfg.cutoffMin - local.minutes };
    }
    for (var n = 1; n <= 14; n++) {
      var day = addDays(local.date, n);
      if (isDispatch(day.date, day.weekday)) {
        return n === 1
          ? { kind: 'tomorrow', label: 'mañana', minutesLeft: null }
          : { kind: 'later', label: 'el ' + WEEKDAYS_ES[day.weekday], minutesLeft: null };
      }
    }
    return null;
  }

  function formatCountdown(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h && m) return h + ' h ' + m + ' min';
    return h ? h + ' h' : m + ' min';
  }

  return {
    normalizeComuna: normalizeComuna, parseList: parseList, parseTable: parseTable,
    resolveComunas: resolveComunas, flatRate: flatRate, parseClp: parseClp, formatClp: formatClp,
    parseServices: parseServices, filterHomeDelivery: filterHomeDelivery, pickPrice: pickPrice,
    cartWeight: cartWeight, variantWeight: variantWeight, roundKg: roundKg,
    parseCutoff: parseCutoff, promiseDay: promiseDay, formatCountdown: formatCountdown,
  };
});
