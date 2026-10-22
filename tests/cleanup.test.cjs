const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const source = readFileSync(require.resolve('../Steam-License-Cleanup.user.js'), 'utf8');
const origin = 'https://store.steampowered.com';
const escape = text => String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const fixturePackageIds = new Set();
const license = (id, name, date = '22 Oct, 2026', removable = true) => {
    fixturePackageIds.add(id);
    return `
    <tr><td>${escape(date)}</td><td>
    ${removable ? `<div class="free_license_remove_link"><a href="javascript:RemoveFreeLicense( ${id}, 'bmFtZQ==' );">Remove</a></div>` : ''}
    ${escape(name)} <a href="https://steamdb.info/sub/${id}/">SteamDB</a>
    </td><td>Complimentary</td></tr>`;
};
const page = (rows, next = null) => `<div class="page_content_ctn">
    <table class="account_table"><tr><th>Date</th><th>Name</th><th>Method</th></tr>${rows.join('')}</table>
    ${next ? `<a class="license_paginator_next" href="${escape(next)}">Next</a>` : ''}
    </div>`;

async function until(predicate) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for UI');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

async function setup(t, handler, settings = {}) {
    const dom = new JSDOM(page([license(999, 'Current page Demo')]), {
        url: `${origin}/account/licenses/?continuationToken=old:token&offset=4800`,
        runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    const requests = [];
    const ownershipRequests = [];
    let ownershipHandler = null;
    const timers = [];
    window.g_sessionID = 'test-session';
    window.TextDecoder = TextDecoder;
    window.localStorage.setItem('steamLicenseCleanupSettings', JSON.stringify({
        verifiedDemosOnly: false, keywords: ['demo'], exclusions: [], removalDelay: 0, ...settings
    }));
    window.fetch = async (url, options = {}) => {
        const request = { url: new URL(url, origin), ...options };
        if (request.url.pathname === '/dynamicstore/userdata/') {
            ownershipRequests.push(request);
            return ownershipHandler ? ownershipHandler(request, ownershipRequests)
                : new Response(JSON.stringify({ rgOwnedPackages: [...fixturePackageIds] }));
        }
        requests.push(request);
        return handler(request, requests);
    };
    window.setTimeout = (callback, delay) => {
        const timer = { callback, delay, active: true };
        timers.push(timer);
        if (delay <= 500) queueMicrotask(() => {
            if (timer.active) { timer.active = false; callback(); }
        });
        return timer;
    };
    window.clearTimeout = timer => { timer.active = false; };
    window.console.error = () => {}; // Expected failure cases are asserted via the UI.
    window.eval(source);
    await until(() => window.document.getElementById('scan-button'));
    return {
        window, document: window.document, requests, ownershipRequests, timers,
        setOwnership: handler => { ownershipHandler = handler; },
        scan: async () => {
            window.document.getElementById('scan-button').click();
            await until(() => !window.document.querySelector('#working-status'));
        },
        remove: () => {
            window.document.getElementById('review-proceed-button').click();
            [...window.document.querySelectorAll('button')]
                .find(button => button.textContent === 'Yes, Clean Up').click();
        },
        advance: timer => { timer.active = false; timer.callback(); }
    };
}

const u32 = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value); return buffer; };
const cstring = value => Buffer.from(`${value}\0`);
const arrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
function kv(object, pool = null) {
    const parts = [];
    for (const [key, value] of (Array.isArray(object) ? object : Object.entries(object))) {
        const keyBytes = pool ? u32(pool.indexOf(key)) : cstring(key);
        if (Buffer.isBuffer(value)) parts.push(Buffer.from([5]), keyBytes, value, Buffer.alloc(2));
        else if (typeof value === 'object') parts.push(Buffer.from([0]), keyBytes, kv(value, pool));
        else if (typeof value === 'number') parts.push(Buffer.from([2]), keyBytes, u32(value));
        else parts.push(Buffer.from([1]), keyBytes, cstring(value));
    }
    return Buffer.concat([...parts, Buffer.from([8])]);
}
function metadataFiles(apps, packages, appVersion = 41, packageVersion = 40) {
    const appData = apps.map(app => ({ appinfo: app.data || {
        appid: app.id,
        common: app.common || { name: app.name || `App ${app.id}`, ...(app.type === undefined ? {} : { type: app.type }) }
    } }));
    const pool = [];
    const collect = object => (Array.isArray(object) ? object : Object.entries(object)).forEach(([key, value]) => {
        if (!pool.includes(key)) pool.push(key);
        if (typeof value === 'object' && !Buffer.isBuffer(value)) collect(value);
    });
    appData.forEach(collect);
    const entries = appData.map((data, i) => {
        const fields = Buffer.alloc(appVersion >= 40 ? 60 : 40);
        fields.writeUInt32LE(2, 0);
        fields.writeUInt32LE(1792699200, 4);
        const payload = kv(data, appVersion === 41 ? pool : null);
        return Buffer.concat([u32(apps[i].id), u32(fields.length + payload.length), fields, payload]);
    });
    const appHeader = Buffer.concat([u32(0x07564400 + appVersion), u32(1), ...(appVersion === 41 ? [Buffer.alloc(8)] : [])]);
    const body = Buffer.concat([...entries, u32(0)]);
    if (appVersion === 41) appHeader.writeBigUInt64LE(BigInt(appHeader.length + body.length), 8);
    const appBuffer = Buffer.concat([appHeader, body, ...(appVersion === 41 ? [u32(pool.length), ...pool.map(cstring)] : [])]);
    const packageBuffer = Buffer.concat([
        u32(0x06565500 + packageVersion), u32(1),
        ...packages.map(pkg => Buffer.concat([
            u32(pkg.id), Buffer.alloc(packageVersion >= 40 ? 32 : 24),
            kv({ [String(pkg.id)]: pkg.data || { packageid: pkg.id, appids: Object.fromEntries(pkg.apps.map((id, i) => [String(i), id])) } })
        ])), u32(0xffffffff)
    ]);
    return [
        { name: 'appinfo.vdf', lastModified: Date.now(), arrayBuffer: async () => arrayBuffer(appBuffer) },
        { name: 'packageinfo.vdf', lastModified: Date.now(), arrayBuffer: async () => arrayBuffer(packageBuffer) }
    ];
}
async function importMetadata(app, files) {
    const input = app.document.getElementById('steam-metadata-files');
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new app.window.Event('change'));
    await until(() => !app.document.getElementById('import-metadata-button').disabled);
}

