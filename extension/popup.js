(() => {
  function popupPlacement(anchor, width, height, viewportWidth, viewportHeight, headerBottom) {
    const margin = 8;
    const gap = 10;
    const topEdge = Math.min(viewportHeight - margin, Math.max(margin, headerBottom + margin));
    const above = Math.max(0, Math.min(anchor.top - gap, viewportHeight - margin) - topEdge);
    const belowStart = Math.max(topEdge, anchor.bottom + gap);
    const below = Math.max(0, viewportHeight - margin - belowStart);
    const useAbove = height <= above || (height > below && above >= below);
    const available = useAbove ? above : below;
    const maxHeight = available || Math.max(0, viewportHeight - topEdge - margin);
    const top = !available ? topEdge : useAbove
      ? Math.min(anchor.top - gap, viewportHeight - margin) - Math.min(height, maxHeight)
      : belowStart;
    const center = (anchor.left + anchor.right - width) / 2;
    return {left: Math.max(margin, Math.min(center, viewportWidth - width - margin)), top, maxHeight};
  }
  let current;
  let frame = 0;
  let toastTimer;
  let toast;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function closePopup() {
    if (!current) return false;
    current.wait?.abort();
    current.video?.removeEventListener("play", closePopup);
    current.observer.disconnect();
    current.root.remove();
    current = null;
    cancelAnimationFrame(frame);
    frame = 0;
    return true;
  }

  function closeOnCaptionChange(caption) {
    if (!current || !caption) return;
    const selectedCaption = current.selection.caption.trim().replace(/\s+/gu, " ");
    if (caption !== selectedCaption) closePopup();
  }

  function updatePopupPosition() {
    if (current && !frame) frame = requestAnimationFrame(position);
  }

  function showCopied() {
    const player = document.fullscreenElement || document.querySelector("#movie_player");
    if (!player) return;
    if (!toast) {
      toast = element("div", "qlookup-copy-toast", "Copied");
      toast.setAttribute("role", "status");
    }
    player.append(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 1400);
  }

  function position() {
    frame = 0;
    const {root, body, reading, observer, getAnchor} = current;
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen || document.body;
    if (root.parentElement !== parent) parent.append(root);

    const anchor = current.anchor.isConnected && current.anchor.getClientRects().length
      ? current.anchor : getAnchor();
    if (anchor !== current.observedAnchor) {
      if (current.observedAnchor) observer.unobserve(current.observedAnchor);
      if (anchor) observer.observe(anchor);
      current.observedAnchor = anchor;
    }
    if (anchor) current.lastRect = anchor.getBoundingClientRect();
    if (!current.lastRect) return;
    const header = fullscreen ? null : document.querySelector("ytd-masthead");
    const headerRect = header?.getBoundingClientRect();
    const headerBottom = headerRect?.top <= 8 ? headerRect.bottom : 0;
    const placement = popupPlacement(
      current.lastRect, root.offsetWidth, body.offsetHeight + 2 + reading.scrollHeight - reading.clientHeight,
      document.documentElement.clientWidth, document.documentElement.clientHeight, headerBottom,
    );
    root.style.left = placement.left + "px";
    root.style.top = placement.top + "px";
    root.style.maxHeight = placement.maxHeight + "px";
  }

  async function load(view, regenerate) {
    view.status.textContent = "Looking up the meaning…";
    view.regenerate.disabled = true;
    view.refreshContext.disabled = view.selectContext.disabled = true;
    view.copyResult.disabled = true;
    view.result = null;
    view.partOfSpeech.textContent = "";
    view.coreMeaning.parentElement.hidden = true;
    view.expressionMeaning.parentElement.hidden = true;
    view.inContext.parentElement.hidden = true;
    let result;
    try {
      result = await chrome.runtime.sendMessage({type: "qlookup:explain", lookup: view.lookup, regenerate});
    } catch {
      result = null;
    }
    // The request can finish after another word was selected or the popup closed.
    if (current !== view) return;

    if (result?.ok) {
      view.result = result.value;
      view.copyResult.disabled = false;
      view.partOfSpeech.textContent = result.value.partOfSpeech;
      view.coreMeaning.textContent = result.value.coreMeaning;
      view.coreMeaning.parentElement.hidden = false;
      view.expressionTitle.textContent = "Expression: " + result.value.expression;
      view.expressionMeaning.textContent = result.value.expressionMeaning;
      view.expressionMeaning.parentElement.hidden = !result.value.expressionMeaning;
      view.inContext.textContent = result.value.inContext;
      view.inContext.parentElement.hidden = !result.value.inContext;
      view.status.textContent = "";
    } else {
      view.status.textContent = result?.message || "The lookup was interrupted. Retry, or reload the extension and refresh YouTube.";
      if (result?.code === "quota") {
        view.status.textContent += result.retryAt
          ? " Try after " + new Date(result.retryAt).toLocaleString() + "."
          : " Check AI Studio before using Regenerate to try again.";
      }
    }
    view.regenerate.disabled = false;
    view.refreshContext.disabled = view.selectContext.disabled = false;
    updatePopupPosition();
  }

  function showPopup({anchor, lookup: selection}, getAnchor, readPassage, video) {
    if (current?.anchor === anchor && ["word", "caption", "offset", "before", "earlier"]
      .every(field => current.selection[field] === selection[field])) return;
    closePopup();
    const lookup = {...selection};

    const root = element("section", "");
    root.id = "qlookup-popup";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-labelledby", "qlookup-title");
    const body = element("div", "qlookup-body");
    const reading = element("div", "qlookup-reading");
    const header = element("div", "qlookup-header");
    const title = element("div", "qlookup-title", lookup.word);
    title.id = "qlookup-title";
    const partOfSpeech = element("span", "qlookup-part-of-speech");
    title.append(partOfSpeech);
    const close = element("button", "qlookup-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close lookup");
    close.addEventListener("click", closePopup);
    const regenerate = element("button", "qlookup-regenerate");
    regenerate.type = "button";
    regenerate.title = "Regenerate explanation";
    regenerate.setAttribute("aria-label", "Regenerate explanation");

    const status = element("div", "qlookup-status");
    status.setAttribute("role", "status");
    const core = element("section", "qlookup-meaning");
    const coreMeaning = element("div", "");
    const coreTitle = element("strong", "qlookup-core-title", "Core meaning");
    core.append(coreTitle, coreMeaning);
    const expression = element("section", "qlookup-meaning");
    const expressionHeading = element("strong", "qlookup-core-title");
    const expressionTitle = element("span", "");
    const expressionMeaning = element("div", "");
    expressionHeading.append(expressionTitle);
    expression.append(expressionHeading, expressionMeaning);
    const contextual = element("section", "qlookup-meaning");
    const inContext = element("div", "");
    const contextHeading = element("strong", "qlookup-core-title", "In this context");
    contextual.append(contextHeading, inContext);
    const context = element("details", "qlookup-context");
    const contextArea = element("div", "qlookup-context-area");
    contextArea.append(context);
    context.addEventListener("toggle", updatePopupPosition);
    const caption = element("div", "qlookup-caption");
    const selected = element("mark", "", lookup.word);
    const contextStatus = element("div", "qlookup-status");
    contextStatus.setAttribute("role", "status");
    function renderContext() {
      caption.replaceChildren(lookup.caption.slice(0, lookup.offset), selected,
        lookup.caption.slice(lookup.offset + lookup.word.length));
      const summary = element("summary", "", "Caption context");
      summary.append(selectContext);
      context.replaceChildren(summary, contextStatus);
      if (lookup.earlier) context.append(element("div", "", lookup.earlier));
      if (lookup.before) context.append(element("div", "", lookup.before));
      context.append(caption);
      if (lookup.after) context.append(element("div", "", lookup.after));
    }

    const controls = element("div", "qlookup-controls");
    function iconAction(tag, label, path) {
      const action = element(tag, "qlookup-action");
      action.title = label;
      action.setAttribute("aria-label", label);
      const ns = "http://www.w3.org/2000/svg";
      const icon = document.createElementNS(ns, "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const line = document.createElementNS(ns, "path");
      line.setAttribute("d", path);
      icon.append(line);
      action.append(icon);
      return action;
    }
    const copyIcon = "M8 8h12v12H8z M16 8V4H4v12h4";
    const pronounce = iconAction("button", "Pronounce word", "M3 9h4l5-4v14l-5-4H3z M16 9a4 4 0 0 1 0 6 M19 6a8 8 0 0 1 0 12");
    const copyWord = iconAction("button", "Copy word", copyIcon);
    for (const action of [pronounce, copyWord]) {
      action.type = "button";
      action.className += " qlookup-word-action";
    }
    header.append(title, pronounce, copyWord, regenerate, close);
    function meaningCopy(heading, label, getText) {
      const action = iconAction("button", label, copyIcon);
      action.type = "button";
      action.className += " qlookup-copy-core";
      action.addEventListener("click", () => {
        if (view.result) return copyText(getText(view.result));
      });
      heading.append(action);
    }
    meaningCopy(coreTitle, "Copy core meaning", result => lookup.word + ": " + result.coreMeaning);
    meaningCopy(expressionHeading, "Copy expression meaning",
      result => result.expression + ": " + result.expressionMeaning);
    meaningCopy(contextHeading, "Copy contextual meaning", result => result.inContext);
    const copyContext = iconAction("button", "Copy caption context", copyIcon);
    copyContext.type = "button";
    copyContext.className += " qlookup-copy-core qlookup-copy-context";
    contextArea.append(copyContext);
    const refreshContext = iconAction("button", "Refresh context", "M20 7v5h-5 M20 12a8 8 0 1 0-2 6");
    refreshContext.type = "button";
    refreshContext.className += " qlookup-copy-core qlookup-copy-context qlookup-refresh-context";
    contextArea.append(refreshContext);
    const selectContext = iconAction("button", "Select context", "M4 16l-1 5 5-1L20 8l-4-4z M14 6l4 4");
    selectContext.type = "button";
    selectContext.className += " qlookup-copy-core qlookup-select-context";
    renderContext();
    const copyResult = iconAction("button", "Copy result", copyIcon);
    const settings = iconAction("button", "Open extension options", "M10 3h4l.6 2.6 2 .9L19 5l2 3.5-2 1.8v2.4l2 1.8-2 3.5-2.4-1.5-2 .9L14 20h-4l-.6-2.6-2-.9L5 18l-2-3.5 2-1.8v-2.4L3 8.5 5 5l2.4 1.5 2-.9L10 3z M15 11.5a3 3 0 1 1-6 0 3 3 0 1 1 6 0z");
    settings.type = "button";
    settings.className += " qlookup-settings";
    copyResult.type = "button";
    copyResult.disabled = true;
    const search = iconAction("a", "Search caption in Google", "M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0 M15 15l6 6");
    search.target = "_blank";
    search.rel = "noopener noreferrer";
    const link = iconAction("a", "Open Cambridge Dictionary", "M12 6v14 M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1z");
    link.href = "https://dictionary.cambridge.org/dictionary/english/" +
      encodeURIComponent(lookup.word.toLowerCase());
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const copy = element("button", "qlookup-action", "Copy for AI");
    copy.title = "Copy prompt for AI";
    copy.type = "button";
    const copyStatus = element("div", "qlookup-status");
    copyStatus.setAttribute("role", "status");
    function captionContext(markedCaption) {
      return [lookup.earlier, lookup.before, markedCaption, lookup.after]
        .filter(Boolean).join(" ").replaceAll("\\", "").trim().replace(/\s+/gu, " ");
    }
    function updateSearch() {
      search.href = "https://www.google.com/search?q=" + encodeURIComponent(aiPrompt());
    }
    function applyPassage(passage) {
      Object.assign(lookup, passage, {earlier: "", before: "", after: ""});
      renderContext();
      updateSearch();
    }
    async function requestContext(mode) {
      if (!readPassage) return null;
      view.wait = new AbortController();
      try {
        return await readPassage(view.wait.signal, mode);
      } catch {
        return null;
      }
    }
    async function changeContext(mode) {
      contextArea.querySelector(".qlookup-context-editor")?.remove();
      refreshContext.disabled = selectContext.disabled = regenerate.disabled = true;
      context.open = true;
      contextStatus.textContent = mode === "refresh" ? "Refreshing context…" : "Opening transcript…";
      updatePopupPosition();
      const passage = await requestContext(mode);
      if (current !== view) return;
      refreshContext.disabled = selectContext.disabled = regenerate.disabled = false;
      if (mode === "refresh") {
        if (passage) applyPassage(passage);
        contextStatus.textContent = passage
          ? "Context refreshed. Use ↻ by the word to update the explanation."
          : "No additional captions found.";
        updatePopupPosition();
        return;
      }
      const earlier = [lookup.earlier, lookup.before].filter(Boolean).join(" ");
      const fallback = {
        caption: [earlier, lookup.caption, lookup.after].filter(Boolean).join(" "),
        offset: lookup.offset + (earlier ? earlier.length + 1 : 0),
      };
      showContextSelector(passage || fallback, Boolean(passage));
    }
    function showContextSelector(passage, hasTranscript) {
      contextArea.querySelector(".qlookup-context-editor")?.remove();
      contextStatus.textContent = hasTranscript ? "" : "Full transcript unavailable. Showing available captions.";
      const editor = element("div", "qlookup-context-editor");
      editor.setAttribute("role", "region");
      editor.setAttribute("aria-label", "Select context");
      const heading = element("strong", "qlookup-editor-title", "Select context");
      const instructions = element("p", "", "Select text that includes the highlighted word, up to 1,000 characters.");
      const transcript = element("div", "qlookup-transcript");
      transcript.tabIndex = 0;
      transcript.setAttribute("aria-label", "Selectable transcript");
      const target = element("mark", "", lookup.word);
      transcript.append(passage.caption.slice(0, passage.offset), target,
        passage.caption.slice(passage.offset + lookup.word.length));
      const use = element("button", "qlookup-action", "Use selection");
      const cancel = element("button", "qlookup-action", "Cancel");
      use.type = cancel.type = "button";
      use.addEventListener("mousedown", event => event.preventDefault());
      use.addEventListener("click", () => {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (!range || range.collapsed || !transcript.contains(range.commonAncestorContainer)) {
          instructions.textContent = "Select a passage in the transcript first.";
          return;
        }
        const prefix = document.createRange();
        prefix.selectNodeContents(transcript);
        prefix.setEnd(range.startContainer, range.startOffset);
        const start = prefix.toString().length;
        const text = range.toString();
        const offset = passage.offset - start;
        if (offset < 0 || text.slice(offset, offset + lookup.word.length) !== lookup.word || text.length > 1000) {
          instructions.textContent = "Include the highlighted word and select no more than 1,000 characters.";
          return;
        }
        applyPassage({caption: text, offset});
        selection.removeAllRanges();
        editor.remove();
        contextStatus.textContent = "Selection applied. Use ↻ by the word to update the explanation.";
        updatePopupPosition();
      });
      cancel.addEventListener("click", () => {
        editor.remove();
        updatePopupPosition();
      });
      const editorActions = element("div", "qlookup-editor-actions");
      editorActions.append(use, cancel);
      editor.append(heading, instructions, transcript, editorActions);
      contextArea.append(editor);
      updatePopupPosition();
      // Scroll the transcript itself, leaving the popup header and footer fixed.
      transcript.scrollTop = target.offsetTop - transcript.clientHeight / 2;
    }
    function aiPrompt() {
      const marked = lookup.caption.slice(0, lookup.offset) + "[" + lookup.word + "]" +
        lookup.caption.slice(lookup.offset + lookup.word.length);
      const nonEnglish = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(lookup.word);
      const instruction = nonEnglish ? "Explain this word or expression in English: " : "Explain this English word or expression: ";
      return [
        instruction + lookup.word.replaceAll("\\", ""),
        "Context:\n" + captionContext(marked),
      ].join("\n\n");
    }
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        copyStatus.textContent = "";
        showCopied();
      } catch {
        copyStatus.textContent = "Could not copy the text. Try again.";
      }
      updatePopupPosition();
    }
    copyWord.addEventListener("click", () => copyText(lookup.word));
    pronounce.addEventListener("click", () => {
      const speech = window.speechSynthesis;
      if (!speech || !window.SpeechSynthesisUtterance) {
        copyStatus.textContent = "Pronunciation is unavailable in this browser.";
        updatePopupPosition();
        return;
      }
      const utterance = new window.SpeechSynthesisUtterance(lookup.word);
      const englishVoices = speech.getVoices().filter(voice => /^en(?:-|$)/iu.test(voice.lang));
      const voice = englishVoices.find(item => item.localService) || englishVoices[0];
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || "en-US";
      utterance.onerror = event => {
        if (current !== view || ["canceled", "interrupted"].includes(event.error)) return;
        copyStatus.textContent = "Could not play pronunciation. Check your browser’s speech voices.";
        updatePopupPosition();
      };
      copyStatus.textContent = "";
      speech.cancel();
      speech.speak(utterance);
      updatePopupPosition();
    });
    copyContext.addEventListener("click", () => copyText(captionContext(lookup.caption)));
    refreshContext.addEventListener("click", () => changeContext("refresh"));
    selectContext.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      return changeContext("transcript");
    });
    copyResult.addEventListener("click", () => {
      if (!view.result) return;
      const {coreMeaning, expression, expressionMeaning, inContext} = view.result;
      return copyText([
        lookup.word + ": " + coreMeaning,
        expression && expression + ": " + expressionMeaning,
        inContext,
      ].filter(Boolean).join("\n"));
    });
    copy.addEventListener("click", () => copyText(aiPrompt()));
    settings.addEventListener("click", async () => {
      try {
        const response = await chrome.runtime.sendMessage({type: "qlookup:open-options"});
        if (response?.ok) return;
      } catch {
        // The old tab may still be open after an extension reload.
      }
      copyStatus.textContent = "Could not open extension options. Refresh YouTube and try again.";
      updatePopupPosition();
    });
    controls.append(settings, copyResult, link, search, copy);
    reading.append(status, core, expression, contextual, contextArea);
    body.append(header, reading, controls, copyStatus);
    root.append(body);
    (document.fullscreenElement || document.body).append(root);

    // Keep player handlers from reacting to events originating inside the dialog.
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "keydown", "keyup"]) {
      root.addEventListener(type, event => event.stopPropagation());
    }

    const observer = new ResizeObserver(updatePopupPosition);
    observer.observe(body);
    const player = document.querySelector("#movie_player");
    if (player) observer.observe(player);
    const masthead = document.querySelector("ytd-masthead");
    if (masthead) observer.observe(masthead);

    const view = {root, body, reading, status, partOfSpeech, coreMeaning, expressionTitle, expressionMeaning,
      inContext, copyResult, regenerate, refreshContext, selectContext, observer, anchor, getAnchor, lookup, selection, video};
    current = view;
    video?.addEventListener("play", closePopup);
    updateSearch();
    regenerate.addEventListener("click", () => load(view, true));
    if (readPassage) {
      status.textContent = "Checking caption context…";
      core.hidden = expression.hidden = contextual.hidden = true;
      copy.disabled = copyContext.disabled = regenerate.disabled = refreshContext.disabled = selectContext.disabled = true;
      search.removeAttribute("href");
      requestContext("initial").then(passage => {
        if (current !== view) return;
        if (passage) applyPassage(passage);
        updateSearch();
        copy.disabled = copyContext.disabled = false;
        load(view, false);
      });
    } else {
      load(view, false);
    }
    position();
  }

  window.addEventListener("resize", updatePopupPosition);
  window.addEventListener("scroll", updatePopupPosition, true);
  document.addEventListener("fullscreenchange", updatePopupPosition);
  Object.assign(window.Qlookup, {
    showPopup, closePopup, updatePopupPosition, closeOnCaptionChange,
    isPopupElement: element => Boolean(element.closest("#qlookup-popup")),
  });
})();
