const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const source = readFileSync(require.resolve('../Steam-License-Cleanup.user.js'), 'utf8');
const origin = 'https://store.steampowered.com';
const escape = text => String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const fixturePackageIds = new Set([0]);
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
    if (settings !== null) window.localStorage.setItem('steamLicenseCleanupSettings', JSON.stringify({
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
        fields.writeUInt32LE(apps[i].infoState ?? 2, 0);
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
    app.document.getElementById('keywords-textarea').value = 'C++';
    app.document.getElementById('keywords-textarea').dispatchEvent(new app.window.Event('input'));
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
    app.document.getElementById('keywords-textarea').value = 'demo\nplaytest, C++';
    app.document.getElementById('delay-input').value = '0';
    for (const id of ['keywords-textarea', 'exclusions-textarea', 'delay-input']) app.document.getElementById(id).dispatchEvent(new app.window.Event('input'));
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
    app.setOwnership((request, requests) => new Response(JSON.stringify({
        rgOwnedPackages: requests.length <= 2 ? [1241014, 2] : [2]
    })));
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

test('a duplicate request for a package still reported as owned stops before the next removal', async t => {
    const app = await setup(t, request => request.method
        ? new Response('{"success":29}') : new Response(page([license(1, 'First Demo'), license(2, 'Second Demo')])));
    app.window.console.warn = () => {};
    await app.scan();
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(app.requests.filter(request => request.method).length, 1);
    assert.equal(app.ownershipRequests.length, 3);
    const summary = app.document.querySelector('.modal-body').textContent;
    assert.match(summary, /Cleanup stopped.*Successfully removed 0 license/s);
    assert.match(summary, /Duplicate requests skipped: 1/);
    assert.match(summary, /Package ID 1.*ownership response still lists this package/s);
    assert.equal(app.document.getElementById('scan-button').disabled, false);
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
    app.setOwnership((request, requests) => new Response(JSON.stringify({
        rgOwnedPackages: requests.length <= 2 ? [1, 2, 999] : requests.length <= 4 ? [2, 999] : [999]
    })));
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
        assert.equal(timer.delay, 180000);
        assert.equal(posts, 1);
        app.advance(timer);
        await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
        assert.equal(posts, 2);
        assert.match(app.document.querySelector('.modal-body').textContent, /Successfully removed 1 license/);
    });
}

test('repeated limits preserve the queue beyond four attempts and cap backoff at thirty minutes', async t => {
    let limitedAttempts = 0;
    const app = await setup(t, request => !request.method
        ? new Response(page([license(1, 'First Demo'), license(2, 'Limited Demo'), license(3, 'Last Demo')]))
        : new Response(request.body.get('packageid') === '2' && limitedAttempts++ < 6 ? '{"success":84}' : '{"success":1}'));
    await app.scan();
    app.remove();
    for (const delay of [180000, 360000, 720000, 1440000, 1800000, 1800000]) {
        await until(() => app.timers.some(timer => timer.active && timer.delay === delay));
        assert.equal(app.document.querySelector('.modal-content h2'), null);
        assert.match(app.document.querySelector('.progress-status-text').textContent, /Continuing at.*this package remains queued/);
        app.advance(app.timers.find(timer => timer.active && timer.delay === delay));
    }
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['1', '2', '2', '2', '2', '2', '2', '2', '3']);
    assert.equal(app.ownershipRequests.length, 10, 'scan, initial ownership, two subsequent packages and six cooldown refreshes');
    assert.match(app.document.querySelector('.modal-body').textContent, /Cleanup complete.*Successfully removed 3/s);
});

test('removal retries respect a Retry-After longer than the default cooldown', async t => {
    let posts = 0;
    const app = await setup(t, request => !request.method ? new Response(page([license(1, 'Game Demo')]))
        : posts++ === 0 ? new Response('', { status: 429, headers: { 'Retry-After': '3600' } })
        : new Response('{"success":1}'));
    await app.scan();
    app.remove();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 3600000));
    assert.equal(posts, 1);
    app.advance(app.timers.find(timer => timer.active && timer.delay === 3600000));
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(posts, 2);
});

test('ownership refreshed after a rate limit skips a lost package without retrying its removal', async t => {
    const app = await setup(t, request => !request.method ? new Response(page([
        license(1, 'First Demo'), license(2, 'Lost Demo'), license(3, 'Last Demo')
    ])) : new Response(request.body.get('packageid') === '2' ? '{"success":84}' : '{"success":1}'));
    app.setOwnership((request, requests) => new Response(JSON.stringify({
        rgOwnedPackages: requests.length <= 3 ? [1, 2, 3] : [1, 3]
    })));
    await app.scan();
    app.remove();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 180000));
    app.advance(app.timers.find(timer => timer.active && timer.delay === 180000));
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['1', '2', '3']);
    assert.match(app.document.querySelector('.modal-body').textContent, /Successfully removed 2 license/);
    assert.match(app.document.querySelector('.modal-body').textContent, /Packages no longer owned: 1/);
    assert.equal(app.document.getElementById('resume-cleanup-button'), null);
});

