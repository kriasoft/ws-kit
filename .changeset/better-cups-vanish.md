---
"@ws-kit/middleware": patch
"@ws-kit/rate-limit": patch
"@ws-kit/plugins": patch
"@ws-kit/valibot": patch
"@ws-kit/pubsub": patch
"@ws-kit/core": patch
"@ws-kit/zod": patch
"@ws-kit/bun": patch
"@ws-kit/client": patch
"@ws-kit/cloudflare": patch
---

fix: add explicit .js extensions for Node.js ESM compatibility

Packages now work correctly with Node.js native ESM (`node script.mjs`).
Previously, imports failed with `ERR_MODULE_NOT_FOUND` because TypeScript's
`bundler` module resolution doesn't add file extensions to compiled output.

**Changes**:

- Switch to `moduleResolution: "NodeNext"` for compile-time enforcement
- Add `.js` extensions to all relative imports in source files
