# YT NoteFlow

A Chrome extension that lives in the browser side panel and lets you write timestamped Markdown notes tied to any YouTube video, with offline-first local storage and an optional bring-your-own-backend sync API.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Chrome Side Panel](https://img.shields.io/badge/API-Side%20Panel-green)
![Zero Dependencies](https://img.shields.io/badge/Dependencies-None-brightgreen)

---

## Features

- **Side Panel UI** — Opens alongside YouTube without covering video content. Automatically detects when you're on a YouTube page.
- **Markdown Editor** — Write notes with full Markdown support including headings, bold, italic, links, code blocks, checklists, and blockquotes. Includes a formatting toolbar and a live preview mode.
- **Clickable Timestamps** — Grab the current video playback time with one click. Timestamps are inserted as Markdown links that seek the video to that exact moment when clicked in preview mode.
- **Auto-Pause on Typing & Quick Resume** — Optional toggle that automatically pauses the YouTube video and prepends the current clickable timestamp when you start typing a new note line, with instant resume/pause via toolbar button or keyboard shortcut (`Cmd+Shift+Space` / `Ctrl+Shift+Space` or `Ctrl+Space`).
- **Offline-First Storage** — All notes are persisted to `chrome.storage.local` automatically (debounced at 700ms). No account or network required.
- **Notebook Directory** — Browse, search, and manage all saved notes across videos in a dedicated directory view.
- **Bring-Your-Own Sync** — Optionally configure a self-hosted HTTP endpoint to sync notes bi-directionally across devices. Any backend language works — you define the endpoint.
- **Dark / Light Theme** — Respects system preference on first load with a manual toggle. Preference is persisted.
- **Export** — Copy notes to clipboard or download as a `.md` file.
- **Zero Dependencies** — No frameworks, no build tools, no CDN requests. Pure vanilla JS, HTML, and CSS. Fully CSP-compliant.

---

## Architecture
