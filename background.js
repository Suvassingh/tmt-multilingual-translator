
importScripts("config.js");
const TMT_API_BASE = TMT_CONFIG.API_URL;
const DEFAULT_KEY = TMT_CONFIG.API_KEY;
const MAX_HISTORY = 50;

//  Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tmt-translate-selection",
    title: "🌐 Translate with TMT",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "tmt-translate-page",
    title: "🌐 Translate Entire Page (TMT)",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "tmt-translate-selection" && info.selectionText) {
    await chrome.storage.local.set({ pendingText: info.selectionText.trim() });
    chrome.action.openPopup().catch(() => {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#7c6aff" });
    });
  }
  if (info.menuItemId === "tmt-translate-page") {
    await chrome.storage.local.set({ pendingAction: "TRANSLATE_PAGE" });
    chrome.action.openPopup().catch(() => {
      chrome.action.setBadgeText({ text: "▶" });
      chrome.action.setBadgeBackgroundColor({ color: "#6affd4" });
    });
  }
});

//  Helpers 
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

//  Language Auto-Detection 
function detectLanguage(text) {
  const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
  const totalChars = text.replace(/\s/g, "").length;
  if (totalChars === 0) return "en";

  const devanagariRatio = devanagariCount / totalChars;
  if (devanagariRatio > 0.4) {
    
    return "ne"; 
  }
  return "en";
}

//  Central API Call with retry 
async function doTranslate(text, src_lang, tgt_lang, apiKey, attempt = 1) {
  try {
    const cleanKey = (apiKey || DEFAULT_KEY).toString().trim();
    const body = JSON.stringify({ text, src_lang, tgt_lang });

    const response = await fetch(TMT_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cleanKey,
      },
      body,
    });

    if (response.status === 429) {
      if (attempt <= 4) {
        const waitMs = attempt * 2000;
        console.warn(`[TMT] Rate limited. Retry ${attempt}/4 in ${waitMs}ms`);
        await sleep(waitMs);
        return doTranslate(text, src_lang, tgt_lang, cleanKey, attempt + 1);
      }
      return {
        success: false,
        error: "Rate limit exceeded. Please wait a moment and try again.",
      };
    }

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("[TMT] Non-JSON response:", raw.substring(0, 300));
      return {
        success: false,
        error: "Server error (HTTP " + response.status + ").",
      };
    }

    if (data.message_type === "SUCCESS") {
      // Save to history only if the user has the setting enabled
      chrome.storage.local.get("settings", (s) => {
        const saveHistoryEnabled = s.settings?.saveHistory !== false; // default true
        if (saveHistoryEnabled) {
          saveHistory({ src_lang, tgt_lang, input: text, output: data.output });
        }
      });
      return { success: true, output: data.output };
    } else {
      return { success: false, error: data.message || "Translation failed." };
    }
  } catch (err) {
    console.error("[TMT] Fetch error:", err);
    return { success: false, error: "Network error: " + err.message };
  }
}

//  History Management 
async function saveHistory(entry) {
  const data = await chrome.storage.local.get("history");
  const history = data.history || [];
  history.unshift({
    ...entry,
    timestamp: Date.now(),
    id: Date.now() + Math.random().toString(36).slice(2),
  });
  // Keep only last MAX_HISTORY items
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  await chrome.storage.local.set({ history });
}

//  Parallel batch translation 
async function translateBatch(
  texts,
  src_lang,
  tgt_lang,
  apiKey,
  concurrency = 3,
) {
  const results = new Array(texts.length);
  let index = 0;

  async function worker() {
    while (index < texts.length) {
      const i = index++;
      const res = await doTranslate(texts[i], src_lang, tgt_lang, apiKey);
      results[i] = res.success ? res.output : texts[i]; // fallback to original on fail
      await sleep(300); // gentle rate-limit buffer
    }
  }

  // Run `concurrency` workers in parallel
  const workers = Array.from({ length: concurrency }, worker);
  await Promise.all(workers);
  return results;
}

//  Message Listener \
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "TRANSLATE") {
    const { text, src_lang, tgt_lang, apiKey } = message;
    doTranslate(text, src_lang, tgt_lang, apiKey).then(sendResponse);
    return true;
  }

  if (message.action === "TRANSLATE_BATCH") {
    const { texts, src_lang, tgt_lang, apiKey, concurrency } = message;
    translateBatch(texts, src_lang, tgt_lang, apiKey, concurrency || 3)
      .then((outputs) => sendResponse({ success: true, outputs }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "DETECT_LANG") {
    sendResponse({ lang: detectLanguage(message.text) });
    return true;
  }

  if (message.action === "GET_HISTORY") {
    chrome.storage.local.get("history", (data) => {
      sendResponse({ history: data.history || [] });
    });
    return true;
  }

  if (message.action === "CLEAR_HISTORY") {
    chrome.storage.local.set({ history: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.action === "DELETE_HISTORY_ITEM") {
    chrome.storage.local.get("history", (data) => {
      const history = (data.history || []).filter((h) => h.id !== message.id);
      chrome.storage.local.set({ history }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (message.action === "STORE_PENDING_TEXT") {
    chrome.storage.local.set({ pendingText: message.text }, () => {
      chrome.action.openPopup().catch(() => {
        chrome.action.setBadgeText({ text: "!" });
        chrome.action.setBadgeBackgroundColor({ color: "#7c6aff" });
      });
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === "CLEAR_BADGE") {
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === "PING_API") {
    const key = (message.apiKey || DEFAULT_KEY).toString().trim();
    (async () => {
      try {
        const r = await fetch(TMT_API_BASE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + key,
          },
          body: JSON.stringify({
            text: "Hello",
            src_lang: "en",
            tgt_lang: "ne",
          }),
        });
        const text = await r.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          parsed = null;
        }
        if (parsed && parsed.message_type === "SUCCESS") {
          sendResponse({
            reachable: true,
            success: true,
            sample: "✓ API working! Sample: " + parsed.output,
          });
        } else {
          sendResponse({
            reachable: true,
            success: false,
            sample: "HTTP " + r.status + ": " + text.substring(0, 200),
          });
        }
      } catch (e) {
        sendResponse({
          reachable: false,
          success: false,
          sample: "Network error: " + e.message,
        });
      }
    })();
    return true;
  }

  sendResponse({ received: true });
  return true;
});

// Reset badge and pending action on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.storage.local.remove(["pageTranslated", "pendingAction"]);
    chrome.action.setBadgeText({ text: "" });
  }
});
