# Changelog

All notable changes to Agent Annotation.

## [Unreleased]

### Changed
- Browser extension no longer uses agent integration or Chrome native messaging.
- Annotation submissions are sent directly to a configurable HTTP endpoint with a JSON `POST` request.
- Popup now stores the endpoint URL in `chrome.storage.local`.

### Removed
- Removed extension entrypoint, TypeScript result formatter, native host bridge, installer scripts, and `typebox` dependency.
