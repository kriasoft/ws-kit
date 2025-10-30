# ADR-019: Context-Level Publishing (ctx.publish)

**Status**: Implemented
**Date**: 2025-10-30
**Related**: ADR-018 (Broadcast Method Naming), docs/specs/broadcasting.md

## Context

Router now supports type-safe, schema-validated publishing via `router.publish()` (ADR-018). However, developers frequently publish from within message handlers. The question: how do we surface publishing in handler context for optimal ergonomics?

## Problem Statement

**Two candidate approaches:**

1. **Method on context**: `ctx.publish(channel, schema, payload, options?)`
   - Pros: Ergonomic in handlers; discoverable via IDE autocomplete; consistent with `ctx.send()`, `ctx.subscribe()`
   - Cons: Adds to context surface area; blurs router-level vs connection-level boundaries

2. **Standalone helper function**: `publish(router, channel, schema, payload, options?)`
   - Pros: Architectural purity; explicit router dependency
   - Cons: Awkward in handlers (extra param); users must remember to import and pass router

## Decision

**✅ Method on context**: `ctx.publish()`

### Rationale

#### 1. **Developer Experience (70% weight)**

Handlers are the primary use case (~95% of publish operations):

```typescript
// ✅ Ergonomic (method)
router.on(UserCreated, async (ctx) => {
  const count = await ctx.publish(
    `org:${ctx.payload.orgId}:users`,
    UserListInvalidated,
    { orgId: ctx.payload.orgId }
  );
});

// ❌ Awkward (helper function)
await publish(router, `org:${ctx.payload.orgId}:users`, ...);
```

#### 2. **Consistency with Existing Patterns**

ws-kit's API philosophy:

- **Factories for setup**: `message()`, `rpc()`, `createRouter()`
- **Methods for operations**: `ctx.send()`, `ctx.reply()`, `ctx.subscribe()`, `ctx.unsubscribe()`

Adding `ctx.publish()` completes this natural set, rather than introducing a different convention (standalone function).

#### 3. **IDE Discoverability**

- `ctx.` autocomplete immediately shows available operations
- Standalone function requires import and memory
- Critical for developer onboarding

#### 4. **Semantic Clarity**

`ctx.publish()` sits naturally among context operations:

- `ctx.send()` → unicast to single connection
- `ctx.subscribe(topic)` → join broadcast group
- `ctx.publish(topic, ...)` → send to broadcast group
- `ctx.unsubscribe(topic)` → leave broadcast group

This forms a coherent, understandable API surface.

#### 5. **No Real Architectural Cost**

The "boundary blur" concern is mitigated:

- `ctx.publish` is **explicitly documented** as a bound passthrough to `router.publish()`
- No new logic; pure delegation
- Authorization is still enforced via subscription rules (not context)
- System-level operations use `router.publish()` directly (cron, queues)

#### 6. **Non-Handler Case is Still Simple**

Users without context still use `router.publish()`:

```typescript
// Cron job, queue, lifecycle
const count = await router.publish(channel, schema, payload);
```

No need for a third API; two entry points suffice.

## API Design

**Two canonical entry points:**

| Context                | Method                                               | Return            |
| ---------------------- | ---------------------------------------------------- | ----------------- |
| **Handler/Middleware** | `ctx.publish(channel, schema, payload, options?)`    | `Promise<number>` |
| **Outside handler**    | `router.publish(channel, schema, payload, options?)` | `Promise<number>` |

Both enforce schema validation. `ctx.publish` is a thin passthrough:

```typescript
const publish = async (channel, schema, payload, options) => {
  return this.publish(channel, schema, payload, options);
};
```

## PublishOptions

```typescript
interface PublishOptions {
  excludeSelf?: boolean; // Future: suppress sender echo
  partitionKey?: string; // Future: distributed sharding
  meta?: Record<string, unknown>; // Custom metadata
}
```

- **Current**: Only `meta` is used; validation enforced for all options
- **Future**: `excludeSelf` and `partitionKey` enable distributed pubsub without breaking API

