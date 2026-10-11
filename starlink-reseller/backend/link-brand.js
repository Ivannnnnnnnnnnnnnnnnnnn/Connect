const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TAG = '<link rel="stylesheet" href="/starlink/brand.css">';

const FILES = ['index.html', 'plans.html', 'orders.html', 'settings.html', 'user-login.html', 'register.html'];

for (const f of FILES) {
    const p = path.join(ROOT, f);
    let s = fs.readFileSync(p, 'utf8');
    if (s.includes('/starlink/brand.css')) { console.log(`  ALREADY  ${f}`); continue; }
    // Insert right after the Tailwind CDN link so brand.css can override it.
    if (s.includes('tailwindcss/2.2.19/tailwind.min.css')) {
        s = s.replace(
            '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css">',
            `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css">\n    ${TAG}`
        );
    } else {
        s = s.replace('</head>', `    ${TAG}\n</head>`);
    }
    fs.writeFileSync(p, s, 'utf8');
    console.log(`  LINKED   ${f}`);
}
