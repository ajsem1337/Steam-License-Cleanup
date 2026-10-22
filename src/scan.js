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
            foundLicenses.push({ packageId, name: cellText, acquired: dateText, details, verifiedDemo: state.settings.verifiedDemosOnly });
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
    invalidateScan();
    state.scanController = new AbortController();
    const signal = state.scanController.signal;
    state.ownedPackages = null;
    state.scanStats = { demo: new Set(), other: new Set(), unknown: new Set(), seen: new Set(), notOwned: new Set() };
    setControlsDisabled(true);
    const { modal, statusElement } = showWorkingModal(
        "Scanning Licenses",
        "Please wait while all license pages are scanned. This may take a moment."
    );
    const cancel = createButton('cancel-scan-button', 'Cancel scan', 'Stop scanning without removing licenses', () => state.scanController?.abort());
    modal.querySelector('.modal-footer').appendChild(cancel);

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
            signal.throwIfAborted();
            if (visitedURLs.has(pageURL.href)) throw new Error('Steam returned a repeated next-page link.');
            visitedURLs.add(pageURL.href);
            statusElement.textContent = `Scanning page ${page} — ${allLicenses.length} matching licenses found...`;

            let response;
            for (let attempt = 0; attempt < 4; attempt++) {
                response = await fetch(pageURL.href, { credentials: 'same-origin', cache: 'no-store', signal });
                if (response.status !== 429) break;
                if (attempt === 3) throw new Error('Steam is still rate limiting the scan. Try again later.');
                const delay = retryDelay(response, attempt);
                statusElement.textContent = `Steam rate limit — retrying page ${page} in ${delay / 1000}s...`;
                await wait(delay, signal);
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
            await wait(500, signal);
        }

        statusElement.textContent = 'Checking which packages you currently own...';
        state.ownedPackages = await fetchOwnedPackages(signal);
        for (const id of state.scanStats.seen) {
            if (!state.ownedPackages.has(id)) {
                state.scanStats.notOwned.add(id);
                state.scanStats.demo.delete(id);
                state.scanStats.other.delete(id);
                state.scanStats.unknown.delete(id);
            }
        }
        modal.remove();
        state.scannedLicenses = allLicenses.filter(license => state.ownedPackages.has(license.packageId));
        state.scanContext = scanContext();
        showReviewModal();
    } catch (error) {
        console.error('License scan failed:', error);
        modal.remove();
        // Never offer an incomplete result as a successfully finished scan.
        showInfoModal(signal.aborted ? 'Scan Cancelled' : 'Scan Failed', signal.aborted
            ? 'Scanning was cancelled. No licenses were removed.'
            : `${escapeHTML(error.message)} No licenses were removed. Run the scan again to review the complete list.`);
    } finally {
        state.isScanning = false;
        state.scanController = null;
        setControlsDisabled(false);
    }
};