test('Cancel interrupts a long rate limit pause without another removal request', async t => {
    const app = await setup(t, request => request.method ? new Response('{"success":84}')
        : new Response(page([license(1, 'Limited Demo')])));
    await app.scan();
    app.remove();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 180000));
    const cooldown = app.timers.find(timer => timer.active && timer.delay === 180000);
    app.document.getElementById('cancel-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(cooldown.active, false);
    assert.equal(app.requests.filter(request => request.method).length, 1);
    assert.match(app.document.querySelector('.modal-body').textContent, /Cleanup cancelled/);
    assert.equal(app.document.getElementById('resume-cleanup-button'), null);
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

const chooseProfile = (app, value) => {
    const select = app.document.getElementById('cleanup-profile');
    select.value = value;
    select.dispatchEvent(new app.window.Event('change'));
};
const reviewIds = app => [...app.document.querySelectorAll('#review-list li')]
    .map(row => /Package ID: (\d+)/.exec(row.textContent)[1]);

for (const [profile, expected] of [
    ['playtests', ['2', '3']], ['videos', ['4']], ['soundtracks', ['5']],
    ['all', ['1', '2', '3', '4', '5', '6', '7']], ['custom', ['1']]
]) {
    test(`${profile} profile uses its own rules and preserves custom keywords`, async t => {
        const app = await setup(t, () => new Response(page([
            license(1, 'Sample Demo'), license(2, 'Sample Playtest'), license(3, 'Sample Beta'),
            license(4, 'Sample Trailer'), license(5, 'Sample Soundtrack'), license(6, 'Sample Game'),
            license(7, 'Betaine'), license(8, 'Paid Soundtrack', undefined, false), license(9, 'Keep Beta')
        ])), { exclusions: ['Keep'] });
        chooseProfile(app, profile);
        await app.scan();
        assert.deepEqual(reviewIds(app), expected);
        assert.equal(app.document.getElementById('metadata-controls').hidden, true);
        assert.match(app.document.querySelector('.modal-body').textContent, /NOT been verified/);
        assert.deepEqual(JSON.parse(app.window.localStorage.getItem('steamLicenseCleanupSettings')).keywords, ['demo']);
        assert.equal(app.requests.filter(request => request.method).length, 0);
    });
}

test('legacy custom settings migrate without losing filters, exclusions or delay', async t => {
    const app = await setup(t, () => new Response(page([])), { keywords: ['C++'], exclusions: ['keep'], removalDelay: 12345 });
    assert.equal(app.document.getElementById('cleanup-profile').value, 'custom');
    assert.equal(app.document.getElementById('keywords-textarea').value, 'C++');
    assert.equal(app.document.getElementById('exclusions-textarea').value, 'keep');
    assert.equal(Number(app.document.getElementById('delay-input').value) * 60000, 12345);
});

test('invalid saved settings fall back to usable defaults without hiding controls', async t => {
    const app = await setup(t, () => new Response(page([])), {
        profile: '__proto__', keywords: 'demo', exclusions: [5], removalDelay: -10
    });
    assert.match(app.document.getElementById('keywords-textarea').value, /demo/);
    assert.equal(app.document.getElementById('exclusions-textarea').value, '');
    assert.equal(app.document.getElementById('delay-input').value, '10');
});

test('inline delay uses minutes, rejects invalid values and saves valid changes', async t => {
    const app = await setup(t, () => new Response(page([])));
    const editDelay = value => {
        app.document.getElementById('delay-input').value = value;
        app.document.getElementById('delay-input').dispatchEvent(new app.window.Event('input'));
    };
    editDelay('-1');
    assert.match(app.document.getElementById('delay-error').textContent, /Enter a valid delay/);
    assert.equal(app.document.getElementById('delay-input').getAttribute('aria-invalid'), 'true');
    assert.equal(JSON.parse(app.window.localStorage.getItem('steamLicenseCleanupSettings')).removalDelay, 0);
    await app.scan();
    assert.equal(app.requests.length, 0, 'invalid delay prevents scanning');
    editDelay('0.5');
    assert.equal(JSON.parse(app.window.localStorage.getItem('steamLicenseCleanupSettings')).removalDelay, 30000);
    assert.equal(app.document.getElementById('delay-input').getAttribute('aria-invalid'), 'false');
    assert.equal(app.document.querySelector('.modal-overlay'), null);
});

test('profile controls replace Settings and show custom phrases only for the custom profile', async t => {
    const app = await setup(t, () => new Response(page([])), { keywords: ['C++'] });
    assert.equal(app.document.getElementById('settings-button'), null);
    assert.equal(app.document.getElementById('custom-filters').hidden, false);
    chooseProfile(app, 'demos');
    assert.equal(app.document.getElementById('metadata-controls').hidden, false);
    assert.equal(app.document.getElementById('custom-filters').hidden, true);
    assert.equal(app.document.getElementById('keywords-textarea').disabled, true);
    chooseProfile(app, 'videos');
    assert.equal(app.document.getElementById('metadata-controls').hidden, true);
    assert.equal(app.document.getElementById('custom-filters').hidden, true);
    chooseProfile(app, 'custom');
    assert.equal(app.document.getElementById('keywords-textarea').value, 'C++');
    assert.equal(app.document.getElementById('keywords-textarea').disabled, false);
});

test('review search, visible selection and sorting preserve exact selected package identities', async t => {
    const app = await setup(t, request => request.method ? new Response('{"success":1}') : new Response(page([
        license(1, 'Zebra Demo', '1 Jan, 2026'), license(2, 'Alpha Demo', '3 Jan, 2026'), license(3, 'Other Demo', '2 Jan, 2026')
    ])));
    await app.scan();
    const search = app.document.getElementById('review-search');
    search.value = 'Alpha';
    search.dispatchEvent(new app.window.Event('input'));
    app.document.getElementById('deselect-all').click();
    assert.match(app.document.getElementById('review-count').textContent, /1 of 3 visible; 2 selected/);
    search.value = '';
    search.dispatchEvent(new app.window.Event('input'));
    const sort = app.document.getElementById('review-sort');
    sort.value = 'name'; sort.dispatchEvent(new app.window.Event('change'));
    assert.deepEqual(reviewIds(app), ['2', '3', '1']);
    sort.value = 'newest'; sort.dispatchEvent(new app.window.Event('change'));
    assert.deepEqual(reviewIds(app), ['2', '3', '1']);
    assert.equal(app.document.querySelector('#review-list li input').checked, false);
    app.remove();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['3', '1']);
});

