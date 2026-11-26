// --- NATIVE SECURE EXTENSION API SHIM FOR STANDALONE PREVIEWS ---
// Safely intercepts calls when opened in non-extension environments (like standard browser previews)
if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
  window.chrome = {
    storage: {
      local: {
        get: (keys, callback) => {
          const result = {};
          if (keys === null) {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              try {
                result[k] = JSON.parse(localStorage.getItem(k));
              } catch (e) {
                result[k] = localStorage.getItem(k);
              }
            }
          } else if (Array.isArray(keys)) {
            keys.forEach(k => {
              const val = localStorage.getItem(k);
              try {
                result[k] = val !== null ? JSON.parse(val) : null;
              } catch (e) {
                result[k] = null;
              }
            });
          } else if (typeof keys === 'object') {
            Object.keys(keys).forEach(k => {
              const val = localStorage.getItem(k);
              result[k] = val !== null ? JSON.parse(val) : keys[k];
            });
          } else {
            const val = localStorage.getItem(keys);
            try {
              result[keys] = val !== null ? JSON.parse(val) : null;
            } catch (e) {
              result[keys] = null;
            }
          }
          if (callback) setTimeout(() => callback(result), 0);
        },
        set: (items, callback) => {
          Object.keys(items).forEach(k => {
            localStorage.setItem(k, JSON.stringify(items[k]));
          });
          if (callback) setTimeout(callback, 0);
        },
        remove: (keys, callback) => {
          if (Array.isArray(keys)) {
            keys.forEach(k => localStorage.removeItem(k));
          } else {
            localStorage.removeItem(keys);
          }
          if (callback) setTimeout(callback, 0);
        }
      }
    },
    tabs: {
      query: (queryInfo, callback) => {
        // Generate a placeholder mock tab for preview window viewing support
        const mockTab = {
          id: 999,
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Rick Astley - Never Gonna Give You Up (Official Video)"
        };
        if (callback) setTimeout(() => callback([mockTab]), 0);
      },
      create: (createProperties) => {
        window.open(createProperties.url, '_blank');
      },
      onUpdated: {
        addListener: (listener) => {}
      },
      onActivated: {
        addListener: (listener) => {}
      }
    },
    scripting: (() => {
      let mockPaused = false;
      return {
        executeScript: (details, callback) => {
          const fnSrc = details && details.func ? details.func.toString() : '';
          let result = 135;
          if (fnSrc.includes('__ytNoteFlowLastToggleTs')) {
            mockPaused = !mockPaused;
            result = { toggled: true, paused: mockPaused };
          } else if (fnSrc.includes('pausedNow')) {
            const pausedNow = !mockPaused;
            mockPaused = true;
            result = { pausedNow, paused: true, currentTime: 135 };
          }
          if (callback) setTimeout(() => callback([{ result }]), 0);
        }
      };
    })(),
    runtime: {
      onMessage: {
        addListener: () => {}
      }
    }
  };
}

// State Variables
let currentVideoId = null;
let currentVideoTitle = '';
let saveTimeout = null;
let viewMode = 'write'; // 'write' or 'preview'
let autoPauseEnabled = false;
let pausedInCurrentBurst = false;
let typingBurstTimeout = null;
let pendingStampState = null;
const TYPING_IDLE_RESET_MS = 1500;
const isMacPlatform = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// DOM Selectors
const activeEditorView = document.getElementById('active-editor-view');
const notebookDirectoryView = document.getElementById('notebook-directory-view');
const notYoutubeView = document.getElementById('not-youtube-view');
const noteTextarea = document.getElementById('note-textarea');
const notePreview = document.getElementById('note-preview');
const saveStatus = document.getElementById('save-status');
const videoTitleHeader = document.getElementById('current-video-title');

// Buttons
const tabWriteBtn = document.getElementById('tab-write-btn');
const tabPreviewBtn = document.getElementById('tab-preview-btn');
const btnTimestamp = document.getElementById('btn-timestamp');
const btnAutopause = document.getElementById('btn-autopause');
const btnPlayPause = document.getElementById('btn-play-pause');
const playPauseLabel = document.getElementById('play-pause-label');
const playPauseKbd = document.getElementById('play-pause-kbd');
const iconPlay = document.getElementById('icon-play');
const iconPlayPause = document.getElementById('icon-play-pause');
const btnDeleteNote = document.getElementById('btn-delete-note');
const btnCopy = document.getElementById('btn-copy');
const btnDownload = document.getElementById('btn-download');
const notebookViewBtn = document.getElementById('notebook-view-btn');
const closeNotebookBtn = document.getElementById('close-notebook-btn');
const fallbackNotebookBtn = document.getElementById('fallback-notebook-btn');

