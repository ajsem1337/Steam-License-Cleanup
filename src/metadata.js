// Steam cache formats: https://github.com/xPaw/SteamAppInfo
// Read locally selected files only; tokens and other unused fields are discarded.
const duplicateKeys = Symbol('duplicateSteamMetadataKeys');
const hasDuplicate = (object, key) => Boolean(object?.[duplicateKeys]?.has(key));
const isRecord = value => value !== null && typeof value === 'object';
class CacheReader {
    constructor(buffer) {
        this.bytes = new Uint8Array(buffer);
        this.view = new DataView(buffer);
        this.position = 0;
        this.limit = buffer.byteLength;
        this.strings = null;
        // A malformed character in a name or unused field must not reject the
        // entire cache. Replaced characters cannot match the exact type Demo.
        this.decoder = new TextDecoder('utf-8');
    }
    require(size) {
        if (!Number.isSafeInteger(size) || size < 0 || this.position + size > this.limit) {
            throw new Error('Truncated or invalid Steam metadata file.');
        }
    }
    skip(size) { this.require(size); this.position += size; }
    byte() { this.require(1); return this.bytes[this.position++]; }
    uint32() {
        this.require(4);
        const value = this.view.getUint32(this.position, true);
        this.position += 4;
        return value;
    }
    uint64() {
        this.require(8);
        const value = this.view.getBigUint64(this.position, true);
        this.position += 8;
        return value;
    }
    string() {
        const start = this.position;
        while (this.byte() !== 0) { /* scan to the terminating byte */ }
        return this.decoder.decode(this.bytes.subarray(start, this.position - 1));
    }
    keyValues(depth = 0) {
        if (depth > 64) throw new Error('Steam metadata nesting is too deep.');
        const result = Object.create(null);
        while (true) {
            const type = this.byte();
            if (type === 8) return result;
            let key;
            if (this.strings) {
                const index = this.uint32();
                if (index >= this.strings.length) throw new Error('Invalid Steam metadata string-table index.');
                key = this.strings[index];
            } else {
                key = this.string();
            }
            key = key.toLowerCase();
            let value;
            switch (type) {
                case 0: value = this.keyValues(depth + 1); break;
                case 1: value = this.string(); break;
                case 2: case 4: case 6: value = this.uint32(); break;
                case 3:
                    this.require(4);
                    value = this.view.getFloat32(this.position, true);
                    this.position += 4;
                    break;
                case 5: {
                    const start = this.position;
                    while (true) {
                        this.require(2);
                        const character = this.view.getUint16(this.position, true);
                        this.position += 2;
                        if (character === 0) break;
                    }
                    value = new TextDecoder('utf-16le').decode(this.bytes.subarray(start, this.position - 2));
                    break;
                }
                case 7: case 10: value = this.uint64().toString(); break;
                default: throw new Error(`Unsupported Steam metadata value type ${type}.`);
            }
            // KeyValues allows repeated names. Keep reading descriptive fields,
            // but record ambiguity so overwritten type/contents cannot qualify.
            if (Object.hasOwn(result, key)) {
                if (!result[duplicateKeys]) result[duplicateKeys] = new Set();
                result[duplicateKeys].add(key);
            }
            result[key] = value;
        }
    }
}

const parseAppCache = async (buffer) => {
    const reader = new CacheReader(buffer);
    const magic = reader.uint32();
    if (![0x07564427, 0x07564428, 0x07564429].includes(magic)) {
        throw new Error('Unsupported appinfo.vdf version (supported: 39, 40, 41).');
    }
    if (reader.uint32() !== 1) throw new Error('Only public-universe Steam metadata is supported.');
    const version = magic & 0xff;
    let entriesEnd = reader.limit;
    if (version === 41) {
        const offset = Number(reader.uint64());
        if (!Number.isSafeInteger(offset) || offset < reader.position || offset > reader.limit - 4) {
            throw new Error('Invalid appinfo.vdf string-table offset.');
        }
        const start = reader.position;
        reader.position = offset;
        const count = reader.uint32();
        if (count > reader.limit - reader.position) throw new Error('Invalid appinfo.vdf string-table size.');
        reader.strings = [];
        for (let i = 0; i < count; i++) reader.strings.push(reader.string());
        if (reader.position !== reader.limit) throw new Error('Unexpected data after the appinfo.vdf string table.');
        reader.position = start;
        entriesEnd = offset;
    }
    reader.limit = entriesEnd;
    const apps = new Map();
    // v41 has an explicit end offset; compacted caches may omit the zero footer.
    while (reader.position < entriesEnd) {
        const appid = reader.uint32();
        if (appid === 0) break;
        const size = reader.uint32();
        reader.require(size);
        const end = reader.position + size;
        const outerLimit = reader.limit;
        reader.limit = end;
        const infoState = reader.uint32();
        const updated = reader.uint32();
        reader.skip(8 + 20 + 4 + (version >= 40 ? 20 : 0));
        const root = reader.keyValues();
        const data = root.appinfo;
        if (reader.position !== end) {
            throw new Error(`Invalid appinfo.vdf record for App ID ${appid}.`);
        }
        const identityKnown = infoState === 2 && isRecord(data) && !hasDuplicate(root, 'appinfo') && !hasDuplicate(data, 'appid')
            && (data.appid === undefined || steamId(data.appid) === String(appid)) && !apps.has(String(appid));
        const common = identityKnown && !hasDuplicate(data, 'common') && isRecord(data.common) ? data.common : null;
        apps.set(String(appid), {
            name: !hasDuplicate(common, 'name') && typeof common?.name === 'string' ? common.name : '',
            type: !hasDuplicate(common, 'type') && typeof common?.type === 'string' ? common.type.toLowerCase() : '',
            updated
        });
        reader.limit = outerLimit;
        if (apps.size % 200 === 0) await wait(0);
    }
    if (reader.position !== entriesEnd) throw new Error('Unexpected data after appinfo.vdf records.');
    return apps;
};

