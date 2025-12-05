# @ws-kit/bun

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

## 0.3.5

### Patch Changes

- [#48](https://github.com/kriasoft/ws-kit/pull/48) [`bb09178`](https://github.com/kriasoft/ws-kit/commit/bb09178437dc71d11ce2f5a5f9904fcb1bcc96bb) Thanks [@koistya](https://github.com/koistya)! - **Improvements:**
  - Update integration tests for better reliability and coverage

- Updated dependencies [[`bb09178`](https://github.com/kriasoft/ws-kit/commit/bb09178437dc71d11ce2f5a5f9904fcb1bcc96bb)]:
  - @ws-kit/core@0.7.0

## 0.3.4

### Patch Changes

- Updated dependencies [[`a76d00b`](https://github.com/kriasoft/ws-kit/commit/a76d00b61db65ddbd725a4806cbc20af3b9608da)]:
  - @ws-kit/core@0.6.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`f99884b`](https://github.com/kriasoft/ws-kit/commit/f99884be6613f87b6e3384edd410f61531138b18)]:
  - @ws-kit/core@0.5.0

## 0.3.2

### Patch Changes

- [#40](https://github.com/kriasoft/ws-kit/pull/40) [`04fe01d`](https://github.com/kriasoft/ws-kit/commit/04fe01d40337af27cacac838d972b91cc008860b) Thanks [@koistya](https://github.com/koistya)! - Fix misleading PubSub usage examples in documentation. The examples now correctly show the expected API signatures: direct `pubsub.publish()` for raw messages, and router `router.publish()` with schema and payload. This clarifies the distinction between low-level and high-level broadcasting APIs.

- Updated dependencies [[`04fe01d`](https://github.com/kriasoft/ws-kit/commit/04fe01d40337af27cacac838d972b91cc008860b)]:
  - @ws-kit/core@0.4.2

## 0.3.1

### Patch Changes

- [#38](https://github.com/kriasoft/ws-kit/pull/38) [`77f2a31`](https://github.com/kriasoft/ws-kit/commit/77f2a31aa26088c2f20e017f3a51111470c85c9c) Thanks [@koistya](https://github.com/koistya)! - Include README.md and LICENSE files in published npm packages. Previous releases were missing these critical files in their dist/ directories.

- Updated dependencies [[`77f2a31`](https://github.com/kriasoft/ws-kit/commit/77f2a31aa26088c2f20e017f3a51111470c85c9c)]:
  - @ws-kit/core@0.4.1

## 0.3.0

### Minor Changes

- [#34](https://github.com/kriasoft/ws-kit/pull/34) [`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913) Thanks [@koistya](https://github.com/koistya)! - Update examples to use typed routers and schema-based message definitions. All examples now use `createRouter<AppData>()` for full type inference and leverage message schema patterns for better DX. Includes improvements to bun-zod-chat, state-channels, delta-sync, flow-control, and redis-multi-instance examples.

- [#34](https://github.com/kriasoft/ws-kit/pull/34) [`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913) Thanks [@koistya](https://github.com/koistya)! - Introduce `IWebSocketRouter<TData>` interface for type-safe router composition. Adapters now accept the interface instead of the concrete class, enabling seamless compatibility with typed routers from `@ws-kit/zod` and `@ws-kit/valibot`. This eliminates false type errors when passing typed routers to platform adapters.

### Patch Changes

- Updated dependencies [[`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913), [`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913)]:
  - @ws-kit/core@0.4.0

## 0.2.2

### Patch Changes

- [#32](https://github.com/kriasoft/ws-kit/pull/32) [`031f4ba`](https://github.com/kriasoft/ws-kit/commit/031f4ba077998c2374ae1ee8ff39187bc60a132d) Thanks [@koistya](https://github.com/koistya)! - Fix workspace dependency resolution in published packages. Use workspace:^ instead of workspace:\* to ensure proper semantic version resolution during publishing.

## 0.2.1

### Patch Changes

- [#29](https://github.com/kriasoft/ws-kit/pull/29) [`8114c39`](https://github.com/kriasoft/ws-kit/commit/8114c39f3c46d788cc9b41698f3af08db9bcf3bb) Thanks [@koistya](https://github.com/koistya)! - Update integration tests for rate limiting adapter support.

- Updated dependencies [[`8114c39`](https://github.com/kriasoft/ws-kit/commit/8114c39f3c46d788cc9b41698f3af08db9bcf3bb)]:
  - @ws-kit/core@0.3.0

## 0.2.0

### Minor Changes

- [#27](https://github.com/kriasoft/ws-kit/pull/27) [`7317f53`](https://github.com/kriasoft/ws-kit/commit/7317f5381cc2b03fe42bff32e9aad24da0db3f36) Thanks [@koistya](https://github.com/koistya)! - Added configurable message payload size limits with monitoring hooks. Helps debug backpressure issues and prevent out-of-memory conditions from malformed or excessively large messages.

### Patch Changes

- Updated dependencies [[`7317f53`](https://github.com/kriasoft/ws-kit/commit/7317f5381cc2b03fe42bff32e9aad24da0db3f36)]:
  - @ws-kit/core@0.2.0

## 0.1.0

### Minor Changes

- [#25](https://github.com/kriasoft/ws-kit/pull/25) [`5e5768d`](https://github.com/kriasoft/ws-kit/commit/5e5768dbe734924c1dd02a1d8fae4df7a7d98d8f) Thanks [@koistya](https://github.com/koistya)! - Stabilize client with typed adapters and full type inference

### Patch Changes

- Updated dependencies [[`5e5768d`](https://github.com/kriasoft/ws-kit/commit/5e5768dbe734924c1dd02a1d8fae4df7a7d98d8f)]:
  - @ws-kit/core@0.1.0

## 0.0.1

### Patch Changes

- [#18](https://github.com/kriasoft/ws-kit/pull/18) [`fa84f9f`](https://github.com/kriasoft/ws-kit/commit/fa84f9fe5c1f05fbd3f2dd6ee303023bade86642) Thanks [@koistya](https://github.com/koistya)! - Initial release

- Updated dependencies [[`fa84f9f`](https://github.com/kriasoft/ws-kit/commit/fa84f9fe5c1f05fbd3f2dd6ee303023bade86642)]:
  - @ws-kit/core@0.0.1
