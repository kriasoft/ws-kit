---
"@ws-kit/bun": patch
---

Throw error when excludeSelf is used with Bun's native pub/sub

Bun's native WebSocket pub/sub does not support excluding the sender from broadcasts. The adapter now throws a clear error when `excludeSelf: true` is passed, guiding users to use the memory adapter for local-only pub/sub when this feature is needed.
