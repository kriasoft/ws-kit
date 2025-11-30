---
"@ws-kit/cloudflare": minor
"@ws-kit/middleware": minor
"@ws-kit/rate-limit": minor
"@ws-kit/plugins": minor
"@ws-kit/valibot": minor
"@ws-kit/client": minor
"@ws-kit/memory": minor
"@ws-kit/pubsub": minor
"@ws-kit/redis": minor
"@ws-kit/core": minor
"@ws-kit/bun": minor
"@ws-kit/zod": minor
---

Introduce plugin-based architecture for validation and feature composition

- Add `.plugin()` method for composable capabilities (validation, pub/sub, rate limiting)
- Validation plugins: `withZod()` and `withValibot()` enable schema-driven type inference
- Feature plugins gate runtime methods and TypeScript types together
- Breaking: `.rpc()` now requires a validation plugin
