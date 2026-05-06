<p>
  <img src="banner.png" alt="Pi Annotate" width="1100">
</p>

# Pi Annotate

**Visual page annotations sent to your HTTP endpoint.**

Figma-like annotation experience with floating inline note cards. DevTools-like element picker in vanilla JS.

Click elements, add comments, submit. The browser extension sends selectors, box model, accessibility data, screenshots, and edit-capture data to a configured `http://` or `https://` endpoint.

## Quick Start

1. Open the extensions page in Google Chrome, Google Chrome for Testing, Edge, or Chromium, and enable **Developer mode**.
2. Click **Load unpacked** and select the `chrome-extension/` folder.
3. Click the **Pi Annotate** icon in the toolbar.
4. Set the HTTP endpoint URL, for example `http://localhost:3000/annotations`, and click **Save**.
5. Click **Start Annotation** or use `Ctrl+Shift+P` / `Cmd+Shift+P`.

No PI agent or native messaging host is required by the browser extension.

## Endpoint

The extension sends a `POST` request with `Content-Type: application/json` when the user submits annotations.

```json
{
  "source": "pi-annotate",
  "type": "annotations",
  "timestamp": "2026-05-06T12:00:00.000Z",
  "requestId": null,
  "result": {
    "success": true,
    "elements": [],
    "screenshot": null,
    "screenshots": [],
    "prompt": "General context from the bottom input",
    "url": "https://example.com/",
    "viewport": { "width": 1440, "height": 900 },
    "editCapture": null
  }
}
```

If the endpoint returns a non-2xx response or the request fails, the annotation UI stays open so the user can retry without losing the current annotation work.

## Usage

| Action | How |
|--------|-----|
| Select element | Click on page |
| Cycle ancestors | Alt/Option+scroll while hovering |
| Multi-select | Toggle "Multi" or Shift+click |
| Add comment | Type in note card textarea |
| Toggle screenshot | Camera button in note card header |
| Reposition note | Drag by header |
| Scroll to element | Click selector in note card |
| Toggle note | Click numbered badge |
| Toggle edit capture | "Etch" toggle in toolbar |
| Toggle annotation UI | `Cmd/Ctrl+Shift+P` |
| Close | `ESC` |

## Features

**Context Capture**: Each element automatically gets box model breakdown, accessibility info, all HTML attributes, and key CSS styles. Enable **Debug mode** for computed styles, parent context, and CSS variables.

**Inline Note Cards**: Draggable floating cards with per-element comments, SVG connectors linking notes to elements, click-to-scroll, and per-element screenshot toggles.

**Screenshots**: Individual crops per element or full-page mode with numbered badges drawn on the screenshot.

**Edit Capture**: Toggle "Etch" in the toolbar to record DevTools edits. Inline styles, CSS rule changes, classes, text edits, and DOM changes are captured in the submitted JSON.

## Architecture

```
Browser Extension
  popup.html/popup.js       endpoint configuration
  background.js             screenshot capture + HTTP POST
  content.js                annotation UI injected into pages
```

## Development

No build step. Edit files in `chrome-extension/` directly, then reload the unpacked extension at `chrome://extensions`.

## License

MIT
