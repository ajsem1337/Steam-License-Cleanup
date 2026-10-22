// --- CORE LOGIC: SCANNING & REMOVAL ---
const parseTableForDetails = (tableElement) => {
    const foundLicenses = [];
    if (!tableElement) return foundLicenses;

    const { exclusions } = state.settings;
    const keywords = PROFILES[state.settings.profile].keywords ?? state.settings.keywords;

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
            const packageId = steamId(packageIdMatch[1]);
            if (!packageId) throw new Error('Steam returned an invalid package ID.');
            state.scanStats.seen.add(packageId);
            let verification = '';
            if (state.settings.verifiedDemosOnly) {
                const result = verifyDemoPackage(packageId);
                state.scanStats[result.status].add(packageId);
                if (result.status !== 'demo') continue;
                if (exclusionRegex && result.apps.some(app => exclusionRegex.test(app.name || ''))) continue;
                verification = ` [Verified from local Steam cache: ${result.apps.map(app => `${app.id} = Demo`).join(', ')}]`;
            }
            const details = `${cellText}${verification} (Acquired: ${dateText}, Package ID: ${packageId})`;
            foundLicenses.push({ packageId, name: cellText, acquired: dateText, details, verification, verifiedDemo: state.settings.verifiedDemosOnly });
        }
    }
    return foundLicenses;
};


// Keep collected pages separate from verified results. A failed ownership check
// can be retried without making any page or removal requests.
const verifyCollectedScan = async (snapshot, signal, statusElement) => {
    if (state.pendingScan !== snapshot || snapshot.context !== scanContext()) {
        throw new Error('Filters or metadata changed. Scan again before reviewing licenses.');
    }
    statusElement.textContent = 'Checking current ownership of the collected licenses…';
    const owned = await fetchOwnedPackages(signal);
    signal.throwIfAborted();
    if (state.pendingScan !== snapshot || snapshot.context !== scanContext()) {
        throw new Error('Filters or metadata changed. Scan again before reviewing licenses.');
    }
    state.ownedPackages = owned;
    state.scanStats = snapshot.stats;
    for (const id of state.scanStats.seen) {
        if (!owned.has(id)) {
            state.scanStats.notOwned.add(id);
            state.scanStats.demo.delete(id);
            state.scanStats.other.delete(id);
            state.scanStats.unknown.delete(id);
        }
    }
    state.scannedLicenses = snapshot.licenses.filter(license => owned.has(license.packageId));
    state.scanSummary = snapshot.summary;
    state.scanContext = snapshot.context;
    state.pendingScan = null;
};

const showOwnershipRetryModal = error => {
    const pages = state.pendingScan.stats.pages;
    showModal('Scan Failed', `<p>${escapeHTML(error.message)}</p>
        <p>Kept results from ${pages} completed ${pages === 1 ? 'page' : 'pages'} in this tab. No licenses were removed. Retry only the ownership check; the collected pages will not be scanned again.</p>
        <p><a href="https://store.steampowered.com/account/" target="_blank" rel="noopener noreferrer">Open Steam Store account</a> if your Store session needs refreshing.</p>`, [{
        id: 'retry-ownership-check', text: 'Retry ownership check', class: 'slc-primary', closes: true,
        onClick: retryPendingScan
    }]);
};

const retryPendingScan = async () => {
    if (state.isScanning || state.isCleaning || state.isImporting || !state.pendingScan) return;
    const snapshot = state.pendingScan;
    if (snapshot.context !== scanContext()) {
        invalidateScan();
        showInfoModal('Scan Again', 'Your filters or metadata changed. Scan again before reviewing licenses.');
        return;
    }
    state.isScanning = true;
    state.scanController = new AbortController();
    const signal = state.scanController.signal;
    setControlsDisabled(true);
    const { modal, finishButton, statusElement, updateCounts } = createScanDialog(() => {}, () => state.scanController?.abort());
    modal.querySelector('h2').textContent = 'Checking collected licenses';
    finishButton.hidden = true;
    updateCounts(snapshot.stats.pages, snapshot.licenses.length);
    try {
        await verifyCollectedScan(snapshot, signal, statusElement);
        modal.closeDialog();
        showReviewModal();
    } catch (error) {
        modal.closeDialog();
        if (signal.aborted) {
            invalidateScan();
            showInfoModal('Scan Cancelled', 'The collected results were discarded. No licenses were removed.');
        } else if (state.pendingScan) {
            showOwnershipRetryModal(error);
        } else {
            invalidateScan();
            showInfoModal('Scan Failed', escapeHTML(error.message));
        }
    } finally {
        state.isScanning = false;
        state.scanController = null;
        setControlsDisabled(false);
    }
};