// Sync Configuration UI Selectors
const toggleSyncSettingsBtn = document.getElementById('toggle-sync-settings-btn');
const syncSettingsFields = document.getElementById('sync-settings-fields');
const syncUrlInput = document.getElementById('sync-url-input');
const syncKeyInput = document.getElementById('sync-key-input');
const saveSyncSettingsBtn = document.getElementById('save-sync-settings-btn');
const triggerSyncBtn = document.getElementById('trigger-sync-btn');
const syncStatusMsg = document.getElementById('sync-status-msg');

// Modal Selectors
const confirmModal = document.getElementById('confirm-modal');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

// Theme Switcher DOM
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeSunIcon = document.getElementById('theme-sun-icon');
const themeMoonIcon = document.getElementById('theme-moon-icon');


// --- NATIVE SECURE OFFLINE MARKDOWN PARSER ---
function parseMarkdown(md) {
  if (!md) return '';

  // Escape HTML tags to protect extension context from XSS injection
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```code```
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings: ###, ##, #
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Blockquotes: > quote
  html = html.replace(/^\x3E (.*$)/gim, '<blockquote>$1</blockquote>');

  // Checkboxes: - [ ] or - [x]
  html = html.replace(/^- \[x\] (.*$)/gim, '<li class="task-list-item"><input type="checkbox" checked disabled> <span>$1</span></li>');
  html = html.replace(/^- \[ \] (.*$)/gim, '<li class="task-list-item"><input type="checkbox" disabled> <span>$1</span></li>');

  // Standard list elements: - item or * item
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Interactive Link anchors: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restructure linebreaks safely into block levels
  const rawLines = html.split('\n');
  let insideList = false;
  let parsedBlockList = [];

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i].trim();
    if (!line) {
      if (insideList) {
        parsedBlockList.push('</ul>');
        insideList = false;
      }
      continue;
    }

    const isListItem = line.startsWith('<li>') || line.startsWith('<li class="task-list-item"');
    const isStructural = line.startsWith('<h') || line.startsWith('<blockquote>') || line.startsWith('<pre>') || line.endsWith('</pre>');

    if (isListItem) {
      if (!insideList) {
        insideList = true;
        parsedBlockList.push('<ul>');
      }
      parsedBlockList.push(line);
    } else {
      if (insideList) {
        parsedBlockList.push('</ul>');
        insideList = false;
      }

      if (isStructural) {
        parsedBlockList.push(line);
      } else {
        parsedBlockList.push(`<p>${line}</p>`);
      }
    }
  }

  if (insideList) {
    parsedBlockList.push('</ul>');
  }

  return parsedBlockList.join('\n');
}


// --- VIEW TRIGGERS & BOOTSTRAPPING ---

