// ==UserScript==
// @name         TVP Video Info Extractor
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Extracts JSON-LD metadata, manifest URL, and subtitles URL from TVP VOD pages
// @author       You
// @match        https://vod.tvp.pl/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        window.close
// ==/UserScript==

(function () {
    'use strict';

    const log = (msg) => console.log(`[TVP Extractor] ${msg}`);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    const state = {
        jsonld:        null,
        manifest_url:  null,
        subtitles_url: null,
    };
    let downloadTriggered = false;

    const resetAll = () => {
        state.jsonld        = null;
        state.manifest_url  = null;
        state.subtitles_url = null;
        downloadTriggered   = false;
    };

    // -------------------------------------------------------------------------
    // Episode list — fill in URLs to enable batch mode
    // -------------------------------------------------------------------------
    const EPISODE_LINKS = [
    ];

    const closeTab = () => {
        log('Closing tab...');
        window.close();
    };

    const redirectToNextEpisode = () => {
        const idx = EPISODE_LINKS.indexOf(location.href);
        if (idx !== -1 && idx < EPISODE_LINKS.length - 1) {
            log(`Redirecting to next episode: ${EPISODE_LINKS[idx + 1]}`);
            setTimeout(() => { location.href = EPISODE_LINKS[idx + 1]; }, 2000);
        } else {
            log('Last episode processed – closing tab.');
            setTimeout(closeTab, 2000);
        }
    };

    // -------------------------------------------------------------------------
    // URL capture
    // -------------------------------------------------------------------------
    const MANIFEST_RE  = /^(https:\/\/[^/]*\.tvp\.pl\/token\/video\/vod\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/video\.ism\/)nv-dash-[^/]+-vod[^/]*\.(mp4|m4s)$/;
    const SUBTITLES_RE = /^https:\/\/s\.tvp\.pl\/repository\/attachment\/(?:[0-9a-f]\/)*[0-9a-f][^/]*\.xml$/;

    const tryCapture = (url) => {
        if (typeof url !== 'string' || downloadTriggered) return;

        if (!state.manifest_url) {
            const m = url.match(MANIFEST_RE);
            if (m) {
                state.manifest_url = m[1] + 'Manifest';
                log(`Manifest URL: ${state.manifest_url}`);
            }
        }

        if (!state.subtitles_url && SUBTITLES_RE.test(url)) {
            state.subtitles_url = url;
            log(`Subtitles URL: ${state.subtitles_url}`);
        }

        checkAndDownload();
    };

    const checkAndDownload = () => {
        if (downloadTriggered) return;
        if (!state.manifest_url || !state.subtitles_url) return;
        downloadTriggered = true;
        log('Both URLs captured – downloading JSON.');
        downloadJSON();
    };

    // -------------------------------------------------------------------------
    // Network interception — fetch + XHR (main thread)
    // -------------------------------------------------------------------------
    const patchRequests = () => {
        try {
            const origFetch = unsafeWindow.fetch;
            unsafeWindow.fetch = function (input, init) {
                try { tryCapture((input && typeof input === 'object') ? input.url : String(input)); } catch (_) {}
                return origFetch.apply(unsafeWindow, arguments);
            };
            log('fetch patched.');
        } catch (e) { log(`fetch patch error: ${e.message}`); }

        try {
            const origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
            unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
                try { tryCapture(String(url)); } catch (_) {}
                return origOpen.apply(this, arguments);
            };
            log('XHR patched.');
        } catch (e) { log(`XHR patch error: ${e.message}`); }
    };

    // -------------------------------------------------------------------------
    // Network interception — Worker constructor
    // -------------------------------------------------------------------------
    const WORKER_SHIM = `(function(){
    var TAG='__tvpExtractor';
    function relay(url){self.postMessage({_tag:TAG,url:String(url)});}
    if(typeof self.fetch==='function'){
        var _f=self.fetch.bind(self);
        self.fetch=function(i,o){relay((i&&typeof i==='object')?i.url:i);return _f(i,o);};
    }
    if(typeof XMLHttpRequest!=='undefined'){
        var _o=XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open=function(m,u){relay(u);return _o.apply(this,arguments);};
    }
})();
`;

    const patchWorker = () => {
        try {
            const OrigWorker = unsafeWindow.Worker;

            unsafeWindow.Worker = function (scriptURL, options) {
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', scriptURL, false);
                    xhr.send();
                    if (xhr.status === 200 || xhr.status === 0) {
                        const blob    = new Blob([WORKER_SHIM, xhr.responseText], { type: 'application/javascript' });
                        const blobUrl = URL.createObjectURL(blob);
                        const worker  = new OrigWorker(blobUrl, options);
                        worker.addEventListener('message', (e) => {
                            if (e.data?._tag === '__tvpExtractor') tryCapture(e.data.url);
                        });
                        log(`Worker patched: ${String(scriptURL).slice(0, 80)}`);
                        return worker;
                    }
                } catch (inner) {
                    log(`Worker patch inner error: ${inner.message} – falling back.`);
                }
                return new OrigWorker(scriptURL, options);
            };
            unsafeWindow.Worker.prototype = OrigWorker.prototype;
            log('Worker constructor patched.');
        } catch (e) { log(`Worker patch error: ${e.message}`); }
    };

    // -------------------------------------------------------------------------
    // PerformanceObserver
    // -------------------------------------------------------------------------
    const installPerformanceObserver = () => {
        try {
            const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) tryCapture(entry.name);
            });
            po.observe({ type: 'resource', buffered: true });
            log('PerformanceObserver installed.');
        } catch (e) { log(`PerformanceObserver error: ${e.message}`); }
    };

    const scanPerformance = () => {
        performance.getEntriesByType('resource').forEach((e) => tryCapture(e.name));
    };

    // -------------------------------------------------------------------------
    // JSON-LD extraction (sole metadata source)
    // -------------------------------------------------------------------------
    const extractJsonLd = () => {
        if (state.jsonld) return true;
        try {
            for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
                const json = JSON.parse(el.textContent);
                if (json['@type'] === 'VideoObject') {
                    state.jsonld = json;
                    log(`JSON-LD captured: "${json.name}"`);
                    return true;
                }
            }
        } catch (e) { log(`JSON-LD parse error: ${e.message}`); }
        return false;
    };

    const waitForJsonLd = () => {
        if (extractJsonLd()) { log('JSON-LD resolved immediately.'); return; }
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (extractJsonLd() || attempts >= 40) {
                if (attempts >= 40 && !state.jsonld) log('JSON-LD not found within timeout.');
                clearInterval(interval);
            }
        }, 500);
    };

    // -------------------------------------------------------------------------
    // Player helpers
    // -------------------------------------------------------------------------
    const PLAY_SELECTORS = [
        '.button--watch',
        'button[aria-label*="Odtwórz"]',
        'button[aria-label*="odtwórz"]',
        '.icon-play',
        '.vjs-big-play-button',
        '[data-testid="play-button"]',
        'button[aria-label*="Play"]',
        'button[title*="Play"]',
        '.play-button',
        '#playButton',
    ];

    const findPlayButton = () => {
        for (const sel of PLAY_SELECTORS) {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) return btn;
        }
        for (const btn of document.querySelectorAll('button')) {
            if (!btn.offsetParent) continue;
            const text = btn.textContent.toLowerCase();
            const aria = btn.getAttribute('aria-label')?.toLowerCase();
            if (text.includes('odtwórz') || text.includes('play') ||
                aria?.includes('odtwórz') || aria?.includes('play')) return btn;
        }
        return null;
    };

    const waitForPlayButton = (maxWaitMs = 15000) => new Promise((resolve) => {
        let done = false;
        const settle = (found) => {
            if (done) return;
            done = true;
            observer.disconnect();
            clearInterval(poll);
            clearTimeout(timeout);
            resolve(found);
        };
        const tryClick = () => {
            const btn = findPlayButton();
            if (btn) { btn.click(); settle(true); }
        };
        const observer = new MutationObserver(tryClick);
        const poll     = setInterval(tryClick, 250);
        const timeout  = setTimeout(() => { log('Play button timeout – continuing.'); settle(false); }, maxWaitMs);
        observer.observe(document.body, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        });
        tryClick();
    });

    const detectBlobVideo = (maxWaitMs = 300000) => new Promise((resolve) => {
        let done = false;
        const settle = (src) => { if (done) return; done = true; observer.disconnect(); clearTimeout(t); resolve(src); };
        const check = () => {
            for (const vid of document.querySelectorAll('video')) {
                if (vid.src?.startsWith('blob:https://vod.tvp.pl/')) {
                    log(`Blob video detected: ${vid.src}`);
                    settle(vid.src);
                    return true;
                }
            }
            return false;
        };
        const observer = new MutationObserver(check);
        const t = setTimeout(() => { log('Blob video timeout – continuing.'); settle(null); }, maxWaitMs);
        observer.observe(document.body, { childList: true, subtree: true });
        check();
    });

    const waitForPostAdPlay = (maxWaitMs = 30000) => new Promise((resolve) => {
        let done = false;
        const settle = (v) => { if (done) return; done = true; observer.disconnect(); clearTimeout(t); resolve(v); };
        const POST_AD = [
            'button.ui-player-gui-button--play',
            'button[aria-label="Odtwórz materiał"]',
            'button[aria-label*="Odtwórz materiał"]',
        ];
        const check = () => {
            for (const sel of POST_AD) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) { btn.click(); settle(true); return true; }
            }
            return false;
        };
        if (check()) return;
        const observer = new MutationObserver(check);
        const t = setTimeout(() => { log('No post-ad button – continuing.'); settle(false); }, maxWaitMs);
        observer.observe(document.body, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'aria-label'],
        });
    });

    const enableSubtitles = async () => {
        log('Looking for subtitle controls...');
        const settingsSelectors = [
            '.ui-player-gui-button--settings',
            'button[aria-label*="Ustawienia"]',
            'button[aria-label*="ustawienia"]',
            '.settings-button',
            'button[class*="settings"]',
        ];

        let opened = false;
        for (const sel of settingsSelectors) {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
                btn.click();
                await new Promise(r => setTimeout(r, 1000));
                opened = true;
                break;
            }
        }

        if (!opened) {
            for (const btn of document.querySelectorAll('button')) {
                const aria = btn.getAttribute('aria-label')?.toLowerCase();
                const cls  = btn.className.toLowerCase();
                if (aria?.includes('ustawienia') || cls.includes('settings') || cls.includes('gear')) {
                    btn.click();
                    await new Promise(r => setTimeout(r, 1000));
                    opened = true;
                    break;
                }
            }
        }

        if (!opened) { log('Settings button not found.'); return false; }

        await new Promise(r => setTimeout(r, 500));

        for (const col of document.querySelectorAll('.ui-player-gui-settings__column')) {
            const header = col.querySelector('.ui-player-gui-settings__item--header');
            if (!header?.textContent.includes('Napisy')) continue;
            for (const item of col.querySelectorAll('.ui-player-gui-settings__item')) {
                if (item.textContent.trim().includes('Polski dla niesłyszących')) {
                    item.click();
                    log('Polish subtitles selected.');
                    return true;
                }
            }
            log('Napisy column found but Polish option missing.');
            return false;
        }

        for (const opt of document.querySelectorAll('.ui-player-gui-settings__item, button, li, option')) {
            if (opt.textContent.trim().includes('Polski dla niesłyszących')) {
                opt.click();
                log('Polish subtitles selected (fallback).');
                return true;
            }
        }

        log('Polish subtitle option not found.');
        return false;
    };

    // -------------------------------------------------------------------------
    // JSON download
    // -------------------------------------------------------------------------
    const buildFilename = () => {
        const safe      = (s) => (s || 'unknown').replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim();
        const name      = state.jsonld?.name || 'unknown';
        const pageId    = state.jsonld?.mainEntityOfPage?.['@id'] || '';
        const codeMatch = pageId.match(/S\d+E\d+/i);
        
        // Extract show title to match Python format
        let showTitle = name;
        if (name.includes(" – ")) {
            const left = name.split(" – ")[0];
            if (left.includes(" odc.")) {
                showTitle = left.split(" odc.")[0];
            } else {
                showTitle = left;
            }
        } else if (name.includes(" odc.")) {
            showTitle = name.split(" odc.")[0];
        }
        
        return codeMatch ? `${safe(showTitle)}_${codeMatch[0]}.json` : `${safe(showTitle)}.json`;
    };

    const downloadJSON = () => {
        const payload = {
            'JSON-LD':     state.jsonld        ?? null,
            manifest_url:  state.manifest_url  ?? null,
            subtitles_url: state.subtitles_url ?? null,
        };

        log('Downloading JSON:\n' + JSON.stringify(payload, null, 2));

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: buildFilename() });
        a.style.display = 'none';
        document.body.appendChild(a);
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: unsafeWindow }));

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (EPISODE_LINKS.includes(location.href)) {
                redirectToNextEpisode();
            }
        }, 2000);
    };

    // -------------------------------------------------------------------------
    // Main sequence
    // -------------------------------------------------------------------------
    const run = async () => {
        log('Starting auto-play sequence...');
        waitForJsonLd();

        try {
            await waitForPlayButton();
            await detectBlobVideo();
            await waitForPostAdPlay();
            scanPerformance();

            if (downloadTriggered) return;

            log('Waiting 5s for player to settle...');
            await new Promise(r => setTimeout(r, 5000));
            scanPerformance();

            if (downloadTriggered) return;

            await enableSubtitles();
            await new Promise(r => setTimeout(r, 500));

            const btn = findPlayButton();
            if (btn) btn.click();

            if (!state.subtitles_url) {
                log('Polling for subtitles URL (up to 10s)...');
                await new Promise((resolve) => {
                    let waited = 0;
                    const poll = setInterval(() => {
                        scanPerformance();
                        waited += 500;
                        if (downloadTriggered || waited >= 10000) { clearInterval(poll); resolve(); }
                    }, 500);
                });
            }

            if (!downloadTriggered) {
                log('Subtitles URL not captured – downloading with available data.');
                downloadTriggered = true;
                downloadJSON();
            }

            log('Sequence complete.');
        } catch (err) {
            log(`Error during sequence: ${err.message}`);
        }
    };

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    const init = () => {
        log('TVP Video Info Extractor v4.0 loaded.');
        patchRequests();
        patchWorker();
        installPerformanceObserver();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(run, 2000));
        } else {
            setTimeout(run, 2000);
        }

        // SPA navigation detection
        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                log('URL changed – restarting sequence.');
                resetAll();
                setTimeout(run, 3000);
            }
        }).observe(document, { subtree: true, childList: true });
    };

    init();

})();