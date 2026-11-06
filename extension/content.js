(() => {
  const CAPTION_SELECTOR = ".ytp-caption-segment";
  const WORD_CLASS = "qlookup-word";

  // Prevent duplicate initialization.
  if (window.__qlookupInitialized) return;
  window.__qlookupInitialized = true;

  // -----------------------------
  // 1. Styles
  // -----------------------------
  const style = document.createElement("style");

  style.textContent = `
    .${WORD_CLASS} {
      cursor: pointer;
      border-radius: 3px;
      transition: background-color 0.12s;
    }

    .${WORD_CLASS}:hover {
      background-color: rgba(255, 255, 255, 0.3);
    }

    #qlookup-popup {
      position: fixed;
      width: 300px;
      max-width: calc(100vw - 16px);
      box-sizing: border-box;
      padding: 16px;
      background: #202124;
      color: #ffffff;
      border: 1px solid #444;
      border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      font-family: Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      z-index: 2147483647;
    }

    #qlookup-popup .qlookup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    #qlookup-popup .qlookup-title {
      font-size: 20px;
      font-weight: bold;
      overflow-wrap: anywhere;
    }

    #qlookup-popup .qlookup-close {
      border: none;
      background: transparent;
      color: #cccccc;
      font-size: 22px;
      cursor: pointer;
    }

    #qlookup-popup .qlookup-meaning {
      margin: 16px 0;
      color: #cccccc;
    }

    #qlookup-popup .qlookup-link {
      display: block;
      padding: 10px;
      border-radius: 6px;
      background: #3b4658;
      color: white;
      text-decoration: none;
      text-align: center;
      font-weight: bold;
    }

    #qlookup-popup .qlookup-link:hover {
      background: #52617a;
    }
  `;

  document.head.appendChild(style);

  // -----------------------------
  // 2. Make caption words clickable
  // -----------------------------
  function wrapWords(segment) {
    if (segment.dataset.qlookupProcessed === "true") {
      return;
    }

    const text = segment.textContent;

    if (!text || !text.trim()) return;

    const fragment = document.createDocumentFragment();
    const parts = text.split(/(\s+)/u);

    for (const part of parts) {
      if (!part) continue;

      if (/^\s+$/u.test(part)) {
        fragment.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement("span");

        span.className = WORD_CLASS;
        span.textContent = part;

        fragment.appendChild(span);
      }
    }

    segment.replaceChildren(fragment);
    segment.dataset.qlookupProcessed = "true";
  }

  function processCaptions() {
    document.querySelectorAll(CAPTION_SELECTOR).forEach(wrapWords);
  }

  // -----------------------------
  // 3. Create the popup
  // -----------------------------
  let currentPopup = null;

  function closePopup() {
    if (currentPopup) {
      currentPopup.remove();
      currentPopup = null;
    }
  }

  function showPopup(wordElement) {
    closePopup();

    // Remove punctuation around the selected word.
    const cleanWord = wordElement.textContent.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

    if (!cleanWord) return;

    const popup = document.createElement("div");
    popup.id = "qlookup-popup";

    // Title
    const header = document.createElement("div");
    header.className = "qlookup-header";

    const title = document.createElement("div");
    title.className = "qlookup-title";
    title.textContent = cleanWord;

    const closeButton = document.createElement("button");
    closeButton.className = "qlookup-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close popup");
    closeButton.addEventListener("click", closePopup);

    header.append(title, closeButton);

    // Meaning placeholder
    const meaning = document.createElement("div");
    meaning.className = "qlookup-meaning";
    meaning.textContent = "AI explanation coming soon...";

    // Cambridge Dictionary link
    const link = document.createElement("a");
    link.className = "qlookup-link";
    link.textContent = "Cambridge Dictionary ↗";

    link.href =
      "https://dictionary.cambridge.org/dictionary/english/" +
      encodeURIComponent(cleanWord.toLowerCase());

    link.target = "_blank";
    link.rel = "noopener noreferrer";

    popup.append(header, meaning, link);

    // Attach popup to YouTube player if fullscreen.
    const fullscreenElement = document.fullscreenElement;
    const container = fullscreenElement || document.body;

    container.appendChild(popup);

    // Center the popup above the word, with a 12px gap.
    const wordRect = wordElement.getBoundingClientRect();
    const rect = popup.getBoundingClientRect();
    const centeredLeft = wordRect.left + wordRect.width / 2 - rect.width / 2;
    const left = Math.max(8, Math.min(centeredLeft, window.innerWidth - rect.width - 8));

    const top = Math.max(
      8,
      Math.min(wordRect.top - rect.height - 2, window.innerHeight - rect.height - 8),
    );

    if (fullscreenElement) {
      const parentRect = container.getBoundingClientRect();
      popup.style.left = `${left - parentRect.left}px`;
      popup.style.top = `${top - parentRect.top}px`;
      popup.style.position = "absolute";
    } else {
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    }

    currentPopup = popup;
  }

  // -----------------------------
  // 4. Handle clicks
  // -----------------------------
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;

      // Clicking inside the popup should not close it.
      if (event.target.closest("#qlookup-popup")) {
        return;
      }

      const wordElement = event.target.closest(`.${WORD_CLASS}`);

      if (wordElement) {
        event.stopPropagation();

        showPopup(wordElement);
      } else {
        closePopup();
      }
    },
    true,
  );

  // Close popup with Escape.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopup();
  });

  // -----------------------------
  // 5. Watch caption changes
  // -----------------------------
  const observer = new MutationObserver((mutations) => {
    const captionChanged = mutations.some((mutation) => {
      const target = mutation.target;

      if (!(target instanceof Element)) {
        return target.parentElement?.closest(".ytp-caption-window-container");
      }

      return (
        target.closest(".ytp-caption-window-container") ||
        [...mutation.addedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches(".ytp-caption-window-container") ||
              node.querySelector(".ytp-caption-window-container")),
        )
      );
    });

    if (captionChanged) {
      processCaptions();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  processCaptions();

  console.log("Language Qlookup is running!");
})();
