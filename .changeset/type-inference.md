---
"@ws-kit/core": minor
"@ws-kit/zod": minor
"@ws-kit/valibot": minor
"@ws-kit/bun": minor
"@ws-kit/cloudflare-do": minor
"@ws-kit/client": minor
---

Introduce `IWebSocketRouter<TData>` interface for type-safe router composition. Adapters now accept the interface instead of the concrete class, enabling seamless compatibility with typed routers from `@ws-kit/zod` and `@ws-kit/valibot`. This eliminates false type errors when passing typed routers to platform adapters.