for (const appVersion of [39, 40, 41]) {
    test(`v${appVersion}: duplicate serverbrowsername fields do not block demo verification`, async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Trial')])), { verifiedDemosOnly: true });
        const files = metadataFiles([{ id: 10, common: [
            ['name', 'Trial'], ['serverbrowsername', 'First'], ['ServerBrowserName', 'Second'], ['type', 'Demo']
        ] }], [{ id: 1, apps: [10] }], appVersion);
        await importMetadata(app, files);
        assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 1 apps and 1 packages/);
        await app.scan();
        assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
        assert.match(app.document.querySelector('#review-list').textContent, /10 = Demo/);
    });
}

for (const appData of [
    { appid: 10, common: [['type', 'Game'], ['type', 'Demo']] },
    [['appid', 10], ['common', { type: 'Game' }], ['common', { type: 'Demo' }]],
    [['appid', 20], ['appid', 10], ['common', { type: 'Demo' }]]
]) {
    test('duplicate app identity/type fields are skipped without blocking other apps', async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Ambiguous Demo'), license(2, 'Valid Demo')])), { verifiedDemosOnly: true });
        await importMetadata(app, metadataFiles([
            { id: 10, data: appData }, { id: 20, type: 'Demo' }
        ], [{ id: 1, apps: [10] }, { id: 2, apps: [20] }]));
        assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 2 apps and 2 packages/);
        await app.scan();
        assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
        assert.match(app.document.querySelector('#review-list').textContent, /Valid Demo/);
        assert.doesNotMatch(app.document.querySelector('#review-list').textContent, /Ambiguous Demo/);
    });
}

