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
    let earlier = "";
    let previousAt = 0;
    let prefetched = false;
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
      if (caption && !prefetched) {
        prefetched = true;
        window.postMessage({type: "qlookup:prefetch-track"}, location.origin);
      }
      if (caption && previousAt && performance.now() - previousAt > 8000) clearContext();
      if (caption && caption !== current) {
        const now = performance.now();
        if (current && (previousAt === 0 || now - previousAt <= 8000)) {
          const neighbor = previousContext(current, caption);
          if (neighbor) {
            earlier = before;
            before = neighbor;
          }
        } else {
          earlier = before = "";
        }
        current = caption;
        previousAt = 0;
      } else if (caption) {
        previousAt = 0;
      } else if (current && !previousAt) {
        previousAt = performance.now();
      }
      onLayout(caption);
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
      return {anchor, range: hit, lookup: {
        word: selected.word, caption, offset: prefixLength + selected.offset, before: neighbor,
        earlier: normalized === current ? earlier : neighbor ? before : earlier,
      }};
    }

    function readPassage(selection, signal) {
      const {caption: raw, word, offset: rawOffset} = selection.lookup;
      const caption = raw.trim().replace(/\s+/gu, " ");
      const offset = raw.slice(0, rawOffset).trimStart().replace(/\s+/gu, " ").length;
      if (!caption || signal.aborted) return Promise.resolve(null);
      const id = crypto.randomUUID();
      return new Promise(resolve => {
        function finish(passage = null) {
          clearTimeout(timer);
          window.removeEventListener("message", receive);
          signal.removeEventListener("abort", cancel);
          resolve(passage);
        }
        const cancel = () => finish();
        function receive(event) {
          const data = event.data;
          if (event.source === window && event.origin === location.origin &&
              data?.type === "qlookup:passage-result" && data.id === id) {
            const passage = data.passage;
            const valid = typeof passage?.caption === "string" && passage.caption.length <= 1000 &&
              Number.isInteger(passage.offset) && passage.offset >= 0 &&
              passage.caption.slice(passage.offset, passage.offset + word.length) === word;
            finish(valid ? {caption: passage.caption, offset: passage.offset} : null);
          }
        }
        const timer = setTimeout(cancel, 3000);
        window.addEventListener("message", receive);
        signal.addEventListener("abort", cancel, {once: true});
        window.postMessage({type: "qlookup:passage-request", id, caption, offset}, location.origin);
      });
    }

    function clearContext() {
      earlier = before = current = "";
      previousAt = 0;
    }

    document.addEventListener("yt-navigate-start", () => {
      navigating = true;
      prefetched = false;
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

    return {getLookup, getAnchor, readPassage};
  }

  Object.assign(window.Qlookup ||= {}, {observeCaptions, wordAt, previousContext});
})();
