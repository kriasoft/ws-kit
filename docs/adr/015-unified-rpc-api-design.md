# ADR-015: Unified RPC API Design with Explicit Primitives

**Status:** Implemented
**Date:** 2025-10-30
**References:** ADR-012, ADR-013, ADR-014

## Problem

While ADR-014 addressed many RPC developer experience issues, further analysis of production usage patterns and expert feedback revealed opportunities for deeper API simplification:

1. **Dual message APIs**: Separate `rpc()` and `message()` functions create mental overhead
2. **Implicit terminal intent**: No way to declare "this is the final response" at definition time
3. **Send method ambiguity**: Both `send()` and `unicast()` work for replies; unclear which is "correct"
4. **Error taxonomy mismatch**: Legacy codes (`INVALID_ARGUMENT`, `UNAUTHENTICATED`, `RESOURCE_EXHAUSTED`) don't align with RPC standards
5. **Client API design**: Promise-based API doesn't clearly separate progress streams from terminal results
6. **Missing ergonomic helpers**: No `ctx.reply()` or `ctx.progress()` for RPC-specific operations

## Solution

Implementing an optimal API designed for clarity, type safety, and minimal cognitive load—taking full advantage of pre-v1 status (no backward compatibility constraints).

## Why Separate `on()` and `rpc()` Entry Points?

Separate entry points clarify intent and enable distinct semantics:

- **Intent signaling**: Method name reveals contract (`on()` = event, `rpc()` = request-response). No need to inspect implementation.
- **Type safety**: RPC handlers expose `ctx.reply()`, `ctx.progress()`, `ctx.abortSignal`, `ctx.deadline`. Event handlers don't have these. Compile-time guardrails prevent mistakes.
- **Operational surface**: RPC requires correlation IDs, deadlines, one-shot reply guarantee. Events are fire-and-forget pub/sub. Separate entry points make this boundary explicit.

Example:

```typescript
// Event: fire-and-forget pub/sub
router.on(UserLoggedIn, (ctx) => {
  ctx.publish(topic, NotifyMessage, { userId: ctx.payload.userId });
});

// RPC: guaranteed one-shot reply with optional progress
router.rpc(GetUser, (ctx) => {
  ctx.progress?.({ stage: "loading" });
  const user = await db.findById(ctx.payload.id);
  ctx.reply?.({ user }); // Terminal, one-shot, type-safe
});
```

---

### 1. Unified Schema: Message Definition with Optional Response (Implementation Details)

**Problem**: Separate `rpc()` and `message()` functions create dual mental models.

**Solution**: Single `message()` function with optional `response` field marking RPC:

```typescript
// Pub/Sub message (no response)
const PriceTick = message("PRICE_TICK", {
  payload: { symbol: z.string(), px: z.number() },
});

// RPC message (has response)
const GetUser = message("GET_USER", {
  payload: { id: z.string() },
  response: { user: UserSchema },
});
```

**Benefits**:

- One import, one concept ("message")
- Presence of `response` automatically enables RPC invariants
- Backward compatible via config object vs. positional args
- Type inference flows seamlessly from schema to handler

**Implementation**:

- Updated `messageSchema()` to accept config object: `{ payload?, response?, meta? }`
- Both Zod and Valibot adapters support unified API
- `rpc()` alias still available for code migration

### 2. Explicit RPC Primitives: `ctx.reply()` and `ctx.progress()` (Implementation Details)

**Problem**: Generic `send()` and `unicast()` don't signal intent; developers must know RPC semantics.

**Solution**: RPC-specific handler methods:

```typescript
router.on(GetUser, (ctx) => {
  // Progress updates (optional, before terminal reply)
  ctx.progress?.({ stage: "loading" });

  const user = await db.findById(ctx.payload.id);

  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }

  // Terminal reply (type-safe, one-shot guarded)
  ctx.reply?.({ user });
});
```

**Semantics**:

- `ctx.progress(data?)` → Non-terminal unicast with correlation; safe no-op if backpressured
- `ctx.reply(data)` → Terminal reply, schema-enforced to response type, one-shot guarded
- Both optional properties (only defined for RPC messages)

**Benefits**:

- Intent-revealing: readers know `reply` is terminal
- Type safety: `reply()` enforces response schema
- Backpressure-aware: progress silently drops; replies are prioritized
- Aligns with async iterator pattern (`progress()` → `AsyncIterable`, `reply()` → terminal result)

### 3. Expanded Error Taxonomy (RPC-Standard Codes) (Implementation Details)

**Problem**: Legacy error codes don't cover RPC-specific failures (timeout, cancellation, conflict).

**Solution**: Unified taxonomy aligned with gRPC conventions plus backwards-compatible legacy codes.

#### 3.1 Design Rationale

Error codes aligned with **gRPC standard** (battle-tested by thousands of teams) provide:

