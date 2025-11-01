---
"@ws-kit/core": minor
---

Error handling improvements: added `retryable` and `retryAfterMs` options to `ctx.error()`. Standard error codes now classified as terminal, transient, or mixed for automatic client retry inference. Added error detail sanitization to prevent credential leaks.
