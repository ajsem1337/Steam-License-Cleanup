const recordCandidateOutcome = (license, status, reason) => {
    const snapshot = state.collectedScan;
    if (!snapshot) return;
    snapshot.outcomes.set(license.packageId, { status, reason });
    state.scannedLicenses = state.scannedLicenses.filter(item => item.packageId !== license.packageId);
    if (status === 'removed') state.scanStats.unconfirmed.delete(license.packageId);
    else state.scanStats.unconfirmed.add(license.packageId);
    if (state.scanSummary) {
        state.scanSummary = {
            ...state.scanSummary, confirmed: state.scannedLicenses.length,
            unconfirmed: state.scanStats.unconfirmed.size,
            removed: [...snapshot.outcomes.values()].filter(outcome => outcome.status === 'removed').length
        };
    }
};

const removeNextPackage = async (licensesToRemove, i, progressBar, statusText) => {
    const signal = state.cleanupController.signal;
    let currentLicense = null;
    let requestSent = false;
    try {
        updateProgressBar(progressBar, statusText, 0, 'Refreshing current package ownership before removal...');
        state.ownedPackages = await fetchOwnedPackages(signal);
        packages: for (; i < licensesToRemove.length; i++) {
            signal.throwIfAborted();
            const license = licensesToRemove[i];
            currentLicense = license;
            requestSent = false;
            // A configured delay can be many minutes: do not reuse ownership from
            // the beginning of the queue for later packages.
            if (i > 0) state.ownedPackages = await fetchOwnedPackages(signal);
            if (!state.ownedPackages.has(license.packageId)) {
                state.notOwnedDetails.push(`${license.details} — Package no longer owned; no removal request sent`);
                recordCandidateOutcome(license, 'skipped', 'Ownership no longer confirmed; no removal request sent');
                continue;
            }
            const progress = (i / licensesToRemove.length) * 100;
            let duplicateRequest = false;
            for (let attempt = 0; ; attempt++) {
                signal.throwIfAborted();
                updateProgressBar(progressBar, statusText, progress, `Removing: ${license.details}`);
                requestSent = true;
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
                    const value = data?.success;
                    const result = typeof value === 'number' || (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) ? Number(value) : NaN;
                    if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Malformed removal result for Package ID ${license.packageId}. No removal was confirmed.`);
                    rateLimited = result === 84;
                    if (result === 29) {
                        // DuplicateRequest is not confirmation of a new removal.
                        // Recheck ownership below before sending another removal.
                        duplicateRequest = true;
                        break;
                    }
                    // Other nonzero Steam result codes are errors, not successes.
                    if (!rateLimited && result !== 1) {
                        throw new Error(`Steam rejected ${license.details} (result ${data.success}).`);
                    }
                }
                if (!rateLimited) break;
                // Removal limits can outlast the shorter retries used for reads.
                // Keep this package queued while backing off; do not treat a
                // rate limit as completion or discard the rest of the queue.
                const delay = Math.max(
                    Math.min(180000 * 2 ** Math.min(attempt, 4), 1800000),
                    retryDelay(response, 0, 180000, 2147483647)
                );
                const resumeAt = new Date(Date.now() + delay).toLocaleTimeString();
                updateProgressBar(progressBar, statusText, progress, `Rate limited. Continuing at ${resumeAt}; this package remains queued (retry ${attempt + 1}). Keep this tab open, or Cancel to stop.`, 'var(--steam-warning)');
                await wait(delay, signal);
                state.ownedPackages = await fetchOwnedPackages(signal);
                if (!state.ownedPackages.has(license.packageId)) {
                    state.notOwnedDetails.push(`${license.details} — Package no longer owned after cooldown; no further removal request sent`);
                    recordCandidateOutcome(license, 'skipped', 'Ownership no longer confirmed after cooldown; no further request sent');
                    continue packages;
                }
            }

            if (duplicateRequest) {
                const details = `${license.details} — DuplicateRequest (29), removal not confirmed in this run`;
                state.skippedDetails.push(details);
                console.warn('Skipped duplicate removal request:', details);
                // A long series of 29s must not silently consume the removal
                // rate limit. Verify the result against a fresh Steam response.
                updateProgressBar(progressBar, statusText, progress, 'Steam returned DuplicateRequest (29). Checking whether this package is still owned...');
                state.ownedPackages = await fetchOwnedPackages(signal);
                if (state.ownedPackages.has(license.packageId)) {
                    throw new Error(`Steam returned DuplicateRequest (29) for Package ID ${license.packageId}, but its ownership response still lists this package. No removal was confirmed for this entry; the queue was stopped to avoid sending more unproductive requests.`);
                }
                recordCandidateOutcome(license, 'skipped', 'DuplicateRequest (29); removal not confirmed in this run and ownership no longer confirmed');
            } else {
                state.removedDetails.push(license.details);
                recordCandidateOutcome(license, 'removed', 'Removal confirmed by Steam in this tab');
            }
            const completedProgress = ((i + 1) / licensesToRemove.length) * 100;
            if (i + 1 < licensesToRemove.length) {
                const delay = state.settings.removalDelay;
                const message = `Processed ${i + 1} of ${licensesToRemove.length}: ${state.removedDetails.length} removed, ${state.skippedDetails.length + state.notOwnedDetails.length} skipped. Waiting ${delay / 1000}s...`;
                updateProgressBar(progressBar, statusText, completedProgress, message);
                await wait(delay, signal);
            } else {
                updateProgressBar(progressBar, statusText, completedProgress, 'Cleanup complete.');
            }
        }
        updateProgressBar(progressBar, statusText, 100, 'Cleanup complete.');
    } catch (error) {
        if (currentLicense && requestSent && state.collectedScan?.outcomes.get(currentLicense.packageId)?.status !== 'removed') {
            recordCandidateOutcome(currentLicense, 'needs-check', 'Removal not confirmed; a new scan is required');
        }
        // Keep diagnostics and confirmed outcomes, but revoke every old selection.
        state.requiresRescan = true;
        state.scanContext = null;
        if (state.scanSummary) state.scanSummary = { ...state.scanSummary, needsRescan: true };
        if (signal.aborted) {
            state.cleanupStatus = 'Cleanup cancelled. A request already sent to Steam may still finish; rescan before retrying.';
        } else {
            console.error('License cleanup stopped:', error);
            state.cleanupStatus = `Cleanup stopped: ${error.message} Rescan before retrying.`;
        }
    } finally {
        state.cleanupReport = {
            status: state.cleanupStatus, summary: state.scanSummary ? { ...state.scanSummary } : null,
            removed: [...state.removedDetails], skipped: [...state.skippedDetails], notOwned: [...state.notOwnedDetails]
        };
        state.isCleaning = false;
        state.cleanupController = null;
        updateUICleanupFinished();
    }
};

const startCleanup = (licensesToRemove) => {
    if (state.isCleaning || state.isScanning || state.isImporting || licensesToRemove.length === 0) return;
    if (!updateRemovalDelay()) {
        showInfoModal('Invalid Delay', 'Enter a valid number of minutes between removals before starting cleanup.');
        return;
    }
    if (state.requiresRescan || !state.scanContext || state.scanContext !== scanContext()
        || licensesToRemove.some(license => !state.scannedLicenses.includes(license))) {
        showInfoModal('Scan Again', 'A new scan is required after a cleanup error, cancellation, changed filters, or an outdated selection. Scan again before removing licenses.');
        return;
    }
    if (licensesToRemove.some(license => (state.settings.verifiedDemosOnly || license.verifiedDemo) && verifyDemoPackage(license.packageId).status !== 'demo')) {
        showInfoModal('Verification Failed', 'A selected package could not be verified as demos only. Import current Steam metadata and scan again.');
        return;
    }
    if (!window.g_sessionID) {
        showInfoModal("Error: Not Logged In", "Could not find a valid Steam session ID. Please make sure you are fully logged into store.steampowered.com and refresh the page.");
        return;
    }
    const mainContainer = document.getElementById('cleanup-progress-host');
    mainContainer.hidden = false;
    setControlsDisabled(true);

    const { progressBarContainer, progressBar, statusText } = createProgressBar();
    mainContainer.appendChild(progressBarContainer);
    const cancelButton = createCancelButton();
    mainContainer.appendChild(cancelButton);

    state.isCleaning = true;
    state.cleanupController = new AbortController();
    state.cleanupStatus = 'Cleanup complete.';
    state.removedDetails = [];
    state.skippedDetails = [];
    state.notOwnedDetails = [];
    updateWorkspaceStatus();
    removeNextPackage(licensesToRemove, 0, progressBar, statusText);
};
