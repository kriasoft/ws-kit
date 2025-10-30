# ADR-013: RPC Reconnect & Idempotency Policy

## Metadata

- **Date**: 2025-10-30
- **Status**: Accepted
- **Tags**: RPC, reconnection, idempotency, client-side resilience

## Context

WebSocket connections are unreliable in practice:

- Mobile networks drop connections frequently.
- Browser tab suspension/hibernation causes disconnects.
- Server-side eviction (e.g., Cloudflare DO rehydration) orphans in-flight RPCs.

Clients need a reliable policy for handling in-flight requests across reconnects:

- **Reject safely**: If no idempotency guarantee, fail fast rather than silently retry.
- **Smart retry**: For idempotent operations (queries, read-heavy RPCs), allow client-initiated resend.
- **Deduplication**: Prevent accidental duplicate execution when the same request is resent.

This ADR defines the default policy and pattern for apps to opt into idempotency.

## Decision

### 1. **Default Reconnect Policy: Fail-Fast**

When socket disconnects, all pending RPC promises reject with `WsDisconnectedError` immediately.

**Rationale**: Safe default for non-idempotent operations (mutations, stateful work). No silent retries.

```typescript
// Example
try {
  await client.request(ChargeCard, { amount: 100 });
} catch (error) {
  if (error instanceof WsDisconnectedError) {
    // Connection dropped; payment may or may not have gone through
    // App must handle ambiguity (query backend, show manual retry UI)
  }
}
```

### 2. **Opt-In Resend with `idempotencyKey`**

If RPC request includes `meta.idempotencyKey` (string) and reconnects **within `RESEND_WINDOW_MS`** (default 5s), client **auto-resends** the same request.

**Rationale**: Developer declares "this operation is safe to retry"; client honors it automatically.

```typescript
// Example: idempotent query
const users = await client.request(
  ListUsers,
  { page: 1 },
  {
    idempotencyKey: "list-users-page-1-tab-123",
    signal: abortSignal,
  },
);
```

### 3. **Single-Flight Deduplication (Client-Side)**

If the same RPC (same `(pair, idempotencyKey)`) is sent multiple times before the first completes, subsequent calls coalesce to the same promise.

**Prevents**: UI double-click fires two requests; both wait for single execution.

```typescript
// Example: double-click protection
const handleClick = async () => {
  // Even if clicked twice quickly, only one RPC is in-flight
  const result = await client.request(SubmitForm, payload, {
    idempotencyKey: "submit-form-" + Date.now(),
  });
  updateUI(result);
};
```

**Non-Goals**: Do NOT hash payloads implicitly for dedup; key must be explicit.

### 4. **Server-Side Idempotency Pattern (Not in Core)**

Core router provides no idempotency storage. Apps implement via middleware:

```typescript
// Pseudo-code: idempotency middleware
router.use(async (ctx, next) => {
  if (!ctx.isRpc || !ctx.meta.idempotencyKey) return next();

  // Scope: (tenant, user, rpc-type, key) to prevent cross-user replays
  const key = `${ctx.ws.data.tenant}:${ctx.ws.data.userId}:${ctx.type}:${ctx.meta.idempotencyKey}`;

  const cached = await idempotencyStorage.get(key);
  if (cached) {
    // Already executed: return cached result without re-running handler
    return ctx.send(cached);
  }

  // Not seen before: execute handler
  await next();

  // Store result for future identical requests
  const result = ctx.lastReply; // pseudo-field; TBD in implementation
  await idempotencyStorage.set(key, result, ttl: 300_000); // 5 min TTL
});
```

**Storage Options**: In-memory Map (single-server), Redis, Cloudflare KV, DynamoDB.

### 5. **Resend Window & Time-Based Expiry**

- **Default resend window**: `RESEND_WINDOW_MS = 5_000` (5 seconds).
- **Rationale**: Covers most network glitches; prevents stale retries on network partition.
- **Multi-Tab Safety**: Each tab has its own socket; resend only on that socket's reconnect.

If reconnect happens >5s after disconnect, pending RPCs reject (not retried). App must handle manually.

```typescript
// Example: explicit resend with custom window
await client.request(MyRPC, payload, {
  idempotencyKey: "op-123",
  resendWindowMs: 30_000, // 30-second window for this request
});
```

### 6. **Scope Idempotency Keys Properly**

**Bad**: Key = request payload hash (implicit; user doesn't know when dedup applies).

**Good**: Key = `(user_id, operation, timestamp_or_nonce)` (explicit; scoped to user, operation type, intent).

Example:

```typescript
// Multi-tenant scenario: prevent user B from re-using user A's idempotency key
// Server middleware:
const key = `${ctx.ws.data.tenantId}:${ctx.ws.data.userId}:${ctx.type}:${ctx.meta.idempotencyKey}`;
```

## Alternatives Considered

1. **Automatic payload-based dedup**: Pros: no explicit key needed. Cons: implicit behavior, hard to debug, breaks for mutable payloads.
2. **Server-side idempotency in core**: Pros: guaranteed dedup. Cons: requires stateful router, not all apps need it, storage adapter overhead.
3. **Indefinite resend window**: Pros: never lose a request. Cons: stale retries on network partition; client stuck re-sending forever.
4. **Mandatory idempotency key**: Pros: explicit. Cons: breaks existing code, not all RPCs need it.

## Consequences

### Benefits

- **Safe by default**: Apps must opt-in to resend (fail-fast for non-idempotent ops).
- **Developer control**: Explicit `idempotencyKey` makes intent clear.
- **Flexible storage**: Apps choose storage backend (Map, Redis, KV).
- **Multi-tenant aware**: Middleware pattern encourages proper scoping.
- **Time-bounded**: Resend window prevents indefinite retry loops.

### Risks / Trade-offs

- **Ambient responsibility**: Developers must scope idempotency keys correctly (documented; exemplified in patterns).
- **Duplicated work**: Without idempotency middleware, same request sent twice = executed twice.
- **Network partition edge case**: If partition lasts >5s, pending RPCs fail; client must handle manual retry.

### Maintenance

- Core: No new state tracking (idempotency is app-level pattern).
- Tests: Resend window boundaries, multi-tab safety note, middleware example tests.
- Docs: Idempotency pattern guide (Map/Redis/KV), scoping guidance, multi-tenant examples.

## References

- **ADR-012**: Describes RPC abort, deadline, one-shot—foundation for reconnect safety.
- **Client Implementation**: `packages/client/src/index.ts` — `request()` with idempotencyKey, resend logic, `WsDisconnectedError`.
- **Pattern Docs**: `docs/specs/patterns.md#idempotent-rpc` — middleware code, storage adapter examples.
- **Types**:
  - `packages/client/src/errors.ts` — `WsDisconnectedError`
  - `packages/core/src/types.ts` — `MessageMeta.idempotencyKey`, `MessageMeta.timeoutMs`
- **Constants**: `packages/core/src/constants.ts` — `RESEND_WINDOW_MS`, `DEFAULT_RPC_TIMEOUT_MS`
- **Example**: `examples/rpc-idempotency` — middleware + Map storage, Redis adapter snippet.
