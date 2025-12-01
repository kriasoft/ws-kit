---
"@ws-kit/zod": patch
"@ws-kit/valibot": patch
---

Fix runtime error when installing @ws-kit/zod without @ws-kit/plugins

The zod and valibot packages re-export from @ws-kit/core, @ws-kit/plugins, and @ws-kit/pubsub, but these were incorrectly marked as optional peer dependencies. Now they are proper dependencies that get installed automatically.
