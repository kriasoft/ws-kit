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

**When to reference ADRs:**

- When explaining _why_ a design choice was made
- When documenting trade-offs and alternatives
- For design rationale and implementation guidance

**Normative ADRs** (foundation of the API design - MUST follow):

| ADR         | Title                                                                                                  | Implements                         | Key Decision                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-007** | [Export-with-Helpers Pattern](../adr/007-export-with-helpers-pattern.md)                               | @schema.md, @router.md, @client.md | **FOUNDATIONAL**: Single canonical import source (`@ws-kit/zod` or `@ws-kit/valibot`) prevents dual-package hazards. All server imports must follow this pattern. |
| **ADR-001** | [Message Context Conditional Payload Typing](../adr/001-message-context-conditional-payload-typing.md) | @schema.md, @validation.md         | Conditional `ctx.payload` typing via intersection types—ensures type safety in handlers without manual assertions                                                 |
| **ADR-002** | [Typed Client Adapters via Type Overrides](../adr/002-typed-client-adapters.md)                        | @client.md                         | Separate typed clients (`/zod/client`, `/valibot/client`) for full type inference; generic `/client` for custom validators only                                   |
| **ADR-005** | [Builder Pattern and Symbol Escape Hatch](../adr/005-builder-pattern-and-symbol-escape-hatch.md)       | @router.md                         | Plain object builder for `createRouter()` replacing Proxy; Symbol.for escape hatch for advanced use cases                                                         |

**Informational ADRs** (reference for design rationale and patterns):

| ADR         | Title                                                                                                        | Impacts Spec                   | Key Decision                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------ |
| **ADR-003** | [Example Import Strategy with Path Aliases](../adr/003-example-imports.md)                                   | Examples                       | Production-like imports in development via path aliases                              |
| **ADR-004** | [Typed Router Factory Pattern](../adr/004-typed-router-factory.md)                                           | @schema.md, @router.md         | Factory pattern for type preservation (superseded by ADR-005, ADR-007)               |
| **ADR-006** | [Multi-Runtime `serve()` with Explicit Selection](../adr/006-multi-runtime-serve-with-explicit-selection.md) | @router.md, @client.md         | Unified `serve()` function across platforms (Bun, Cloudflare, Deno)                  |
| **ADR-008** | [Middleware Support](../adr/008-middleware-support.md)                                                       | @router.md                     | Global and per-route middleware with `next()` semantics                              |
| **ADR-009** | [Error Handling and Lifecycle Hooks](../adr/009-error-handling-and-lifecycle-hooks.md)                       | @error-handling.md, @router.md | `ctx.error()` and lifecycle hooks (`onError`, `onUpgrade`, `onOpen`, `onClose`)      |
| **ADR-010** | [Throttled Broadcast Pattern](../adr/010-throttled-broadcast-pattern.md)                                     | @patterns.md, @broadcasting.md | Utility functions for coalescing rapid publishes (50-95% bandwidth reduction)        |
| **ADR-011** | [Structured Logging Adapter](../adr/011-structured-logging-adapter.md)                                       | @router.md                     | Pluggable logger interface for production deployments (Winston, Pino, Datadog, etc.) |

## Import Quick Reference

**Server imports MUST follow ADR-007 (export-with-helpers pattern):**

| Context                | Import Path                                                  | Spec                                          |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Server (Zod)           | `import { z, message, createRouter } from "@ws-kit/zod"`     | ADR-007, @schema.md#Canonical-Import-Patterns |
| Server (Valibot)       | `import { z, message, createRouter } from "@ws-kit/valibot"` | ADR-007, @schema.md#Canonical-Import-Patterns |
| Utilities (Throttle)   | `import { createThrottledPublish } from "@ws-kit/core"`      | @patterns.md, ADR-010                         |
| Utilities (Logger)     | `import { createLogger, LOG_CONTEXT } from "@ws-kit/core"`   | @router.md, ADR-011                           |
| Multi-runtime serving  | `import { serve } from "@ws-kit/serve"`                      | @router.md#Basic-Setup                        |
| Client (Zod typed)     | `import { wsClient } from "@ws-kit/client/zod"`              | @client.md, ADR-002                           |
| Client (Valibot typed) | `import { wsClient } from "@ws-kit/client/valibot"`          | @client.md, ADR-002                           |
| Client (generic)       | `import { wsClient } from "@ws-kit/client"`                  | @client.md                                    |

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
// 1. Import from single source (export-with-helpers)
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve";

// 2. Define connection data type
type AppData = { userId?: string };

// 3. Create router and schemas (full type inference!)
const router = createRouter<AppData>();
const PingMsg = message("PING", { value: z.number() });
const PongMsg = message("PONG", { reply: z.number() });

// 4. Handle messages (ctx.payload fully typed!)
router.on(PingMsg, (ctx) => {
  console.log("Received at:", ctx.receivedAt); // Server time (authoritative)
  ctx.reply(PongMsg, { reply: ctx.payload.value * 2 }); // ✅ No type assertions needed
});

// 5. Middleware and broadcasting
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "PING") {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return;
  }
  return next();
});

router.on(ChatMsg, (ctx) => {
  router.publish("room:123", RoomMsg, {
    text: ctx.payload.text,
    userId: ctx.ws.data?.userId || "anon",
  });
});

// 6. Serve with explicit runtime (production-safe)
serve(router, {
  port: 3000,
  runtime: "bun", // Required in production
  authenticate(req) {
    return { userId: "user-123" };
  },
});
```

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
