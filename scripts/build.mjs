import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ORDER = ['eta-comunas.js', 'eta-rules.js', 'eta-store.js', 'eta-data.js', 'eta-ui.js', 'eta-boot.js'];
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const parts = ORDER.map(f => `/* ${f} */\n` + readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'));
const out = `/*! jumpseller-delivery-estimate v${pkg.version} */\n` + parts.join('\n');
mkdirSync(new URL('../theme-kit/assets/', import.meta.url), { recursive: true });
writeFileSync(new URL('../theme-kit/assets/eta-widget.js', import.meta.url), out);
console.log(`theme-kit/assets/eta-widget.js ${(out.length / 1024).toFixed(1)} KB`);
