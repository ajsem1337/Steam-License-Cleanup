# Changes

## 2.0.0 — 2026-10-23

- Add cleanup profiles for verified demos, playtests and test versions, videos, soundtracks, custom name filters, and all removable licenses.
- Add search, sorting, selection of visible results, and export before removal.
- Start scans without inclusion filters with nothing selected.
- Show the configured waiting time before confirming cleanup; edit delays in minutes.
- Keep delay and custom filters in the main panel, with automatic saving and collapsible exclusions; remove the separate Settings dialog.
- Redesign the workspace as a responsive card layout, with consistent review rows, scan counters, status, and actions.
- Stop scans early with **Use collected results**, verify ownership, and review or export clearly labelled partial results.
- Reopen collected results without repeating a scan; keep **Discard scan** separate from stopping with results.
- Fix ownership validation for integer package entries and numeric strings, request Steam's session-refresh flow, and report distinct ownership response errors.
- Keep collected pages after ownership-check failures and retry verification without rescanning or enabling unverified removal.
- Allow cancellation during scanning, including requests and rate-limit waits.
- Offer folder selection for importing Steam metadata in supporting browsers.
- Require a new scan after changing settings, dates, profiles, or metadata.
- Recheck ownership before later packages after the configured wait.
- Reject incomplete application records and malformed IDs during demo verification.
- Validate saved settings and calendar dates; retain existing filters and delays on upgrade.
- Improve keyboard navigation, dialog labels, narrow layouts, and reduced-motion support.
- Split source files by responsibility and generate one installable userscript with a dependency-free build script.
- Publish installation and automatic updates from `main`.
- Disclose AI use in this fork's README.

The fork also retains the earlier cursor-pagination fixes, current package-ownership checks, local Steam metadata verification, confirmed-result reporting, duplicate-request handling, and progressive rate-limit cooldowns.
