// --- UI & MODALS ---
let dialogSequence = 0;
const cleanupIcon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name === 'library'
    ? '<path d="M4 4h12v16H4zM8 8h4M8 12h4M19 7l2 12"/>'
    : '<path d="M14 3H6v18h12V7zM14 3v5h4M9 12h6M9 16h4"/>'}</svg>`;

const createPanel = (title, description) => {
    const panel = document.createElement('section');
    panel.className = 'slc-panel';
    panel.innerHTML = `<div class="slc-panel-heading"><h3>${escapeHTML(title)}</h3></div><p class="slc-panel-description">${escapeHTML(description)}</p><div class="slc-panel-body"></div>`;
    return { panel, body: panel.querySelector('.slc-panel-body') };
};
const createButton = (id, text, title, onClick) => {
    const button = document.createElement("button");
    button.id = id;
    button.type = 'button';
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
    const previousFocus = document.activeElement;
    const modalOverlay = document.createElement("div");
    modalOverlay.className = "modal-overlay slc-dialog";
    const modalContent = document.createElement("div");
    modalContent.className = "modal-content";
    const titleId = `cleanup-dialog-${++dialogSequence}`;
    modalContent.setAttribute('role', 'dialog');
    modalContent.setAttribute('aria-modal', 'true');
    modalContent.setAttribute('aria-labelledby', titleId);
    modalContent.tabIndex = -1;
    modalContent.innerHTML = `<div class="modal-header"><h2 id="${titleId}">${escapeHTML(title)}</h2></div><div class="modal-body">${content}</div>`;
    modalOverlay.closeDialog = () => {
        const restore = modalOverlay.contains(document.activeElement);
        modalOverlay.remove();
        if (restore && previousFocus?.isConnected) previousFocus.focus();
    };
    const footer = document.createElement("div");
    footer.className = "modal-footer";

    buttons.forEach(btnInfo => {
        const button = createButton(btnInfo.id || '', btnInfo.text, '', () => {
            if (btnInfo.onClick) btnInfo.onClick();
            if (btnInfo.closes) modalOverlay.closeDialog();
        });
        if (btnInfo.class) button.classList.add(btnInfo.class);
        footer.appendChild(button);
    });

    if (isClosable) {
        const closeButton = createButton('modal-close', 'Close', 'Close this dialog', modalOverlay.closeDialog);
        footer.appendChild(closeButton);
    }

    modalContent.appendChild(footer);
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);
    modalOverlay.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isClosable) {
            event.preventDefault();
            modalOverlay.closeDialog();
        } else if (event.key === 'Tab') {
            const controls = [...modalOverlay.querySelectorAll('button, input, select, textarea, a[href]')]
                .filter(element => !element.disabled && !element.closest('[hidden]') && element.type !== 'hidden');
            const first = controls[0], last = controls.at(-1);
            if (!first) { event.preventDefault(); modalContent.focus(); }
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === modalContent)) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modalContent)) {
                event.preventDefault(); first.focus();
            }
        }
    });
    modalContent.focus();
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

const createScanDialog = (onFinish, onDiscard) => {
    const modal = showModal('Scanning your licenses', `<p>Keep scanning, or review what has been collected so far.</p>
        <div class="slc-scan-stats"><div><strong id="scan-page-count">0</strong><span>pages scanned</span></div><div><strong id="scan-match-count">0</strong><span>matches found</span></div></div>
        <div class="slc-scan-track" aria-hidden="true"><span></span></div>
        <p id="working-status" role="status" aria-live="polite">Starting scan…</p>
        <p class="slc-fineprint">Collected results still go through an ownership check before review.</p>`, [], false);
    modal.querySelector('.modal-content').classList.add('slc-scan-dialog');
    const finishButton = createButton('finish-scan-button', 'Use collected results', 'Stop collecting pages and verify the completed results', onFinish);
    finishButton.classList.add('slc-primary');
    finishButton.disabled = true;
    const discard = createButton('cancel-scan-button', 'Discard scan', 'Cancel and discard all results from this scan', onDiscard);
    modal.querySelector('.modal-footer').append(discard, finishButton);
    return {
        modal, finishButton, statusElement: modal.querySelector('#working-status'),
        updateCounts: (pages, matches) => {
            modal.querySelector('#scan-page-count').textContent = String(pages);
            modal.querySelector('#scan-match-count').textContent = String(matches);
        }
    };
};

const exportRemovedLicenses = () => {
    const report = [
        'Steam License Cleanup 2.0 — cleanup report', state.cleanupStatus,
        describeScan(state.scanSummary),
        '', 'Confirmed removals:', ...state.removedDetails,
        '', 'Duplicate requests skipped (not confirmed removed in this run):', ...state.skippedDetails,
        '', 'Packages no longer owned (no further removal requests after ownership check):', ...state.notOwnedDetails
    ].join('\n');
    downloadText(`steam_removed_licenses_${new Date().toISOString().slice(0, 10)}.txt`, report);
};

const describeScan = summary => summary
    ? `${summary.complete ? 'Full' : 'Partial'} scan: ${summary.pages} completed ${summary.pages === 1 ? 'page' : 'pages'}.${summary.complete ? '' : ' Stopped at your request; unscanned pages are not included.'}`
    : 'No completed scan.';

const createInlineOptions = () => {
    const options = document.createElement('div');
    options.className = 'cleanup-options';
    options.innerHTML = `
        <div class="removal-delay">
            <label for="delay-input"><strong>Minutes between removals</strong></label>
            <input type="number" id="delay-input" class="modal-input" min="0" max="${2147483647 / 60000}" step="any" value="${state.settings.removalDelay / 60000}" aria-describedby="delay-help delay-error">
            <p id="delay-help">Default: 10 minutes. Rate-limit pauses can make cleanup take longer.</p>
            <p id="delay-error" role="alert"></p>
        </div>
        <div id="custom-filters" hidden>
            <label for="keywords-textarea"><strong>Include names matching</strong></label>
            <textarea id="keywords-textarea" class="modal-textarea" placeholder="One phrase per line, or separated by commas">${escapeHTML(state.settings.keywords.join(', '))}</textarea>
            <p>Empty phrases match all otherwise eligible licenses.</p>
        </div>
        <details id="exclusion-options" ${state.settings.exclusions.length ? 'open' : ''}>
            <summary>Keep matching licenses<span id="exclusion-count"></span></summary>
            <label for="exclusions-textarea">Exclude names containing these phrases (all profiles)</label>
            <textarea id="exclusions-textarea" class="modal-textarea" placeholder="One phrase per line, or separated by commas">${escapeHTML(state.settings.exclusions.join(', '))}</textarea>
        </details>
    `;
    const parse = text => [...new Set(text.split(/[,\n]/).map(word => word.trim()).filter(Boolean))];
    for (const [id, key] of [['keywords-textarea', 'keywords'], ['exclusions-textarea', 'exclusions']]) {
        options.querySelector(`#${id}`).addEventListener('input', event => {
            state.settings[key] = parse(event.target.value);
            invalidateScan();
            saveSettings();
            updateExclusionCount();
        });
    }
    options.querySelector('#delay-input').addEventListener('input', updateRemovalDelay);
    return options;
};

