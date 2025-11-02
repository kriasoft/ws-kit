---
"@ws-kit/bun": patch
"@ws-kit/cloudflare-do": patch
"@ws-kit/core": patch
---

Fix misleading PubSub usage examples in documentation. The examples now correctly show the expected API signatures: direct `pubsub.publish()` for raw messages, and router `router.publish()` with schema and payload. This clarifies the distinction between low-level and high-level broadcasting APIs.
