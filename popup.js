

const DEFAULT_KEY = TMT_CONFIG.API_KEY;
const LANG_NAMES = { en: "English", ne: "Nepali", tmg: "Tamang" };
const LANG_FLAGS = { en: "🇬🇧", ne: "🇳🇵", tmg: "🏔" };


let apiKey = DEFAULT_KEY;
let pageTranslated = false;
let detectedLang = null;
let settings = {
  autoDetect: true,
  saveHistory: true,
  showTooltip: true,
};

//  DOM refs 
const $ = (id) => document.getElementById(id);

const sourceLang = $("sourceLang");
const targetLang = $("targetLang");
const swapBtn = $("swapBtn");
const inputText = $("inputText");
const outputText = $("outputText");
const translateBtn = $("translateBtn");
const spinner = $("spinner");
const btnText = $("btnText");
const statusBar = $("statusBar");
const charCount = $("charCount");
const textStats = $("textStats");
const statWords = $("statWords");
const statChars = $("statChars");
const statRead = $("statRead");
const translatePageBtn = $("translatePageBtn");
const copyBtn = $("copyBtn");
const exportBtn = $("exportBtn");
const clearBtn = $("clearBtn");
const diagBtn = $("diagBtn");
const pageBar = $("pageBar");
const pageBarLang = $("pageBarLang");
const restorePageBtn = $("restorePageBtn");
const progressWrap = $("progressWrap");
const progressFill = $("progressFill");
const progressLabel = $("progressLabel");
const historyList = $("historyList");
const histBadge = $("histBadge");
const clearHistBtn = $("clearHistBtn");
const apiKeyInput = $("apiKeyInput");
const saveKeyBtn = $("saveKeyBtn");
const testApiBtn = $("testApiBtn");
const apiDot = $("apiDot");
const apiDotLabel = $("apiDotLabel");
const apiStatusDot = $("apiStatusDot");
const apiStatusText = $("apiStatusText");
const autoDetectBar = $("autoDetectBar");
const autoDetectMsg = $("autoDetectMsg");
const applyDetectBtn = $("applyDetectBtn");
const pendingNotice = $("pendingNotice");
const toggleAutoDetect = $("toggleAutoDetect");
const toggleHistory = $("toggleHistory");
const toggleTooltip = $("toggleTooltip");
const settingsTabBtn = $("settingsTabBtn");

//  Tab system 
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});
settingsTabBtn.addEventListener("click", () => switchTab("settings"));

function switchTab(name) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
  if (name === "history") loadHistory();
}

//  Char counter + stats 
inputText.addEventListener("input", () => {
  const val = inputText.value;
  const len = val.length;
  charCount.textContent = `${len} / 1000`;
  charCount.style.color = len > 900 ? "var(--red)" : "var(--text3)";

  // Live stats
  if (val.trim()) {
    const words = val
      .trim()
      .split(/\s+/)
      .filter((w) => w).length;
    statWords.textContent = words;
    statChars.textContent = len;
    statRead.textContent =
      words < 200 ? `<1min` : `~${Math.ceil(words / 200)}min`;
    textStats.style.display = "flex";
  } else {
    textStats.style.display = "none";
  }

  // Auto-detect language
  if (settings.autoDetect && len > 5) {
    chrome.runtime.sendMessage({ action: "DETECT_LANG", text: val }, (res) => {
      if (res && res.lang && res.lang !== sourceLang.value) {
        detectedLang = res.lang;
        autoDetectMsg.textContent = `Detected: ${LANG_FLAGS[res.lang]} ${LANG_NAMES[res.lang]}`;
        autoDetectBar.classList.add("visible");
      } else {
        autoDetectBar.classList.remove("visible");
      }
    });
  } else {
    autoDetectBar.classList.remove("visible");
  }
});