for (const packageData of [
    [['packageid', 1], ['appids', { 0: 30 }], ['appids', { 0: 10 }]],
    { packageid: 1, appids: [['0', 30], ['0', 10]] },
    [['packageid', 99], ['packageid', 1], ['appids', { 0: 10 }]]
]) {
    test('duplicate package contents cannot hide a full game behind a later Demo value', async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Ambiguous Demo'), license(2, 'Valid Demo')])), { verifiedDemosOnly: true });
        await importMetadata(app, metadataFiles([
            { id: 10, type: 'Demo' }, { id: 30, type: 'Game' }
        ], [{ id: 1, data: packageData }, { id: 2, apps: [10] }]));
        assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 2 apps and 2 packages/);
        await app.scan();
        assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
        assert.match(app.document.querySelector('#review-list').textContent, /Valid Demo/);
        assert.doesNotMatch(app.document.querySelector('#review-list').textContent, /Ambiguous Demo/);
    });
}

test('duplicate App IDs or SubIDs are skipped instead of replacing earlier metadata', async t => {
    const app = await setup(t, () => new Response(page([
        license(1, 'Duplicate app Demo'), license(2, 'Duplicate package Demo'), license(3, 'Valid Demo')
    ])), { verifiedDemosOnly: true });
    await importMetadata(app, metadataFiles([
        { id: 10, type: 'Game' }, { id: 10, type: 'Demo' }, { id: 20, type: 'Demo' }
    ], [
        { id: 1, apps: [10] }, { id: 2, apps: [10] }, { id: 2, apps: [20] }, { id: 3, apps: [20] }
    ]));
    assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 2 apps and 3 packages/);
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
    assert.match(app.document.querySelector('#review-list').textContent, /Valid Demo/);
});

test('a malformed UTF-8 name does not block import of valid Demo metadata', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Trial')])), { verifiedDemosOnly: true });
    const files = metadataFiles([{ id: 10, name: 'Broken Name', type: 'Demo' }], [{ id: 1, apps: [10] }]);
    const buffer = Buffer.from(await files[0].arrayBuffer());
    const position = buffer.indexOf(cstring('Broken Name'));
    assert.notEqual(position, -1);
    buffer[position] = 0xff;
    files[0].arrayBuffer = async () => arrayBuffer(buffer);
    await importMetadata(app, files);
    assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 1 apps and 1 packages/);
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
    assert.match(app.document.querySelector('#review-list').textContent, /10 = Demo/);
});

test('a malformed UTF-16 name does not block import of valid Demo metadata', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Trial')])), { verifiedDemosOnly: true });
    const files = metadataFiles([{ id: 10, name: Buffer.from([0x00, 0xd8]), type: 'Demo' }], [{ id: 1, apps: [10] }]);
    await importMetadata(app, files);
    assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 1 apps and 1 packages/);
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
});

for (const field of ['type-key', 'type-value']) {
    test(`malformed ${field} never qualifies an application as a Demo`, async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Game Demo')])), { verifiedDemosOnly: true });
        const files = metadataFiles([{ id: 10, type: 'Demo' }], [{ id: 1, apps: [10] }]);
        const buffer = Buffer.from(await files[0].arrayBuffer());
        const position = buffer.indexOf(cstring(field === 'type-key' ? 'type' : 'Demo'));
        assert.notEqual(position, -1);
        buffer[position] = 0xff;
        files[0].arrayBuffer = async () => arrayBuffer(buffer);
        await importMetadata(app, files);
        assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 1 apps and 1 packages/);
        await app.scan();
        assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Scan Complete');
        assert.equal(app.document.querySelector('#review-proceed-button'), null);
        assert.equal(app.requests.filter(request => request.method).length, 0);
    });
}

