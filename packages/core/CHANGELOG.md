# @ws-kit/core

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

## 0.8.1

### Patch Changes

- [#84](https://github.com/kriasoft/ws-kit/pull/84) [`29068aa`](https://github.com/kriasoft/ws-kit/commit/29068aa8d6cb99c64645b6eab6e02feef38989a7) Thanks [@koistya](https://github.com/koistya)! - fix: add explicit .js extensions for Node.js ESM compatibility

  Packages now work correctly with Node.js native ESM (`node script.mjs`).
  Previously, imports failed with `ERR_MODULE_NOT_FOUND` because TypeScript's
  `bundler` module resolution doesn't add file extensions to compiled output.

  **Changes**:
  - Switch to `moduleResolution: "NodeNext"` for compile-time enforcement
  - Add `.js` extensions to all relative imports in source files

## 0.8.0

### Minor Changes

- [#81](https://github.com/kriasoft/ws-kit/pull/81) [`2fcdfbc`](https://github.com/kriasoft/ws-kit/commit/2fcdfbc8ef23d6f2d3e0cd097cc80f0bbdec18ea) Thanks [@koistya](https://github.com/koistya)! - Introduce plugin-based architecture for validation and feature composition
  - Add `.plugin()` method for composable capabilities (validation, pub/sub, rate limiting)
  - Validation plugins: `withZod()` and `withValibot()` enable schema-driven type inference
  - Feature plugins gate runtime methods and TypeScript types together
  - Breaking: `.rpc()` now requires a validation plugin

## 0.7.0

### Minor Changes

- [#48](https://github.com/kriasoft/ws-kit/pull/48) [`bb09178`](https://github.com/kriasoft/ws-kit/commit/bb09178437dc71d11ce2f5a5f9904fcb1bcc96bb) Thanks [@koistya](https://github.com/koistya)! - **Features:**
  - Enhance RPC configuration options with backwards-compatible names (`rpcMaxInflightPerSocket`, `rpcCleanupCadenceMs`, `rpcDedupWindowMs`)
  - Add internal testing API `_testingConfigureRpc()` for integration test configuration
  - Organize test structure with features directory for better test discoverability

  **Improvements:**
  - Support both legacy and new option naming conventions for RPC settings
  - Provide safe access to RPC dedup window configuration for test tuning

## 0.6.0

### Minor Changes

- [#46](https://github.com/kriasoft/ws-kit/pull/46) [`a76d00b`](https://github.com/kriasoft/ws-kit/commit/a76d00b61db65ddbd725a4806cbc20af3b9608da) Thanks [@koistya](https://github.com/koistya)! - Add isRetryableError helper function for determining retry semantics

## 0.5.0

### Minor Changes

- [#43](https://github.com/kriasoft/ws-kit/pull/43) [`f99884b`](https://github.com/kriasoft/ws-kit/commit/f99884be6613f87b6e3384edd410f61531138b18) Thanks [@koistya](https://github.com/koistya)! - feature: add AbortController support to RPC with abort reasons (client-abort, disconnect, idle-timeout); refactor excludeSelf to throw error instead of silently ignoring

## 0.4.2

### Patch Changes

- [#40](https://github.com/kriasoft/ws-kit/pull/40) [`04fe01d`](https://github.com/kriasoft/ws-kit/commit/04fe01d40337af27cacac838d972b91cc008860b) Thanks [@koistya](https://github.com/koistya)! - Fix misleading PubSub usage examples in documentation. The examples now correctly show the expected API signatures: direct `pubsub.publish()` for raw messages, and router `router.publish()` with schema and payload. This clarifies the distinction between low-level and high-level broadcasting APIs.

## 0.4.1

### Patch Changes

- [#38](https://github.com/kriasoft/ws-kit/pull/38) [`77f2a31`](https://github.com/kriasoft/ws-kit/commit/77f2a31aa26088c2f20e017f3a51111470c85c9c) Thanks [@koistya](https://github.com/koistya)! - Include README.md and LICENSE files in published npm packages. Previous releases were missing these critical files in their dist/ directories.

## 0.4.0

### Minor Changes

- [#34](https://github.com/kriasoft/ws-kit/pull/34) [`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913) Thanks [@koistya](https://github.com/koistya)! - Add comprehensive application patterns documentation and examples for state channels, delta sync, and flow control. Includes production-ready examples with typed schemas, conformance tests, and detailed guides for implementing these architectural patterns.

- [#34](https://github.com/kriasoft/ws-kit/pull/34) [`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913) Thanks [@koistya](https://github.com/koistya)! - Introduce `IWebSocketRouter<TData>` interface for type-safe router composition. Adapters now accept the interface instead of the concrete class, enabling seamless compatibility with typed routers from `@ws-kit/zod` and `@ws-kit/valibot`. This eliminates false type errors when passing typed routers to platform adapters.

## 0.3.0

### Minor Changes

- [#29](https://github.com/kriasoft/ws-kit/pull/29) [`8114c39`](https://github.com/kriasoft/ws-kit/commit/8114c39f3c46d788cc9b41698f3af08db9bcf3bb) Thanks [@koistya](https://github.com/koistya)! - Add rate limiting support with new `@ws-kit/middleware` and `@ws-kit/adapters` packages. Core router now includes adapter interface and rate limiting types.

## 0.2.0

### Minor Changes

- [#27](https://github.com/kriasoft/ws-kit/pull/27) [`7317f53`](https://github.com/kriasoft/ws-kit/commit/7317f5381cc2b03fe42bff32e9aad24da0db3f36) Thanks [@koistya](https://github.com/koistya)! - Error handling improvements: added `retryable` and `retryAfterMs` options to `ctx.error()`. Standard error codes now classified as terminal, transient, or mixed for automatic client retry inference. Added error detail sanitization to prevent credential leaks.

## 0.1.0

### Minor Changes

- [#25](https://github.com/kriasoft/ws-kit/pull/25) [`5e5768d`](https://github.com/kriasoft/ws-kit/commit/5e5768dbe734924c1dd02a1d8fae4df7a7d98d8f) Thanks [@koistya](https://github.com/koistya)! - Stabilize client with typed adapters and full type inference

## 0.0.1

### Patch Changes

- [#18](https://github.com/kriasoft/ws-kit/pull/18) [`fa84f9f`](https://github.com/kriasoft/ws-kit/commit/fa84f9fe5c1f05fbd3f2dd6ee303023bade86642) Thanks [@koistya](https://github.com/koistya)! - Initial release
