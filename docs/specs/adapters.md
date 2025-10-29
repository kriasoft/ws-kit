# Adapter Responsibilities

## Overview

WS-Kit supports multiple platform adapters: Bun, Cloudflare Durable Objects, and Deno. Each adapter has specific responsibilities for handling WebSocket lifecycle, message delivery, and state management.

This specification documents the expected behavior and guarantees of each adapter implementation.

## Adapter Responsibility Matrix

| Responsibility                        | Bun                   | Cloudflare DO         | Deno                  | Notes                                   |
| ------------------------------------- | --------------------- | --------------------- | --------------------- | --------------------------------------- |
| **Subscribe/Unsubscribe Persistence** | In-memory Map         | Request-scoped only   | In-memory Map         | See [Pub/Sub Model](#pubsub-model)      |
| **Broadcast Fan-out**                 | Sync (loop)           | Via DO storage        | Sync (loop)           | See [Broadcast](#broadcast)             |
| **Connection Limits**                 | OS-based              | 100 concurrent        | OS-based              | See [Platform Limits](#platform-limits) |
| **Reconnection Handling**             | Client-initiated      | Client-initiated      | Client-initiated      | See [Reconnection](#reconnection)       |
| **Message Ordering**                  | FIFO per connection   | FIFO per connection   | FIFO per connection   | Within single connection guaranteed     |
| **Error Propagation**                 | Via onError hook      | Via onError hook      | Via onError hook      | Unhandled errors logged                 |
| **Cleanup on Disconnect**             | Automatic unsubscribe | Automatic unsubscribe | Automatic unsubscribe | Removes from all scopes                 |

## Pub/Sub Model

### Bun Adapter

```typescript
// In-memory scope management
const subscriptions = new Map<string, Set<WebSocket>>();

function subscribe(scope: string, ws: WebSocket) {
  if (!subscriptions.has(scope)) {
    subscriptions.set(scope, new Set());
  }
  subscriptions.get(scope)!.add(ws);
}

function publish(scope: string, message: any) {
  const subscribers = subscriptions.get(scope);
  if (!subscribers) return;

  for (const ws of subscribers) {
    ws.send(JSON.stringify(message));
  }
}

function unsubscribe(scope: string, ws: WebSocket) {
  subscriptions.get(scope)?.delete(ws);
}
```

**Guarantees:**

- ✅ Subscriptions persist for connection lifetime
- ✅ Messages broadcast synchronously to all subscribers
- ✅ Automatic cleanup on disconnect
- ⚠️ **No persistence across server restart** — Subscriptions are in-memory

### Cloudflare Durable Objects Adapter

```typescript
// Request-scoped state (Cloudflare DO specific)
export class WebSocketServer extends DurableObject {
  private subscriptions = new Map<string, Set<WebSocket>>();

  async fetch(req: Request) {
    const ws = await req.webSocket();
    // ...subscribe/publish logic
  }

  subscribe(scope: string, ws: WebSocket) {
    if (!this.subscriptions.has(scope)) {
      this.subscriptions.set(scope, new Set());
    }
    this.subscriptions.get(scope)!.add(ws);
  }

  publish(scope: string, message: any) {
    const subscribers = this.subscriptions.get(scope);
    if (!subscribers) return;

    for (const ws of subscribers) {
      ws.send(JSON.stringify(message));
    }
  }
}
```

**Guarantees:**

- ✅ Subscriptions persist for Durable Object lifetime
- ✅ Single DO instance ensures ordered, reliable delivery
- ✅ Automatic cleanup on disconnect
- ⚠️ **Request-scoped per DO instance** — Load balancing requires routing logic

### Deno Adapter

```typescript
// In-memory scope management (similar to Bun)
const subscriptions = new Map<string, Set<WebSocket>>();

function subscribe(scope: string, ws: WebSocket) {
  if (!subscriptions.has(scope)) {
    subscriptions.set(scope, new Set());
  }
  subscriptions.get(scope)!.add(ws);
}

function publish(scope: string, message: any) {
  const subscribers = subscriptions.get(scope);
  if (!subscribers) return;

  for (const ws of subscribers) {
    ws.send(JSON.stringify(message));
  }
}
```

**Guarantees:**

- ✅ Subscriptions persist for server lifetime
- ✅ Messages broadcast synchronously
- ✅ Automatic cleanup on disconnect
- ⚠️ **No persistence across server restart** — Subscriptions are in-memory

## Broadcast

### Fan-Out Strategy

All adapters use **synchronous fan-out**:

```typescript
// Pseudocode for all adapters
function publish(scope: string, message: any) {
  const subscribers = getSubscribers(scope); // Platform-specific lookup

  for (const subscriber of subscribers) {
    try {
      subscriber.send(JSON.stringify(message));
    } catch (err) {
      console.error(`Failed to broadcast to ${scope}:`, err);
      // Subscriber is cleaned up elsewhere (e.g., onClose)
    }
  }
}
```

**Guarantees:**

- ✅ All connected subscribers in scope receive message
- ✅ Broadcast completes before `publish()` returns
- ⚠️ **Send failures are logged, not rethrown** — One failed send doesn't block others
- ⚠️ **No ordering guarantee across scopes** — Different scopes are independent

## Platform Limits

### Bun

```typescript
// Bun has no built-in WS connection limit
// Constrained by OS file descriptor limits (typically 1024 - 10000)

// Typical configuration
Bun.serve({
  port: 3000,
  maxRequestSize: 1024 * 1024, // 1MB
  reusePort: true, // Distribute load across processes
});
```

**Limits:**

- **Concurrent connections**: OS file descriptors (e.g., ulimit -n)
- **Message size**: Configurable, default unlimited
- **Memory**: Linear to connection count (minimal overhead)

### Cloudflare Durable Objects

```typescript
// Cloudflare DO limits
// - Max 100 concurrent WebSocket connections per DO instance
// - Max 1MB message size
// - Max 10MB stored state

export class WebSocketServer extends DurableObject {
  async fetch(req: Request) {
    // Check connection count
    if (this.subscriptions.size >= 100) {
      return new Response("Capacity exceeded", { status: 429 });
    }
    // ...
  }
}
```

**Limits:**

- **Concurrent connections**: 100 per Durable Object instance
- **Message size**: 1MB
- **Stored state**: 10MB per Durable Object
- **Mitigation**: Shard across multiple DO instances by scope

### Deno

```typescript
// Deno has no built-in WS limit
// Constrained by OS resources and Deno runtime

import { serve } from "https://deno.land/std@0.200.0/http/server.ts";

serve(
  async (req) => {
    // Deno's Deno.serve() handles resource limits
    // No explicit per-connection limit
  },
  { hostname: "0.0.0.0", port: 3000 },
);
```

**Limits:**

- **Concurrent connections**: OS-dependent (no hard limit)
- **Message size**: Configurable, default unlimited
- **Memory**: Linear to connection count

## Reconnection

All adapters treat reconnection as a **new connection**:

```typescript
// When client reconnects with same user ID:
// 1. Old connection closed (onClose called, subscriptions cleaned up)
// 2. authenticate() called again
// 3. New connection opened (onOpen called)
// 4. Client must re-subscribe to scopes

// ⚠️ IMPORTANT: No automatic subscription recovery
serve(router, {
  onClose(ctx) {
    console.log(`User ${ctx.ws.data?.userId} disconnected`);
    // Subscriptions are cleaned up by adapter
  },
});
```

**Guarantees:**

- ✅ Old connection fully cleaned up before new connection
- ✅ No duplicate messages to same user on reconnect
- ⚠️ **No persistence of subscriptions across reconnects** — Client must resubscribe
- ⚠️ **Messages sent during disconnect are lost** — No queuing by default

**Client Reconnection Pattern:**

```typescript
// Client code (type-safe WebSocket client)
client.on("connected", () => {
  // Reconnected: re-subscribe to all scopes
  client.send(SubscribeMessage, { scope: "user:123" });
  client.send(SubscribeMessage, { scope: "room:456" });
});
```

## Adapter Selection

Choose an adapter based on your deployment model:

| Adapter           | Best For                                      | Drawbacks                               |
| ----------------- | --------------------------------------------- | --------------------------------------- |
| **Bun**           | Single-region servers, tight resource control | No builtin scaling                      |
| **Cloudflare DO** | Global distributed apps, auto-scaling         | 100-connection limit per DO, cost model |
| **Deno**          | General-purpose servers, Deno ecosystem       | Smaller community, fewer integrations   |

## Error Handling Across Adapters

All adapters follow **identical error semantics**. See `docs/specs/error-handling.md` for:

- Standard error codes and schemas
- Type-safe error sending with `ctx.error()`
- Error behavior table (connection state, logging, handler invocation)
- Explicit connection close strategies
- Broadcasting errors to rooms/channels

**Key principle**: Errors never auto-close connections. Handlers must explicitly call `ctx.ws.close()` when needed.

## Future Considerations

- **Redis Pub/Sub**: Additional adapter for distributed Redis-backed subscriptions
- **Node.js Adapter**: Support for Node.js runtime (currently Bun/Deno/Cloudflare only)
- **Subscription Persistence**: Optional durable subscriptions across reconnects
