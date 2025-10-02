# WebSocket Router Specifications

Technical specifications for `bun-ws-router` - type-safe WebSocket routing with Zod/Valibot validation.

## Core Specifications

- **[schema.md](./schema.md)** - Message structure, wire format, type definitions
- **[router.md](./router.md)** - Server router API, handlers, lifecycle hooks
- **[validation.md](./validation.md)** - Validation flow, normalization, error handling
- **[pubsub.md](./pubsub.md)** - Broadcasting patterns, topic management
- **[client.md](./client.md)** - Browser/Node client API, connection states, queueing
- **[constraints.md](./constraints.md)** - Development rules (MUST/SHOULD/NEVER)

## Supporting Documentation

- **[adrs.md](./adrs.md)** - Architectural decisions with rationale
- **[testing.md](./testing.md)** - Type-level and runtime test requirements
- **[error-handling.md](./error-handling.md)** - Error codes and patterns
- **[implementation-status.md](./implementation-status.md)** - Implementation gaps and checklist

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
import { createMessageSchema } from "bun-ws-router/zod";
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
import { publish } from "bun-ws-router/zod/publish";
publish(ctx.ws, "room:123", ChatMsg, { text: "hi" }, { origin: "userId" });
// Injects meta.senderId = ws.data.userId
```

## Design Philosophy

- **Type Safety**: Full TypeScript inference from schema to handler
- **Minimal API**: Simple patterns, safe defaults, zero middleware overhead
- **Performance**: UUID v7, Map-based routing, O(1) lookups
- **Security**: Reserved key stripping, connection identity isolation
