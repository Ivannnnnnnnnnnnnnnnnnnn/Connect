/**
 * ConnectPlus — brand consistency audit.
 * Read-only. Reports, for every user-facing page:
 *   - whether it loads the shared brand system (/starlink/brand.css, Inter font)
 *   - which brand tokens it actually uses
 *   - mojibake (double-encoded UTF-8) in the source
 *   - stray legacy "starlink" identifiers that leak into the UI
 *
 * No files are modified. Run: node backend/audit-brand.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PAGES = [
    'plans.html',
    'index.html',
    'orders.html',
    'settings.html',
    'register.html',
    'user-login.html',
];

// A file that is *supposed* to mirror a third-party operator UI is exempt from
// ConnectPlus shell styling, but still must not show wrong brand text.
const GATEWAY_MIRRORS = ['airtel-login.html'];

function mojibakeScore(text) {
    // Classic double-encoding signatures: Ã©, Ã¨, â€™, Â©, ðŸ ...
    const hits = text.match(/(?:Ã[\u0080-\u00bf]|â[\u0080-\u00bf]|Â[\u0080-\u00bf]|ð\u0178)/g) || [];
    return hits.length;
}

function report(name) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) return { name, missing: true };
    const s = fs.readFileSync(file, 'utf8');

    return {
        name,
        bytes: Buffer.byteLength(s, 'utf8'),
        lines: s.split('\n').length,
        loadsBrandCss: /brand\.css/.test(s),
        loadsTailwind: /tailwind/i.test(s),
        loadsUnicons: /unicons|uil-/.test(s),
        interFont: /Inter/i.test(s),
        usesHeader: /cp-header/.test(s),
        usesFooter: /cp-footer/.test(s),
        usesTabbar: /cp-tabbar/.test(s),
        usesPlan: /cp-plan\b/.test(s),
        usesBtn: /cp-btn/.test(s),
        usesNotice: /cp-notice/.test(s),
        inlineStyleBlocks: (s.match(/<style[\s>]/g) || []).length,
        mojibake: mojibakeScore(s),
        starlinkIds: (s.match(/starlink[A-Za-z]/g) || []).length,
        brandVars: (s.match(/var\(--cp-/g) || []).length,
    };
}

console.log('\n=== Page brand-consistency audit ===\n');
console.log('page'.padEnd(20), 'brand.css', 'header', 'footer', 'tabbar', 'cp-btn', 'mojibake', 'starlinkId', 'lines');

const rows = PAGES.map(report);
for (const r of rows) {
    if (r.missing) { console.log(r.name.padEnd(20), 'MISSING'); continue; }
    console.log(
        r.name.padEnd(20),
        String(r.loadsBrandCss).padEnd(9),
        String(r.usesHeader).padEnd(6),
        String(r.usesFooter).padEnd(6),
        String(r.usesTabbar).padEnd(6),
        String(r.usesBtn).padEnd(6),
        String(r.mojibake).padEnd(8),
        String(r.starlinkIds).padEnd(10),
        r.lines
    );
}

console.log('\n=== Gateway mirrors (exempt from ConnectPlus shell) ===\n');
for (const g of GATEWAY_MIRRORS) {
    const r = report(g);
    if (r.missing) { console.log(g, 'MISSING'); continue; }
    console.log(
        g.padEnd(20),
        'brand.css=' + r.loadsBrandCss,
        'mojibake=' + r.mojibake,
        'starlinkIds=' + r.starlinkIds,
        'lines=' + r.lines
    );
}

console.log('\n=== Unicons usage without a Unicons stylesheet ===\n');
// The icon font ships as unicons.iconscout.com/release/<v>/css/<style>.css,
// so match the host rather than a specific filename.
let iconIssues = 0;
for (const r of [...rows, ...GATEWAY_MIRRORS.map(report)]) {
    if (r.missing) continue;
    const src = fs.readFileSync(path.join(ROOT, r.name), 'utf8');
    const hasUilClasses = /\.uil-|class="[^"]*\buil\b/.test(src);
    const hasUniconsCss = /unicons\.iconscout\.com/i.test(src);
    if (hasUilClasses && !hasUniconsCss) {
        iconIssues++;
        console.log(`  ${r.name}: has .uil- classes but no Unicons CSS link -> icons render blank`);
    }
}
if (!iconIssues) console.log('  none — every page using .uil- icons also links the Unicons font');

console.log('\n=== Mojibake detail (top offenders) ===\n');
const withMojibake = [...rows].filter(r => !r.missing && r.mojibake > 0).sort((a, b) => b.mojibake - a.mojibake);
if (!withMojibake.length) console.log('  none');
for (const r of withMojibake.slice(0, 10)) {
    const s = fs.readFileSync(path.join(ROOT, r.name), 'utf8');
    const m = s.match(/.{0,60}(?:Ã[\u0080-\u00bf]|â[\u0080-\u00bf]|Â[\u0080-\u00bf]|ð\u0178).{0,40}/);
    console.log(`  ${r.name} (${r.mojibake}): ${m ? m[0].replace(/\n/g, ' ').trim() : ''}`);
}

console.log('');