applyDetectBtn.addEventListener("click", () => {
  if (!settings.autoDetect) {
    autoDetectBar.classList.remove("visible");
    return;
  }
  if (detectedLang && detectedLang !== targetLang.value) {
    sourceLang.value = detectedLang;
    autoDetectBar.classList.remove("visible");
    savePreferences();
  }
});

//  Init 
chrome.storage.local.get(
  [
    "apiKey",
    "sourceLang",
    "targetLang",
    "pendingText",
    "pendingAction",
    "settings",
  ],
  (data) => {
    // API key
    if (data.apiKey) apiKey = data.apiKey;
    apiKeyInput.value = apiKey;

    // Languages
    if (data.sourceLang) sourceLang.value = data.sourceLang;
    if (data.targetLang) targetLang.value = data.targetLang;

    // Settings
    if (data.settings) {
      settings = { ...settings, ...data.settings };
      toggleAutoDetect.checked = settings.autoDetect;
      toggleHistory.checked = settings.saveHistory;
      toggleTooltip.checked = settings.showTooltip;
    }

    // Clear badge
    chrome.runtime.sendMessage({ action: "CLEAR_BADGE" });

    // Pending text from selection
    if (data.pendingText) {
      inputText.value = data.pendingText;
      charCount.textContent = `${data.pendingText.length} / 1000`;
      chrome.storage.local.remove("pendingText");
      pendingNotice.classList.add("visible");
      setTimeout(() => pendingNotice.classList.remove("visible"), 3000);
      setStatus("✓ Text loaded — press Translate!", "success");
    }

    // Pending page translate from context menu
    if (data.pendingAction === "TRANSLATE_PAGE") {
      chrome.storage.local.remove("pendingAction");
      setTimeout(() => translatePage(), 350);
    }

    // Update history badge count
    updateHistoryBadge();

    // Quick API ping on load (silent)
    silentApiPing();
  },
);

function silentApiPing() {
  chrome.runtime.sendMessage({ action: "PING_API", apiKey }, (res) => {
    if (res && res.success) {
      apiDot.className = "api-dot ok";
      apiStatusDot.className = "api-status-dot ok";
      apiStatusText.textContent = "API connected";
    } else {
      apiDot.className = "api-dot err";
      apiStatusDot.className = "api-status-dot err";
      apiStatusText.textContent = "API unreachable";
    }
  });
}

//  Translation core 
function translateViaBackground(text, src, tgt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "TRANSLATE", text, src_lang: src, tgt_lang: tgt, apiKey },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success) resolve(response.output);
        else
          reject(new Error((response && response.error) || "Unknown error."));
      },
    );
  });
}

function splitSentences(text) {
  const parts = text.match(/[^.!?।॥\n]+[.!?।॥\n]*/g) || [text];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateParagraph(text, src, tgt) {
  const sentences = splitSentences(text);
  const results = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i > 0) await delay(400);
    const out = await translateViaBackground(sentences[i], src, tgt);
    results.push(out);
  }
  return results.join(" ");
}

//  Translate button 
translateBtn.addEventListener("click", doTranslate);

async function doTranslate() {
  const text = inputText.value.trim();
  if (!text) {
    setStatus("⚠ Enter some text first.", "error");
    return;
  }
  if (sourceLang.value === targetLang.value) {
    setStatus("⚠ Source and target must differ.", "error");
    return;
  }

  setLoading(true);
  setStatus("Translating…", "");
  outputText.value = "";

  try {
    const result = await translateParagraph(
      text,
      sourceLang.value,
      targetLang.value,
    );
    outputText.value = result;
    setStatus(
      `✓ ${LANG_NAMES[sourceLang.value]} → ${LANG_NAMES[targetLang.value]}`,
      "success",
    );
    if (settings.saveHistory) {
      setTimeout(() => updateHistoryBadge(), 800);
    }
  } catch (err) {
    setStatus("⚠ " + err.message, "error");
  } finally {
    setLoading(false);
  }
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (
    document.activeElement === inputText &&
    e.key === "Enter" &&
    (e.ctrlKey || e.metaKey)
  ) {
    e.preventDefault();
    doTranslate();
  }
  if (e.ctrlKey && e.key === "l") {
    e.preventDefault();
    clearBtn.click();
  }
  if (e.ctrlKey && e.key === "ArrowUp") {
    e.preventDefault();
    swapBtn.click();
  }
  if (e.ctrlKey && e.shiftKey && e.key === "C") {
    e.preventDefault();
    copyBtn.click();
  }
});

