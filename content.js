
(function () {
  if (window.__tmtContentScriptLoaded) return;
  window.__tmtContentScriptLoaded = true;

  let originalTexts = [];
  let collectedNodes = [];
  let isTranslated = false;

  //  Tooltip setting cache 
  // Default true; updated from storage immediately and on every change.
  window.__tmtShowTooltip = true;
  chrome.storage.local.get("settings", (data) => {
    if (data.settings && typeof data.settings.showTooltip === "boolean") {
      window.__tmtShowTooltip = data.settings.showTooltip;
    }
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue) {
      const s = changes.settings.newValue;
      if (typeof s.showTooltip === "boolean") {
        window.__tmtShowTooltip = s.showTooltip;
        if (!s.showTooltip) removeTooltip();
      }
    }
  });

  //  Sidebar singleton 
  let sidebarElement = null;
  let sidebarOverlay = null;
  let currentOriginalText = "";
  let currentSrcLang = "en";
  let currentTgtLang = "ne";

  const LANG_FLAGS = { en: "🇬🇧", ne: "🇳🇵", tmg: "🏔" };
  const LANG_NAMES = { en: "English", ne: "Nepali", tmg: "Tamang" };
  const ALL_LANGS = ["en", "ne", "tmg"];

  function removeSidebar() {
    if (sidebarElement) {
      sidebarElement.remove();
      sidebarElement = null;
    }
    if (sidebarOverlay) {
      sidebarOverlay.remove();
      sidebarOverlay = null;
    }
  }

  function getOrCreateSidebar() {
    removeSidebar();

    sidebarOverlay = document.createElement("div");
    sidebarOverlay.id = "tmt-sidebar-overlay";
    sidebarOverlay.addEventListener("click", removeSidebar);
    document.body.appendChild(sidebarOverlay);

    sidebarElement = document.createElement("div");
    sidebarElement.id = "tmt-sidebar";
    sidebarElement.innerHTML = `
      <div class="tmt-sidebar-header">
        <span class="tmt-sidebar-title">🌐 TMT Translate</span>
        <button class="tmt-sidebar-close">✕</button>
      </div>
      <div class="tmt-sidebar-content">
        <div class="tmt-sidebar-label">Source <span class="tmt-sidebar-lang-pill tmt-src-lang" id="srcPillBtn" title="Click to change detected language"></span></div>
        <div class="tmt-sidebar-text original-text"></div>
        <div class="tmt-sidebar-label">Translation <span class="tmt-sidebar-lang-pill tmt-tgt-lang"></span></div>
        <div class="tmt-sidebar-text translated-text"></div>
        <button class="tmt-sidebar-copy">📋 Copy</button>
      </div>
      <div class="tmt-sidebar-error"></div>
      <div class="tmt-sidebar-loading" style="display:none">
        <div class="spinner-sidebar"></div>
        Translating…
      </div>
    `;

    // Close button
    sidebarElement
      .querySelector(".tmt-sidebar-close")
      .addEventListener("click", removeSidebar);

    // Source pill click handler – cycle languages
    const srcPill = sidebarElement.querySelector("#srcPillBtn");
    if (srcPill) {
      srcPill.style.cursor = "pointer";
      srcPill.addEventListener("click", async (e) => {
        e.stopPropagation();
        // Cycle to next language
        const currentIdx = ALL_LANGS.indexOf(currentSrcLang);
        const nextIdx = (currentIdx + 1) % ALL_LANGS.length;
        const newSrc = ALL_LANGS[nextIdx];
        if (newSrc === currentSrcLang) return;

        // Update current source
        currentSrcLang = newSrc;
        srcPill.textContent = `${LANG_FLAGS[newSrc]} ${LANG_NAMES[newSrc]}`;

        // Prevent source == target
        if (newSrc === currentTgtLang) {
          // Cycle target too (to avoid same lang)
          const tgtCurrentIdx = ALL_LANGS.indexOf(currentTgtLang);
          const newTgtIdx = (tgtCurrentIdx + 1) % ALL_LANGS.length;
          currentTgtLang = ALL_LANGS[newTgtIdx];
          const tgtPill = sidebarElement.querySelector(".tmt-tgt-lang");
          if (tgtPill) {
            tgtPill.textContent = `${LANG_FLAGS[currentTgtLang]} ${LANG_NAMES[currentTgtLang]}`;
          }
        }

        // Retranslate with new source (and possibly new target)
        await retranslate();
      });
    }

    document.body.appendChild(sidebarElement);
    return sidebarElement;
  }

  async function retranslate() {
    if (!currentOriginalText || !sidebarElement) return;

    const s = sidebarElement;
    showSidebarLoading();

    chrome.storage.local.get(["apiKey"], async (items) => {
      const apiKey = (items.apiKey || "team_d4abce542db641e0")
        .toString()
        .trim();

      chrome.runtime.sendMessage(
        {
          action: "TRANSLATE",
          text: currentOriginalText,
          src_lang: currentSrcLang,
          tgt_lang: currentTgtLang,
          apiKey,
        },
        (transRes) => {
          if (chrome.runtime.lastError) {
            showSidebarError(
              "Extension error: " + chrome.runtime.lastError.message,
            );
            return;
          }
          if (transRes && transRes.success) {
            showSidebarResult(
              currentOriginalText,
              transRes.output,
              currentSrcLang,
              currentTgtLang,
            );
          } else {
            showSidebarError(transRes?.error || "Translation failed.");
          }
        },
      );
    });
  }

  function showSidebarLoading() {
    const s = sidebarElement;
    s.querySelector(".tmt-sidebar-loading").style.display = "block";
    s.querySelector(".tmt-sidebar-content").style.display = "none";
    s.querySelector(".tmt-sidebar-error").style.display = "none";
  }

  function showSidebarResult(original, translated, srcLang, tgtLang) {
    const s = sidebarElement;
    s.querySelector(".tmt-sidebar-loading").style.display = "none";
    const content = s.querySelector(".tmt-sidebar-content");
    content.style.display = "block";
    s.querySelector(".tmt-sidebar-error").style.display = "none";

    s.querySelector(".original-text").textContent = original;
    s.querySelector(".translated-text").textContent = translated;

    const srcPill = s.querySelector("#srcPillBtn");
    if (srcPill) {
      srcPill.textContent = `${LANG_FLAGS[srcLang]} ${LANG_NAMES[srcLang]}`;
    }

    const tgtPill = s.querySelector(".tmt-tgt-lang");
    if (tgtPill) {
      tgtPill.textContent = `${LANG_FLAGS[tgtLang]} ${LANG_NAMES[tgtLang]}`;
    }

    // Copy button logic (replaced each time to avoid duplicate listeners)
    const copyBtn = s.querySelector(".tmt-sidebar-copy");
    const newCopyBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
    newCopyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(translated).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = translated;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      });
      newCopyBtn.textContent = "✓ Copied!";
      setTimeout(() => {
        newCopyBtn.textContent = "📋 Copy";
      }, 1500);
    });
  }

  function showSidebarError(msg) {
    const s = sidebarElement;
    s.querySelector(".tmt-sidebar-loading").style.display = "none";
    s.querySelector(".tmt-sidebar-content").style.display = "none";
    const err = s.querySelector(".tmt-sidebar-error");
    err.style.display = "block";
    err.textContent = "⚠ " + (msg || "Translation failed.");
  }

  //  Get visible text nodes 
  function getTextNodes(root) {
    const walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (
            [
              "script",
              "style",
              "noscript",
              "code",
              "pre",
              "textarea",
              "input",
              "select",
              "option",
              "svg",
              "math",
            ].includes(tag)
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent.trim();
          if (!text || text.length < 2) return NodeFilter.FILTER_SKIP;
          if (/^[\d\s\W]+$/.test(text)) return NodeFilter.FILTER_SKIP;
          try {
            const style = window.getComputedStyle(parent);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              parseFloat(style.opacity) === 0
            )
              return NodeFilter.FILTER_REJECT;
          } catch (e) {}
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function flashHighlight(element) {
    if (!element) return;
    const prev = element.style.transition;
    element.style.transition = "background-color 0.5s ease";
    element.style.backgroundColor = "rgba(106, 255, 212, 0.12)";
    setTimeout(() => {
      element.style.backgroundColor = "";
      element.style.transition = prev;
    }, 1400);
  }

  //  Message listener 
  if (!chrome.runtime?.id) return;

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "GET_TEXT_NODES") {
        collectedNodes = getTextNodes(document.body);
        originalTexts = collectedNodes.map((n) => n.textContent);
        const texts = collectedNodes.map((n) => n.textContent.trim());
        sendResponse({ texts, count: texts.length });
        return true;
      }

      if (message.action === "SET_TRANSLATIONS") {
        const { translations } = message;
        if (!translations || translations.length !== collectedNodes.length) {
          sendResponse({ success: false, error: "Translation count mismatch" });
          return true;
        }
        collectedNodes.forEach((node, i) => {
          if (translations[i] && translations[i].trim()) {
            node.textContent = translations[i];
            if (node.parentElement) flashHighlight(node.parentElement);
          }
        });
        isTranslated = true;
        sendResponse({ success: true });
        return true;
      }

      if (message.action === "SET_TRANSLATION_PARTIAL") {
        const { index, translation } = message;
        if (collectedNodes[index] && translation) {
          collectedNodes[index].textContent = translation;
          if (collectedNodes[index].parentElement)
            flashHighlight(collectedNodes[index].parentElement);
        }
        sendResponse({ success: true });
        return true;
      }

      if (message.action === "RESTORE_ORIGINAL") {
        if (!isTranslated || collectedNodes.length === 0) {
          sendResponse({ success: true });
          return true;
        }
        collectedNodes.forEach((node, i) => {
          if (originalTexts[i] !== undefined)
            node.textContent = originalTexts[i];
        });
        isTranslated = false;
        originalTexts = [];
        collectedNodes = [];
        sendResponse({ success: true });
        return true;
      }

      if (message.action === "GET_PAGE_STATS") {
        const body = document.body.innerText || "";
        const words = body
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0).length;
        const readingTime = Math.ceil(words / 200);
        sendResponse({ words, readingTime, title: document.title });
        return true;
      }

      if (message.action === "PING") {
        sendResponse({ alive: true });
        return true;
      }

      sendResponse({ received: true });
      return true;
    });
  } catch (e) {
    console.warn("[TMT] Could not register message listener:", e);
  }

  //  Selection tooltip 
  let tooltip = null;

  function removeTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  document.addEventListener("mouseup", (e) => {
    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      removeTooltip();
      if (!selectedText || selectedText.length < 2 || selectedText.length > 800)
        return;
      if (e.target && e.target.closest("#tmt-tooltip")) return;

      // ──  the "Selection tooltip" setting ──
      // We read it synchronously from a cached value updated on storage change
      if (!window.__tmtShowTooltip) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const tooltipTop = rect.top + window.scrollY - 46;
      const tooltipLeft = rect.left + window.scrollX + rect.width / 2 - 70;

      tooltip = document.createElement("div");
      tooltip.id = "tmt-tooltip";

      const wordCount = selectedText.split(/\s+/).filter((w) => w).length;
      tooltip.innerHTML = `<span class="tmt-icon">🌐</span> Translate <span class="tmt-badge">${wordCount}w</span>`;
      tooltip.style.cssText = `
        position: absolute;
        top: ${Math.max(tooltipTop, window.scrollY + 5)}px;
        left: ${Math.max(tooltipLeft, 5)}px;
        background: linear-gradient(135deg, #13131a, #1c1c2e);
        color: #6affd4;
        border: 1px solid rgba(124,106,255,0.4);
        border-radius: 10px;
        padding: 6px 14px;
        font-size: 12px;
        font-family: -apple-system, 'Syne', sans-serif;
        font-weight: 700;
        cursor: pointer;
        z-index: 2147483647;
        box-shadow: 0 4px 20px rgba(106,255,212,0.15), 0 2px 8px rgba(0,0,0,0.6);
        letter-spacing: 0.3px;
        white-space: nowrap;
        transition: all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
        user-select: none;
        display: flex;
        align-items: center;
        gap: 6px;
        backdrop-filter: blur(10px);
      `;

      tooltip.addEventListener("mouseenter", () => {
        tooltip.style.transform = "translateY(-2px) scale(1.03)";
        tooltip.style.boxShadow =
          "0 8px 25px rgba(106,255,212,0.25), 0 4px 12px rgba(0,0,0,0.7)";
      });
      tooltip.addEventListener("mouseleave", () => {
        tooltip.style.transform = "";
        tooltip.style.boxShadow =
          "0 4px 20px rgba(106,255,212,0.15), 0 2px 8px rgba(0,0,0,0.6)";
      });

      tooltip.addEventListener("mousedown", (ev) => ev.preventDefault());

      // ── INSTANT SIDEBAR WITH CLICKABLE SOURCE PILL ──
      tooltip.addEventListener("click", () => {
        removeTooltip();
        if (!chrome.runtime?.id) return;

        const selected = selectedText;
        currentOriginalText = selected; // store for later re-translation

        const sidebar = getOrCreateSidebar();
        showSidebarLoading();

        // 1. Detect the source language
        chrome.runtime.sendMessage(
          { action: "DETECT_LANG", text: selected },
          (detectRes) => {
            let detectedSrc = detectRes?.lang || "en";
            currentSrcLang = detectedSrc;

            // 2. Read the user’s preferred target from popup
            chrome.storage.local.get(["apiKey", "targetLang"], (items) => {
              let apiKey = (items.apiKey || "team_d4abce542db641e0")
                .toString()
                .trim();
              let target = items.targetLang || "ne";
              currentTgtLang = target;

              // 3. If detected == target, pick a fallback
              if (detectedSrc === target) {
                if (target === "en") currentTgtLang = "ne";
                else if (target === "ne") currentTgtLang = "en";
                else if (target === "tmg") currentTgtLang = "en";
              }

              // 4. Perform translation
              chrome.runtime.sendMessage(
                {
                  action: "TRANSLATE",
                  text: selected,
                  src_lang: currentSrcLang,
                  tgt_lang: currentTgtLang,
                  apiKey,
                },
                (transRes) => {
                  if (chrome.runtime.lastError) {
                    showSidebarError(
                      "Extension error: " + chrome.runtime.lastError.message,
                    );
                    return;
                  }
                  if (transRes && transRes.success) {
                    showSidebarResult(
                      selected,
                      transRes.output,
                      currentSrcLang,
                      currentTgtLang,
                    );
                  } else {
                    showSidebarError(transRes?.error || "Translation failed.");
                  }
                },
              );
            });
          },
        );
      });

      document.body.appendChild(tooltip);
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (tooltip && e.target !== tooltip && !tooltip.contains(e.target))
      removeTooltip();
  });
  document.addEventListener("scroll", removeTooltip, { passive: true });
})();
