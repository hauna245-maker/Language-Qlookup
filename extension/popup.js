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

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function closePopup() {
    if (!current) return false;
    current.observer.disconnect();
    current.root.remove();
    current = null;
    cancelAnimationFrame(frame);
    frame = 0;
    return true;
  }

  function updatePopupPosition() {
    if (current && !frame) frame = requestAnimationFrame(position);
  }

  function position() {
    frame = 0;
    const {root, body, observer, getAnchor} = current;
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
      current.lastRect, root.offsetWidth, body.offsetHeight + 2,
      document.documentElement.clientWidth, document.documentElement.clientHeight, headerBottom,
    );
    root.style.left = placement.left + "px";
    root.style.top = placement.top + "px";
    root.style.maxHeight = placement.maxHeight + "px";
  }

  async function load(view, regenerate) {
    view.status.textContent = "Looking up the meaning…";
    view.regenerate.disabled = true;
    view.explanation.textContent = "";
    view.usage.textContent = "";
    let result;
    try {
      result = await chrome.runtime.sendMessage({type: "qlookup:explain", lookup: view.lookup, regenerate});
    } catch {
      result = null;
    }
    // The request can finish after another word was selected or the popup closed.
    if (current !== view) return;

    if (result?.ok) {
      view.title.textContent = result.value.expression;
      view.explanation.textContent = result.value.explanation;
      view.usage.textContent = result.value.usage;
      view.status.textContent = result.cached ? "Saved explanation" : "";
    } else {
      view.status.textContent = result?.message || "The lookup was interrupted. Retry, or reload the extension and refresh YouTube.";
      if (result?.code === "quota") {
        view.status.textContent += result.retryAt
          ? " Try after " + new Date(result.retryAt).toLocaleString() + "."
          : " Check AI Studio before using Regenerate to try again.";
      }
    }
    view.regenerate.disabled = false;
    updatePopupPosition();
  }

  function showPopup({anchor, lookup}, getAnchor) {
    if (current?.anchor === anchor && ["word", "caption", "offset", "before", "after"]
      .every(field => current.lookup[field] === lookup[field])) return;
    closePopup();

    const root = element("section", "");
    root.id = "qlookup-popup";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-labelledby", "qlookup-title");
    const body = element("div", "qlookup-body");
    const header = element("div", "qlookup-header");
    const title = element("div", "qlookup-title", lookup.word);
    title.id = "qlookup-title";
    const close = element("button", "qlookup-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close lookup");
    close.addEventListener("click", closePopup);
    const regenerate = element("button", "qlookup-regenerate", "↻");
    regenerate.type = "button";
    regenerate.title = "Regenerate explanation";
    regenerate.setAttribute("aria-label", "Regenerate explanation");
    header.append(title, regenerate, close);

    const status = element("div", "qlookup-status");
    status.setAttribute("role", "status");
    const explanation = element("div", "qlookup-meaning");
    const usage = element("div", "qlookup-usage");
    const context = element("details", "qlookup-context");
    const caption = element("div", "qlookup-caption");
    const selected = element("mark", "", lookup.word);
    caption.append(lookup.caption.slice(0, lookup.offset), selected,
      lookup.caption.slice(lookup.offset + lookup.word.length));
    context.append(element("summary", "", "Caption context"));
    if (lookup.before) context.append(element("div", "", lookup.before));
    context.append(caption);
    if (lookup.after) context.append(element("div", "", lookup.after));

    const controls = element("div", "qlookup-controls");
    const link = element("a", "qlookup-link", "Cambridge Dictionary ↗");
    link.href = "https://dictionary.cambridge.org/dictionary/english/" +
      encodeURIComponent(lookup.word.toLowerCase());
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    controls.append(link);
    body.append(header, status, explanation, usage, context, controls);
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

    const view = {root, body, title, status, explanation, usage, regenerate, observer, anchor, getAnchor, lookup};
    current = view;
    regenerate.addEventListener("click", () => load(view, true));
    load(view, false);
    position();
  }

  window.addEventListener("resize", updatePopupPosition);
  window.addEventListener("scroll", updatePopupPosition, true);
  document.addEventListener("fullscreenchange", updatePopupPosition);
  Object.assign(window.Qlookup, {
    showPopup, closePopup, updatePopupPosition,
    isPopupElement: element => Boolean(element.closest("#qlookup-popup")),
  });
})();