test('exporting the review includes selected hidden rows and never removes anything', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'First Demo'), license(2, 'Second Demo')])));
    await app.scan();
    let exported;
    app.window.URL.createObjectURL = blob => { exported = blob; return 'blob:test'; };
    app.window.URL.revokeObjectURL = () => {};
    app.window.HTMLAnchorElement.prototype.click = () => {};
    app.document.getElementById('review-search').value = 'First';
    app.document.getElementById('review-search').dispatchEvent(new app.window.Event('input'));
    app.document.getElementById('export-review-button').click();
    const text = await new Promise(resolve => {
        const reader = new app.window.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(exported);
    });
    assert.match(text, /review only; no removal confirmed/);
    assert.match(text, /First Demo/); assert.match(text, /Second Demo/);
    assert.equal(app.requests.filter(request => request.method).length, 0);
});

for (const change of ['profile', 'date', 'settings', 'metadata']) {
    test(`changing ${change} invalidates a pending confirmation before any POST`, async t => {
        const app = await setup(t, request => request.method ? new Response('{"success":1}') : new Response(page([license(1, 'First Demo')])));
        await app.scan();
        app.document.getElementById('review-proceed-button').click();
        if (change === 'profile') chooseProfile(app, 'all');
        if (change === 'date') app.document.getElementById('start-date-input').value = '2026-01-01';
        if (change === 'settings') {
            app.document.getElementById('exclusions-textarea').value = 'First';
            app.document.getElementById('exclusions-textarea').dispatchEvent(new app.window.Event('input'));
        }
        if (change === 'metadata') await importMetadata(app, metadataFiles([{ id: 10, type: 'Demo' }], [{ id: 1, apps: [10] }]));
        [...app.document.querySelectorAll('button')].find(button => button.textContent === 'Yes, Clean Up').click();
        assert.match(app.document.body.textContent, /Scan Again/);
        assert.equal(app.requests.filter(request => request.method).length, 0);
    });
}

test('cancelling a rate-limited scan interrupts the wait and never offers partial results', async t => {
    const app = await setup(t, () => new Response('', { status: 429 }));
    app.document.getElementById('scan-button').click();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 30000));
    app.document.getElementById('cancel-scan-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Scan Cancelled');
    assert.equal(app.document.getElementById('review-proceed-button'), null);
    assert.equal(app.document.getElementById('scan-button').disabled, false);
    assert.equal(app.requests.length, 1);
    assert.equal(app.timers.some(timer => timer.active && timer.delay === 30000), false);
});

test('cancelling an in-flight scan aborts its request', async t => {
    let aborted = false;
    const app = await setup(t, request => new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => { aborted = true; reject(request.signal.reason); });
    }));
    app.document.getElementById('scan-button').click();
    app.document.getElementById('cancel-scan-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Scan Cancelled');
    assert.equal(aborted, true);
    assert.equal(app.ownershipRequests.length, 0);
});

test('ownership lost during the configured delay is checked before the next POST', async t => {
    const app = await setup(t, request => request.method ? new Response('{"success":1}') : new Response(page([
        license(1, 'First Demo'), license(2, 'Lost Demo')
    ])), { removalDelay: 2000 });
    let owned = [1, 2, 999];
    app.setOwnership(() => new Response(JSON.stringify({ rgOwnedPackages: owned })));
    await app.scan(); app.remove();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 2000));
    owned = [999];
    app.advance(app.timers.find(timer => timer.active && timer.delay === 2000));
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['1']);
    assert.match(app.document.querySelector('.modal-body').textContent, /Packages no longer owned: 1/);
});

