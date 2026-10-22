// --- INITIALIZATION ---
const updateProfileUI = () => {
    const profile = state.settings.profile;
    document.getElementById('cleanup-profile').value = profile;
    document.getElementById('profile-description').textContent = PROFILES[profile].description;
    document.getElementById('metadata-controls').hidden = profile !== 'demos';
};

const init = () => {
    if (document.getElementById('cleanup-controls')) return;
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
    const heading = document.createElement('div');
    heading.className = 'cleanup-heading';
    heading.innerHTML = '<h2>Steam License Cleanup <small>2.0</small></h2><p>Choose a cleanup profile, scan your licenses, and review before removal.</p>';
    controlsContainer.appendChild(heading);
    const profileControls = document.createElement('div');
    profileControls.className = 'profile-controls';
    profileControls.innerHTML = `<label for="cleanup-profile"><strong>Cleanup profile</strong></label>
        <select id="cleanup-profile">${Object.entries(PROFILES).map(([value, profile]) => `<option value="${value}">${escapeHTML(profile.label)}</option>`).join('')}</select>
        <p id="profile-description"></p>`;
    controlsContainer.appendChild(profileControls);

    const metadataControls = document.createElement('div');
    metadataControls.className = 'metadata-controls';
    metadataControls.id = 'metadata-controls';
    metadataControls.innerHTML = `
        <p>Selects packages only when every application has type Demo in your imported cache. Exclusions and dates still apply.</p>
        <p>Restart Steam online, then import <strong>appinfo.vdf</strong> and <strong>packageinfo.vdf</strong> from its appcache folder. Files stay in this tab; cached metadata may be outdated or incomplete.</p>
        <input type="file" id="steam-metadata-files" accept=".vdf" multiple hidden>
        <input type="file" id="steam-metadata-folder" webkitdirectory multiple hidden>
        <p id="metadata-status" role="status" aria-live="polite">No metadata loaded.</p>
    `;
    const importButton = createButton('import-metadata-button', 'Import Steam metadata', 'Select appinfo.vdf and packageinfo.vdf together', () => {
        document.getElementById('steam-metadata-files').click();
    });
    metadataControls.appendChild(importButton);
    const folderInput = metadataControls.querySelector('#steam-metadata-folder');
    const folderButton = createButton('import-folder-button', 'Choose appcache folder', 'Read appinfo.vdf and packageinfo.vdf from one folder', () => folderInput.click());
    folderButton.hidden = !('webkitdirectory' in folderInput);
    metadataControls.appendChild(folderButton);
    folderInput.addEventListener('change', event => {
        const files = [...event.target.files].filter(file =>
            ['appinfo.vdf', 'packageinfo.vdf'].includes(file.name.toLowerCase())
            && (!file.webkitRelativePath || file.webkitRelativePath.split('/').length === 2));
        event.target.value = '';
        importSteamMetadata(files);
    });
    controlsContainer.appendChild(metadataControls);
    profileControls.querySelector('#cleanup-profile').addEventListener('change', event => {
        state.settings.profile = event.target.value;
        state.settings.verifiedDemosOnly = state.settings.profile === 'demos';
        invalidateScan();
        saveSettings();
        updateProfileUI();
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
    dateRangeContainer.querySelectorAll('input').forEach(input => input.addEventListener('change', invalidateScan));

    const scanButton = createButton("scan-button", "Scan for Removable Licenses", "Scans all pages for licenses matching your criteria", scanAllPages);
    const settingsButton = createButton("settings-button", "Settings", "Customize keywords, exclusions, and delay", showSettingsModal);

    controlsContainer.append(scanButton, settingsButton);
    pageContent.parentNode.insertBefore(controlsContainer, pageContent);
    updateProfileUI();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
