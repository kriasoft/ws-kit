<!-- SPDX-FileCopyrightText: 2025-present Kriasoft -->
<!-- SPDX-License-Identifier: MIT -->

# @ws-kit/core Test Suite

Quick guide for navigating and extending the core tests. Stick to these locations so new checks compose cleanly and remain automation-friendly.

## Directory Map

| Path                 | Focus                                          | Add tests when…                                  |
| -------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `runtime/`           | Core implementation (route table, protocol)    | testing low-level internals, message structure   |
| `features/`          | Plugin, middleware, validation, RPC, messaging | covering a single capability or regression       |
| `features/fixtures/` | Shared test data and schemas                   | re-using fixtures across multiple test files     |
| `types/`             | `tsc`-only inference checks                    | guardrails for type-level contracts              |
| `testing-harness/`   | Test infrastructure (TestRouter, fake clocks)  | evolving test utilities and harness capabilities |

Name files as `{topic}.test.ts` (kebab-case) and group behavior with `describe()` blocks so search remains reliable.

## Essential Patterns

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

- Use a plain `MessageDescriptor` for validator-free checks:
  ```ts
  const Msg: MessageDescriptor = { type: "TEST", kind: "event" };
  tr.on(Msg, (ctx) => {
    ctx.data; // payload only, no validation
  });
  ```
- When validation is required, wrap the router with plugins (e.g., `withZod()`), then assert against `ctx.payload`.
- Errors raised by handlers are captured automatically via `tr.capture.errors()`; assert on them instead of try/catch.

## Running Tests

```bash
# All core tests
bun test packages/core/test

# By category
bun test packages/core/test/runtime      # Low-level implementation
bun test packages/core/test/features     # Feature specs
bun test packages/core/test/types        # Type inference checks
bun test packages/core/test/testing-harness  # Test infrastructure

# Single file or name pattern
bun test packages/core/test/features/basic-usage.test.ts
bun test packages/core/test --grep "fire-and-forget"
```

Run in watch mode with `bun test --watch packages/core/test` while iterating locally.

## Checklist for New Tests

- Exercise the public surface (router methods, context helpers) and close resources (`await tr.close()`).
- Prefer deterministic data; keep fixtures in `fixtures/` when re-used.
- Capture observable effects (`ctx.send`, middleware order, metrics) rather than implementation details.
- Keep assertions tight: single behavior per `it()` block, precise expectations, no silent failures.

Following these rules keeps the suite predictable for both humans and AI assistants.