test('date filters reject calendar rollover dates', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Invalid Demo', '31 Feb, 2026')])));
    app.document.getElementById('start-date-input').value = '2026-01-01';
    await app.scan();
    assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Scan Failed');
    assert.match(app.document.querySelector('.modal-body').textContent, /Cannot read the acquisition date/);
});

test('dialogs have an accessible name, trap keyboard focus and return focus on Escape', async t => {
    const app = await setup(t, () => new Response(page([])), { verifiedDemosOnly: true });
    const scan = app.document.getElementById('scan-button');
    scan.focus(); scan.click();
    const dialog = app.document.querySelector('[role="dialog"]');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(app.document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Steam Metadata Required');
    dialog.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(app.document.activeElement.id, 'modal-close');
    dialog.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(app.document.activeElement.id, 'modal-close');
    dialog.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(app.document.querySelector('[role="dialog"]'), null);
    assert.equal(app.document.activeElement, scan);
});

for (const id of ['1e1', ' 10 ', '10.0', '00010', '4294967295']) {
    test(`a malformed package App ID (${JSON.stringify(id)}) cannot verify a demo`, async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Ambiguous Demo'), license(2, 'Valid Demo')])), { verifiedDemosOnly: true });
        await importMetadata(app, metadataFiles([{ id: 10, type: 'Demo' }], [
            { id: 1, data: { appids: { 0: id } } }, { id: 2, apps: [10] }
        ]));
        await app.scan();
        assert.deepEqual(reviewIds(app), ['2']);
    });
}

test('an incomplete application record cannot verify a demo', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Incomplete Demo'), license(2, 'Valid Demo')])), { verifiedDemosOnly: true });
    await importMetadata(app, metadataFiles([{ id: 10, type: 'Demo', infoState: 1 }, { id: 20, type: 'Demo' }], [
        { id: 1, apps: [10] }, { id: 2, apps: [20] }
    ]));
    await app.scan();
    assert.deepEqual(reviewIds(app), ['2']);
});

for (const appids of [{ 1: 10 }, { 0: 10, 2: 20 }, { app: 10 }]) {
    test('missing or invalid application-list indices cannot verify a package', async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Broken Demo'), license(2, 'Valid Demo')])), { verifiedDemosOnly: true });
        await importMetadata(app, metadataFiles([{ id: 10, type: 'Demo' }, { id: 20, type: 'Demo' }], [
            { id: 1, data: { appids } }, { id: 2, apps: [10] }
        ]));
        await app.scan();
        assert.deepEqual(reviewIds(app), ['2']);
    });
}

test('folder import reads only the two metadata files at the selected folder root', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Valid Demo')])) , { verifiedDemosOnly: true });
    const files = metadataFiles([{ id: 10, type: 'Demo' }], [{ id: 1, apps: [10] }]);
    files[0].webkitRelativePath = 'appcache/appinfo.vdf';
    files[1].webkitRelativePath = 'appcache/packageinfo.vdf';
    files.push({ name: 'random.vdf', webkitRelativePath: 'appcache/random.vdf', arrayBuffer: () => { throw new Error('Must not read unrelated files'); } });
    files.push({ name: 'appinfo.vdf', webkitRelativePath: 'appcache/backup/appinfo.vdf', arrayBuffer: () => { throw new Error('Must not read nested backups'); } });
    const input = app.document.getElementById('steam-metadata-folder');
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new app.window.Event('change'));
    await until(() => !app.document.getElementById('import-metadata-button').disabled);
    assert.match(app.document.getElementById('metadata-status').textContent, /Loaded 1 apps and 1 packages/);
    await app.scan();
    assert.deepEqual(reviewIds(app), ['1']);
});

for (const settings of [{ profile: 'all' }, { profile: 'custom', keywords: [] }]) {
    test('a scan without an inclusion filter requires explicit selection', async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Any Game'), license(2, 'Any Demo')])), settings);
        await app.scan();
        assert.deepEqual(reviewIds(app), ['1', '2']);
        assert.equal(app.document.querySelectorAll('.license-checkbox:checked').length, 0);
        assert.equal(app.document.getElementById('review-proceed-button').disabled, true);
        app.document.getElementById('select-all').click();
        assert.equal(app.document.querySelectorAll('.license-checkbox:checked').length, 2);
        assert.equal(app.document.getElementById('review-proceed-button').disabled, false);
    });
}

test('a fresh installation defaults to verified demos without example exclusions', async t => {
    const app = await setup(t, () => { throw new Error('No metadata; no requests expected'); }, null);
    assert.equal(app.document.getElementById('cleanup-profile').value, 'demos');
    assert.equal(app.document.getElementById('exclusions-textarea').value, '');
    assert.equal(app.document.getElementById('delay-input').value, '10');
    await app.scan();
    assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Steam Metadata Required');
    assert.equal(app.requests.length, 0);
});