test('scans from the first page through cursor links and an empty-match page, deduplicating demos', async t => {
    const demoRows = Array.from({ length: 68 }, (_, i) => license(1151047 + i, `Game ${i} Demo`));
    const pages = [
        page([license(1, 'Full Game')], '?continuationToken=first:100&offset=100'),
        page([...demoRows, demoRows[0]], '?continuationToken=second:200&offset=200'),
        page([license(2, 'MINDFLUX: Dead Man Walking Demo'), license(3, 'Purchased Demo', undefined, false)])
    ];
    const app = await setup(t, request => {
        assert.equal(request.method, undefined, 'scanning never removes licenses');
        assert.equal(request.url.searchParams.get('l'), 'english');
        return new Response(pages.shift());
    });
    await app.scan();
    assert.equal(app.requests.length, 3);
    assert.equal(app.requests[0].url.searchParams.has('offset'), false);
    assert.equal(app.requests[1].url.searchParams.get('continuationToken'), 'first:100');
    assert.equal(app.requests[2].url.searchParams.get('offset'), '200');
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 69);
    assert.match(app.document.querySelector('#review-list').textContent, /MINDFLUX/);
    assert.doesNotMatch(app.document.querySelector('#review-list').textContent, /SteamDB|Purchased Demo|Current page/);
});

test('keywords and exclusions are literal phrases with word boundaries; review escapes HTML', async t => {
    const app = await setup(t, () => new Response(page([
        license(1, 'Game Demo'), license(2, 'Game Demo (Soundtrack)'),
        license(3, 'Democracy'), license(4, 'C++ Demo'),
        license(5, 'CC Demo'), license(6, '<img src=x onerror=alert(1)> Demo')
    ])), { exclusions: ['(Soundtrack)'] });
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 4);
    assert.equal(app.document.querySelector('#review-list img'), null);
    assert.match(app.document.querySelector('#review-list').textContent, /<img src=x/);
    app.document.getElementById('modal-close').click();
    app.document.getElementById('settings-button').click();
    app.document.getElementById('keywords-textarea').value = 'C++';
    [...app.document.querySelectorAll('button')].find(button => button.textContent === 'Save').click();
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
    assert.match(app.document.querySelector('#review-list').textContent, /C\+\+ Demo/);
});

test('invalid acquisition dates do not hide demos without filters, but fail a filtered scan', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Game Demo', 'unknown')])));
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
    app.document.getElementById('modal-close').click();
    app.document.getElementById('start-date-input').value = '2026-10-01';
    await app.scan();
    assert.match(app.document.querySelector('.modal-content h2').textContent, /Scan Failed/);
    assert.match(app.document.querySelector('.modal-body').textContent, /acquisition date/);
    assert.equal(app.document.querySelector('#review-proceed-button'), null);
});

test('date filtering includes both boundary dates in UTC', async t => {
    const app = await setup(t, () => new Response(page([
        license(1, 'Start Demo', '1 Oct, 2026'), license(2, 'End Demo', '22 Oct, 2026'),
        license(3, 'Old Demo', '30 Sep, 2026'), license(4, 'Future Demo', '23 Oct, 2026')
    ])));
    app.document.getElementById('start-date-input').value = '2026-10-01';
    app.document.getElementById('end-date-input').value = '2026-10-22';
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 2);
});

for (const failure of ['http', 'missing-table', 'loop', 'external-link']) {
    test(`scan failure (${failure}) never offers partial results for deletion`, async t => {
        const app = await setup(t, (request, requests) => {
            if (failure === 'external-link') return new Response(page([license(1, 'Game Demo')], 'https://example.com/account/licenses/'));
            if (failure === 'loop') return new Response(page([license(1, 'Game Demo')], '/account/licenses/?l=english'));
            if (requests.length === 1) return new Response(page([license(1, 'Game Demo')], '?offset=100&continuationToken=next'));
            return failure === 'http' ? new Response('', { status: 500 }) : new Response('<form>Sign in</form>');
        });
        await app.scan();
        assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Scan Failed');
        assert.equal(app.document.querySelector('#review-proceed-button'), null);
        assert.equal(app.document.getElementById('scan-button').disabled, false);
        assert.ok(app.requests.every(request => !request.method));
    });
}

