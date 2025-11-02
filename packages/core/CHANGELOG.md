# @ws-kit/core

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
