---
"@ws-kit/valibot": minor
"@ws-kit/pubsub": minor
"@ws-kit/core": minor
"@ws-kit/bun": minor
"@ws-kit/zod": minor
"@ws-kit/client": minor
"@ws-kit/cloudflare": minor
"@ws-kit/memory": minor
"@ws-kit/middleware": minor
"@ws-kit/plugins": minor
"@ws-kit/rate-limit": minor
"@ws-kit/redis": minor
---

Add router-level lifecycle hooks (`onOpen`/`onClose`) with capability-gated context.

```ts
router.onOpen(async (ctx) => {
  ctx.send(WelcomeMessage, { greeting: "Hello!" });
  await ctx.topics.subscribe(`user:${ctx.data.userId}`);
});

router.onClose((ctx) => {
  ctx.publish("presence", UserLeftMessage, { id: ctx.data.userId });
});
```

- **`router.onOpen(ctx)`** — runs after auth, before message dispatch
- **`router.onClose(ctx)`** — runs during close notification
- **Capability-gated context** — `send()` with validation plugin, `publish()`/`topics` with pubsub plugin
- **`CloseError`** — throw from `onOpen` to reject connection with custom close code
