// --- HELPERS ---
const steamId = value => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 && id < 0xffffffff ? String(id) : null;
};

const scanContext = () => JSON.stringify({
    settings: {
        profile: state.settings.profile,
        keywords: state.settings.profile === 'custom' ? state.settings.keywords : [],
        exclusions: state.settings.exclusions
    },
    start: document.getElementById('start-date-input').value,
    end: document.getElementById('end-date-input').value
});

const invalidateScan = () => {
    state.scannedLicenses = [];
    state.scanContext = null;
    state.scanSummary = null;
    state.pendingScan = null;
    state.collectedScan = null;
    state.requiresRescan = false;
    updateWorkspaceStatus();
};

const downloadText = (filename, text) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Keep the URL alive until the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const parseSteamDate = (dateString) => {
    // Scan responses are requested in English. Reject rollover dates such as
    // 31 February instead of silently selecting licenses from another month.
    const match = /^(\d{1,2})\s+([a-z]{3}),?\s+(\d{4})$/i.exec(dateString?.trim() || '');
    if (!match) return null;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(match[2].toLowerCase());
    const day = Number(match[1]), year = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day));
    return month >= 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
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

const retryDelay = (response, attempt, minimum = 30000, maximum = 300000) => {
    const header = response.headers.get('Retry-After');
    const seconds = header === null ? NaN : Number(header);
    const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    return Math.min(maximum, Math.max(minimum * 2 ** attempt, requested || 0));
};

const fetchOwnedPackages = async (signal) => {
    // Same current-ownership endpoint used by SteamDB/Augmented Steam.
    // Cache metadata and the license history page do not prove ownership.
    const url = new URL('/dynamicstore/userdata/', window.location.origin);
    url.searchParams.set('_', String(Date.now()));
    for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        // Match SteamDB's session-refresh request. Accepting HTML allows Steam's
        // expired-cookie redirect flow; the endpoint still returns JSON on success.
        // https://github.com/SteamDatabase/BrowserExtension/blob/master/scripts/background.js
        const response = await fetch(url.href, {
            credentials: 'include', cache: 'no-store', signal, headers: { Accept: 'text/html' }
        });
        if (response.status === 429 && attempt < 3) {
            await wait(retryDelay(response, attempt), signal);
            continue;
        }
        if (!response.ok) throw new Error(`Cannot check current package ownership (HTTP ${response.status}).`);
        let data;
        try { data = await response.json(); }
        catch { throw new Error('Cannot read current package ownership: Steam returned a login page or another non-JSON response. Open the Steam Store to refresh your session, then retry the ownership check.'); }
        const packages = data?.rgOwnedPackages;
        if (!Array.isArray(packages)) {
            throw new Error('Current package ownership is unavailable: Steam did not return an rgOwnedPackages array. Retry the ownership check; this response does not prove you are signed out.');
        }
        if (!packages.length) {
            throw new Error('Current package ownership is unavailable: Steam returned an empty rgOwnedPackages list. Open the Steam Store to refresh your session, then retry the ownership check.');
        }
        // The ownership list is not an App ID list. Non-positive or large package
        // entries must not invalidate ownership of unrelated, eligible packages.
        // Preserve exact integer identities; never coerce booleans or objects.
        const invalidIndex = packages.findIndex(id => !(
            (typeof id === 'number' && Number.isSafeInteger(id))
            || (typeof id === 'string' && /^-?\d+$/.test(id) && Number.isSafeInteger(Number(id)))
        ));
        if (invalidIndex !== -1) {
            throw new Error(`Current package ownership is unavailable: unexpected package entry at index ${invalidIndex} (type ${typeof packages[invalidIndex]}). Retry the ownership check; this is a data-format error, not proof of a signed-out session.`);
        }
        signal?.throwIfAborted();
        return new Set(packages.map(String));
    }
};

const setControlsDisabled = (disabled) => {
    document.querySelectorAll('#cleanup-controls button, #cleanup-controls input, #cleanup-controls select, #cleanup-controls textarea')
        .forEach(control => { control.disabled = disabled; });
    if (!disabled) updateProfileUI();
    updateWorkspaceStatus();
};
