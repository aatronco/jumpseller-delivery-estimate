# End-to-end verification — test store (Titan 4.13.8)

Date: 2026-09-23. Installed with `theme-kit/INSTALL.md` via `jumpseller theme watch`; no Liquid errors reported. Browser: Playwright (Chromium).

| Scenario | Expected | Result |
|---|---|---|
| Flag off (`eta_enabled: false`) | Product page unchanged | ✅ `grep -c 'eta-'` = 0 |
| Fresh browser, product page | "Envío a todo Chile" + "¿Dónde lo recibes?"; top bar "¿Dónde lo recibes?" | ✅ |
| Pick Providencia | "Llega mañana por $2.000" (15:42 local, past cutoff); top bar "Enviar a Providencia"; survives reload | ✅ |
| Cart > 30 kg | $4.000 | ✅ (31 kg cart) |
| Pick Temuco | Skeleton, then "Envío a Temuco desde $X", no day promise | ✅ "desde $12.366" at 31 kg = cheapest allowlisted home service; product already in cart not double-counted |
| Clock Sat 15:00 | "Llega el lunes" | ✅ |
| Clock Wed 11:45 | "Llega hoy" + "Compra en las próximas 2 h 15 min" | ✅ |
| 375 px | "Cambiar" opens bottom sheet; no horizontal overflow | ✅ sheet full width at bottom; `scrollWidth` = 375 |
| Console | No errors from `eta-widget.js` | ✅ only two pre-existing third-party script 404s unrelated to the widget |

Screenshots: [desktop](img/desktop.png), [mobile bottom sheet](img/mobile-sheet.png).

Follow-ups found during verification:
- The panel/sheet falls back to a white background on dark themes: `--theme-background` / `--theme-text` are not Titan's variable names.
- `INSTALL.md`: the options group goes inside `"groups"` in `config/options.json` (before `"translations"`), not at the top level.
