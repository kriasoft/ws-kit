# WebSocket Router Specifications

Technical specifications for `WS-Kit` - type-safe WebSocket router for Bun and Cloudflare with Zod/Valibot validation.

## Navigation for AI Tools

**Start Here:**

1. **Implementing a feature?** → `rules.md` (quick index) → linked canonical spec
2. **Debugging validation?** → `validation.md` (pipeline) → `schema.md` (structure)
3. **Client integration?** → `client.md` (API) → `test-requirements.md` (patterns)
4. **Understanding design?** → `docs/adr/` (decisions) → linked specs

**Note on rules.md**: It's a quick-lookup INDEX, not the canonical source. Each rule links to the spec that owns that rule. The linked spec is authoritative.

## Canonical Sources by Concept

When specs reference the same concept, the canonical source takes precedence:

| Concept                 | Canonical Spec                          | Also Discussed In        | Why                                 |
| ----------------------- | --------------------------------------- | ------------------------ | ----------------------------------- |
| **Timestamp Usage**     | `schema.md#Which-timestamp-to-use`      | router.md, validation.md | Single table, referenced everywhere |
| **Reserved Keys**       | `validation.md#normalization-rules`     | schema.md                | Implementation details here         |
| **Identity (clientId)** | `schema.md#Why-clientId-is-not-in-meta` | validation.md, rules.md  | Design rationale + implementation   |
| **Error Codes**         | `error-handling.md#error-code-enum`     | router.md, ADR-015       | Complete taxonomy and decision tree |
| **Validation Flow**     | `validation.md#Flow`                    | rules.md                 | Full pipeline stages                |
| **Normalization**       | `validation.md#normalization-rules`     | schema.md                | Implementation + code examples      |
| **Export-with-Helpers** | `schema.md#Canonical-Import-Patterns`   | ADR-007                  | Pattern definition + ADR rationale  |

## Terminology {#Terminology}

**Core Patterns:**

