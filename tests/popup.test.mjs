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
    addEventListener(type, handler) { this.listeners[type] = handler; }
  }
  const body = new Element();
  const document = {
    body, createElement: () => new Element(), querySelector: () => null,
    documentElement: {clientWidth: 800, clientHeight: 600}, addEventListener() {},
  };
  const window = {Qlookup: {popupPlacement: () => ({left: 0, top: 0, maxHeight: 100})}, addEventListener() {}};
  const requests = [];
  runInNewContext(source, {
    window, document,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    chrome: {runtime: {sendMessage: message => new Promise(resolve => requests.push({message, resolve}))}},
  });
  const anchor = {isConnected: true, getClientRects: () => [1], getBoundingClientRect: () => ({})};
  const select = word => window.Qlookup.showPopup({anchor, lookup: {
    word, caption: word, offset: 0, before: "", after: "",
  }}, () => anchor);
  const answer = expression => ({ok: true, value: {expression, explanation: "Meaning", usage: ""}});

  select("old");
  select("new");
  select("new");
  assert.equal(requests.length, 2);
  requests[1].resolve(answer("new expression"));
  await setImmediate();
  assert.equal(body.children[0].children[0].children[0].children[0].textContent, "new expression");
  requests[0].resolve(answer("old expression"));
  await setImmediate();
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].children[0].children[0].children[0].textContent, "new expression");
});
