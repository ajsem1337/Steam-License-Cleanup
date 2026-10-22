<div align="center">

# 🔰 Steam License Cleanup 🔰

![Version](https://img.shields.io/badge/version-1.8.0-blue?style=for-the-badge)![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)![Compatible](https://img.shields.io/badge/Tampermonkey-Compatible-brightgreen?style=for-the-badge)

</div>

> The ultimate tool for managing your Steam account licenses. This script transforms the default licenses page into a powerful management utility, allowing you to safely clean up unwanted items like demos, betas, and old trailers.

This fork fixes scanning on Steam's cursor-paginated license page. Scans start from the first page, including when you open the script on a later page, and follow Steam's actual Next links. Pages with no matches do not stop the scan. A failed or incomplete scan shows an error instead of offering a partial list for removal.

The script selects licenses with Steam's **Remove** link, applies your name and date filters, and lets you review the list before confirming removal. A free license can grant access to a full game or DLC, so review the selected products as well as their names.

---

### 📸 Screenshots Gallery

<details>
<summary><strong>Click here to see the script in action</strong></summary>
<br>

**1. Main Controls & Settings**
<br>
*The script adds clean, intuitive controls to your licenses page, including new date filters. The settings modal allows for powerful filtering with keywords and a configurable removal delay.*

<img width="372" alt="New buttons on the license page" src="https://github.com/user-attachments/assets/5a917edc-2543-4d42-9eb8-e3e4276646f5" />
<img width="862" alt="Settings modal with keywords and exclusions" src="https://github.com/user-attachments/assets/66c70741-7d19-46ac-a909-78df316bc86b" />

<br>

**2. Interactive Review & Confirmation**
<br>
*After scanning, you get an interactive list of all found licenses. Uncheck any you wish to keep before proceeding to the final, safe confirmation step. I added games in bulk using SteamDB Free Package Adder, so you can see the script in action*
<img width="862" alt="Interactive review list of found licenses" src="https://github.com/user-attachments/assets/24b4bcc9-1fc4-46ae-9dd9-abc1b1e4a18e" />
<img width="862" alt="Final confirmation prompt before removal" src="https://github.com/user-attachments/assets/d5ad9cd8-5822-4cf2-9785-5ceb3b4bd131" />

</details>

---

## ✨ Key Features

| Feature                          | Description                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 **Removable Licenses Only**     | Selects only licenses with Steam's free-license removal link. Products without that link are skipped. |
| 📅 **Date Range Filtering**        | Target licenses acquired within a specific timeframe. Perfect for cleaning up items from a specific year or event.                                       |
| 🔎 **Comprehensive Scanning**      | Automatically scans **all pages** of your licenses, finding every match based on your keywords and selected date range.                                  |
| ✅ **Interactive Review**     | After scanning, you are presented with a detailed list of matches. **Nothing is removed without your final approval.**                      |
| 🛡️ **Exclusion Filtering**       | Protect specific licenses using an **exclusion list**. An item will be ignored even if it matches your main keywords (e.g., keep a specific "beta"). |
| ⏱️ **Configurable Delay**         | Set a custom delay between each removal (e.g., 10 minutes) to proactively avoid Steam's API rate limits, ensuring a smooth cleanup.                     |
| 💾 **Persistent Settings**         | Configure your keywords and delay once. The script saves your preferences locally in your browser so they are ready for your next session.                     |
| 📊 **Progress and Control**      | A dynamic progress bar shows the status of removals, and a **Cancel** button lets you safely abort the process at any time.                            |
| ⚙️ **Smart Rate-Limit Handling** | Automatically detects when Steam's API limit is hit, pauses the process, and resumes when it's safe to continue.                                          |
| 📄 **Summary & Export**            | After cleaning, view a detailed summary of removed licenses. You can **export this list to a `.txt` file** for your personal records.                         |


---

## 🚀 Installation

1.  **Install a Userscript Manager:** You need a browser extension to manage userscripts. [**Tampermonkey**](https://www.tampermonkey.net/) is highly recommended.
2.  **Install the Script:** **[Click this link to install](https://raw.githubusercontent.com/ajsem1337/Steam-License-Cleanup/main/Steam-License-Cleanup.user.js)**.
3.  **Confirm Installation:** Your userscript manager will open a new tab and prompt you to install the script. Click `Install`.

If you already installed the original script, this version keeps its name and namespace so your userscript manager can update it. Ensure only one copy is enabled. Updates for this fork are downloaded from `ajsem1337/Steam-License-Cleanup`; existing local settings are preserved.

### Remove demos only

In **Settings**, set **Inclusion Keywords** to `demo`, leave the date fields empty, save, and scan. This matches the word in license names; demos without that word need separate selection. Keywords and exclusions are literal text, including punctuation such as `(Soundtrack)`.

The existing default delay is **600000 ms (10 minutes)** between removals. For hundreds of demos you can set a shorter delay, for example **2000 ms**. Steam can still rate limit requests; the script waits and retries rather than assuming that an error means a license was removed.

---

## 📖 How to Use: The Safe Workflow

1.  Navigate to your [**Steam Account Licenses Page**](https://store.steampowered.com/account/licenses/).
2.  **(Optional)** Select a **Start Date** and/or **End Date** to limit the scan to a specific period.
3.  **(Optional)** Click `⚙️ Settings` to customize your **Inclusion** keywords (e.g., `demo, beta`), **Exclusion** keywords, and the new **Removal Delay**.
4.  Click the `🔎 Scan for Removable Licenses` button to begin.
5.  Once the scan is complete, the **Interactive Review** modal will appear.
6.  **Review the list carefully.** Uncheck any licenses you want to keep.
7.  Click the `Remove Selected (...)` button, and approve the final confirmation prompt.
8.  The cleanup will begin. You can click `Cancel` at any point to stop the process.
9.  When finished, a summary modal will detail all removed licenses. From here, you can `Export` the list or `Refresh` the page.

---

## ❓ Frequently Asked Questions

<details>
<summary><strong>Can this script remove my paid games or DLC?</strong></summary>
<br>
The script only selects licenses that expose Steam's <strong>Remove</strong> link for free-license removal. It does not use the paid-purchase removal workflow. Some free licenses grant full games or DLC, so check the review list before confirming.
</details>

<details>
<summary><strong>Is the license removal permanent?</strong></summary>
<br>
Yes. This script uses Steam's own license removal function. Once a free license is removed, it is gone from your account permanently. The multi-step review and confirmation process is designed to prevent accidental removals.
</details>

<details>
<summary><strong>Can I remove all license within a date range?</strong></summary>
<br>
Yes. If inclusion keywords are empty, the scan selects all removable licenses within the optional date range except those matching exclusions. Clear exclusions too if you want no name filtering.
</details>

<details>
<summary><strong>How does the script identify licenses to remove?</strong></summary>
<br>
The script scans license names for your <strong>inclusion keywords</strong> (e.g., "demo", "beta") that were acquired within the optional <strong>date range</strong> you've set. If a name also contains one of your <strong>exclusion keywords</strong>, it will be ignored, giving you fine-grained control. If you leave all keyword fields empty, it will select *all* removable licenses within the date range.
</details>

<details>
<summary><strong>What is the delay between removals for?</strong></summary>
<br>
To prevent your account from being temporarily locked out of making changes, the script includes a configurable delay (defaulting to 10 minutes) between each removal. This is a crucial safety feature to avoid Steam's API rate limits, especially when removing many items. You can adjust this value in the <strong>Settings</strong> modal if you wish.
</details>

<details>
<summary><strong>What happens if I encounter a rate limit?</strong></summary>
<br>
The script handles both HTTP 429 and Steam result 84, waiting at least 30 seconds and increasing the delay on repeated limits. A longer <code>Retry-After</code> value is respected up to five minutes. After four unsuccessful attempts it stops and reports the error. Only Steam success result 1 is counted as a confirmed removal. Other HTTP, network, or Steam errors stop the cleanup; rescan before trying again.

<p><strong>Cancel</strong> interrupts the current wait or pending browser request. A request already received by Steam may still finish, so rescan before restarting. The summary counts only confirmed removals.</p>
</details>

<details>
<summary><strong>Can I trust this script with my account?</strong></summary>
<br>
Yes. The script is open-source and runs entirely within your browser. It does not send your data anywhere except to Steam's own servers, exactly as if you were clicking the remove button yourself. It cannot see your password or perform any other actions.
</details>

---

### 💡 Troubleshooting & Contributing

-   **Troubleshooting:** If the script isn't working, first ensure you are fully logged into `store.steampowered.com`. If problems persist, open your browser's developer console (F12) to check for errors.
-   **Contributing:** Suggestions and contributions are welcome! Please feel free to submit a pull request on the [**fork repository**](https://github.com/ajsem1337/Steam-License-Cleanup).

### Development checks

Use Node.js 26 or later (jsdom also supports Node.js 22.22.2+ and 24.15.0+):

```sh
npm ci
npm run check
npm test
```

Tests run the userscript in jsdom against simulated Steam license pages and responses. They cover cursor pagination, pages without matches, duplicate packages, name/date filters, failed scans, review and confirmation, Steam errors, rate limits, and cancellation. They do not sign in to Steam or remove real licenses.

### ❤️ Credits
-   Original script: [PatrickJnr/Steam-License-Cleanup](https://github.com/PatrickJnr/Steam-License-Cleanup)
-   @retvil
-   @TCNOco
-   @RavenStryker
-   @KAURkulaator

