# Message Schema Specification

**Status**: ✅ Implemented (export-with-helpers pattern, conditional typing, RPC helper)

## Export-with-Helpers Pattern

Import validator and helpers from a single canonical source. This eliminates factory complexity and prevents dual-package hazards.

```typescript
// Server (Zod) - ✅ RECOMMENDED
import { z, message, createRouter } from "@ws-kit/zod";

// Server (Valibot) - ✅ RECOMMENDED
import { v, message, createRouter } from "@ws-kit/valibot";

// Client (Typed) - ✅ RECOMMENDED
import { wsClient } from "@ws-kit/client/zod";
// or
import { wsClient } from "@ws-kit/client/valibot";

// Type imports (same package as your schemas)
import type {
  AnyMessageSchema,
  InferMessage,
  InferPayload,
  InferMeta,
} from "@ws-kit/zod"; // or /valibot
```

**Why This Pattern (See ADR-007):**

- **Single canonical source** — Import `z`, `message()`, and `createRouter()` from ONE place to prevent dual-package hazards
- **No factory complexity** — `message()` is a plain helper, not a factory return. No `createMessageSchema()` setup needed.
- **Runtime identity preserved** — Validator is re-exported as-is; no prototype tricks, no `instanceof` issues
- **Schemas are portable** — Define once, use in client + server
- **Full type inference** — Constrained generics flow through handlers without assertions
- **Tree-shakeable** — Bundlers eliminate unused helpers

## Canonical Import Patterns {#Canonical-Import-Patterns}

**Single source of truth for all imports.** Reference this section from other specs instead of duplicating.

```typescript
// ✅ Server setup (Zod)
import { z, message, rpc, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

type AppData = { userId?: string };
const router = createRouter<AppData>();

// Standard messages
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

// RPC helper: binds request and response schemas
const QueryMsg = rpc("QUERY", { id: z.string() }, "QUERY_RESULT", {
  data: z.any(),
});

// ✅ Server setup (Valibot)
import { v, message, rpc, createRouter } from "@ws-kit/valibot";

// ✅ Client setup (Typed)
import { wsClient } from "@ws-kit/client/zod";
const client = wsClient<typeof router>("ws://localhost:3000");

// ❌ NEVER: Mixing imports from different sources
// Using both 'zod' and '@ws-kit/zod' risks dual package hazard
```

**Validator Consistency**: Use the same validator (`/zod` or `/valibot`) across client, server, and schemas within a project. Mixing validators breaks type compatibility (TypeScript enforces this at compile time).

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

- `clientId`: Connection identity (access via `ctx.ws.data.clientId`)
- `receivedAt`: Server receive timestamp (access via `ctx.receivedAt`)

These keys are stripped during normalization before validation (security boundary). Extended meta schemas MUST NOT define these keys (schema creation will throw an error). See @validation.md#normalization-rules for complete implementation details.

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
const PingMessage = message("PING");
// { type: "PING", meta: { ... } }
// Handler: ctx.type === "PING", no ctx.payload
```

### With Payload

```typescript
const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
});
// { type: "JOIN_ROOM", meta: { ... }, payload: { roomId: string } }
// Handler: ctx.payload.roomId is string
```

### Extended Meta

```typescript
const RoomMessage = message(
  "ROOM_MSG",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta
);
// meta: { correlationId?, timestamp?, roomId: string }
// Handler: ctx.meta.roomId is string (required)
```

### Request-Response Pattern (RPC)

**Unified pattern**: RPC messages are defined with optional `response` field. Presence of `response` marks the message as RPC.

```typescript
import { z, message, rpc } from "@ws-kit/zod";

// ✅ RECOMMENDED: Unified config-based syntax (ADR-015)
const GetUser = message("GET_USER", {
  payload: { id: z.string() },
  response: { user: UserSchema },
});

// Legacy syntax still supported
const QueryData = rpc("QUERY_DATA", { id: z.string() }, "QUERY_RESULT", {
  data: z.object({ id: z.string(), value: z.any() }),
});
```

**Server**: Use `ctx.reply()` for terminal response (RPC-only):

```typescript
const router = createRouter();

router.on(GetUser, (ctx) => {
  const user = await db.users.findById(ctx.payload.id);
  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }
  // ✅ Type-safe to response schema
  ctx.reply?.({ user });
});
```

### Progress Updates (Non-Terminal)

For long-running RPC operations, send non-terminal progress updates before the final terminal reply. Progress updates allow the server to stream intermediate results while the client waits for completion.

**Server**: Use `ctx.progress()` before `ctx.reply()`:

```typescript
router.rpc(GetUser, (ctx) => {
  ctx.progress?.({ stage: "loading" });
  const user = await db.users.findById(ctx.payload.id);
  ctx.progress?.({ stage: "validating" });
  ctx.reply?.(GetUserResponse, { user });
});
```

**Client**: Use `call.progress()` to stream updates and `call.result()` for terminal:

```typescript
const client = wsClient({ url: "ws://localhost:3000" });

// New dual-surface API (ADR-015)
const call = client.request(GetUser, { id: "123" });

// Optional: listen to progress updates
for await (const p of call.progress()) {
  console.log("progress:", p.stage);
}

