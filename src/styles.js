// Styles are scoped to the workspace and its dialogs so Steam's page stays intact.
const addGlobalStyle = () => {
    const style = document.createElement('style');
    style.textContent = `
        #cleanup-controls, .slc-dialog {
            --steam-blue: #76ddcf; --steam-blue-hover: #a1f0e6; --steam-dark: #111c2a;
            --steam-light-text: #bac9da; --steam-white-text: #f0f5fb;
            --steam-error: #ff8b8b; --steam-warning: #edc37f;
            --slc-muted: #8d9fb6; --slc-border: #2a3a4f; --slc-field: #101b2a;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px; line-height: 1.5; color: var(--steam-light-text); color-scheme: dark;
        }
        #cleanup-controls *, .slc-dialog * { box-sizing: border-box; }
        #cleanup-controls [hidden], .slc-dialog [hidden] { display: none !important; }
        #cleanup-controls { background: #101a28; border: 1px solid #334358; border-radius: 16px; margin: 0 0 28px; overflow: hidden; text-align: left; box-shadow: 0 18px 50px #0003; }
        #cleanup-controls h2, #cleanup-controls h3, .slc-dialog h2 { color: var(--steam-white-text); font-weight: 650; line-height: 1.3; }
        #cleanup-controls p, .slc-dialog p { margin: 0 0 12px; }
        #cleanup-controls .slc-header { display: flex; gap: 20px; justify-content: space-between; align-items: center; padding: 26px 28px 22px; }
        #cleanup-controls .slc-brand { display: flex; align-items: center; gap: 14px; }
        #cleanup-controls .slc-brand-icon { width: 46px; height: 46px; display: grid; place-items: center; background: #76ddcf10; border: 1px solid #76ddcf35; border-radius: 12px; color: var(--steam-blue); flex-shrink: 0; }
        #cleanup-controls svg { width: 25px; height: 25px; }
        #cleanup-controls .slc-eyebrow { display: block; font-size: 10px; letter-spacing: 1.7px; font-weight: 700; color: var(--slc-muted); }
        #cleanup-controls h2 { font-size: 22px; margin: 3px 0 0; letter-spacing: -.4px; }
        #cleanup-controls .slc-version { display: inline-block; vertical-align: middle; font-size: 11px; padding: 3px 7px; border: 1px solid var(--slc-border); border-radius: 5px; color: var(--slc-muted); letter-spacing: 0; margin-left: 5px; }
        #cleanup-controls .slc-status { display: flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap; color: #b9d7d3; }
        #cleanup-controls .slc-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--steam-blue); box-shadow: 0 0 0 4px #76ddcf10; }
        #cleanup-controls .slc-steps { list-style: none; display: flex; padding: 0 28px 19px; margin: 0; gap: 28px; border-bottom: 1px solid var(--slc-border); }
        #cleanup-controls .slc-steps li { display: flex; align-items: center; gap: 8px; color: var(--slc-muted); font-size: 12px; }
        #cleanup-controls .slc-steps li > span { font-size: 10px; font-weight: 700; border: 1px solid var(--slc-border); border-radius: 50%; padding: 3px 5px; }
        #cleanup-controls[data-stage="configure"] [data-step="configure"], #cleanup-controls[data-stage="scanning"] [data-step="scanning"], #cleanup-controls[data-stage="review"] [data-step="review"], #cleanup-controls[data-stage="cleaning"] [data-step="review"] { color: var(--steam-blue); }
        #cleanup-controls .slc-workspace { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); align-items: start; gap: 18px; padding: 22px 28px; }
        #cleanup-controls .slc-main, #cleanup-controls .slc-sidebar { display: grid; gap: 18px; min-width: 0; }
        #cleanup-controls .slc-panel { background: #162232; border: 1px solid var(--slc-border); border-radius: 11px; padding: 20px; min-width: 0; }
        #cleanup-controls .slc-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
        #cleanup-controls .slc-panel h3 { margin: 0; font-size: 15px; }
        #cleanup-controls .slc-panel-description { font-size: 12px; color: var(--slc-muted); margin-bottom: 18px; }
        #cleanup-controls label, .slc-dialog label[for] { display: block; font-size: 12px; font-weight: 600; color: #c9d6e7; margin-bottom: 7px; }
        #cleanup-controls input, #cleanup-controls select, #cleanup-controls textarea, .slc-dialog input:not([type="checkbox"]), .slc-dialog select {
            font: inherit; color: var(--steam-white-text); background: var(--slc-field); border: 1px solid #374b63; border-radius: 7px; padding: 10px 11px; width: 100%; min-width: 0;
        }
        #cleanup-controls select, .slc-dialog select { cursor: pointer; }
        #cleanup-controls select { font-size: 14px; min-height: 44px; }
        #cleanup-controls input::placeholder, #cleanup-controls textarea::placeholder, .slc-dialog input::placeholder { color: #7e91aa; }
        #cleanup-controls .slc-description { font-size: 12px; color: #9fb2c9; margin: 10px 0 0; }
        #cleanup-controls .date-range-container { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        #cleanup-controls input[type="date"] { font-size: 12px; padding: 9px; }
        #cleanup-controls .removal-delay label { margin-top: 0; }
        #cleanup-controls .removal-delay input { width: 100%; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
        #cleanup-controls #delay-help { margin: 9px 0 0; font-size: 12px; color: var(--slc-muted); }
        #cleanup-controls #delay-error { margin: 8px 0 0; font-size: 12px; color: var(--steam-warning); }
        #cleanup-controls #delay-error:empty { display: none; }
        #cleanup-controls [aria-invalid="true"] { border-color: var(--steam-warning); }
        #cleanup-controls #custom-filters { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--slc-border); }
        #cleanup-controls textarea { resize: vertical; min-height: 88px; font-size: 13px; }
        #cleanup-controls #custom-filters p { margin: 7px 0 0; font-size: 12px; color: var(--slc-muted); }
        #cleanup-controls #exclusion-options { margin-top: 17px; padding-top: 13px; border-top: 1px solid var(--slc-border); }
        #cleanup-controls #exclusion-options summary { cursor: pointer; font-size: 12px; color: #c9d6e7; }
        #cleanup-controls #exclusion-options label { margin-top: 13px; font-weight: 400; }
        #cleanup-controls #exclusion-count { color: var(--steam-blue); }
        #cleanup-controls .slc-badge, .slc-dialog .slc-badge { display: inline-flex; align-items: center; border: 1px solid #d8b87540; border-radius: 5px; padding: 3px 7px; font-size: 10px; font-weight: 600; color: var(--steam-warning); white-space: nowrap; }
        #cleanup-controls .slc-badge[data-ready="true"], .slc-dialog .slc-badge.slc-verified { color: var(--steam-blue); border-color: #76ddcf35; background: #76ddcf0a; }
        #cleanup-controls .slc-import-note { display: flex; gap: 11px; padding: 16px; border: 1px dashed #3b536b; border-radius: 8px; background: #101b2a70; }
        #cleanup-controls .slc-import-note > span { color: var(--steam-blue); padding-top: 2px; }
        #cleanup-controls .slc-import-note p { margin: 0; font-size: 12px; color: var(--slc-muted); }
        #cleanup-controls .slc-import-note strong { color: #d6e2f1; font-weight: 500; }
        #cleanup-controls .slc-import-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 13px; }
        #cleanup-controls #metadata-status { font-size: 12px; margin: 14px 0 6px; color: #bdccdd; overflow-wrap: anywhere; }
        #cleanup-controls .slc-fineprint, .slc-dialog .slc-fineprint { font-size: 11px; color: var(--slc-muted); margin-bottom: 0; }
        #cleanup-controls .slc-actionbar { padding: 18px 28px; background: #0d1724; border-top: 1px solid var(--slc-border); display: flex; align-items: center; justify-content: space-between; gap: 18px; }
        #cleanup-controls .slc-actionbar p { font-size: 12px; margin: 4px 0 0; }
        #cleanup-controls .slc-main-actions { display: flex; gap: 8px; flex-shrink: 0; }
        #cleanup-controls .steam-cleanup-button, .slc-dialog .steam-cleanup-button {
            font: inherit; font-size: 12px; font-weight: 600; line-height: 1.4; color: #cfdeef; background: #213348; border: 1px solid #3b516b; border-radius: 7px; padding: 10px 14px; cursor: pointer; transition: background .15s, border-color .15s;
        }
        #cleanup-controls .steam-cleanup-button:hover, .slc-dialog .steam-cleanup-button:hover { background: #2b425c; border-color: #6382a1; }
        #cleanup-controls .slc-primary, .slc-dialog .slc-primary, .slc-dialog #review-proceed-button { color: #092b2b; background: var(--steam-blue); border-color: var(--steam-blue); }
        #cleanup-controls .slc-primary:hover, .slc-dialog .slc-primary:hover, .slc-dialog #review-proceed-button:hover { background: var(--steam-blue-hover); border-color: var(--steam-blue-hover); }
        #cleanup-controls #scan-button { padding: 12px 22px; font-size: 13px; }
        #cleanup-controls :disabled, .slc-dialog :disabled { opacity: .45; cursor: not-allowed; }
        #cleanup-controls :focus-visible, .slc-dialog :focus-visible { outline: 2px solid var(--steam-blue); outline-offset: 3px; }
        #cleanup-controls .cancel-button { color: #ffb3b3; background: #442b36; border-color: #805061; margin: 0 28px 20px; }
        #cleanup-controls .progress-bar-container { margin: 0 28px 18px; padding: 12px; border: 1px solid var(--slc-border); border-radius: 8px; background: #0c1723; }
        #cleanup-controls .progress-bar { min-height: 6px; border-radius: 4px; font-size: 10px; text-align: center; color: #0b2929; transition: width .2s; }
        #cleanup-controls .progress-status-text { font-size: 12px; margin-top: 8px; overflow-wrap: anywhere; }
        .slc-dialog { position: fixed; inset: 0; z-index: 100000; background: #060e19c9; backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .slc-dialog .modal-content { background: #142031; border: 1px solid #3c526c; border-radius: 14px; width: 100%; max-width: 880px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 28px 100px #0008; overflow: hidden; }
        .slc-dialog .modal-header { padding: 23px 26px 16px; }
        .slc-dialog h2 { margin: 0; font-size: 21px; letter-spacing: -.3px; }
        .slc-dialog .modal-body { overflow-y: auto; padding: 0 26px 22px; min-height: 0; scrollbar-width: thin; scrollbar-color: #42576e #142031; }
        .slc-dialog .modal-body a { color: var(--steam-blue); text-decoration: underline; }
        .slc-dialog .modal-footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 16px 26px; border-top: 1px solid var(--slc-border); background: #101b2a; }
        .slc-dialog .modal-content.slc-scan-dialog { max-width: 530px; }
        .slc-dialog .slc-scan-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 22px 0; }
        .slc-dialog .slc-scan-stats > div { background: #0f1b2a; border: 1px solid var(--slc-border); border-radius: 9px; padding: 17px 20px; }
        .slc-dialog .slc-scan-stats strong { display: block; color: var(--steam-white-text); font-size: 32px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .slc-dialog .slc-scan-stats span { color: var(--slc-muted); font-size: 12px; }
        .slc-dialog .slc-scan-track { height: 4px; border-radius: 4px; background: #2a3a4f; overflow: hidden; }
        .slc-dialog .slc-scan-track span { display: block; width: 35%; height: 100%; background: var(--steam-blue); animation: slc-scanning 1.8s ease-in-out infinite alternate; }
        .slc-dialog #working-status { margin: 15px 0 9px; font-size: 13px; }
        .slc-dialog .slc-scan-scope { border: 1px solid #76ddcf35; border-left: 3px solid var(--steam-blue); background: #76ddcf08; padding: 12px 15px; border-radius: 7px; margin-bottom: 16px; }
        .slc-dialog .slc-scan-scope.slc-partial { border-color: #edc37f50; border-left-color: var(--steam-warning); background: #edc37f08; }
        .slc-dialog .slc-scan-scope strong { color: var(--steam-white-text); display: block; }
        .slc-dialog .slc-scan-scope p { margin: 4px 0 0; font-size: 12px; }
        .slc-dialog .slc-scan-details { color: var(--slc-muted); font-size: 12px; margin-bottom: 18px; }
        .slc-dialog .slc-scan-details summary { cursor: pointer; margin-bottom: 7px; }
        .slc-dialog .review-controls { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; }
        .slc-dialog .slc-selection-actions { display: flex; gap: 7px; margin: 12px 0; }
        .slc-dialog #review-count { font-size: 12px; color: var(--steam-blue); margin: 0; }
        .slc-dialog .slc-selection-note { margin: 5px 0 15px; color: var(--slc-muted); font-size: 11px; }
        .slc-dialog #review-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 7px; }
        .slc-dialog #review-list label { display: flex; align-items: flex-start; gap: 12px; padding: 13px 14px; background: #101c2c; border: 1px solid var(--slc-border); border-radius: 8px; cursor: pointer; }
        .slc-dialog #review-list label:hover { border-color: #4c6984; background: #17283c; }
        .slc-dialog #review-list input { margin: 4px 0 0; accent-color: var(--steam-blue); width: 16px; height: 16px; flex-shrink: 0; }
        .slc-dialog .slc-license-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
        .slc-dialog .slc-license-text strong { font-size: 13px; color: #e0eaf7; font-weight: 550; display: block; }
        .slc-dialog .slc-license-meta { display: block; font-size: 11px; color: var(--slc-muted); margin-top: 4px; }
        .slc-dialog .slc-license-evidence { display: block; font-size: 10px; color: #8ebbb5; margin-top: 4px; }
        .slc-dialog #review-list .slc-badge { margin-top: 2px; }
        @keyframes slc-scanning { from { transform: translateX(-25%); } to { transform: translateX(210%); } }
        @media (max-width: 760px) {
            #cleanup-controls .slc-workspace { grid-template-columns: 1fr; padding: 18px; }
            #cleanup-controls .slc-header { padding: 20px 18px; flex-wrap: wrap; gap: 14px; }
            #cleanup-controls .slc-steps { padding: 0 18px 16px; gap: 16px; flex-wrap: wrap; }
            #cleanup-controls .slc-actionbar { padding: 16px 18px; flex-wrap: wrap; }
            #cleanup-controls .slc-main-actions { width: 100%; }
            #cleanup-controls .slc-main-actions button { flex: 1; }
            #cleanup-controls h2 { font-size: 19px; }
        }
        @media (max-width: 480px) {
            .slc-dialog { padding: 10px; }
            .slc-dialog .modal-header { padding: 18px 16px 12px; }
            .slc-dialog .modal-body { padding: 0 16px 16px; }
            .slc-dialog .modal-footer { padding: 12px 16px; }
            .slc-dialog .review-controls { grid-template-columns: 1fr; }
            .slc-dialog #review-list .slc-badge { display: none; }
            .slc-dialog .slc-scan-stats > div { padding: 13px; }
            #cleanup-controls .slc-steps li { font-size: 11px; gap: 5px; }
            #cleanup-controls .slc-steps { gap: 10px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .slc-dialog .slc-scan-track span { animation: none; width: 100%; opacity: .6; }
            #cleanup-controls *, .slc-dialog * { transition: none !important; }
        }
    `;
    document.head.appendChild(style);
};
