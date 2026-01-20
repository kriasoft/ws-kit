---
"@ws-kit/core": patch
---

Fix client ID assignment order for pub/sub plugins

Client ID is now assigned before `onInternalOpen` hooks run, ensuring pub/sub plugins can access `clientId` during connection setup.
