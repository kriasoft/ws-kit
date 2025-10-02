# Development Constraints

Single source of truth for MUST/SHOULD/NEVER rules when working with `bun-ws-router`.

## Critical Rules (NEVER Violate)

### Type Safety

1. **NEVER** access `ctx.payload` without verifying schema defines payload
   - See @adrs.md#ADR-001 for conditional typing rationale
2. **NEVER** use optional payload typing (`payload?: T` in `MessageContext`)
   - Use conditional types that omit `payload` entirely when not defined

### Import Patterns

3. **NEVER** import from `"bun-ws-router"` root - use `/zod` or `/valibot`
4. **NEVER** use deprecated `messageSchema` export - use factory pattern
   - Required to avoid dual package hazard with discriminated unions

### Security & Validation

5. **NEVER** re-validate data inside handlers - trust schema validation
6. **NEVER** access connection identity via `ctx.meta.clientId` - use `ctx.ws.data.clientId`
7. **NEVER** allow clients to set reserved meta keys (`clientId`, `receivedAt`)
   - Router MUST strip these during normalization BEFORE validation (security boundary)
   - Implementation: `shared/message.ts` in `MessageRouter.handleMessage()`
   - See @validation.md#normalization-rules for canonical code
8. **ALWAYS** use strict schemas - reject unknown keys at root/meta/payload levels
   - See @schema.md#Strict-Schemas for rationale
   - See @validation.md#Strict-Mode-Enforcement for adapter requirements

## Required Patterns (ALWAYS Use)

### Schema & Validation {#validation-flow}

1. **ALWAYS** use factory pattern: `createMessageSchema(validator)`

   ```typescript
   import { z } from "zod";
   import { createMessageSchema } from "bun-ws-router/zod";
   const { messageSchema } = createMessageSchema(z);
   ```

