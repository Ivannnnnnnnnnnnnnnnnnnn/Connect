/**
 * ConnectPlus — browser render verification.
 * Launches the locally-installed system Chrome and drives the real UI,
 * capturing console errors and failed network requests.
 */
const { chromium } = require('patchright');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://localhost:3000';

const results = [];
function check(name, cond, detail) {
    results.push({ name, pass: !!cond, detail });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + (detail || '')}`);
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });

    async function inspect(url, label, extra) {
        const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
        const page = await ctx.newPage();
        const consoleErrors = [];
        const pageErrors = [];
        const failedReqs = [];

        page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
        page.on('pageerror', e => pageErrors.push(e.message));
        page.on('requestfailed', r => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText}`));

        await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500); // let DOMContentLoaded handlers + IP lookups finish

        const info = await page.evaluate(() => ({
            title: document.title,
            lang: document.documentElement.lang,
            bodyChars: document.body.innerText.length,
            heading: document.querySelector('h1')?.innerText || null,
            starlinkText: /STARLINK|Starlink Reseller|Starlink services/i.test(document.body.innerText),
            connectPlusText: document.body.innerText.includes('ConnectPlus') || document.body.innerText.includes('CONNECTPLUS')
        }));

        console.log(`\n--- ${label} (${url}) ---`);
        check(`${label}: no uncaught JS exceptions`, pageErrors.length === 0, pageErrors.join(' | '));
        check(`${label}: no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
        check(`${label}: rendered content`, info.bodyChars > 200, `bodyChars=${info.bodyChars}`);
        check(`${label}: no visible Starlink branding`, !info.starlinkText);
        // The Airtel gateway page (/login) deliberately mirrors Airtel's own UI and
        // identifies the plan by name, so only require ConnectPlus branding on
        // the ConnectPlus-branded pages.
        if (!url.startsWith('/login')) {
            check(`${label}: visible ConnectPlus branding`, info.connectPlusText);
        }

        if (extra) await extra(page, label);

        await ctx.close();
        return { consoleErrors, pageErrors, failedReqs, info };
    }

    // ── 1. Plans page ─────────────────────────────────────────────
    await inspect('/starlink/', 'plans', async (page, label) => {
        const d = await page.evaluate(() => ({
            lang: document.documentElement.lang,
            categories: [...document.querySelectorAll('h3[id^="cat-"]')].map(h => h.innerText.trim()),
            cardCount: document.querySelectorAll('.package-card').length,
            packageIds: [...document.querySelectorAll('.package-card')].map(c => c.dataset.package),
            prices: [...document.querySelectorAll('.pkg-price')].map(p => p.innerText.trim()),
            notice: document.getElementById('plans-desc')?.innerText || '',
            airtelDisplay: getComputedStyle(document.getElementById('selectAirtel')).display,
            airtelText: document.getElementById('selectAirtel')?.innerText || '',
            orangeElementExists: !!document.getElementById('selectOrange'),
            visibleOptions: [...document.querySelectorAll('.payment-option')].filter(e => getComputedStyle(e).display !== 'none').length,
            footerBrand: document.getElementById('footer-brand')?.innerText || ''
        }));
        check('plans: page language is French', d.lang === 'fr', d.lang);
        check('plans: 3 category headings present', d.categories.length === 3, JSON.stringify(d.categories));
        check('plans: daily category title', d.categories[0] === '📅 FORFAITS JOURNALIERS', d.categories[0]);
        check('plans: weekly category title', d.categories[1] === '📆 FORFAITS HEBDOMADAIRES', d.categories[1]);
        check('plans: monthly category title', d.categories[2] === '🗓️ FORFAITS MENSUELS', d.categories[2]);
        check('plans: exactly 13 package cards', d.cardCount === 13, String(d.cardCount));
        check('plans: no legacy package ids', !d.packageIds.some(id => ['daily-1gb', 'monthly-unlimited', 'starter'].includes(id)), JSON.stringify(d.packageIds));
        check('plans: 13 prices rendered', d.prices.length === 13, JSON.stringify(d.prices));
        check('plans: $0.25 tier shown', d.prices.includes('$0.25'), JSON.stringify(d.prices.slice(0, 5)));
        check('plans: $20 tier shown', d.prices.includes('$20'), JSON.stringify(d.prices.slice(-3)));
        check('plans: Airtel-only notice in French', d.notice.includes('Achat disponible uniquement avec une ligne Airtel'), d.notice);
        check('plans: Airtel option visible', d.airtelDisplay !== 'none', d.airtelDisplay);
        check('plans: only ONE payment option visible', d.visibleOptions === 1, String(d.visibleOptions));
        check('plans: visible option is Airtel Money', d.airtelText.includes('Airtel Money'), d.airtelText);
        check('plans: Orange element removed from DOM', !d.orangeElementExists);
        check('plans: footer brand CONNECTPLUS', d.footerBrand === 'CONNECTPLUS', d.footerBrand);

        // Select a package -> the payment modal opens with only Airtel
        await page.click('[data-package="monthly-unlimited-5000min"]');
        await page.waitForTimeout(400);
        const modal = await page.evaluate(() => ({
            visible: getComputedStyle(document.getElementById('paymentMethodModal')).display !== 'none',
            options: [...document.querySelectorAll('.payment-option')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.innerText.replace(/\s+/g, ' ').trim()),
            selected: document.querySelector('.package-card.selected')?.dataset.package
        }));
        check('plans: payment modal opens on package click', modal.visible);
        check('plans: selected package is the $20 plan', modal.selected === 'monthly-unlimited-5000min', modal.selected);
        check('plans: modal offers ONLY Airtel Money', modal.options.length === 1 && /Airtel Money/.test(modal.options[0]), JSON.stringify(modal.options));
        check('plans: modal has no Orange option', !modal.options.some(o => /Orange/i.test(o)));
    });

    // ── 2. Status page ────────────────────────────────────────────
    await inspect('/starlink/status.html', 'status', async (page, label) => {
        const d = await page.evaluate(() => ({
            title: document.getElementById('service-title')?.innerText || '',
            btn: document.getElementById('choose-package-btn')?.innerText || '',
            desc: document.getElementById('service-desc')?.innerText || '',
            footer: document.getElementById('footer-brand')?.innerText || ''
        }));
        check('status: service title is ConnectPlus <country>', d.title.startsWith('ConnectPlus'), d.title);
        // innerText is CSS-transformed to uppercase, so compare case-insensitively.
        check('status: French button label', /choisissez votre forfait/i.test(d.btn), d.btn);
        check('status: mentions Airtel line requirement', /Airtel/i.test(d.desc), d.desc);
        check('status: footer brand CONNECTPLUS', d.footer.toUpperCase() === 'CONNECTPLUS', d.footer);
    });

    // ── 3. Airtel payment page with a new package ─────────────────
    await inspect('/login?source=connectplus&package=monthly-15gb-1500min&lp=10&cur=USD', 'airtel-pay', async (page, label) => {
        const d = await page.evaluate(() => ({
            amount: document.getElementById('starlinkAmount')?.innerText || '',
            service: document.getElementById('starlinkService')?.innerText || '',
            detailsShown: getComputedStyle(document.getElementById('paymentDetails')).display !== 'none',
            headerShown: document.getElementById('starlinkHeader')?.classList.contains('active'),
            dialCode: document.getElementById('phoneCode')?.innerText || '',
            landing: getComputedStyle(document.getElementById('paymentDetails')).display
        }));
        check('airtel-pay: header revealed', d.headerShown === true, String(d.headerShown));
        check('airtel-pay: details revealed', d.detailsShown === true, d.landing);
        check('airtel-pay: amount shows $10 USD', d.amount.includes('$10') && d.amount.includes('USD'), d.amount);
        check('airtel-pay: service shows the plan name', d.service === '15 Go + 1 500 min', d.service);
        // The dial code follows IP geolocation; DRC (+243) is the fallback when
        // detection fails. Accept either a real dial code or the DRC default.
        check('airtel-pay: dial code resolved (any country) or DRC default',
            /^\+\d{1,4}$/.test(d.dialCode.trim()), `got "${d.dialCode}"`);
    });

    // ── 4. DRC default when country detection fails ───────────────
    // Block the geo-IP providers so the page must fall back to its DRC default.
    await (async () => {
        const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
        const page = await ctx.newPage();
        await page.route('**://ipapi.co/**', r => r.abort());
        await page.route('**://ipwho.is/**', r => r.abort());
        await page.route('**://ip-api.com/**', r => r.abort());
        await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
        await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        const d = await page.evaluate(() => ({
            dialCode: document.getElementById('phoneCode')?.textContent || ''
        }));
        console.log('\n--- airtel-pay DRC fallback (geo blocked) ---');
        check('airtel-pay: falls back to DRC +243 when geo detection fails',
            d.dialCode === '+243', `got "${d.dialCode}"`);
        await ctx.close();
    })();

    await browser.close();

    const failed = results.filter(r => !r.pass);
    console.log(`\n========================================`);
    console.log(`  RENDER CHECKS PASSED: ${results.length - failed.length}`);
    console.log(`  RENDER CHECKS FAILED: ${failed.length}`);
    if (failed.length) { console.log('\n  Failures:'); failed.forEach(f => console.log(`   - ${f.name} :: ${f.detail}`)); }
    console.log(`========================================\n`);
    process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('Harness crashed:', e); process.exit(1); });
