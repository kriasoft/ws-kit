# WebSocket Router Specifications

Technical specifications for `WS-Kit` - type-safe WebSocket router for Bun and Cloudflare with Zod/Valibot validation.

## Navigation for AI Tools

**Start Here:**

1. **Implementing a feature?** → `rules.md` (rules) → linked detail specs
2. **Debugging validation?** → `validation.md` (pipeline) → `schema.md` (structure)
3. **Client integration?** → `client.md` (API) → `test-requirements.md` (patterns)
4. **Understanding design?** → `docs/adr/` (decisions) → linked specs

**Canonical Sources** (when specs conflict, these win):

- Reserved keys: `validation.md#normalization-rules`
- Timestamps: `schema.md#Which-timestamp-to-use`
- Error codes: `error-handling.md#error-code-enum`
- Type overrides: ADR-001, ADR-002

## Terminology {#Terminology}

**Core Patterns:**

- **Message Schema Factory**: Use `createMessageSchema(validator)` to create schemas; avoids dual-package hazard with discriminated unions (@schema.md#Factory-Pattern)
- **Typed Router Factories**: Use `createZodRouter()` or `createValibotRouter()` for full type inference in handlers (ADR-004, @router.md#Typed-Router-Factories)
- **Typed Clients**: `/zod/client`, `/valibot/client` exports with full type inference; generic `/client` for custom validators only (ADR-002)
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

- **Architectural decisions** - See `docs/adr/` for individual decisions
- **[test-requirements.md](./test-requirements.md)** - Type-level and runtime test requirements
- **[error-handling.md](./error-handling.md)** - Error codes and patterns

## Import Quick Reference

| Context                        | Import Path                                   | Spec                                       |
| ------------------------------ | --------------------------------------------- | ------------------------------------------ |
| Typed router factory (Zod)     | `createZodRouter` from `@ws-kit/zod`          | @router.md#Typed-Router-Factories, ADR-004 |
| Typed router factory (Valibot) | `createValibotRouter` from `@ws-kit/valibot`  | @router.md#Typed-Router-Factories, ADR-004 |
| Message schema factory         | `createMessageSchema` from `@ws-kit/zod`      | @schema.md#Factory-Pattern                 |
| Client (Zod typed)             | `@ws-kit/client/zod`                          | @client.md, ADR-002                        |
| Client (Valibot typed)         | `@ws-kit/client/valibot`                      | @client.md, ADR-002                        |
| Client (generic)               | `@ws-kit/client`                              | @client.md                                 |
| Broadcasting                   | `@ws-kit/zod/publish` (or `/valibot/publish`) | @broadcasting.md                           |

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
// 1. Create typed router (full type inference in handlers)
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
import { z } from "zod";
const router = createZodRouter();

// 2. Define schemas
const { messageSchema } = createMessageSchema(z);
const PingMsg = messageSchema("PING", { value: z.number() });
const PongMsg = messageSchema("PONG", { reply: z.number() });

// 3. Handle messages (ctx.payload fully typed!)
router.onMessage(PingMsg, (ctx) => {
  console.log("Received at:", ctx.receivedAt); // Server time (authoritative)
  ctx.send(PongMsg, { reply: ctx.payload.value * 2 }); // ✅ No type assertions needed
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
| **Payload access** | NEVER access `ctx.payload` without schema                   | ADR-001                             |
| **Imports**        | ALWAYS use factory pattern                                  | `rules.md#import-patterns`          |
| **Clients**        | ALWAYS use typed clients (`/zod/client`, `/valibot/client`) | ADR-002                             |
| **Validation**     | NEVER re-validate in handlers                               | `rules.md#validation-flow`          |
| **Identity**       | ALWAYS use `ctx.ws.data.clientId`, never `ctx.meta`         | `rules.md#state-layering`           |
| **Timestamps**     | ALWAYS use `ctx.receivedAt` for server logic                | `schema.md#Which-timestamp-to-use`  |
| **Reserved keys**  | NEVER set `clientId`, `receivedAt` from client              | `validation.md#normalization-rules` |
| **Errors**         | ALWAYS log with `clientId`; connections stay open           | `rules.md#error-handling`           |
| **Broadcasting**   | ALWAYS validate with `publish()`, not raw `ws.publish()`    | `rules.md#messaging`                |

See `rules.md` for complete rules.
