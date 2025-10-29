# Message Schema Specification

**Status**: ✅ Implemented (factory pattern, conditional typing)

## Factory Pattern (Critical)

**MUST use factory pattern** to avoid dual package hazard with discriminated unions:

```typescript
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema, createMessage } = createMessageSchema(z);
```

## Canonical Import Patterns {#Canonical-Import-Patterns}

**Single source of truth for all imports.** Reference this section from other specs instead of duplicating.

```typescript
// Server (Zod) - ✅ Recommended for type-safe routing
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";

// Server (Valibot) - ✅ Recommended for type-safe routing
import { createValibotRouter, createMessageSchema } from "@ws-kit/valibot";

// Server (Advanced - custom validators only)
import { WebSocketRouter } from "@ws-kit/core";
import { zodValidator } from "@ws-kit/zod"; // or valibotValidator

// Client (Typed - ✅ Recommended for type safety)
import { createClient } from "@ws-kit/client/zod"; // Zod
import { createClient } from "@ws-kit/client/valibot"; // Valibot

// Client (Generic - custom validators only; handlers infer as unknown)
import { createClient } from "@ws-kit/client";

// Shared schemas (portable between client/server)
const { messageSchema } = createMessageSchema(z); // Use validator instance

// Broadcasting (server-side multicast)
import { publish } from "@ws-kit/zod/publish"; // Zod
import { publish } from "@ws-kit/valibot/publish"; // Valibot

// Type imports (same package as your schemas)
import type {
  AnyMessageSchema,
  InferMessage,
  InferPayload,
  InferMeta,
} from "@ws-kit/zod"; // or /valibot
```

**Validator Consistency**: Use the same validator (`/zod` or `/valibot`) across client, server, and schemas within a project. Mixing validators breaks type compatibility (TypeScript enforces this at compile time).

**Key points:**

- Schemas are **portable** — define once in shared module, import in both client and server
- Use **typed router factories** (`createZodRouter`, `createValibotRouter`) for full type inference in handlers (see ADR-004 for details)
- Use **typed clients** (`/zod/client`, `/valibot/client`) for automatic inference (see ADR-002)
- Generic client (`/client`) and core router require manual type assertions; use only for custom validators

## Strict Schemas (Required) {#Strict-Schemas}

All message schemas **MUST** reject unknown keys at **root**, **meta**, and **payload** levels.

**Rationale:**

- Handlers trust schema validation; unknown keys violate this contract
- Prevents DoS via unbounded unknown fields
- Maintains client-server schema symmetry (client-side validation catches mistakes)
- Enforces wire cleanliness (e.g., rejects `payload` when schema defines none)

**Enforcement:**

Adapters MUST configure validators to operate in strict mode. See @validation.md#Strict-Mode-Enforcement for implementation requirements and validation behavior.

## Message Structure

### Wire Format (Client → Server)

Clients send minimal messages. The router normalizes before validation.

```typescript
// Client sends
{
  type: string,              // Required
  payload?: T,               // Present only when schema defines it; when present it's required by that schema
  meta?: {                   // Optional; router defaults to {}
    correlationId?: string,  // Client-controlled request/response correlation
    timestamp?: number,      // Producer time (when message created); use ctx.receivedAt for server decisions
    // Custom fields from extended meta schemas
  }
}
```

**Security**: Router strips any `clientId` field sent by clients (reserved, untrusted).

### Handler Context (After Validation)

Handlers receive validated messages plus server-provided context:

```typescript
// Handler context
{
  ws: ServerWebSocket<Data>,       // Connection with ws.data.clientId
  type: "MESSAGE_TYPE",             // Message type literal
  meta: {                           // Validated client metadata
    correlationId?: string,
    timestamp?: number,             // Producer time (when message was created)
    // Extended meta fields from schema
  },
  payload?: T,                      // Only exists if schema defines it
  receivedAt: number,               // Server ingress timestamp (authoritative for server logic)
  send: SendFunction                // Type-safe send helper
}
```

### Server-Controlled Fields

**Connection identity** (NOT in message `meta`):

- `ctx.ws.data.clientId`: Generated during WebSocket upgrade (UUID v7)
- Access in handlers via `ctx.ws.data.clientId` (always present, type-safe)

**Receive timestamp** (NOT in message `meta`):

- `ctx.receivedAt`: Captured at message ingress before parsing (server clock, `Date.now()`)
- **Authoritative server time** — always use this for server-side logic (rate limiting, ordering, TTL)
- Separate from optional `ctx.meta.timestamp` (producer time, may be skewed or missing)

