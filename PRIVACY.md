# Privacy Policy — Agent Annotation

_Last updated: November 24, 2026_

Agent Annotation ("the extension") is a browser extension for annotating web pages and sending those annotations to an HTTP endpoint that **you** configure. This policy explains what data the extension handles and where it goes.

## Summary

- The extension has **no servers of its own**, no analytics, no tracking, and no advertising.
- The author of the extension **does not collect, receive, or store any of your data**.
- Data leaves your browser **only** when you click **Submit**, and **only** to the endpoint URL you entered in the extension settings.

## Data the extension handles

When you start an annotation session and submit it, the extension collects the following from the **current tab only**:

- **Page information**: the page URL, page title, and viewport size.
- **Selected elements and areas**: CSS selectors, tag names, IDs, classes, HTML attributes, visible text, position and size, box model, key CSS styles, accessibility information, and (on React pages) component names and source file locations exposed by React's debug data.
- **Your annotations**: comments you type, arrows and freehand drawings, and the optional prompt / model choice.
- **Screenshots**: images of the visible part of the tab, captured only when you submit (and only for annotations where screenshots are enabled).
- **Edit capture** (only when you turn on "Etch"): DOM and CSS changes you make in DevTools on that page.

The extension does not read your browsing history, cookies, passwords, form inputs you did not annotate, or any other tabs.

## Where the data is sent

On submit, the data above is sent in a single HTTP `POST` request to the endpoint URL configured in the extension settings (by default `http://localhost:3000/annotations`, i.e. your own computer). The extension does not send data anywhere else.

You are responsible for the endpoint you configure. If you point the extension at a third-party server, that server's operator receives the submitted data and their privacy policy applies.

## Data stored locally

The extension uses `chrome.storage.local` to store its settings in your browser:

- the endpoint URL, request mode (plain POST / JSON-RPC) and JSON-RPC method name,
- UI preferences (e.g. drag behaviour, arrow/pen color, debug mode, icon toggle, model list).

These settings never leave your browser except as part of your own Chrome sync/backup, if enabled. Annotation data itself is not stored after it is submitted or after you close the annotation UI.

## Permissions

- **activeTab / scripting / host access to all sites**: needed to show the annotation UI on whatever page you choose to annotate, capture screenshots of it, and read React component information from the page.
- **storage**: needed to save your settings.

## Data sharing and sale

The author does not sell, transfer, or share user data with anyone. The extension's use of data is limited to providing its single purpose — annotating pages and delivering those annotations to your endpoint — in accordance with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Children

The extension is a developer tool and is not directed at children under 13.

## Changes

Changes to this policy will be published in this file in the project repository, with an updated date at the top.

## Contact

Questions about this policy: open an issue at <https://github.com/ondrejnov/agent-annotate/issues>.
