const form = document.querySelector("form");
const key = document.querySelector("#key");
const model = document.querySelector("#model");
const rewindSeconds = document.querySelector("#rewind-seconds");
const replaySeconds = document.querySelector("#replay-seconds");
const forwardSeconds = document.querySelector("#forward-seconds");
const contextBefore = document.querySelector("#context-before");
const contextAfter = document.querySelector("#context-after");
const captionLanguages = [...document.querySelectorAll('input[name="caption-language"]')];
const filterCaptionLanguages = document.querySelector("#filter-caption-languages");
const captionLanguageList = document.querySelector("#caption-language-list");
const autoSelectOriginal = document.querySelector("#auto-select-original");
const reveal = document.querySelector("#reveal");
const remove = document.querySelector("#delete");
const feedback = document.querySelector("#feedback");
const save = form.querySelector("button[type=submit]");

async function send(type, data) {
  const response = await chrome.runtime.sendMessage({type: "qlookup:" + type, ...data});
  if (!response?.ok) throw new Error(response?.message || "The extension did not respond.");
  return response;
}

async function refresh() {
  const settings = await send("settings");
  model.replaceChildren(...Object.entries(settings.models).map(([id, label]) => new Option(label, id)));
  model.value = settings.model;
  rewindSeconds.value = settings.rewindSeconds;
  replaySeconds.value = settings.replaySeconds;
  forwardSeconds.value = settings.forwardSeconds;
  contextBefore.value = settings.contextBefore;
  contextAfter.value = settings.contextAfter;
  for (const input of captionLanguages) input.checked = settings.captionLanguages.includes(input.value);
  filterCaptionLanguages.checked = settings.filterCaptionLanguages;
  captionLanguageList.disabled = !filterCaptionLanguages.checked;
  autoSelectOriginal.checked = settings.autoSelectOriginalCaptions;
  key.value = settings.key;
  remove.disabled = !settings.hasKey;
  document.querySelector("#key-status").textContent = settings.hasKey
    ? "A key is saved. Leave the key field blank to keep it."
    : "No key is saved.";
}

async function update(action, message) {
  save.disabled = remove.disabled = reveal.disabled = true;
  key.type = "password";
  reveal.textContent = "Show key";
  try {
    await action();
    key.value = "";
    await refresh();
    feedback.textContent = message;
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    save.disabled = reveal.disabled = false;
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  update(() => send("save", {
    key: key.value.trim(), model: model.value,
    rewindSeconds: rewindSeconds.valueAsNumber, replaySeconds: replaySeconds.valueAsNumber,
    forwardSeconds: forwardSeconds.valueAsNumber,
    contextBefore: contextBefore.valueAsNumber, contextAfter: contextAfter.valueAsNumber,
    captionLanguages: captionLanguages.filter(input => input.checked).map(input => input.value),
    filterCaptionLanguages: filterCaptionLanguages.checked,
    autoSelectOriginalCaptions: autoSelectOriginal.checked,
  }), "Settings saved.");
});
filterCaptionLanguages.addEventListener("change", () => {
  captionLanguageList.disabled = !filterCaptionLanguages.checked;
});

remove.addEventListener("click", () => update(() => send("delete"), "Saved key deleted."));
reveal.addEventListener("click", () => {
  const show = key.type === "password";
  key.type = show ? "text" : "password";
  reveal.textContent = show ? "Hide key" : "Show key";
});
update(() => Promise.resolve(), "");
