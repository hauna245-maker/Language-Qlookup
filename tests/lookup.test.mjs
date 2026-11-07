import test from "node:test";
import assert from "node:assert/strict";
import {cacheKey, createLookupService, normalizeLookup, validateExplanation} from "../extension/background.js";

const model = "gemini-3.8-flash";
const word = "get";
const lookup = {word, caption: "I didn't get what she meant.", offset: 9};
const other = {word, caption: "I need to get groceries.", offset: 10};
const value = {expression: "get", explanation: "Understand something.", usage: "Informal."};
const generated = () => Response.json({candidates: [{finishReason: "STOP", content: {parts: [
  {text: "hidden", thought: true}, {text: JSON.stringify(value)},
]}}]});

function memoryStorage() {
  const entries = {};
  return {
    get: async key => structuredClone({[key]: entries[key]}),
    set: async update => Object.assign(entries, structuredClone(update)),
    remove: async key => delete entries[key],
  };
}

test("lookup identity distinguishes sense, occurrence and model, but ignores video ID", async () => {
  const key = input => cacheKey(model, normalizeLookup(input));
  assert.equal(await key({...lookup, videoId: "first"}), await key({...lookup, videoId: "second"}));
  assert.notEqual(await key(lookup), await key(other));
  assert.notEqual(await key(lookup), await cacheKey("gemini-3.5-flash-lite", normalizeLookup(lookup)));
  assert.equal(normalizeLookup({...lookup, offset: 1}), null);
  const repeated = {word, caption: "get what you get", offset: 0};
  assert.notEqual(await key(repeated), await key({...repeated, offset: 13}));
});

test("concurrent lookups share one request and cached results survive worker recreation", async () => {
  const storage = memoryStorage();
  let calls = 0;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const service = createLookupService(storage, async () => {
    calls++;
    await wait;
    return generated();
  });
  const requests = [service(model, "fake", lookup), service(model, "fake", lookup),
    service(model, "fake", other)];
  release();
  const results = await Promise.all(requests);
  assert.equal(calls, 2);
  assert.ok(results.every(result => result.ok));
  const restarted = createLookupService(storage, () => assert.fail("Unexpected API request"));
  for (const input of [lookup, other]) {
    assert.deepEqual(await restarted(model, "", input), {ok: true, value, cached: true});
  }
  assert.equal((await service(model, "fake", lookup, true)).cached, false);
  assert.equal(calls, 3);
});

test("quota cooldown persists and does not block cached results", async () => {
  const storage = memoryStorage();
  let now = 1_000;
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return calls === 2 ? Response.json({}, {status: 429, headers: {"Retry-After": "60"}}) : generated();
  };
  const start = () => createLookupService(storage, fetcher, () => now);
  const service = start();
  await service(model, "fake", lookup);
  assert.equal((await service(model, "fake", other)).retryAt, 61_000);
  const restarted = start();
  assert.equal((await restarted(model, "fake", other, true)).code, "quota");
  assert.equal((await restarted(model, "fake", lookup)).cached, true);
  assert.equal(calls, 2);
  now = 62_000;
  assert.equal((await restarted(model, "fake", other)).ok, true);
  assert.equal(calls, 3);
});

test("a quota error without a retry time requires explicit regeneration", async () => {
  let calls = 0;
  const storage = memoryStorage();
  const create = () => createLookupService(storage, async () => {
    calls++;
    return calls === 1 ? Response.json({}, {status: 429}) : generated();
  });
  assert.equal((await create()(model, "fake", lookup)).retryAt, null);
  assert.equal((await create()(model, "fake", other)).code, "quota");
  assert.equal((await create()(model, "fake", other, true)).ok, true);
  assert.equal((await create()(model, "fake", lookup)).ok, true);
  assert.equal(calls, 3);
});

test("invalid data and API errors are reported without being cached", async () => {
  assert.equal(validateExplanation({...value, usage: []}), null);
  assert.equal(validateExplanation({...value, explanation: " "}), null);
  const responses = [Response.json({candidates: []}), Response.json({}, {status: 403}),
    Response.json({}, {status: 404}), null, generated()];
  const service = createLookupService(memoryStorage(), async () => {
    const response = responses.shift();
    if (!response) throw new Error("offline");
    return response;
  });
  for (const code of ["invalid", "access", "model", "network"]) {
    assert.equal((await service(model, "fake", lookup)).code, code);
  }
  assert.equal((await service(model, "fake", lookup)).ok, true);
});

test("invalid key, bad request, timeout and cancellation are distinct", async () => {
  const responses = [
    Response.json({error: {details: [{reason: "API_KEY_INVALID"}]}}, {status: 400}),
    Response.json({}, {status: 400}),
    new DOMException("test timeout", "TimeoutError"),
    new DOMException("test cancellation", "AbortError"),
  ];
  const service = createLookupService(memoryStorage(), async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });
  assert.equal((await service(model, "", lookup)).code, "setup");
  for (const code of ["key", "request", "timeout", "canceled"]) {
    assert.equal((await service(model, "fake", lookup)).code, code);
  }
});

test("each model uses its documented thinking level and keeps credentials out of the URL", async () => {
  const requests = [];
  const service = createLookupService(memoryStorage(), async (url, request) => {
    requests.push({url, request});
    return generated();
  });
  for (const [id, level] of [[model, "low"], ["gemini-3.5-flash-lite", "minimal"]]) {
    assert.equal((await service(id, "fake-key", lookup)).ok, true);
    const {url, request} = requests.at(-1);
    assert.ok(url.endsWith("/" + id + ":generateContent"));
    assert.equal(url.includes("fake-key"), false);
    assert.equal(request.headers["x-goog-api-key"], "fake-key");
    const config = JSON.parse(request.body).generationConfig;
    assert.equal(config.thinkingConfig.thinkingLevel, level);
    assert.equal(config.responseMimeType, "application/json");
  }
});
