---
"@ws-kit/zod": patch
"@ws-kit/valibot": patch
"@ws-kit/bun": patch
"@ws-kit/client": patch
"@ws-kit/cloudflare-do": patch
"@ws-kit/redis-pubsub": patch
"@ws-kit/middleware": patch
"@ws-kit/adapters": patch
---

Fix workspace dependency resolution in published packages. Use workspace:^ instead of workspace:\* to ensure proper semantic version resolution during publishing.