document.addEventListener('DOMContentLoaded', () => {
  // Configure platform-aware shortcut hint
  if (playPauseKbd) {
    playPauseKbd.textContent = isMacPlatform ? '⇧⌘Space' : 'Ctrl+⇧+Space';
    btnPlayPause.title = isMacPlatform
      ? 'Play or pause video (Shortcut: ⇧⌘Space or ⌃Space)'
      : 'Play or pause video (Shortcut: Ctrl+Shift+Space or Ctrl+Space)';
  }

  // 1. Initialize Theme & Auto-Pause Preferences
  chrome.storage.local.get(['theme', 'syncUrl', 'syncKey', 'autoPauseOnType'], (result) => {
    if (result.theme === 'dark' || (!result.theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkTheme(true);
    } else {
      setDarkTheme(false);
    }

    setAutoPauseState(Boolean(result.autoPauseOnType), false);

    // Load saved sync configurations if they exist
    if (result.syncUrl) syncUrlInput.value = result.syncUrl;
    if (result.syncKey) syncKeyInput.value = result.syncKey;
  });

  // 2. Scan active context tab for YouTube page status
  checkCurrentTab();

  // 3. Listen to focus or context navigation updates
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      checkCurrentTab();
    }
  });
  chrome.tabs.onActivated.addListener(() => {
    checkCurrentTab();
  });

  // Listen for global command playback state updates from background service worker
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'PLAYBACK_STATE_CHANGED') {
        applyPlaybackState(Boolean(msg.paused));
      }
    });
  }

  // 4. Register Keyboard Auto-save & Auto-Pause + Auto-Timestamp handlers
  noteTextarea.addEventListener('beforeinput', (e) => {
    if (!autoPauseEnabled || !currentVideoId || pausedInCurrentBurst) {
      pendingStampState = null;
      return;
    }
    pendingStampState = capturePreInputStampState(e);
  });

  noteTextarea.addEventListener('input', (e) => {
    setSaveStatus('typing');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveNotesToStorage, 700);

    if (autoPauseEnabled && currentVideoId) {
      handleTypingAutoPause(e);
    }
    pendingStampState = null;
  });

  // 5. Setup dynamic, CSP-compliant formatting button listeners (replaces inline html onclick)
  document.getElementById('fmt-bold').addEventListener('click', () => insertFormat('**', '**'));
  document.getElementById('fmt-italic').addEventListener('click', () => insertFormat('*', '*'));
  document.getElementById('fmt-header').addEventListener('click', () => insertFormat('### ', ''));
  document.getElementById('fmt-link').addEventListener('click', () => insertFormat('[', '](url)'));
  document.getElementById('fmt-checkbox').addEventListener('click', () => insertFormat('- [ ] ', ''));

  // 6. Setup dynamic event delegation on the notebook card directory (completely CSP compliant)
  document.getElementById('notebook-list-container').addEventListener('click', (e) => {
    const launchBtn = e.target.closest('[data-action="launch"]');
    const trashBtn = e.target.closest('[data-action="trash"]');

    if (launchBtn) {
      const id = launchBtn.getAttribute('data-id');
      goToVideo(id);
    } else if (trashBtn) {
      const id = trashBtn.getAttribute('data-id');
      deleteNoteDirectly(id);
    }
  });

  // 7. Setup Sync Panel Interaction Listeners
  toggleSyncSettingsBtn.addEventListener('click', () => {
    syncSettingsFields.classList.toggle('hidden');
  });

  saveSyncSettingsBtn.addEventListener('click', () => {
    const url = syncUrlInput.value.trim();
    const key = syncKeyInput.value.trim();

    chrome.storage.local.set({ syncUrl: url, syncKey: key }, () => {
      showSyncMessage("Configuration saved!", "#10b981");
    });
  });

  triggerSyncBtn.addEventListener('click', () => {
    performDatabaseSync();
  });
});

// Helper for UI Sync notifications
function showSyncMessage(text, colorHex) {
  syncStatusMsg.textContent = text;
  syncStatusMsg.style.color = colorHex;
}

// Parse specific active video parameters from YT URL
function getYouTubeVideoId(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/")[2];
      }
      if (url.hostname.includes("youtu.be")) {
        return url.pathname.substring(1);
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      showNotYoutubeState();
      return;
    }

    const videoId = getYouTubeVideoId(tab.url);
    if (videoId) {
      const isNewVideo = currentVideoId !== videoId;
      currentVideoId = videoId;
      currentVideoTitle = tab.title ? tab.title.replace(/\s*-\s*YouTube$/, '') : "YouTube Video Note";
      videoTitleHeader.textContent = currentVideoTitle;
      videoTitleHeader.title = currentVideoTitle;

      if (isNewVideo) {
        pausedInCurrentBurst = false;
        clearTimeout(typingBurstTimeout);
        updatePlayPauseUI(false);
        loadNoteForVideo(currentVideoId);
      }

      // Transition layouts
      notYoutubeView.classList.add('hidden');
      activeEditorView.classList.remove('hidden');
    } else {
      showNotYoutubeState();
    }
  } catch (error) {
    console.error("Tab query failed:", error);
    showNotYoutubeState();
  }
}

function showNotYoutubeState() {
  currentVideoId = null;
  notYoutubeView.classList.remove('hidden');
  activeEditorView.classList.add('hidden');
}


// --- DATA TRANSFERS & STORAGE ---

function loadNoteForVideo(videoId) {
  const storageKey = `yt_note_${videoId}`;
  chrome.storage.local.get([storageKey], (result) => {
    if (result[storageKey]) {
      noteTextarea.value = result[storageKey].markdown || '';
      setSaveStatus('synced');
    } else {
      noteTextarea.value = '';
      setSaveStatus('empty');
    }

    if (viewMode === 'preview') {
      updateMarkdownPreview();
    }
  });
}