test('settings accept comma/newline-separated keywords and preserve a zero delay', async t => {
    const app = await setup(t, () => new Response(page([])));
    app.document.getElementById('settings-button').click();
    app.document.getElementById('keywords-textarea').value = 'demo\nplaytest, C++';
    app.document.getElementById('delay-input').value = '0';
    [...app.document.querySelectorAll('button')].find(button => button.textContent === 'Save').click();
    const saved = JSON.parse(app.window.localStorage.getItem('steamLicenseCleanupSettings'));
    assert.deepEqual(saved.keywords, ['demo', 'playtest', 'C++']);
    assert.equal(saved.removalDelay, 0);
});

test('a rate-limited scan retries the same cursor before offering review', async t => {
    let gets = 0;
    const app = await setup(t, () => ++gets === 1
        ? new Response('', { status: 429 }) : new Response(page([license(1, 'Game Demo')])));
    app.document.getElementById('scan-button').click();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 30000));
    assert.equal(app.document.querySelector('#review-proceed-button'), null);
    assert.equal(app.document.getElementById('scan-button').disabled, true);
    app.advance(app.timers.find(timer => timer.active && timer.delay === 30000));
    await until(() => app.document.querySelector('#review-proceed-button'));
    assert.equal(app.requests[0].url.href, app.requests[1].url.href);
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
});

test('removal requires review and confirmation and only removes selected packages', async t => {
    const app = await setup(t, request => request.method === 'POST'
        ? new Response('{"success":1}')
        : new Response(page([license(1, 'First Demo'), license(2, 'Second Demo')])));
    await app.scan();
    const checkbox = app.document.querySelector('.license-checkbox');
    checkbox.checked = false;
    checkbox.dispatchEvent(new app.window.Event('change'));
    app.document.getElementById('review-proceed-button').click();
    assert.equal(app.requests.length, 1, 'review alone sends no removal request');
    [...app.document.querySelectorAll('button')].find(button => button.textContent === 'Yes, Clean Up').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    const removals = app.requests.filter(request => request.method === 'POST');
    assert.equal(removals.length, 1);
    assert.equal(removals[0].body.get('packageid'), '2');
    assert.equal(removals[0].body.get('sessionid'), 'test-session');
    assert.match(app.document.querySelector('.modal-body').textContent, /Successfully removed 1 license/);
});

test('a nonzero Steam error is not counted as a successful removal or retried forever', async t => {
    const app = await setup(t, request => request.method === 'POST'
        ? new Response('{"success":2}')
        : new Response(page([license(1, 'First Demo'), license(2, 'Second Demo')])));
    await app.scan();
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.match(app.document.querySelector('.modal-body').textContent, /Cleanup stopped.*Successfully removed 0/s);
    assert.equal(app.requests.filter(request => request.method === 'POST').length, 1);
});

test('Wednesdays DuplicateRequest (29) is skipped and the next selected license is removed', async t => {
    const app = await setup(t, request => {
        if (!request.method) return new Response(page([
            license(1241014, 'Wednesdays Demo'), license(2, 'Another Demo')
        ]));
        return new Response(request.body.get('packageid') === '1241014' ? '{"success":29}' : '{"success":1}');
    }, { removalDelay: 2000 });
    app.window.console.warn = () => {};
    await app.scan();
    app.remove();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 2000));
    assert.equal(app.requests.filter(request => request.method).length, 1);
    app.advance(app.timers.find(timer => timer.active && timer.delay === 2000));
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['1241014', '2']);
    const summary = app.document.querySelector('.modal-body').textContent;
    assert.match(summary, /Cleanup complete.*Successfully removed 1 license/s);
    assert.match(summary, /Duplicate requests skipped: 1/);
    assert.match(summary, /Wednesdays Demo.*DuplicateRequest \(29\), removal not confirmed/s);
    assert.doesNotMatch(summary, /Cleanup stopped/);
});

