# ADR-018: Broadcast Method Naming

**Status**: Implemented
**Date**: 2025-10-30
**References**: ADR-007, ADR-010, docs/specs/broadcasting.md

## Context

Router needs a method for multicast messaging to topic subscribers. Method name signals intent to developers: **type-safe + validated** vs **raw/unsafe**.

## Decision

### ✅ `publish()` — RECOMMENDED

**Rationale:**

- **Industry standard** — Message brokers (RabbitMQ, Redis, Kafka, NATS) use `publish()`
- **Intent signal** — Implies type-safe, validated messages (vs raw `ws.publish()`)
- **Semantic clarity** — Distinguishes validated routing from low-level WebSocket API
- **Single canonical path** — Developers reach for `router.publish()`, not unsafe alternatives

**Usage:**

```typescript
// Type-safe: schema validation enforced
router.publish(`room:${roomId}`, UserJoined, { userId, roomId });

// vs raw WebSocket (no validation, avoid)
ws.publish(
  "room:123",
  JSON.stringify({
    /* ... */
  }),
);
```

---

### `broadcast()`

**Reasoning against:**

- Ambiguous with raw WebSocket `broadcast()` methods
- Doesn't signal validation/schema enforcement
- Developers might conflate validated and unvalidated paths
- Less alignment with industry pub/sub terminology

---

## Consequences

✅ Clear intent — `publish()` means validated multicast
✅ Discoverability — Aligns with message broker conventions
✅ Type safety — Contrast with unsafe alternatives is obvious
⚠️ Documentation needed — Explain difference from WebSocket API

## References

- Implementation: `packages/core/src/router.ts` (publish method)
- Spec: `docs/specs/broadcasting.md`
- Related: ADR-010 (Throttled Broadcast Pattern)
