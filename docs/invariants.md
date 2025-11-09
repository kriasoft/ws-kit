# WS-Kit Patterns — Invariants

Canonical rules and names for the shipped application patterns: state channels, flow control, and delta sync.

## Pub/Sub Rules (Canonical for All Adapters)

**Single Extension Point Policy**

Apps configure pub/sub in **exactly one place**: `usePubSub()` middleware.

| Responsibility               | Where                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Structural shape**         | `router.limits`: `topicPattern`, `maxTopicLength`, `maxTopicsPerConnection`                                     |
| **All context-aware policy** | `usePubSub()` middleware: `authorizeSubscribe`, `authorizePublish`, `normalize`, `onSubscribe`, `onUnsubscribe` |

**Rule**: Constructor is for structural limits only. ALL authorization, normalization, and lifecycle hooks go in `usePubSub()` middleware.

See [ADR-022 § 6](../adr/022-namespace-first-pubsub-api.md#6-single-extension-point-usepubsub-as-canonical-authority) for design rationale.

**Canonical Operation Order**

Every subscription operation (single or batch) follows this strict order:

```
Normalize → Await in-flight → IDEMPOTENCY CHECK → Validate → Authorize → Limit check → Adapter call → Mutate → Hooks
```

**🔴 CRITICAL: Idempotency-First (Step 3)**

Duplicate calls return immediately with **ZERO side effects**:

- No validation
- No authorization
- No adapter calls
- No hooks
- No mutation

Already-subscribed topics in batches are skipped identically. Errors only occur when state change is needed.

**Key Principles:**

- Adapter calls happen BEFORE local state mutation (if adapter fails, state unchanged)
- Authorization always checks normalized topic (prevents TOCTOU bugs)
- Hooks receive normalized topic, not raw input
- Hook failures don't rollback state

See [docs/specs/pubsub.md#6.1](./specs/pubsub.md#61-canonical-operation-order-normative) for complete specification and rationale.

## Canonical Field Names

- **`seq`** — immutable sequence number (event ID, not revision)
- **`rev`** — snapshot revision or version number (for state snapshots, distinct from seq)
- **`resumeFrom`** — checkpoint for reconnection recovery
- **`policy`** — backpressure strategy identifier (e.g., "drop-oldest", "drop-new")
- **`retryAfterMs`** — server hint: milliseconds before retry is safe
- **`queueDepth`** — current queue size (pattern-specific: used in flow control)
- **`bufferFirstRev`** — oldest revision still available in the operation buffer (pattern-specific: used in delta sync)

Each pattern may introduce additional helper fields to support error recovery. For example, state channels uses:

- `expectedSeq` (diagnostic: first missing client seq)
- `receivedSeq` (diagnostic: what client sent)
- `resumeFrom` (recovery cursor: first missing server seq)

Refer to pattern documentation for full field lists and semantics.

## DO

- Use `seq` as event identity; never increment on retry
- Validate `seq` ordering server-side before applying
- Provide fixtures for all documented scenarios (happy path plus at least one failure)
- Version schemas independently of WS-Kit releases (`1.0.0` format)
- Emit `retryAfterMs` hints instead of hard-coded retry delays

## DON'T

- Reuse `id` for sequencing (ambiguous with message ID)
- Treat `seq` as revision (different semantics)
- Assume idempotent retry without explicit `seq` dedup
- Hard-code error recovery logic (send retry hints instead)
- Mix schema versions in test fixtures
- Bypass schema validation before payload processing

## Error Codes

Canonical errors implemented across patterns.

| Code                 | Pattern        | Meaning                   | Retryable | Hint                                    |
| -------------------- | -------------- | ------------------------- | --------- | --------------------------------------- |
| `RESOURCE_EXHAUSTED` | flow-control   | Queue full / backpressure | yes       | send `retryAfterMs` in response         |
| `SEQUENCE_GAP`       | state-channels | Received seq > expected   | yes       | request catch-up from gap point         |
| `REVISION_GAP`       | delta-sync     | Client rev too far behind | yes       | send snapshot; include `bufferFirstRev` |

## Conformance

All fixtures MUST:

- Declare `schemaVersion` and `fixtureVersion`
- Include an `assertions` array (structure validated; runtime content optional)
- Be sorted by number (e.g., `001-*.json`, `002-*.json`)

Collectively, fixtures for a pattern SHOULD cover:

- Happy path / normal operation (e.g., `001-*.json`)
- At least one documented failure scenario (e.g., `002-*.json`, `003-*.json`)