const parsePackageCache = async (buffer) => {
    const reader = new CacheReader(buffer);
    const magic = reader.uint32();
    if (![0x06565527, 0x06565528].includes(magic)) {
        throw new Error('Unsupported packageinfo.vdf version (supported: 39, 40).');
    }
    if (reader.uint32() !== 1) throw new Error('Only public-universe Steam metadata is supported.');
    const packages = new Map();
    while (true) {
        const packageid = reader.uint32();
        if (packageid === 0xffffffff) break;
        reader.skip(20 + 4 + ((magic & 0xff) >= 40 ? 8 : 0));
        const root = reader.keyValues();
        const data = root[String(packageid)];
        const contentsKnown = isRecord(data) && !hasDuplicate(root, String(packageid))
            && !hasDuplicate(data, 'packageid') && !hasDuplicate(data, 'appids') && !packages.has(String(packageid))
            && (data.packageid === undefined || steamId(data.packageid) === String(packageid))
            && isRecord(data.appids) && !data.appids[duplicateKeys]?.size
            && Object.keys(data.appids).every((key, index) => key === String(index));
        const appids = contentsKnown ? Object.values(data.appids) : [];
        packages.set(String(packageid), appids.length && appids.every(id => steamId(id) !== null)
            ? [...new Set(appids.map(steamId))] : []);
        if (packages.size % 200 === 0) await wait(0);
    }
    if (reader.position !== reader.limit) throw new Error('Unexpected data after packageinfo.vdf records.');
    return packages;
};

const verifyDemoPackage = (packageId) => {
    const appids = state.metadata?.packages.get(packageId);
    if (!appids?.length) return { status: 'unknown', reason: 'Package contents unavailable' };
    const apps = appids.map(id => ({ id, ...state.metadata.apps.get(id) }));
    if (apps.some(app => app.type && app.type !== 'demo')) {
        return { status: 'other', reason: 'Package contains a non-demo application' };
    }
    if (apps.some(app => !app.type)) return { status: 'unknown', reason: 'Application type unavailable' };
    return { status: 'demo', apps };
};

const importSteamMetadata = async (files) => {
    if (state.isScanning || state.isCleaning || state.isImporting) return;
    state.isImporting = true;
    state.metadata = null;
    invalidateScan();
    setControlsDisabled(true);
    const status = document.getElementById('metadata-status');
    status.textContent = 'Reading local Steam metadata...';
    try {
        const appFile = [...files].find(file => file.name.toLowerCase() === 'appinfo.vdf');
        const packageFile = [...files].find(file => file.name.toLowerCase() === 'packageinfo.vdf');
        if (files.length !== 2 || !appFile || !packageFile) throw new Error('Select both appinfo.vdf and packageinfo.vdf together.');
        const apps = await parseAppCache(await appFile.arrayBuffer());
        const packages = await parsePackageCache(await packageFile.arrayBuffer());
        state.metadata = { apps, packages };
        status.textContent = `Loaded ${apps.size} apps and ${packages.size} packages from local Steam cache. App cache file: ${new Date(appFile.lastModified).toLocaleString()}.`;
    } catch (error) {
        status.textContent = `Metadata not loaded: ${error.message}`;
    } finally {
        state.isImporting = false;
        setControlsDisabled(false);
    }
};
