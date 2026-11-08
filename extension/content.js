(() => {
  if (window.__qlookupInitialized) return;
  window.__qlookupInitialized = true;

  const {observeCaptions, showPopup, closePopup, isPopupElement, updatePopupPosition,
    closeOnCaptionChange} = window.Qlookup;
  let hover;
  const clearHover = () => hover?.remove();
  const hiddenClass = "language-qlookup-hide-captions";
  let filterCaptions = false;
  let checkedAt = -Infinity;

  function checkCaptionLanguage() {
    if (!filterCaptions || performance.now() - checkedAt < 500) return;
    checkedAt = performance.now();
    window.postMessage({type: "qlookup:caption-language-request"}, location.origin);
  }

  async function readPlaybackSettings() {
    try {
      return await chrome.runtime.sendMessage({type: "qlookup:playback"});
    } catch {
      // A tab can retain this script after the extension is reloaded.
      return null;
    }
  }

  async function refreshCaptionSetting() {
    const response = await readPlaybackSettings();
    if (!response?.ok) return;
    filterCaptions = response.hideNonEnglishCaptions;
    if (!filterCaptions) document.documentElement.classList.remove(hiddenClass);
    checkedAt = -Infinity;
    checkCaptionLanguage();
  }

  window.addEventListener("message", event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.type !== "qlookup:caption-language" ||
        data.videoId !== new URL(location.href).searchParams.get("v")) return;
    document.documentElement.classList.toggle(hiddenClass, filterCaptions && data.hide === true);
  });
  window.addEventListener("focus", refreshCaptionSetting);
  document.addEventListener("yt-navigate-start", () => {
    document.documentElement.classList.remove(hiddenClass);
    checkedAt = -Infinity;
  });
  document.addEventListener("yt-navigate-finish", checkCaptionLanguage);
  refreshCaptionSetting();

  const captions = observeCaptions(caption => {
    clearHover();
    checkCaptionLanguage();
    closeOnCaptionChange(caption);
    updatePopupPosition();
  }, closePopup);

  let hoverFrame = 0;
  let pointer;
  document.addEventListener("pointermove", event => {
    if (!(event.target instanceof Element) || !event.target.closest(".ytp-caption-segment")) {
      pointer = null;
      clearHover();
      return;
    }
    pointer = event;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const range = pointer && captions.getLookup(pointer)?.range;
      const rect = range && [...range.getClientRects()].find(box =>
        pointer.clientX >= box.left && pointer.clientX <= box.right &&
        pointer.clientY >= box.top && pointer.clientY <= box.bottom);
      if (!rect) {
        clearHover();
        return;
      }
      if (!hover) {
        hover = document.createElement("span");
        hover.className = "qlookup-word-hover";
        hover.setAttribute("aria-hidden", "true");
      }
      Object.assign(hover.style, {
        left: rect.left - 2 + "px", top: rect.top + "px",
        width: rect.width + 4 + "px", height: rect.height + "px",
      });
      const parent = document.fullscreenElement || document.body;
      if (hover.parentElement !== parent) parent.append(hover);
    });
  }, {passive: true});
  window.addEventListener("blur", () => {
    pointer = null;
    clearHover();
  });
  window.addEventListener("scroll", clearHover, {capture: true, passive: true});
  window.addEventListener("resize", clearHover);
  document.addEventListener("fullscreenchange", clearHover);

  let captionPress;
  document.addEventListener("pointerdown", event => {
    if (!event.isPrimary) return;
    captionPress = event.button === 0 && event.target instanceof Element &&
      event.target.closest(".caption-window")
      ? {id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false}
      : null;
  }, true);

  function trackCaptionDrag(event) {
    if (captionPress?.id === event.pointerId &&
        Math.hypot(event.clientX - captionPress.x, event.clientY - captionPress.y) >= 6) {
      captionPress.dragged = true;
    }
  }
  document.addEventListener("pointermove", trackCaptionDrag, true);
  document.addEventListener("pointerup", trackCaptionDrag, true);
  document.addEventListener("pointercancel", event => {
    if (captionPress?.id === event.pointerId) captionPress = null;
  }, true);

  document.addEventListener("click", event => {
    const dragged = captionPress?.dragged;
    captionPress = null;
    if (dragged) return;
    if (!(event.target instanceof Element) || isPopupElement(event.target)) return;
    const selection = captions.getLookup(event);
    if (!selection) return;
    event.stopPropagation();
    const video = selection.anchor.closest("#movie_player")?.querySelector("video");
    video?.pause();
    showPopup(selection, captions.getAnchor, signal => captions.readPassage(selection, signal), video);
  }, true);

  document.addEventListener("keydown", async event => {
    if (event.key === "Escape" && closePopup()) event.stopPropagation();
    const key = event.key.toLowerCase();
    const target = event.composedPath()[0];
    if (!["a", "s", "d"].includes(key) || event.defaultPrevented || event.repeat ||
        event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        target?.isContentEditable || target?.closest?.("input, textarea, select, [role='textbox']")) return;

    const video = document.querySelector("#movie_player video");
    if (!video || video.readyState < 1 || video.closest(".ad-showing")) return;
    event.preventDefault();
    event.stopPropagation();
    const page = location.href;
    const source = video.currentSrc;
    const settings = await readPlaybackSettings();
    if (!settings?.ok || !video.isConnected || page !== location.href || source !== video.currentSrc) return;

    const delta = key === "s" ? -settings.replaySeconds :
      (key === "a" ? -settings.rewindSeconds : settings.forwardSeconds);
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
    if (video.paused) video.play().catch(() => {});
  }, true);
})();
