# @ws-kit/redis

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
  - @ws-kit/memory@0.8.0
  - @ws-kit/core@0.8.0
