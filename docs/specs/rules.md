# Development Rules

Quick reference index for MUST/NEVER rules. Links to canonical specs for details.

**How to Use:**

1. Scan this file for applicable rules
2. Follow links to canonical sections for implementation details
3. When in doubt, linked sections take precedence over this index

**Note:** This is an INDEX, not a canonical source. Domain specs own their rules.

---

## Critical Rules (NEVER Violate)

### Type Safety

- **NEVER** access `ctx.payload` without schema defining it → ADR-001
- **ALWAYS** use conditional types (omit `payload` when undefined) → ADR-001

### Import Patterns

- **NEVER** import from root `"bun-ws-router"` (use `/zod` or `/valibot`) → @schema.md#Canonical-Import-Patterns
- **ALWAYS** use factory pattern for message schemas (`createMessageSchema`) → @schema.md#Factory-Pattern
- **ALWAYS** use typed router factories (`createZodRouter`, `createValibotRouter`) for Zod/Valibot → ADR-004 & @router.md#Typed-Router-Factories
- **ALWAYS** use typed clients (`/zod/client`, `/valibot/client`) → ADR-002
- **NEVER** use generic client (`/client`) unless custom validator → @client.md#Public-API

### Security & Validation

- **NEVER** re-validate in handlers (trust schema) → @validation.md#Flow
- **NEVER** access identity via `ctx.meta.clientId` (use `ctx.ws.data.clientId`) → @validation.md#normalization-rules
- **NEVER** allow clients to set reserved keys (`clientId`, `receivedAt`) → @validation.md#normalization-rules
- **ALWAYS** use strict schemas (reject unknown keys) → @schema.md#Strict-Schemas

---

## Required Patterns (ALWAYS Use)

### Schema & Validation {#validation-flow}

- **ALWAYS** use factory pattern → @schema.md#Factory-Pattern
- **ALWAYS** follow validation flow (Parse → Type Check → Lookup → Normalize → Validate → Handler) → @validation.md#Flow
- **ALWAYS** normalize before validate (strip reserved keys BEFORE schema) → @validation.md#normalization-rules

### Connection & Context

- **ALWAYS** access identity via `ctx.ws.data.clientId` → @validation.md#Reserved-Meta-Keys
- **ALWAYS** use `ctx.receivedAt` for server logic → @schema.md#Which-timestamp-to-use

### Type System

- **ALWAYS** use intersection types for conditional `payload` → ADR-001

### Error Handling {#error-handling}

- **ALWAYS** wrap async ops in try/catch → @error-handling.md
- **ALWAYS** log errors with `clientId` → @error-handling.md
- **ALWAYS** keep connections open (handler must close explicitly) → @error-handling.md

### Messaging

- **ALWAYS** use `ctx.send()` for unicast → @router.md#Type-Safe-Sending
- **ALWAYS** use `publish()` for multicast (validates before broadcast) → @broadcasting.md
- **NEVER** inject `clientId` into meta (use `origin` option for sender tracking) → @broadcasting.md#Origin-Option
- **ALWAYS** auto-inject `timestamp` in outbound messages → @router.md#Type-Safe-Sending
- **NEVER** send `ERROR` from clients unless implementing custom protocol (server-to-client by default) → @error-handling.md#Error-Message-Direction

### Lifecycle

- **ALWAYS** unsubscribe in `onClose()` → @broadcasting.md
- **ALWAYS** store topic IDs in `ctx.ws.data` → @broadcasting.md

---

## Type System Trade-offs

Accept these TypeScript violations for better DX:

- **LSP variance in `addRoutes()`** → ADR-001
- **`| any` in `addRoutes()`** (allows derived router instances) → ADR-001
- **`@ts-expect-error` in type overrides** (enables IDE inference) → ADR-001

---

## Performance Requirements {#performance}

- **UUID v7 for `clientId`** (time-ordered, better DB indexing)
- **Map-based handler lookup** (O(1) by message type)
- **Last-write-wins registration** (log warnings on overwrite)
- **Single handler per type** (server only; client supports multi-handler)
- **Normalization in hot path** (strip reserved keys inline; O(k) where k≤3)

---

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

---

## Reserved Server-Only Keys {#reserved-keys}

