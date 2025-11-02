---
"@ws-kit/zod": minor
"@ws-kit/valibot": minor
"@ws-kit/bun": minor
"@ws-kit/cloudflare-do": minor
---

Update examples to use typed routers and schema-based message definitions. All examples now use `createRouter<AppData>()` for full type inference and leverage message schema patterns for better DX. Includes improvements to bun-zod-chat, state-channels, delta-sync, flow-control, and redis-multi-instance examples.
