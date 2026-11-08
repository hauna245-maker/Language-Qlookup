(() => {
  // YouTube's player track metadata is private. Keep this adapter separate
  // from the extension's isolated scripts and treat unavailable tracks as normal.
  const normalize = text => text.trim().replace(/\s+/gu, " ");
  let cachedUrl;
  let trackRequest;
  let failedAt = 0;
  let handledCaptionVideo;
  const isAutoCaption = track => track.kind === "asr" || track.isAsr === true ||
    (typeof track.vssId === "string" && track.vssId.startsWith("a."));

  function sourceUrl(player, videoId) {
    const selected = player?.getOption?.("captions", "track");
    if (selected?.translationLanguage) return null;
    const observedTracks = new Map();
    for (const resource of performance.getEntriesByType("resource")) {
      if (!resource.name.startsWith(location.origin + "/api/timedtext?")) continue;
      const observed = new URL(resource.name);
      const params = observed.searchParams;
      if (params.get("v") !== videoId || params.get("fmt") !== "json3" ||
          params.has("tlang") || !params.get("lang")) continue;
      if (selected?.languageCode && (params.get("lang") !== selected.languageCode ||
          (params.get("kind") || "") !== (selected.kind || ""))) continue;
      const identity = JSON.stringify(["lang", "kind", "name"].map(key => params.get(key) || ""));
      observedTracks.set(identity, observed.href);
    }
    if (observedTracks.size === 1) return observedTracks.values().next().value;

    const response = player?.getPlayerResponse?.();
    if (!selected?.languageCode || response?.videoDetails?.videoId !== videoId) return null;
    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const matches = tracks.filter(track => selected.vssId
      ? selected.vssId === track.vssId
      : selected.languageCode === track.languageCode && (selected.kind || "") === (track.kind || ""));
    if (matches.length !== 1 || !matches[0].baseUrl) return null;
    const url = new URL(matches[0].baseUrl, location.origin);
    if (url.origin !== location.origin || url.pathname !== "/api/timedtext" ||
        url.searchParams.get("v") !== videoId || url.searchParams.has("tlang")) return null;

    url.searchParams.set("fmt", "json3");
    return url.href;
  }

  async function readTrack(url) {
    const response = await fetch(url, {redirect: "error", signal: AbortSignal.timeout(2500)});
    if (!response.ok) return [];
    const {events} = await response.json();
    if (!Array.isArray(events)) return [];
    return events.flatMap(event => {
      if (!Number.isFinite(event?.tStartMs) || !Number.isFinite(event.dDurationMs) ||
          !Array.isArray(event.segs)) return [];
      const text = normalize(event.segs.map(segment => segment?.utf8 || "").join(""));
      if (!text) return [];
      return [{text, start: event.tStartMs / 1000, end: (event.tStartMs + event.dDurationMs) / 1000}];
    }).sort((a, b) => a.start - b.start);
  }

  function getTrack(url, retry = false) {
    if (url !== cachedUrl || (failedAt && (retry || Date.now() - failedAt > 15000))) {
      cachedUrl = url;
      failedAt = 0;
      trackRequest = readTrack(url).catch(() => []);
      const request = trackRequest;
      request.then(cues => {
        if (trackRequest === request && !cues.length) failedAt = Date.now();
      });
    }
    return trackRequest;
  }

  function playerState() {
    const player = document.querySelector("#movie_player");
    return {
      player,
      video: player?.querySelector("video"),
      videoId: new URL(location.href).searchParams.get("v"),
    };
  }

  function knownLanguage(language) {
    const base = typeof language === "string" ? language.split("-")[0].toLowerCase() : "";
    if (!/^[a-z]{2,3}$/u.test(base) || ["und", "mul", "zxx"].includes(base)) return "";
    return ({eng: "en", kor: "ko", jpn: "ja"})[base] || base;
  }

  function originalAudioLanguage(player, response) {
    const renderer = response.captions?.playerCaptionsTracklistRenderer;
    const playerApi = typeof player?.getAvailableAudioTracks === "function"
      ? player : document.querySelector("ytd-player")?.player_;
    const available = playerApi?.getAvailableAudioTracks?.() || [];
    const selectedAudio = playerApi?.getAudioTrack?.();
    const streaming = (response.streamingData?.adaptiveFormats || []).map(format => format.audioTrack).filter(Boolean);
    const original = new Set();
    const originalLabel = /(?:^|[\s(（\-–—])(?:original|オリジナル|元の音声|원본|원어)(?:[\s)）]|$)/iu;
    for (const track of [...available, selectedAudio, ...(renderer?.audioTracks || []), ...streaming].filter(Boolean)) {
      const info = track.getLanguageInfo?.() || track;
      const labels = [info.displayName, info.name, track.displayName, track.name]
        .map(display => typeof display === "string" ? display :
          display?.simpleText || display?.runs?.map(run => run.text).join("") || "");
      if (!(track.isOriginal === true || track.audioIsOriginal === true || info.isOriginal === true ||
          labels.some(label => originalLabel.test(label)))) continue;
      const id = info.id || track.id || track.audioTrackId;
      const language = knownLanguage(info.languageCode || track.languageCode ||
        (typeof id === "string" ? id.split(".")[0] : ""));
      if (language) original.add(language);
    }
    if (original.size === 1) return original.values().next().value;
    if (!original.size) {
      // If YouTube has rendered the audio menu, its Original label can be
      // more descriptive than the objects exposed by the player.
      for (const item of player?.querySelectorAll?.(".ytp-settings-menu .ytp-menuitem-label") || []) {
        const label = item.textContent.trim();
        if (!originalLabel.test(label)) continue;
        if (/^(?:japanese|日本語|일본어)(?:\s|[（(])/iu.test(label)) original.add("ja");
        if (/^(?:korean|韓国語|한국어)(?:\s|[（(])/iu.test(label)) original.add("ko");
        if (/^(?:english|英語|영어)(?:\s|[（(])/iu.test(label)) original.add("en");
      }
      if (original.size === 1) return original.values().next().value;
    }
    return knownLanguage(response.videoDetails?.defaultAudioLanguage);
  }

  function prefetch() {
    try {
      const {player, videoId} = playerState();
      const url = videoId && sourceUrl(player, videoId);
      if (url) getTrack(url);
    } catch {
      // The caption track may not be available yet.
    }
  }

  if (typeof PerformanceObserver !== "undefined") {
    const observer = new PerformanceObserver(list => {
      if (list.getEntries().some(entry => entry.name.startsWith(location.origin + "/api/timedtext?"))) prefetch();
    });
    observer.observe({type: "resource", buffered: true});
  }
  document.addEventListener?.("yt-navigate-finish", prefetch);
  document.addEventListener?.("yt-navigate-start", () => { handledCaptionVideo = undefined; });
  prefetch();

  function selectOriginalCaptions(player, videoId, language, tracks) {
    if (handledCaptionVideo === videoId || typeof player.setOption !== "function" ||
        player.querySelector(".ytp-subtitles-button")?.getAttribute("aria-pressed") === "false") return;
    const selected = player.getOption?.("captions", "track");
    if (!selected?.languageCode) return;
    if (!selected.translationLanguage && knownLanguage(selected.languageCode) === language) {
      handledCaptionVideo = videoId;
      return;
    }
    const matching = tracks.filter(track => !track.translationLanguage && knownLanguage(track.languageCode) === language);
    const target = matching.find(track => !isAutoCaption(track)) || matching[0];
    if (!target) return;

    // YouTube's web player exposes this caption setter independently of its
    // audio selector and CC toggle. Only attempt it once per visit.
    handledCaptionVideo = videoId;
    const {languageCode, kind, vssId} = target;
    player.setOption("captions", "track", {languageCode, ...(kind && {kind}), ...(vssId && {vssId})});
  }

  const sentences = new Intl.Segmenter("en", {granularity: "sentence"});

  function findPassage(cues, {caption, offset, mode, before, after}, time) {
    const active = cues.findIndex(cue => cue.start <= time + 0.25 && cue.end >= time - 0.25);
    if (active < 0) return null;

    let first = active;
    let last = active;
    if (mode === "transcript") {
      first = 0;
      last = cues.length - 1;
    } else {
      while (first > Math.max(0, active - 24) && cues[first].start - cues[first - 1].end <= 5) first--;
      while (last < Math.min(cues.length - 1, active + 24) && cues[last + 1].start - cues[last].end <= 5) last++;
    }

    let text = "";
    const positions = [];
    let previous;
    for (const cue of cues.slice(first, last + 1)) {
      // Rolling captions may repeat the end of the preceding cue.
      let overlap = "";
      if (previous && cue.start < previous.end) {
        const words = cue.text.split(" ");
        for (let count = words.length; count >= 2; count--) {
          const prefix = words.slice(0, count).join(" ");
          if (text === prefix || text.endsWith(" " + prefix)) {
            overlap = prefix;
            break;
          }
        }
      }
      const start = overlap ? text.length - overlap.length : text.length + Number(Boolean(text));
      const addition = cue.text.slice(overlap.length).trim();
      if (addition) text += (text ? " " : "") + addition;
      positions.push({start, end: text.length, cue});
      previous = cue;
    }

    const matches = [];
    for (let index = text.indexOf(caption); index >= 0; index = text.indexOf(caption, index + 1)) {
      const end = index + caption.length;
      if (/[\p{L}\p{N}]/u.test(text[index - 1] || "") || /[\p{L}\p{N}]/u.test(text[end] || "")) continue;
      const timing = positions.filter(item => item.start <= index + offset && item.end > index + offset);
      if (timing.some(({cue}) => cue.start <= time + 0.35 && cue.end >= time - 0.35)) matches.push(index + offset);
    }
    if (matches.length !== 1) return null;

    const target = matches[0];
    if (mode === "transcript") return text.length <= 500000 ? {caption: text, offset: target} : null;
    const parts = [...sentences.segment(text)];
    const sentence = parts.findIndex(part => target >= part.index && target < part.index + part.segment.length);
    if (sentence < 0) return null;
    const count = (value, fallback) => Number.isInteger(value) && value >= 0 && value <= 8 ? value : fallback;
    const beforeCount = count(before, 2);
    const afterCount = count(after, 1);
    let from = Math.max(0, sentence - beforeCount);
    let to = Math.min(parts.length - 1, sentence + afterCount);
    const selectedText = () => text.slice(parts[from].index, parts[to + 1]?.index ?? text.length).trimEnd();
    if (beforeCount === 2 && afterCount === 1 && selectedText().split(/\s+/u).length < 30) {
      if (to < parts.length - 1) to++;
      else if (from > 0) from--;
    }
    let passage = selectedText();
    while ((passage.length > 1000 || passage.split(/\s+/u).length > 120) && (from < sentence || to > sentence)) {
      if (sentence - from >= to - sentence && from < sentence) from++;
      else to--;
      passage = selectedText();
    }
    if (passage.length <= 1000 && passage.split(/\s+/u).length <= 120) {
      return {caption: passage, offset: target - parts[from].index};
    }
    // Some auto-generated tracks have little punctuation and form one long sentence.
    const start = Math.max(parts[from].index, target - 450);
    const end = Math.min(parts[to + 1]?.index ?? text.length, target + 500);
    const clipped = text.slice(start, end);
    const left = start > parts[from].index ? Math.max(0, clipped.indexOf(" ") + 1) : 0;
    const right = end < (parts[to + 1]?.index ?? text.length) ? clipped.lastIndexOf(" ") : clipped.length;
    return {caption: clipped.slice(left, right), offset: target - start - left};
  }

  window.addEventListener("message", async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin) return;
    if (data?.type === "qlookup:prefetch-track") {
      prefetch();
      return;
    }
    if (data?.type === "qlookup:caption-language-request") {
      const {player, videoId} = playerState();
      let originalLanguage = "";
      let multipleGenerated = false;
      try {
        const response = player?.getPlayerResponse?.();
        if (videoId && response?.videoDetails?.videoId === videoId) {
          const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          const playerTracks = player.getOption?.("captions", "tracklist");
          const autoTracks = list => Array.isArray(list) ? list.filter(isAutoCaption) : [];
          const fromResponse = autoTracks(tracks);
          const fromPlayer = autoTracks(playerTracks);
          const generated = fromPlayer.length > fromResponse.length ? fromPlayer : fromResponse;
          multipleGenerated = generated.length > 1;
          originalLanguage = (generated.length === 1 && knownLanguage(generated[0].languageCode)) ||
            originalAudioLanguage(player, response);
          if (originalLanguage && (data.autoSelectAll === true ||
              (Array.isArray(data.autoSelectLanguages) && data.autoSelectLanguages.includes(originalLanguage)))) {
            selectOriginalCaptions(player, videoId, originalLanguage, [
              ...(Array.isArray(playerTracks) ? playerTracks : []),
              ...(Array.isArray(tracks) ? tracks : []),
            ]);
          }
        }
      } catch {
        // Leave captions visible if the original language cannot be identified.
      }
      window.postMessage({type: "qlookup:caption-language", videoId, originalLanguage, multipleGenerated}, location.origin);
      return;
    }
    if (data?.type !== "qlookup:passage-request" || typeof data.caption !== "string" ||
        !data.caption || data.caption.length > 1000 || !Number.isInteger(data.offset) ||
        data.offset < 0 || data.offset >= data.caption.length) return;

    const {player, video, videoId} = playerState();
    let passage = null;
    if (video && videoId) {
      const time = video.currentTime;
      try {
        const tracks = [...video.textTracks].filter(track =>
          track.mode === "showing" && ["captions", "subtitles"].includes(track.kind) && track.cues);
        if (tracks.length === 1) {
          const cues = [...tracks[0].cues].flatMap(cue => {
            const text = typeof cue.text === "string" ? normalize(cue.text) : "";
            return text ? [{text, start: cue.startTime, end: cue.endTime}] : [];
          });
          passage = findPassage(cues, data, time);
        }
        if (!passage) {
          const url = sourceUrl(player, videoId);
          if (url) {
            const cues = await getTrack(url, data.mode === "refresh");
            if (url === sourceUrl(player, videoId)) passage = findPassage(cues, data, time);
          }
        }
        if (videoId !== playerState().videoId || Math.abs(video.currentTime - time) > 0.25) passage = null;
      } catch {
        passage = null;
      }
    }
    window.postMessage({type: "qlookup:passage-result", id: data.id, passage}, location.origin);
  });
})();
