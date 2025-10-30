# @ws-kit/zod

Zod validator adapter for type-safe WebSocket routing in ws-kit.

## Quick Start

The **export-with-helpers pattern** is the recommended way to use this package—no factories, no dual imports:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define message schemas with full type inference
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

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

- **`z`**: Re-exported Zod instance (canonical import source)
- **`message()`**: Helper to create type-safe message schemas
- **`createRouter()`**: Create a type-safe router with full type inference

**Secondary (advanced use cases):**

- **`zodValidator()`**: Validator adapter for custom router setup
- **`ZodValidatorAdapter`**: Type class for advanced patterns
- **`ErrorMessage`**: Standard error message schema

## Key Design Principles

### Single Canonical Import Source

All validator and helper imports come from one place to prevent dual-package hazards:

```typescript
// ✅ CORRECT: Single import source
import { z, message, createRouter } from "@ws-kit/zod";

// ❌ AVOID: Dual imports (creates type mismatches)
import { z } from "zod"; // Different instance
import { message } from "@ws-kit/zod"; // Uses @ws-kit/zod's z
// Now you have two Zod instances!
```

### No Factory Setup Needed

Messages are created with a simple helper function:

```typescript
// ✅ Direct: No factory call required
const LoginMessage = message("LOGIN", {
  username: z.string(),
  password: z.string(),
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

## Platform Support

This adapter works with any ws-kit platform:

- **`@ws-kit/bun`** — Bun WebSocket server (recommended)
- **`@ws-kit/cloudflare-do`** — Cloudflare Durable Objects
- Custom platforms via `@ws-kit/core`

## Dependencies

- **`@ws-kit/core`** (required) — Core router
- **`zod`** (peer) — Validation library
- **`@ws-kit/bun`** (optional) — Bun platform adapter with `serve()` helper
- **`@ws-kit/cloudflare-do`** (optional) — Cloudflare Durable Objects adapter
- **`@ws-kit/client`** (optional) — Type-safe browser client
