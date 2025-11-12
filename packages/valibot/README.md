# @ws-kit/valibot

**Valibot validator adapter for type-safe WebSocket routing with ws-kit.**

Adds validation capability and RPC support to the core router via the `withValibot()` plugin.

## Quick Start

```typescript
import { v, message, rpc, withValibot, createRouter } from "@ws-kit/valibot";
import { serve } from "@ws-kit/bun";

// Define message schemas with type-safe payload inference
const Join = message("JOIN", { roomId: v.string() });
const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
  id: v.string(),
  name: v.string(),
});

// Create router and add validation
type AppData = { userId?: string };
const router = createRouter<AppData>()
  .plugin(withValibot())
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

- **`withValibot()`** — Validation plugin that adds payload validation and RPC support

### Type Inference

Extract individual components from schemas with zero runtime cost:

- **`InferType<T>`** — Extract message type literal (e.g., `"JOIN"`)
- **`InferPayload<T>`** — Extract payload shape, or `never` if undefined
- **`InferMeta<T>`** — Extract extended meta fields (excluding reserved keys)
- **`InferMessage<T>`** — Full message type (equivalent to `InferOutput<T>`)
- **`InferResponse<T>`** — Extract response type from an RPC schema, or `never` if undefined

**Example**:

```typescript
import { v, message } from "@ws-kit/valibot";
import type {
  InferType,
  InferPayload,
  InferMeta,
  InferResponse,
} from "@ws-kit/valibot";

const Join = message("JOIN", { roomId: v.string() });
const GetUser = message(
  "GET_USER",
  { id: v.string() },
  { response: { name: v.string() } },
);

type JoinType = InferType<typeof Join>; // "JOIN"
type JoinPayload = InferPayload<typeof Join>; // { roomId: string }
type GetUserResponse = InferResponse<typeof GetUser>; // { name: string }
```

### Re-exports

- **`v`** — Canonical Valibot instance
- **`createRouter`** — Core router factory (from `@ws-kit/core`)

## Key Design Principles

### Plugin-Based Architecture

Validation is added via the `withValibot()` plugin, not baked into the core:

```typescript
// Tiny router without validation
const router = createRouter();

// Add validation plugin for full capability
const validated = router.plugin(withValibot());

// Now you have ctx.payload, ctx.send(), ctx.reply(), etc.
```

### Capability Gating

Methods only exist when enabled:

```typescript
const router = createRouter();

// ❌ Type error: rpc() doesn't exist yet
router.rpc(schema, handler);

const router2 = createRouter().plugin(withValibot());

// ✅ OK: rpc() is available after plugin
router2.rpc(schema, handler);
```

### Single Canonical Import Source

All validator and helper imports come from one place to prevent dual-package hazards:

```typescript
// ✅ CORRECT: Single import source
import { v, message, rpc, withValibot, createRouter } from "@ws-kit/valibot";

// ❌ AVOID: Dual imports (creates type mismatches)
import * as v from "valibot"; // Different instance
import { message } from "@ws-kit/valibot"; // Uses @ws-kit/valibot's v
```

### Full Type Inference

Schemas and payloads flow through handlers with complete type safety:

```typescript
const Join = message("JOIN", { roomId: v.string() });

router.on(Join, (ctx) => {
  ctx.payload; // ✅ { roomId: string } (inferred)
  ctx.type; // ✅ "JOIN" (literal)
  ctx.send; // ✅ Available in event handlers
});

const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
  id: v.string(),
  name: v.string(),
});

router.rpc(GetUser, async (ctx) => {
  ctx.payload; // ✅ { id: string } (inferred)
  ctx.reply; // ✅ Available in RPC handlers
  ctx.progress; // ✅ For streaming updates
});
```

## Real Valibot Schemas with Strict Validation

Schemas returned by `message()` and `rpc()` are real Valibot schemas, enabling full Valibot capabilities:

```typescript
const Join = message("JOIN", { roomId: v.string() });

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
const TestMsg = message("TEST", { id: v.number() });

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
  { data: v.string() },
  { roomId: v.string(), priority: v.optional(v.number()) },
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

### Composable with Valibot Ecosystem

Since schemas are real Valibot schemas, you can use all Valibot features:

```typescript
// Discriminated unions over message types
const MessageSchema = v.union([
  message("JOIN", { roomId: v.string() }),
  message("LEAVE", { reason: v.string() }),
  message("PING"),
]);

const result = MessageSchema.safeParse(incomingMsg);
// Type narrowing works: result.data.type is "JOIN" | "LEAVE" | "PING"

// Transformations and pipes
const ValidatedJoin = v.pipe(
  message("JOIN", { roomId: v.string() }),
  v.transform((msg) => ({
    ...msg,
    meta: { ...msg.meta, timestamp: Date.now() },
  })),
);

// RPC response validation
const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
  id: v.string(),
  name: v.string(),
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

- **`@ws-kit/bun`** — Bun WebSocket server (recommended)
- **`@ws-kit/cloudflare`** — Cloudflare Durable Objects
- Custom platforms via `@ws-kit/core`

## Dependencies

- **`@ws-kit/core`** (required) — Core router
- **`valibot`** (peer) — Validation library
- **`@ws-kit/bun`** (optional) — Bun platform adapter with `serve()` helper
- **`@ws-kit/cloudflare`** (optional) — Cloudflare Durable Objects adapter
- **`@ws-kit/client`** (optional) — Type-safe browser client
