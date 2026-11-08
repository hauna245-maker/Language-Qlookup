import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

const window = {};
runInNewContext(await readFile(new URL("../extension/captions.js", import.meta.url), "utf8"), {window});
const {wordAt, previousContext} = window.Qlookup;

test("click offsets preserve the exact occurrence, contractions and punctuation", () => {
  const text = "Get what you get, and don't go.";
  assert.equal(wordAt(text, 14).word, "get");
  assert.equal(wordAt(text, 14).offset, 13);
  assert.equal(wordAt(text, 24).word, "don't");
  assert.equal(wordAt("hello   world", 7), null);
  assert.equal(wordAt("re-entry", 4).word, "re-entry");
});

test("neighboring context omits duplicate rolling text and has a size limit", () => {
  assert.equal(previousContext("I ended up", "I ended up buying it"), "");
  assert.equal(previousContext("I ended up", "I ended up"), "");
  assert.equal(previousContext("I went shopping.", "Then I walked home."), "I went shopping.");
  assert.equal(previousContext("x".repeat(400), "Next caption.").length, 350);
});

test("caption track matches a split sentence by time and text without changing playback", async () => {
  const video = {currentTime: 10, paused: true, textTracks: [{
    mode: "showing", kind: "captions", cues: [
      {startTime: 7, endTime: 9, text: "I compared both computers."},
      {startTime: 9, endTime: 11, text: "Even though spec for"},
      {startTime: 11, endTime: 14, text: "spec, they're similar."},
      {startTime: 14, endTime: 16, text: "They run the same apps."},
    ],
  }]};
  const location = {origin: "https://www.youtube.com", href: "https://www.youtube.com/watch?v=demo"};
  let receive;
  let result;
  let selected;
  let playerTracks;
  let playerResponse;
  let audioTracks = [];
  let resources = [];
  let captionsOn = true;
  const trackChanges = [];
  const page = {
    addEventListener: (_type, listener) => { receive = listener; },
    postMessage: message => { result = message; },
  };
  const source = await readFile(new URL("../extension/youtube-track.js", import.meta.url), "utf8");
  runInNewContext(source, {
    window: page, location, URL, performance: {getEntriesByType: () => resources},
    document: {querySelector: () => ({
      querySelector: selector => selector === "video" ? video :
        {getAttribute: () => String(captionsOn)},
      getOption: (_group, option) => option === "tracklist" ? playerTracks : selected,
      getPlayerResponse: () => playerResponse,
      getAvailableAudioTracks: () => audioTracks,
      setOption: (...args) => trackChanges.push(args),
    })},
  });
  const request = (caption, settings) => receive({
    source: page, origin: location.origin,
    data: {type: "qlookup:passage-request", caption, offset: 12, id: "test", ...settings},
  });
  await request("Even though spec for");
  assert.equal(result.passage.caption, "I compared both computers. Even though spec for spec, they're similar. They run the same apps.");
  assert.equal(result.passage.caption.slice(result.passage.offset, result.passage.offset + 4), "spec");
  assert.equal(video.currentTime, 10);
  assert.equal(video.paused, true);
  await request("Even though spec for", {before: 0, after: 0});
  assert.equal(result.passage.caption, "Even though spec for spec, they're similar.");
  await request("Even though spec for", {mode: "transcript", before: 0, after: 0});
  assert.match(result.passage.caption, /I compared both computers\..*They run the same apps\./);
  await request("a different caption");
  assert.equal(result.passage, null);

  selected = {languageCode: "en"};
  resources = [{name: location.origin + "/api/timedtext?v=demo&lang=ja&tlang=en"}];
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.originalLanguage, "");

  const captionTracks = [{languageCode: "en"}, {languageCode: "ja", kind: "asr"}];
  playerResponse = {
    videoDetails: {videoId: "demo"},
    captions: {playerCaptionsTracklistRenderer: {captionTracks}},
  };
  audioTracks = [{id: "ko.0", name: "Korean (Original)"}];
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.originalLanguage, "ja");
  assert.equal(result.multipleGenerated, false);
  playerTracks = [{languageCode: "ja", vssId: "a.ja"}, {languageCode: "en", vssId: "a.en"}];
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.multipleGenerated, true);
  assert.equal(result.originalLanguage, "ko");
  playerTracks = undefined;
  audioTracks = [];
  captionTracks.push({languageCode: "en", kind: "asr"});
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.originalLanguage, "");
  assert.equal(result.multipleGenerated, true);
  captionTracks.push({languageCode: "ko", kind: "asr"});
  audioTracks = [
    {getLanguageInfo: () => ({id: "en.4", name: "English"})},
    {displayName: "Korean - Original", getLanguageInfo: () => ({id: "ko.0", name: "Korean"})},
  ];
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.originalLanguage, "ko");
  selected = {languageCode: "ko", translationLanguage: {languageCode: "ja"}};
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.originalLanguage, "ko");
  captionTracks.push({languageCode: "ko", vssId: ".ko"});
  const autoSelect = languages => receive({
    source: page, origin: location.origin,
    data: {type: "qlookup:caption-language-request", autoSelectLanguages: languages},
  });
  await autoSelect(["en"]);
  assert.equal(trackChanges.length, 0);
  captionsOn = false;
  await autoSelect(["ko"]);
  assert.equal(trackChanges.length, 0);
  captionsOn = true;
  await autoSelect(["ko"]);
  assert.equal(trackChanges.length, 1);
  assert.equal(trackChanges[0][0], "captions");
  assert.equal(trackChanges[0][1], "track");
  assert.equal(trackChanges[0][2].vssId, ".ko");
  await autoSelect(["ko"]);
  assert.equal(trackChanges.length, 1);
});
