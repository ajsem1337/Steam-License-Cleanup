// --- INITIALIZATION ---
const updateWorkspaceStatus = () => {
    const root = document.getElementById('cleanup-controls');
    if (!root) return;
    const busy = state.isScanning || state.isCleaning || state.isImporting;
    const results = Boolean((state.scanContext || state.requiresRescan) && (state.collectedScan?.licenses.length || state.collectedScan?.stats.unknown.size));
    root.dataset.stage = state.isCleaning ? 'cleaning' : state.isScanning ? 'scanning' : results ? 'review' : 'configure';
    const label = document.getElementById('workspace-status');
    if (label) label.textContent = state.isImporting ? 'Reading metadata' : state.isScanning ? (state.pendingScan ? 'Checking ownership' : 'Scanning licenses') : state.isCleaning ? 'Cleanup in progress' : state.requiresRescan ? 'New scan required' : state.pendingScan ? 'Ownership check needed' : results ? 'Results ready' : 'Ready to scan';
    const summary = document.getElementById('scan-summary');
    if (summary) summary.textContent = state.scanSummary
        ? `${state.scanSummary.complete ? 'Full scan' : 'Partial scan'} · ${state.scanSummary.pages} ${state.scanSummary.pages === 1 ? 'page' : 'pages'} · ${describeOwnership(state.scanSummary)}`
        : state.pendingScan ? `${state.pendingScan.stats.pages} ${state.pendingScan.stats.pages === 1 ? 'page' : 'pages'} collected · ownership not verified` : 'Review every selection before removal.';
    const review = document.getElementById('review-results-button');
    if (review) { review.hidden = !results; review.disabled = busy; review.textContent = state.requiresRescan ? 'Inspect collected data' : 'Review results'; }
    const retry = document.getElementById('retry-ownership-button');
    if (retry) {
        retry.hidden = state.requiresRescan || (!state.pendingScan && !state.collectedScan?.licenses.length);
        retry.disabled = busy;
        retry.textContent = state.pendingScan?.summary.error && !state.pendingScan.recoveryAccepted ? 'Use completed pages' : 'Retry ownership check';
    }
    document.getElementById('scan-button')?.classList.toggle('slc-primary', !state.pendingScan);
    const badge = document.getElementById('metadata-badge');
    if (badge) { badge.textContent = state.isImporting ? 'Reading…' : state.metadata ? 'Loaded' : 'Required'; badge.dataset.ready = String(Boolean(state.metadata)); }
};

const updateProfileUI = () => {
    const profile = state.settings.profile;
    document.getElementById('cleanup-profile').value = profile;
    document.getElementById('profile-description').textContent = PROFILES[profile].description;
    document.getElementById('metadata-controls').hidden = profile !== 'demos';
    document.getElementById('custom-filters').hidden = profile !== 'custom';
    document.getElementById('keywords-textarea').disabled = profile !== 'custom';
    updateWorkspaceStatus();
};

