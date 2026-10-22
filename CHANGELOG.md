# Changes

## 2.0.0 (in development)

- Add cleanup profiles for verified demos, playtests and test versions, videos, soundtracks, custom name filters, and all removable licenses.
- Add search, sorting, selection of visible results, and export before removal.
- Start scans without inclusion filters with nothing selected.
- Show the configured waiting time before confirming cleanup; edit delays in minutes.
- Allow cancellation during scanning, including requests and rate-limit waits.
- Offer folder selection for importing Steam metadata in supporting browsers.
- Require a new scan after changing settings, dates, profiles, or metadata.
- Recheck ownership before later packages after the configured wait.
- Reject incomplete application records and malformed IDs during demo verification.
- Validate saved settings and calendar dates; retain existing filters and delays on upgrade.
- Improve keyboard navigation, dialog labels, narrow layouts, and reduced-motion support.
- Split source files by responsibility and generate one installable userscript with a dependency-free build script.
- Point development installation and update URLs at the development branch.

The fork also retains the earlier cursor-pagination fixes, current package-ownership checks, local Steam metadata verification, confirmed-result reporting, duplicate-request handling, and progressive rate-limit cooldowns.