function saveNotesToStorage() {
  if (!currentVideoId) return;

  const storageKey = `yt_note_${currentVideoId}`;
  const noteContent = noteTextarea.value;

  if (!noteContent.trim()) {
    chrome.storage.local.remove(storageKey, () => {
      setSaveStatus('empty');
    });
    return;
  }

  const notePayload = {
    videoId: currentVideoId,
    videoTitle: currentVideoTitle,
    markdown: noteContent,
    updatedAt: Date.now()
  };

  chrome.storage.local.set({ [storageKey]: notePayload }, () => {
    setSaveStatus('synced');
  });
}


// --- BI-DIRECTIONAL PHP CLOUD SYNC LOGIC ---

async function performDatabaseSync() {
  showSyncMessage("Connecting to server...", "var(--text-secondary)");

  chrome.storage.local.get(['syncUrl', 'syncKey', 'lastSyncTime'], async (config) => {
    const url = config.syncUrl;
    const key = config.syncKey;
    let lastSync = config.lastSyncTime || 0;

    if (!url || !key) {
      showSyncMessage("Error: Configure URL and key first.", "var(--yt-red)");
      return;
    }

    try {
      // 1. Fetch all local notes stored on this device
      chrome.storage.local.get(null, async (localData) => {
        const localNotes = [];
        const localNotesMap = {};

        Object.keys(localData).forEach(k => {
          if (k.startsWith('yt_note_')) {
            const note = localData[k];
            localNotes.push(note);
            localNotesMap[note.videoId] = note;
          }
        });

        // 2. Fetch server database delta modifications since last sync time
        // Convert milliseconds to seconds parameter
        const getUrl = `${url}?last_sync=${Math.floor(lastSync / 1000)}`;
        const response = await fetch(getUrl, {
          method: 'GET',
          headers: { 'X-API-Key': key }
        });

        if (!response.ok) {
          throw new Error(`Connection error (Status ${response.status})`);
        }

        const data = await response.json();
        if (data.status !== 'success') {
          throw new Error(data.error || "Server validation issue");
        }

        const serverNotes = data.notes || [];
        const serverTime = data.server_time;

        const localUpdates = {};
        const serverUploads = [];
        const processedServerVideoIds = new Set();

        // 3. Resolve incoming modifications
        serverNotes.forEach(sNote => {
          const videoId = sNote.video_id;
          const sNotePayload = {
            videoId: videoId,
            videoTitle: sNote.video_title,
            markdown: sNote.markdown,
            updatedAt: parseInt(sNote.updated_at)
          };

          processedServerVideoIds.add(videoId);

          const localNote = localNotesMap[videoId];
          if (!localNote) {
            // Note doesn't exist locally -> Overwrite/Save locally
            localUpdates[`yt_note_${videoId}`] = sNotePayload;
          } else if (sNotePayload.updatedAt > localNote.updatedAt) {
            // Server has newer updates -> Overwrite/Save locally
            localUpdates[`yt_note_${videoId}`] = sNotePayload;
          } else if (localNote.updatedAt > sNotePayload.updatedAt) {
            // Local is newer -> Queue to upload to server
            serverUploads.push(localNote);
          }
        });

        // 4. Find local edits that the server did not return (edited since lastSync)
        localNotes.forEach(lNote => {
          if (!processedServerVideoIds.has(lNote.videoId)) {
            if (lNote.updatedAt > lastSync) {
              serverUploads.push(lNote);
            }
          }
        });

        // 5. Apply incoming server additions locally
        if (Object.keys(localUpdates).length > 0) {
          await new Promise(resolve => chrome.storage.local.set(localUpdates, resolve));
        }

        // 6. Post local edits to the server
        if (serverUploads.length > 0) {
          const pushResponse = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': key
            },
            body: JSON.stringify({ notes: serverUploads })
          });

          if (!pushResponse.ok) {
            throw new Error(`Upload write failed (Status ${pushResponse.status})`);
          }

          const pushResult = await pushResponse.json();
          if (pushResult.status !== 'success') {
            throw new Error(pushResult.error || "Server push rejection");
          }
        }

        // 7. Store new sync timestamp
        const newSyncTime = serverTime || Date.now();
        chrome.storage.local.set({ lastSyncTime: newSyncTime }, () => {
          showSyncMessage("Synchronization successful!", "#10b981");

          // Re-render active editor note if applicable
          if (currentVideoId) {
            loadNoteForVideo(currentVideoId);
          }

          // Refresh directory layout
          renderNotebookDirectory();
        });
      });
    } catch (err) {
      console.error("Cloud synchronization failed:", err);
      showSyncMessage(`Sync failed: ${err.message}`, "var(--yt-red)");
    }
  });
}


