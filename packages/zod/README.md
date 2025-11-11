# @ws-kit/zod

**Zod validator adapter for type-safe WebSocket routing with ws-kit.**

Adds validation capability and RPC support to the core router via the `withZod()` plugin.

## Quick Start

```typescript
import { z, message, rpc, withZod, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define message schemas with type-safe payload inference
const Join = message("JOIN", { roomId: z.string() });
const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

// Create router and add validation
type AppData = { userId?: string };
const router = createRouter<AppData>()
  .plugin(withZod())
  .on(Join, (ctx) => {
    // ctx.payload: { roomId: string } (validated)
    ctx.send(Join, { roomId: "42" });
  })
  .rpc(GetUser, async (ctx) => {
    // ctx.payload: { id: string } (validated)
    ctx.reply({ id: ctx.payload.id, name: "Alice" });
  });

serve(router, { port: 3000 });
```

## What This Package Exports

### Schema Builders

- **`message(type, payload?)`** — Create event message schemas
- **`rpc(requestType, requestPayload, responseType, responsePayload)`** — Create RPC schemas

### Plugin

- **`withZod()`** — Validation plugin that adds payload validation and RPC support

### Type Inference

- **`InferPayload<T>`** — Extract payload type from a schema
- **`InferResponse<T>`** — Extract response type from an RPC schema
- **`InferType<T>`** — Extract message type from a schema

### Re-exports

- **`z`** — Canonical Zod instance
- **`createRouter`** — Core router factory (from `@ws-kit/core`)

## Key Design Principles

### Plugin-Based Architecture

Validation is added via the `withZod()` plugin, not baked into the core:

```typescript
// Tiny router without validation
const router = createRouter();

// Add validation plugin for full capability
const validated = router.plugin(withZod());

// Now you have ctx.payload, ctx.send(), ctx.reply(), etc.
```

### Capability Gating

Methods only exist when enabled:

```typescript
const router = createRouter();

// ❌ Type error: rpc() doesn't exist yet
router.rpc(schema, handler);

const router2 = createRouter().plugin(withZod());

// ✅ OK: rpc() is available after plugin
router2.rpc(schema, handler);
```

### Single Canonical Import Source

All validator and helper imports come from one place to prevent dual-package hazards:

```typescript
// ✅ CORRECT: Single import source
import { z, message, rpc, withZod, createRouter } from "@ws-kit/zod";

// ❌ AVOID: Dual imports (creates type mismatches)
import { z } from "zod"; // Different instance
import { message } from "@ws-kit/zod"; // Uses @ws-kit/zod's z
```

### Full Type Inference

Schemas and payloads flow through handlers with complete type safety:

```typescript
const Join = message("JOIN", { roomId: z.string() });

router.on(Join, (ctx) => {
  ctx.payload; // ✅ { roomId: string } (inferred)
  ctx.type; // ✅ "JOIN" (literal)
  ctx.send; // ✅ Available in event handlers
});

const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

router.rpc(GetUser, async (ctx) => {
  ctx.payload; // ✅ { id: string } (inferred)
  ctx.reply; // ✅ Available in RPC handlers
  ctx.progress; // ✅ For streaming updates
});
```

## Platform Support

This adapter works with any ws-kit platform:

- **`@ws-kit/bun`** — Bun WebSocket server (recommended)
- **`@ws-kit/cloudflare`** — Cloudflare Durable Objects
- Custom platforms via `@ws-kit/core`

## Dependencies

- **`@ws-kit/core`** (required) — Core router
- **`zod`** (peer) — Validation library
- **`@ws-kit/bun`** (optional) — Bun platform adapter with `serve()` helper
- **`@ws-kit/cloudflare`** (optional) — Cloudflare Durable Objects adapter
- **`@ws-kit/client`** (optional) — Type-safe browser client