2. **ALWAYS** follow this exact validation flow (order is security-critical):

   **Server (inbound messages):**

   ```
   JSON Parse → Type Check → Handler Lookup → Normalize → Validate → Handler
   ```

   **Client (outbound messages):**

   ```
   Strip Reserved/Managed Keys → Merge Meta → Validate → Send
   ```

   - Server normalization MUST strip reserved keys (`clientId`, `receivedAt`) before validation (security boundary)
   - Client normalization MUST strip reserved/managed keys (`clientId`, `receivedAt`, `correlationId`) from `opts.meta` before merging (see @client.md#client-normalization)
   - Adapters MUST receive normalized input (never raw parsed JSON or unsanitized opts)
   - See @validation.md#normalization-rules for server, @client.md#client-normalization for client

### Connection & Context

3. **ALWAYS** access connection identity via `ctx.ws.data.clientId`
4. **ALWAYS** use `ctx.receivedAt` for server receive timestamp
   - Server-authoritative time for rate limiting, TTL, ordering
   - Separate from optional `ctx.meta.timestamp` (producer time, may be skewed/missing)
   - See @schema.md#Which-timestamp-to-use for full guidance

### Type System

5. **ALWAYS** use intersection types for conditional fields
   ```typescript
   type MessageContext = {
     ws: ServerWebSocket<Data>;
     type: string;
     meta: InferredMeta;
     receivedAt: number;
     send: SendFunction;
   } & (PayloadExists ? { payload: InferredPayload } : Record<string, never>);
   ```

### Error Handling

9. **ALWAYS** wrap async operations in try/catch
10. **ALWAYS** log errors with `clientId` context (`ctx.ws.data.clientId`)
11. **ALWAYS** keep connections open on errors (handler must explicitly close)

### Messaging

12. **ALWAYS** use `ctx.send()` for type-safe message sending
13. **ALWAYS** use `publish()` helper for validated broadcasting
    - Validates before publishing to prevent malformed messages reaching subscribers
14. **NEVER** inject `clientId` into message meta (inbound or outbound)
    - Connection identity is transport state (`ctx.ws.data.clientId`)
    - Use `publish(..., { origin: "userId" })` for sender tracking (see @pubsub.md#Origin-Option)
    - Injects as `meta.senderId` (not `clientId`) for application-level identity
    - `origin` is a `ws.data` field name; function extractors NOT supported (hot-path performance)
    - **No-op if `ws.data[origin]` is undefined**
15. **ALWAYS** auto-inject `timestamp` in outbound messages (`ctx.send()` and `publish()`)

### Lifecycle

16. **ALWAYS** unsubscribe in `onClose()` handler
17. **ALWAYS** store topic identifiers in `ctx.ws.data` for cleanup

## Type System Trade-offs

Accept these TypeScript violations for better DX:

1. **LSP variance in `addRoutes()`** - Derived routers more restrictive than base
   - See @adrs.md#ADR-001 for type override pattern
2. **`| any` in `addRoutes()`** - Allows accepting derived router instances
3. **`@ts-expect-error` in type overrides** - Enables IDE inference for inline handlers

## Performance Requirements {#performance}

1. **UUID v7 for `clientId`** - Time-ordered, better DB indexing than UUID v4
2. **Map-based handler lookup** - O(1) by message type (MUST use Map, not linear search)
3. **Last-write-wins registration** - Log warnings on handler overwrite
4. **Single handler per type** - No middleware chains (complexity reduction)
5. **Normalization in hot path** - Strip reserved keys inline (O(k) where k≤3); MUST NOT clone entire message

## Error Handling Requirements {#error-handling}

See @error-handling.md for detailed patterns.

1. **All errors logged** - Connections stay open unless handler closes
2. **Explicit close required** - Handlers MUST call `ctx.ws.close()` to disconnect
3. **Use ErrorCode enum** - Standard error types for consistency
4. **Include context** - Provide debugging info (e.g., `{ roomId, userId }`)

## State Layering {#state-layering}

### Connection State (`ctx.ws.data`)

- `clientId`: Generated during upgrade (UUID v7), NOT in message `meta`
- Custom session data (userId, roles, etc.)

### Message State (`ctx.meta`)

- `correlationId`: Client-controlled request/response correlation
- `timestamp`: Producer time (client's clock, optional)
- Extended meta fields from schema

### Server Context (`ctx`)

- `receivedAt`: Server receive timestamp (authoritative, separate from `meta.timestamp`)

## Reserved Server-Only Keys {#reserved-keys}

**CANONICAL LIST** (referenced by @validation.md#normalization-rules):

The following meta keys are RESERVED and MUST NOT be set by clients:

- `clientId`: Connection identity (access via `ctx.ws.data.clientId`)
- `receivedAt`: Server receive timestamp (access via `ctx.receivedAt`)

**Enforcement**: Routers MUST strip reserved keys during normalization (security boundary).

**Implementation**: See @validation.md#normalization-rules for the authoritative code constant (`RESERVED_META_KEYS`).

**Schema Design Constraint**: Extended meta schemas MUST NOT define reserved keys. Attempting to define `clientId` or `receivedAt` in extended meta will throw an error during schema creation:

```typescript
// ❌ INVALID - will throw at schema creation
const BadSchema = messageSchema(
  "BAD",
  { text: z.string() },
  {
    clientId: z.string(), // Error: Reserved meta keys not allowed
  },
);

// ✅ VALID - use different name for application-level identity
const GoodSchema = messageSchema(
  "GOOD",
  { text: z.string() },
  {
    userId: z.string(), // Application-level sender identity
  },
);
```

## Client-Side Constraints

> Applies to browser/Node client (`bun-ws-router/client`)

### Message Normalization (Outbound)

- **ALWAYS** strip reserved/managed keys (`clientId`, `receivedAt`, `correlationId`) from user-provided `opts.meta` before merging (security + clarity boundary)
- **ALWAYS** merge meta in this order: `{ timestamp: Date.now(), ...sanitizedUserMeta, correlationId }` (sanitized user values override defaults)
- **ALWAYS** provide `correlationId` via `opts.correlationId` (NOT via `opts.meta.correlationId`, which is ignored and stripped)
- **ALWAYS** auto-generate `correlationId` (UUIDv4 via `crypto.randomUUID()`) for `request()` if `opts.correlationId` is absent
- **ALWAYS** type-check extended meta fields at compile time (use `InferMeta<S>`, enforces required fields)

### Connection Behavior

- **ALWAYS** reject pending `request()` promises on close (`ConnectionClosedError`)
- **ALWAYS** reject `request()` with `StateError` when `state !== "open"` and `queue: "off"` (fail fast; no silent queueing)
- **NEVER** auto-retry `send()` or `request()` after close (at-most-once delivery)
- **ALWAYS** start timeout counting AFTER message is flushed on OPEN socket (not when queued)
- **ALWAYS** trigger auto-connect on first `send()` or `request()` if `state === "closed"` AND never connected (never on `on()` or after manual close)
- **ALWAYS** make `send()` return `false` (not throw) on auto-connect failure when `autoConnect: true`
- **ALWAYS** make `request()` reject Promise (not throw) on auto-connect failure when `autoConnect: true`
- **ALWAYS** make `close()` fully idempotent (never throw/reject due to state; safe to call in any state including already closed)

### Request/Response Correlation

- **ALWAYS** reject `request()` with `ValidationError` when reply has matching `correlationId` but wrong type
- **ALWAYS** reject `request()` with `ValidationError` when reply validation fails (malformed data)
- **ALWAYS** reject `request()` with `ServerError` when reply type is `ERROR` with matching `correlationId`
- **ALWAYS** drop duplicate replies silently (only first message with `correlationId` settles promise; subsequent ignored after map removal)
- **ALWAYS** reject `request()` with `StateError` when `opts.signal.aborted === true` before dispatch ("Request aborted before dispatch")
- **ALWAYS** reject `request()` with `StateError` when `opts.signal` aborted while pending ("Request aborted"; cancel timeout, clean pending map)
- **ALWAYS** clean up AbortSignal listeners automatically (no manual unsubscribe needed)
- Server implementations **MUST** echo `meta.correlationId` in replies (see @client.md#Correlation)

### Auth & Security

- **ALWAYS** use `tokenAttach: "query"` (default) or `"protocol"` for browser clients
- **ALWAYS** call `getToken()` once per (re)connect attempt (dedupe in-flight calls)
- **ALWAYS** validate outbound messages before sending (fail fast with `ValidationError`)
- **NEVER** send tokens over non-TLS connections (use WSS:// in production)

### Queue Management

- **ALWAYS** respect `queueSize` bounds (default: 1000)
- **ALWAYS** log `console.warn` on queue overflow
- **NEVER** exceed queue size (use `queue` to control drop behavior: oldest/newest/off)

### Client Error Contract

- **Synchronous throws (`TypeError`)**: Only during setup/preflight validation
  - `createClient()` with invalid options (e.g., illegal `protocolPrefix`)
  - `connect()` preflight validation failures (e.g., malformed URL)
- **Fire-and-forget (`send()`)**: NEVER throws; returns `boolean` (`true` if sent/queued, `false` if dropped/invalid)
- **Promise-based methods (`request()`, `connect()`, `close()`)**: NEVER throw synchronously; return `Promise` that may reject
- **StateError**: ALWAYS a Promise rejection, NEVER a synchronous throw

### Client Type Safety

- **ALWAYS** use schema-based routing for typed message handling
- **ALWAYS** provide `onUnhandled()` hook for graceful degradation (valid messages with no schema match)

### Inbound Message Routing

- **ALWAYS** route schema handlers BEFORE `onUnhandled()` hook (schema match takes precedence)
- **NEVER** pass invalid messages to `onUnhandled()` (drop at validation; see @client.md#message-processing-order)
- **ALWAYS** use `onUnhandled()` for graceful degradation (unknown server messages), protocol negotiation, or debug logging
- **ALWAYS** treat messages in `onUnhandled()` as readonly (type: `AnyInboundMessage`; do not mutate)

## Server vs Client Patterns {#server-client-asymmetry}

### Handler Registration

| Context | Behavior                             | Rationale                                                         |
| ------- | ------------------------------------ | ----------------------------------------------------------------- |
| Server  | Last-write-wins (warns on overwrite) | Single authoritative handler per message type; simplified routing |
| Client  | Multi-handler (registration order)   | Fan-out pattern common in UI; composability across modules        |

**Why different**: Server routers are centrally configured (single `router` instance). Client code is distributed across modules (analytics, UI, sync); each needs independent subscription.

See @client.md#Multiple-Handlers for client multi-handler semantics.

## Design Goals & Non-Goals

### Goals

- Predictable layering (transport vs message state)
- Client-side validation of outbound messages (no server-only fields required in schema)
- Minimal public API with safe defaults
- Browser-first design (query/protocol auth; no header auth)

### Non-Goals

- Cryptographic identity in message meta (use session data)
- Built-in tracing, backpressure, or rate limiting (application responsibility)
- Middleware chains (single handler per message type on server; multi-handler on client)
- Automatic message replay on reconnect (at-most-once delivery)

## Route Composition Patterns

1. **Use `addRoutes()`** for feature module composition
   ```typescript
   mainRouter.addRoutes(authRouter).addRoutes(chatRouter);
   ```
2. **Pass auth/session data during `upgrade()`**
   ```typescript
   router.upgrade(req, { server, data: { userId, roles } });
   ```
3. **Store connection metadata in `ctx.ws.data`** for lifecycle cleanup

## Client-Side Patterns

1. **Use `createMessage()`** for type-safe message creation
2. **Validate before sending** with `safeParse` (works because schemas don't require server-only fields)
3. **Share schemas** between client and server (single source of truth)
4. **Origin tracking** via `publish(..., { origin?: string; key?: string })` (see @pubsub.md#Origin-Option)
   - `origin` references `ws.data` field (string); injects as `meta[key ?? "senderId"]`
   - **No-op if `ws.data[origin]` is undefined**
   - Keeps connection identity (`clientId`) out of message metadata

## Documentation Requirements

When adding/modifying code:

1. **JSDoc comments** explaining trade-offs (e.g., why `@ts-expect-error` is needed)
2. **Reference ADRs** for architectural decisions
3. **Explain INVARIANTS** with inline comments (e.g., clientId generation timing)
4. **Mark PUBLIC vs PRIVATE** API surface clearly
