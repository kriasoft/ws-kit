---
"@ws-kit/plugins": patch
"@ws-kit/pubsub": patch
"@ws-kit/zod": patch
"@ws-kit/valibot": patch
---

fix: eliminate "Enhancer overwrote ctx properties" warning

Core plugins now use delegate pattern for context methods. `ctx.send`, `ctx.reply`, `ctx.progress`, and `ctx.publish` are thin delegates that call through to extension methods. Validation plugins wrap the extensions directly instead of overwriting context properties.

This eliminates the false-positive warning when using `withZod()` or `withValibot()`:

```
[ws-kit] Enhancer overwrote ctx properties: send, reply, progress.
```

No API changes - this is an internal architectural improvement.
