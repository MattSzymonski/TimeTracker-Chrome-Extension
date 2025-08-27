// Domain Time Tracker — background.js (MV3 service worker)
// Tracks time spent on the active tab's domain, pausing on window blur or system idle/lock.
// Stores totals per-UTC-day in chrome.storage.local under:
// { statsByDay: { [YYYY-MM-DD]: { [domain]: seconds } } }

const STORAGE_KEYS = { STATS: 'statsByDay' };

const STATE = {
  current: {
    isTiming: false,
    tabId: null,
    windowId: null,
    domain: null,
    startMs: null,      // when timing for current domain started
    isFocused: true,    // Chrome window focus
    isIdle: false,      // system idle/locked
  },
  _recomputePending: false, // debounce to coalesce event bursts
};

// ---- Date helpers (UTC) ----
function todayKeyUTC() { return new Date().toISOString().slice(0, 10); }
function dayKeyFromMs(ms) { return new Date(ms).toISOString().slice(0, 10); }
function endOfDayMsUTC(dayKey) { return Date.parse(`${dayKey}T23:59:59.999Z`); }
function nextDayKey(dayKey) {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---- URL / storage helpers ----
function domainFromUrl(url) {
  try {
    const u = new URL(url);
    // Track only http(s) pages; ignore chrome://, chrome-extension://, etc.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

async function addSeconds(domain, seconds, dayKey = todayKeyUTC()) {
  if (!domain || seconds <= 0) return;
  const { [STORAGE_KEYS.STATS]: stats = {} } = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  if (!stats[dayKey]) stats[dayKey] = {};
  stats[dayKey][domain] = (stats[dayKey][domain] || 0) + Math.round(seconds);
  await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
}

// ---- Icon ----
function updateIcon(active) {
  const path = active
    ? { 128: "icons/icon128-active.png" }
    : { 128: "icons/icon128-inactive.png" };
  chrome.action.setIcon({ path }).catch(err => console.warn('setIcon failed:', err));
}

// ---- Stop timing (split across UTC day boundaries) ----
function stopTiming(reason = 'unknown') {
  if (!STATE.current.isTiming) return;

  const now = Date.now();
  const { domain, startMs } = STATE.current;

  // Sanity guard: if state is inconsistent, bail safely
  if (!domain || !startMs) {
    console.warn('[DTT] stopTiming: inconsistent state', { domain, startMs, reason });
    STATE.current.isTiming = false;
    STATE.current.startMs = null;
    updateIcon(false);
    return;
  }

  let cursorMs = startMs;
  let cursorDay = dayKeyFromMs(cursorMs);
  const nowDay = dayKeyFromMs(now);

  if (cursorDay === nowDay) {
    const deltaSec = (now - cursorMs) / 1000;
    addSeconds(domain, deltaSec, cursorDay).catch(console.error);
  } else {
    while (cursorDay !== nowDay) {
      const endMs = endOfDayMsUTC(cursorDay);
      const deltaSec = (endMs - cursorMs + 1) / 1000;
      addSeconds(domain, deltaSec, cursorDay).catch(console.error);

      cursorDay = nextDayKey(cursorDay);
      const startNextMs = endMs + 1;
      if (cursorDay === nowDay) {
        const tailSec = (now - startNextMs) / 1000;
        addSeconds(domain, tailSec, cursorDay).catch(console.error);
      } else {
        cursorMs = startNextMs;
      }
    }
  }

  STATE.current.startMs = null;
  STATE.current.isTiming = false;
  updateIcon(false);
  //console.log('[DTT] stopTiming:', reason);
}

// ---- Central, idempotent decision-maker ----
// Decides whether we should be timing right now and starts/stops accordingly.
async function recomputeTracking(reason = 'event') {
  //console.log('[DTT] recomputeTracking:', reason);
  // Debounce bursts (activated -> updated -> focus, etc.)
  if (STATE._recomputePending) return;
  STATE._recomputePending = true;
  setTimeout(async () => {
    STATE._recomputePending = false;

    const canTrack = STATE.current.isFocused && !STATE.current.isIdle;

    let activeTab = null;
    if (canTrack) {
      try {
        const arr = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        activeTab = arr && arr[0];
      } catch (e) {
        console.warn('[DTT] tabs.query failed:', e);
      }
    }
    let newDomain = null, newTabId = null, newWindowId = null;
    if (activeTab?.url) {
      newDomain = domainFromUrl(activeTab.url);
      newTabId = activeTab.id;
      newWindowId = activeTab.windowId;
    }
    const currentlyTiming = STATE.current.isTiming && !!STATE.current.startMs && !!STATE.current.domain;

    // Case A: Can't or shouldn't track (blurred, idle, or non-http(s) page)
    if (!canTrack || !newDomain) {
      if (currentlyTiming) stopTiming(`pause:${reason}`);
      STATE.current.isTiming = false;
      updateIcon(false);
      return;
    }
    // Case B: We can/should track; see if this is a continuation or a switch
    const sameTab = STATE.current.tabId === newTabId;
    const sameDomain = STATE.current.domain === newDomain;

    if (currentlyTiming && sameTab && sameDomain) {
      // Already timing the correct thing — no-op
      return;
    }
    // If timing something else, stop first
    //if (currentlyTiming) stopTiming(`switch:${reason}`);

    // Start new session
    STATE.current.tabId = newTabId;
    STATE.current.windowId = newWindowId;
    STATE.current.domain = newDomain;
    STATE.current.startMs = Date.now();
    STATE.current.isTiming = true;
    updateIcon(true);
    //console.log('[DTT] startTiming:', newDomain, 'reason:', reason);
  }, 0);
}

// ---- Idle detection setup ----
chrome.runtime.onInstalled.addListener(() => {
  updateIcon(false);
  chrome.idle.setDetectionInterval(60); // seconds (min 15)
  recomputeTracking('installed');
});

chrome.runtime.onStartup.addListener(() => {
  updateIcon(false);
  chrome.idle.setDetectionInterval(60);
  recomputeTracking('startup');
});

// ---- Event wiring ----

// Active tab changed
chrome.tabs.onActivated.addListener(() => {
  STATE.current.isFocused = true;
  recomputeTracking('tabs.onActivated');
});

// Active tab navigated (URL/status may fire multiple times; we just recompute)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab?.active) return;
  if (changeInfo.url || changeInfo.status === 'complete') {
    STATE.current.isFocused = true;
    recomputeTracking('tabs.onUpdated');
  }
});

// Check if non-chrome window is clicked
setInterval(() => {
    chrome.windows.getCurrent((window) => {
        if (window.focused.toString()) {
          recomputeTracking('windows.onChromeWindowFocusChanged');
        }
    });
}, 10000);

// Chrome window focus changes (works only when switching between Chrome windows)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    try {
      const window = await chrome.windows.get(windowId);
      // Ignore popup windows (extension popup)
      if (window.type === 'popup') {
        return;
      }
    } catch (e) {
      console.warn('[DTT] windows.get failed:', e);
    }
  }
  STATE.current.isFocused = (windowId !== chrome.windows.WINDOW_ID_NONE);
  recomputeTracking('windows.onFocusChanged');
});