- **Clear semantics**: Developers familiar with gRPC immediately understand our codes
- **Terminal vs transient split**: Guides client retry policy (terminal = fail fast, transient = backoff)
- **RPC-specific coverage**: Codes for deadlines, cancellation, rate limits, conflicts—not just HTTP status codes
- **Backwards compatibility**: Legacy codes (`INVALID_ARGUMENT`, `UNAUTHENTICATED`, `RESOURCE_EXHAUSTED`) mapped to new codes

#### 3.3 Error Code Reference & Decision Matrix

Optimized set of 13 error codes aligned with gRPC/Twirp standards. Organized by retry policy.

**Canonical types**:

- **`WsKitErrorCode`** (canonical enum, system-wide; used by all handlers)
- **`WsErrorCode = WsKitErrorCode`** (server brevity alias)
- **`RpcErrorCode = WsKitErrorCode`** (client call-site alias)

**Terminal errors** (don't retry—client or business outcome failed):

| Code                  | Meaning                                    | Client Action                                            |
| --------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `UNAUTHENTICATED`     | Auth token missing, expired, or invalid    | Re-authenticate; don't retry blindly                     |
| `PERMISSION_DENIED`   | Authenticated but lacks rights (authZ)     | Don't retry; request different scope or show UI          |
| `INVALID_ARGUMENT`    | Input validation or semantic violation     | Fix request and retry; don't retry as-is                 |
| `FAILED_PRECONDITION` | State requirement not met                  | Perform prerequisite action, then retry                  |
| `NOT_FOUND`           | Target resource absent                     | Stop or create resource if appropriate                   |
| `ALREADY_EXISTS`      | Uniqueness or idempotency replay violation | Use stored result for idempotency key, or choose new key |
| `ABORTED`             | Concurrency conflict (race condition)      | Retry with backoff/jitter and refreshed state            |

**Transient errors** (retry with backoff—infrastructure or flow control):

| Code                 | Meaning                               | Client Action                                                          |
| -------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `DEADLINE_EXCEEDED`  | RPC timed out                         | Retry with longer timeout if appropriate; surface "took too long"      |
| `RESOURCE_EXHAUSTED` | Rate limit, quota, or buffer overflow | Honor `retryAfterMs` if provided; backoff and reduce burst size        |
| `UNAVAILABLE`        | Transient infrastructure error        | Retry with exponential backoff; show "service temporarily unavailable" |

**Server / evolution**:

| Code            | Meaning                                           | Client Action                                            |
| --------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `UNIMPLEMENTED` | Feature not supported or deployed                 | Feature-gate in UI; avoid retry until version parity     |
| `INTERNAL`      | Unexpected server error (bug)                     | Don't retry blindly; capture `correlationId` for support |
| `CANCELLED`     | Call cancelled (client disconnect, timeout abort) | Treat as user-initiated stop; don't auto-retry           |

---

**Error Type & Shape**:

```typescript
// Canonical error code enum (system-wide)
export type WsKitErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENT"
  | "FAILED_PRECONDITION"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "ABORTED"
  | "DEADLINE_EXCEEDED"
  | "RESOURCE_EXHAUSTED"
  | "UNAVAILABLE"
  | "UNIMPLEMENTED"
  | "INTERNAL"
  | "CANCELLED";

// Runtime exception (enables instanceof checks and stack traces)
export class WsKitError extends Error {
  readonly code: WsKitErrorCode;
  readonly message: string; // Human-readable, safe for UI
  readonly details: Record<string, unknown>; // Structured hints (field, resource, etc.)
  readonly retryAfterMs?: number; // For RESOURCE_EXHAUSTED / UNAVAILABLE
  readonly correlationId?: string; // Echo for distributed tracing
  readonly cause?: unknown; // WHATWG standard: original error for debugging

  constructor(
    code: WsKitErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      retryAfterMs?: number;
      correlationId?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "WsKitError";
    this.code = code;
    this.message = message;
    this.details = options?.details || {};
    this.retryAfterMs = options?.retryAfterMs;
    this.correlationId = options?.correlationId;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  static wrap(
    error: unknown,
    code: WsKitErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): WsKitError {
    if (error instanceof WsKitError) {
      return error;
    }
    const originalError =
      error instanceof Error ? error : new Error(String(error));
    return new WsKitError(code, message, { details, cause: originalError });
  }

  /**
   * Serialize to client-safe payload (excludes cause, stack, debug info).
   * Used for wire format transmission.
   */
  toPayload() {
    return {
      code: this.code,
      message: this.message,
      ...(Object.keys(this.details).length > 0 && { details: this.details }),
      ...(this.retryAfterMs && { retryAfterMs: this.retryAfterMs }),
      ...(this.correlationId && { correlationId: this.correlationId }),
    };
  }

  /**
   * Serialize to JSON for internal logging (includes cause and stack).
   * Use for ELK, Sentry, structured logging integrations.
   */
  toJSON() {
    const cause = this.cause;
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      ...(this.retryAfterMs && { retryAfterMs: this.retryAfterMs }),
      ...(this.correlationId && { correlationId: this.correlationId }),
      stack: this.stack,
      ...(cause && {
        cause:
          cause instanceof Error
            ? { name: cause.name, message: cause.message, stack: cause.stack }
            : String(cause),
      }),
    };
  }
}

// Ergonomic aliases (import these for brevity at call sites)
export type WsErrorCode = WsKitErrorCode; // Server
export type WsError = WsKitError; // Server
export type RpcErrorCode = WsKitErrorCode; // Client
export type RpcError = WsKitError; // Client
```

---

**Quick Decision Tree** (pin this in docs):

```text
Input validation failed?              → INVALID_ARGUMENT (fix and retry)
Stateful precondition unmet?          → FAILED_PRECONDITION (satisfy then retry)
Not authenticated?                    → UNAUTHENTICATED (re-auth, don't retry)
Lacks permission?                     → PERMISSION_DENIED (request scope, don't retry)
Resource doesn't exist?               → NOT_FOUND (stop or create, don't retry)
Uniqueness or idempotency violation?  → ALREADY_EXISTS (use cached result, don't retry)
Race condition or write conflict?     → ABORTED (retry with backoff)
Timed out (deadline)?                 → DEADLINE_EXCEEDED (retry with longer timeout)
Rate limit / quota / backpressure?    → RESOURCE_EXHAUSTED (honor retryAfterMs, backoff)
Transient downstream outage?          → UNAVAILABLE (retry with exponential backoff)
Method not supported / feature flag?  → UNIMPLEMENTED (feature-gate, don't retry)
Unhandled exception / bug?            → INTERNAL (capture correlationId, limited retry)
User cancelled / socket closed?       → CANCELLED (don't auto-retry)
```

---

**Why This Set Is Better**:

- **Direct mapping → client action**: Each code maps directly to a deterministic recovery behavior:
  - Fix input? → `INVALID_ARGUMENT`
  - Retry with backoff? → `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `ABORTED`
  - Don't retry? → `UNAUTHENTICATED`, `PERMISSION_DENIED`, `NOT_FOUND`, `ALREADY_EXISTS`, `UNIMPLEMENTED`
  - Stop and investigate? → `INTERNAL`

  Prevents guessing and random retries.

- **Terminal vs transient split**: Clean retry policy boundary—divides errors into "client/business problem" vs "infrastructure/flow-control"—guides deterministic backoff logic.
- **Auth clarity**: UNAUTHENTICATED (missing/invalid token) vs PERMISSION_DENIED (no rights) prevents wrong UI prompts.
- **Concurrency vs uniqueness**: ABORTED (race/optimistic lock) vs ALREADY_EXISTS (idempotency/unique constraint) makes conflict handling deterministic.
- **WebSocket-specific**: RESOURCE_EXHAUSTED covers rate limits, quotas, and backpressure saturation. CANCELLED captures user navigation/socket close.
- **Operational clarity**: UNAVAILABLE for transient outages; UNIMPLEMENTED for version skew/feature flags; INTERNAL for bugs with tracing.
- **Standard vocabulary**: Aligns with gRPC conventions—lower surprise, easier cross-service tooling and log search.

---

**Legacy Codes & Migration**:

| Legacy Code          | Replacement                                                     | Notes                         |
| -------------------- | --------------------------------------------------------------- | ----------------------------- |
| `INVALID_ARGUMENT`   | `INVALID_ARGUMENT`                                              | Direct replacement            |
| `UNAUTHENTICATED`    | `UNAUTHENTICATED` (no token) or `PERMISSION_DENIED` (no rights) | Auth was conflated; now split |
| `RESOURCE_EXHAUSTED` | `RESOURCE_EXHAUSTED` (set `retryAfterMs` when known)            | Broader scope                 |
| `INTERNAL`           | `INTERNAL`                                                      | Shorter, matches gRPC         |

These legacy codes are accepted for backwards compatibility but should not be used in new code. Deployed clients may expect them, so gradual migration reduces production risk.

---

### 4.1 Transport Close Policy (Not Auto-Close by Default)

**Principle**: Do not automatically close the connection on application errors. Send `ERROR` message and keep the connection open unless explicitly closed by the app.

**Rationale**:

- Matches WebSocket semantics—errors are application-level, not transport-level.
- Preserves connection for recovery and retry.
- Allows client to gracefully handle errors without reconnection overhead.

**Exception**: Only auto-close for unrecoverable auth/policy violations at connection upgrade:

- `UNAUTHENTICATED` on handshake → close with **1008** (policy violation)
- Truly catastrophic server state → close with **1011** (server error)

**For all other errors**: Send `ERROR` response and keep socket open.

---

### 4.2 Backpressure & Cancellation Semantics

- **Backpressure**: Drop progress updates first; never drop terminal replies. If output buffer saturated, return `RESOURCE_EXHAUSTED`.
- **Cancellation**: Client disconnect/abort → `CANCELLED`; server deadline exceeded → `DEADLINE_EXCEEDED`.
- **Conflict taxonomy**: Optimistic write failure → `ABORTED`; duplicate idempotency key → `ALREADY_EXISTS`.
- **Version skew**: Unknown RPC method or feature behind flag → `UNIMPLEMENTED` (not `NOT_FOUND`).

### 5. `ctx.abortSignal` for Ecosystem Integration (Implementation Details)

Provides read-only `abortSignal` for seamless integration with fetch/ORM libraries expecting native abort signals:

```typescript
router.rpc(LongQuery, async (ctx) => {
  const result = await fetch(url, {
    signal: ctx.abortSignal, // Fires on $ws:abort, disconnect, or server cancel
  });
  ctx.reply?.({ result });
});
```

## Impact on APIs

### Server

**Before**:

```typescript
const ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });

