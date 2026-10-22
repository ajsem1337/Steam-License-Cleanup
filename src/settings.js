// --- LOCALSTORAGE & SETTINGS ---
const loadSettings = () => {
    try {
        const saved = localStorage.getItem('steamLicenseCleanupSettings');
        const parsed = saved ? JSON.parse(saved) : {};
        const keywords = value => Array.isArray(value) && value.every(word => typeof word === 'string')
            ? [...new Set(value.map(word => word.trim()).filter(Boolean))] : null;
        const profile = Object.hasOwn(PROFILES, parsed?.profile) ? parsed.profile
            : parsed?.verifiedDemosOnly === false ? 'custom' : 'demos';
        state.settings = {
            profile,
            verifiedDemosOnly: profile === 'demos',
            keywords: keywords(parsed?.keywords) ?? [...DEFAULTS.keywords],
            exclusions: keywords(parsed?.exclusions) ?? [...DEFAULTS.exclusions],
            removalDelay: Number.isFinite(parsed?.removalDelay) && parsed.removalDelay >= 0 && parsed.removalDelay <= 2147483647
                ? parsed.removalDelay : DEFAULTS.removalDelay
        };
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
