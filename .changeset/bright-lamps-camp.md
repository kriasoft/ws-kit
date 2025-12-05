---
"@ws-kit/plugins": minor
"@ws-kit/valibot": minor
"@ws-kit/core": minor
"@ws-kit/zod": minor
"@ws-kit/bun": minor
"@ws-kit/client": minor
"@ws-kit/cloudflare": minor
"@ws-kit/memory": minor
"@ws-kit/middleware": minor
"@ws-kit/pubsub": minor
"@ws-kit/rate-limit": minor
"@ws-kit/redis": minor
---

Type-safe `send()` return values and `SendOptions` rename

### Breaking Changes

- **Renamed `preserveCorrelation` to `inheritCorrelationId`** in `SendOptions` — better describes the semantics of copying correlation ID from inbound to outbound messages

### Improvements

- **`send()` now uses overloads for type-safe return values:**
  - Without `waitFor`: returns `void` (fire-and-forget)
  - With `waitFor`: returns `Promise<boolean>` (backpressure-aware)

  This eliminates the unsafe `void | Promise<boolean>` union that required runtime checks.

- **New exported types** from `@ws-kit/core`:
  - `SendOptionsBase` — shared options (signal, meta, inheritCorrelationId)
  - `SendOptionsSync` — fire-and-forget variant (no waitFor)
  - `SendOptionsAsync` — async variant (with waitFor)

### Migration

```diff
ctx.send(Schema, payload, {
-  preserveCorrelation: true,
+  inheritCorrelationId: true,
});
```