test('current SubID ownership excludes the old Wednesdays demo while preserving its full-game package', async t => {
    const app = await setup(t, request => request.method ? new Response('{"success":1}') : new Response(page([
        license(1241014, 'Wednesdays Demo'),
        license(1452965, 'Wednesdays Limited Free Promotional Package - Nov 2025'),
        license(3, 'Owned Trial')
    ])), { verifiedDemosOnly: true });
    app.setOwnership(() => new Response('{"rgOwnedPackages":[1452965,3]}'));
    await importMetadata(app, metadataFiles([
        { id: 3515220, type: 'Demo' }, { id: 2747770, type: 'Game' }, { id: 30, type: 'Demo' }
    ], [{ id: 1241014, apps: [3515220] }, { id: 1452965, apps: [2747770] }, { id: 3, apps: [30] }]));
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
    assert.match(app.document.querySelector('#review-list').textContent, /Owned Trial/);
    assert.doesNotMatch(app.document.querySelector('#review-list').textContent, /Wednesdays/);
    assert.match(app.document.querySelector('.modal-body').textContent, /Skipped 1 packages not currently owned/);
    assert.equal(app.ownershipRequests[0].cache, 'no-store');
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['3']);
    assert.equal(app.ownershipRequests.length, 2, 'ownership is refreshed again after confirmation');
});

test('a package lost between scan and confirmation is skipped without a removal request', async t => {
    const app = await setup(t, request => request.method ? new Response('{"success":1}')
        : new Response(page([license(1, 'No longer owned Demo'), license(2, 'Still owned Demo')])));
    app.setOwnership((request, requests) => new Response(JSON.stringify({ rgOwnedPackages: requests.length === 1 ? [1, 2] : [2] })));
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 2);
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['2']);
    assert.match(app.document.querySelector('.modal-body').textContent, /Packages no longer owned: 1/);
    assert.match(app.document.querySelector('.modal-body').textContent, /Successfully removed 1 license/);
});

for (const response of [{}, { rgOwnedPackages: [] }, { rgOwnedPackages: '1,2' }, { rgOwnedPackages: [1, 'bad'] }]) {
    test('missing or malformed ownership data stops a scan without offering removals', async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Game Demo')])));
        app.setOwnership(() => new Response(JSON.stringify(response)));
        await app.scan();
        assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Scan Failed');
        assert.match(app.document.querySelector('.modal-body').textContent, /Current package ownership is unavailable/);
        assert.equal(app.document.querySelector('#review-proceed-button'), null);
        assert.equal(app.requests.filter(request => request.method).length, 0);
    });
}

test('an ownership refresh failure after confirmation sends no removal requests', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Game Demo')])));
    app.setOwnership((request, requests) => requests.length === 1
        ? new Response('{"rgOwnedPackages":[1]}') : new Response('', { status: 503 }));
    await app.scan();
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(app.requests.filter(request => request.method).length, 0);
    assert.match(app.document.querySelector('.modal-body').textContent, /Cleanup stopped.*current package ownership.*503/s);
});

test('a queue containing only duplicate requests reports zero confirmed removals and exports skips', async t => {
    const app = await setup(t, request => request.method
        ? new Response('{"success":"29"}') : new Response(page([license(1, 'First Demo'), license(2, 'Second Demo')])));
    app.window.console.warn = () => {};
    await app.scan();
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(app.requests.filter(request => request.method).length, 2);
    assert.match(app.document.querySelector('.modal-body').textContent, /Successfully removed 0 license/);
    assert.match(app.document.querySelector('.modal-body').textContent, /Duplicate requests skipped: 2/);
    assert.notEqual(app.document.getElementById('export-button').style.display, 'none');
    let exported;
    app.window.URL.createObjectURL = blob => { exported = blob; return 'blob:test'; };
    app.window.URL.revokeObjectURL = () => {};
    app.window.HTMLAnchorElement.prototype.click = () => {};
    app.document.getElementById('export-button').click();
    const text = await new Promise((resolve, reject) => {
        const reader = new app.window.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(exported);
    });
    assert.match(text, /Duplicate requests skipped \(not confirmed removed in this run\)/);
    assert.match(text, /First Demo.*DuplicateRequest \(29\)/);
    assert.match(text, /Second Demo.*DuplicateRequest \(29\)/);
});