const scanAllPages = async () => {
    if (state.isScanning || state.isCleaning || state.isImporting) return;
    if (!updateRemovalDelay()) return;
    if (state.settings.verifiedDemosOnly && !state.metadata) {
        showInfoModal('Steam Metadata Required', 'Import appinfo.vdf and packageinfo.vdf from your Steam appcache folder first. Only packages containing exclusively Demo-type applications will be selected.');
        return;
    }
    state.isScanning = true;
    invalidateScan();
    state.scanController = new AbortController();
    const signal = state.scanController.signal;
    // Stopping page collection must leave ownership verification available.
    // Discarding the scan aborts both phases.
    const pageController = new AbortController();
    const abortPages = () => pageController.abort();
    signal.addEventListener('abort', abortPages, { once: true });
    const pageSignal = pageController.signal;
    let stopRequested = false;
    state.ownedPackages = null;
    state.scanStats = { demo: new Set(), other: new Set(), unknown: new Set(), seen: new Set(), notOwned: new Set(), pages: 0 };
    setControlsDisabled(true);
    const { modal, statusElement, finishButton, updateCounts } = createScanDialog(() => {
        stopRequested = true;
        finishButton.disabled = true;
        finishButton.textContent = 'Finishing scan…';
        pageController.abort();
    }, () => state.scanController?.abort());

    const allLicenses = [];
    const existingIds = new Set();
    const visitedURLs = new Set();
    let page = 1;
    let pageURL = new URL('/account/licenses/?l=english', window.location.origin);

    const context = scanContext();
    try {
        const startDate = document.getElementById('start-date-input').valueAsDate;
        const endDate = document.getElementById('end-date-input').valueAsDate;
        if (startDate && endDate && startDate > endDate) {
            throw new Error('The start date must not be after the end date.');
        }
        try {
            while (pageURL) {
                pageSignal.throwIfAborted();
                if (visitedURLs.has(pageURL.href)) throw new Error('Steam returned a repeated next-page link.');
                visitedURLs.add(pageURL.href);
                statusElement.textContent = `Reading license page ${page}…`;

                let response;
                for (let attempt = 0; attempt < 4; attempt++) {
                    response = await fetch(pageURL.href, { credentials: 'same-origin', cache: 'no-store', signal: pageSignal });
                    pageSignal.throwIfAborted();
                    if (response.status !== 429) break;
                    if (attempt === 3) throw new Error('Steam is still rate limiting the scan. Try again later.');
                    const delay = retryDelay(response, attempt);
                    statusElement.textContent = `Steam rate limit — retrying page ${page} in ${delay / 1000}s…`;
                    await wait(delay, pageSignal);
                }
                if (!response.ok) throw new Error(`Could not scan page ${page} (HTTP ${response.status}).`);
                const text = await response.text();
                pageSignal.throwIfAborted();
                const doc = new DOMParser().parseFromString(text, 'text/html');
                const table = doc.querySelector('.account_table');
                if (!table) throw new Error(`No license table on page ${page}. Check that you are signed in to Steam.`);
                const licensesOnPage = parseTableForDetails(table);
                licensesOnPage.forEach(license => {
                    if (!existingIds.has(license.packageId)) {
                        allLicenses.push(license);
                        existingIds.add(license.packageId);
                    }
                });
                state.scanStats.pages++;
                updateCounts(state.scanStats.pages, allLicenses.length);
                finishButton.disabled = false;

                const next = doc.querySelector('a.license_paginator_next, a.pagebtn.next');
                const href = next?.getAttribute('href');
                if (!href || next.classList.contains('disabled') || next.getAttribute('aria-disabled') === 'true') break;
                pageURL = new URL(href, pageURL);
                if (pageURL.origin !== window.location.origin || pageURL.pathname !== '/account/licenses/') {
                    throw new Error('Steam returned an unexpected next-page URL.');
                }
                pageURL.searchParams.set('l', 'english');
                page++;
                await wait(500, pageSignal);
            }
        } catch (error) {
            // Only an explicit request to use collected results permits a partial
            // review. Ordinary failures and Discard never do.
            if (!stopRequested || signal.aborted) throw error;
        }

        signal.throwIfAborted();
        finishButton.disabled = true;
        const snapshot = {
            licenses: allLicenses, stats: state.scanStats, context,
            summary: { complete: !stopRequested, pages: state.scanStats.pages, found: allLicenses.length }
        };
        state.pendingScan = snapshot;
        updateWorkspaceStatus();
        await verifyCollectedScan(snapshot, signal, statusElement);
        modal.closeDialog();
        showReviewModal();
    } catch (error) {
        console.error('License scan failed:', error);
        modal.closeDialog();
        if (!signal.aborted && state.pendingScan) {
            showOwnershipRetryModal(error);
        } else {
            invalidateScan();
            showInfoModal(signal.aborted ? 'Scan Cancelled' : 'Scan Failed', signal.aborted
                ? 'Scanning was cancelled. No licenses were removed.'
                : `${escapeHTML(error.message)} No licenses were removed. Run the scan again to review the complete list.`);
        }
    } finally {
        signal.removeEventListener('abort', abortPages);
        state.isScanning = false;
        state.scanController = null;
        setControlsDisabled(false);
    }
};
