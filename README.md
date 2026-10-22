# Steam License Cleanup 2.0

A userscript for reviewing and removing unwanted free Steam licenses from your [account licenses page](https://store.steampowered.com/account/licenses/).

Choose a cleanup profile, scan all license pages, then review the results before confirming removal. The review supports search, sorting, and exporting selected entries without removing them.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).
2. [Install the development version](https://raw.githubusercontent.com/ajsem1337/Steam-License-Cleanup/fix/steam-license-pagination/Steam-License-Cleanup.user.js).
3. Open your [Steam account licenses](https://store.steampowered.com/account/licenses/) while signed in.

This development build installs and updates from `fix/steam-license-pagination`. Keep only one copy enabled. Existing filters, exclusions, and delays are preserved when upgrading.

## Cleanup profiles

- **Verified demos** (default): checks application types using imported Steam metadata.
- **Playtests / beta / alpha**, **Trailers / videos**, **Soundtracks**: ready-made name filters, without application-type verification.
- **Custom name filters**: uses your inclusion phrases from **Settings**. Empty inclusions match all otherwise eligible licenses.
- **All removable licenses**: no inclusion filter; dates and exclusions still apply.

Exclusions apply to every profile. Saved exclusions may prevent a preset from finding a matching license.

## Remove demos

1. Restart Steam while online to refresh its local metadata.
2. Choose **Verified demos**. This is the default profile.
3. Click **Import Steam metadata** and select both `appinfo.vdf` and `packageinfo.vdf` from Steam's `appcache` folder. Browsers with folder selection also offer **Choose appcache folder**.
4. Optionally set acquisition dates or exclusions in **Settings**. Leave dates empty to scan all dates.
5. Click **Scan for Removable Licenses**.
6. Review the results, uncheck anything you want to keep, then click **Remove Selected** and confirm.

Typical metadata locations (custom Steam installations may use another path):

| System | `appcache` folder |
| --- | --- |
| Linux | `~/.local/share/Steam/appcache/` or `~/.steam/steam/appcache/` |
| Linux, Flatpak | `~/.var/app/com.valvesoftware.Steam/.local/share/Steam/appcache/` |
| Windows | `C:\Program Files (x86)\Steam\appcache\` |
| macOS | `~/Library/Application Support/Steam/appcache/` |

The files are read locally in the current browser tab. They are not uploaded or modified. Import them again after refreshing the page; settings are saved separately in your browser.

## What gets selected

Every profile requires Steam's free-license **Remove** link and a current ownership check with Steam. An entry in the license history alone does not qualify.

- **Verified demos (default):** every application in the package must have type `Demo` in the imported metadata. Mixed packages, other application types, and missing or ambiguous metadata are skipped. Inclusion keywords are ignored; exclusions apply to package and application names.
- **Other profiles:** select licenses by name or include all removable licenses. They do not verify application types.

Date filters apply to every profile. A failed or cancelled scan does not offer a partial list. Changing filters or importing metadata requires a new scan before removal.

Verification depends on the imported cache, which may be outdated or incomplete. The script uses Steam's free-license removal endpoint, rather than the paid-purchase removal workflow. Review every selection; the script does not provide an undo function.

## During cleanup

- The default delay is **10 minutes between removals**, configurable in **Settings** in minutes. Confirmation shows the total configured waiting time.
- Steam rate limits pause the queue automatically. Repeated limits increase the wait from 3 minutes to at most 30 minutes; a longer server-requested wait is respected. The status displays the next retry time. A pause does not guarantee Steam's limit has reset.
- Keep the tab open. Refreshing or closing it discards the queue.
- **Cancel** interrupts waits and pending browser requests. Steam may still complete a request it already received; scan again before restarting.
- Other errors or conflicting ownership results stop cleanup. The summary separates confirmed removals from skipped entries and can be exported as `.txt`.

In the review, **Select visible** and **Deselect visible** affect only rows matching the search. Export and removal include all selected rows, including hidden ones. Scans without an inclusion filter start with nothing selected. **Cancel scan** stops scanning without removing anything.

If scanning or ownership checks fail, check that you are signed in to the Steam Store and scan again. If metadata import fails, refresh the Steam cache and select both files together.

## Development

Use a Node.js version matching `package.json`: `^22.22.2 || ^24.15.0 || >=26.0.0`.

```sh
npm ci
npm run build
npm run check
npm test
```

Tests simulate Steam pages, responses, and binary metadata files using jsdom. They cover pagination, filters, metadata verification, ownership changes, confirmation, removal errors, rate limits, and cancellation. They do not access a real Steam account or remove real licenses.

Edit `src/`, then run `npm run build` to regenerate the installable userscript. `npm run check` verifies syntax and checks that the generated file matches the sources. No build tools are required to install the script.

Supported metadata formats: `appinfo.vdf` versions 39–41 and `packageinfo.vdf` versions 39–40. A parser reference is linked in `src/metadata.js`. See [changes in 2.0](CHANGELOG.md).

## Credits and license

Based on [PatrickJnr/Steam-License-Cleanup](https://github.com/PatrickJnr/Steam-License-Cleanup), with contributions credited to @retvil, @TCNOco, @RavenStryker, and @KAURkulaator.

[MIT License](LICENSE).
