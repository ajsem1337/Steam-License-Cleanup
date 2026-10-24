# Steam License Cleanup 2.0

![Made with AI](https://img.shields.io/badge/Made%20with-AI-76ddcf)

A userscript for reviewing and removing unwanted free Steam licenses from your [account licenses page](https://store.steampowered.com/account/licenses/).

Choose a cleanup profile, scan licenses, then review the results before confirming removal. The panel groups profile and verification controls beside scan range and removal pace. The review supports search, sorting, and exporting selected entries without removing them.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).
2. [Install Steam License Cleanup](https://raw.githubusercontent.com/ajsem1337/Steam-License-Cleanup/main/Steam-License-Cleanup.user.js).
3. Open your [Steam account licenses](https://store.steampowered.com/account/licenses/) while signed in.

Installation and updates use `main`. Keep only one copy enabled. Existing filters, exclusions, and delays are preserved when upgrading.

Report problems in [Issues](https://github.com/ajsem1337/Steam-License-Cleanup/issues), including your browser, userscript manager, selected profile, and steps to reproduce.

## Cleanup profiles

- **Verified demos** (default): checks application types using imported Steam metadata.
- **Playtests / beta / alpha**, **Trailers / videos**, **Soundtracks**: ready-made name filters, without application-type verification.
- **Custom name filters**: enter your own inclusion phrases directly below the profile. Empty inclusions match all otherwise eligible licenses.
- **All removable licenses**: no inclusion filter; dates and exclusions still apply.

**Keep matching licenses** holds exclusions for every profile. Saved exclusions remain active and are shown with a count. Changes save automatically.

## Remove demos

1. Restart Steam while online to refresh its local metadata.
2. Choose **Verified demos**. This is the default profile.
3. Click **Select metadata files** and select both `appinfo.vdf` and `packageinfo.vdf` from Steam's `appcache` folder. Browsers with folder selection also offer **Choose folder**.
4. Optionally set acquisition dates or expand **Keep matching licenses** to add exclusions. Leave dates empty to scan all dates.
5. Click **Scan licenses**. Let it finish, or choose **Use collected results** after at least one page has been scanned.
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

Date filters apply to every profile. **Use collected results** stops fetching pages and checks ownership of licenses from completed pages. These results are labelled **Partial scan** in the review, confirmation, and exported report. **Discard scan** discards the results. If a later page fails, only fully parsed pages are kept; explicitly choose **Use completed pages** to verify their ownership and review a partial scan. The failed page is never included, and an incomplete first page cannot be recovered. An ownership-check error keeps collected pages for **Retry ownership check**; removal stays unavailable until verification succeeds. Changing filters or importing metadata requires a new scan before removal.

Verification depends on the imported cache, which may be outdated or incomplete. The script uses Steam's free-license removal endpoint, rather than the paid-purchase removal workflow. Review every selection; the script does not provide an undo function.

### Scan counts and ownership verification

The scanner shows **pages scanned** and **candidates found**. Candidates are unique packages that already passed the profile, metadata (when required), date, and exclusion filters. They are not yet confirmed as currently owned.

When page collection finishes or you choose **Use collected results**, the dialog switches to ownership checking. The review shows a balance of **candidates collected**, **ownership confirmed**, and **without ownership confirmation**. For example, 1200 candidates can become 495 confirmed licenses and 705 without confirmation. Metadata rejects are not counted again in this balance. After cleanup, confirmed removals appear in a separate counter rather than remaining available for removal.

Only candidates listed in Steam's `rgOwnedPackages` response are available for removal. An absent package ID does not establish whether that response is complete; the script does not claim that all unconfirmed candidates are definitely no longer owned.

Collected candidates remain in the current tab even if none receive ownership confirmation. **Review results** reopens their summary, and **Retry ownership check** can check them again without fetching the license pages (unless cleanup was stopped by an error or cancellation). In the review's **Scan details**, use **Inspect all candidates** to see package IDs and statuses: pending review/removal, removed, skipped, or uncertain. Inspection is also available when ownership checking fails or confirms zero candidates. Diagnostic entries cannot be selected for removal, and a confirmed removal is never queued again by rechecking that collected scan.

The review offers separate **Export selected** and **Export diagnostic report (all candidates)** actions. The selected export states how many entries it contains. The diagnostic report includes all candidates, their individual statuses, and a separate metadata-rejection section. **Inspect missing metadata** explains which package, application, or application type is missing or ambiguous; these rejects are never counted as candidates.

## During cleanup

- Set **Minutes between removals** in the main panel (default: **10**). Confirmation shows the total configured waiting time. Changing the delay does not require another scan.
- Steam rate limits pause the queue automatically. Repeated limits increase the wait from 3 minutes to at most 30 minutes; a longer server-requested wait is respected. The status displays the next retry time. A pause does not guarantee Steam's limit has reset.
- Keep the tab open. Refreshing or closing it discards the queue.
- **Cancel** interrupts waits and pending browser requests. Steam may still complete a request it already received; scan again before restarting.
- Other errors or conflicting ownership results stop cleanup. After an error or cancellation, old selections are revoked and a new **Scan licenses** run is required before further removal; an ownership-only retry cannot bypass this. **Inspect collected data** remains available for diagnostics.
- The summary separates confirmed removals from skipped entries and can be exported as `.txt`. Its report remains tied to that cleanup run, even if the workspace is scanned again. Malformed removal result values are never treated as confirmation.

In the review, **Select visible** and **Deselect visible** affect only rows matching the search. Selected export and removal include all selected rows, including hidden ones. Scans without an inclusion filter start with nothing selected. Use **Review results** to reopen the last results without scanning again; they remain available in the current tab until you change filters or start another scan. Removed and skipped entries are excluded from the actionable list. If no candidates remain after cleanup, the summary reports the cleanup outcomes rather than claiming no licenses were found.

If ownership checking fails, **Retry ownership check** verifies the collected pages without scanning again. The error distinguishes empty, missing, or malformed ownership data from a non-JSON session response. If needed, open your Steam Store account to refresh its session before retrying. If metadata import fails, refresh the Steam cache and select both files together.

## Development

Use a Node.js version matching `package.json`: `^22.22.2 || ^24.15.0 || >=26.0.0`.

```sh
npm ci
npm run build
npm run check
npm test
```

Tests simulate Steam pages, responses, and binary metadata files using jsdom. They cover pagination, filters, metadata verification, ownership changes, confirmation, removal errors, rate limits, partial scans, reopening results, cancellation, candidate diagnostics, recovery after zero ownership overlap, post-cleanup states, malformed result values, keyboard focus, and explicit recovery after page errors. A regression test checks 269 pages with 1200 candidates and 495 confirmed licenses. They do not access a real Steam account or remove real licenses.

Edit `src/`, then run `npm run build` to regenerate the installable userscript. `npm run check` verifies syntax and checks that the generated file matches the sources. No build tools are required to install the script.

Supported metadata formats: `appinfo.vdf` versions 39–41 and `packageinfo.vdf` versions 39–40. A parser reference is linked in `src/metadata.js`. See [changes in 2.0](CHANGELOG.md).

## Credits and license

Based on [PatrickJnr/Steam-License-Cleanup](https://github.com/PatrickJnr/Steam-License-Cleanup), with contributions credited to @retvil, @TCNOco, @RavenStryker, and @KAURkulaator.

[MIT License](LICENSE).

## AI assistance

**Made with AI.** This project was developed with AI assistance, including code, documentation, and testing.
