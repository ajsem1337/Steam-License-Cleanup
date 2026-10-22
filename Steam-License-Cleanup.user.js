// ==UserScript==
// @name         Steam License Cleanup
// @namespace    https://github.com/PatrickJnr/Steam-License-Cleanup/
// @version      1.9.2
// @description  Verifies demo licenses using Steam client metadata, scans all license pages, and allows review before removal. Includes optional name filters, progress, rate-limit handling, and cancellation.
// @author       PatrickJnr (Enhanced by Gemini)
// @match        https://store.steampowered.com/account/licenses*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ajsem1337/Steam-License-Cleanup/main/Steam-License-Cleanup.user.js
// @downloadURL  https://raw.githubusercontent.com/ajsem1337/Steam-License-Cleanup/main/Steam-License-Cleanup.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- CONFIGURATION & STATE ---
    const DEFAULTS = {
        verifiedDemosOnly: true,
        keywords: ["trailer", "teaser", "demo", "cinematic", "pegi", "esrb", "soundtrack", "playtest", "beta", "alpha"],
        exclusions: ["(Soundtrack)", "Game Developer"], // Example: protect items with these words
        removalDelay: 600000 // Default 10 minute (600,000 ms) delay between removals
    };
    let state = {
        settings: {
            keywords: [],
            exclusions: [],
            removalDelay: 600000
        },
        isCleaning: false,
        isScanning: false,
        isImporting: false,
        metadata: null,
        scanStats: null,
        cleanupController: null,
        cleanupStatus: "",
        removedDetails: [],
        scannedLicenses: [] // Holds { packageId, details }
    };

    // Steam cache formats: https://github.com/xPaw/SteamAppInfo
    // Read locally selected files only; tokens and other unused fields are discarded.
    const duplicateKeys = Symbol('duplicateSteamMetadataKeys');
    const hasDuplicate = (object, key) => Boolean(object?.[duplicateKeys]?.has(key));
    const isRecord = value => value !== null && typeof value === 'object';
    class CacheReader {
        constructor(buffer) {
            this.bytes = new Uint8Array(buffer);
            this.view = new DataView(buffer);
            this.position = 0;
            this.limit = buffer.byteLength;
            this.strings = null;
            // A malformed character in a name or unused field must not reject the
            // entire cache. Replaced characters cannot match the exact type Demo.
            this.decoder = new TextDecoder('utf-8');
        }
        require(size) {
            if (!Number.isSafeInteger(size) || size < 0 || this.position + size > this.limit) {
                throw new Error('Truncated or invalid Steam metadata file.');
            }
        }
        skip(size) { this.require(size); this.position += size; }
        byte() { this.require(1); return this.bytes[this.position++]; }
        uint32() {
            this.require(4);
            const value = this.view.getUint32(this.position, true);
            this.position += 4;
            return value;
        }
        uint64() {
            this.require(8);
            const value = this.view.getBigUint64(this.position, true);
            this.position += 8;
            return value;
        }
        string() {
            const start = this.position;
            while (this.byte() !== 0) { /* scan to the terminating byte */ }
            return this.decoder.decode(this.bytes.subarray(start, this.position - 1));
        }
        keyValues(depth = 0) {
            if (depth > 64) throw new Error('Steam metadata nesting is too deep.');
            const result = Object.create(null);
            while (true) {
                const type = this.byte();
                if (type === 8) return result;
                let key;
                if (this.strings) {
                    const index = this.uint32();
                    if (index >= this.strings.length) throw new Error('Invalid Steam metadata string-table index.');
                    key = this.strings[index];
                } else {
                    key = this.string();
                }
                key = key.toLowerCase();
                let value;
                switch (type) {
                    case 0: value = this.keyValues(depth + 1); break;
                    case 1: value = this.string(); break;
                    case 2: case 4: case 6: value = this.uint32(); break;
                    case 3:
                        this.require(4);
                        value = this.view.getFloat32(this.position, true);
                        this.position += 4;
                        break;
                    case 5: {
                        const start = this.position;
                        while (true) {
                            this.require(2);
                            const character = this.view.getUint16(this.position, true);
                            this.position += 2;
                            if (character === 0) break;
                        }
                        value = new TextDecoder('utf-16le').decode(this.bytes.subarray(start, this.position - 2));
                        break;
                    }
                    case 7: case 10: value = this.uint64().toString(); break;
                    default: throw new Error(`Unsupported Steam metadata value type ${type}.`);
                }
                // KeyValues allows repeated names. Keep reading descriptive fields,
                // but record ambiguity so overwritten type/contents cannot qualify.
                if (Object.hasOwn(result, key)) {
                    if (!result[duplicateKeys]) result[duplicateKeys] = new Set();
                    result[duplicateKeys].add(key);
                }
                result[key] = value;
            }
        }
    }

    const parseAppCache = async (buffer) => {
        const reader = new CacheReader(buffer);
        const magic = reader.uint32();
        if (![0x07564427, 0x07564428, 0x07564429].includes(magic)) {
            throw new Error('Unsupported appinfo.vdf version (supported: 39, 40, 41).');
        }
        if (reader.uint32() !== 1) throw new Error('Only public-universe Steam metadata is supported.');
        const version = magic & 0xff;
        let entriesEnd = reader.limit;
        if (version === 41) {
            const offset = Number(reader.uint64());
            if (!Number.isSafeInteger(offset) || offset < reader.position || offset > reader.limit - 4) {
                throw new Error('Invalid appinfo.vdf string-table offset.');
            }
            const start = reader.position;
            reader.position = offset;
            const count = reader.uint32();
            if (count > reader.limit - reader.position) throw new Error('Invalid appinfo.vdf string-table size.');
            reader.strings = [];
            for (let i = 0; i < count; i++) reader.strings.push(reader.string());
            if (reader.position !== reader.limit) throw new Error('Unexpected data after the appinfo.vdf string table.');
            reader.position = start;
            entriesEnd = offset;
        }
        reader.limit = entriesEnd;
        const apps = new Map();
        // v41 has an explicit end offset; compacted caches may omit the zero footer.
        while (reader.position < entriesEnd) {
            const appid = reader.uint32();
            if (appid === 0) break;
            const size = reader.uint32();
            reader.require(size);
            const end = reader.position + size;
            const outerLimit = reader.limit;
            reader.limit = end;
            reader.skip(4); // info state
            const updated = reader.uint32();
            reader.skip(8 + 20 + 4 + (version >= 40 ? 20 : 0));
            const root = reader.keyValues();
            const data = root.appinfo;
            if (reader.position !== end) {
                throw new Error(`Invalid appinfo.vdf record for App ID ${appid}.`);
            }
            const identityKnown = isRecord(data) && !hasDuplicate(root, 'appinfo') && !hasDuplicate(data, 'appid')
                && (data.appid === undefined || Number(data.appid) === appid) && !apps.has(String(appid));
            const common = identityKnown && !hasDuplicate(data, 'common') && isRecord(data.common) ? data.common : null;
            apps.set(String(appid), {
                name: !hasDuplicate(common, 'name') && typeof common?.name === 'string' ? common.name : '',
                type: !hasDuplicate(common, 'type') && typeof common?.type === 'string' ? common.type.toLowerCase() : '',
                updated
            });
            reader.limit = outerLimit;
            if (apps.size % 200 === 0) await wait(0);
        }
        if (reader.position !== entriesEnd) throw new Error('Unexpected data after appinfo.vdf records.');
        return apps;
    };

    const parsePackageCache = async (buffer) => {
        const reader = new CacheReader(buffer);
        const magic = reader.uint32();
        if (![0x06565527, 0x06565528].includes(magic)) {
            throw new Error('Unsupported packageinfo.vdf version (supported: 39, 40).');
        }
        if (reader.uint32() !== 1) throw new Error('Only public-universe Steam metadata is supported.');
        const packages = new Map();
        while (true) {
            const packageid = reader.uint32();
            if (packageid === 0xffffffff) break;
            reader.skip(20 + 4 + ((magic & 0xff) >= 40 ? 8 : 0));
            const root = reader.keyValues();
            const data = root[String(packageid)];
            const contentsKnown = isRecord(data) && !hasDuplicate(root, String(packageid))
                && !hasDuplicate(data, 'packageid') && !hasDuplicate(data, 'appids') && !packages.has(String(packageid))
                && (data.packageid === undefined || Number(data.packageid) === packageid)
                && isRecord(data.appids) && !data.appids[duplicateKeys]?.size;
            const appids = contentsKnown ? Object.values(data.appids) : [];
            packages.set(String(packageid), appids.length && appids.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)
                ? [...new Set(appids.map(id => String(Number(id))))] : []);
            if (packages.size % 200 === 0) await wait(0);
        }
        if (reader.position !== reader.limit) throw new Error('Unexpected data after packageinfo.vdf records.');
        return packages;
    };

    const verifyDemoPackage = (packageId) => {
        const appids = state.metadata?.packages.get(packageId);
        if (!appids?.length) return { status: 'unknown', reason: 'Package contents unavailable' };
        const apps = appids.map(id => ({ id, ...state.metadata.apps.get(id) }));
        if (apps.some(app => app.type && app.type !== 'demo')) {
            return { status: 'other', reason: 'Package contains a non-demo application' };
        }
        if (apps.some(app => !app.type)) return { status: 'unknown', reason: 'Application type unavailable' };
        return { status: 'demo', apps };
    };

    const importSteamMetadata = async (files) => {
        if (state.isScanning || state.isCleaning || state.isImporting) return;
        state.isImporting = true;
        state.metadata = null;
        state.scannedLicenses = [];
        setControlsDisabled(true);
        const status = document.getElementById('metadata-status');
        status.textContent = 'Reading local Steam metadata...';
        try {
            const appFile = [...files].find(file => file.name.toLowerCase() === 'appinfo.vdf');
            const packageFile = [...files].find(file => file.name.toLowerCase() === 'packageinfo.vdf');
            if (files.length !== 2 || !appFile || !packageFile) throw new Error('Select both appinfo.vdf and packageinfo.vdf together.');
            const apps = await parseAppCache(await appFile.arrayBuffer());
            const packages = await parsePackageCache(await packageFile.arrayBuffer());
            state.metadata = { apps, packages };
            status.textContent = `Loaded ${apps.size} apps and ${packages.size} packages from local Steam cache. App cache file: ${new Date(appFile.lastModified).toLocaleString()}.`;
        } catch (error) {
            status.textContent = `Metadata not loaded: ${error.message}`;
        } finally {
            state.isImporting = false;
            setControlsDisabled(false);
        }
    };

    // --- STYLES ---
    const addGlobalStyle = () => {
        const style = document.createElement('style');
        style.innerHTML = `
            :root {
                --steam-blue: #66c0f4;
                --steam-blue-hover: #a2d9f8;
                --steam-dark: #1b2838;
                --steam-dark-gradient: linear-gradient(to bottom, #2a475e 5%, #1b2838 95%);
                --steam-light-text: #c7d5e0;
                --steam-white-text: #ffffff;
                --steam-error: #ff3300;
                --steam-warning: #ffcc00;
            }
            .cleanup-controls-container {
                text-align: center;
                margin-bottom: 20px;
                padding: 10px;
                background-color: rgba(0,0,0,0.2);
                border-radius: 5px;
            }
            .date-range-container {
                margin-bottom: 15px;
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 15px;
            }
            .metadata-controls {
                text-align: left;
                max-width: 800px;
                margin: 0 auto 15px;
            }
            .metadata-controls p { margin: 8px 0; }
            .date-range-container label {
                color: var(--steam-light-text);
                font-size: 14px;
            }
            .date-range-container input[type="date"] {
                background-color: #2a3f5a;
                border: 1px solid var(--steam-blue);
                color: var(--steam-light-text);
                padding: 5px;
                border-radius: 3px;
            }
            .steam-cleanup-button {
                background: var(--steam-dark-gradient);
                border: 1px solid var(--steam-blue);
                border-radius: 4px;
                color: var(--steam-light-text);
                font-size: 14px;
                padding: 10px 20px;
                cursor: pointer;
                margin: 5px;
                display: inline-block;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                transition: all 0.2s;
            }
            .steam-cleanup-button:hover, .steam-cleanup-button:focus {
                background: var(--steam-blue);
                color: var(--steam-white-text);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                outline: none;
            }
            .steam-cleanup-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .steam-cleanup-button.cancel-button {
                background: #c23b22;
                border-color: #ff6347;
            }
            .steam-cleanup-button.cancel-button:hover {
                background: #e04a31;
            }
            .progress-bar-container {
                width: 100%;
                background-color: var(--steam-dark);
                border-radius: 4px;
                margin: 10px auto;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                max-width: 600px;
                padding: 5px;
            }
            .progress-bar {
                width: 0%;
                height: 20px;
                background-color: var(--steam-blue);
                border-radius: 4px;
                text-align: center;
                line-height: 20px;
                color: var(--steam-white-text);
                transition: width 0.3s ease-in-out, background-color 0.3s;
            }
            .progress-status-text {
                text-align: center;
                margin-top: 5px;
                color: var(--steam-light-text);
                font-style: italic;
            }
            .modal-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.7); z-index: 999; display: flex;
                align-items: center; justify-content: center;
            }
            .modal-content {
                background: var(--steam-dark); color: var(--steam-light-text);
                padding: 30px; border: 1px solid var(--steam-blue); border-radius: 8px;
                box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3); z-index: 1000;
                width: 90%; max-width: 800px; max-height: 90vh;
                display: flex; flex-direction: column;
                animation: fadeIn 0.3s;
            }
            .modal-header h2 {
                margin: 0 0 20px 0;
            }
            .modal-body {
                overflow-y: auto;
                margin-bottom: 20px;
            }
            .modal-footer {
                margin-top: auto;
                text-align: right;
                border-top: 1px solid #3a4b5e;
                padding-top: 20px;
            }
            .modal-textarea {
                width: 95%;
                height: 80px;
                margin-bottom: 15px;
                background: #2a3f5a;
                color: var(--steam-light-text);
                border: 1px solid var(--steam-blue);
                padding: 10px;
            }
             .modal-input {
                width: 100px;
                margin-bottom: 15px;
                background: #2a3f5a;
                color: var(--steam-light-text);
                border: 1px solid var(--steam-blue);
                padding: 5px;
            }
            #review-list {
                list-style: none;
                padding: 0;
            }
            #review-list label {
                display: block;
                padding: 8px;
                border-radius: 3px;
                transition: background-color 0.2s;
                cursor: pointer;
                word-break: break-word;
            }
            #review-list label:hover {
                background-color: #2a475e;
            }
            #review-list input {
                margin-right: 10px;
                vertical-align: middle;
            }
            .review-controls {
                margin-bottom: 15px;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: scale(0.95); }
                to { opacity: 1; transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    };

    // --- HELPERS ---
    const parseSteamDate = (dateString) => {
        if (!dateString) return null;
        // Scan responses are requested in English, independently of the UI language.
        const date = new Date(`${dateString.replace(',', '')} UTC`);
        return Number.isNaN(date.getTime()) ? null : date;
    };

    const escapeHTML = (text) => String(text).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));

    const keywordPattern = (keywords) => {
        if (!keywords.length) return null;
        const escaped = keywords.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${escaped.join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    };

    const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, milliseconds);
        signal?.addEventListener('abort', abort, { once: true });
    });

    const retryDelay = (response, attempt) => {
        const header = response.headers.get('Retry-After');
        const seconds = header === null ? NaN : Number(header);
        const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
        return Math.min(300000, Math.max(30000 * 2 ** attempt, requested || 0));
    };

    const setControlsDisabled = (disabled) => {
        document.querySelectorAll('#cleanup-controls button, #cleanup-controls input')
            .forEach(control => { control.disabled = disabled; });
    };

    // --- LOCALSTORAGE & SETTINGS ---
    const loadSettings = () => {
        try {
            const saved = localStorage.getItem('steamLicenseCleanupSettings');
            const parsed = saved ? JSON.parse(saved) : {};
            // Merge saved settings with defaults to ensure new settings are applied
            state.settings = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...parsed };
        } catch (e) {
            console.error("Failed to load settings:", e);
            state.settings = JSON.parse(JSON.stringify(DEFAULTS));
        }
    };

    const saveSettings = () => {
        try {
            localStorage.setItem('steamLicenseCleanupSettings', JSON.stringify(state.settings));
        } catch (e) {
            console.error("Failed to save settings:", e);
        }
    };

    // --- CORE LOGIC: SCANNING & REMOVAL ---
    const parseTableForDetails = (tableElement) => {
        const foundLicenses = [];
        if (!tableElement) return foundLicenses;

        const { keywords, exclusions } = state.settings;

        const keywordRegex = keywordPattern(keywords);
        const exclusionRegex = keywordPattern(exclusions);

        const startDateInput = document.getElementById('start-date-input').valueAsDate;
        const endDateInput = document.getElementById('end-date-input').valueAsDate;

        for (const row of tableElement.rows) {
            // Date check
            const dateText = row.cells[0]?.textContent?.trim();
            const cell = row.cells[1];
            if (!cell) continue;
            const nameCell = cell.cloneNode(true);
            nameCell.querySelectorAll('.free_license_remove_link, a[href*="RemoveFreeLicense"], a[href*="steamdb.info"]')
                .forEach(element => element.remove());
            const cellText = nameCell.textContent.trim().replace(/\s+/g, ' ');
            if (!cellText) continue;
            
            // 1. First, check for exclusions. If it's excluded, we skip it immediately.
            if (exclusionRegex && exclusionRegex.test(cellText)) {
                continue;
            }

            // 2. Next, determine if it meets the inclusion criteria.
            let isMatch = false;
            if (keywords.length === 0) {
                // If the inclusion list is empty, everything that wasn't excluded is a match.
                isMatch = true;
            } else if (state.settings.verifiedDemosOnly || (keywordRegex && keywordRegex.test(cellText))) {
                // Otherwise, if the inclusion list is not empty, the item must match it.
                isMatch = true;
            }

            // 3. If it's not a match, skip to the next license.
            if (!isMatch) continue;
            // Add the license to the list
            const link = cell.querySelector('a[href*="RemoveFreeLicense"]');
            const packageIdMatch = link ? /RemoveFreeLicense\s*\(\s*(\d+)/.exec(link.getAttribute('href')) : null;
            if (packageIdMatch) {
                // Dates must only affect a scan when the user enabled a date filter.
                if (startDateInput || endDateInput) {
                    const licenseDate = parseSteamDate(dateText);
                    if (!licenseDate) throw new Error(`Cannot read the acquisition date for ${cellText}. Clear the date filters and try again.`);
                    if (startDateInput && licenseDate < startDateInput) continue;
                    if (endDateInput) {
                        const endOfDay = new Date(endDateInput);
                        endOfDay.setUTCHours(23, 59, 59, 999);
                        if (licenseDate > endOfDay) continue;
                    }
                }
                const packageId = packageIdMatch[1];
                let verification = '';
                if (state.settings.verifiedDemosOnly) {
                    const result = verifyDemoPackage(packageId);
                    state.scanStats[result.status].add(packageId);
                    if (result.status !== 'demo') continue;
                    if (exclusionRegex && result.apps.some(app => exclusionRegex.test(app.name || ''))) continue;
                    verification = ` [Verified from local Steam cache: ${result.apps.map(app => `${app.id} = Demo`).join(', ')}]`;
                }
                const details = `${cellText}${verification} (Acquired: ${dateText}, Package ID: ${packageId})`;
                foundLicenses.push({ packageId, details, verifiedDemo: state.settings.verifiedDemosOnly });
            }
        }
        return foundLicenses;
    };


    const scanAllPages = async () => {
        if (state.isScanning || state.isCleaning || state.isImporting) return;
        if (state.settings.verifiedDemosOnly && !state.metadata) {
            showInfoModal('Steam Metadata Required', 'Import appinfo.vdf and packageinfo.vdf from your Steam appcache folder first. Only packages containing exclusively Demo-type applications will be selected.');
            return;
        }
        state.isScanning = true;
        state.scannedLicenses = [];
        state.scanStats = { demo: new Set(), other: new Set(), unknown: new Set() };
        setControlsDisabled(true);
        const { modal, statusElement } = showWorkingModal(
            "Scanning Licenses",
            "Please wait while all license pages are scanned. This may take a moment."
        );

        const allLicenses = [];
        const existingIds = new Set();
        const visitedURLs = new Set();
        let page = 1;
        // Always scan from the beginning, even when opened on a later page.
        let pageURL = new URL('/account/licenses/?l=english', window.location.origin);

        try {
            const startDate = document.getElementById('start-date-input').valueAsDate;
            const endDate = document.getElementById('end-date-input').valueAsDate;
            if (startDate && endDate && startDate > endDate) {
                throw new Error('The start date must not be after the end date.');
            }

            while (pageURL) {
                if (visitedURLs.has(pageURL.href)) throw new Error('Steam returned a repeated next-page link.');
                visitedURLs.add(pageURL.href);
                statusElement.textContent = `Scanning page ${page} — ${allLicenses.length} matching licenses found...`;

                let response;
                for (let attempt = 0; attempt < 4; attempt++) {
                    response = await fetch(pageURL.href, { credentials: 'same-origin' });
                    if (response.status !== 429) break;
                    if (attempt === 3) throw new Error('Steam is still rate limiting the scan. Try again later.');
                    const delay = retryDelay(response, attempt);
                    statusElement.textContent = `Steam rate limit — retrying page ${page} in ${delay / 1000}s...`;
                    await wait(delay);
                }
                if (!response.ok) throw new Error(`Could not scan page ${page} (HTTP ${response.status}).`);

                const text = await response.text();
                const doc = new DOMParser().parseFromString(text, 'text/html');
                const table = doc.querySelector(".account_table");
                if (!table) throw new Error(`No license table on page ${page}. Check that you are signed in to Steam.`);
                const licensesOnPage = parseTableForDetails(table);

                licensesOnPage.forEach(license => {
                    if (!existingIds.has(license.packageId)) {
                        allLicenses.push(license);
                        existingIds.add(license.packageId);
                    }
                });

                // A page with zero matches can still lead to pages containing demos.
                const next = doc.querySelector('a.license_paginator_next, a.pagebtn.next');
                const href = next?.getAttribute('href');
                if (!href || next.classList.contains('disabled') || next.getAttribute('aria-disabled') === 'true') break;
                pageURL = new URL(href, pageURL);
                if (pageURL.origin !== window.location.origin || pageURL.pathname !== '/account/licenses/') {
                    throw new Error('Steam returned an unexpected next-page URL.');
                }
                pageURL.searchParams.set('l', 'english');
                page++;
                await wait(500);
            }

            modal.remove();
            state.scannedLicenses = allLicenses;
            showReviewModal();
        } catch (error) {
            console.error('License scan failed:', error);
            modal.remove();
            // Never offer an incomplete result as a successfully finished scan.
            showInfoModal('Scan Failed', `${escapeHTML(error.message)} No licenses were removed. Run the scan again to review the complete list.`);
        } finally {
            state.isScanning = false;
            setControlsDisabled(false);
        }
    };


    const removeNextPackage = async (licensesToRemove, i, progressBar, statusText) => {
        const signal = state.cleanupController.signal;
        try {
            for (; i < licensesToRemove.length; i++) {
                signal.throwIfAborted();
                const license = licensesToRemove[i];
                const progress = (i / licensesToRemove.length) * 100;
                for (let attempt = 0; ; attempt++) {
                    signal.throwIfAborted();
                    updateProgressBar(progressBar, statusText, progress, `Removing: ${license.details}`);
                    const response = await fetch('/account/removelicense', {
                        method: 'POST',
                        credentials: 'same-origin',
                        signal,
                        body: new URLSearchParams({
                            sessionid: window.g_sessionID,
                            packageid: license.packageId
                        })
                    });
                    let rateLimited = response.status === 429;
                    if (!rateLimited) {
                        if (!response.ok) throw new Error(`HTTP ${response.status} while removing ${license.details}.`);
                        const data = await response.json();
                        const result = Number(data.success);
                        rateLimited = result === 84;
                        // Other nonzero Steam result codes are errors, not successes.
                        if (!rateLimited && result !== 1) {
                            throw new Error(`Steam rejected ${license.details} (result ${data.success}).`);
                        }
                    }
                    if (!rateLimited) break;
                    if (attempt === 3) throw new Error('Steam is still rate limiting removals. Try again later.');
                    const delay = retryDelay(response, attempt);
                    updateProgressBar(progressBar, statusText, progress, `Rate limited. Retrying in ${delay / 1000}s...`, 'var(--steam-warning)');
                    await wait(delay, signal);
                }

                state.removedDetails.push(license.details);
                state.scannedLicenses = state.scannedLicenses.filter(item => item.packageId !== license.packageId);
                const completedProgress = ((i + 1) / licensesToRemove.length) * 100;
                if (i + 1 < licensesToRemove.length) {
                    const message = `Removed ${state.removedDetails.length} of ${licensesToRemove.length}. Waiting ${state.settings.removalDelay / 1000}s for next removal...`;
                    updateProgressBar(progressBar, statusText, completedProgress, message);
                    await wait(state.settings.removalDelay, signal);
                } else {
                    updateProgressBar(progressBar, statusText, completedProgress, 'Cleanup complete.');
                }
            }
        } catch (error) {
            if (signal.aborted) {
                state.cleanupStatus = 'Cleanup cancelled. A request already sent to Steam may still finish; rescan before retrying.';
            } else {
                console.error('License cleanup stopped:', error);
                state.cleanupStatus = `Cleanup stopped: ${error.message} Rescan before retrying.`;
            }
        } finally {
            state.isCleaning = false;
            state.cleanupController = null;
            updateUICleanupFinished();
        }
    };

    const startCleanup = (licensesToRemove) => {
        if (state.isCleaning || state.isScanning || state.isImporting || licensesToRemove.length === 0) return;
        if (state.settings.verifiedDemosOnly && licensesToRemove.some(license => verifyDemoPackage(license.packageId).status !== 'demo')) {
            showInfoModal('Verification Failed', 'A selected package could not be verified as demos only. Import current Steam metadata and scan again.');
            return;
        }
        if (!window.g_sessionID) {
            showInfoModal("Error: Not Logged In", "Could not find a valid Steam session ID. Please make sure you are fully logged into store.steampowered.com and refresh the page.");
            return;
        }
        const mainContainer = document.getElementById("cleanup-controls");
        setControlsDisabled(true);

        const { progressBarContainer, progressBar, statusText } = createProgressBar();
        mainContainer.appendChild(progressBarContainer);
        const cancelButton = createCancelButton();
        mainContainer.appendChild(cancelButton);

        state.isCleaning = true;
        state.cleanupController = new AbortController();
        state.cleanupStatus = 'Cleanup complete.';
        state.removedDetails = []; // Reset for this run
        removeNextPackage(licensesToRemove, 0, progressBar, statusText);
    };

    // --- UI & MODALS ---
    const createButton = (id, text, title, onClick) => {
        const button = document.createElement("button");
        button.id = id;
        button.textContent = text;
        button.title = title;
        button.className = "steam-cleanup-button";
        button.addEventListener("click", onClick);
        return button;
    };

    const createCancelButton = () => {
        const button = createButton("cancel-button", "Cancel", "Stop the cleanup process", () => state.cleanupController?.abort());
        button.classList.add("cancel-button");
        return button;
    };

    const createProgressBar = () => {
        const progressBarContainer = document.createElement("div");
        progressBarContainer.className = "progress-bar-container";
        const progressBar = document.createElement("div");
        progressBar.className = "progress-bar";
        const statusText = document.createElement("div");
        statusText.className = "progress-status-text";
        progressBarContainer.append(progressBar, statusText);
        return { progressBarContainer, progressBar, statusText };
    };

    const updateProgressBar = (progressBar, statusText, progress, text, color = 'var(--steam-blue)') => {
        if (!progressBar) return;
        progressBar.style.width = `${progress}%`;
        progressBar.textContent = `${Math.round(progress)}%`;
        progressBar.style.backgroundColor = color;
        statusText.textContent = text;
    };

    const showModal = (title, content, buttons, isClosable = true) => {
        const modalOverlay = document.createElement("div");
        modalOverlay.className = "modal-overlay";
        const modalContent = document.createElement("div");
        modalContent.className = "modal-content";
        modalContent.innerHTML = `<div class="modal-header"><h2>${title}</h2></div><div class="modal-body">${content}</div>`;
        const footer = document.createElement("div");
        footer.className = "modal-footer";

        buttons.forEach(btnInfo => {
            const button = createButton(btnInfo.id || '', btnInfo.text, '', () => {
                if (btnInfo.onClick) btnInfo.onClick();
                if (btnInfo.closes) document.body.removeChild(modalOverlay);
            });
            if (btnInfo.class) button.classList.add(btnInfo.class);
            footer.appendChild(button);
        });

        if (isClosable) {
            const closeButton = createButton('modal-close', 'Close', 'Close this dialog', () => document.body.removeChild(modalOverlay));
            footer.appendChild(closeButton);
        }

        modalContent.appendChild(footer);
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);
        return modalOverlay;
    };

    const showInfoModal = (title, message) => {
        showModal(title, `<p>${message}</p>`, []);
    };



    const showWorkingModal = (title, initialMessage) => {
        const content = `<p>${initialMessage}</p><p id="working-status" style="font-weight: bold; text-align: center; margin-top: 15px;"></p>`;
        const modal = showModal(title, content, [], false);
        const statusElement = modal.querySelector('#working-status');
        return { modal, statusElement };
    };

    const exportRemovedLicenses = () => {
        if (state.removedDetails.length === 0) return;
        const textToSave = state.removedDetails.join("\n");
        const blob = new Blob([textToSave], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const date = new Date().toISOString().slice(0, 10);
        a.download = `steam_removed_licenses_${date}.txt`;
        document.body.appendChild(a); // Required for Firefox compatibility
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const showSettingsModal = () => {
        const content = `
            <p>In <strong>Only verified demos</strong> mode, inclusion keywords are ignored. Steam application types determine what qualifies; exclusions and date filters still apply.</p>
            <p><strong>Inclusion Keywords (one per line or comma-separated):</strong><br>Licenses containing these words will be selected for removal.</p>
            <textarea id="keywords-textarea" class="modal-textarea">${escapeHTML(state.settings.keywords.join(", "))}</textarea>
            <p><strong>Exclusion Keywords (one per line or comma-separated):</strong><br>Licenses containing these words will be protected, even if they match inclusion keywords.</p>
            <textarea id="exclusions-textarea" class="modal-textarea">${escapeHTML(state.settings.exclusions.join(", "))}</textarea>
            <p style="color: var(--steam-warning);"><strong>Warning:</strong> If inclusion keywords are empty, the script will select ALL removable licenses within the chosen date range except those matching exclusions.</p>
            <hr style="border-color: #3a4b5e; margin: 20px 0;">
            <p><strong>Delay Between Removals (milliseconds):</strong><br>A delay after each removal to prevent API errors. 1000ms = 1 second. Default is 600000 (10 minutes).</p>
            <input type="number" id="delay-input" class="modal-input" value="${state.settings.removalDelay}">
        `;
        const parseInput = (text) => text.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        const buttons = [{
            text: "Save",
            closes: true,
            onClick: () => {
                state.settings.keywords = parseInput(document.getElementById("keywords-textarea").value);
                state.settings.exclusions = parseInput(document.getElementById("exclusions-textarea").value);
                const delay = Number(document.getElementById("delay-input").value);
                state.settings.removalDelay = Number.isFinite(delay) && delay >= 0 ? delay : DEFAULTS.removalDelay;
                saveSettings();
            }
        }, {
            text: "Reset to Default",
            closes: false,
            onClick: () => {
                state.settings = JSON.parse(JSON.stringify(DEFAULTS));
                document.getElementById("keywords-textarea").value = state.settings.keywords.join(", ");
                document.getElementById("exclusions-textarea").value = state.settings.exclusions.join(", ");
                document.getElementById("delay-input").value = state.settings.removalDelay;
                document.getElementById('verified-demos-only').checked = state.settings.verifiedDemosOnly;
                state.scannedLicenses = [];
            }
        }];
        showModal("Cleanup Settings", content, buttons);
    };

    const showReviewModal = () => {
        const verificationSummary = state.settings.verifiedDemosOnly
            ? `Verified against imported Steam cache. Skipped ${state.scanStats.other.size} packages containing non-demo apps and ${state.scanStats.unknown.size} packages with missing metadata. Missing metadata never qualifies a package for removal.`
            : 'Name-filter mode: application types have NOT been verified.';
        if (state.scannedLicenses.length === 0) {
            showInfoModal("Scan Complete", `No removable licenses matching your criteria were found. ${verificationSummary}`);
            return;
        }
        const listItems = state.scannedLicenses.map((lic, index) =>
            `<li><label><input type="checkbox" class="license-checkbox" data-index="${index}" checked> ${escapeHTML(lic.details)}</label></li>`
        ).join("");

        const content = `
            <p>${verificationSummary}</p>
            <p>Found <strong>${state.scannedLicenses.length}</strong> license(s) matching your criteria. Review the list below and uncheck any you wish to keep.</p>
            <div class="review-controls">
                <button class="steam-cleanup-button" id="select-all">Select All</button>
                <button class="steam-cleanup-button" id="deselect-all">Deselect All</button>
            </div>
            <ul id="review-list">${listItems}</ul>
        `;
        const buttons = [{
            text: `Remove Selected (0)`,
            id: "review-proceed-button",
            closes: true,
            onClick: () => {
                const selectedLicenses = [];
                document.querySelectorAll('.license-checkbox:checked').forEach(cb => {
                    selectedLicenses.push(state.scannedLicenses[cb.dataset.index]);
                });
                if (selectedLicenses.length > 0) showConfirmModal(selectedLicenses);
            }
        }];
        const modal = showModal("Review Licenses to Remove", content, buttons);
        const proceedBtn = modal.querySelector('#review-proceed-button');
        const checkboxes = modal.querySelectorAll('.license-checkbox');
        const updateCount = () => {
            const count = modal.querySelectorAll('.license-checkbox:checked').length;
            proceedBtn.textContent = `Remove Selected (${count})`;
            proceedBtn.disabled = count === 0;
        };
        checkboxes.forEach(cb => cb.addEventListener('change', updateCount));
        modal.querySelector('#select-all').addEventListener('click', () => { checkboxes.forEach(cb => cb.checked = true); updateCount(); });
        modal.querySelector('#deselect-all').addEventListener('click', () => { checkboxes.forEach(cb => cb.checked = false); updateCount(); });
        updateCount();
    };

    const showConfirmModal = (selectedLicenses) => {
        const content = `<p>You are about to permanently remove <strong>${selectedLicenses.length}</strong> license(s). This action cannot be undone. Are you sure?</p>`;
        const buttons = [{
            text: "Yes, Clean Up",
            closes: true,
            onClick: () => startCleanup(selectedLicenses)
        }];
        showModal("Confirm Cleanup", content, buttons);
    };

    const showSummaryModal = () => {
        const listItems = state.removedDetails.map(d => `<li>${escapeHTML(d)}</li>`).join("");
        const content = `<p>${escapeHTML(state.cleanupStatus)} Successfully removed <strong>${state.removedDetails.length}</strong> license(s).</p> ${state.removedDetails.length > 0 ? `<ul>${listItems}</ul>` : ''}`;
        const buttons = [{
            text: "Export List",
            closes: false,
            id: 'export-button',
            onClick: exportRemovedLicenses
        }, {
            text: "Refresh Page",
            closes: true,
            onClick: () => window.location.reload()
        }];
        const modal = showModal("Cleanup Summary", content, buttons);
        if (state.removedDetails.length === 0) {
            modal.querySelector('#export-button').style.display = 'none';
        }
    };

    const updateUICleanupFinished = () => {
        document.querySelector(".progress-bar-container")?.remove();
        document.getElementById("cancel-button")?.remove();
        setControlsDisabled(false);
        showSummaryModal();
    };

    // --- INITIALIZATION ---
    const init = () => {
        addGlobalStyle();
        loadSettings();
        const pageContent = document.querySelector(".page_content_ctn");
        if (!pageContent) {
            console.error("Page content container not found.");
            return;
        }

        const controlsContainer = document.createElement("div");
        controlsContainer.className = "cleanup-controls-container";
        controlsContainer.id = "cleanup-controls";

        const metadataControls = document.createElement('div');
        metadataControls.className = 'metadata-controls';
        metadataControls.innerHTML = `
            <label><input type="checkbox" id="verified-demos-only"> <strong>Only verified demos (Steam metadata)</strong></label>
            <p>Checks every app inside each package. Selects a package only when all apps have type Demo. In this mode inclusion keywords are ignored; exclusions and dates still apply.</p>
            <p>Restart Steam online to refresh its cache, then import <strong>appinfo.vdf</strong> and <strong>packageinfo.vdf</strong> from its appcache folder. Files are read locally for this tab only.</p>
            <input type="file" id="steam-metadata-files" accept=".vdf" multiple hidden>
            <p id="metadata-status">No metadata loaded.</p>
        `;
        const importButton = createButton('import-metadata-button', 'Import Steam metadata', 'Select appinfo.vdf and packageinfo.vdf together', () => {
            document.getElementById('steam-metadata-files').click();
        });
        metadataControls.appendChild(importButton);
        controlsContainer.appendChild(metadataControls);
        const verifiedMode = metadataControls.querySelector('#verified-demos-only');
        verifiedMode.checked = state.settings.verifiedDemosOnly;
        verifiedMode.addEventListener('change', () => {
            state.settings.verifiedDemosOnly = verifiedMode.checked;
            state.scannedLicenses = [];
            saveSettings();
        });
        metadataControls.querySelector('#steam-metadata-files').addEventListener('change', event => {
            const files = [...event.target.files];
            event.target.value = '';
            if (files.length) importSteamMetadata(files);
        });

        // Date Range UI
        const dateRangeContainer = document.createElement("div");
        dateRangeContainer.className = "date-range-container";
        dateRangeContainer.innerHTML = `
            <label for="start-date-input">Start Date:</label>
            <input type="date" id="start-date-input">
            <label for="end-date-input">End Date:</label>
            <input type="date" id="end-date-input">
        `;
        controlsContainer.appendChild(dateRangeContainer);

        const scanButton = createButton("scan-button", "Scan for Removable Licenses", "Scans all pages for licenses matching your criteria", scanAllPages);
        const settingsButton = createButton("settings-button", "Settings", "Customize keywords, exclusions, and delay", showSettingsModal);

        controlsContainer.append(scanButton, settingsButton);
        pageContent.parentNode.insertBefore(controlsContainer, pageContent);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