## Return Value: Promise<number>

Returns matched subscriber count:

- **Testing**: Assert specific fan-out count
- **Metrics**: Track broadcast scope
- **Current**: Returns 1 as sentinel (implementations can override)
- **Future**: PubSub interface may add `subscriberCount()` for exact metrics

## Consequences

✅ **Optimal handler DX** — Discoverable, consistent, ergonomic
✅ **No architectural compromise** — Clear documentation of boundaries
✅ **Backward compatible** — `router.publish()` is canonical; `ctx.publish()` adds convenience
✅ **Future-proof** — Options enable distributed systems without API break
⚠️ **Context complexity** — Adds one method to context interface
⚠️ **Documentation required** — Must clarify that `ctx.publish` is system-level, not connection-level

## Implementation Notes

1. **Thin delegation**: No logic in context method; all validation/telemetry in `router.publish()`
2. **Error handling**: Returns 0 on validation/permission failures
3. **Metadata**: Auto-injects `timestamp`; `clientId` never broadcast
4. **Validation**: Same strict validation as `ctx.send()` for consistency

## Related Decisions

- **ADR-018**: `publish()` method naming (vs `broadcast()`)
- **ADR-007**: Export-with-helpers pattern (factory functions)
- **docs/specs/broadcasting.md**: Usage patterns and best practices

## Examples

### In Handler

```typescript
router.on(UserCreated, async (ctx) => {
  const user = await db.users.create(ctx.payload);
  const recipients = await ctx.publish(
    `org:${ctx.payload.orgId}:users`,
    UserListInvalidated,
    { orgId: ctx.payload.orgId },
    { excludeSelf: true },
  );
  ctx.log.debug(`Notified ${recipients} subscribers`);
});
```

### Outside Handler

```typescript
// In cron, queue, lifecycle
const count = await router.publish(
  "system:announcements",
  System.Announcement,
  { text: "Maintenance at 02:00 UTC" },
);
```

## Naming: "publish" vs "broadcast"

**See ADR-018 for full rationale.** Quick summary:

| Term            | Meaning                        | Used By                             | ws-kit Choice |
| --------------- | ------------------------------ | ----------------------------------- | ------------- |
| **publish()**   | Type-safe, validated multicast | RabbitMQ, Redis, Kafka, NATS        | ✅            |
| **broadcast()** | Raw, unvalidated multicast     | WebSocket APIs (raw `ws.publish()`) | ❌            |

**Why "publish" (not "broadcast")**:

- **Industry standard** — Message brokers use "publish/subscribe" terminology
- **Intent signal** — Implies schema validation and type safety
- **Semantic clarity** — Avoids conflation with raw WebSocket broadcast APIs
- **Consistency** — Aligns `ctx.publish()` with `router.publish()` across abstraction levels

## API Layering: Two Canonical Publishing Patterns

ws-kit provides two complementary publishing patterns for different use cases:

| API                       | Location        | Use Case                     | Returns           |
| ------------------------- | --------------- | ---------------------------- | ----------------- |
| **`ctx.publish(...)`**    | Message context | Handlers; ergonomic sugar    | `Promise<number>` |
| **`router.publish(...)`** | Router instance | System jobs, cron, lifecycle | `Promise<number>` |

Both are high-level, type-safe, schema-validated APIs with identical semantics.
Choose based on context: use `ctx.publish()` in handlers (ergonomic), `router.publish()` outside handlers (canonical).

## Summary

**Method on context** wins on DX, consistency, and discoverability without sacrificing architecture.
The standalone function alternative buys nothing; users either have context (use method) or have
router (use router.publish() directly). A third API adds complexity without solving a real problem.

This decision aligns ws-kit with idiomatic Rust/Go/Node.js patterns where methods on receivers
(context) are preferred over exported helpers that duplicate parameters.

**Naming**: All publish APIs use `publish()` (not `broadcast()`) to signal schema validation and
align with industry pub/sub terminology. See ADR-018 for full rationale.
