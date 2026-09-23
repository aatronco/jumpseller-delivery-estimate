(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.UI = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GEO_FIELDS = ['municipality', 'city_district', 'town', 'village', 'suburb', 'city', 'county'];

  // Shoppers type "Aysén"/"Aysen" and Nominatim may return "Aysén", but the
  // official comuna name in the data is "Aisén". Map the normalized alias to
  // the normalized official name so both search and geolocation match it.
  var COMUNA_ALIASES = { aysen: 'aisen' };

  function normalize(name, rules) {
    var n = rules.normalizeComuna(name);
    return COMUNA_ALIASES[n] || n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var changeBtn = function (text) {
    return '<button type="button" class="eta-widget__change" data-eta-open>' + text + '</button>';
  };

  function renderWidget(el, state, rules) {
    var html;
    var name = state.comuna ? escapeHtml(state.comuna.name) : '';
    if (state.kind === 'no-comuna') {
      html = '<p class="eta-widget__title">Envío a todo Chile</p>' +
        '<p class="eta-widget__meta">' + changeBtn('📍 ¿Dónde lo recibes?') + '</p>';
    } else if (state.kind === 'loading') {
      html = '<p class="eta-widget__title">Envío a ' + name + ' <span class="eta-widget__skeleton" aria-hidden="true"></span></p>' +
        '<p class="eta-widget__meta">&nbsp;</p>';
    } else if (state.kind === 'unavailable') {
      html = '<p class="eta-widget__title">Envío a ' + name + ': se calcula en el checkout</p>' +
        '<p class="eta-widget__meta">' + changeBtn('Cambiar comuna') + '</p>';
    } else {
      var price = '<strong>' + rules.formatClp(state.price) + '</strong>';
      var p = state.promise;
      if (state.source === 'flat' && p) {
        html = '<p class="eta-widget__title">Llega <strong>' + p.label + '</strong> por ' + price + '</p>' +
          '<p class="eta-widget__meta">a ' + name + ' · ' + changeBtn('Cambiar') + '</p>';
        if (state.showCountdown && p.kind === 'today' && p.minutesLeft > 0) {
          html += '<p class="eta-widget__countdown">Compra en las próximas ' + rules.formatCountdown(p.minutesLeft) + '</p>';
        }
      } else {
        html = '<p class="eta-widget__title">Envío a ' + name + ' desde ' + price + '</p>' +
          '<p class="eta-widget__meta">' + changeBtn('Cambiar comuna') + '</p>';
      }
    }
    var className = 'eta-widget eta-widget--' + state.kind;
    html = '<span class="eta-widget__icon" aria-hidden="true">🚚</span><div class="eta-widget__body">' + html + '</div>';
    // Skip identical writes so aria-live regions are not re-announced. The source
    // HTML is kept on the element because innerHTML re-serializes (e.g. data-eta-open="").
    if (el.className === className && el._etaHtml === html) return;
    el.className = className;
    el.innerHTML = html;
    el._etaHtml = html;
  }

  function searchComunas(query, comunas, rules, limit) {
    limit = limit || 8;
    var q = normalize(query, rules);
    if (!q) return [];
    var prefix = [];
    var inner = [];
    comunas.forEach(function (c) {
      var n = normalize(c.name, rules);
      if (n.indexOf(q) === 0) prefix.push(c);
      else if (n.indexOf(q) > 0) inner.push(c);
    });
    return prefix.concat(inner).slice(0, limit);
  }

  function geoToComuna(result, comunas, rules) {
    if (!result) return null;
    var index = {};
    comunas.forEach(function (c) { index[normalize(c.name, rules)] = c; });
    var address = result.address || {};
    var candidates = [result.name].concat(GEO_FIELDS.map(function (f) { return address[f]; }));
    for (var i = 0; i < candidates.length; i++) {
      var hit = candidates[i] && index[normalize(candidates[i], rules)];
      if (hit) return hit;
    }
    return null;
  }

  function renderLabel(el, comuna) {
    el.textContent = comuna ? 'Enviar a ' + comuna.name : '¿Dónde lo recibes?';
  }

  function mountPanel(panel, opts) {
    var input = panel.querySelector('.eta-panel__search');
    var list = panel.querySelector('.eta-panel__list');
    var msg = panel.querySelector('[data-eta-msg]');
    var geoBtn = panel.querySelector('[data-eta-geo]');

    var opener = null;

    function showMsg(text) { msg.textContent = text; msg.hidden = !text; }
    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      opener = null;
    }
    function open() {
      opener = panel.ownerDocument.activeElement;
      panel.hidden = false; input.value = ''; list.innerHTML = ''; showMsg('');
      if (input.focus) input.focus();
    }
    function pick(c) { opts.onPick(c); close(); }

    input.addEventListener('input', function () {
      var matches = searchComunas(input.value, opts.comunas, opts.rules);
      list.innerHTML = '';
      matches.forEach(function (c) {
        var li = panel.ownerDocument.createElement('li');
        var b = panel.ownerDocument.createElement('button');
        b.type = 'button'; b.textContent = c.name;
        b.addEventListener('click', function () { pick(c); });
        li.appendChild(b); list.appendChild(li);
      });
      showMsg(input.value.trim() && !matches.length ? 'No encontramos esa comuna' : '');
    });
    geoBtn.addEventListener('click', function () {
      showMsg('Buscando tu ubicación…');
      opts.geolocate().then(function (c) {
        if (c) pick(c); else showMsg('No pudimos detectar tu comuna. Búscala en la lista.');
      }, function () { showMsg('No pudimos detectar tu comuna. Búscala en la lista.'); });
    });
    panel.querySelectorAll('[data-eta-close]').forEach(function (b) { b.addEventListener('click', close); });
    panel.ownerDocument.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    return { open: open, close: close };
  }

  return {
    renderWidget: renderWidget, searchComunas: searchComunas, geoToComuna: geoToComuna,
    renderLabel: renderLabel, mountPanel: mountPanel, escapeHtml: escapeHtml,
  };
});
