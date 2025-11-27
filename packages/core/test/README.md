<!-- SPDX-FileCopyrightText: 2025-present Kriasoft -->
<!-- SPDX-License-Identifier: MIT -->

# @ws-kit/core Test Suite

Tests are co-located with source files throughout `src/`. Each module has its tests next to the implementation.

## Test Locations

| Directory                 | Focus                                      |
| ------------------------- | ------------------------------------------ |
| `src/core/*.test.ts`      | Router, route table, routing behavior      |
| `src/engine/*.test.ts`    | Dispatch, middleware, limits               |
| `src/plugin/*.test.ts`    | Plugin system, composition, validation     |
| `src/context/*.test.ts`   | Context methods, pub/sub, RPC              |
| `src/protocol/*.test.ts`  | Message descriptors, wire format           |
| `src/internal/*.test.ts`  | Normalization, symbols, internal utilities |
| `src/testing/*.test.ts`   | Test harness, fake clock, mock plugins     |
| `src/error/*.test.ts`     | Error codes, error helpers                 |
| `test/features/*.test.ts` | Type contracts, integration, feature tests |

## Running Tests

```bash
# All core tests
bun test packages/core/src

# By module
bun test packages/core/src/core      # Router tests
bun test packages/core/src/engine    # Dispatch/middleware tests
bun test packages/core/src/plugin    # Plugin tests

# Single file or pattern
bun test packages/core/src/core/route-table.test.ts
bun test --grep "middleware"
```

## Test Patterns

```ts
import { createRouter } from "@ws-kit/core";
import { test } from "@ws-kit/core/testing";

const tr = test.createTestRouter({
  create: () => createRouter(),
});

const conn = await tr.connect();
conn.send("MESSAGE", { foo: "bar" });
await tr.flush();
await tr.close();
```

- Validator-free checks use plain `MessageDescriptor`
- Errors are captured via `tr.capture.errors()`
- Always close resources with `await tr.close()`
