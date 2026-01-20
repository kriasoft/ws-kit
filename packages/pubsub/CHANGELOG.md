# @ws-kit/pubsub

## 0.10.2

### Patch Changes

- [#108](https://github.com/kriasoft/ws-kit/pull/108) [`16e8f8d`](https://github.com/kriasoft/ws-kit/commit/16e8f8d119f3ec260e379ace3c190373b792982e) Thanks [@koistya](https://github.com/koistya)! - Local pub/sub delivery for non-broker adapters

  Adapters without broker ingestion (like memory) now receive local message delivery via the pubsub plugin's `deliverLocally()`. Previously, messages published with the memory adapter weren't delivered to local subscribers.

  The `excludeSelf` filtering is now handled at the plugin layer via `excludeClientId` in envelope metadata, simplifying adapter implementations.

- Updated dependencies [[`16e8f8d`](https://github.com/kriasoft/ws-kit/commit/16e8f8d119f3ec260e379ace3c190373b792982e)]:
  - @ws-kit/core@0.10.1

## 0.10.1

### Patch Changes

- [#98](https://github.com/kriasoft/ws-kit/pull/98) [`90f8438`](https://github.com/kriasoft/ws-kit/commit/90f8438ebbe1a584c9cac74f4204b06db64b1117) Thanks [@koistya](https://github.com/koistya)! - fix: eliminate "Enhancer overwrote ctx properties" warning

  Core plugins now use delegate pattern for context methods. `ctx.send`, `ctx.reply`, `ctx.progress`, and `ctx.publish` are thin delegates that call through to extension methods. Validation plugins wrap the extensions directly instead of overwriting context properties.

  This eliminates the false-positive warning when using `withZod()` or `withValibot()`:

  ```
  [ws-kit] Enhancer overwrote ctx properties: send, reply, progress.
  ```

  No API changes - this is an internal architectural improvement.

## 0.10.0

### Minor Changes

- [#96](https://github.com/kriasoft/ws-kit/pull/96) [`f118801`](https://github.com/kriasoft/ws-kit/commit/f11880133c7897d0dd2f4ee5c73d70720cd0ea6c) Thanks [@koistya](https://github.com/koistya)! - Type-safe `send()` return values and `SendOptions` rename

  ### Breaking Changes
  - **Renamed `preserveCorrelation` to `inheritCorrelationId`** in `SendOptions` — better describes the semantics of copying correlation ID from inbound to outbound messages

  ### Improvements
  - **`send()` now uses overloads for type-safe return values:**
    - Without `waitFor`: returns `void` (fire-and-forget)
    - With `waitFor`: returns `Promise<boolean>` (backpressure-aware)

    This eliminates the unsafe `void | Promise<boolean>` union that required runtime checks.

  - **New exported types** from `@ws-kit/core`:
    - `SendOptionsBase` — shared options (signal, meta, inheritCorrelationId)
    - `SendOptionsSync` — fire-and-forget variant (no waitFor)
    - `SendOptionsAsync` — async variant (with waitFor)

  ### Migration

  ```diff
  ctx.send(Schema, payload, {
  -  preserveCorrelation: true,
  +  inheritCorrelationId: true,
  });
  ```

### Patch Changes

- Updated dependencies [[`f118801`](https://github.com/kriasoft/ws-kit/commit/f11880133c7897d0dd2f4ee5c73d70720cd0ea6c)]:
  - @ws-kit/core@0.10.0

## 0.9.0

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
  - @ws-kit/core@0.8.0
