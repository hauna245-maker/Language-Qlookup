import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {setImmediate} from "node:timers/promises";

const source = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");

test("an older response cannot overwrite the currently selected word", async () => {
  class Element {
    children = [];
    offsetWidth = 300;
    offsetHeight = 100;
    scrollHeight = 100;
    clientHeight = 100;
    style = {};
    listeners = {};
    append(...children) {
      for (const child of children) if (child instanceof Element) child.parentElement = this;
      this.children.push(...children);
    }
    remove() {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
    }
    setAttribute() {}
    removeAttribute(name) { delete this[name]; }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener(type, handler) { this.listeners[type] = handler; }
  }
  const body = new Element();
  const document = {
    body, createElement: () => new Element(), createElementNS: () => new Element(), querySelector: () => null,
    documentElement: {clientWidth: 800, clientHeight: 600}, addEventListener() {},
  };
  const window = {Qlookup: {popupPlacement: () => ({left: 0, top: 0, maxHeight: 100})}, addEventListener() {}};
  const requests = [];
  let copied;
  runInNewContext(source, {
    window, document, AbortController,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    chrome: {runtime: {sendMessage: message => new Promise(resolve => requests.push({message, resolve}))}},
    navigator: {clipboard: {writeText: async text => { copied = text; }}},
  });
  const anchor = {isConnected: true, getClientRects: () => [1], getBoundingClientRect: () => ({})};
  const select = (word, waitForNext, video) => window.Qlookup.showPopup({anchor, lookup: {
    word, caption: word, offset: 0, earlier: "First caption", before: "Second caption",
  }}, () => anchor, waitForNext, video);
  const answer = (coreMeaning, expression = "", expressionMeaning = "", inContext = "") => ({
    ok: true, value: {partOfSpeech: "noun", coreMeaning, expression, expressionMeaning, inContext},
  });

  select("old");
  let next;
  select("new", () => new Promise(resolve => { next = resolve; }));
  select("new");
  assert.equal(requests.length, 1);
  next({caption: "First caption Second caption new Fourth\\ caption", offset: 29});
  await setImmediate();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].message.lookup.caption, "First caption Second caption new Fourth\\ caption");
  requests[1].resolve(answer("New meaning"));
  await setImmediate();
  requests[0].resolve(answer("Old meaning"));
  await setImmediate();
  assert.equal(body.children.length, 1);
  const [header, reading, controls] = body.children[0].children[0].children;
  const [, core, expression, context, contextArea] = reading.children;
  assert.equal(header.children[0].textContent, "new");
  assert.equal(header.children[0].children[0].textContent, "noun");
  assert.equal(core.children[1].textContent, "New meaning");
  assert.equal(core.hidden, false);
  assert.equal(expression.hidden, true);
  assert.equal(context.hidden, true);
  await core.children[0].children[0].listeners.click();
  assert.equal(copied, "New meaning");
  await contextArea.children[1].listeners.click();
  assert.equal(copied, "First caption Second caption new Fourth caption");
  await controls.children[1].listeners.click();
  assert.equal(copied, "new · noun\n\nCore meaning\nNew meaning");
  await controls.children[4].listeners.click();
  assert.match(copied, /\[new\]/);
  assert.equal(copied, "Explain this English word or expression: new\n\nContext:\nFirst caption Second caption [new] Fourth caption");
  assert.equal(new URL(controls.children[2].href).searchParams.get("q"), copied);
  assert.equal(requests.length, 2);

  const video = new EventTarget();
  select("apple", undefined, video);
  requests[2].resolve(answer("A fruit.", "bad apple", "A person who causes trouble in a group.", "The speaker sees him as a bad influence."));
  await setImmediate();
  const [, appleReading, actions] = body.children[0].children[0].children;
  const [, , phrase, contextual] = appleReading.children;
  assert.equal(phrase.hidden, false);
  assert.equal(phrase.children[0].textContent, "Expression: bad apple");
  assert.equal(contextual.hidden, false);
  await actions.children[1].listeners.click();
  assert.match(copied, /Core meaning\nA fruit\.\n\nExpression: bad apple\n.*\n\nIn this context\n/);
  window.Qlookup.closeOnCaptionChange("apple");
  assert.equal(body.children.length, 1);
  video.dispatchEvent(new Event("play"));
  assert.equal(body.children.length, 0);
  select("apple");
  window.Qlookup.closeOnCaptionChange("orange");
  assert.equal(body.children.length, 0);
});
