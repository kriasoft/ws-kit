# Cloudflare Durable Objects Sharding

Scale pub/sub across multiple Durable Object instances by sharding subscriptions based on scope (room/channel).

## Problem

Cloudflare Durable Objects have a 100-connection limit per instance. Without sharding, you can only support 100 concurrent subscribers per room. Beyond that, you hit the limit and new connections fail.

## Solution

Shard rooms across multiple DO instances using a **stable hash** of the room name:

```
room:general → hash → DO instance #2
room:random  → hash → DO instance #5
room:gaming  → hash → DO instance #8
```

Same room always routes to the same DO instance, ensuring all subscribers for a room are in one place. Add more DO instances without code changes.

## Key Pattern

```typescript
// Consistent hash: room name → DO instance ID
function scopeToDoId(scope: string): string {
  let hash = 0;
  for (let i = 0; i < scope.length; i++) {
    hash = (hash << 5) - hash + scope.charCodeAt(i);
  }
  const doCount = 10; // Scale to match load
  return `router-${Math.abs(hash) % doCount}`;
}

// Routes subscription to sharded DO instance
ctx.subscribe(`room:${roomId}`); // Uses sharding internally
```

## Configuration

1. **Define `doCount`**: Number of DO instances (e.g., 10)
2. **Export in `wrangler.toml`**:
   ```toml
   [[durable_objects.bindings]]
   name = "ROUTER"
   class_name = "WebSocketRouter"
   # Namespace configuration for sharding
   ```
3. **Deploy**: Cloudflare auto-creates DO instances as needed

## Benefits

- ✅ **Linear scaling**: Add DO instances, no code changes
- ✅ **No cross-instance coordination**: Each room lives on one DO
- ✅ **Stable routing**: Same room always routes to same DO
- ✅ **Simple hash function**: No external dependencies

## Trade-offs

- Uneven distribution possible with skewed room sizes
- Must pre-allocate or monitor DO count
- No dynamic scaling (fixed `doCount`)

## Files

- `server.ts` — Durable Object handler with sharding-aware subscriptions
