# ADR-007: Export-with-Helpers Pattern for `message()` and `createRouter()`

**Status**: Final
**Date**: 2025-10-29
**Supersedes**: ADR-004 (old factory pattern approach)
**Related**: ADR-005, ADR-006

## Context

Previous design (v1.0-1.1) required a factory pattern for message schema creation:

```typescript
// Old approach: Redundant factory setup
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z); // Factory
const LoginMessage = messageSchema("LOGIN", {
  username: z.string(),
  password: z.string(),
});
```

This created friction:

1. **Extra setup step** — `createMessageSchema()` factory before using `messageSchema()`
2. **Dual package hazard** — Users might import `z` from `zod` directly, creating two Zod instances
3. **Documentation burden** — Explaining why factories are needed (discriminated unions, type inference)
4. **Cognitive load** — Two concepts (factory, schema creator) instead of one (helper function)

## Decision

Adopt **export-with-helpers pattern**: Export `z`, `message()`, and `createRouter()` directly from validator packages (`@ws-kit/zod`, `@ws-kit/valibot`). This:

1. **Provides single canonical import source** — One place to import validator and helpers
2. **Eliminates factory complexity** — `message()` is a simple helper, not a factory-returned function
3. **Preserves Zod runtime identity** — No module augmentation or prototype tricks
4. **Mitigates dual package hazard** — Single `@ws-kit/zod` import prevents validator instance mismatches
5. **Tree-shakeable** — Unused helpers eliminated by bundlers

### Implementation

```typescript
// @ws-kit/zod/src/index.ts

// Re-export Zod as the canonical instance
export * as z from "zod";

// Helper to create a message schema
export function message<
  const Type extends string,
  const Shape extends z.ZodRawShape | undefined = undefined,
>(type: Type, payload?: Shape extends z.ZodRawShape ? Shape : undefined) {
  return z.object({
    type: z.literal(type),
    payload: payload ? z.object(payload as any) : z.object({}),
    meta: z.object({
      timestamp: z.number().optional(),
      correlationId: z.string().optional(),
    }),
  }) as any;
}

// Re-export createRouter from router.ts
// (Uses builder pattern from ADR-005 for type preservation)
export { createRouter } from "./router.js";
```

### Why Not Prototype Tricks?

We explicitly **avoid** prototype-chain manipulation:

```typescript
// ❌ DO NOT do this (unsafe):
const z = require("zod");
z.message = function (type, payload) {
  /* ... */
};
export { z };
// Problem: Modifies global Zod instance, breaks instanceof checks
```

Instead, **direct function helpers** are safe:

```typescript
// ✅ DO this (safe):
export { z } from "zod";
export function message(type, payload) {
  /* ... */
}
// Benefits: Zod's instanceof checks work, no global pollution
```

## New API

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const LoginMessage = message("LOGIN", { username: z.string() });
const router = createRouter<AppData>();
```

**Improvements:**

| Aspect          | Before                    | After       | Benefit                         |
| --------------- | ------------------------- | ----------- | ------------------------------- |
| Factory calls   | 1 (`createMessageSchema`) | 0           | Eliminated friction             |
| Manual generics | Still 1 (`<AppData>`)     | Still 1     | TypeScript limitation (ADR-004) |
| Imports         | 3 packages                | 2 packages  | Simplified                      |
| Type assertions | Reduced (ADR-001)         | Reduced     | Same inference benefit          |
| Mental model    | Two factories             | Two helpers | Clearer, more direct            |

## Valibot Mirror

Same pattern for Valibot:

```typescript
// @ws-kit/valibot/src/index.ts

export * as v from "valibot";

export function message<
  const Type extends string,
  const Shape extends v.BaseSchema | undefined = undefined,
>(type: Type, payload?: Shape) {
  return v.object({
    type: v.literal(type),
    payload: payload ? v.object(payload as any) : v.object({}),
    meta: v.object({
      timestamp: v.optional(v.number()),
      correlationId: v.optional(v.string()),
    }),
  }) as any;
}

export { createRouter } from "./router.js";
```

Usage identical:

```typescript
import { v, message, createRouter } from "@ws-kit/valibot";

const LoginMessage = message("LOGIN", { username: v.string() });
const router = createRouter<AppData>();
```

## Dual Package Hazard Mitigation

The export-with-helpers pattern **mitigates** (not eliminates) the dual package hazard by enforcing single import source:

```typescript
// ✅ Correct: Single import source
import { z, message, createRouter } from "@ws-kit/zod";

// ❌ Avoid: Dual imports (hazard)
import { z as zodBase } from "zod"; // Different instance
import { message } from "@ws-kit/zod"; // Uses @ws-kit/zod's z
// Now message() uses a different z than your zodBase
```

**ESLint Rule Recommendation:** Add a rule to forbid bare `"zod"` imports in application code:

```javascript
// .eslintrc.js
{
  rules: {
    "no-restricted-imports": [
      "error",
      {
        name: "zod",
        message: "Use @ws-kit/zod instead to avoid dual-instance hazards.",
      },
    ],
  },
}
```

This ensures all code imports the canonical `z` from `@ws-kit/zod`, preventing accidental validator instance mismatches that could cause silent failures in discriminated unions.

## Complete Example

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve/bun";

type AppData = { userId?: string };

const LoginMessage = message("LOGIN", { username: z.string() });
const SendMessage = message("SEND", { text: z.string() });

const router = createRouter<AppData>();
router.on(LoginMessage, (ctx) => {
  ctx.assignData({ userId: "123" });
});
router.on(SendMessage, (ctx) => {
  console.log(ctx.payload.text);
});

serve(router, { port: 3000 });
```

