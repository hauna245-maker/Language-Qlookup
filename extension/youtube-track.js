(() => {
  // YouTube's player track metadata is private. Keep this adapter separate
  // from the extension's isolated scripts and treat unavailable tracks as normal.
  const normalize = text => text.trim().replace(/\s+/gu, " ");
  let cachedUrl;
  let trackRequest;
  let failedAt = 0;

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
    if (url !== cachedUrl || (retry && failedAt && Date.now() - failedAt > 15000)) {
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
    return base === "eng" ? "en" : base;
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
  prefetch();

  const sentences = new Intl.Segmenter("en", {granularity: "sentence"});

  function findPassage(cues, caption, offset, time) {
    const active = cues.findIndex(cue => cue.start <= time + 0.25 && cue.end >= time - 0.25);
    if (active < 0) return null;

    let first = active;
    let last = active;
    while (first > Math.max(0, active - 12) && cues[first].start - cues[first - 1].end <= 5) first--;
    while (last < Math.min(cues.length - 1, active + 12) && cues[last + 1].start - cues[last].end <= 5) last++;

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
    const parts = [...sentences.segment(text)];
    const sentence = parts.findIndex(part => target >= part.index && target < part.index + part.segment.length);
    if (sentence < 0) return null;
    const start = parts[Math.max(0, sentence - 1)].index;
    const end = parts[sentence + 2]?.index ?? text.length;
    const passage = text.slice(start, end).trimEnd();
    return passage.length <= 1000 ? {caption: passage, offset: target - start} : null;
  }

  window.addEventListener("message", async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin) return;
    if (data?.type === "qlookup:prefetch-track") {
      prefetch();
      return;
    }
    if (data?.type === "qlookup:caption-language-request") {
      const {player, video, videoId} = playerState();
      let hide = false;
      try {
        const selected = player?.getOption?.("captions", "track");
        const nativeTracks = [...(video?.textTracks || [])].filter(track =>
          track.mode === "showing" && ["captions", "subtitles"].includes(track.kind));
        let language = selected?.languageCode || (nativeTracks.length === 1 ? nativeTracks[0].language : "");
        let translated = Boolean(selected?.translationLanguage);
        // The player can report the displayed language as English even when
        // its timed-text request identifies a different source language.
        const resources = performance.getEntriesByType("resource");
        for (let i = resources.length - 1; i >= 0; i--) {
          if (!resources[i].name.startsWith(location.origin + "/api/timedtext?")) continue;
          const params = new URL(resources[i].name).searchParams;
          const source = params.get("lang");
          const target = params.get("tlang");
          if (params.get("v") !== videoId || !source) continue;
          if (target && (!language || language === target || language === source)) {
            translated = true;
            language = source;
          } else if (!language) {
            language = source;
          }
          break;
        }
        const baseLanguage = knownLanguage(language);
        hide = translated || Boolean(baseLanguage && baseLanguage !== "en");
        if (!hide && videoId) {
          const response = player?.getPlayerResponse?.();
          const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (response?.videoDetails?.videoId === videoId && Array.isArray(tracks)) {
            const generated = new Set(tracks.filter(track => track.kind === "asr")
              .map(track => knownLanguage(track.languageCode)));
            // A single known speech-recognition language can identify a video
            // even when the selected subtitle track is a separately uploaded translation.
            hide = generated.size === 1 && !generated.has("") && !generated.has("en");
          }
        }
      } catch {
        // Keep captions visible when the active track cannot be identified.
      }
      window.postMessage({type: "qlookup:caption-language", videoId, hide}, location.origin);
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
          passage = findPassage(cues, data.caption, data.offset, time);
        }
        if (!passage) {
          const url = sourceUrl(player, videoId);
          if (url) {
            const cues = await getTrack(url, true);
            if (url === sourceUrl(player, videoId)) passage = findPassage(cues, data.caption, data.offset, time);
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