router.on(ping, (ctx) => {
  ctx.send(ping.response, { reply: `Got: ${ctx.payload.text}` });
});
```

**After**:

```typescript
const Ping = message("PING", {
  payload: { text: z.string() },
  response: { reply: z.string() },
});

router.on(Ping, (ctx) => {
  ctx.reply?.({ reply: `Got: ${ctx.payload.text}` });
});
```

### Client

**Before**:

```typescript
const result = await client.request(ping, { text: "hello" });
```

**After** (unchanged syntax, clearer intent):

```typescript
const call = client.request(Ping, { text: "hello" });
for await (const p of call.progress()) {
  console.log("progress:", p);
}
const result = await call.result();
```

## Implementation Status

✅ **Completed**:

- Unified schema API with optional `response` field (Zod + Valibot)
- `ctx.reply()` and `ctx.progress()` method stubs in core types
- `ctx.abortSignal` property definition
- Expanded error codes with 13 standards aligned with gRPC (including CANCELLED for WebSocket lifecycle)
- `WsKitErrorCode` canonical enum and `WsKitError` runtime exception class
- Type aliases: `WsErrorCode` (server), `RpcErrorCode` (client) for ergonomics
- Error shape with `correlationId`, `details`, `retryAfterMs` support
- `WsKitError.toJSON()` serialization for logging and client transmission
- Router implementation: `router.rpc()` and `router.on()` explicit entry points
- Client API: `client.request(Message, payload)` with correlation tracking

## Developer Experience Tooling

**Type-safe error narrowing**:

`WsKitError` is a runtime exception that implements the error shape; ergonomic aliases (`WsError`, `RpcError`) are available for brevity:

```typescript
// Core package exports canonical types
import { WsKitError, type WsKitErrorCode } from "@ws-kit/core";