//  Language controls 
swapBtn.addEventListener("click", () => {
  if (sourceLang.value === targetLang.value) return;
  const [src, tgt] = [sourceLang.value, targetLang.value];
  sourceLang.value = tgt;
  targetLang.value = src;
  const tmp = inputText.value;
  inputText.value = outputText.value;
  outputText.value = tmp;
  charCount.textContent = `${inputText.value.length} / 1000`;
  savePreferences();
  setStatus(`Swapped: ${LANG_NAMES[tgt]} ↔ ${LANG_NAMES[src]}`, "success");
});

sourceLang.addEventListener("change", () => {
  if (sourceLang.value === targetLang.value) {
    targetLang.value = Object.keys(LANG_NAMES).find(
      (k) => k !== sourceLang.value,
    );
  }
  savePreferences();
});
targetLang.addEventListener("change", () => {
  if (sourceLang.value === targetLang.value) {
    sourceLang.value = Object.keys(LANG_NAMES).find(
      (k) => k !== targetLang.value,
    );
  }
  savePreferences();
});
function savePreferences() {
  chrome.storage.local.set({
    sourceLang: sourceLang.value,
    targetLang: targetLang.value,
  });
}

//  Copy & Export 
copyBtn.addEventListener("click", async () => {
  const text = outputText.value.trim();
  if (!text) {
    setStatus("⚠ Nothing to copy.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("✓ Copied to clipboard!", "success");
  } catch (e) {
    outputText.select();
    document.execCommand("copy");
    setStatus("✓ Copied!", "success");
  }
});

exportBtn.addEventListener("click", () => {
  const input = inputText.value.trim();
  const output = outputText.value.trim();
  if (!output) {
    setStatus("⚠ Nothing to export.", "error");
    return;
  }
  const src = LANG_NAMES[sourceLang.value];
  const tgt = LANG_NAMES[targetLang.value];
  const ts = new Date().toLocaleString();
  const content = [
    `TMT Translation Export`,
    `Generated: ${ts}`,
    `Direction: ${src} → ${tgt}`,
    ``,
    `[${src}]`,
    input,
    ``,
    `[${tgt}]`,
    output,
    ``,
    `Powered by TMT API · ILPRL, Kathmandu University`,
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tmt-translation-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("✓ Exported as .txt!", "success");
});

clearBtn.addEventListener("click", () => {
  inputText.value = "";
  outputText.value = "";
  charCount.textContent = "0 / 1000";
  textStats.style.display = "none";
  autoDetectBar.classList.remove("visible");
  setStatus("", "");
});

//  Page Translation (parallel batching) 
translatePageBtn.addEventListener("click", async () => {
  if (pageTranslated) {
    restorePage();
    return;
  }
  translatePage();
});

async function translatePage() {
  if (sourceLang.value === targetLang.value) {
    setStatus("⚠ Languages must differ.", "error");
    return;
  }

  setStatus("Scanning page…", "");
  translatePageBtn.disabled = true;
  translatePageBtn.textContent = "⏳ Scanning…";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // Ensure content script is alive
    let pingOk = false;
    try {
      const p = await chrome.tabs.sendMessage(tab.id, { action: "PING" });
      pingOk = p && p.alive;
    } catch (e) {}

    if (!pingOk) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await delay(250);
    }

    const resp = await chrome.tabs.sendMessage(tab.id, {
      action: "GET_TEXT_NODES",
    });
    if (!resp?.texts?.length)
      throw new Error("No translatable text found on this page.");

    const { texts } = resp;

    // Use background TRANSLATE_BATCH with concurrency=3 for speed
    progressWrap.classList.add("visible");
    progressFill.style.width = "0%";

    const CHUNK = 10; // send chunks to background
    const translations = new Array(texts.length);
    let done = 0;

    for (let i = 0; i < texts.length; i += CHUNK) {
      const slice = texts.slice(i, i + CHUNK);
      const batchResult = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: "TRANSLATE_BATCH",
            texts: slice,
            src_lang: sourceLang.value,
            tgt_lang: targetLang.value,
            apiKey,
            concurrency: 3,
          },
          (res) => {
            if (chrome.runtime.lastError)
              reject(new Error(chrome.runtime.lastError.message));
            else if (res.success) resolve(res.outputs);
            else reject(new Error(res.error));
          },
        );
      });

      for (let j = 0; j < batchResult.length; j++) {
        translations[i + j] = batchResult[j];
      }
      done = Math.min(i + CHUNK, texts.length);
      const pct = Math.round((done / texts.length) * 100);
      progressFill.style.width = pct + "%";
      progressLabel.textContent = `${done} / ${texts.length} nodes · ${pct}%`;
      setStatus(`Translating page… ${done}/${texts.length}`, "");

      if (i + CHUNK < texts.length) await delay(200);
    }

    await chrome.tabs.sendMessage(tab.id, {
      action: "SET_TRANSLATIONS",
      translations,
    });

    pageTranslated = true;
    pageBarLang.textContent = LANG_NAMES[targetLang.value];
    pageBar.classList.add("visible");
    translatePageBtn.textContent = "↩ Restore";
    translatePageBtn.classList.add("active-page");
    translatePageBtn.disabled = false;
    progressWrap.classList.remove("visible");
    setStatus(
      `✓ Page translated to ${LANG_NAMES[targetLang.value]}`,
      "success",
    );
  } catch (err) {
    setStatus("⚠ " + err.message, "error");
    translatePageBtn.textContent = "🌐 Page";
    translatePageBtn.classList.remove("active-page");
    translatePageBtn.disabled = false;
    progressWrap.classList.remove("visible");
  }
}

