// Set side panel behavior to open when the user clicks the extension toolbar icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error setting side panel behavior:", error));

// Make sure the panel is active and responds to page navigations on YouTube
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url) return;
  const url = new URL(tab.url);

  if (url.origin === "https://www.youtube.com") {
    // Keep side panel active for YouTube pages
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true
    });
  }
});

// Global shortcut support to play/pause the active YouTube video
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-video-playback") return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id || !tab.url) return;

    const url = new URL(tab.url);
    if (!url.hostname.includes("youtube.com")) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const now = Date.now();
        const video = document.querySelector("video");
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
    });

    const res = results && results[0] ? results[0].result : null;
    if (res) {
      chrome.runtime.sendMessage({
        type: "PLAYBACK_STATE_CHANGED",
        paused: res.paused
      }).catch(() => {
        // Side panel may not be open; safe to ignore
      });
    }
  } catch (error) {
    console.error("Error toggling YouTube playback:", error);
  }
});