// System idle/locked/active
chrome.idle.onStateChanged.addListener((newState) => {
  const idleNow = newState === 'idle' || newState === 'locked';
  STATE.current.isIdle = idleNow;
  recomputeTracking('idle.onStateChanged');
});

// Tab closed/detached: if it was the tracked tab, stop and recompute
chrome.tabs.onRemoved.addListener((tabId) => {
  if (STATE.current.tabId === tabId) {
    stopTiming('tabs.onRemoved');
    STATE.current.tabId = null;
    STATE.current.domain = null;
    recomputeTracking('tabs.onRemoved');
  }
});

chrome.tabs.onDetached.addListener((tabId) => {
  if (STATE.current.tabId === tabId) {
    stopTiming('tabs.onDetached');
    STATE.current.tabId = null;
    STATE.current.domain = null;
    recomputeTracking('tabs.onDetached');
  }
});

// ---- Popup/status API ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'getCurrentTracking') {
    const elapsed = (STATE.current.isTiming && STATE.current.startMs)
      ? Math.max(0, Math.floor((Date.now() - STATE.current.startMs) / 1000))
      : 0;
    sendResponse({
      isTiming: STATE.current.isTiming,
      domain: STATE.current.domain,
      elapsedSeconds: elapsed,
      isFocused: STATE.current.isFocused,
      isIdle: STATE.current.isIdle,
      tabId: STATE.current.tabId,
      windowId: STATE.current.windowId,
      startMs: STATE.current.startMs,
      nowMs: Date.now(),
    });
    return true;
  }
});

// setInterval(() => {
//   console.log(
//     "IsTiming:", STATE.current.isTiming, 
//     "IsIdle:", STATE.current.isIdle,
//     "isFocused:", STATE.current.isFocused
//   );
// }, 1000);