// --- TIME & PLAYBACK INTERACTION SYSTEM ---

function setAutoPauseState(enabled, persist = true) {
  autoPauseEnabled = enabled;
  pausedInCurrentBurst = false;
  clearTimeout(typingBurstTimeout);

  if (btnAutopause) {
    btnAutopause.classList.toggle('active', enabled);
    btnAutopause.setAttribute('aria-checked', String(enabled));
  }

  if (persist) {
    chrome.storage.local.set({ autoPauseOnType: enabled });
  }
}

function updatePlayPauseUI(isPaused) {
  if (!btnPlayPause) return;
  btnPlayPause.classList.toggle('is-paused', isPaused);
  if (isPaused) {
    playPauseLabel.textContent = 'Resume';
    iconPlay.classList.remove('hidden');
    iconPlayPause.classList.add('hidden');
  } else {
    playPauseLabel.textContent = 'Play/Pause';
    iconPlay.classList.add('hidden');
    iconPlayPause.classList.remove('hidden');
  }
}

function applyPlaybackState(isPaused) {
  if (!isPaused) {
    pausedInCurrentBurst = false;
    clearTimeout(typingBurstTimeout);
  }
  updatePlayPauseUI(isPaused);
}

function capturePreInputStampState(e) {
  const inputType = e && e.inputType ? e.inputType : '';
  if (
    inputType.startsWith('delete') ||
    inputType === 'historyUndo' ||
    inputType === 'historyRedo'
  ) {
    return null;
  }

  const val = noteTextarea.value;
  const selStart = noteTextarea.selectionStart;
  const selEnd = noteTextarea.selectionEnd;
  const lineEndIdx = val.indexOf('\n', selEnd);
  const textAfterOnLine = lineEndIdx === -1
    ? val.slice(selEnd)
    : val.slice(selEnd, lineEndIdx);

  // Do not auto-insert a timestamp when editing in the middle of an existing line
  if (textAfterOnLine.trim().length > 0) {
    return null;
  }

  if (inputType === 'insertLineBreak') {
    return { type: 'lineBreak' };
  }

  const lineStart = selStart > 0 ? val.lastIndexOf('\n', selStart - 1) + 1 : 0;
  const textBeforeOnLine = val.slice(lineStart, selStart);
  const isBlankLine = textBeforeOnLine.trim().length === 0;
  const isMarkdownPrefixOnly = /^(\s*(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|#{1,6}\s+|>\s+))$/.test(textBeforeOnLine);

  if (isBlankLine || isMarkdownPrefixOnly) {
    return {
      type: 'inlineStart',
      index: selStart,
      prefixSnapshot: val.slice(0, selStart)
    };
  }

  return null;
}

function resolveStampAnchorAfterInput(e, preState) {
  const inputType = e && e.inputType ? e.inputType : '';
  if (
    inputType.startsWith('delete') ||
    inputType === 'historyUndo' ||
    inputType === 'historyRedo'
  ) {
    return null;
  }

  if (preState) {
    if (preState.type === 'lineBreak' || inputType === 'insertLineBreak') {
      const cursor = noteTextarea.selectionStart;
      return {
        index: cursor,
        prefixSnapshot: noteTextarea.value.slice(0, cursor)
      };
    }
    if (preState.type === 'inlineStart') {
      return {
        index: preState.index,
        prefixSnapshot: preState.prefixSnapshot
      };
    }
  }

  return null;
}

function insertAutoTimestampAtAnchor(anchor, seconds) {
  if (!anchor || !currentVideoId) return;

  const currentVal = noteTextarea.value;
  if (
    anchor.index > currentVal.length ||
    currentVal.slice(0, anchor.index) !== anchor.prefixSnapshot
  ) {
    return;
  }

  const absoluteSeconds = Math.max(0, Math.floor(seconds));
  const timeFormattedString = formatSecondsToTime(absoluteSeconds);
  const jumpUrl = `https://youtu.be/${currentVideoId}?t=${absoluteSeconds}`;
  const markdownLink = `[${timeFormattedString}](${jumpUrl}) `;

  const prevStart = noteTextarea.selectionStart;
  const prevEnd = noteTextarea.selectionEnd;
  const prevScroll = noteTextarea.scrollTop;

  noteTextarea.value =
    currentVal.slice(0, anchor.index) +
    markdownLink +
    currentVal.slice(anchor.index);

  const shift = markdownLink.length;
  noteTextarea.selectionStart = prevStart >= anchor.index ? prevStart + shift : prevStart;
  noteTextarea.selectionEnd = prevEnd >= anchor.index ? prevEnd + shift : prevEnd;
  noteTextarea.scrollTop = prevScroll;

  setSaveStatus('typing');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNotesToStorage, 700);
}

function handleTypingAutoPause(inputEvent) {
  clearTimeout(typingBurstTimeout);
  typingBurstTimeout = setTimeout(() => {
    pausedInCurrentBurst = false;
  }, TYPING_IDLE_RESET_MS);

  if (!pausedInCurrentBurst) {
    pausedInCurrentBurst = true;
    const stampAnchor = resolveStampAnchorAfterInput(inputEvent, pendingStampState);
    pauseActiveVideo(stampAnchor);
  }
}

async function pauseActiveVideo(stampAnchor = null) {
  if (!currentVideoId) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const video = document.querySelector('video');
        if (!video) return null;
        if (!video.paused) {
          video.pause();
          return { pausedNow: true, paused: true, currentTime: video.currentTime };
        }
        return { pausedNow: false, paused: true, currentTime: video.currentTime };
      }
    }, (results) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      const res = results && results[0] ? results[0].result : null;
      if (res && res.paused) {
        updatePlayPauseUI(true);
        if (res.pausedNow && stampAnchor && typeof res.currentTime === 'number') {
          insertAutoTimestampAtAnchor(stampAnchor, res.currentTime);
        }
      }
    });
  } catch (err) {
    console.error("Auto-pause execution failed:", err);
  }
}