const init = () => {
    if (document.getElementById('cleanup-controls')) return;
    addGlobalStyle();
    loadSettings();
    const pageContent = document.querySelector('.page_content_ctn');
    if (!pageContent) { console.error('Page content container not found.'); return; }

    const root = document.createElement('section');
    root.className = 'cleanup-controls-container';
    root.id = 'cleanup-controls';
    root.setAttribute('aria-label', 'Steam License Cleanup');
    root.innerHTML = `
        <header class="slc-header">
            <div class="slc-brand"><span class="slc-brand-icon" aria-hidden="true">${cleanupIcon('library')}</span>
                <div><span class="slc-eyebrow">LIBRARY TOOLS</span><h2>Steam License Cleanup <span class="slc-version">2.0</span></h2></div>
            </div>
            <span class="slc-status"><span class="slc-status-dot" aria-hidden="true"></span><span id="workspace-status" role="status">Ready to scan</span></span>
        </header>
        <ol class="slc-steps" aria-label="Cleanup workflow"><li data-step="configure"><span>01</span> Choose your scope</li><li data-step="scanning"><span>02</span> Scan licenses</li><li data-step="review"><span>03</span> Review &amp; remove</li></ol>
        <div class="slc-workspace"><div class="slc-main"></div><aside class="slc-sidebar" aria-label="Scan and removal options"></aside></div>
        <div id="cleanup-progress-host" hidden></div>
        <footer class="slc-actionbar"><div><span class="slc-eyebrow">YOUR NEXT STEP</span><p id="scan-summary">Review every selection before removal.</p></div><div class="slc-main-actions"></div></footer>
    `;
    const main = root.querySelector('.slc-main');
    const sidebar = root.querySelector('.slc-sidebar');
    const profilePanel = createPanel('What would you like to clean?', 'Choose one profile. You can review every match before removing it.');
    profilePanel.body.innerHTML = `<label for="cleanup-profile">Cleanup profile</label>
        <select id="cleanup-profile">${Object.entries(PROFILES).map(([value, profile]) => `<option value="${value}">${escapeHTML(profile.label)}</option>`).join('')}</select>
        <p id="profile-description" class="slc-description"></p>`;
    main.appendChild(profilePanel.panel);

    const inline = createInlineOptions();
    profilePanel.body.appendChild(inline.querySelector('#custom-filters'));
    const scope = createPanel('Scan range', 'Leave dates empty to include all acquisition dates.');
    scope.body.innerHTML = `<div class="date-range-container">
        <div><label for="start-date-input">From</label><input type="date" id="start-date-input"></div>
        <div><label for="end-date-input">To</label><input type="date" id="end-date-input"></div>
    </div>`;
    scope.body.appendChild(inline.querySelector('#exclusion-options'));
    scope.body.querySelectorAll('input[type="date"]').forEach(input => input.addEventListener('change', invalidateScan));
    sidebar.appendChild(scope.panel);
    const pacing = createPanel('Removal pace', 'Keep requests spaced out.');
    pacing.body.appendChild(inline.querySelector('.removal-delay'));
    sidebar.appendChild(pacing.panel);

    const metadata = createPanel('Demo verification', 'Import the two cache files from your Steam appcache folder.');
    metadata.panel.id = 'metadata-controls';
    metadata.panel.classList.add('metadata-controls');
    metadata.panel.querySelector('.slc-panel-heading').insertAdjacentHTML('beforeend', '<span id="metadata-badge" class="slc-badge">Required</span>');
    metadata.body.innerHTML = `
        <div class="slc-import-note"><span aria-hidden="true">${cleanupIcon('file')}</span><p><strong>appinfo.vdf + packageinfo.vdf</strong><br>Restart Steam online before importing. Files are read locally and stay in this tab.</p></div>
        <input type="file" id="steam-metadata-files" accept=".vdf" multiple hidden>
        <input type="file" id="steam-metadata-folder" webkitdirectory multiple hidden>
        <div class="slc-import-actions"></div>
        <p id="metadata-status" role="status" aria-live="polite">No metadata loaded.</p>
        <p class="slc-fineprint">Only packages containing Demo-type apps qualify. Outdated or incomplete metadata can miss licenses.</p>`;
    const filesInput = metadata.body.querySelector('#steam-metadata-files');
    const folderInput = metadata.body.querySelector('#steam-metadata-folder');
    const importButton = createButton('import-metadata-button', 'Select metadata files', 'Select appinfo.vdf and packageinfo.vdf together', () => filesInput.click());
    const folderButton = createButton('import-folder-button', 'Choose folder', 'Read metadata from your appcache folder', () => folderInput.click());
    folderButton.hidden = !('webkitdirectory' in folderInput);
    metadata.body.querySelector('.slc-import-actions').append(importButton, folderButton);
    folderInput.addEventListener('change', event => {
        const files = [...event.target.files].filter(file => ['appinfo.vdf', 'packageinfo.vdf'].includes(file.name.toLowerCase())
            && (!file.webkitRelativePath || file.webkitRelativePath.split('/').length === 2));
        event.target.value = '';
        importSteamMetadata(files);
    });
    filesInput.addEventListener('change', event => {
        const files = [...event.target.files];
        event.target.value = '';
        if (files.length) importSteamMetadata(files);
    });
    main.appendChild(metadata.panel);
    profilePanel.body.querySelector('#cleanup-profile').addEventListener('change', event => {
        state.settings.profile = event.target.value;
        state.settings.verifiedDemosOnly = state.settings.profile === 'demos';
        invalidateScan();
        saveSettings();
        updateProfileUI();
    });
    const scan = createButton('scan-button', 'Scan licenses', 'Scan from the first license page', scanAllPages);
    scan.classList.add('slc-primary');
    const review = createButton('review-results-button', 'Review results', 'Reopen collected results without scanning again', () => {
        if (state.requiresRescan) showScanDiagnostics();
        else if (state.scanContext && state.scanContext === scanContext()) showReviewModal();
    });
    review.hidden = true;
    const retry = createButton('retry-ownership-button', 'Retry ownership check', 'Verify the collected pages without scanning them again', retryPendingScan);
    retry.classList.add('slc-primary');
    retry.hidden = true;
    root.querySelector('.slc-main-actions').append(review, retry, scan);
    pageContent.parentNode.insertBefore(root, pageContent);
    updateProfileUI();
    updateExclusionCount();
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
