(() => {
  const WINDOW = ".caption-window";
  const ROOT = ".ytp-caption-window-container";
  const SEGMENT = ".ytp-caption-segment";

  function wordAt(text, offset) {
    for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)) {
      if (offset >= match.index && offset <= match.index + match[0].length) {
        return {word: match[0], offset: match.index};
      }
    }
    return null;
  }

  function previousContext(previous, current) {
    if (!previous || !current || previous === current ||
        previous.startsWith(current + " ") || current.startsWith(previous + " ")) return "";
    return previous.slice(-350);
  }

  function observeCaptions(onLayout, onNavigate) {
    let player;
    let root;
    let frame = 0;
    let navigating = false;
    let current = "";
    let before = "";
    let previousAt = 0;
    const captionObserver = new MutationObserver(schedule);
    const playerObserver = new MutationObserver(records => {
      if (!root?.isConnected || records.some(record => [...record.addedNodes].some(node =>
        node.nodeType === 1 && (node.matches(ROOT) || node.querySelector(ROOT))))) schedule();
    });

    function schedule() {
      if (!frame && !navigating) frame = requestAnimationFrame(read);
    }

    function getAnchor() {
      return [...(root?.querySelectorAll(WINDOW) || [])].find(anchor => anchor.getClientRects().length) || null;
    }

    function read() {
      frame = 0;
      if (navigating) return;
      const nextPlayer = document.querySelector("#movie_player");
      if (nextPlayer !== player) {
        playerObserver.disconnect();
        player = nextPlayer;
        if (player) playerObserver.observe(player, {childList: true, subtree: true});
      }
      const nextRoot = player?.querySelector(ROOT);
      if (nextRoot !== root) {
        captionObserver.disconnect();
        root = nextRoot;
        if (root) captionObserver.observe(root, {
          childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: ["style", "class", "hidden"],
        });
      }

      const anchor = getAnchor();
      const caption = [...(anchor?.querySelectorAll(SEGMENT) || [])]
        .map(segment => segment.textContent).join(" ").trim().replace(/\s+/gu, " ");
      if (caption && previousAt && performance.now() - previousAt > 8000) clearContext();
      if (caption && caption !== current) {
        const now = performance.now();
        if (current && (previousAt === 0 || now - previousAt <= 8000)) {
          const neighbor = previousContext(current, caption);
          if (neighbor) before = neighbor;
        } else {
          before = "";
        }
        current = caption;
        previousAt = 0;
      } else if (caption) {
        previousAt = 0;
      } else if (current && !previousAt) {
        previousAt = performance.now();
      }
      onLayout();
    }

    function getLookup(event) {
      if (navigating || player?.classList.contains("ad-showing")) return null;
      const segment = event.target.closest(SEGMENT);
      const anchor = segment?.closest(WINDOW);
      if (!anchor || !root?.contains(anchor)) return null;

      // A caret hit gives a text offset without altering YouTube's caption nodes.
      const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (caret?.startContainer.nodeType !== Node.TEXT_NODE ||
          !segment.contains(caret.startContainer)) return null;

      const prefix = document.createRange();
      prefix.selectNodeContents(segment);
      prefix.setEnd(caret.startContainer, caret.startOffset);
      const selected = wordAt(segment.textContent, prefix.toString().length);
      if (!selected) return null;

      // A caret can snap to the closest word when the click actually hits blank space.
      const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT);
      const hit = document.createRange();
      let remaining = selected.offset;
      let length = selected.word.length;
      let started = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!started && remaining >= node.length) {
          remaining -= node.length;
          continue;
        }
        if (!started) {
          hit.setStart(node, remaining);
          started = true;
        }
        const used = Math.min(node.length - remaining, length);
        length -= used;
        if (!length) {
          hit.setEnd(node, remaining + used);
          break;
        }
        remaining = 0;
      }
      if (length || ![...hit.getClientRects()].some(rect => event.clientX >= rect.left &&
          event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) return null;

      const segments = [...anchor.querySelectorAll(SEGMENT)];
      const pieces = segments.map(element => element.textContent);
      const caption = pieces.join(" ");
      const prefixLength = pieces.slice(0, segments.indexOf(segment))
        .reduce((total, piece) => total + piece.length + 1, 0);
      const normalized = caption.trim().replace(/\s+/gu, " ");
      const neighbor = normalized === current ? before : previousContext(current, normalized);
      return {anchor, lookup: {
        word: selected.word, caption, offset: prefixLength + selected.offset, before: neighbor,
      }};
    }

    function clearContext() {
      before = current = "";
      previousAt = 0;
    }

    document.addEventListener("yt-navigate-start", () => {
      navigating = true;
      clearContext();
      onNavigate();
    });
    document.addEventListener("yt-navigate-finish", () => {
      navigating = false;
      clearContext();
      schedule();
    });
    document.addEventListener("yt-page-data-updated", schedule);
    document.addEventListener("loadedmetadata", schedule, true);
    document.addEventListener("seeking", event => {
      if (player?.contains(event.target)) clearContext();
    }, true);
    schedule();

    return {getLookup, getAnchor};
  }

  Object.assign(window.Qlookup ||= {}, {observeCaptions, wordAt, previousContext});
})();