async function toggleVideoPlayback() {
  if (!currentVideoId) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const now = Date.now();
        const video = document.querySelector('video');
        if (!video) return null;

        if (window.__ytNoteFlowLastToggleTs && (now - window.__ytNoteFlowLastToggleTs) < 200) {
          return { toggled: false, paused: video.paused };
        }
        window.__ytNoteFlowLastToggleTs = now;

        if (video.paused) {
          video.play();
          return { toggled: true, paused: false };
        } else {
          video.pause();
          return { toggled: true, paused: true };
        }
      }
    }, (results) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      const res = results && results[0] ? results[0].result : null;
      if (res) {
        applyPlaybackState(res.paused);
      }
    });
  } catch (err) {
    console.error("Playback toggle failed:", err);
  }
}

btnAutopause.addEventListener('click', () => {
  setAutoPauseState(!autoPauseEnabled, true);
});

btnPlayPause.addEventListener('click', () => {
  toggleVideoPlayback();
  if (viewMode === 'write') {
    noteTextarea.focus();
  }
});

// Side panel keyboard shortcuts: Cmd/Ctrl+Shift+Space or Ctrl+Space
document.addEventListener('keydown', (e) => {
  if (!currentVideoId) return;

  const isModShiftSpace = (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'Space';
  const isCtrlSpace = e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.code === 'Space';

  if (isModShiftSpace || isCtrlSpace) {
    e.preventDefault();
    e.stopPropagation();
    toggleVideoPlayback();
  }
});

btnTimestamp.addEventListener('click', async () => {
  if (!currentVideoId) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Query active tab's HTML5 media engine status
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const videoElement = document.querySelector('video');
        return videoElement ? videoElement.currentTime : null;
      }
    }, (results) => {
      if (results && results[0] && results[0].result !== null) {
        const absoluteSeconds = Math.floor(results[0].result);
        const timeFormattedString = formatSecondsToTime(absoluteSeconds);

        const jumpUrl = `https://youtu.be/${currentVideoId}?t=${absoluteSeconds}`;
        const markdownLink = `[${timeFormattedString}](${jumpUrl}) `;

        insertTextAtCursor(markdownLink);
      } else {
        insertTextAtCursor(`[0:00](https://youtu.be/${currentVideoId}?t=0) `);
      }
    });
  } catch (err) {
    console.error("Scripting capture failed:", err);
  }
});

function formatSecondsToTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const padSecs = remainingSeconds.toString().padStart(2, '0');
  if (hours > 0) {
    const padMins = minutes.toString().padStart(2, '0');
    return `${hours}:${padMins}:${padSecs}`;
  }
  return `${minutes}:${padSecs}`;
}

