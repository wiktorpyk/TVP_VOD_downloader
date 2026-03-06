// ==UserScript==
// @name         TVP Video Info Extractor
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Extracts metadata, manifest URL, and subtitles URL from TVP VOD pages and downloads them as JSON
// @author       You
// @match        https://vod.tvp.pl/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    const log = (msg) => console.log(`[TVP Extractor] ${msg}`);

    // -------------------------------------------------------------------------
    // Shared data store
    // -------------------------------------------------------------------------
    const data = {
        title:         null,
        episode_title: null,
        episode_code:  null,
        description:   null,
        manifest_url:  null,
        subtitles_url: null,
    };

    let downloadTriggered = false;

    const resetAll = () => {
        Object.keys(data).forEach((k) => { data[k] = null; });
        downloadTriggered = false;
    };

    // -------------------------------------------------------------------------
    // Episode link list
    // -------------------------------------------------------------------------
    const EPISODE_LINKS = [
    ];

    const getNextEpisodeUrl = () => {
        const idx = EPISODE_LINKS.indexOf(location.href);
        return (idx !== -1 && idx < EPISODE_LINKS.length - 1) ? EPISODE_LINKS[idx + 1] : null;
    };

    const redirectToNextEpisode = () => {
        const nextUrl = getNextEpisodeUrl();
        if (nextUrl) {
            log(`Redirecting to next episode: ${nextUrl}`);
            setTimeout(() => { location.href = nextUrl; }, 2000);
        } else {
            log('No next episode found – this was the last one. Closing tab.');
            setTimeout(() => {
                window.close();
            }, 2000);
        }
    };

    // -------------------------------------------------------------------------
    // URL pattern matching
    // -------------------------------------------------------------------------
    const MANIFEST_SEGMENT_RE = /^(https:\/\/[^/]*\.tvp\.pl\/token\/video\/vod\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/video\.ism\/)nv-dash-[^/]+-vod[^/]*\.(mp4|m4s)$/;
    const SUBTITLES_RE        = /^https:\/\/s\.tvp\.pl\/repository\/attachment\/(?:[0-9a-f]\/)*[0-9a-f][^/]*\.xml$/;

    const onBothCaptured = () => {
        if (downloadTriggered) return;
        if (!data.manifest_url || !data.subtitles_url) return;
        downloadTriggered = true;
        log('Both URLs captured – triggering download and redirect.');
        downloadJSON();
    };

    const testAndStoreUrl = (url) => {
        if (typeof url !== 'string' || downloadTriggered) return;

        if (!data.manifest_url) {
            const m = url.match(MANIFEST_SEGMENT_RE);
            if (m) {
                data.manifest_url = m[1] + 'Manifest';
                log(`Captured manifest URL: ${data.manifest_url}`);
            } else if (url.includes('video.ism')) {
                log(`[NEAR-MISS manifest] ${url}`);
            }
        }

        if (!data.subtitles_url) {
            if (SUBTITLES_RE.test(url)) {
                data.subtitles_url = url;
                log(`Captured subtitles URL: ${data.subtitles_url}`);
            } else if (
                url.includes('s.tvp.pl/repository/attachment') &&
                (url.endsWith('.xml') || url.endsWith('.vtt') || url.endsWith('.srt'))
            ) {
                log(`[NEAR-MISS subtitles] ${url}`);
            }
        }

        onBothCaptured();
    };

    // -------------------------------------------------------------------------
    // PerformanceObserver
    // -------------------------------------------------------------------------
    const installPerformanceObserver = () => {
        try {
            const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) testAndStoreUrl(entry.name);
            });
            po.observe({ type: 'resource', buffered: true });
            log('PerformanceObserver installed.');
        } catch (e) {
            log(`PerformanceObserver unavailable: ${e.message}`);
        }
    };

    const scanExistingEntries = () => {
        performance.getEntriesByType('resource').forEach((e) => testAndStoreUrl(e.name));
    };

    // -------------------------------------------------------------------------
    // Main-thread fetch / XHR patch
    // -------------------------------------------------------------------------
    const patchMainThreadRequests = () => {
        try {
            const origFetch = unsafeWindow.fetch;
            unsafeWindow.fetch = function (input, init) {
                try {
                    testAndStoreUrl((input && typeof input === 'object') ? input.url : String(input));
                } catch (_) {}
                return origFetch.apply(unsafeWindow, arguments);
            };
            if (unsafeWindow.fetch !== origFetch) {
                log('Main-thread fetch patched.');
            } else {
                log('Main-thread fetch patch silently failed (read-only property?).');
            }
        } catch (e) {
            log(`Main-thread fetch patch error: ${e.message}`);
        }

        try {
            const origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
            unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
                try { testAndStoreUrl(String(url)); } catch (_) {}
                return origOpen.apply(this, arguments);
            };
            log('Main-thread XHR patched.');
        } catch (e) {
            log(`Main-thread XHR patch error: ${e.message}`);
        }
    };

    // -------------------------------------------------------------------------
    // Worker constructor patch
    // -------------------------------------------------------------------------
    const WORKER_SHIM = `
(function () {
    var _tag = '__tvpExtractorUrl';
    if (typeof self.fetch === 'function') {
        var _origFetch = self.fetch.bind(self);
        self.fetch = function (input, init) {
            var url = (input && typeof input === 'object') ? input.url : String(input);
            self.postMessage({ _tag: _tag, url: url });
            return _origFetch(input, init);
        };
    }
    if (typeof XMLHttpRequest !== 'undefined') {
        var _origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            self.postMessage({ _tag: _tag, url: String(url) });
            return _origOpen.apply(this, arguments);
        };
    }
})();
`;

    const patchWorkerConstructor = () => {
        try {
            const OriginalWorker = unsafeWindow.Worker;

            unsafeWindow.Worker = function (scriptURL, options) {
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', scriptURL, false);
                    xhr.send();

                    if (xhr.status === 200 || xhr.status === 0) {
                        const blob    = new Blob([WORKER_SHIM, xhr.responseText], { type: 'application/javascript' });
                        const blobUrl = URL.createObjectURL(blob);
                        const worker  = new OriginalWorker(blobUrl, options);

                        worker.addEventListener('message', (e) => {
                            if (e.data && e.data._tag === '__tvpExtractorUrl') {
                                testAndStoreUrl(e.data.url);
                            }
                        });

                        log(`Worker patched: ${scriptURL.slice(0, 80)}`);
                        return worker;
                    }
                } catch (inner) {
                    log(`Worker patch inner error: ${inner.message} – falling back.`);
                }

                return new OriginalWorker(scriptURL, options);
            };

            unsafeWindow.Worker.prototype = OriginalWorker.prototype;

            if (unsafeWindow.Worker !== OriginalWorker) {
                log('Worker constructor patched.');
            } else {
                log('Worker constructor assignment silently failed (property not writable).');
            }
        } catch (e) {
            log(`Worker constructor patch failed: ${e.message}`);
        }
    };

    // -------------------------------------------------------------------------
    // DOM metadata extraction
    // -------------------------------------------------------------------------
    const TITLE_SELECTORS = [
        'p.ui-player-gui-title__headline',
        'h1.ui-player-gui-title__headline',
        '.ui-player-gui-title__headline',
        'h1.player-title',
        '.player-title h1',
        'h1',
    ];

    const extractTitle = () => {
        for (const sel of TITLE_SELECTORS) {
            const el   = document.querySelector(sel);
            const text = el?.textContent.trim();
            if (text) return text;
        }
        return null;
    };

    const extractEpisodeRaw = () => {
        const SEASON_RE = /Sezon\s+\d+/i;
        for (const el of document.querySelectorAll('span.metadata__product-meta-element')) {
            const text = el.textContent.trim();
            if (SEASON_RE.test(text)) return text;
        }
        return null;
    };

    const parseEpisodeMeta = (raw) => {
        if (!raw) return { episode_code: null, episode_title: null };
        const text     = raw.replace(/\s+/g, ' ').trim();
        const numMatch = text.match(/Sezon\s+(\d+)[^]*?odc\.\s*(\d+)/i);
        const episode_code = numMatch
            ? `S${String(numMatch[1]).padStart(2, '0')}E${String(numMatch[2]).padStart(2, '0')}`
            : null;
        const titleMatch   = text.match(/[–\-]\s*(.+)$/);
        const episode_title = titleMatch ? titleMatch[1].trim() : text;
        return { episode_code, episode_title };
    };

    const extractFromJsonLd = () => {
        try {
            for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
                const json = JSON.parse(el.textContent);
                if (json['@type'] !== 'VideoObject') continue;

                const fullName = (json.name || '').trim();
                if (fullName && !data.title) {
                    const splitIdx = fullName.toLowerCase().indexOf(' odc.');
                    if (splitIdx !== -1) {
                        data.title = fullName.slice(0, splitIdx).trim();
                        const episodePart = fullName.slice(splitIdx + 1).trim();

                        const pageId      = (json.mainEntityOfPage || {})['@id'] || '';
                        const seasonMatch = pageId.match(/S(\d+)E\d+/i);
                        const seasonNum   = seasonMatch ? parseInt(seasonMatch[1], 10) : null;
                        const epNumMatch  = episodePart.match(/odc\.\s*(\d+)/i);

                        if (epNumMatch && seasonNum !== null) {
                            data.episode_code = `S${String(seasonNum).padStart(2, '0')}E${String(epNumMatch[1]).padStart(2, '0')}`;
                        }

                        const titleMatch = episodePart.match(/[–\-]\s*(.+)$/);
                        if (titleMatch) data.episode_title = titleMatch[1].trim();
                    } else {
                        data.title = fullName;
                    }
                }

                if (json.description && !data.description) {
                    data.description = json.description.trim();
                }

                if (data.title) {
                    log(`JSON-LD – title: "${data.title}", code: "${data.episode_code}", desc present: ${!!data.description}`);
                    return true;
                }
            }
        } catch (e) {
            log(`JSON-LD parse error: ${e.message}`);
        }
        return false;
    };

    const extractMetadata = () => {
        const title      = extractTitle();
        const episodeRaw = extractEpisodeRaw();
        const descEl     = document.querySelector('p.ui-metadata-description__text');

        if (title)  data.title       = title;
        if (descEl) data.description = descEl.textContent.trim();

        if (episodeRaw) {
            const { episode_code, episode_title } = parseEpisodeMeta(episodeRaw);
            data.episode_title = episode_title;
            data.episode_code  = episode_code;
            log(`Parsed episode – title: "${episode_title}", code: "${episode_code}"`);
        }

        log(`Metadata extracted – title: "${data.title}", description present: ${!!data.description}`);

        if (!data.title || !data.episode_code || !data.description) {
            extractFromJsonLd();
        }
    };

    const waitForMetadata = () => {
        if (extractFromJsonLd()) {
            log('Metadata pre-resolved from JSON-LD.');
        }

        const INTERVAL_MS  = 500;
        const MAX_ATTEMPTS = 40;
        let attempts = 0;

        const interval = setInterval(() => {
            attempts++;
            if (extractTitle() || extractEpisodeRaw() || document.querySelector('p.ui-metadata-description__text')) {
                extractMetadata();
                clearInterval(interval);
                return;
            }
            if (attempts >= MAX_ATTEMPTS) {
                log('Metadata DOM elements not found within timeout – using JSON-LD only.');
                clearInterval(interval);
            }
        }, INTERVAL_MS);
    };

    // -------------------------------------------------------------------------
    // Play button helpers
    // -------------------------------------------------------------------------
    const PLAY_SELECTORS = [
        '.button--watch',
        'button[aria-label*="Odtwórz"]',
        'button[aria-label*="odtwórz"]',
        '.button.button--with-icon.button--watch',
        '.icon-play',
        '.play-btn',
        '.video-player-play',
        '.player-play',
        '[data-testid="play-button"]',
        '.vjs-big-play-button',
        '.video-js .vjs-play-control',
        'button[title*="Play"]',
        'button[aria-label*="Play"]',
        '.play-button',
        '#playButton',
        '.btn-play',
    ];

    const findVisiblePlayButton = () => {
        for (const selector of PLAY_SELECTORS) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) return btn;
        }
        for (const btn of document.querySelectorAll('button')) {
            if (btn.offsetParent === null) continue;
            const text  = btn.textContent.toLowerCase();
            const aria  = btn.getAttribute('aria-label')?.toLowerCase();
            const title = btn.getAttribute('title')?.toLowerCase();
            if (
                text.includes('odtwórz')   || text.includes('play')   ||
                aria?.includes('odtwórz')  || aria?.includes('play')  ||
                title?.includes('odtwórz') || title?.includes('play')
            ) return btn;
        }
        return null;
    };

    const waitForPlayButton = (maxWaitMs = 15000) => {
        log('Waiting for play button to become visible...');
        return new Promise((resolve) => {
            let settled = false;
            const settle = (found) => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearInterval(intervalId);
                clearTimeout(timeoutId);
                resolve(found);
            };

            const tryClick = () => {
                const btn = findVisiblePlayButton();
                if (btn) {
                    log(`Found play button: ${btn.className || btn.getAttribute('aria-label')}`);
                    btn.click();
                    settle(true);
                }
            };

            const observer   = new MutationObserver(tryClick);
            const intervalId = setInterval(tryClick, 250);
            const timeoutId  = setTimeout(() => {
                log('Play button did not become visible within timeout – continuing anyway.');
                settle(false);
            }, maxWaitMs);

            observer.observe(document.body, {
                childList:       true,
                subtree:         true,
                attributes:      true,
                attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
            });

            tryClick();
        });
    };

    const clickPlayButton = () => {
        for (const selector of PLAY_SELECTORS) {
            const btn = document.querySelector(selector);
            if (btn) { btn.click(); return true; }
        }
        for (const btn of document.querySelectorAll('button')) {
            const aria = btn.getAttribute('aria-label')?.toLowerCase();
            if (aria?.includes('odtwórz') || aria?.includes('play')) {
                btn.click();
                return true;
            }
        }
        return false;
    };

    const detectBlobVideo = (maxWaitMs = 300000) => {
        log('Waiting for <video> element with blob src...');
        return new Promise((resolve) => {
            let settled = false;
            const settle = (src) => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(timeoutId);
                resolve(src);
            };

            const check = () => {
                for (const video of document.querySelectorAll('video')) {
                    if (typeof video.src === 'string' && video.src.startsWith('blob:https://vod.tvp.pl/')) {
                        log(`Detected <video> blob src: ${video.src}`);
                        settle(video.src);
                        return true;
                    }
                }
                return false;
            };

            const observer  = new MutationObserver(() => { check(); });
            const timeoutId = setTimeout(() => {
                log('Max wait time reached without blob video, proceeding anyway.');
                settle(null);
            }, maxWaitMs);

            observer.observe(document.body, { childList: true, subtree: true });
            check();
        });
    };

    const waitForPostAdPlay = (maxWaitMs = 30000) => {
        log('Watching for post-ad play button...');
        return new Promise((resolve) => {
            let settled = false;
            const settle = (clicked) => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(timeoutId);
                resolve(clicked);
            };

            const POST_AD_SELECTORS = [
                'button.ui-player-gui-button--play',
                'button[aria-label="Odtwórz materiał"]',
                'button[aria-label*="Odtwórz materiał"]',
            ];

            const check = () => {
                for (const selector of POST_AD_SELECTORS) {
                    const btn = document.querySelector(selector);
                    if (btn && btn.offsetParent !== null) {
                        log(`Found post-ad play button (${selector}), clicking.`);
                        btn.click();
                        settle(true);
                        return true;
                    }
                }
                return false;
            };

            if (check()) return;

            const observer  = new MutationObserver(() => { check(); });
            const timeoutId = setTimeout(() => {
                log('No post-ad play button seen within timeout – continuing.');
                settle(false);
            }, maxWaitMs);

            observer.observe(document.body, {
                childList:       true,
                subtree:         true,
                attributes:      true,
                attributeFilter: ['class', 'style', 'aria-label'],
            });
        });
    };

    // -------------------------------------------------------------------------
    // Subtitle helpers
    // -------------------------------------------------------------------------
    const enableSubtitles = async () => {
        log('Looking for subtitle controls...');

        const settingsSelectors = [
            '.ui-player-gui-button--settings',
            '.icon-settings',
            'button[aria-label*="Ustawienia"]',
            'button[aria-label*="ustawienia"]',
            'button[title*="Ustawienia"]',
            'button[title*="ustawienia"]',
            '.ui-player-controls-top__button--settings',
            '.settings-button',
            'button[class*="settings"]',
        ];

        let opened = false;

        for (const selector of settingsSelectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) {
                log(`Found settings button: ${selector}`);
                btn.click();
                await new Promise((r) => setTimeout(r, 1000));
                opened = true;
                break;
            }
        }

        if (!opened) {
            for (const btn of document.querySelectorAll('button')) {
                const aria = btn.getAttribute('aria-label')?.toLowerCase();
                const cls  = btn.className.toLowerCase();
                if (
                    aria?.includes('ustawienia') ||
                    cls.includes('settings')     ||
                    cls.includes('gear')         ||
                    btn.querySelector('.icon-settings, .icon-gear')
                ) {
                    log('Found settings button by aria-label/class/icon');
                    btn.click();
                    await new Promise((r) => setTimeout(r, 1000));
                    opened = true;
                    break;
                }
            }
        }

        if (!opened) {
            log('Could not find or open settings menu.');
            return false;
        }

        await new Promise((r) => setTimeout(r, 500));
        return selectPolishSubtitles();
    };

    const selectPolishSubtitles = async () => {
        log('Looking for Polish subtitle options...');

        for (const col of document.querySelectorAll('.ui-player-gui-settings__column')) {
            const header = col.querySelector('.ui-player-gui-settings__item--header');
            if (!header?.textContent.includes('Napisy')) continue;

            log('Found Napisy column.');
            for (const item of col.querySelectorAll('.ui-player-gui-settings__item')) {
                if (item.textContent.trim().includes('Polski dla niesłyszących')) {
                    log('Selecting "Polski dla niesłyszących"');
                    item.click();
                    return true;
                }
            }
            log('Napisy column found but Polish option not present.');
            return false;
        }

        for (const opt of document.querySelectorAll('.ui-player-gui-settings__item, button, li, option')) {
            const text = opt.textContent.trim();
            if (text.length <= 100 && text.includes('Polski dla niesłyszących')) {
                log(`Found Polish subtitle option: "${text}"`);
                opt.click();
                return true;
            }
        }

        log('Polish subtitle option not found.');
        return false;
    };

    // -------------------------------------------------------------------------
    // Download JSON
    // -------------------------------------------------------------------------
    const buildFilename = () => {
        const safe = (s) => (s || 'unknown').replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim();
        return `${safe(data.title)}_${data.episode_code || 'NoCode'}.json`;
    };

    const downloadJSON = () => {
        const payload = {
            title:         data.title         ?? null,
            episode_title: data.episode_title ?? null,
            episode_code:  data.episode_code  ?? null,
            description:   data.description   ?? null,
            manifest_url:  data.manifest_url  ?? null,
            subtitles_url: data.subtitles_url ?? null,
        };

        log('Downloading JSON:\n' + JSON.stringify(payload, null, 2));

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: buildFilename() });

        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (EPISODE_LINKS.includes(location.href)) {
                log('Current episode is in link list, preparing to redirect...');
                redirectToNextEpisode();
            }
        }, 200);
    };

    // -------------------------------------------------------------------------
    // Main sequence
    // -------------------------------------------------------------------------
    const executeAutoPlay = async () => {
        log('Starting auto-play sequence...');
        waitForMetadata();

        try {
            await waitForPlayButton();
            await detectBlobVideo();
            await waitForPostAdPlay();

            scanExistingEntries();

            // If both URLs were already captured (e.g. from PerformanceObserver
            // or XHR/fetch patches), onBothCaptured() will have already fired.
            // The steps below only run when the subtitles URL is still missing.
            if (downloadTriggered) return;

            log('Waiting 5 s for player to settle...');
            await new Promise((r) => setTimeout(r, 5000));
            scanExistingEntries();

            if (downloadTriggered) return;

            await enableSubtitles();
            await new Promise((r) => setTimeout(r, 500));
            clickPlayButton();

            if (!data.subtitles_url) {
                log('Subtitles URL not yet seen, waiting up to 10 s...');
                const POLL_INTERVAL_MS = 500;
                const POLL_MAX_MS      = 10000;
                let waited = 0;
                await new Promise((resolve) => {
                    const poll = setInterval(() => {
                        scanExistingEntries();
                        waited += POLL_INTERVAL_MS;
                        if (downloadTriggered || waited >= POLL_MAX_MS) {
                            clearInterval(poll);
                            resolve();
                        }
                    }, POLL_INTERVAL_MS);
                });
            }

            // Final fallback: download whatever we have.
            if (!downloadTriggered) {
                log('Subtitles URL not captured – downloading with available data.');
                downloadTriggered = true;
                downloadJSON();
            }

            log('Auto-play sequence completed.');
        } catch (err) {
            log(`Error during auto-play: ${err.message}`);
        }
    };

    // -------------------------------------------------------------------------
    // Initialisation
    // -------------------------------------------------------------------------
    const init = () => {
        log('TVP Video Info Extractor loaded.');

        patchMainThreadRequests();
        patchWorkerConstructor();
        installPerformanceObserver();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(executeAutoPlay, 2000));
        } else {
            setTimeout(executeAutoPlay, 2000);
        }

        // SPA navigation detection.
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                log('URL changed – restarting auto-play sequence.');
                resetAll();
                setTimeout(executeAutoPlay, 3000);
            }
        }).observe(document, { subtree: true, childList: true });
    };

    init();

})();