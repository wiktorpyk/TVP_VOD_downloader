// ==UserScript==
// @name         TVP Video Info Extractor
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Extracts metadata, manifest URL, and subtitles URL from TVP VOD pages and downloads them as JSON
// @author       You
// @match        https://vod.tvp.pl/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Logger
    // -------------------------------------------------------------------------
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

    const resetAll = () => {
        Object.keys(data).forEach((k) => { data[k] = null; });
    };

    // -------------------------------------------------------------------------
    // Link list configuration
    // -------------------------------------------------------------------------
    const EPISODE_LINKS = [
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-1,S01E01,381046',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-2,S01E02,381053',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-3,S01E03,381057',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-4,S01E04,381055',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-5,S01E05,381052',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-6,S01E06,381056',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-7,S01E07,381048',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-8,S01E08,381051',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-9,S01E09,381047',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-10,S01E10,381049',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-11,S01E11,381065',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-12,S01E12,381050',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-13,S01E13,381054',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-14,S02E14,381150',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-15,S02E15,381138',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-16,S02E16,381151',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-17,S02E17,381139',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-18,S02E18,381140',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-19,S02E19,381141',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-20,S02E20,381152',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-21,S02E21,381153',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-22,S02E22,381154',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-23,S02E23,381142',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-24,S02E24,381155',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-25,S02E25,381143',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-26,S02E26,381156',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-27,S03E27,381063',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-28,S03E28,381059',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-29,S03E29,381068',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-30,S03E30,381082',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-31,S03E31,381071',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-32,S03E32,381070',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-33,S03E33,381069',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-34,S03E34,381067',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-35,S03E35,381081',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-36,S03E36,381061',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-37,S03E37,381064',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-38,S03E38,381062',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-39,S03E39,381060',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-40,S04E40,381088',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-41,S04E41,381085',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-42,S04E42,381076',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-43,S04E43,381072',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-44,S04E44,381075',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-45,S04E45,381091',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-46,S04E46,381087',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-47,S04E47,381090',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-48,S04E48,381073',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-49,S04E49,381089',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-50,S04E50,381086',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-51,S04E51,381084',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-52,S04E52,381074',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-53,S05E53,381092',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-54,S05E54,381093',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-55,S05E55,381097',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-56,S05E56,381113',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-57,S05E57,381098',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-58,S05E58,381080',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-59,S05E59,381078',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-60,S05E60,381100',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-61,S05E61,381096',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-62,S05E62,381079',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-63,S05E63,381095',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-64,S05E64,381099',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-65,S05E65,381094',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-66,S06E66,381242',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-67,S06E67,381227',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-68,S06E68,962202',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-69,S06E69,381115',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-70,S06E70,381103',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-71,S06E71,381120',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-72,S06E72,381119',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-73,S06E73,381117',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-74,S06E74,381102',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-75,S06E75,381118',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-76,S06E76,381121',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-77,S06E77,381116',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-78,S06E78,381114',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-79,S07E79,381105',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-80,S07E80,381130',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-81,S07E81,381106',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-82,S07E82,381128',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-83,S07E83,381108',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-84,S07E84,381126',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-85,S07E85,381129',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-86,S07E86,381104',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-87,S07E87,381123',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-88,S07E88,381107',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-89,S07E89,381127',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-90,S07E90,381124',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-91,S07E91,381125',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-92,S08E92,381147',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-93,S08E93,381136',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-94,S08E94,381148',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-95,S08E95,381110',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-96,S08E96,381111',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-97,S08E97,381135',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-98,S08E98,381134',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-99,S08E99,381145',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-100,S08E100,381112',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-101,S08E101,381146',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-102,S08E102,381133',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-103,S08E103,381132',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-104,S08E104,381109',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-105,S09E105,387677',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-106,S09E106,387669',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-107,S09E107,387670',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-108,S09E108,387671',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-109,S09E109,387672',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-110,S09E110,387689',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-111,S09E111,387680',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-112,S09E112,387690',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-113,S09E113,387691',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-114,S09E114,387694',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-115,S09E115,387681',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-116,S09E116,387692',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-117,S09E117,387693',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-118,S10E118,387880',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-119,S10E119,387913',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-120,S10E120,387899',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-121,S10E121,387706',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-122,S10E122,387721',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-123,S10E123,388059',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-124,S10E124,387707',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-125,S10E125,387708',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-126,S10E126,387695',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-127,S10E127,387709',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-128,S10E128,387697',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-129,S10E129,387710',
        'https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-130,S10E130,387698'
    ];

    // -------------------------------------------------------------------------
    // Link management functions
    // -------------------------------------------------------------------------
    const isCurrentUrlInLinkList = () => {
        const currentUrl = location.href;
        return EPISODE_LINKS.includes(currentUrl);
    };

    const getNextEpisodeUrl = () => {
        const currentUrl = location.href;
        const currentIndex = EPISODE_LINKS.indexOf(currentUrl);

        if (currentIndex !== -1 && currentIndex < EPISODE_LINKS.length - 1) {
            return EPISODE_LINKS[currentIndex + 1];
        }

        return null; // No next episode found
    };

    const redirectToNextEpisode = () => {
        const nextUrl = getNextEpisodeUrl();
        if (nextUrl) {
            log(`Redirecting to next episode: ${nextUrl}`);
            setTimeout(() => {
                location.href = nextUrl;
            }, 2000); // Wait 2 seconds before redirecting
        } else {
            log('No next episode found in the list. This was the last episode.');
        }
    };

    // -------------------------------------------------------------------------
    // URL pattern matching
    // -------------------------------------------------------------------------
    // Observed real URL: https://sdt-epix7-38.tvp.pl/token/video/vod/.../video.ism/nv-dash-init-vod4-....mp4
    // Host prefix is "sdt-" (not "rsdt-" as originally assumed). Broadened to match
    // any *.tvp.pl CDN host so future host changes don't break capture again.
    const MANIFEST_SEGMENT_RE = /^(https:\/\/[^/]*\.tvp\.pl\/token\/video\/vod\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/video\.ism\/)nv-dash-[^/]+-vod[^/]*\.(mp4|m4s)$/;

    // Observed real URL: https://s.tvp.pl/repository/attachment/f/8/b/<hash>.xml
    // The hash is split into single-char subdirectories before the full filename,
    // e.g. .../attachment/f/8/b/f8bc272dc1c9a673....xml
    const SUBTITLES_RE        = /^https:\/\/s\.tvp\.pl\/repository\/attachment\/(?:[0-9a-f]\/)*[0-9a-f][^/]*\.xml$/;

    const testAndStoreUrl = (url) => {
        if (typeof url !== 'string') return;

        if (!data.manifest_url) {
            const m = url.match(MANIFEST_SEGMENT_RE);
            if (m) {
                data.manifest_url = m[1] + 'Manifest';
                log(`Captured manifest URL: ${data.manifest_url}`);
            } else if (url.includes('video.ism')) {
                // URL contains video.ism but didn't match – log so the regex can
                // be adjusted if the segment filename format has changed.
                log(`[NEAR-MISS manifest] ${url}`);
            }
        }

        if (!data.subtitles_url) {
            if (SUBTITLES_RE.test(url)) {
                data.subtitles_url = url;
                log(`Captured subtitles URL: ${data.subtitles_url}`);
            } else if (url.includes('s.tvp.pl/repository/attachment') && (url.endsWith('.xml') || url.endsWith('.vtt') || url.endsWith('.srt'))) {
                log(`[NEAR-MISS subtitles] ${url}`);
            }
        }
    };

    // -------------------------------------------------------------------------
    // Step 2a – PerformanceObserver (main thread + any same-origin resources)
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
    // Step 2b – Main-thread fetch / XHR patch
    //
    // Patches unsafeWindow.fetch and XMLHttpRequest.prototype.open so that every
    // network request made from the page's own JS (including the DASH player and
    // subtitle loader running on the main thread) is passed through testAndStoreUrl.
    // This is the primary capture mechanism when Worker patching is unavailable.
    // -------------------------------------------------------------------------
    const patchMainThreadRequests = () => {
        try {
            // --- fetch ---
            const origFetch = unsafeWindow.fetch;
            unsafeWindow.fetch = function (input, init) {
                try {
                    const url = (input && typeof input === 'object') ? input.url : String(input);
                    testAndStoreUrl(url);
                } catch (_) { /* never break the player */ }
                return origFetch.apply(unsafeWindow, arguments);
            };
            // Verify the assignment actually took effect.
            if (unsafeWindow.fetch !== origFetch) {
                log('Main-thread fetch patched.');
            } else {
                log('Main-thread fetch patch silently failed (read-only property?).');
            }
        } catch (e) {
            log(`Main-thread fetch patch error: ${e.message}`);
        }

        try {
            // --- XHR ---
            const origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
            unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
                try { testAndStoreUrl(String(url)); } catch (_) { /* never break */ }
                return origOpen.apply(this, arguments);
            };
            log('Main-thread XHR patched.');
        } catch (e) {
            log(`Main-thread XHR patch error: ${e.message}`);
        }
    };

    // -------------------------------------------------------------------------
    // Step 2c – Worker constructor patch
    //
    // The DASH player spawns a Web Worker for segment fetching. Workers have
    // their own isolated performance timeline and global scope, so the
    // PerformanceObserver above cannot see their requests.
    //
    // Fix: override the Worker constructor to synchronously fetch the worker
    // script, prepend a small shim that patches fetch and XHR inside the worker
    // and relays every URL back to the main thread via postMessage, then hand
    // the modified script to the real Worker as a blob URL.
    //
    // The shim uses a namespaced message key (__tvpExtractorUrl) so it never
    // collides with the player's own postMessage traffic.
    // -------------------------------------------------------------------------
    const WORKER_SHIM = `
(function () {
    var _tag = '__tvpExtractorUrl';

    // Patch fetch inside the worker
    if (typeof self.fetch === 'function') {
        var _origFetch = self.fetch.bind(self);
        self.fetch = function (input, init) {
            var url = (input && typeof input === 'object') ? input.url : String(input);
            self.postMessage({ _tag: _tag, url: url });
            return _origFetch(input, init);
        };
    }

    // Patch XHR inside the worker
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
                let worker;

                try {
                    // Fetch the worker source synchronously (same-origin or blob URL).
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', scriptURL, false);
                    xhr.send();

                    if (xhr.status === 200 || xhr.status === 0) {
                        const patched  = new Blob(
                            [WORKER_SHIM, xhr.responseText],
                            { type: 'application/javascript' }
                        );
                        const blobUrl  = URL.createObjectURL(patched);
                        worker         = new OriginalWorker(blobUrl, options);

                        // Relay URL reports from the worker to the main store.
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

                // Fallback: create unmodified worker.
                return new OriginalWorker(scriptURL, options);
            };

            unsafeWindow.Worker.prototype = OriginalWorker.prototype;

            // Verify the assignment actually took effect.
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
    // Step 1 – DOM metadata extraction
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
            const el = document.querySelector(sel);
            if (el) {
                const text = el.textContent.trim();
                if (text) return text;
            }
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
        let episode_code = null;
        if (numMatch) {
            const s    = String(numMatch[1]).padStart(2, '0');
            const e    = String(numMatch[2]).padStart(2, '0');
            episode_code = `S${s}E${e}`;
        }
        const titleMatch  = text.match(/[–\-]\s*(.+)$/);
        const episode_title = titleMatch ? titleMatch[1].trim() : text;
        return { episode_code, episode_title };
    };

    // Fallback: parse <script type="application/ld+json"> VideoObject block.
    // Present in the raw HTML before Vue renders, so reliably available even
    // when DOM polling races or the SPA has not finished mounting.
    // Example field: "name": "Ranczo odc. 1 – Spadek"
    const extractFromJsonLd = () => {
        try {
            for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
                const json = JSON.parse(el.textContent);
                if (json['@type'] !== 'VideoObject') continue;

                // "name" is "<Series> odc. <N> – <EpisodeTitle>"
                const fullName = (json.name || '').trim();
                if (fullName && !data.title) {
                    const splitIdx = fullName.toLowerCase().indexOf(' odc.');
                    if (splitIdx !== -1) {
                        data.title = fullName.slice(0, splitIdx).trim();
                        const episodePart = fullName.slice(splitIdx + 1).trim();

                        // Derive season number from mainEntityOfPage URL: .../S01E01,...
                        let seasonNum = null;
                        const pageId = (json.mainEntityOfPage || {})['@id'] || '';
                        const seasonMatch = pageId.match(/S(\d+)E\d+/i);
                        if (seasonMatch) seasonNum = parseInt(seasonMatch[1], 10);

                        const epNumMatch = episodePart.match(/odc\.\s*(\d+)/i);
                        if (epNumMatch && seasonNum !== null) {
                            const s = String(seasonNum).padStart(2, '0');
                            const e = String(epNumMatch[1]).padStart(2, '0');
                            data.episode_code = `S${s}E${e}`;
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

        // Fill any remaining gaps from JSON-LD.
        if (!data.title || !data.episode_code || !data.description) {
            extractFromJsonLd();
        }
    };

    const waitForMetadata = () => {
        // Try JSON-LD immediately – it is present in the raw HTML before Vue
        // renders and is therefore available at document-start.
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

    // Auto-play helpers
    // -------------------------------------------------------------------------

    // Ordered list of CSS selectors tried for the initial play button.
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

    // Find a play button that is currently visible (offsetParent !== null).
    // Returns the element or null.
    const findVisiblePlayButton = () => {
        for (const selector of PLAY_SELECTORS) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) return btn;
        }
        // Text-content fallback.
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

    // Wait up to maxWaitMs for a visible play button to appear, then click it.
    // Uses both MutationObserver (reacts immediately to DOM changes) and a
    // 250 ms interval (catches CSS visibility changes that don't alter DOM).
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

            // Try immediately in case it is already visible.
            tryClick();
        });
    };

    // Click a play button right now, ignoring visibility.
    // Used after subtitle selection when the player is already running.
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
                cleanup();
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
            const cleanup = () => {
                observer.disconnect();
                clearTimeout(timeoutId);
            };
            observer.observe(document.body, { childList: true, subtree: true });
            check();
        });
    };

    // After ads the player pauses on the main content and shows a dedicated
    // in-player play button. Watch for it via MutationObserver and click it.
    const waitForPostAdPlay = (maxWaitMs = 30000) => {
        log('Watching for post-ad play button...');
        return new Promise((resolve) => {
            let settled = false;
            const settle = (clicked) => {
                if (settled) return;
                settled = true;
                cleanup();
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
            const cleanup = () => {
                observer.disconnect();
                clearTimeout(timeoutId);
            };

            observer.observe(document.body, {
                childList:  true,
                subtree:    true,
                attributes: true,
                attributeFilter: ['class', 'style', 'aria-label'],
            });
        });
    };

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
                    cls.includes('settings') ||
                    cls.includes('gear') ||
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
            if (header && header.textContent.includes('Napisy')) {
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
    // Step 3 – Assemble and download JSON
    // -------------------------------------------------------------------------
    const buildFilename = () => {
        const safe  = (s) => (s || 'unknown').replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim();
        const code  = data.episode_code || 'NoCode';
        const title = safe(data.title);
        return `${title}_${code}.json`;
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
        const json     = JSON.stringify(payload, null, 2);
        const blob     = new Blob([json], { type: 'application/json' });
        const url      = URL.createObjectURL(blob);
        const a        = document.createElement('a');
        a.href         = url;
        a.download     = buildFilename();
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Check if current URL is in our link list and redirect to next episode
            if (isCurrentUrlInLinkList()) {
                log('Current episode is in link list, preparing to redirect to next episode...');
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

            // Wait for the player to attach a blob-URL video element.
            await detectBlobVideo();

            // Click the post-ad resume button if it appears.
            await waitForPostAdPlay();

            // Scan timeline now that segments are actively being fetched.
            scanExistingEntries();

            log('Waiting 10 s for player to settle...');
            await new Promise((r) => setTimeout(r, 10000));

            scanExistingEntries();

            await enableSubtitles();

            // Re-click play after closing the settings menu so the player
            // resumes and fetches the selected subtitle track.
            await new Promise((r) => setTimeout(r, 500));
            await clickPlayButton();

            // Poll for the subtitle XML request after enabling subtitles.
            if (!data.subtitles_url) {
                log('Subtitles URL not yet seen, waiting up to 10 s...');
                const POLL_INTERVAL_MS = 500;
                const POLL_MAX_MS      = 10000;
                let waited = 0;
                await new Promise((resolve) => {
                    const poll = setInterval(() => {
                        scanExistingEntries();
                        waited += POLL_INTERVAL_MS;
                        if (data.subtitles_url || waited >= POLL_MAX_MS) {
                            clearInterval(poll);
                            resolve();
                        }
                    }, POLL_INTERVAL_MS);
                });
            }

            downloadJSON();
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

        // All patches must run before any page script creates Workers or makes
        // network requests, which is guaranteed by @run-at document-start.
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