function insertTextAtCursor(textToInsert) {
  const startPos = noteTextarea.selectionStart;
  const endPos = noteTextarea.selectionEnd;
  const initialText = noteTextarea.value;

  noteTextarea.value = initialText.substring(0, startPos) + textToInsert + initialText.substring(endPos);

  noteTextarea.focus();
  const updatedCursorLocation = startPos + textToInsert.length;
  noteTextarea.selectionStart = updatedCursorLocation;
  noteTextarea.selectionEnd = updatedCursorLocation;

  setSaveStatus('typing');
  clearTimeout(saveTimeout);
  saveNotesToStorage();
}

function insertFormat(prefix, suffix) {
  const startPos = noteTextarea.selectionStart;
  const endPos = noteTextarea.selectionEnd;
  const initialText = noteTextarea.value;
  const selectedText = initialText.substring(startPos, endPos);

  const wrappedText = prefix + selectedText + suffix;
  noteTextarea.value = initialText.substring(0, startPos) + wrappedText + initialText.substring(endPos);

  noteTextarea.focus();
  noteTextarea.selectionStart = startPos + prefix.length;
  noteTextarea.selectionEnd = startPos + prefix.length + selectedText.length;

  setSaveStatus('typing');
  clearTimeout(saveTimeout);
  saveNotesToStorage();
}


// --- PANEL SWITCHES & THEMES ---

function setSaveStatus(status) {
  let markup = '';
  switch (status) {
    case 'typing':
      markup = `
        <span class="save-dot amber"></span>
        <span>Saving...</span>`;
      break;
    case 'synced':
      markup = `
        <span class="save-dot emerald"></span>
        <span>Saved Offline</span>`;
      break;
    case 'empty':
      markup = `<span>Unsaved note draft</span>`;
      break;
    default:
      markup = '';
  }
  saveStatus.innerHTML = markup;
}

function updateMarkdownPreview() {
  const markdownContent = noteTextarea.value;
  if (markdownContent.trim()) {
    notePreview.innerHTML = parseMarkdown(markdownContent);
  } else {
    notePreview.innerHTML = `<p class="placeholder-text">Nothing to preview. Go ahead and write some notes!</p>`;
  }
}

tabWriteBtn.addEventListener('click', () => {
  viewMode = 'write';
  tabWriteBtn.classList.add('active');
  tabPreviewBtn.classList.remove('active');
  noteTextarea.classList.remove('hidden');
  notePreview.classList.add('hidden');
});

tabPreviewBtn.addEventListener('click', () => {
  viewMode = 'preview';
  tabPreviewBtn.classList.add('active');
  tabWriteBtn.classList.remove('active');
  noteTextarea.classList.add('hidden');
  notePreview.classList.remove('hidden');
  updateMarkdownPreview();
});

// Listen to seeking events parsed from local compiled anchors
notePreview.addEventListener('click', async (e) => {
  const link = e.target.closest('a');
  if (!link || !link.href) return;

  try {
    const urlObj = new URL(link.href);
    const targetSecondsParam = urlObj.searchParams.get('t');
    if (targetSecondsParam) {
      e.preventDefault();
      const targetSeconds = parseInt(targetSecondsParam);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [targetSeconds],
          func: (secs) => {
            const video = document.querySelector('video');
            if (video) {
              video.currentTime = secs;
              video.play();
            }
          }
        }, () => {
          applyPlaybackState(false);
        });
      }
    }
  } catch (err) {
    console.warn("Timestamp execution lookup error:", err);
  }
});

themeToggleBtn.addEventListener('click', () => {
  const isCurrentlyDark = document.documentElement.classList.contains('dark');
  setDarkTheme(!isCurrentlyDark);
});

function setDarkTheme(enabled) {
  if (enabled) {
    document.documentElement.classList.add('dark');
    themeSunIcon.classList.remove('hidden');
    themeMoonIcon.classList.add('hidden');
    chrome.storage.local.set({ theme: 'dark' });
  } else {
    document.documentElement.classList.remove('dark');
    themeSunIcon.classList.add('hidden');
    themeMoonIcon.classList.remove('hidden');
    chrome.storage.local.set({ theme: 'light' });
  }
}


// --- CLEAR / EXPORTS ---

btnDeleteNote.addEventListener('click', () => {
  confirmModal.classList.remove('hidden');
});

modalCancelBtn.addEventListener('click', () => {
  confirmModal.classList.add('hidden');
});

modalConfirmBtn.addEventListener('click', () => {
  if (currentVideoId) {
    const storageKey = `yt_note_${currentVideoId}`;
    chrome.storage.local.remove(storageKey, () => {
      noteTextarea.value = '';
      setSaveStatus('empty');
      if (viewMode === 'preview') {
        updateMarkdownPreview();
      }
      confirmModal.classList.add('hidden');
    });
  }
});

