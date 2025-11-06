# @ws-kit/middleware

## 3.0.0

### Patch Changes

- Updated dependencies [[`f99884b`](https://github.com/kriasoft/ws-kit/commit/f99884be6613f87b6e3384edd410f61531138b18)]:
  - @ws-kit/core@0.5.0

## 2.0.1

### Patch Changes

- [#38](https://github.com/kriasoft/ws-kit/pull/38) [`77f2a31`](https://github.com/kriasoft/ws-kit/commit/77f2a31aa26088c2f20e017f3a51111470c85c9c) Thanks [@koistya](https://github.com/koistya)! - Include README.md and LICENSE files in published npm packages. Previous releases were missing these critical files in their dist/ directories.

- Updated dependencies [[`77f2a31`](https://github.com/kriasoft/ws-kit/commit/77f2a31aa26088c2f20e017f3a51111470c85c9c)]:
  - @ws-kit/core@0.4.1

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