test('changing only the delay preserves scan results and uses the new delay', async t => {
    const app = await setup(t, request => request.method ? new Response('{"success":1}') : new Response(page([
        license(1, 'First Demo'), license(2, 'Second Demo')
    ])));
    await app.scan();
    const delay = app.document.getElementById('delay-input');
    delay.value = '0.5';
    delay.dispatchEvent(new app.window.Event('input'));
    app.remove();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 30000));
    assert.equal(app.requests.filter(request => request.method).length, 1);
    assert.equal(delay.disabled, true);
    assert.equal(app.document.getElementById('keywords-textarea').disabled, true);
    assert.equal(app.document.getElementById('exclusions-textarea').disabled, true);
    app.advance(app.timers.find(timer => timer.active && timer.delay === 30000));
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.equal(app.requests.filter(request => request.method).length, 2);
    assert.equal(delay.disabled, false);
    assert.equal(app.document.getElementById('keywords-textarea').disabled, false);
    assert.match(app.document.querySelector('.modal-body').textContent, /Successfully removed 2/);
});

test('an invalid inline delay blocks cleanup before any removal request', async t => {
    const app = await setup(t, request => request.method ? new Response('{"success":1}') : new Response(page([license(1, 'Demo')])));
    await app.scan();
    const delay = app.document.getElementById('delay-input');
    delay.value = '';
    delay.dispatchEvent(new app.window.Event('input'));
    app.remove();
    assert.match(app.document.querySelector('.modal-body').textContent, /Enter a valid number of minutes/);
    assert.equal(app.requests.filter(request => request.method).length, 0);
});

test('saved exclusions stay visible and active when changing profiles', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Keep Soundtrack'), license(2, 'Other Soundtrack')])), { exclusions: ['Keep'] });
    const exclusions = app.document.getElementById('exclusion-options');
    assert.equal(exclusions.open, true);
    assert.equal(app.document.getElementById('exclusion-count').textContent, ' (1 active)');
    chooseProfile(app, 'soundtracks');
    await app.scan();
    assert.deepEqual(reviewIds(app), ['2']);
    app.document.getElementById('modal-close').click();
    const input = app.document.getElementById('exclusions-textarea');
    input.value = '';
    input.dispatchEvent(new app.window.Event('input'));
    assert.equal(app.document.getElementById('exclusion-count').textContent, '');
    await app.scan();
    assert.deepEqual(reviewIds(app), ['1', '2']);
});

async function beginStoppableScan(t, rows, settings = {}) {
    let aborted = false;
    const app = await setup(t, (request, requests) => {
        if (request.method) return new Response('{"success":1}');
        if (requests.length === 1) return new Response(page(rows, '?offset=100'));
        return new Promise((resolve, reject) => {
            request.signal.addEventListener('abort', () => { aborted = true; reject(request.signal.reason); }, { once: true });
        });
    }, settings);
    app.document.getElementById('scan-button').click();
    await until(() => app.requests.length === 2);
    return Object.assign(app, { pageRequestAborted: () => aborted });
}

const useCollectedResults = async app => {
    app.document.getElementById('finish-scan-button').click();
    await until(() => !app.document.getElementById('working-status'));
};

test('stopping page collection aborts the pending page and permits removal only after ownership and confirmation', async t => {
    const app = await beginStoppableScan(t, [license(1, 'First Demo'), license(2, 'Second Demo')]);
    assert.equal(app.document.getElementById('scan-page-count').textContent, '1');
    assert.equal(app.document.getElementById('scan-match-count').textContent, '2');
    assert.equal(app.document.getElementById('finish-scan-button').disabled, false);
    app.setOwnership(() => new Response('{"rgOwnedPackages":[1,999]}'));
    await useCollectedResults(app);
    assert.equal(app.pageRequestAborted(), true);
    assert.equal(app.ownershipRequests[0].signal.aborted, false, 'ownership uses a separate signal from page collection');
    assert.deepEqual(reviewIds(app), ['1']);
    assert.match(app.document.getElementById('partial-scan-notice').textContent, /Partial scan.*1 completed page.*unscanned pages are not included/s);
    assert.match(app.document.getElementById('scan-summary').textContent, /Partial scan.*1 page.*1 match/);
    assert.equal(app.requests.filter(request => request.method).length, 0);
    app.document.getElementById('review-proceed-button').click();
    assert.match(app.document.querySelector('.modal-body').textContent, /Partial scan/);
    assert.equal(app.requests.filter(request => request.method).length, 0);
    [...app.document.querySelectorAll('button')].find(button => button.textContent === 'Yes, Clean Up').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
    assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['1']);
});

test('a partial scan can be reopened without requesting the same pages again', async t => {
    const app = await beginStoppableScan(t, [license(1, 'First Demo')]);
    await useCollectedResults(app);
    const count = app.requests.length;
    app.document.getElementById('modal-close').click();
    const review = app.document.getElementById('review-results-button');
    assert.equal(review.hidden, false);
    review.click();
    assert.deepEqual(reviewIds(app), ['1']);
    assert.ok(app.document.getElementById('partial-scan-notice'));
    assert.equal(app.requests.length, count);
    assert.equal(app.ownershipRequests.length, 1);
});

