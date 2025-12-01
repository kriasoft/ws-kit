---
"@ws-kit/client": patch
---

Fix broken imports in `@ws-kit/client/zod` and `@ws-kit/client/valibot` subpath exports

The compiled dist files incorrectly referenced `../../src/` paths which don't exist in published packages. Now uses proper package imports (`@ws-kit/client`) that resolve correctly at runtime.