for (const limit of ['http', 'steam']) {
    test(`retries ${limit} rate limits and counts the package only after success`, async t => {
        let posts = 0;
        const app = await setup(t, request => {
            if (!request.method) return new Response(page([license(1, 'Game Demo')]));
            if (posts++ === 0) return limit === 'http'
                ? new Response('', { status: 429, headers: { 'Retry-After': '90' } })
                : new Response('{"success":84}');
            return new Response('{"success":1}');
        });
        await app.scan();
        app.remove();
        await until(() => app.timers.some(timer => timer.active && timer.delay >= 30000));
        const timer = app.timers.find(timer => timer.active && timer.delay >= 30000);
        assert.equal(timer.delay, limit === 'http' ? 90000 : 30000);
        assert.equal(posts, 1);
        app.advance(timer);
        await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
        assert.equal(posts, 2);
        assert.match(app.document.querySelector('.modal-body').textContent, /Successfully removed 1 license/);
    });
}

test('repeated rate limiting stops after four attempts', async t => {
    const app = await setup(t, request => request.method
        ? new Response('{"success":84}') : new Response(page([license(1, 'Game Demo')])));
    await app.scan();
    app.remove();
    for (let i = 0; i < 3; i++) {
        await until(() => app.timers.some(timer => timer.active && timer.delay >= 30000));
        app.advance(app.timers.find(timer => timer.active && timer.delay >= 30000));
    }
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(app.requests.filter(request => request.method).length, 4);
    assert.match(app.document.querySelector('.modal-body').textContent, /Cleanup stopped.*Successfully removed 0/s);
});

test('Cancel interrupts a cooldown without sending the next removal', async t => {
    const app = await setup(t, request => request.method
        ? new Response('{"success":1}') : new Response(page([license(1, 'First Demo'), license(2, 'Second Demo')])),
    { removalDelay: 600000 });
    await app.scan();
    app.remove();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 600000));
    const cooldown = app.timers.find(timer => timer.active && timer.delay === 600000);
    app.document.getElementById('cancel-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(cooldown.active, false);
    assert.equal(app.requests.filter(request => request.method).length, 1);
    assert.match(app.document.querySelector('.modal-body').textContent, /Cleanup cancelled.*Successfully removed 1/s);
    assert.equal(app.document.getElementById('scan-button').disabled, false);
});

test('Cancel aborts an in-flight request and prevents later removals', async t => {
    const app = await setup(t, request => {
        if (!request.method) return new Response(page([license(1, 'First Demo'), license(2, 'Second Demo')]));
        return new Promise((resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        });
    });
    await app.scan();
    app.remove();
    await until(() => app.requests.some(request => request.method));
    app.document.getElementById('cancel-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(app.requests.filter(request => request.method).length, 1);
    assert.equal(app.requests.find(request => request.method).signal.aborted, true);
    assert.match(app.document.querySelector('.modal-body').textContent, /Cleanup cancelled.*Successfully removed 0/s);
});

test('verified mode requires imported metadata and sends no request without it', async t => {
    const app = await setup(t, () => { throw new Error('Unexpected network request'); }, { verifiedDemosOnly: true });
    await app.scan();
    assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Steam Metadata Required');
    assert.equal(app.requests.length, 0);
});

for (const [appVersion, packageVersion] of [[39, 39], [40, 40], [41, 40]]) {
    test(`cache v${appVersion}/v${packageVersion}: verifies types, not names, and rejects mixed or unknown packages`, async t => {
        const app = await setup(t, () => new Response(page([
            license(1163997, 'Stellar Stables Demo'), license(2, 'Unusual Trial'),
            license(3, 'Mixed Demo'), license(4, 'Unknown Demo'), license(5, 'Missing Type Demo'),
            license(6, 'Tool Demo'), license(7, 'Several Demos'), license(8, 'Empty Demo')
        ])), { verifiedDemosOnly: true, keywords: ['this-never-matches'] });
        await importMetadata(app, metadataFiles([
            { id: 3286080, name: 'Stellar Stables', type: 'Game' },
            { id: 20, name: 'A trial with no keyword', type: 'Demo' },
            { id: 21, type: 'demo' }, { id: 30 }, { id: 40, type: 'Tool' }
        ], [
            { id: 1163997, apps: [3286080] }, { id: 2, apps: [20] },
            { id: 3, apps: [20, 3286080] }, { id: 5, apps: [30] },
            { id: 6, apps: [40] }, { id: 7, apps: [20, 21] }, { id: 8, apps: [] }
        ], appVersion, packageVersion));
        assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 5 apps and 7 packages/);
        assert.equal(app.requests.length, 0, 'cache import stays local');
        await app.scan();
        assert.equal(app.document.querySelectorAll('.license-checkbox').length, 2);
        const review = app.document.querySelector('#review-list').textContent;
        assert.match(review, /Unusual Trial.*20 = Demo/s);
        assert.match(review, /20 = Demo, 21 = Demo/);
        assert.doesNotMatch(review, /Stellar Stables|Mixed Demo|Unknown Demo|Missing Type|Tool Demo|Empty Demo/);
        assert.match(app.document.querySelector('.modal-body').textContent, /Skipped 3 packages containing non-demo apps and 3 packages with missing metadata/);
    });
}

