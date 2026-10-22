// --- UI & MODALS ---
let dialogSequence = 0;
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
    const previousFocus = document.activeElement;
    const modalOverlay = document.createElement("div");
    modalOverlay.className = "modal-overlay";
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

const exportRemovedLicenses = () => {
    const report = [
        'Steam License Cleanup 2.0 — cleanup report', state.cleanupStatus,
        '', 'Confirmed removals:', ...state.removedDetails,
        '', 'Duplicate requests skipped (not confirmed removed in this run):', ...state.skippedDetails,
        '', 'Packages no longer owned (no further removal requests after ownership check):', ...state.notOwnedDetails
    ].join('\n');
    downloadText(`steam_removed_licenses_${new Date().toISOString().slice(0, 10)}.txt`, report);
};

const showSettingsModal = () => {
    const custom = state.settings.profile === 'custom';
    const content = `
        <p>Current profile: <strong>${escapeHTML(PROFILES[state.settings.profile].label)}</strong>.</p>
        <label for="keywords-textarea"><strong>Custom inclusion phrases</strong> (one per line or comma-separated)</label>
        <p>Used only by Custom name filters. Other profiles use their own rules.</p>
        <textarea id="keywords-textarea" class="modal-textarea" ${custom ? '' : 'disabled'}>${escapeHTML(state.settings.keywords.join(', '))}</textarea>
        <label for="exclusions-textarea"><strong>Exclusion phrases</strong> (all profiles)</label>
        <p>Matching licenses are kept. Verified demos also checks application names.</p>
        <textarea id="exclusions-textarea" class="modal-textarea">${escapeHTML(state.settings.exclusions.join(', '))}</textarea>
        <p>${custom ? 'Empty inclusion phrases match every removable license except exclusions.' : escapeHTML(PROFILES[state.settings.profile].description)}</p>
        <label for="delay-input"><strong>Minutes between removals</strong></label>
        <p>Default: 10 minutes. Rate-limit pauses can make cleanup take longer.</p>
        <input type="number" id="delay-input" class="modal-input" min="0" max="35791" step="any" value="${state.settings.removalDelay / 60000}">
        <p id="settings-error" role="alert"></p>
    `;
    let modal;
    const buttons = [{
        text: 'Save',
        onClick: () => {
            const input = modal.querySelector('#delay-input');
            const delay = Number(input.value) * 60000;
            if (!input.value.trim() || !Number.isFinite(delay) || delay < 0 || delay > 2147483647) {
                modal.querySelector('#settings-error').textContent = 'Enter a delay between 0 and 35791 minutes.';
                return;
            }
            const parse = text => [...new Set(text.split(/[,\n]/).map(word => word.trim()).filter(Boolean))];
            state.settings.keywords = parse(modal.querySelector('#keywords-textarea').value);
            state.settings.exclusions = parse(modal.querySelector('#exclusions-textarea').value);
            state.settings.removalDelay = Math.round(delay);
            invalidateScan();
            saveSettings();
            modal.closeDialog();
        }
    }, {
        text: 'Reset to Default',
        onClick: () => {
            state.settings = JSON.parse(JSON.stringify(DEFAULTS));
            invalidateScan();
            saveSettings();
            updateProfileUI();
            modal.closeDialog();
            showSettingsModal();
        }
    }];
    modal = showModal('Cleanup Settings', content, buttons);
};

const showReviewModal = () => {
    const licenses = [...state.scannedLicenses];
    const profile = state.settings.profile;
    const selectByDefault = profile !== 'all' && !(profile === 'custom' && state.settings.keywords.length === 0);
    const verificationSummary = state.settings.verifiedDemosOnly
        ? `Verified against imported Steam cache. Skipped ${state.scanStats.other.size} packages containing non-demo apps and ${state.scanStats.unknown.size} packages with missing metadata. Missing metadata never qualifies a package for removal.`
        : 'Name-filter mode: application types have NOT been verified.';
    const ownershipSummary = `Current ownership checked with Steam. Skipped ${state.scanStats.notOwned.size} packages not currently owned.`;
    if (licenses.length === 0) {
        showInfoModal('Scan Complete', `No removable licenses matching your criteria were found. ${ownershipSummary} ${verificationSummary}`);
        return;
    }
    const listItems = licenses.map((lic, index) =>
        `<li data-index="${index}"><label><input type="checkbox" class="license-checkbox" data-index="${index}" ${selectByDefault ? 'checked' : ''}> ${escapeHTML(lic.details)}</label></li>`
    ).join('');
    const content = `
        <p><strong>${escapeHTML(PROFILES[profile].label)}</strong> — ${licenses.length} matching licenses.</p>
        ${selectByDefault ? '' : '<p>No inclusion filter is active. Select the licenses you want to remove.</p>'}
        <p>${ownershipSummary}</p><p>${verificationSummary}</p>
        <div class="review-controls">
            <label for="review-search">Search results</label>
            <input type="search" id="review-search" placeholder="Name or package ID">
            <label for="review-sort">Sort</label>
            <select id="review-sort"><option value="original">Acquisition order</option><option value="name">Name</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
            <button class="steam-cleanup-button" id="select-all">Select visible</button>
            <button class="steam-cleanup-button" id="deselect-all">Deselect visible</button>
        </div>
        <p id="review-count" role="status" aria-live="polite"></p>
        <p>Search hides rows without changing their selection. Export or remove applies to all selected rows.</p>
        <ul id="review-list">${listItems}</ul>
    `;
    let modal;
    const selected = () => [...modal.querySelectorAll('.license-checkbox:checked')].map(cb => licenses[Number(cb.dataset.index)]);
    const buttons = [{
        text: 'Export selected', id: 'export-review-button',
        onClick: () => downloadText(`steam_license_review_${new Date().toISOString().slice(0, 10)}.txt`, [
            'Steam License Cleanup 2.0 — review only; no removal confirmed',
            PROFILES[profile].label, verificationSummary, '', ...selected().map(license => license.details)
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
    setControlsDisabled(false);
    showSummaryModal();
};
