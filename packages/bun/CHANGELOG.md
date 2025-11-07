# @ws-kit/bun

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
