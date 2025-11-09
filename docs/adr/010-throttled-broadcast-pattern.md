# ADR-010: Throttled Broadcast Pattern

**Status**: Accepted
**Date**: 2025-10-29
**Related**: ADR-009 (lifecycle hooks), @patterns.md

## Context

Real-time collaboration applications (live cursors, presence, frequent state updates) generate rapid bursts of messages. Broadcasting each change immediately causes:

1. **Network overhead** — Excessive messages across the wire
2. **Processing overhead** — Clients process many redundant updates
3. **Thundering herd** — All subscribers process simultaneously
4. **Bandwidth waste** — Small incremental changes sent repeatedly

Proven systems (Figma, Notion) coalesce rapid messages into single broadcasts using throttle windows (50-100ms). However, this pattern was not readily available to ws-kit users.

## Decision

Introduce utility functions for throttled publishing:

1. **`createThrottledPublish(publish, windowMs)`** — Simple throttled publisher
   - Queues messages within window
   - Sends single batch after window expires
   - Minimal overhead

2. **`createAdvancedThrottledPublish(publish, config)`** — Enhanced version
   - Configurable throttle window
   - Optional `onFlush` callback for logging/metrics
   - Per-channel message queueing

### Type Signatures

```typescript
/**
 * Simple throttled publish wrapper
 * @param publish - router.publish() method
 * @param windowMs - Throttle window in milliseconds (default: 50)
 * @returns Throttled publish function
 */
export function createThrottledPublish(
  publish: (channel: string, message: unknown) => Promise<void>,
  windowMs?: number,
): (channel: string, message: unknown) => void;

/**
 * Advanced throttled publish with callbacks
 * @param publish - router.publish() method
 * @param config - Configuration with optional onFlush callback
 * @returns Throttled publish function
 */
export function createAdvancedThrottledPublish(
  publish: (channel: string, message: unknown) => Promise<void>,
  config?: {
    windowMs?: number;
    onFlush?: (channel: string, count: number) => void;
  },
): (channel: string, message: unknown) => void;
```

### Semantics

- **Queueing**: Messages within throttle window are accumulated per channel
- **Single message**: If only one message in window, sent as-is
- **Multiple messages**: Wrapped in `{ batch: [...] }` on receiver
- **Async**: `publish()` is awaited; errors propagate to caller
- **Predictable**: Window size fixed; flushes at predictable times

## Usage Pattern

```typescript
import { createRouter } from "@ws-kit/zod";
import { createThrottledPublish } from "@ws-kit/core";

const router = createRouter();

// Wrap router.publish with throttle (50ms window)
const throttledPublish = createThrottledPublish(
  router.publish.bind(router),
  50,
);

router.on(CursorMove, (ctx) => {
  // Instead of router.publish(), use throttled version
  throttledPublish("room", {
    clientId: ctx.ws.data.clientId,
    x: ctx.payload.x,
    y: ctx.payload.y,
  });
});
```

## Alternatives Considered

### 1. Built-in router throttling

- **Pros**: No user code needed
- **Cons**: Not all apps need throttling; adds complexity to router; hard-coded window
- **Why rejected**: Violates composition principle; different apps have different needs

### 2. Middleware-based throttling

- **Pros**: Integrates with existing middleware pipeline
- **Cons**: Can't intercept `router.publish()` calls; would need separate handler
- **Why rejected**: Doesn't solve the problem; middleware runs on message receive, not publish

### 3. Promise-based batching

- **Pros**: Can wait for multiple publishes
- **Cons**: Adds latency; breaks async guarantees
- **Why rejected**: Complexity outweighs benefit for typical use cases

## Consequences

### Benefits

1. **Simple integration** — One-line wrapping of `router.publish()`
2. **Bandwidth savings** — 80-95% reduction for rapid updates
3. **Processing savings** — Clients process fewer, larger messages
4. **Fair** — Slower networks naturally handle smaller batches
5. **Observable** — Optional callback for logging/metrics

### Risks

1. **Latency trade-off** — Up to 50ms delay for rapid updates (acceptable for UX)
2. **Batch handling** — Clients must handle `{ batch: [...] }` wrapper
3. **Not type-safe** — Wrapping loses schema validation (intentional; validation still happens in `router.publish()`)
4. **Per-instance** — Doesn't throttle across server instances (use message queue for that)

### Maintenance

- Minimal code; no impact on router core
- New file: `packages/core/src/throttle.ts` (simple utility)
- Exports in `packages/core/src/index.ts`
- Example: `examples/delta-sync/` demonstrates usage

## Implementation Notes

1. **Queueing**: Simple Map<channel, message> per publish call
2. **Scheduling**: Single timeout per throttle instance
3. **Batching**: Multiple messages wrapped in `{ batch: [...] }`
4. **Error handling**: Errors propagate from `publish()` callback
5. **Cleanup**: No persistent state; GC-friendly

## Testing

- Unit tests for throttle utility
- Example in `examples/delta-sync/` shows real-world usage
- Performance tests measure bandwidth reduction

## References

- @patterns.md#Throttled-Broadcast-Pattern — Detailed pattern documentation
- @pubsub.md — Pub/Sub API specification
- hyper-lite meeting demo — Real-world inspiration
- Figma's multiplayer architecture — Production pattern

## Related Decisions

- ADR-009: Lifecycle hooks for observability
- ADR-005: Builder pattern for composition
