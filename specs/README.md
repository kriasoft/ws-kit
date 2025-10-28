# WebSocket Router Specifications

Technical specifications for `bun-ws-router` - type-safe WebSocket routing with Zod/Valibot validation.

## Navigation for AI Tools

**Start Here:**

1. **Implementing a feature?** → `rules.md` (rules) → linked detail specs
2. **Debugging validation?** → `validation.md` (pipeline) → `schema.md` (structure)
3. **Client integration?** → `client.md` (API) → `test-requirements.md` (patterns)
4. **Understanding design?** → `adrs.md` (decisions) → linked specs

**Canonical Sources** (when specs conflict, these win):

- Reserved keys: `validation.md#normalization-rules`
- Timestamps: `schema.md#Which-timestamp-to-use`
- Error codes: `error-handling.md#error-code-enum`
- Type overrides: `adrs.md#ADR-001`, `adrs.md#ADR-002`

## Terminology {#Terminology}

**Core Patterns:**

- **Factory Pattern**: Use `createMessageSchema(validator)` to create schemas; avoids dual-package hazard with discriminated unions (@schema.md#Factory-Pattern)
- **Typed Clients**: `/zod/client`, `/valibot/client` exports with full type inference; generic `/client` for custom validators only (@adrs.md#ADR-002)
- **Normalization**: Security boundary; strips reserved keys before validation (@validation.md#normalization-rules)
- **Strict Mode**: Validation rejects unknown keys at root/meta/payload levels (@schema.md#Strict-Schemas)

**Message Structure:**

- **Message Context**: Server handler context (`ctx`) with validated data + server-provided fields (`ws`, `receivedAt`, `send`) (@router.md#Router-API)
- **Extended Meta**: Schema-defined metadata beyond defaults (`correlationId`, `timestamp`) (@schema.md#Extended-Meta)
- **Reserved Keys**: Server-only meta fields (`clientId`, `receivedAt`); stripped during normalization (@validation.md#normalization-rules)

**Identity & Time:**

- **Connection Identity**: `ctx.ws.data.clientId` (UUID v7, set during upgrade); transport-layer state, not message state (@schema.md#Why-clientId-is-not-in-meta)
- **Producer Time**: `meta.timestamp` (client clock, optional, may be skewed); for UI display only (@schema.md#Which-timestamp-to-use)
- **Authoritative Time**: `ctx.receivedAt` (server clock, captured at ingress); use for all server logic (@schema.md#Which-timestamp-to-use)
- **Origin Tracking**: `publish(..., { origin: "userId" })` injects sender identity from `ws.data` into `meta.senderId` (@broadcasting.md#Origin-Option)

**Messaging Patterns:**

- **Unicast**: Single-client messaging via `ctx.send()` (@router.md#Type-Safe-Sending)
- **Multicast**: Topic-based broadcasting via `publish()` to multiple subscribers (@broadcasting.md)

## Core Specifications

- **[schema.md](./schema.md)** - Message structure, wire format, type definitions
- **[router.md](./router.md)** - Server router API, handlers, lifecycle hooks
- **[validation.md](./validation.md)** - Validation flow, normalization, error handling
- **[broadcasting.md](./broadcasting.md)** - Broadcasting patterns, topic subscriptions, multicast messaging
- **[client.md](./client.md)** - Client SDK API, connection states, queueing
- **[rules.md](./rules.md)** - Development rules (MUST/NEVER) with links to details

## Supporting Documentation

- **[adrs.md](./adrs.md)** - Architectural decisions with rationale
- **[test-requirements.md](./test-requirements.md)** - Type-level and runtime test requirements
- **[error-handling.md](./error-handling.md)** - Error codes and patterns

## Import Quick Reference

| Context                 | Import Path                                   | Spec                                 |
| ----------------------- | --------------------------------------------- | ------------------------------------ |
| Server router (Zod)     | `@ws-kit/zod`                                 | @router.md                           |
| Server router (Valibot) | `@ws-kit/valibot`                             | @router.md                           |
| Client (Zod typed)      | `@ws-kit/client/zod`                          | @client.md, @adrs.md#ADR-002         |
| Client (Valibot typed)  | `@ws-kit/client/valibot`                      | @client.md, @adrs.md#ADR-002         |
| Client (generic)        | `@ws-kit/client`                              | @client.md                           |
| Schema factory          | Same as router (`/zod` or `/valibot`)         | @schema.md#Canonical-Import-Patterns |
| Broadcasting            | `@ws-kit/zod/publish` (or `/valibot/publish`) | @broadcasting.md                     |

See @schema.md#Canonical-Import-Patterns for complete import examples.

## Quick Reference

### Message Structure

```typescript
// Client sends (minimal)
{
  type: "MESSAGE_TYPE",
  payload?: { ... },     // If schema defines it
  meta?: {
    correlationId?: string,
    timestamp?: number,  // Producer time (UI display only)
    // Extended meta fields from schema
  }
}

// Handler receives (validated + server context)
ctx = {
  ws,                    // Connection (ws.data.clientId always present)
  type: "MESSAGE_TYPE",
  meta: { ... },         // Validated client metadata
  payload: { ... },      // Only exists if schema defines it
  receivedAt: number,    // Server time (authoritative, use for logic)
  send: SendFunction
}
```

### Key Patterns

```typescript
// 1. Factory pattern (required for discriminated unions)
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";
const { messageSchema } = createMessageSchema(z);

// 2. Define schemas
const PingMsg = messageSchema("PING", { value: z.number() });
const PongMsg = messageSchema("PONG", { reply: z.number() });

// 3. Handle messages
router.onMessage(PingMsg, (ctx) => {
  console.log("Received at:", ctx.receivedAt); // Server time (authoritative)
  ctx.send(PongMsg, { reply: ctx.payload.value * 2 });
});

// 4. Broadcasting with origin tracking
import { publish } from "@ws-kit/zod/publish";
publish(ctx.ws, "room:123", ChatMsg, { text: "hi" }, { origin: "userId" });
// Injects meta.senderId = ws.data.userId
```

## Design Philosophy

- **Type Safety**: Full TypeScript inference from schema to handler
- **Minimal API**: Simple patterns, safe defaults, zero middleware overhead
- **Performance**: UUID v7, Map-based routing, O(1) lookups
- **Security**: Reserved key stripping, connection identity isolation

## Quick Constraint Lookup

| Rule               | Constraint                                                  | Detail                              |
| ------------------ | ----------------------------------------------------------- | ----------------------------------- |
| **Payload access** | NEVER access `ctx.payload` without schema                   | `adrs.md#ADR-001`                   |
| **Imports**        | ALWAYS use factory pattern                                  | `rules.md#import-patterns`          |
| **Clients**        | ALWAYS use typed clients (`/zod/client`, `/valibot/client`) | `adrs.md#ADR-002`                   |
| **Validation**     | NEVER re-validate in handlers                               | `rules.md#validation-flow`          |
| **Identity**       | ALWAYS use `ctx.ws.data.clientId`, never `ctx.meta`         | `rules.md#state-layering`           |
| **Timestamps**     | ALWAYS use `ctx.receivedAt` for server logic                | `schema.md#Which-timestamp-to-use`  |
| **Reserved keys**  | NEVER set `clientId`, `receivedAt` from client              | `validation.md#normalization-rules` |
| **Errors**         | ALWAYS log with `clientId`; connections stay open           | `rules.md#error-handling`           |
| **Broadcasting**   | ALWAYS validate with `publish()`, not raw `ws.publish()`    | `rules.md#messaging`                |

See `rules.md` for complete rules.
