# Installing in a Jumpseller 4.x theme

Everything is gated by the `eta_enabled` theme option (off by default): uploading the files changes nothing until it is turned on.

## 1. Copy files

| From `theme-kit/` | To theme |
|---|---|
| `assets/eta-widget.js`, `assets/eta-widget.css` | `assets/` |
| `partials/eta_config.liquid`, `eta_selector.liquid`, `eta_widget.liquid` | `partials/` |

From `config/options-group.json`, paste the `delivery-estimate` key and its object as a new entry inside the `"groups"` object of `config/options.json`, immediately before the `"translations"` group (add a comma after the preceding group).

The four list options (`eta_holidays`, `eta_flat_comunas`, `eta_flat_table`, `eta_services`) use `"type": "text"` (the multi-line field type in Jumpseller 4.x themes). If the target theme's `options.json` has no `"text"` option type (check with `grep -o '"type": *"[a-z_]*"' config/options.json | sort | uniq -c`), change those four to `"input"` instead. Defaults are comma-separated and parse the same either way.

## 2. One-line edits

| File | Where | Insert |
|---|---|---|
| `templates/layout.liquid` | inside `<head>`, after the theme's main CSS link | `{% if options.eta_enabled %}<link rel="stylesheet" href="{{ 'eta-widget.css' \| asset }}">{% endif %}` |
| `templates/layout.liquid` | right before `</body>` | `{% render 'eta_config' %}{% if options.eta_enabled %}<script src="{{ 'eta-widget.js' \| asset }}" defer></script>{% endif %}` |
| top-bar partial (find with `grep -rln "header-dropdown-languages" partials components`; Titan: `partials/top_bar_language_currency.liquid`) | inside `ul.header__menu`, before the languages `<li>` | `<li class="header__item d-none d-lg-flex">{% render 'eta_selector' %}</li>` |
| `components/product-form.liquid` | right after `<!-- end .product-form__wrapper -->` | `{% if template == 'product' %}{% render 'eta_widget', prod: closest.product %}{% endif %}` |

## 3. Upload and enable

```bash
jumpseller theme watch <theme-id> theme -s STORE.jumpseller.com   # keep running
touch theme/assets/eta-widget.js   # repeat for each changed file, 1–2 s apart; read stdout for Liquid errors
```

Enable in admin → Themes → Options → "Envío estimado" → "Activar envío estimado".

Note: the widget observes the first `.theme-cart-counter` and the top-bar labels present at page load; themes that re-render the header need a re-mount.