**Which timestamp to use:** {#Which-timestamp-to-use}

This is the **canonical table** for timestamp usage across all specs. All other timestamp guidance references this section.

| Use Case                                       | Field            | Rationale                                                          |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| Rate limiting, TTL, ordering, audits           | `ctx.receivedAt` | Server clock (authoritative ingress time); captured before parsing |
| UI "sent at", optimistic ordering, lag display | `meta.timestamp` | Producer clock (client time); may be skewed/missing                |

**Rule**: Server logic MUST use `ctx.receivedAt`. Client UI MAY use `meta.timestamp` for display purposes only.

**Why `clientId` is not in `meta`**: {#Why-clientId-is-not-in-meta}

- Connection identity belongs to transport layer, not message payload
- Avoids wire bloat (no need to send UUID in every message)
- Eliminates spoofing vectors (client cannot set connection identity)
- Preserves client-side validation (clients can validate messages they send)
- See @broadcasting.md#Origin-Option for application-level sender tracking

**Reserved Server-Only Meta Keys**: {#Reserved-Server-Only-Meta-Keys}

The following keys are RESERVED and MUST NOT be set by clients (see @rules.md#reserved-keys for canonical list):

- `clientId`: Connection identity (stripped during normalization, access via `ctx.ws.data.clientId`)
- `receivedAt`: Server receive timestamp (stripped during normalization, access via `ctx.receivedAt`)

These keys are stripped during message normalization before validation (security boundary). See @validation.md#normalization-rules for implementation details.

**Schema Constraint**: Extended meta schemas MUST NOT define reserved keys (`clientId`, `receivedAt`). Adapters MUST throw an error at schema creation if reserved keys are detected in the extended meta definition (design-time enforcement layer).

**Enforcement**: The `messageSchema()` factory function validates extended meta keys and throws:

```typescript
throw new Error(
  `Reserved meta keys not allowed in schema: ${reservedInMeta.join(", ")}. ` +
    `Reserved keys: ${Array.from(RESERVED_META_KEYS).join(", ")}`,
);
```

**Rationale**: Prevents silent validation failures from normalization stripping user-defined reserved keys. Fails fast at design time with clear error message.

**Critical**:

- Messages without payload MUST NOT include the `payload` key. Validators MUST reject messages with unexpected `payload` (strict mode).
- Clients MAY omit `meta` entirely; router normalizes to `{}`.
- `clientId` is connection state (`ctx.ws.data`), not message state (`ctx.meta`).

### Why Payload Is Not Optional

TypeScript's `payload?: T` would allow `undefined` at runtime but wouldn't prevent access to `ctx.payload` in handlers. The conditional type approach (intersection with `Record<string, never>` when absent) provides compile-time safety by making `ctx.payload` a type error when the schema doesn't define it.

See ADR-001 for implementation details.

## Schema Patterns

### Without Payload

```typescript
const PingMessage = messageSchema("PING");
// { type: "PING", meta: { ... } }
// Handler: ctx.type === "PING", no ctx.payload
```

### With Payload

```typescript
const JoinRoom = messageSchema("JOIN_ROOM", {
  roomId: z.string(),
});
// { type: "JOIN_ROOM", meta: { ... }, payload: { roomId: string } }
// Handler: ctx.payload.roomId is string
```

### Extended Meta

```typescript
const RoomMessage = messageSchema(
  "ROOM_MSG",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta
);
// meta: { correlationId?, timestamp?, roomId: string }
// Handler: ctx.meta.roomId is string (required)
```

## Type Inference

```typescript
// Schema type
type JoinRoomType = z.infer<typeof JoinRoom>;

// Handler context type
import type { MessageContext } from "@ws-kit/zod";
type Ctx = MessageContext<typeof JoinRoom, WebSocketData<{}>>;
// {
//   ws: ServerWebSocket<...>,
//   type: "JOIN_ROOM",
//   meta: { correlationId?, timestamp?, ... },
//   payload: { roomId: string },  // ✅ Only if schema defines it
//   receivedAt: number,
//   send: SendFunction
// }
```

## Conditional Payload Typing

**Key Feature**: `ctx.payload` exists **only** when schema defines it:

```typescript
const WithPayload = messageSchema("WITH", { id: z.number() });
const WithoutPayload = messageSchema("WITHOUT");

router.onMessage(WithPayload, (ctx) => {
  ctx.payload.id; // ✅ Typed as number
});

router.onMessage(WithoutPayload, (ctx) => {
  ctx.payload; // ❌ Type error
});
```

## Discriminated Unions

```typescript
const PingMsg = messageSchema("PING");
const PongMsg = messageSchema("PONG", { reply: z.string() });

const MessageUnion = z.discriminatedUnion("type", [PingMsg, PongMsg]);
```

**Critical**: Factory pattern required for discriminated unions to pass instanceof checks.

## Client-Side Message Creation

```typescript
const { createMessage } = createMessageSchema(z);

// Minimal (no meta)
const msg1 = createMessage(JoinRoom, { roomId: "general" });
// { type: "JOIN_ROOM", meta: {}, payload: { roomId: "general" } }

// With client metadata
const msg2 = createMessage(
  JoinRoom,
  { roomId: "general" },
  { correlationId: "req-123" },
);
// { type: "JOIN_ROOM", meta: { correlationId: "req-123" }, payload: {...} }

if (msg1.success) {
  ws.send(JSON.stringify(msg1.data));
}
```

**Client-side validation works**: Schemas MUST remain client-validatable; no server-only fields required. See @rules.md#messaging for enforcement.

## Standard Error Schema

```typescript
const { ErrorMessage } = createMessageSchema(z);
// {
//   type: "ERROR",
//   meta: { correlationId?, timestamp?, ... },
//   payload: {
//     code: ErrorCode,
//     message?: string,
//     context?: Record<string, any>
//   }
// }
```

**Direction**: Server-to-client only. Clients MUST NOT send `ERROR` messages (see @error-handling.md#Error-Message-Direction for alternatives).

**Error Codes**: See @error-handling.md#error-code-enum for the canonical ErrorCode enum definition and usage guidelines.

## Key Constraints

> See @rules.md for complete rules. Critical for message schemas:

1. **Factory pattern required** — Use `createMessageSchema(validator)` (see @rules.md#import-patterns)
2. **Client-side validation** — Schemas MUST NOT require server-only fields (see @rules.md#messaging)
3. **Strict schemas** — Reject unknown keys at all levels (see @schema.md#Strict-Schemas)
4. **Connection identity** — Access via `ctx.ws.data.clientId`, not `ctx.meta` (see @rules.md#state-layering)
5. **Server timestamp** — Use `ctx.receivedAt` for authoritative time (see @schema.md#Which-timestamp-to-use)
