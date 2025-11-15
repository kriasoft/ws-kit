<!-- SPDX-FileCopyrightText: 2025-present Kriasoft -->
<!-- SPDX-License-Identifier: MIT -->

# @ws-kit/core Test Suite

Quick guide for navigating and extending the core tests. Stick to these locations so new checks compose cleanly and remain automation-friendly.

## Directory Map

| Path                            | Focus                                           | Add tests when…                                  |
| ------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `router*.test.ts`               | Router API, lifecycle, limits                   | validating base behavior shared by every app     |
| `integration/`                  | End-to-end flows with `TestRouter`              | verifying real messaging workflows without mocks |
| `features/`                     | Plugin, middleware, validation, RPC edge cases  | covering a single capability or regression       |
| `types/`                        | `tsc`-only inference checks                     | guardrails for type-level contracts              |
| `testing-harness/`              | Utilities like `TestRouter`, fake clocks        | evolving test infra itself                       |
| `core/`, `engine/`, `fixtures/` | Low-level internals, legacy suites, shared data | poking routing tables, transports, or fixtures   |

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

# Integration subset
bun test packages/core/test/integration

# Single file or name pattern
bun test packages/core/test/integration/basic-usage.test.ts
bun test packages/core/test --grep "fire-and-forget"
```

Run in watch mode with `bun test --watch packages/core/test` while iterating locally.

## Checklist for New Tests

- Exercise the public surface (router methods, context helpers) and close resources (`await tr.close()`).
- Prefer deterministic data; keep fixtures in `fixtures/` when re-used.
- Capture observable effects (`ctx.send`, middleware order, metrics) rather than implementation details.
- Keep assertions tight: single behavior per `it()` block, precise expectations, no silent failures.

Following these rules keeps the suite predictable for both humans and AI assistants.
