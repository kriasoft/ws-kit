# @ws-kit/client

## 0.2.2

### Patch Changes

- [#32](https://github.com/kriasoft/ws-kit/pull/32) [`031f4ba`](https://github.com/kriasoft/ws-kit/commit/031f4ba077998c2374ae1ee8ff39187bc60a132d) Thanks [@koistya](https://github.com/koistya)! - Fix workspace dependency resolution in published packages. Use workspace:^ instead of workspace:\* to ensure proper semantic version resolution during publishing.

- Updated dependencies [[`031f4ba`](https://github.com/kriasoft/ws-kit/commit/031f4ba077998c2374ae1ee8ff39187bc60a132d)]:
  - @ws-kit/zod@0.2.2
  - @ws-kit/valibot@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @ws-kit/valibot@0.2.1
  - @ws-kit/zod@0.2.1

## 0.2.0

### Minor Changes

- [#27](https://github.com/kriasoft/ws-kit/pull/27) [`7317f53`](https://github.com/kriasoft/ws-kit/commit/7317f5381cc2b03fe42bff32e9aad24da0db3f36) Thanks [@koistya](https://github.com/koistya)! - Enhanced error handling: clients now automatically infer retry behavior from error codes. Added support for `retryable` and `retryAfterMs` fields in error responses. Updated request-response correlation to handle both success and error cases with full type safety.

### Patch Changes

- Updated dependencies [[`7317f53`](https://github.com/kriasoft/ws-kit/commit/7317f5381cc2b03fe42bff32e9aad24da0db3f36), [`7317f53`](https://github.com/kriasoft/ws-kit/commit/7317f5381cc2b03fe42bff32e9aad24da0db3f36)]:
  - @ws-kit/valibot@0.2.0
  - @ws-kit/zod@0.2.0

## 0.1.0

### Minor Changes

- [#25](https://github.com/kriasoft/ws-kit/pull/25) [`5e5768d`](https://github.com/kriasoft/ws-kit/commit/5e5768dbe734924c1dd02a1d8fae4df7a7d98d8f) Thanks [@koistya](https://github.com/koistya)! - Stabilize client with typed adapters and full type inference

### Patch Changes

- Updated dependencies [[`5e5768d`](https://github.com/kriasoft/ws-kit/commit/5e5768dbe734924c1dd02a1d8fae4df7a7d98d8f)]:
  - @ws-kit/valibot@0.1.0
  - @ws-kit/zod@0.1.0

## 0.0.1

### Patch Changes

- [#18](https://github.com/kriasoft/ws-kit/pull/18) [`fa84f9f`](https://github.com/kriasoft/ws-kit/commit/fa84f9fe5c1f05fbd3f2dd6ee303023bade86642) Thanks [@koistya](https://github.com/koistya)! - Initial release

- Updated dependencies [[`fa84f9f`](https://github.com/kriasoft/ws-kit/commit/fa84f9fe5c1f05fbd3f2dd6ee303023bade86642)]:
  - @ws-kit/valibot@0.0.1
  - @ws-kit/zod@0.0.1