const updateExclusionCount = () => {
    const count = state.settings.exclusions.length;
    document.getElementById('exclusion-count').textContent = count ? ` (${count} active)` : '';
};

const updateRemovalDelay = () => {
    const input = document.getElementById('delay-input');
    const delay = Number(input.value) * 60000;
    const valid = input.value.trim() !== '' && Number.isFinite(delay) && delay >= 0 && delay <= 2147483647;
    const message = valid ? '' : 'Enter a valid delay in minutes (0 or more).';
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(!valid));
    document.getElementById('delay-error').textContent = message;
    if (valid && state.settings.removalDelay !== Math.round(delay)) {
        state.settings.removalDelay = Math.round(delay);
        saveSettings();
    }
    return valid;
};

const showReviewModal = () => {
    const licenses = [...state.scannedLicenses];
    const profile = state.settings.profile;
    const summary = state.scanSummary;
    const scopeLabel = describeScan(summary);
    const partial = summary && !summary.complete;
    const selectByDefault = profile !== 'all' && !(profile === 'custom' && state.settings.keywords.length === 0);
    const verificationSummary = state.settings.verifiedDemosOnly
        ? `Verified against imported Steam cache. Skipped ${state.scanStats.other.size} packages containing non-demo apps and ${state.scanStats.unknown.size} packages with missing metadata. Missing metadata never qualifies a package for removal.`
        : 'Name-filter mode: application types have NOT been verified.';
    const ownershipSummary = `Current ownership checked with Steam. Skipped ${state.scanStats.notOwned.size} packages not currently owned.`;
    if (licenses.length === 0) {
        showInfoModal(partial ? 'Partial Scan' : 'Scan Complete', `${escapeHTML(scopeLabel)} No removable licenses matching your criteria were found. ${ownershipSummary} ${verificationSummary}`);
        return;
    }
    const listItems = licenses.map((lic, index) =>
        `<li data-index="${index}"><label><input type="checkbox" class="license-checkbox" data-index="${index}" ${selectByDefault ? 'checked' : ''}>
            <span class="slc-license-text"><strong>${escapeHTML(lic.name)}</strong>
                <span class="slc-license-meta">Acquired: ${escapeHTML(lic.acquired)} · Package ID: ${escapeHTML(lic.packageId)}</span>
                ${lic.verification ? `<span class="slc-license-evidence">${escapeHTML(lic.verification)}</span>` : ''}
            </span><span class="slc-badge ${lic.verifiedDemo ? 'slc-verified' : ''}">${lic.verifiedDemo ? 'Demo' : 'Unverified'}</span>
        </label></li>`
    ).join('');
    const content = `
        <div class="slc-scan-scope ${partial ? 'slc-partial' : ''}" ${partial ? 'id="partial-scan-notice"' : ''}>
            <strong>${partial ? 'Partial scan' : 'Full scan'} · ${licenses.length} matching licenses</strong>
            <p>${escapeHTML(scopeLabel)}</p>
        </div>
        ${selectByDefault ? '' : '<p>No inclusion filter is active. Select the licenses you want to remove.</p>'}
        <details class="slc-scan-details"><summary>${escapeHTML(PROFILES[profile].label)} · Scan details</summary><p>${ownershipSummary}</p><p>${verificationSummary}</p></details>
        <div class="review-controls">
            <div><label for="review-search">Search results</label><input type="search" id="review-search" placeholder="Search by name or package ID"></div>
            <div><label for="review-sort">Sort by</label><select id="review-sort"><option value="original">Acquisition order</option><option value="name">Name</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div>
        </div>
        <div class="slc-selection-actions">
            <button class="steam-cleanup-button" id="select-all">Select visible</button>
            <button class="steam-cleanup-button" id="deselect-all">Deselect visible</button>
        </div>
        <p id="review-count" role="status" aria-live="polite"></p>
        <p class="slc-selection-note">Search hides rows without changing their selection. Export or remove applies to all selected rows.</p>
        <ul id="review-list">${listItems}</ul>
    `;
    let modal;
    const selected = () => [...modal.querySelectorAll('.license-checkbox:checked')].map(cb => licenses[Number(cb.dataset.index)]);
    const buttons = [{
        text: 'Export selected', id: 'export-review-button',
        onClick: () => downloadText(`steam_license_review_${new Date().toISOString().slice(0, 10)}.txt`, [
            'Steam License Cleanup 2.0 — review only; no removal confirmed',
            PROFILES[profile].label, scopeLabel, verificationSummary, '', ...selected().map(license => license.details)
        ].join('\n'))
    }, {
        text: 'Remove Selected (0)', id: 'review-proceed-button', closes: true,
        onClick: () => { const items = selected(); if (items.length) showConfirmModal(items); }
    }];
    modal = showModal('Review Licenses to Remove', content, buttons);
    const checkboxes = [...modal.querySelectorAll('.license-checkbox')];
    const rows = [...modal.querySelectorAll('#review-list li')];
    const updateCount = () => {
        const count = selected().length;
        modal.querySelector('#review-proceed-button').textContent = `Remove Selected (${count})`;
        modal.querySelector('#review-proceed-button').disabled = count === 0;
        modal.querySelector('#export-review-button').disabled = count === 0;
        modal.querySelector('#review-count').textContent = `${rows.filter(row => !row.hidden).length} of ${licenses.length} visible; ${count} selected in total.`;
    };
    checkboxes.forEach(cb => cb.addEventListener('change', updateCount));
    for (const [id, checked] of [['select-all', true], ['deselect-all', false]]) {
        modal.querySelector(`#${id}`).addEventListener('click', () => {
            rows.filter(row => !row.hidden).forEach(row => { row.querySelector('input').checked = checked; });
            updateCount();
        });
    }
    modal.querySelector('#review-search').addEventListener('input', event => {
        const query = event.target.value.trim().toLocaleLowerCase();
        rows.forEach(row => {
            const license = licenses[Number(row.dataset.index)];
            row.hidden = !`${license.name} ${license.packageId}`.toLocaleLowerCase().includes(query);
        });
        updateCount();
    });
    modal.querySelector('#review-sort').addEventListener('change', event => {
        const mode = event.target.value;
        const sorted = [...rows].sort((a, b) => {
            const left = licenses[Number(a.dataset.index)], right = licenses[Number(b.dataset.index)];
            if (mode === 'name') return left.name.localeCompare(right.name);
            if (mode === 'original') return Number(a.dataset.index) - Number(b.dataset.index);
            const dates = (parseSteamDate(left.acquired)?.getTime() || 0) - (parseSteamDate(right.acquired)?.getTime() || 0);
            return mode === 'newest' ? -dates : dates;
        });
        modal.querySelector('#review-list').append(...sorted);
    });
    updateCount();
};

