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

## Real Zod Schemas with Strict Validation

Schemas returned by `message()` and `rpc()` are real Zod objects, enabling full Zod capabilities:

```typescript
const Join = message("JOIN", { roomId: z.string() });

// Use schemas for client-side validation before sending
const clientMsg = {
  type: "JOIN" as const,
  meta: {},
  payload: { roomId: "42" },
};
const result = Join.safeParse(clientMsg);

if (!result.success) {
  console.error("Invalid message:", result.error);
} else {
  sendToServer(result.data);
}
```

### Strict Validation by Default

All schemas enforce **strict mode**, rejecting unknown keys at every level:

```typescript
const TestMsg = message("TEST", { id: z.number() });

// ✅ Valid: correct structure
TestMsg.safeParse({
  type: "TEST",
  meta: {},
  payload: { id: 123 },
});

// ❌ Invalid: unknown root key
TestMsg.safeParse({
  type: "TEST",
  meta: {},
  payload: { id: 123 },
  extra: "not allowed", // Unknown key rejected
});

// ❌ Invalid: unknown payload key
TestMsg.safeParse({
  type: "TEST",
  meta: {},
  payload: { id: 123, extra: "not allowed" }, // Unknown key rejected
});
```

### Extended Meta Fields

Meta can be extended with application-specific fields:

```typescript
const WithMeta = message(
  "TEST",
  { data: z.string() },
  { roomId: z.string(), priority: z.number().optional() },
);

// ✅ Valid: required and optional extended fields
WithMeta.safeParse({
  type: "TEST",
  meta: { roomId: "room-1", priority: 5 },
  payload: { data: "hello" },
});

// ✅ Also valid: optional field omitted
WithMeta.safeParse({
  type: "TEST",
  meta: { roomId: "room-1" },
  payload: { data: "hello" },
});
```

### Composable with Zod Ecosystem

Since schemas are real Zod objects, you can use all Zod features:

```typescript
// Discriminated unions over message types
const MessageSchema = z.discriminatedUnion("type", [
  message("JOIN", { roomId: z.string() }),
  message("LEAVE", { reason: z.string() }),
  message("PING"),
]);

const result = MessageSchema.safeParse(incomingMsg);
// Type narrowing works: result.data.type is "JOIN" | "LEAVE" | "PING"

// Transformations and refinements
const ValidatedJoin = message("JOIN", { roomId: z.string() }).transform(
  (msg) => ({
    ...msg,
    meta: { ...msg.meta, timestamp: Date.now() },
  }),
);

// RPC response validation
const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

// Validate response independently
const response = {
  type: "USER",
  meta: {},
  payload: { id: "1", name: "Alice" },
};
if (GetUser.response.safeParse(response).success) {
  console.log("Response is valid");
}
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
