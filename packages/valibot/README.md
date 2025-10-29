# @ws-kit/valibot

Valibot validator adapter for type-safe WebSocket routing in ws-kit.

## Quick Start

The **export-with-helpers pattern** is the recommended way to use this package—no factories, no dual imports:

```typescript
import { v, message, createRouter } from "@ws-kit/valibot";
import { serve } from "@ws-kit/serve/bun";

// Define message schemas with full type inference
const PingMessage = message("PING", { text: v.string() });
const PongMessage = message("PONG", { reply: v.string() });

// Create type-safe router
type AppData = { userId?: string };
const router = createRouter<AppData>();

// Register handlers—fully typed!
router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

// Serve with type-safe handlers
serve(router, { port: 3000 });
```

## What This Package Exports

**Primary (recommended):**

- **`v`**: Re-exported Valibot instance (canonical import source)
- **`message()`**: Helper to create type-safe message schemas
- **`createRouter()`**: Create a type-safe router with full type inference

**Secondary (advanced use cases):**

- **`valibotValidator()`**: Validator adapter for custom router setup
- **`ValibotValidatorAdapter`**: Type class for advanced patterns
- **`ErrorMessage`**: Standard error message schema

**Deprecated (avoid):**

- ❌ `createMessageSchema()` — Use `message()` helper instead
- ❌ `createValibotRouter()` — Use `createRouter()` instead

## Key Design Principles

### Single Canonical Import Source

All validator and helper imports come from one place to prevent dual-package hazards:

```typescript
// ✅ CORRECT: Single import source
import { v, message, createRouter } from "@ws-kit/valibot";

// ❌ AVOID: Dual imports (creates type mismatches)
import * as v from "valibot"; // Different instance
import { message } from "@ws-kit/valibot"; // Uses @ws-kit/valibot's v
// Now you have two Valibot instances!
```

### No Factory Setup Needed

Messages are created with a simple helper function:

```typescript
// ✅ Direct: No factory call required
const LoginMessage = message("LOGIN", {
  username: v.string(),
  password: v.pipe(v.string(), v.minLength(8)),
});
```

### Full Type Inference

Schemas flow through handlers with complete type safety:

```typescript
router.on(LoginMessage, (ctx) => {
  // ✅ ctx.payload.username is inferred as string
  // ✅ ctx.type is inferred as "LOGIN" (literal type)
});
```

## Why Valibot?

Choose Valibot if you prioritize **bundle size and performance**:

| Aspect      | Valibot              | Zod                        |
| ----------- | -------------------- | -------------------------- |
| Bundle Size | ~1-2 kB              | ~5-6 kB                    |
| Performance | ~2x faster           | Baseline                   |
| API Style   | Functional pipelines | Method chaining            |
| Best for    | Client-side, mobile  | Server-side, familiar APIs |

## Platform Support

This adapter works with any ws-kit platform:

- **`@ws-kit/serve/bun`** — Bun WebSocket server (recommended)
- **`@ws-kit/serve/cloudflare-do`** — Cloudflare Durable Objects
- Custom platforms via `@ws-kit/core`

## Dependencies

- **`@ws-kit/core`** (required) — Core router
- **`valibot`** (peer) — Validation library
- **`@ws-kit/serve`** (optional) — Multi-runtime server setup
- **`@ws-kit/client`** (optional) — Type-safe browser client
