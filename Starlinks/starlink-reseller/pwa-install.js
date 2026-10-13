/**
 * Starlink Reseller — PWA Install Banner
 * Shows on all starlink pages until the app is installed.
 * Respects language (starlink_user_lang in localStorage).
 * Dismissing re-shows the banner after 15 seconds and on every new page load.
 * Uninstalling the app causes the banner to reappear on next visit.
 */
(function () {
    'use strict';

    // ── Translations ──────────────────────────────────────────────
    var T = {
        fr: {
            title: "Installer l'application Starlink",
            sub:   "Accès rapide aux forfaits",
            btn:   "Installer",
            iosMsg: "Sur iOS : appuyez sur le bouton Partager ↑ puis « Sur l'écran d'accueil »."
        },
        en: {
            title: "Install the Starlink App",
            sub:   "Quick access to packages",
            btn:   "Install",
            iosMsg: "On iOS: tap the Share button ↑ then \"Add to Home Screen\"."
        },
        my: {
            title: "Starlink App ထည့်သွင်းပါ",
            sub:   "ပက်ကေ့ဂျ်များသို့ မြန်ဆန်စွာဝင်ရောက်ရန်",
            btn:   "ထည့်သွင်း",
            iosMsg: "iOS: Share ↑ ကိုနှိပ်ပြီး 'Add to Home Screen' ကိုနှိပ်ပါ။"
        },
        rn: {
            title: "Shira gahunda ya Starlink",
            sub:   "Injira vuba ku bifurishi",
            btn:   "Shira",
            iosMsg: "Kuri iOS: kanda Share ↑ hanyuma 'Ongeraho ku buryo bw'imbere'."
        }
    };

    function lang() {
        return T[localStorage.getItem('starlink_user_lang')] ? localStorage.getItem('starlink_user_lang') : 'en';
    }

    // ── State checks ──────────────────────────────────────────────
    function isInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               navigator.standalone === true ||
               localStorage.getItem('pwa_installed') === '1';
    }

    var _snoozedUntil = 0; // in-memory only — resets on page navigation

    function isSnoozed() {
        return Date.now() < _snoozedUntil;
    }

    // ── DOM helpers ───────────────────────────────────────────────
    var BANNER_ID  = 'sl-pwa-banner';
    var STYLE_ID   = 'sl-pwa-style';
    var IOS_MODAL_ID = 'sl-pwa-ios-modal';
    var deferredPrompt = null;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    var isInAppBrowser = /(FBAN|FBAV|Instagram|Line|Telegram|WhatsApp|wv)/i.test(navigator.userAgent);

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = [
            '#sl-pwa-banner{',
            '  position:fixed;top:0;left:0;right:0;z-index:2147483647;',
            '  background:#0b0b0b;color:#fff;',
            '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
            '  box-shadow:0 2px 16px rgba(0,0,0,.55);',
            '  border-bottom:1px solid #222;',
            '}',
            '#sl-pwa-inner{',
            '  display:flex;align-items:center;justify-content:space-between;',
            '  padding:10px 14px;max-width:680px;margin:0 auto;gap:10px;',
            '}',
            '#sl-pwa-logo{',
            '  flex-shrink:0;width:40px;height:40px;border-radius:9px;',
            '  overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;',
            '  border:1px solid #333;',
            '}',
            '#sl-pwa-logo svg{width:40px;height:40px;}',
            '#sl-pwa-text{flex:1;min-width:0;line-height:1.25;}',
            '#sl-pwa-title{',
            '  display:block;font-size:13px;font-weight:700;',
            '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
            '}',
            '#sl-pwa-sub{',
            '  display:block;font-size:11px;color:#9ca3af;margin-top:2px;',
            '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
            '}',
            '#sl-pwa-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;}',
            '#sl-pwa-install{',
            '  background:#fff;color:#000;border:none;border-radius:7px;',
            '  padding:7px 15px;font-size:12px;font-weight:700;cursor:pointer;',
            '  white-space:nowrap;transition:background .15s;font-family:inherit;',
            '}',
            '#sl-pwa-install:hover{background:#e5e7eb;}',
            '#sl-pwa-close{',
            '  background:none;border:none;color:#6b7280;font-size:18px;',
            '  cursor:pointer;padding:4px 6px;line-height:1;transition:color .15s;font-family:inherit;',
            '}',
            '#sl-pwa-close:hover{color:#fff;}',
            '#sl-pwa-ios-modal{',
            '  position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.72);',
            '  display:flex;align-items:center;justify-content:center;padding:18px;}',
            '#sl-pwa-ios-card{',
            '  width:min(100%,420px);background:#111827;color:#fff;border:1px solid #374151;',
            '  border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:18px 18px 16px;}',
            '#sl-pwa-ios-card h2{font-size:18px;font-weight:800;margin:0 0 8px;}',
            '#sl-pwa-ios-card p{font-size:14px;line-height:1.45;color:#d1d5db;margin:0 0 10px;}',
            '#sl-pwa-ios-card ol{margin:0 0 14px 18px;padding:0;color:#e5e7eb;font-size:14px;line-height:1.5;}',
            '#sl-pwa-ios-card li{margin-bottom:6px;}',
            '#sl-pwa-ios-card button{width:100%;border:none;border-radius:12px;background:#fff;color:#000;font-weight:800;padding:12px 14px;}',
            '.sl-pwa-push{padding-top:62px!important;}'
        ].join('');
        document.head.appendChild(s);
    }

    function iconSVG() {
        return [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="40" height="40">',
            '  <circle cx="100" cy="100" r="100" fill="#000"/>',
            '  <ellipse cx="100" cy="100" rx="74" ry="55" stroke="white" stroke-width="9" fill="none" transform="rotate(-25 100 100)"/>',
            '  <ellipse cx="100" cy="100" rx="43" ry="33" stroke="white" stroke-width="9" fill="none" transform="rotate(65 100 100)"/>',
            '  <circle cx="100" cy="100" r="11" fill="white"/>',
            '</svg>'
        ].join('');
    }

    function showBanner() {
        if (document.getElementById(BANNER_ID)) return;
        if (isInstalled() || isSnoozed()) return;

        injectStyle();

        var t  = T[lang()];
        var el = document.createElement('div');
        el.id  = BANNER_ID;
        el.setAttribute('role', 'banner');
        el.innerHTML = [
            '<div id="sl-pwa-inner">',
            '  <div id="sl-pwa-logo">', iconSVG(), '</div>',
            '  <div id="sl-pwa-text">',
            '    <span id="sl-pwa-title">', t.title, '</span>',
            '    <span id="sl-pwa-sub">',   t.sub,   '</span>',
            '  </div>',
            '  <div id="sl-pwa-actions">',
            '    <button id="sl-pwa-install">', (isIOS ? (lang() === 'fr' ? 'Comment installer' : lang() === 'my' ? 'ဘယ်လိုထည့်မလဲ' : lang() === 'rn' ? 'Uburyo bwo gushira' : 'How to install') : t.btn), '</button>',
            '    <button id="sl-pwa-close" aria-label="Close">&#x2715;</button>',
            '  </div>',
            '</div>'
        ].join('');

        document.body.insertBefore(el, document.body.firstChild);
        document.body.classList.add('sl-pwa-push');

        document.getElementById('sl-pwa-install').addEventListener('click', onInstall);
        document.getElementById('sl-pwa-close').addEventListener('click', onDismiss);
    }

    function removeBanner() {
        var el = document.getElementById(BANNER_ID);
        if (el) el.remove();
        document.body.classList.remove('sl-pwa-push');
    }

    function removeIOSModal() {
        var el = document.getElementById(IOS_MODAL_ID);
        if (el) el.remove();
    }

    function showIOSHelp() {
        removeIOSModal();
        injectStyle();

        var t = T[lang()];
        var modal = document.createElement('div');
        modal.id = IOS_MODAL_ID;
        modal.innerHTML = [
            '<div id="sl-pwa-ios-card" role="dialog" aria-modal="true" aria-labelledby="sl-pwa-ios-title">',
            '  <h2 id="sl-pwa-ios-title">', (isInAppBrowser ? (lang() === 'fr' ? 'Ouvrez dans Safari' : lang() === 'my' ? 'Safari တွင်ဖွင့်ပါ' : lang() === 'rn' ? 'Fungura muri Safari' : 'Open in Safari') : t.title), '</h2>',
            '  <p>', (isInAppBrowser ? (lang() === 'fr' ? 'iPhone ne peut pas installer cette app depuis ce navigateur.' : lang() === 'my' ? 'iPhone က ဒီ browser ထဲကနေ app ကို install မလုပ်နိုင်ပါ။' : lang() === 'rn' ? 'iPhone ntishobora gushira iyi app muri iyi browser.' : 'iPhone cannot install this app from this browser.') : t.iosMsg), '</p>',
            '  <ol>',
            '    <li>', (lang() === 'fr' ? 'Ouvrez ce lien dans Safari.' : lang() === 'my' ? 'ဒီ link ကို Safari တွင်ဖွင့်ပါ။' : lang() === 'rn' ? 'Fungura iyi lien muri Safari.' : 'Open this link in Safari.'), '</li>',
            '    <li>', (lang() === 'fr' ? 'Appuyez sur le bouton Partager.' : lang() === 'my' ? 'Share ခလုတ်ကိုနှိပ်ပါ။' : lang() === 'rn' ? 'Kanda bouton Share.' : 'Tap the Share button.'), '</li>',
            '    <li>', (lang() === 'fr' ? 'Choisissez "Sur l’écran d’accueil".' : lang() === 'my' ? '"Add to Home Screen" ကိုရွေးပါ။' : lang() === 'rn' ? 'Hitamo "Add to Home Screen".' : 'Choose "Add to Home Screen".'), '</li>',
            '  </ol>',
            '  <button type="button" id="sl-pwa-ios-close">', (lang() === 'fr' ? 'Compris' : lang() === 'my' ? 'နားလည်ပါပြီ' : lang() === 'rn' ? 'Nabyumvise' : 'Got it'), '</button>',
            '</div>'
        ].join('');

        modal.addEventListener('click', function (event) {
            if (event.target === modal) removeIOSModal();
        });

        document.body.appendChild(modal);
        document.getElementById('sl-pwa-ios-close').addEventListener('click', removeIOSModal);
    }

    // ── Install handler ───────────────────────────────────────────
    function onInstall() {
        if (isIOS) {
            showIOSHelp();
            return;
        }

        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (result) {
                if (result.outcome === 'accepted') {
                    localStorage.setItem('pwa_installed', '1');
                    removeBanner();
                }
                deferredPrompt = null;
            });
        }
    }

    function onDismiss() {
        removeBanner();
        // Re-show after 15 seconds — keeps appearing until the user installs
        _snoozedUntil = Date.now() + 15000;
        setTimeout(showBanner, 15000);
    }

    // ── PWA events ────────────────────────────────────────────────
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        // Browser only fires this when the app is NOT installed.
        // Clear any stale installed flag (handles uninstall case).
        localStorage.removeItem('pwa_installed');
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showBanner);
        } else {
            showBanner();
        }
    });

    window.addEventListener('appinstalled', function () {
        localStorage.setItem('pwa_installed', '1');
        removeBanner();
    });

    // iOS: show banner on DOMContentLoaded (no beforeinstallprompt on Safari)
    if (isIOS && !navigator.standalone) {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(showBanner, 600);
        });
    }

    window.addEventListener('orientationchange', function () {
        removeIOSModal();
    });

    // ── Service Worker registration ───────────────────────────────
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/starlink/sw.js', { scope: '/starlink/' })
                .catch(function () { /* silent in dev */ });
        });
    }

    // ── Expose update fn for language switches ────────────────────
    window.updatePWABannerLang = function () {
        var banner = document.getElementById(BANNER_ID);
        if (!banner) return;
        var t = T[lang()];
        var titleEl = document.getElementById('sl-pwa-title');
        var subEl   = document.getElementById('sl-pwa-sub');
        var btnEl   = document.getElementById('sl-pwa-install');
        if (titleEl) titleEl.textContent = t.title;
        if (subEl)   subEl.textContent   = t.sub;
        if (btnEl)   btnEl.textContent   = t.btn;
    };
}());
