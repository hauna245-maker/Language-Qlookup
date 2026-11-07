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
      {startTime: 9, endTime: 11, text: "even though spec for"},
      {startTime: 11, endTime: 14, text: "spec, they're similar."},
      {startTime: 14, endTime: 16, text: "They run the same apps."},
    ],
  }]};
  const location = {origin: "https://www.youtube.com", href: "https://www.youtube.com/watch?v=demo"};
  let receive;
  let result;
  let selected;
  let playerResponse;
  let resources = [];
  const page = {
    addEventListener: (_type, listener) => { receive = listener; },
    postMessage: message => { result = message; },
  };
  const source = await readFile(new URL("../extension/youtube-track.js", import.meta.url), "utf8");
  runInNewContext(source, {
    window: page, location, URL, performance: {getEntriesByType: () => resources},
    document: {querySelector: () => ({
      querySelector: () => video, getOption: () => selected, getPlayerResponse: () => playerResponse,
    })},
  });
  const request = caption => receive({
    source: page, origin: location.origin,
    data: {type: "qlookup:passage-request", caption, offset: 12, id: "test"},
  });
  await request("even though spec for");
  assert.equal(result.passage.caption, "I compared both computers. even though spec for spec, they're similar. They run the same apps.");
  assert.equal(result.passage.caption.slice(result.passage.offset, result.passage.offset + 4), "spec");
  assert.equal(video.currentTime, 10);
  assert.equal(video.paused, true);
  await request("a different caption");
  assert.equal(result.passage, null);

  for (const [track, hide] of [
    [{languageCode: "en-US", kind: "asr"}, false],
    [{languageCode: "ja"}, true],
    [{languageCode: "ja", translationLanguage: {languageCode: "en"}}, true],
    [{languageCode: "und"}, false],
  ]) {
    selected = track;
    await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
    assert.equal(result.hide, hide);
  }
  selected = {languageCode: "en"};
  resources = [{name: location.origin + "/api/timedtext?v=demo&lang=ja&tlang=en"}];
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.hide, true);
  resources.push({name: location.origin + "/api/timedtext?v=demo&lang=en"});
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.hide, false);

  const captionTracks = [{languageCode: "en"}, {languageCode: "ja", kind: "asr"}];
  playerResponse = {
    videoDetails: {videoId: "demo"},
    captions: {playerCaptionsTracklistRenderer: {captionTracks}},
  };
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.hide, true);
  captionTracks.push({languageCode: "en", kind: "asr"});
  await receive({source: page, origin: location.origin, data: {type: "qlookup:caption-language-request"}});
  assert.equal(result.hide, false);
});