const showConfirmModal = (selectedLicenses) => {
    const minutes = Math.ceil(Math.max(0, selectedLicenses.length - 1) * state.settings.removalDelay / 60000);
    const content = `<p>Remove <strong>${selectedLicenses.length}</strong> license(s) using <strong>${escapeHTML(PROFILES[state.settings.profile].label)}</strong>?</p>
        ${state.scanSummary && !state.scanSummary.complete ? `<div class="slc-scan-scope slc-partial"><strong>Partial scan</strong><p>${escapeHTML(describeScan(state.scanSummary))}</p></div>` : ''}
        <p>${selectedLicenses.every(license => license.verifiedDemo) ? 'Demo types were checked against your imported cache.' : 'Application types have NOT been verified. Names alone do not establish what a package contains.'}</p>
        <p>The script has no undo. Configured waits total about ${minutes} minute(s), plus request time and any rate-limit pauses. Keep this tab open.</p>`;
    showModal('Confirm Cleanup', content, [{ text: 'Yes, Clean Up', closes: true, onClick: () => startCleanup(selectedLicenses) }]);
};

const showSummaryModal = () => {
    const listItems = state.removedDetails.map(d => `<li>${escapeHTML(d)}</li>`).join("");
    const skippedItems = state.skippedDetails.map(d => `<li>${escapeHTML(d)}</li>`).join('');
    const notOwnedItems = state.notOwnedDetails.map(d => `<li>${escapeHTML(d)}</li>`).join('');
    const content = `<p>${escapeHTML(state.cleanupStatus)} Successfully removed <strong>${state.removedDetails.length}</strong> license(s).</p>
        ${state.removedDetails.length > 0 ? `<ul>${listItems}</ul>` : ''}
        ${state.skippedDetails.length > 0 ? `<p>Duplicate requests skipped: <strong>${state.skippedDetails.length}</strong>. These were not counted as confirmed removals in this run. Rescan to check current license state.</p><ul>${skippedItems}</ul>` : ''}
        ${state.notOwnedDetails.length > 0 ? `<p>Packages no longer owned: <strong>${state.notOwnedDetails.length}</strong>. No further removal requests were sent after the ownership check.</p><ul>${notOwnedItems}</ul>` : ''}`;
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
    if (state.removedDetails.length === 0 && state.skippedDetails.length === 0 && state.notOwnedDetails.length === 0) {
        modal.querySelector('#export-button').style.display = 'none';
    }
};

const updateUICleanupFinished = () => {
    document.querySelector(".progress-bar-container")?.remove();
    document.getElementById("cancel-button")?.remove();
    document.getElementById('cleanup-progress-host').hidden = true;
    setControlsDisabled(false);
    showSummaryModal();
};
