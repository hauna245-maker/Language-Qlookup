# Language Qlookup

Lookups show a **Core meaning** and, when useful, **In this context**. Use **Copy for AI** to copy a prompt with the clicked word marked in the caption.

On YouTube, **A** rewinds 3 seconds, **D** skips forward 3 seconds, and **S** rewinds 2 seconds and plays. Change either duration in Extension options.

Click a word in YouTube captions to get an explanation in English, with a Cambridge Dictionary link for English lookups. In Extension options, choose which original video languages can show captions: English, Korean, or Japanese. Enable **Automatically select original-language subtitles** to choose a matching subtitle track on those videos when YouTube captions are on. Gemini receives the selected occurrence and nearby caption text when available.

## Install and configure

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select this project's `extension/` folder. After updating the code, reload the extension and refresh YouTube.
2. In [Google AI Studio](https://aistudio.google.com/api-keys), verify that your project's quota tier is **Free Tier** and its Google Cloud project has no billing account linked. Create or copy an API key for that project. Model access and quota depend on your project. See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and the [billing guide](https://ai.google.dev/gemini-api/docs/billing/).
3. In Chrome, open **Language Qlookup → Details → Extension options**. Enter the key, choose **Gemini 3.5 Flash-Lite** (default) or **Gemini 3.8 Flash**, and save. The saved key appears masked in the key field. Use **Show key** to reveal it there. To switch models, select a model and save. Enter a new key to replace it, or click **Delete saved key** to remove it.
4. Turn on YouTube captions and click a word. Expand **Caption context** to see the surrounding text used for the explanation. The popup closes when you click ×, press Escape, resume playback, or the caption changes.

Chrome starts the background service worker automatically. It reads the key from persistent local extension storage and sends requests directly to Gemini. Keep the key out of source control. Local extension storage is not an encrypted vault, and the extension cannot verify whether your project has billing enabled. Google may use free-tier request data to improve its products.

## Files

| File | Purpose |
| --- | --- |
| `extension/manifest.json` | Tells Chrome what to load and which permissions the extension needs. |
| `extension/background.js` | Handles settings, Gemini requests, quota pauses, and the explanation cache. |
| `extension/captions.js` | Reads visible captions and finds the clicked word without editing YouTube's text nodes. |
| `extension/content.js` | Connects clicks and Escape to the caption reader and popup. |
| `extension/popup.js`, `extension/content.css` | Display and position the lookup popup. |
| `extension/options.html`, `extension/options.js` | Display and save the key and model settings. |
| `tests/` | Node tests for captions, Gemini requests, caching, and stale popup responses. |

## Cache and limitations

Up to 350 successful explanations persist across browser restarts. The selected occurrence, context, model, and prompt version determine cache reuse. **Regenerate** requests a fresh explanation and replaces the cached result on success. Quota errors pause new requests for the affected key and model.

Caption lookup depends on YouTube's visible caption markup. The extension can use a recently displayed caption as context, so a split sentence may have incomplete context. Captions keep YouTube's original wording and line breaks.

## Testing and troubleshooting

Run `node --test tests/*.test.mjs` with Node.js 24 or newer. In Chrome, test word clicks, rapid caption changes, fullscreen, and navigation between videos. Check the YouTube console for the previous `NotFoundError`, including while hovering over captions. Compare with the extension disabled if the error recurs.

For Gemini errors, open `chrome://extensions` and use Language Qlookup's **service worker** inspection link. Click **Regenerate** in the popup and look for `[Qlookup] Gemini request failed` in the worker console. The message contains only the model, error category, and elapsed time. In the worker's Network tab, the HTTP status and Timing tab help distinguish a Google response from a request that stayed pending. Avoid sharing request headers or HAR exports because they can contain the API key. If a timeout repeats, try Flash-Lite and check model access and quota in AI Studio.
