// ==UserScript==
// @name         TVP VOD – Extract Ranczo Links + Images
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Collect all episode links and images for ranczo-odcinki,316445 only
// @match        https://vod.tvp.pl/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const TARGET_SLUG = 'ranczo-odcinki,316445';
    const allLinks = {};

    function getCurrentSeasonLabel() {
        const el = document.querySelector('.select-box__name--selected .select-box__name-text');
        return el ? el.textContent.trim() : 'Unknown';
    }

    function collectLinks() {
        const season = getCurrentSeasonLabel();
        if (!allLinks[season]) allLinks[season] = [];

        document.querySelectorAll('.tile__link').forEach(a => {
            const href = a.getAttribute('href');

            // Only collect links belonging to ranczo-odcinki,316445
            if (!href || !href.includes(TARGET_SLUG)) return;

            const label = a.getAttribute('aria-label') || a.textContent.trim();

            // Grab the episode thumbnail inside this link
            const imgEl = a.querySelector('img.cover');
            let imgSrc = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src')) : null;
            if (imgSrc && imgSrc.startsWith('//')) imgSrc = 'https:' + imgSrc;

            if (!allLinks[season].find(e => e.href === href)) {
                allLinks[season].push({ href, label, imgSrc });
            }
        });
    }


    // ------------------------------------------------------------------ //
    //  Main download: text file first, then images                        //
    // ------------------------------------------------------------------ //
    async function downloadResults() {
        const allEntries = [];
        let output = `TVP VOD – Ranczo (${TARGET_SLUG})\n`;
        output += `Extracted: ${new Date().toLocaleString()}\n\n`;

        for (const [season, links] of Object.entries(allLinks)) {
            if (links.length === 0) continue;
            output += `=== ${season} ===\n`;
            links.forEach(({ href, label, imgSrc }) => {
                const fullUrl = href.startsWith('http') ? href : 'https://vod.tvp.pl' + href;
                output += `${label}\n${fullUrl}\n`;
                if (imgSrc) output += `Obraz: ${imgSrc}\n`;
                output += '\n';
                allEntries.push({ href, label, imgSrc });
            });
        }

        // 1) Save the text index file
        const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'ranczo_links.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('[TVP Extractor] Done. Links collected:', allLinks);

        // 2) Save image URLs as JSON
        const images = allEntries
            .filter(e => e.imgSrc)
            .map(({ href, imgSrc }) => ({
                href: href.startsWith('http') ? href : 'https://vod.tvp.pl' + href,
                imgSrc
            }));
        if (images.length > 0) {
            const jsonBlob = new Blob([JSON.stringify(images, null, 2)], { type: 'application/json' });
            const jsonUrl  = URL.createObjectURL(jsonBlob);
            const aj = document.createElement('a');
            aj.href = jsonUrl;
            aj.download = 'ranczo_images.json';
            document.body.appendChild(aj);
            aj.click();
            document.body.removeChild(aj);
            URL.revokeObjectURL(jsonUrl);
        }
    }

    // ------------------------------------------------------------------ //
    //  Collect current page, then download                               //
    // ------------------------------------------------------------------ //
    async function run() {
        collectLinks();
        const season = getCurrentSeasonLabel();
        const count = allLinks[season]?.length ?? 0;
        console.log(`[TVP Extractor] Collected ${count} Ranczo links for "${season}"`);
        await downloadResults();
    }

    // ------------------------------------------------------------------ //
    //  Floating UI button                                                  //
    // ------------------------------------------------------------------ //
    const btn = document.createElement('button');
    btn.textContent = '⬇ Collect This Season';
    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        padding: 10px 16px;
        background: #e63312;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;

    btn.addEventListener('click', () => {
        btn.disabled    = true;
        btn.textContent = '⏳ Extracting…';
        run().then(() => {
            btn.textContent = '✅ Done!';
            setTimeout(() => {
                btn.textContent = '⬇ Collect This Season';
                btn.disabled = false;
            }, 3000);
        });
    });

    document.body.appendChild(btn);
})();