async function restorePage() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await chrome.tabs.sendMessage(tab.id, { action: "RESTORE_ORIGINAL" });
    pageTranslated = false;
    pageBar.classList.remove("visible");
    translatePageBtn.textContent = "🌐 Page";
    translatePageBtn.classList.remove("active-page");
    translatePageBtn.disabled = false;
    setStatus("✓ Page restored.", "success");
  } catch (err) {
    setStatus("⚠ " + err.message, "error");
  }
}

restorePageBtn.addEventListener("click", restorePage);

//  API Test 
diagBtn.addEventListener("click", runApiTest);
testApiBtn.addEventListener("click", runApiTest);

function runApiTest() {
  setStatus("Testing API…", "");
  diagBtn.disabled = true;
  testApiBtn.disabled = true;
  testApiBtn.textContent = "⏳ Testing…";

  chrome.runtime.sendMessage({ action: "PING_API", apiKey }, (res) => {
    diagBtn.disabled = false;
    testApiBtn.disabled = false;
    testApiBtn.textContent = "🔬 Test API Connection";

    if (chrome.runtime.lastError) {
      setStatus(
        "⚠ Background error: " + chrome.runtime.lastError.message,
        "error",
      );
      return;
    }
    if (res && res.success) {
      apiDot.className = "api-dot ok";
      apiStatusDot.className = "api-status-dot ok";
      apiStatusText.textContent = "Connected · " + res.sample;
      setStatus("✓ API is working correctly!", "success");
      outputText.value = res.sample;
    } else {
      apiDot.className = "api-dot err";
      apiStatusDot.className = "api-status-dot err";
      apiStatusText.textContent = "Failed — check key/network";
      setStatus("⚠ API test failed", "error");
    }
  });
}

