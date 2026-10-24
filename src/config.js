// --- CONFIGURATION & STATE ---
const PROFILES = {
    demos: { label: 'Verified demos', description: 'Checks application types against imported Steam metadata.' },
    playtests: { label: 'Playtests / beta / alpha (name filters)', keywords: ['playtest', 'beta', 'alpha'], description: 'Matches names only. Application types are not verified.' },
    videos: { label: 'Trailers / videos (name filters)', keywords: ['trailer', 'teaser', 'cinematic', 'pegi', 'esrb'], description: 'Matches names only. Review each license before removal.' },
    soundtracks: { label: 'Soundtracks (name filters)', keywords: ['soundtrack'], description: 'Matches names only. Exclusions still apply, including saved soundtrack exclusions.' },
    custom: { label: 'Custom name filters', description: 'Matches your own phrases in license names. Application types are not verified.' },
    all: { label: 'All removable licenses', keywords: [], description: 'Includes all currently owned removable licenses within your dates, except exclusions. Review carefully.' }
};
const DEFAULTS = {
    profile: 'demos',
    verifiedDemosOnly: true,
    keywords: ["trailer", "teaser", "demo", "cinematic", "pegi", "esrb", "soundtrack", "playtest", "beta", "alpha"],
    exclusions: [],
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
    scanController: null,
    scanContext: null,
    scanSummary: null,
    pendingScan: null,
    collectedScan: null,
    requiresRescan: false,
    isImporting: false,
    metadata: null,
    ownedPackages: null,
    scanStats: null,
    cleanupController: null,
    cleanupStatus: "",
    cleanupReport: null,
    removedDetails: [],
    skippedDetails: [],
    notOwnedDetails: [],
    scannedLicenses: [] // Holds { packageId, details }
};
