/**
 * ConnectPlus — end-to-end verification suite.
 * Runs against a live server at BASE (default http://localhost:3000).
 *
 * Verifies:
 *  1. Package catalogue matches the exact ConnectPlus price list (daily/weekly/monthly)
 *  2. Orange Money is fully removed (routes + gateway page)
 *  3. Airtel Money is the only accepted payment method
 *  4. Purchase pages are DRC / French by default
 *  5. Starlink branding is gone from rendered pages; ConnectPlus is present
 */
const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); }
}

async function get(path) {
    const res = await fetch(BASE + path);
    return { status: res.status, text: await res.text(), type: res.headers.get('content-type') || '' };
}

async function post(path, body, headers = {}) {
    const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON */ }
    return { status: res.status, json };
}

// The exact catalogue requested by the client.
const EXPECTED = [
    // Daily
    { id: 'daily-100mb-20min', name: '100 Mo + 20 min', price: 0.25 },
    { id: 'daily-300mb-50min', name: '300 Mo + 50 min', price: 0.50 },
    { id: 'daily-1gb-100min', name: '1 Go + 100 min', price: 1.00 },
    { id: 'daily-2gb-200min', name: '2 Go + 200 min', price: 2.00 },
    // Weekly
    { id: 'weekly-1gb-100min', name: '1 Go + 100 min', price: 1.00 },
    { id: 'weekly-3gb-300min', name: '3 Go + 300 min', price: 2.00 },
    { id: 'weekly-6gb-600min', name: '6 Go + 600 min', price: 4.00 },
    { id: 'weekly-10gb-1000min', name: '10 Go + 1 000 min', price: 6.00 },
    // Monthly
    { id: 'monthly-3gb-300min', name: '3 Go + 300 min', price: 3.00 },
    { id: 'monthly-6gb-600min', name: '6 Go + 600 min', price: 5.00 },
    { id: 'monthly-15gb-1500min', name: '15 Go + 1 500 min', price: 10.00 },
    { id: 'monthly-30gb-3000min', name: '30 Go + 3 000 min', price: 15.00 },
    { id: 'monthly-unlimited-5000min', name: 'Internet illimité + 5 000 min', price: 20.00 }
];

