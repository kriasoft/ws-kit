---
"@ws-kit/pubsub": patch
"@ws-kit/memory": patch
---

Local pub/sub delivery for non-broker adapters

Adapters without broker ingestion (like memory) now receive local message delivery via the pubsub plugin's `deliverLocally()`. Previously, messages published with the memory adapter weren't delivered to local subscribers.

The `excludeSelf` filtering is now handled at the plugin layer via `excludeClientId` in envelope metadata, simplifying adapter implementations.
