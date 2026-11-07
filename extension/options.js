const form = document.querySelector("form");
const key = document.querySelector("#key");
const model = document.querySelector("#model");
const rewindSeconds = document.querySelector("#rewind-seconds");
const replaySeconds = document.querySelector("#replay-seconds");
const forwardSeconds = document.querySelector("#forward-seconds");
const hideNonEnglish = document.querySelector("#hide-non-english");
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
  hideNonEnglish.checked = settings.hideNonEnglishCaptions;
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
    hideNonEnglishCaptions: hideNonEnglish.checked,
  }), "Settings saved.");
});

remove.addEventListener("click", () => update(() => send("delete"), "Saved key deleted."));
reveal.addEventListener("click", () => {
  const show = key.type === "password";
  key.type = show ? "text" : "password";
  reveal.textContent = show ? "Hide key" : "Show key";
});
update(() => Promise.resolve(), "");