**CANONICAL LIST** (see @validation.md#normalization-rules for implementation):

- `clientId`: Connection identity (access via `ctx.ws.data.clientId`)
- `receivedAt`: Server receive timestamp (access via `ctx.receivedAt`)

**Enforcement:**

- Routers MUST strip reserved keys during normalization (security boundary) → @validation.md#normalization-rules
- Schema creation MUST reject extended meta defining reserved keys (fails fast at design time) → @schema.md#Reserved-Server-Only-Meta-Keys

---

## Client-Side Constraints

> Applies to browser/Node client (`@ws-kit/client`)

### Message Normalization (Outbound)

- **ALWAYS** strip reserved/managed keys (`clientId`, `receivedAt`, `correlationId`) from `opts.meta` → @client.md#client-normalization
- **ALWAYS** merge meta in order: `{ timestamp: Date.now(), ...sanitizedUserMeta, correlationId }` → @client.md#client-normalization
- **ALWAYS** provide `correlationId` via `opts.correlationId` (NOT `opts.meta.correlationId`) → @client.md#client-normalization
- **ALWAYS** auto-generate `correlationId` for `request()` if absent → @client.md#client-normalization

### Connection Behavior

- **ALWAYS** reject pending `request()` on close (`ConnectionClosedError`) → @client.md#Error-Contract
- **ALWAYS** reject `request()` with `StateError` when `state !== "open"` and `queue: "off"` → @client.md#Error-Contract
- **NEVER** auto-retry `send()` or `request()` after close (at-most-once delivery) → @client.md
- **ALWAYS** start timeout AFTER message flush on OPEN socket (not when queued) → @client.md#request-timeout
- **ALWAYS** make `close()` fully idempotent (never throw/reject due to state) → @client.md#Error-Contract

### Request/Response Correlation

- **ALWAYS** reject `request()` with `ValidationError` when reply has wrong type (matching `correlationId`) → @client.md#Correlation
- **ALWAYS** reject `request()` with `ServerError` when reply type is `ERROR` (matching `correlationId`) → @client.md#Correlation
- **ALWAYS** drop duplicate replies silently (only first settles promise) → @client.md#Correlation
- **ALWAYS** reject `request()` with `StateError` when `opts.signal.aborted === true` before dispatch → @client.md#request-timeout
- **ALWAYS** clean up AbortSignal listeners automatically → @client.md#request-timeout

### Client Error Contract

- **Synchronous throws (`TypeError`)**: Only during setup/preflight validation → @client.md#Error-Contract
- **Fire-and-forget (`send()`)**: NEVER throws; returns `boolean` → @client.md#fire-and-forget-return
- **Promise-based methods**: NEVER throw synchronously; return `Promise` that may reject → @client.md#Error-Contract
- **StateError**: ALWAYS a Promise rejection, NEVER a synchronous throw → @client.md#Error-Contract

### Inbound Message Routing

- **ALWAYS** route schema handlers BEFORE `onUnhandled()` hook → @client.md#message-processing-order
- **NEVER** pass invalid messages to `onUnhandled()` (drop at validation) → @client.md#message-processing-order
- **ALWAYS** treat messages in `onUnhandled()` as readonly → @client.md#message-processing-order

---

## Server vs Client Patterns {#server-client-asymmetry}

### Handler Registration

| Context | Behavior                             | Rationale                                                         |
| ------- | ------------------------------------ | ----------------------------------------------------------------- |
| Server  | Last-write-wins (warns on overwrite) | Single authoritative handler per message type; simplified routing |
| Client  | Multi-handler (registration order)   | Fan-out pattern common in UI; composability across modules        |

See @client.md#Multiple-Handlers for client multi-handler semantics.

---

## Route Composition Patterns

- **Use `addRoutes()`** for feature module composition
- **Pass auth/session data during `upgrade()`**
- **Store connection metadata in `ctx.ws.data`** for lifecycle cleanup

---

## Client-Side Patterns

- **Use `createMessage()`** for type-safe message creation
- **Validate before sending** with `safeParse` (schemas work client-side)
- **Share schemas** between client and server (single source of truth)
- **Origin tracking** via `publish(..., { origin?: string; key?: string })` → @broadcasting.md#Origin-Option