test('metadata mode still protects exclusions and checks types again before removal', async t => {
    const app = await setup(t, request => request.method
        ? new Response('{"success":1}') : new Response(page([license(1, 'Trial'), license(2, 'Another Trial')])),
    { verifiedDemosOnly: true, exclusions: ['keep'] });
    await importMetadata(app, metadataFiles([
        { id: 10, name: 'Keep this one', type: 'Demo' }, { id: 20, type: 'Demo' }
    ], [{ id: 1, apps: [10] }, { id: 2, apps: [20] }]));
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    const posts = app.requests.filter(request => request.method);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.get('packageid'), '2');
});

test('Slime Scramble: Demo App ID qualifies, Game App ID and a mixed license do not', async t => {
    const app = await setup(t, () => new Response(page([
        license(1, 'Slime Scramble Demo'),
        license(2, 'Slime Scramble Demo - old package name'),
        license(3, 'Slime Scramble Demo and full game')
    ])), { verifiedDemosOnly: true });
    await importMetadata(app, metadataFiles([
        { id: 3249220, name: 'Slime Scramble Demo', type: 'Demo' },
        { id: 3022510, name: 'Slime Scramble', type: 'Game' }
    ], [{ id: 1, apps: [3249220] }, { id: 2, apps: [3022510] }, { id: 3, apps: [3249220, 3022510] }]));
    await app.scan();
    assert.equal(app.document.querySelectorAll('.license-checkbox').length, 1);
    const review = app.document.querySelector('#review-list').textContent;
    assert.match(review, /3249220 = Demo/);
    assert.doesNotMatch(review, /3022510|old package|full game/);
});

for (const kind of ['missing-file', 'truncated', 'unsupported-version', 'invalid-string-index']) {
    test(`invalid cache import (${kind}) cannot enable verified scanning`, async t => {
        const app = await setup(t, () => { throw new Error('Unexpected request'); }, { verifiedDemosOnly: true });
        let files = metadataFiles([{ id: 10, type: 'Demo' }], [{ id: 1, apps: [10] }]);
        if (kind === 'missing-file') files.pop();
        else {
            let buffer = Buffer.from(await files[0].arrayBuffer());
            if (kind === 'truncated') buffer = buffer.subarray(0, 20);
            if (kind === 'unsupported-version') buffer.writeUInt32LE(0x07564430, 0);
            if (kind === 'invalid-string-index') buffer.writeUInt32LE(0xffffffff, 16 + 8 + 60 + 1);
            files[0].arrayBuffer = async () => arrayBuffer(buffer);
        }
        await importMetadata(app, files);
        assert.match(app.document.getElementById('metadata-status').textContent, /Metadata not loaded:/);
        await app.scan();
        assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Steam Metadata Required');
        assert.equal(app.requests.length, 0);
    });
}