- **Export-with-Helpers**: Import `z`, `message()`, and `createRouter()` from single source (`@ws-kit/zod` or `@ws-kit/valibot`) (@schema.md#Canonical-Import-Patterns)
- **Message Helper**: Use `message(type, payload?, meta?)` to create schemas; single validator instance prevents dual-package issues (@schema.md#Export-with-Helpers-Pattern)
- **Router Creation**: Use `createRouter<TData>()` with explicit generic for full type inference in handlers (@router.md#Creating-a-Router)
- **Typed Clients**: `/zod/client`, `/valibot/client` exports with `wsClient()` for full type inference; generic `/client` for custom validators only (ADR-002)
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

- **[schema.md](./schema.md)** - Message structure, wire format, type definitions (see ADR-001, ADR-007)
- **[router.md](./router.md)** - Server router API, handlers, lifecycle hooks (see ADR-005, ADR-008, ADR-009)
- **[validation.md](./validation.md)** - Validation flow, normalization, error handling (strict mode per ADR-001)
- **[broadcasting.md](./broadcasting.md)** - Broadcasting patterns, topic subscriptions, multicast messaging (see ADR-009, ADR-010 for throttling)
- **[client.md](./client.md)** - Client SDK API, connection states, queueing (see ADR-002, ADR-006)
- **[adapters.md](./adapters.md)** - Platform adapter responsibilities, limits, and pub/sub guarantees (see ADR-006)
- **[rules.md](./rules.md)** - Development rules (MUST/NEVER) with links to details (cross-index to ADRs)
- **[patterns.md](./patterns.md)** - Architectural patterns for production apps (throttled broadcast, delta sync, optimistic updates, dual-store, etc.)

## Supporting Documentation

- **Architectural Decisions** - See individual ADRs below (canonical source for design rationale)
- **[test-requirements.md](./test-requirements.md)** - Type-level and runtime test requirements (validates ADR-001, ADR-002)
- **[error-handling.md](./error-handling.md)** - Error codes and patterns (implements ADR-009)

## Architectural Decision Records (ADRs)

For comprehensive architecture documentation and design rationale, see the [ADR Index](../adr/README.md).

**Key ADRs referenced in specs:**

- **ADR-007**: [Export-with-Helpers Pattern](../adr/007-export-with-helpers-pattern.md) — FOUNDATIONAL: Single canonical import source
- **ADR-001**: [Message Context Conditional Payload Typing](../adr/001-message-context-conditional-payload-typing.md) — Type-safe `ctx.payload` access
- **ADR-002**: [Typed Client Adapters](../adr/002-typed-client-adapters.md) — Full type inference in browser/Node.js clients
- **ADR-015**: [Unified RPC API Design](../adr/015-unified-rpc-api-design.md) — Request/response patterns with schema unification

See [docs/adr/README.md](../adr/README.md) for the complete decision index.

## Import Quick Reference

**Server imports MUST follow ADR-007 (export-with-helpers pattern).**

For complete canonical import patterns and usage examples, see **[@schema.md#Canonical-Import-Patterns](./schema.md#canonical-import-patterns)**.

**Quick reference:**

- Server (Zod/Valibot): `import { z/v, message, createRouter } from "@ws-kit/zod"` or `@ws-kit/valibot"`
- Platform (Bun): `import { serve } from "@ws-kit/bun"`
- Client (Typed): `import { wsClient } from "@ws-kit/client/zod"` or `@ws-kit/client/valibot"`
- Client (Generic): `import { wsClient } from "@ws-kit/client"`

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

For detailed working examples, see **[CLAUDE.md](../../CLAUDE.md#quick-start)** and **[@router.md](./router.md)**. Core concepts include:

1. **Import from single source** (export-with-helpers pattern, ADR-007)
   - Server: `import { z, message, createRouter } from "@ws-kit/zod"`
   - Client: `import { wsClient } from "@ws-kit/client/zod"`

2. **Type-safe message handling** with full inference
   - Define schemas with `message()`
   - Access `ctx.payload` without type assertions
   - TypeScript enforces when payload exists (ADR-001)

3. **Middleware & validation**
   - Global middleware with `router.use((ctx, next) => ...)`
   - Per-route middleware with `router.use(schema, middleware)`
   - Validation occurs before handlers run

4. **Broadcasting & pub/sub**
   - Unicast: `ctx.send(schema, data)` to current connection
   - Multicast: `router.publish(topic, schema, data)` to subscribers
   - Subscribe/unsubscribe with `ctx.subscribe()` / `ctx.unsubscribe()`

5. **Error handling & lifecycle**
   - Type-safe errors: `ctx.error(code, message, details)`
   - Lifecycle hooks: `onOpen`, `onClose`, `onError`, `onBroadcast`

## Design Philosophy

- **Type Safety**: Full TypeScript inference from schema to handler
- **Minimal API**: Simple patterns, safe defaults, zero middleware overhead
- **Performance**: UUID v7, Map-based routing, O(1) lookups
- **Security**: Reserved key stripping, connection identity isolation

## Quick Constraint Lookup

| Rule               | Constraint                                                                     | Detail                                |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------- |
| **Payload access** | NEVER access `ctx.payload` without schema                                      | ADR-001                               |
| **Imports**        | ALWAYS use export-with-helpers (`z`, `message()`, `createRouter()`)            | ADR-007, `rules.md#import-patterns`   |
| **Clients**        | ALWAYS use typed clients (`wsClient` from `/zod/client` or `/valibot/client`)  | ADR-002                               |
| **Router setup**   | ALWAYS use `createRouter<TData>()` with explicit generic                       | `router.md#Creating-a-Router`         |
| **Runtime**        | ALWAYS use explicit `runtime` option in production or platform-specific import | `rules.md#runtime-selection`, ADR-006 |
| **Validation**     | NEVER re-validate in handlers                                                  | `rules.md#validation-flow`            |
| **Identity**       | ALWAYS use `ctx.ws.data.clientId`, never `ctx.meta`                            | `rules.md#state-layering`             |
| **Timestamps**     | ALWAYS use `ctx.receivedAt` for server logic                                   | `schema.md#Which-timestamp-to-use`    |
| **Reserved keys**  | NEVER set `clientId`, `receivedAt` from client                                 | `validation.md#normalization-rules`   |
| **Errors**         | ALWAYS use `ctx.error()` for client errors; log with `clientId`                | `rules.md#error-handling`             |
| **Broadcasting**   | ALWAYS use `router.publish()`, not raw `ctx.ws.publish()`                      | `rules.md#messaging`                  |
| **Middleware**     | ALWAYS register global before per-route; call `next()` to continue             | `router.md#Middleware`                |

See `rules.md` for complete rules.
