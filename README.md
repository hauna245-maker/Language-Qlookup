# Language Qlookup

## About

Language Qlookup is a Chrome extension for quickly looking up the meanings of words in YouTube captions.

## Current features

- Click a word in the captions to open a small popup.
- Open the selected word's entry in Cambridge Dictionary from the popup.

## Planned features

- Capture roughly three lines of captions around the line containing the selected word.
- Send the selected word and its surrounding context to an AI model to generate an explanation of its meaning in context.
- Display the explanation in a small popup above the selected word.
- Let users expand the context to around 50 caption lines when needed to better understand a word, expression, or joke.

## Technology

- Extension platform: Chrome Manifest V3
- Interface: JavaScript, HTML, and CSS
- Caption detection: DOM APIs and MutationObserver
