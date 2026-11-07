(() => {
  if (window.__qlookupInitialized) return;
  window.__qlookupInitialized = true;

  const {observeCaptions, showPopup, closePopup, isPopupElement, updatePopupPosition} = window.Qlookup;
  const captions = observeCaptions(updatePopupPosition, closePopup);

  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || isPopupElement(event.target)) return;
    const selection = captions.getLookup(event);
    if (!selection) {
      closePopup();
      return;
    }
    event.stopPropagation();
    selection.anchor.closest("#movie_player")?.querySelector("video")?.pause();
    showPopup(selection, captions.getAnchor);
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && closePopup()) event.stopPropagation();
  }, true);
})();
