<p>
  <img src="banner.png" alt="Agent Annotation" width="1100">
</p>

# Agent Annotation

**Visual page annotations sent to your HTTP endpoint.**

Figma-like annotation experience with floating inline note cards. DevTools-like element picker in vanilla JS.

Click elements, add comments, submit. The browser extension sends selectors, box model, accessibility data, screenshots, and edit-capture data to a configured `http://` or `https://` endpoint.

## Quick Start

1. Open the extensions page in Google Chrome, Google Chrome for Testing, Edge, or Chromium, and enable **Developer mode**.
2. Click **Load unpacked** and select the `chrome-extension/` folder.
3. Click the **Agent Annotation** icon in the toolbar.
4. Set the HTTP endpoint URL, for example `http://localhost:3000/annotations`, and click **Save**.
5. Click **Start Annotation** or use `Ctrl+Shift+P` / `Cmd+Shift+P`.

No agent or native messaging host is required by the browser extension.

## Endpoint

The extension sends a `POST` request with `Content-Type: application/json` when the user submits annotations.

```json
{
  "source": "agent-annotation",
  "type": "annotations",
  "timestamp": "2026-05-06T08:08:46.888Z",
  "requestId": null,
  "result": {
    "success": true,
    "elements": [
      {
        "selector": "div:nth-of-type(1) > div > main > div > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(1) > div",
        "tag": "div",
        "id": null,
        "classes": [
          "lg:rounded-xl",
          "lg:border",
          "border-slate-200",
          "bg-slate-50/40",
          "lg:p-4"
        ],
        "text": "Run019dfc0f-b167-766e-9103-6603ee6171fc6. 5. 2026 8:53",
        "rect": {
          "x": 288,
          "y": 398,
          "width": 1188,
          "height": 55
        },
        "attributes": {},
        "boxModel": {
          "content": {
            "width": 1154,
            "height": 21
          },
          "padding": {
            "top": 16,
            "right": 16,
            "bottom": 16,
            "left": 16
          },
          "border": {
            "top": 1,
            "right": 1,
            "bottom": 1,
            "left": 1
          },
          "margin": {
            "top": 0,
            "right": 0,
            "bottom": 0,
            "left": 0
          }
        },
        "accessibility": {
          "role": null,
          "name": null,
          "description": null,
          "focusable": false,
          "disabled": false
        },
        "keyStyles": {
          "display": "block",
          "color": "oklch(0.145 0 0)",
          "backgroundColor": "oklab(0.984 -0.00113071 -0.00277876 / 0.4)"
        },
        "comment": "lepsi"
      }
    ],
    "screenshot": null,
    "screenshots": [
      {
        "index": 1,
        "dataUrl": "data:image/png;base64,..."
      }
    ],
    "prompt": "",
    "url": "http://10.0.0.205:5173/task/019dfc0f-89d8-7fc6-9392-8f97dbdb3d38",
    "viewport": {
      "width": 1920,
      "height": 945
    },
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