## Implementation Status

The export-with-helpers pattern is the canonical API. Since the library has not been published, there is no backwards compatibility requirement for legacy factory patterns.

## Package Exports

Update `packages/zod/package.json` and `packages/valibot/package.json`:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

No subpath changes for core packages; all helpers exported from main entry point.

## Type Inference Guarantees

The `message()` helper preserves full type information through constrained generics:

```typescript
const LoginMessage = message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

// TypeScript infers:
// {
//   type: z.ZodLiteral<"LOGIN">,
//   payload: z.ZodObject<{
//     username: z.ZodString,
//     password: z.ZodString
//   }>,
//   meta: z.ZodObject<{ ... }>
// }

router.on(LoginMessage, (ctx) => {
  // ✅ ctx.type is "LOGIN" (literal)
  // ✅ ctx.payload.username is string
  // ✅ ctx.payload.password is string
});
```

This works because:

1. `<const Type extends string>` captures the literal type
2. `<const Shape extends z.ZodRawShape>` captures the payload shape
3. Builder pattern (ADR-005) preserves generic constraints through Proxy/forwarding
4. No type widening occurs

## AppDataDefault: Zero-Repetition Connection Data Types

For large applications, declaring `TData` at every `createRouter()` site creates friction. **TypeScript's declaration merging** eliminates this without build-time magic:

```typescript
// types/app-data.d.ts (single, centralized declaration)
declare module "@ws-kit/core" {
  interface AppDataDefault {
    userId?: string;
    username?: string;
    roles?: string[];
    traceId: string;
  }
}

// Now throughout your app, omit the generic:
import { createRouter } from "@ws-kit/zod";

const router = createRouter(); // ✅ Uses AppDataDefault automatically
const authRouter = createRouter(); // ✅ Same type

router.use((ctx, next) => {
  // ✅ ctx.ws.data has merged AppDataDefault type
  const userId = ctx.ws.data?.userId; // string | undefined
  return next();
});

router.on(SecureMessage, (ctx) => {
  // ✅ Full type safety without explicit <AppData> generic
  const username = ctx.ws.data?.username; // string | undefined
});
```

**Benefits:**

- ✅ **No repetition** — Declare connection data once
- ✅ **Backwards compatible** — Users can still use `createRouter<CustomData>()` to override locally
- ✅ **Zero runtime overhead** — Type-only feature
- ✅ **Composable** — Teams can declare domain-specific defaults in module `.d.ts` files

**When to use:**

- **AppDataDefault** — Global, shared connection data (tenant ID, user auth, trace ID)
- **Explicit `<TData>`** — Feature modules with custom context (room-specific state)

Both patterns can coexist—AppDataDefault provides the base, explicit generics allow features to extend it.

## Consequences

### Benefits

✅ **Single import source** — Import `z`, `message()`, `createRouter()` from one place
✅ **Simpler mental model** — Helpers instead of factories
✅ **Mitigates dual package hazard** — Enforces canonical validator instance
✅ **Zero setup friction** — No factory call before using `message()`
✅ **Tree-shakeable** — Unused helpers eliminated by bundlers
✅ **Runtime safe** — No prototype-chain tricks, Zod's `instanceof` checks work
✅ **Backwards compatible** — Old factory pattern still works (with deprecation)

### Trade-offs

⚠️ **Requires three imports for full setup** — `z`, `message`, `createRouter` (but from one source)
⚠️ **ESLint rule recommended** — Enforce single import source to prevent hazard
⚠️ **Documentation needed** — Explain why single source matters

## Alternatives Considered

### 1. Global `z` Augmentation (Module Merging)

Use TypeScript declaration merging to add methods to Zod:

```typescript
declare module "zod" {
  interface ZodObject {
    message<T extends string>(type: T, payload?: any): ...
  }
}

// Usage:
const schema = z.message("LOGIN", { ... });
```

**Why rejected:**

- Pollutes global `zod` namespace
- Changes Zod's API expectations (unexpected static methods)
- Harder to discover (not on `z` directly in IDE)
- TypeScript-only solution

### 2. Subpath Export Convenience (e.g., `@ws-kit/zod/message`)

Separate helper exports per function:

```typescript
import { z } from "zod";
import { message } from "@ws-kit/zod/message";
import { createRouter } from "@ws-kit/zod/router";
```

**Why rejected:**

- Fractures imports across three locations
- Users still need multiple `import` statements
- Doesn't solve single-source problem (can still `import z from "zod"`)
- More complex package exports

### 3. Keep Factory Pattern, Improve It

Enhanced factory with auto-detection:

```typescript
const { messageSchema } = createMessageSchema(); // Auto-detect Zod
const schema = messageSchema("LOGIN", { ... });
```

**Why rejected:**

- Still requires factory invocation
- Doesn't improve cognitive load
- Still has dual-source hazard risk
- Doesn't match industry patterns

## References

- **ADR-004**: Typed Router Factory Pattern (still valid; export-with-helpers uses builder approach)
- **ADR-005**: Builder Pattern and Symbol Escape Hatch (supports type preservation without factories)
- **Implementation**:
  - `packages/zod/src/index.ts` — Exports `z`, `message()`, `createRouter()`
  - `packages/valibot/src/index.ts` — Mirror implementation for Valibot
- **AppDataDefault Pattern**:
  - `types/app-data.d.ts` — Centralized connection data declaration (optional)
  - Uses TypeScript declaration merging (no build-time setup)
- **Examples**:
  - `examples/quick-start/index.ts` — Uses export-with-helpers pattern
  - `examples/*/index.ts` — All examples use single import source
- **Related**: CLAUDE.md — Quick Start Guide updated with new pattern