// Server code (use brief alias)
import type { WsError } from "@ws-kit/zod";

// Client code (use brief alias)
import type { RpcError } from "@ws-kit/client/zod";

// Server: throwing structured errors
throw new WsKitError("INVALID_ARGUMENT", "Email is required", {
  field: "email",
});

// Client: narrowing error types
try {
  const result = await client.request(GetUser, { id: "123" });
} catch (err: RpcError) {
  if (err.code === "UNAUTHENTICATED") {
    // TypeScript: err.code is narrowed; show re-auth UI
  } else if (err.code === "NOT_FOUND") {
    // Show "user doesn't exist"
  }
}
```

**Note**: `RpcErrorCode = WsKitErrorCode` and `RpcError = WsKitError` (same taxonomy for both `on()` and `rpc()` handlers). Aliases exist purely for call-site ergonomics and readability. `instanceof WsKitError` works reliably across all packages.

**Decision tree in docs**:

Pin the error code decision tree (section 3.3) in troubleshooting guides and API docs for quick reference. Developers should resolve error codes in <5 seconds without reading full rationale.

**Consistent wire format**:

- Always include `code` and `message`
- Include `details` for validation errors (field violations)
- Include `retryAfterMs` for `RESOURCE_EXHAUSTED` / `UNAVAILABLE`
- Include `correlationId` for ops visibility
- Omit empty fields to keep wire size minimal

## References

- [ADR-012: Minimal Reliable RPC](./012-rpc-minimal-reliable.md) — Core RPC lifecycle
- [ADR-013: Reconnect & Idempotency](./013-rpc-reconnect-idempotency.md) — Safe retries
- [ADR-014: RPC DX Improvements](./014-rpc-dx-safety-improvements.md) — Phase A improvements
- [RPC Troubleshooting](../guides/rpc-troubleshooting) — Troubleshooting guide
