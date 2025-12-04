# @ws-kit/middleware

## 1.0.0

### Minor Changes

- [#94](https://github.com/kriasoft/ws-kit/pull/94) [`6eb7608`](https://github.com/kriasoft/ws-kit/commit/6eb7608acec57ccfcaf98c20b825320cfb290011) Thanks [@koistya](https://github.com/koistya)! - Add router-level lifecycle hooks (`onOpen`/`onClose`) with capability-gated context.

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

### Patch Changes

- Updated dependencies [[`6eb7608`](https://github.com/kriasoft/ws-kit/commit/6eb7608acec57ccfcaf98c20b825320cfb290011)]:
  - @ws-kit/core@0.9.0
  - @ws-kit/rate-limit@1.0.0

## 0.8.1

### Patch Changes

- [#84](https://github.com/kriasoft/ws-kit/pull/84) [`29068aa`](https://github.com/kriasoft/ws-kit/commit/29068aa8d6cb99c64645b6eab6e02feef38989a7) Thanks [@koistya](https://github.com/koistya)! - fix: add explicit .js extensions for Node.js ESM compatibility

  Packages now work correctly with Node.js native ESM (`node script.mjs`).
  Previously, imports failed with `ERR_MODULE_NOT_FOUND` because TypeScript's
  `bundler` module resolution doesn't add file extensions to compiled output.

  **Changes**:
  - Switch to `moduleResolution: "NodeNext"` for compile-time enforcement
  - Add `.js` extensions to all relative imports in source files

- Updated dependencies [[`29068aa`](https://github.com/kriasoft/ws-kit/commit/29068aa8d6cb99c64645b6eab6e02feef38989a7)]:
  - @ws-kit/rate-limit@0.8.1
  - @ws-kit/core@0.8.1

## 0.8.0

### Minor Changes

- [#81](https://github.com/kriasoft/ws-kit/pull/81) [`2fcdfbc`](https://github.com/kriasoft/ws-kit/commit/2fcdfbc8ef23d6f2d3e0cd097cc80f0bbdec18ea) Thanks [@koistya](https://github.com/koistya)! - Introduce plugin-based architecture for validation and feature composition
  - Add `.plugin()` method for composable capabilities (validation, pub/sub, rate limiting)
  - Validation plugins: `withZod()` and `withValibot()` enable schema-driven type inference
  - Feature plugins gate runtime methods and TypeScript types together
  - Breaking: `.rpc()` now requires a validation plugin

### Patch Changes

- Updated dependencies [[`2fcdfbc`](https://github.com/kriasoft/ws-kit/commit/2fcdfbc8ef23d6f2d3e0cd097cc80f0bbdec18ea)]:
  - @ws-kit/rate-limit@0.8.0
  - @ws-kit/core@0.8.0
