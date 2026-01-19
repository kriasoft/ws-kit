---
"@ws-kit/redis": patch
---

Simplify excludeSelf handling

The `excludeSelf` filtering is now handled at the pubsub plugin layer, simplifying the Redis adapter implementation. No API changes.