test('stopping during a page rate-limit wait verifies only the collected matches', async t => {
    const app = await setup(t, (request, requests) => requests.length === 1
        ? new Response(page([license(1, 'Collected Demo')], '?offset=100'))
        : new Response('', { status: 429 }));
    app.document.getElementById('scan-button').click();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 30000));
    await useCollectedResults(app);
    assert.deepEqual(reviewIds(app), ['1']);
    assert.ok(app.document.getElementById('partial-scan-notice'));
    assert.equal(app.requests.length, 2);
    assert.equal(app.timers.some(timer => timer.active && timer.delay === 30000), false);
});

test('stopping between pages cancels the page delay without requesting the next page', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Collected Demo')], '?offset=100')));
    const originalTimer = app.window.setTimeout;
    app.window.setTimeout = (callback, delay) => {
        if (delay !== 500) return originalTimer(callback, delay);
        const timer = { callback, delay, active: true };
        app.timers.push(timer);
        return timer;
    };
    app.document.getElementById('scan-button').click();
    await until(() => app.timers.some(timer => timer.active && timer.delay === 500));
    await useCollectedResults(app);
    assert.deepEqual(reviewIds(app), ['1']);
    assert.equal(app.requests.length, 1);
    assert.equal(app.timers.some(timer => timer.active && timer.delay === 500), false);
});

test('a partial scan never bypasses a failed ownership check', async t => {
    const app = await beginStoppableScan(t, [license(1, 'Collected Demo')]);
    app.setOwnership(() => new Response('', { status: 503 }));
    await useCollectedResults(app);
    assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Scan Failed');
    assert.equal(app.document.getElementById('review-proceed-button'), null);
    assert.equal(app.document.getElementById('review-results-button').hidden, true);
    assert.equal(app.requests.filter(request => request.method).length, 0);
});

test('discard remains available during ownership verification of collected results', async t => {
    const app = await beginStoppableScan(t, [license(1, 'Collected Demo')]);
    let aborted = false;
    app.setOwnership(request => new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => { aborted = true; reject(request.signal.reason); }, { once: true });
    }));
    app.document.getElementById('finish-scan-button').click();
    await until(() => app.ownershipRequests.length === 1);
    assert.equal(app.document.getElementById('finish-scan-button').disabled, true);
    app.document.getElementById('cancel-scan-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Scan Cancelled');
    assert.equal(aborted, true);
    assert.equal(app.document.getElementById('review-proceed-button'), null);
    assert.equal(app.document.getElementById('review-results-button').hidden, true);
});

test('use-collected is disabled until one full page has been parsed', async t => {
    const app = await setup(t, request => new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
    }));
    app.document.getElementById('scan-button').click();
    assert.equal(app.document.getElementById('finish-scan-button').disabled, true);
    assert.equal(app.document.getElementById('scan-page-count').textContent, '0');
    app.document.getElementById('finish-scan-button').click();
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].signal.aborted, false);
    app.document.getElementById('cancel-scan-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Scan Cancelled');
});

test('stopping after a page with no matches reports an empty partial scan', async t => {
    const app = await beginStoppableScan(t, [license(1, 'Unrelated Game')]);
    await useCollectedResults(app);
    assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Partial Scan');
    assert.match(app.document.querySelector('.modal-body').textContent, /1 completed page.*No removable licenses/s);
    assert.equal(app.document.getElementById('review-proceed-button'), null);
    assert.equal(app.document.getElementById('review-results-button').hidden, true);
});

test('verified demos keep type and ownership requirements when the scan stops early', async t => {
    const app = await setup(t, (request, requests) => requests.length === 1
        ? new Response(page([license(1, 'Verified Trial'), license(2, 'Misleading Demo'), license(3, 'Unknown Demo'), license(4, 'Unowned Trial')], '?offset=100'))
        : new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })), { verifiedDemosOnly: true });
    await importMetadata(app, metadataFiles([{ id: 10, type: 'Demo' }, { id: 20, type: 'Game' }, { id: 40, type: 'Demo' }], [
        { id: 1, apps: [10] }, { id: 2, apps: [20] }, { id: 4, apps: [40] }
    ]));
    app.setOwnership(() => new Response('{"rgOwnedPackages":[1,2,3,999]}'));
    app.document.getElementById('scan-button').click();
    await until(() => app.requests.length === 2);
    await useCollectedResults(app);
    assert.deepEqual(reviewIds(app), ['1']);
    assert.match(app.document.querySelector('.modal-body').textContent, /Skipped 1 packages containing non-demo apps and 1 packages with missing metadata/);
    assert.match(app.document.querySelector('.modal-body').textContent, /Skipped 1 packages not currently owned/);
});

