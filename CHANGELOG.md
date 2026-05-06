# Changelog

All notable changes to Pi Annotate.

## [Unreleased]

### Changed
- Browser extension no longer uses PI agent integration or Chrome native messaging.
- Annotation submissions are sent directly to a configurable HTTP endpoint with a JSON `POST` request.
- Popup now stores the endpoint URL in `chrome.storage.local`.

### Removed
- Removed PI extension entrypoint, TypeScript result formatter, native host bridge, installer scripts, and `typebox` dependency.
