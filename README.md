# Agent Annotation

**Visual page annotations sent to your HTTP endpoint.**

Figma-like annotation experience with floating inline note cards. DevTools-like element picker in vanilla JS.

Click elements, add comments, submit. The browser extension sends selectors, box model, accessibility data, screenshots, and edit-capture data to a configured `http://` or `https://` endpoint.

## Quick Start

1. Open the extensions page in Google Chrome, Google Chrome for Testing, Edge, or Chromium, and enable **Developer mode**.
2. Click **Load unpacked** and select the `chrome-extension/` folder.
3. Click the **Agent Annotation** icon in the toolbar.
4. Set the HTTP endpoint URL, for example `http://localhost:3000/annotations`, choose plain `POST` or `JSON-RPC`, and click **Save**.
5. Click **Start Annotation** or use `Ctrl+Shift+P` / `Cmd+Shift+P`.

No agent or native messaging host is required by the browser extension.

## Endpoint

The extension sends a `POST` request with `Content-Type: application/json` when the user submits annotations. By default it sends a plain JSON POST payload:

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
        "reactComponent": {
          "name": "TaskCard",
          "componentStack": ["TaskCard", "TaskList", "RouteComponent"],
          "source": {
            "fileName": "/app/components/task-card.tsx",
            "lineNumber": 42,
            "columnNumber": 7
          },
          "jsxSource": {
            "fileName": "/app/components/task-card.tsx",
            "lineNumber": 42,
            "columnNumber": 7
          }
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
    "title": "Task 019dfc0f-b167-766e-9103-6603ee6171fc6",
    "viewport": {
      "width": 1920,
      "height": 945
    },
    "editCapture": null
  }
}
```

Each item in `elements` has a `type`. Clicked elements are `"type": "element"` (shape above). Areas selected by dragging are `"type": "region"`:

```json
{
  "type": "region",
  "rect": { "x": 27, "y": 126, "width": 482, "height": 173 },
  "comment": "make these cards the same height",
  "text": "Basic Free forever for one user Start Pro team 490 Kč per month Buy now",
  "container": {
    "selector": "#pricing",
    "tag": "section",
    "id": "pricing",
    "classes": ["pricing"],
    "rect": { "x": 20, "y": 110, "width": 1160, "height": 210 },
    "reactComponent": null
  },
  "elements": [
    { "relation": "contained", "selector": "#c1", "tag": "div", "text": "Basic Free forever…", "rect": {}, "coverage": 1 },
    { "relation": "inside", "selector": "#c1 > button", "tag": "button", "role": "button", "name": "Start", "rect": {}, "coverage": 1 },
    { "relation": "partial", "selector": "#c3", "tag": "div", "rect": {}, "coverage": 0.4 }
  ]
}
```

- `container`: the smallest element that contains everything visible in the area.
- `elements[].relation`: `contained` = outermost elements fully inside the area, `partial` = container children the area cuts through, `inside` = interactive/semantic elements nested in contained ones. Up to 25, in document order, with `reactComponent` when available.
- `text`: visible text inside the area; text nodes cut by the edge are narrowed to whole words.
- In Crop mode the area screenshot is cropped exactly to `rect`; in Full mode the area frame is drawn into the screenshot.

Arrows and freehand strokes drawn with the **Arrow** / **Pen** tools are annotations too: releasing the mouse opens a note card, and they are sent in `elements` as `"type": "arrow"` / `"type": "pen"` (coordinates are page coordinates, like `rect`):

```json
{
  "type": "arrow",
  "comment": "move this button here",
  "from": { "x": 120, "y": 340 },
  "to": { "x": 410, "y": 215 },
  "fromElement": { "selector": "#c1 > button", "tag": "button", "text": "Start", "rect": {}, "role": "button", "name": "Start", "reactComponent": {} },
  "toElement": { "selector": "#c3", "tag": "div", "text": "Pro team…", "rect": {}, "reactComponent": {} },
  "reactComponent": { "name": "PricingCard", "source": {}, "jsxSource": {} },
  "anchor": { "selector": "#c3", "tag": "div", "id": "c3", "classes": [], "rect": {} }
}
```

```json
{
  "type": "pen",
  "comment": "this heading is too big",
  "bounds": { "x": 30, "y": 120, "width": 210, "height": 60 },
  "points": [[30, 150], [34, 141], [45, 131]],
  "covered": { "container": { "selector": "h2.title", "tag": "h2" }, "text": "Pricing", "elements": [] },
  "reactComponent": { "name": "SectionTitle" },
  "anchor": { "selector": "h2.title", "tag": "h2" }
}
```

- `fromElement` / `toElement`: the page element under the arrow's tail and tip; when nothing is right under an end, the closest element within 20 px (`null` if none).
- `reactComponent`: the component of what the arrow points at (`toElement`, else `fromElement`); for a stroke, of the first element it covers. `fromElement` / `toElement` / `covered.elements[]` carry their own `reactComponent` when available.
- `covered`: what lies under the stroke's bounding box (same analysis as an area selection; up to 10 `elements`).
- `anchor`: the element the drawing is attached to. It moves with the page and with inner scroll containers, like an area.
- `points`: the stroke path, downsampled to at most 200 points.
- Drawings are visible in the screenshots. In Crop mode a drawing's crop is at least half the viewport wide and tall (centred on the drawing, 40 px padding, kept inside the viewport), so the surroundings are in the picture.

If **JSON-RPC** is selected, the same annotation payload is sent in `params` using JSON-RPC 2.0. The method name is configurable and defaults to `annotations`.

```json
{
  "jsonrpc": "2.0",
  "method": "annotations",
  "params": {
    "source": "agent-annotation",
    "type": "annotations",
    "timestamp": "2026-05-06T08:08:46.888Z",
    "requestId": null,
    "result": {}
  },
  "id": null
}
```

If the endpoint returns a non-2xx response or the request fails, the annotation UI stays open so the user can retry without losing the current annotation work.

## Usage

| Action | How |
|--------|-----|
| Select element | Click on page |
| Select area | "▭ Area" tool, drag on page (screenshot + detected elements and text) |
| Drag in Select tool | Draws an arrow by default; set **Dragging in Select mode** to "Selects an area" in the extension options |
| Draw arrow | Drag in Select tool (default) or "↗ Arrow" tool (Shift snaps to 45°) → note card |
| Draw freehand | "✎ Pen" tool, drag on page → note card |
| Arrow / pen color | **Arrow & Pen Color** in the extension options (default red) |
| Remove drawing | × in its note card |
| Back to selecting | "Select" tool or `ESC` |
| Cycle ancestors | Alt/Option+scroll while hovering |
| Multi-select | Toggle "Multi" or Shift+click |
| Add comment | Type in note card textarea |
| Toggle screenshot | Camera button in note card header |
| Reposition note | Drag by header |
| Scroll to element | Click selector in note card |
| Toggle note | Click numbered badge |
| Toggle edit capture | "Etch" toggle in toolbar |
| Use the page while annotating (open a menu) | `F8` or "❄ Frozen" button → Live |
| Freeze the page again | `F8` (immediately) or "▶ Live" button (freezes in 3 s) |
| Toggle annotation UI | `Cmd/Ctrl+Shift+P` |
| Close | `ESC` |

## Features

**Context Capture**: Each element automatically gets box model breakdown, accessibility info, all HTML attributes, and key CSS styles. Enable **Debug mode** for computed styles, parent context, and CSS variables.

**React Component Capture**: On React pages, selected elements include the nearest React component name, component stack, and JSX source when React exposes that debug data (best in Remix/Vite development builds).

## React / Remix / Vite

For React apps, the extension temporarily marks the selected DOM node, then asks the background worker to run a short helper in the page's `MAIN` world. That helper reads React Fiber data directly from the page, finds the nearest named React component, and returns it to the content script.

This is important for Remix + Vite because the annotation UI itself runs as a content script in an isolated world. Without the `MAIN` world bridge, the extension cannot reliably read React's internal properties from the page.

What you usually get back in development:

1. `reactComponent.name`: nearest named component such as `TaskCard`
2. `reactComponent.componentStack`: nearest-to-parent component chain
3. `reactComponent.source`: best available source location for that component
4. `reactComponent.jsxSource`: JSX callsite when React exposes debug source metadata

Notes:

1. This works best in Remix/Vite development builds.
2. In production builds, component names may be minified and source metadata may be missing.
3. Non-React pages simply return no `reactComponent` field.

**Inline Note Cards**: Draggable floating cards with per-element comments, SVG connectors linking notes to elements, click-to-scroll, and per-element screenshot toggles.

**Screenshots**: Individual crops per element or full-page mode with numbered badges drawn on the screenshot.

**Page Freeze**: While annotating, the page is frozen: it gets no clicks, focus changes, hover or key events, so open dropdowns, menus and popovers don't see an "outside click", focus loss, mouseleave or `ESC` and stay open while you click, draw and type notes. `:hover` / `:focus` / `:focus-within` / `:focus-visible` styles are pinned as they were (CSS-only hover menus stay visible) and running animations are paused. To annotate an open menu, open it first and then press `Cmd/Ctrl+Shift+P`. Or, while annotating, press `F8` (Live), open the menu, and press `F8` again. The toolbar button does the same, but freezes after a 3 s countdown, because clicking it would itself close the menu. Limits: menus that close on window blur (native `<select>`, some libraries when you click the toolbar icon) close before the freeze. Libraries that listen for outside clicks in the capture phase on `document` (e.g. Headless UI) can still see clicks on the annotation UI. Rules in cross-origin stylesheets and shadow DOM aren't pinned.

**Edit Capture**: Toggle "Etch" in the toolbar to record DevTools edits. Inline styles, CSS rule changes, classes, text edits, and DOM changes are captured in the submitted JSON.

## Architecture

```
Browser Extension
  popup.html/popup.js       endpoint and request configuration
  background.js             screenshot capture + HTTP POST
  content.js                annotation UI injected into pages
  MAIN world helper         React Fiber lookup for selected elements
```

## Development

No build step. Edit files in `chrome-extension/` directly, then reload the unpacked extension at `chrome://extensions`.

## License

MIT