test('partial review export explicitly records its scan coverage', async t => {
    const app = await beginStoppableScan(t, [license(1, 'Collected Demo')]);
    await useCollectedResults(app);
    let exported;
    app.window.URL.createObjectURL = blob => { exported = blob; return 'blob:test'; };
    app.window.URL.revokeObjectURL = () => {};
    app.window.HTMLAnchorElement.prototype.click = () => {};
    app.document.getElementById('export-review-button').click();
    const text = await new Promise(resolve => {
        const reader = new app.window.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(exported);
    });
    assert.match(text, /Partial scan: 1 completed page/);
    assert.match(text, /unscanned pages are not included/);
    assert.match(text, /Collected Demo/);
    assert.equal(app.requests.filter(request => request.method).length, 0);
});

test('changing a filter invalidates saved partial results and hides the reopen button', async t => {
    const app = await beginStoppableScan(t, [license(1, 'Collected Demo')]);
    await useCollectedResults(app);
    app.document.getElementById('modal-close').click();
    const input = app.document.getElementById('keywords-textarea');
    input.value = 'playtest'; input.dispatchEvent(new app.window.Event('input'));
    assert.equal(app.document.getElementById('review-results-button').hidden, true);
    assert.doesNotMatch(app.document.getElementById('scan-summary').textContent, /Partial scan/);
});

test('a completed scan is labelled full and can be reopened', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Full Demo')])));
    await app.scan();
    assert.equal(app.document.getElementById('partial-scan-notice'), null);
    assert.match(app.document.getElementById('scan-summary').textContent, /Full scan.*1 page/);
    app.document.getElementById('modal-close').click();
    app.document.getElementById('review-results-button').click();
    assert.deepEqual(reviewIds(app), ['1']);
    assert.equal(app.requests.length, 1);
});

test('stopping while the next page body is still loading uses only fully parsed pages', async t => {
    let bodyAborted = false;
    const app = await setup(t, (request, requests) => requests.length === 1
        ? new Response(page([license(1, 'Collected Demo')], '?offset=100'))
        : { ok: true, status: 200, text: () => new Promise((resolve, reject) => {
            request.signal.addEventListener('abort', () => { bodyAborted = true; reject(request.signal.reason); }, { once: true });
        }) });
    app.document.getElementById('scan-button').click();
    await until(() => app.requests.length === 2);
    await useCollectedResults(app);
    assert.equal(bodyAborted, true);
    assert.deepEqual(reviewIds(app), ['1']);
    assert.match(app.document.getElementById('partial-scan-notice').textContent, /1 completed page/);
});

test('discarding a scan with completed pages discards all collected results', async t => {
    const app = await beginStoppableScan(t, [license(1, 'Collected Demo')]);
    app.document.getElementById('cancel-scan-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Scan Cancelled');
    assert.equal(app.pageRequestAborted(), true);
    assert.equal(app.ownershipRequests.length, 0);
    assert.equal(app.document.getElementById('review-proceed-button'), null);
    assert.equal(app.document.getElementById('review-results-button').hidden, true);
    assert.doesNotMatch(app.document.getElementById('scan-summary').textContent, /Partial scan/);
});

for (const ids of [[0, 1], ['0', '1'], [0, -1, 4294967295, 4294967296, 1], ['-1', 0, 1]]) {
    test(`package ownership accepts unrelated integer entries without rejecting valid licenses: ${JSON.stringify(ids)}`, async t => {
        const app = await setup(t, request => request.method ? new Response('{"success":1}')
            : new Response(page([license(1, 'Owned Demo'), license(2, 'Not owned Demo')])));
        app.setOwnership(() => new Response(JSON.stringify({ rgOwnedPackages: ids })));
        await app.scan();
        assert.deepEqual(reviewIds(app), ['1']);
        assert.equal(app.document.getElementById('retry-ownership-button').hidden, true);
        app.remove();
        await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Cleanup Summary');
        assert.deepEqual(app.requests.filter(request => request.method).map(request => request.body.get('packageid')), ['1']);
    });
}

for (const invalid of [true, null, {}, [], 1.5, '1e0', '0x1', 9007199254740992]) {
    test(`ownership never coerces malformed entries into owned package IDs: ${JSON.stringify(invalid)}`, async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
        app.setOwnership(() => new Response(JSON.stringify({ rgOwnedPackages: [1, invalid] })));
        await app.scan();
        assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Scan Failed');
        assert.match(app.document.querySelector('.modal-body').textContent, /unexpected package entry at index 1/);
        assert.equal(app.document.getElementById('review-proceed-button'), null);
        assert.equal(app.requests.filter(request => request.method).length, 0);
    });
}

test('ownership requests allow Steam cookie refresh and bypass browser caching', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
    app.setOwnership(request => new Response(JSON.stringify({ rgOwnedPackages:
        request.credentials === 'include' && request.headers.Accept === 'text/html' ? [0, 1] : []
    })));
    await app.scan();
    assert.deepEqual(reviewIds(app), ['1']);
    assert.equal(app.ownershipRequests[0].cache, 'no-store');
    assert.ok(app.ownershipRequests[0].url.searchParams.has('_'));
});