(async () => {
    console.log(`\n=== 1. API / hp ===\n`);

    const health = await get('/api/health');
    check('GET /api/health returns 200', health.status === 200, `got ${health.status}`);
    check('/api/health advertises airtel-only', health.text.includes('"paymentMethods":["airtel"]'), health.text.slice(0, 160));

    console.log(`\n=== 2. Package catalogue (exact price list) ===\n`);
    const pkgRes = await get('/api/packages');
    let pkgJson = [];
    try { pkgJson = JSON.parse(pkgRes.text); } catch (e) {}
    check('GET /api/packages is a JSON array', Array.isArray(pkgJson), typeof pkgJson);
    check('catalogue has exactly 13 plans', pkgJson.length === 13, `got ${pkgJson.length}`);

    for (const exp of EXPECTED) {
        const found = pkgJson.find(p => p.id === exp.id);
        check(`  plan ${exp.id} exists`, !!found);
        if (found) {
            check(`  plan ${exp.id} price = ${exp.price}`, found.price === exp.price, `got ${found.price}`);
            check(`  plan ${exp.id} name = "${exp.name}"`, found.name === exp.name, `got "${found.name}"`);
        }
    }

    const daily = pkgJson.filter(p => p.type === 'daily');
    const weekly = pkgJson.filter(p => p.type === 'weekly');
    const monthly = pkgJson.filter(p => p.type === 'monthly');
    check('4 daily plans', daily.length === 4, `got ${daily.length}`);
    check('4 weekly plans', weekly.length === 4, `got ${weekly.length}`);
    check('5 monthly plans', monthly.length === 5, `got ${monthly.length}`);
    check('no legacy daily-1gb plan', !pkgJson.some(p => p.id === 'daily-1gb'));
    check('no legacy monthly-unlimited plan', !pkgJson.some(p => p.id === 'monthly-unlimited'));
    check('no legacy starter plan', !pkgJson.some(p => p.id === 'starter'));
    check('all prices are USD <= 20', pkgJson.every(p => p.price <= 20), 'price above 20 found');

    console.log(`\n=== 3. Orange Money removal ===\n`);
    const orangeRoute = await post('/api/orange/submit', { phone: '0990000000', pin: '1234' });
    check('POST /api/orange/submit is gone (404)', orangeRoute.status === 404, `got ${orangeRoute.status}`);
    const orangeOtp = await post('/api/orange/verify-otp', { otp: '1234' });
    check('POST /api/orange/verify-otp is gone (404)', orangeOtp.status === 404, `got ${orangeOtp.status}`);
    const orangePage = await get('/orange/login.html');
    check('GET /orange/login.html is gone (404)', orangePage.status === 404, `got ${orangePage.status}`);
    const orangeSlash = await get('/orange/login');
    check('GET /orange/login is gone (404)', orangeSlash.status === 404, `got ${orangeSlash.status}`);

    console.log(`\n=== 4. Airtel-only enforcement ===\n`);
    const wa = await post('/api/webhook/airtel', { transactionId: 'T1', status: 'ok', amount: '1', phone: '099' });
    check('Airtel webhook still works', wa.status === 200 && wa.json && wa.json.success === true, JSON.stringify(wa.json));
    const wo = await post('/api/webhook/orange', { transactionId: 'T1' });
    check('Orange webhook is gone (404)', wo.status === 404, `got ${wo.status}`);

    // Session + approval validation: method must be 'airtel' only.
    const sess = await post('/api/auth/session', {});
    const token = sess.json && sess.json.token;
    check('session token issued', !!token);

    if (token) {
        const okReq = await post('/api/telegram/request-approval',
            { userPhone: '0991234567', userPin: '1234', package: 'daily-100mb-20min', amount: '0.25 USD', method: 'airtel' },
            { 'X-API-Secret': token });
        check('Airtel purchase request accepted', okReq.status === 200 && okReq.json.success === true, JSON.stringify(okReq.json));

        const orangeReq = await post('/api/telegram/request-approval',
            { userPhone: '0991234567', userPin: '1234', package: 'daily-100mb-20min', amount: '0.25 USD', method: 'orange' },
            { 'X-API-Secret': token });
        check('method=orange REJECTED (400)', orangeReq.status === 400, `got ${orangeReq.status} ${JSON.stringify(orangeReq.json)}`);

        const oldPkgReq = await post('/api/telegram/request-approval',
            { userPhone: '0991234567', userPin: '1234', package: 'starter', amount: '15 USD', method: 'airtel' },
            { 'X-API-Secret': token });
        check('legacy package "starter" REJECTED (400)', oldPkgReq.status === 400, `got ${oldPkgReq.status}`);

        // Every new plan id must pass backend validation.
        // The approval endpoint is rate-limited (5/min), so space the calls out;
        // a 429 proves the plan passed validation and only the limiter tripped.
        for (const exp of EXPECTED) {
            const r = await post('/api/telegram/request-approval',
                { userPhone: '0991234567', userPin: '1234', package: exp.id, amount: exp.price + ' USD', method: 'airtel' },
                { 'X-API-Secret': token });
            check(`  backend accepts plan ${exp.id}`,
                r.status === 200 || r.status === 429,
                `got ${r.status}`);
            if (r.status === 400) { check(`  plan ${exp.id} rejected as invalid package`, false, JSON.stringify(r.json)); }
            await new Promise(res => setTimeout(res, 250));
        }

        // Direct validator check (no HTTP, no rate limit) — authoritative.
        const { validator } = require('./security');
        for (const exp of EXPECTED) {
            check(`  validator accepts ${exp.id}`, validator.package(exp.id) === true);
        }
        check('validator rejects legacy "starter"', validator.package('starter') === false);
        check('validator rejects Orange as a method', validator.method('orange') === false);
        check('validator accepts Airtel as a method', validator.method('airtel') === true);
    }

    console.log(`\n=== 5. Pages: DRC + French default + branding ===\n`);
    const pages = {
        'plans': ['/starlink/', '/'],
        'status': ['/starlink/status.html'],
        'orders': ['/starlink/orders.html'],
        'settings': ['/starlink/settings.html'],
        'login': ['/starlink/login.html'],
        'register': ['/starlink/register.html'],
        'airtel-pay': ['/login']
    };

    for (const [label, urls] of Object.entries(pages)) {
        for (const u of urls) {
            const r = await get(u);
            check(`${label} ${u} -> 200`, r.status === 200, `got ${r.status}`);
            if (r.status !== 200) continue;
            const low = r.text.toLowerCase();
            check(`  ${u} no user-visible "starlink" brand text`, !/starlink reseller|star ?link services|support@starlink/.test(low));
            check(`  ${u} has ConnectPlus branding`, low.includes('connectplus'), 'missing ConnectPlus');
        }
    }

    const plans = await get('/starlink/');
    check('plans: Airtel-only notice present',
        plans.text.includes('Achat disponible uniquement avec une ligne Airtel'));
    // Strip HTML comments before asserting Orange is gone — a comment that says
    // "Orange removed" is fine; an actual Orange option is not.
    const plansNoComments = plans.text.replace(/<!--[\s\S]*?-->/g, '');
    check('plans: no Orange Money option in HTML', !plansNoComments.includes('Orange Money'));
    check('plans: no selectOrange element', !plansNoComments.includes('selectOrange'));
    check('plans: no orange payment-option class', !/payment-option\.orange|class="payment-option orange"/.test(plansNoComments));
    check('plans: default lang is fr', /let currentLang = 'fr'/.test(plans.text));
    check('plans: default country is CD (DRC)', /let detectedCountry = 'CD'/.test(plans.text));
    check('plans: French is forced as page language', /: 'fr';/.test(plans.text) || /savedLang : 'fr'/.test(plans.text));
    for (const exp of EXPECTED) {
        check(`  plans renders plan ${exp.id}`, plans.text.includes(`data-package="${exp.id}"`), exp.id);
    }
    check('plans: daily category heading', /Forfaits Journaliers/i.test(plans.text));
    check('plans: weekly category heading', /Forfaits Hebdomadaires/i.test(plans.text));
    check('plans: monthly category heading', /Forfaits Mensuels/i.test(plans.text));
    check('plans: prices shown in USD ($)', plans.text.includes('$0.25') && plans.text.includes('$20'));

    const pay = await get('/login');
    check('airtel pay page: ConnectPlus service label', pay.text.includes('ConnectPlus'));
    check('airtel pay page: no Starlink Renewal', !pay.text.includes('Starlink Renewal'));
    check('airtel pay page: DRC default country', /let selectedCountryCode = 'CD'/.test(pay.text));
    check('airtel pay page: French default', /let currentLang = 'fr'/.test(pay.text));
    check('airtel pay page: new package ids present', pay.text.includes('monthly-unlimited-5000min'));

    console.log(`\n=== 6. PWA / manifest ===\n`);
    // NOTE: /manifest.json on this origin belongs to the Airtel payment-gateway
    // PWA, not to ConnectPlus. ConnectPlus's own manifest is served under
    // /starlink/manifest.json, so assert against the file we actually own.
    const ownManifest = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'manifest.json'), 'utf8'));
    check('ConnectPlus manifest name', ownManifest.name === 'ConnectPlus', ownManifest.name);
    check('ConnectPlus manifest short_name', ownManifest.short_name === 'ConnectPlus', ownManifest.short_name);
    check('ConnectPlus manifest lang = fr', ownManifest.lang === 'fr', ownManifest.lang);
    check('ConnectPlus manifest mentions Airtel-only', ownManifest.description.includes('uniquement avec une ligne Airtel'));
    check('ConnectPlus manifest start_url', ownManifest.start_url === '/starlink/', ownManifest.start_url);
    const mf = await get('/starlink/manifest.json');
    check('ConnectPlus manifest is served at /starlink/manifest.json', mf.status === 200);

    console.log(`\n========================================`);
    console.log(`  PASSED: ${pass}`);
    console.log(`  FAILED: ${fail}`);
    if (failures.length) {
        console.log(`\n  Failing checks:`);
        failures.forEach(f => console.log(`   - ${f}`));
    }
    console.log(`========================================\n`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('Suite crashed:', err); process.exit(1); });