// Wait for terminal response
const { user } = await call.result();
```

**Progress Message Wire Format**:

Progress updates are sent as internal control messages (reserved type `$ws:rpc-progress`):

```json
{
  "type": "$ws:rpc-progress",
  "meta": {
    "timestamp": 1730450000125,
    "correlationId": "req-42"
  },
  "data": { "stage": "validating" }
}
```

**Semantics**:

- **Non-terminal**: Client waits for final `reply()` or `error()` (progress messages don't complete the RPC)
- **Unidirectional**: Server → Client only (clients cannot send progress messages)
- **Optional**: Not required; use only when operation genuinely produces updates
- **Order guarantee**: Progress messages arrive in send order; final response arrives last
- **Schema-inferred**: Progress data type matches the response schema

**Benefits (ADR-015)**:

- One message definition for RPC (no dual schemas)
- Terminal/progress intent explicit (`ctx.reply()` vs `ctx.progress()`)
- Type-safe to response schema at compile time
- Progress updates optional; client may skip them
- Automatic correlation tracking with one-shot guard

## Type Inference

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import type { MessageContext } from "@ws-kit/zod";

const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });

// Schema type
type JoinRoomType = z.infer<typeof JoinRoom>;

// Handler context type (automatically inferred)
type AppData = { userId?: string };
const router = createRouter<AppData>();

router.on(JoinRoom, (ctx) => {
  // ctx is fully typed by schema!
  // {
  //   ws: ServerWebSocket<AppData & { clientId: string }>,
  //   type: "JOIN_ROOM" (literal),
  //   meta: { correlationId?, timestamp?, ... },
  //   payload: { roomId: string },  // ✅ Required (schema defines it)
  //   receivedAt: number,
  //   send: (schema, payload) => void,
  //   unicast: (schema, payload) => void,
  //   error: (code, message, details?) => void,
  //   subscribe: (topic) => void,
  //   unsubscribe: (topic) => void,
  // }
});
```

## Conditional Payload Typing

**Key Feature**: `ctx.payload` exists **only** when schema defines it:

```typescript
const WithPayload = message("WITH", { id: z.number() });
const WithoutPayload = message("WITHOUT");

router.on(WithPayload, (ctx) => {
  ctx.payload.id; // ✅ Typed as number
});

router.on(WithoutPayload, (ctx) => {
  ctx.payload; // ❌ Type error
});
```

## Discriminated Unions

```typescript
const PingMsg = message("PING");
const PongMsg = message("PONG", { reply: z.string() });

const MessageUnion = z.discriminatedUnion("type", [PingMsg, PongMsg]);
```

**Note**: Discriminated unions work naturally with the export-with-helpers pattern since all schemas are created with the same validator instance.

## Client-Side Message Validation

Schemas are portable and work client-side for validation before sending:

```typescript
import { z, message } from "@ws-kit/zod";

const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });

// Validate on client before sending
const result = JoinRoom.safeParse({
  type: "JOIN_ROOM",
  payload: { roomId: "general" },
  meta: {},
});

if (result.success) {
  ws.send(JSON.stringify(result.data));
} else {
  console.error("Validation failed:", result.error);
}
```

**Client-side validation works**: Schemas MUST remain client-validatable; no server-only fields required. See @rules.md#messaging for enforcement.

## Standard Error Schema

Export a standard `ErrorMessage` helper from validator packages:

```typescript
import { ErrorMessage } from "@ws-kit/zod";
// or get it from schema exports if custom
const ErrorMsg = message("ERROR", {
  code: z.enum([
    "UNAUTHENTICATED",
    "PERMISSION_DENIED",
    "INVALID_ARGUMENT",
    "FAILED_PRECONDITION",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "ABORTED",
    "DEADLINE_EXCEEDED",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "UNIMPLEMENTED",
    "INTERNAL",
    "CANCELLED",
  ]),
  message: z.string(),
  details: z.record(z.any()).optional(),
  retryAfterMs: z.number().optional(),
});

// Usage in handlers:
router.on(SomeMessage, (ctx) => {
  if (!authorized) {
    ctx.error("PERMISSION_DENIED", "Not allowed");
  }
});
```

**Direction**: Server-to-client only. Clients MUST NOT send `ERROR` messages (see @error-handling.md#Error-Message-Direction for alternatives).

**Error Codes**: See @error-handling.md#error-code-enum for the canonical ErrorCode enum definition and usage guidelines.

## Key Constraints

> See @rules.md for complete rules. Critical for message schemas:

1. **Export-with-helpers pattern** — Use `message()` helper from `@ws-kit/zod` or `@ws-kit/valibot` (see ADR-007, @rules.md#import-patterns)
2. **Client-side validation** — Schemas MUST NOT require server-only fields (see @rules.md#messaging)
3. **Strict schemas** — Reject unknown keys at all levels (see @schema.md#Strict-Schemas)
4. **Connection identity** — Access via `ctx.ws.data.clientId`, not `ctx.meta` (see @rules.md#state-layering)
5. **Server timestamp** — Use `ctx.receivedAt` for authoritative time (see @schema.md#Which-timestamp-to-use)