for (const [data, reason] of [
    [{}, /did not return an rgOwnedPackages array/],
    [{ rgOwnedPackages: [] }, /empty rgOwnedPackages list/],
    [{ rgOwnedPackages: [true] }, /data-format error/]
]) {
    test('ownership errors distinguish missing, empty and malformed data', async t => {
        const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
        app.setOwnership(() => new Response(JSON.stringify(data)));
        await app.scan();
        assert.match(app.document.querySelector('.modal-body').textContent, reason);
        assert.match(app.document.querySelector('.modal-body').textContent, /Kept results from 1 completed page/);
    });
}

test('an HTML ownership response explains the session response and keeps collected pages', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
    app.setOwnership(() => new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }));
    await app.scan();
    assert.match(app.document.querySelector('.modal-body').textContent, /non-JSON response/);
    assert.equal(app.document.getElementById('retry-ownership-button').hidden, false);
    assert.equal(app.document.getElementById('review-proceed-button'), null);
});

test('a stopped scan retries ownership without reading the collected pages again', async t => {
    const app = await beginStoppableScan(t, [license(1, 'Owned Demo'), license(2, 'Not owned Demo')]);
    app.setOwnership((request, requests) => new Response(JSON.stringify({ rgOwnedPackages: requests.length === 1 ? [] : [0, 1] })));
    await useCollectedResults(app);
    assert.equal(app.document.querySelector('.modal-content h2').textContent, 'Scan Failed');
    assert.match(app.document.querySelector('.modal-body').textContent, /empty rgOwnedPackages list/);
    assert.equal(app.document.getElementById('review-results-button').hidden, true);
    assert.equal(app.document.getElementById('retry-ownership-button').hidden, false);
    assert.match(app.document.getElementById('scan-summary').textContent, /ownership not verified/);
    const pageRequests = app.requests.length;
    app.document.getElementById('retry-ownership-check').click();
    await until(() => app.document.getElementById('review-proceed-button'));
    assert.deepEqual(reviewIds(app), ['1']);
    assert.ok(app.document.getElementById('partial-scan-notice'));
    assert.equal(app.requests.length, pageRequests);
    assert.equal(app.ownershipRequests.length, 2);
    assert.equal(app.document.getElementById('retry-ownership-button').hidden, true);
    assert.equal(app.requests.filter(request => request.method).length, 0);
});

test('a full scan can retry ownership from the main panel after closing the error', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
    app.setOwnership((request, requests) => requests.length === 1 ? new Response('', { status: 503 }) : new Response('{"rgOwnedPackages":[0,1]}'));
    await app.scan();
    app.document.getElementById('modal-close').click();
    app.document.getElementById('retry-ownership-button').click();
    await until(() => app.document.getElementById('review-proceed-button'));
    assert.deepEqual(reviewIds(app), ['1']);
    assert.equal(app.document.getElementById('partial-scan-notice'), null);
    assert.equal(app.requests.length, 1);
    assert.equal(app.ownershipRequests.length, 2);
});

test('repeated ownership failures retain the same snapshot without enabling removal', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
    let available = false;
    app.setOwnership(() => new Response(JSON.stringify({ rgOwnedPackages: available ? [0, 1] : [] })));
    await app.scan();
    app.document.getElementById('retry-ownership-check').click();
    await until(() => app.document.getElementById('retry-ownership-check'));
    assert.equal(app.ownershipRequests.length, 2);
    assert.equal(app.document.getElementById('review-proceed-button'), null);
    available = true;
    app.document.getElementById('retry-ownership-check').click();
    await until(() => app.document.getElementById('review-proceed-button'));
    assert.deepEqual(reviewIds(app), ['1']);
    assert.equal(app.requests.length, 1);
    assert.equal(app.ownershipRequests.length, 3);
});

test('filter changes invalidate unverified collected pages and prevent a stale ownership retry', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
    app.setOwnership(() => new Response('{"rgOwnedPackages":[]}'));
    await app.scan();
    const input = app.document.getElementById('keywords-textarea');
    input.value = 'beta'; input.dispatchEvent(new app.window.Event('input'));
    assert.equal(app.document.getElementById('retry-ownership-button').hidden, true);
    app.document.getElementById('retry-ownership-check').click();
    assert.equal(app.ownershipRequests.length, 1);
    assert.equal(app.document.getElementById('review-proceed-button'), null);
});

test('discarding a pending ownership retry clears its collected snapshot', async t => {
    const app = await setup(t, () => new Response(page([license(1, 'Demo')])));
    app.setOwnership(() => new Response('{"rgOwnedPackages":[]}'));
    await app.scan();
    app.setOwnership(request => new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
    }));
    app.document.getElementById('retry-ownership-check').click();
    await until(() => app.ownershipRequests.length === 2);
    app.document.getElementById('cancel-scan-button').click();
    await until(() => app.document.querySelector('.modal-content h2')?.textContent === 'Scan Cancelled');
    assert.equal(app.document.getElementById('retry-ownership-button').hidden, true);
    assert.equal(app.document.getElementById('review-results-button').hidden, true);
    assert.equal(app.document.getElementById('review-proceed-button'), null);
    assert.equal(app.requests.length, 1);
});
