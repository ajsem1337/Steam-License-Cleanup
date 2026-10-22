// --- STYLES ---
const addGlobalStyle = () => {
    const style = document.createElement('style');
    style.innerHTML = `
        :root {
            --steam-blue: #66c0f4;
            --steam-blue-hover: #a2d9f8;
            --steam-dark: #1b2838;
            --steam-dark-gradient: linear-gradient(to bottom, #2a475e 5%, #1b2838 95%);
            --steam-light-text: #c7d5e0;
            --steam-white-text: #ffffff;
            --steam-error: #ff3300;
            --steam-warning: #ffcc00;
        }
        .cleanup-controls-container {
            text-align: center;
            margin-bottom: 20px;
            padding: 24px;
            background-color: rgba(0,0,0,0.2);
            border-radius: 5px;
        }
        #cleanup-controls .cleanup-heading h2 { margin: 0 0 8px; color: var(--steam-white-text); }
        #cleanup-controls .cleanup-heading small { color: var(--steam-blue); font-size: 14px; }
        #cleanup-controls .cleanup-heading p { margin-bottom: 22px; }
        #cleanup-controls .profile-controls { text-align: left; max-width: 800px; margin: 0 auto 16px; }
        #cleanup-controls select, .modal-content select, #review-search {
            background: #24394e; color: var(--steam-light-text); border: 1px solid #52728b;
            padding: 8px; border-radius: 4px; max-width: 100%;
        }
        #cleanup-profile { display: block; width: 100%; margin: 8px 0; }
        #cleanup-controls [hidden], .modal-overlay [hidden] { display: none !important; }
        #cleanup-controls .metadata-controls { background: rgba(0,0,0,.18); padding: 12px; border-radius: 6px; box-sizing: border-box; }
        .modal-overlay :focus-visible, #cleanup-controls :focus-visible { outline: 2px solid var(--steam-blue); outline-offset: 3px; }
        #settings-error { color: var(--steam-warning); }
        .review-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        #review-search { flex: 1; min-width: 140px; }
        @media (max-width: 600px) {
            .date-range-container { flex-wrap: wrap; gap: 8px; }
            .modal-content { padding: 16px; width: calc(100% - 48px); }
            #cleanup-controls { padding: 16px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .modal-content { animation: none; }
            .steam-cleanup-button, .progress-bar, #review-list label { transition: none; }
        }
        .date-range-container {
            margin-bottom: 15px;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 15px;
        }
        .metadata-controls {
            text-align: left;
            max-width: 800px;
            margin: 0 auto 15px;
        }
        .metadata-controls p { margin: 8px 0; }
        .date-range-container label {
            color: var(--steam-light-text);
            font-size: 14px;
        }
        .date-range-container input[type="date"] {
            background-color: #2a3f5a;
            border: 1px solid var(--steam-blue);
            color: var(--steam-light-text);
            padding: 5px;
            border-radius: 3px;
        }
        .steam-cleanup-button {
            background: var(--steam-dark-gradient);
            border: 1px solid var(--steam-blue);
            border-radius: 4px;
            color: var(--steam-light-text);
            font-size: 14px;
            padding: 10px 20px;
            cursor: pointer;
            margin: 5px;
            display: inline-block;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            transition: all 0.2s;
        }
        .steam-cleanup-button:hover, .steam-cleanup-button:focus {
            background: var(--steam-blue);
            color: var(--steam-white-text);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            outline: none;
        }
        .steam-cleanup-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .steam-cleanup-button.cancel-button {
            background: #c23b22;
            border-color: #ff6347;
        }
        .steam-cleanup-button.cancel-button:hover {
            background: #e04a31;
        }
        .progress-bar-container {
            width: 100%;
            background-color: var(--steam-dark);
            border-radius: 4px;
            margin: 10px auto;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            max-width: 600px;
            padding: 5px;
        }
        .progress-bar {
            width: 0%;
            height: 20px;
            background-color: var(--steam-blue);
            border-radius: 4px;
            text-align: center;
            line-height: 20px;
            color: var(--steam-white-text);
            transition: width 0.3s ease-in-out, background-color 0.3s;
        }
        .progress-status-text {
            text-align: center;
            margin-top: 5px;
            color: var(--steam-light-text);
            font-style: italic;
        }
        .modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.7); z-index: 999; display: flex;
            align-items: center; justify-content: center;
        }
        .modal-content {
            background: var(--steam-dark); color: var(--steam-light-text);
            padding: 30px; border: 1px solid var(--steam-blue); border-radius: 8px;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3); z-index: 1000;
            width: 90%; max-width: 800px; max-height: 90vh;
            display: flex; flex-direction: column;
            animation: fadeIn 0.3s;
        }
        .modal-header h2 {
            margin: 0 0 20px 0;
        }
        .modal-body {
            overflow-y: auto;
            margin-bottom: 20px;
        }
        .modal-footer {
            margin-top: auto;
            text-align: right;
            border-top: 1px solid #3a4b5e;
            padding-top: 20px;
        }
        .modal-textarea {
            width: 95%;
            height: 80px;
            margin-bottom: 15px;
            background: #2a3f5a;
            color: var(--steam-light-text);
            border: 1px solid var(--steam-blue);
            padding: 10px;
        }
         .modal-input {
            width: 100px;
            margin-bottom: 15px;
            background: #2a3f5a;
            color: var(--steam-light-text);
            border: 1px solid var(--steam-blue);
            padding: 5px;
        }
        #review-list {
            list-style: none;
            padding: 0;
        }
        #review-list label {
            display: block;
            padding: 8px;
            border-radius: 3px;
            transition: background-color 0.2s;
            cursor: pointer;
            word-break: break-word;
        }
        #review-list label:hover {
            background-color: #2a475e;
        }
        #review-list input {
            margin-right: 10px;
            vertical-align: middle;
        }
        .review-controls {
            margin-bottom: 15px;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
};