btnCopy.addEventListener('click', () => {
  const textToCopy = noteTextarea.value;
  if (!textToCopy) return;

  const dummyTextarea = document.createElement('textarea');
  dummyTextarea.value = textToCopy;
  document.body.appendChild(dummyTextarea);
  dummyTextarea.select();

  try {
    document.execCommand('copy');
    const defaultText = btnCopy.innerHTML;
    btnCopy.innerHTML = `
      <svg style="width: 14px; height: 14px; color: #10b981;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
      Copied!`;
    setTimeout(() => { btnCopy.innerHTML = defaultText; }, 1500);
  } catch (err) {
    console.error("Clipboard copy failed:", err);
  } finally {
    document.body.removeChild(dummyTextarea);
  }
});

btnDownload.addEventListener('click', () => {
  const content = noteTextarea.value;
  if (!content) return;

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');

  const sanitizedName = currentVideoTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  downloadAnchor.href = url;
  downloadAnchor.download = `${sanitizedName || 'youtube-notes'}.md`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  document.body.removeChild(downloadAnchor);
  URL.revokeObjectURL(url);
});


// --- VIEW B: NOTEBOOK DIRECTORY ---

notebookViewBtn.addEventListener('click', () => {
  renderNotebookDirectory();
  notebookDirectoryView.classList.remove('hidden');
});

closeNotebookBtn.addEventListener('click', () => {
  notebookDirectoryView.classList.add('hidden');
});

fallbackNotebookBtn.addEventListener('click', () => {
  renderNotebookDirectory();
  notebookDirectoryView.classList.remove('hidden');
});

function renderNotebookDirectory(filterQuery = '') {
  const listContainer = document.getElementById('notebook-list-container');
  listContainer.innerHTML = '';

  chrome.storage.local.get(null, (items) => {
    const savedNotesArray = Object.keys(items)
      .filter(key => key.startsWith('yt_note_'))
      .map(key => items[key])
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const searchMatches = savedNotesArray.filter(note => {
      const matchTitle = note.videoTitle.toLowerCase().includes(filterQuery.toLowerCase());
      const matchContent = note.markdown.toLowerCase().includes(filterQuery.toLowerCase());
      return matchTitle || matchContent;
    });

    if (searchMatches.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 24px; opacity: 0.6;">
          <span style="font-size: 2.5rem; display: block; margin-bottom: 8px;">📁</span>
          <p style="font-size: 0.75rem;">No saved notes found matching this search.</p>
        </div>`;
      return;
    }

    searchMatches.forEach(note => {
      const card = document.createElement('div');
      card.className = "note-card";

      const dateStr = new Date(note.updatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      const snippetText = note.markdown.length > 100
        ? note.markdown.substring(0, 100).replace(/[#*`_-]/g, '') + '...'
        : note.markdown.replace(/[#*`_-]/g, '');

      card.innerHTML = `
        <div>
          <div class="note-card-meta">
            <span class="card-badge">Note</span>
            <span class="card-date">${dateStr}</span>
          </div>
          <h4 class="note-card-title" style="margin-top: 6px;">${note.videoTitle}</h4>
          <p class="note-card-snippet">${snippetText}</p>
        </div>
        <div class="note-card-footer">
          <button data-action="launch" data-id="${note.videoId}" class="btn-card-action btn-card-launch">
            ▶ View Video
          </button>
          <button data-action="trash" data-id="${note.videoId}" class="btn-card-action btn-card-trash" title="Delete Note">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="pointer-events: none; width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7" />
            </svg>
          </button>
        </div>`;
      listContainer.appendChild(card);
    });
  });
}

document.getElementById('notebook-search-input').addEventListener('input', (e) => {
  renderNotebookDirectory(e.target.value);
});

function goToVideo(videoId) {
  const linkToOpen = `https://www.youtube.com/watch?v=${videoId}`;
  chrome.tabs.create({ url: linkToOpen });
}

function deleteNoteDirectly(videoId) {
  const userConfirmed = confirm("Are you sure you want to delete this note?");
  if (!userConfirmed) return;

  const storageKey = `yt_note_${videoId}`;
  chrome.storage.local.remove(storageKey, () => {
    if (videoId === currentVideoId) {
      noteTextarea.value = '';
      setSaveStatus('empty');
      if (viewMode === 'preview') {
        updateMarkdownPreview();
      }
    }
    renderNotebookDirectory(document.getElementById('notebook-search-input').value);
  });
}
