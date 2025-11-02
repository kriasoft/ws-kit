# @ws-kit/middleware

## 2.0.0

### Patch Changes

- [#34](https://github.com/kriasoft/ws-kit/pull/34) [`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913) Thanks [@koistya](https://github.com/koistya)! - Fix workspace dependency resolution in published package. Ensure "workspace:^" versions are properly converted to valid semver ranges during publish.

- Updated dependencies [[`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913), [`7f9bec8`](https://github.com/kriasoft/ws-kit/commit/7f9bec81a47f1d70b72dadc87731b26f76dac913)]:
  - @ws-kit/core@0.4.0

## 1.0.1

### Patch Changes

- [#32](https://github.com/kriasoft/ws-kit/pull/32) [`031f4ba`](https://github.com/kriasoft/ws-kit/commit/031f4ba077998c2374ae1ee8ff39187bc60a132d) Thanks [@koistya](https://github.com/koistya)! - Fix workspace dependency resolution in published packages. Use workspace:^ instead of workspace:\* to ensure proper semantic version resolution during publishing.

## 1.0.0

### Minor Changes

- [#29](https://github.com/kriasoft/ws-kit/pull/29) [`8114c39`](https://github.com/kriasoft/ws-kit/commit/8114c39f3c46d788cc9b41698f3af08db9bcf3bb) Thanks [@koistya](https://github.com/koistya)! - Add rate limiting support with new `@ws-kit/middleware` and `@ws-kit/adapters` packages. Core router now includes adapter interface and rate limiting types.

### Patch Changes

- Updated dependencies [[`8114c39`](https://github.com/kriasoft/ws-kit/commit/8114c39f3c46d788cc9b41698f3af08db9bcf3bb)]:
  - @ws-kit/core@0.3.0