//  History 
function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function loadHistory() {
  chrome.runtime.sendMessage({ action: "GET_HISTORY" }, (res) => {
    const history = res?.history || [];
    updateHistoryBadge(history.length);

    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <div class="he-icon">📭</div>
          <div>No translations yet</div>
          <div style="color:var(--text3);margin-top:4px;font-size:11px">Your recent translations will appear here</div>
        </div>`;
      return;
    }

    historyList.innerHTML = "";
    history.forEach((item) => {
      const el = document.createElement("div");
      el.className = "history-item";
      const srcName = LANG_NAMES[item.src_lang] || item.src_lang;
      const tgtName = LANG_NAMES[item.tgt_lang] || item.tgt_lang;
      el.innerHTML = `
        <div class="history-item-langs">
          <span class="lang-pill">${srcName}</span>
          <span class="lang-arrow">→</span>
          <span class="lang-pill">${tgtName}</span>
          <span class="history-item-time">${formatTimeAgo(item.timestamp)}</span>
        </div>
        <div class="history-item-text" title="${item.input}">${item.input}</div>
        <div class="history-item-output" title="${item.output}">${item.output}</div>
        <button class="history-del" data-id="${item.id}" title="Delete">✕</button>
      `;

      // Click to load into translate tab
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("history-del")) return;
        inputText.value = item.input;
        outputText.value = item.output;
        sourceLang.value = item.src_lang;
        targetLang.value = item.tgt_lang;
        charCount.textContent = `${item.input.length} / 1000`;
        switchTab("translate");
        setStatus(`✓ Loaded from history`, "success");
      });

      // Delete button
      el.querySelector(".history-del").addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage(
          { action: "DELETE_HISTORY_ITEM", id: item.id },
          () => {
            el.style.opacity = "0";
            el.style.transform = "translateX(-10px)";
            el.style.transition = "all 0.2s";
            setTimeout(() => loadHistory(), 200);
          },
        );
      });

      historyList.appendChild(el);
    });
  });
}

function updateHistoryBadge(count) {
  if (count === undefined) {
    chrome.runtime.sendMessage({ action: "GET_HISTORY" }, (res) => {
      const n = res?.history?.length || 0;
      histBadge.textContent = n;
      histBadge.style.display = n > 0 ? "inline-flex" : "none";
    });
    return;
  }
  histBadge.textContent = count;
  histBadge.style.display = count > 0 ? "inline-flex" : "none";
}

clearHistBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "CLEAR_HISTORY" }, () => loadHistory());
});

//  Settings panel 
saveKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus("⚠ API key cannot be empty.", "error");
    return;
  }
  apiKey = key;
  chrome.storage.local.set({ apiKey: key });
  setStatus("✓ API key saved!", "success");
  silentApiPing();
});

[toggleAutoDetect, toggleHistory, toggleTooltip].forEach((t) => {
  t.addEventListener("change", () => {
    settings.autoDetect = toggleAutoDetect.checked;
    settings.saveHistory = toggleHistory.checked;
    settings.showTooltip = toggleTooltip.checked;
    chrome.storage.local.set({ settings });

    // Hide auto-detect bar immediately if auto-detect is turned off
    if (!settings.autoDetect) {
      autoDetectBar.classList.remove("visible");
    }

    // Refresh history badge to reflect current saveHistory state
    if (settings.saveHistory) {
      updateHistoryBadge();
    } else {
      histBadge.style.display = "none";
    }
  });
});

//  Helpers 
function setLoading(on) {
  translateBtn.disabled = on;
  spinner.classList.toggle("active", on);
  btnText.textContent = on ? "Translating…" : "Translate";
}
function setStatus(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = "status-bar" + (type ? ` ${type}` : "");
}
