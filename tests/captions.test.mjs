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
