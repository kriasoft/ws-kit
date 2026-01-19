# ADR-030: Context Methods Design

**Status**: Proposed
**Date**: 2025-11-14
**Tags**: [api-design, messaging, async, error-handling, developer-experience]

## Context

The router's context methods (`.send()`, `.reply()`, `.progress()`, `.publish()`) are core to the handler API. Current design decisions affect:

1. **Developer Experience** — Should unicast be sync or async by default?
2. **Composability** — How should errors flow (throws vs events vs results)?
3. **Performance** — Can we keep simple cases latency-minimal without losing power?
4. **Safety** — How do we enforce terminal/non-terminal semantics (`.reply()` vs `.progress()`)?
5. **Scalability** — How should distributed pub/sub behave (guaranteed vs eventual)?
6. **Plugin Architecture** — Which methods require validators or pub/sub plugins?

### Problem

Existing designs create friction:

- **All-async** — Developers await everything, even simple sends (noise, latency impact)
- **All-sync** — Distributed pub/sub blocks; unscalable
- **Throws for I/O** — Handler crashes on connection close; harder to compose
- **Silent failures** — No clear error reporting; hard to debug
- **Unclear when to use what** — Is `.publish()` ordered? Do subscribers always get the message?
- **No backpressure control** — Can't wait for buffer drain; can't observe delivery metrics

### Requirements

- ✅ **Lean handlers** — Typical cases should be simple (no unnecessary awaits)
- ✅ **Powerful** — Advanced cases (streaming, backpressure, metrics) must be expressible
- ✅ **Safe** — Type system enforces RPC sequencing (no `.reply()` twice)
- ✅ **Observable** — Errors and metrics visible without breaking handler flow
- ✅ **Scalable** — Distributed pub/sub must work without I/O blocking
- ✅ **Plugin-gated** — Capabilities clearly tied to required plugins

## Decision

### Core Philosophy

1. **Sync-first for unicast** — `.send()`, `.reply()`, `.error()`, `.progress()` enqueue synchronously (fast, simple)
2. **Async for broadcast** — `.publish()` is `Promise<PublishResult>` (coordination in distributed systems)
3. **Opt-in async** — Unicast methods accept `{waitFor}` option for advanced control (backpressure, confirmation)
4. **No runtime throws** — I/O errors via `onError` events or result objects; only dev-time throws
   - `.error()` treats application-level errors as structured payloads (not exceptions) to avoid crashing handlers
5. **Plugin gating** — Methods throw upfront (module load) if required plugin missing; runtime behavior then guaranteed
6. **One-shot RPC semantics** — `.reply()` and `.error()` enforce terminal responses via one-shot guard (ADR-012); prevents duplicate or mixed terminals

### Method Specifications

#### `ctx.send(schema, payload, opts?)` → Overloaded: `void` or `Promise<boolean>`

**Purpose**: Send a one-way message to the current connection (unicast, 1-to-1).

**Signature**:

```typescript
send<T>(schema: Schema<T>, payload: T): void;
send<T>(schema: Schema<T>, payload: T, opts: SendOptionsAsync): Promise<boolean>;
send<T>(schema: Schema<T>, payload: T, opts: SendOptionsSync): void;

interface SendOptionsSync {
  signal?: AbortSignal;
  meta?: Record<string, any>;
  inheritCorrelationId?: boolean;
}

interface SendOptionsAsync extends SendOptionsSync {
  waitFor: 'drain' | 'ack';  // Makes return type Promise<boolean>
}
```

**Return Type Design**: The method uses separate `SendOptionsSync` and `SendOptionsAsync` interfaces to enable TypeScript to infer the correct return type at compile time. When `waitFor` is present (async variant), the return type is `Promise<boolean>`. When `waitFor` is absent (sync variant), the return type is `void`. This overload pattern avoids the unsafe `void | Promise<boolean>` union that would require runtime checks, aligning with the sync-first design philosophy.

**Behavior**:

- Enqueues message to WebSocket send buffer immediately (sync)
- Returns `void` unless `waitFor` specified
- Connection closed → fires `onError` event (never throws)
- Invalid payload → throws at dev time (type/validation); never at runtime
- If `{waitFor: 'drain'}`: waits for buffer to drain; returns `Promise<boolean>`
- If `{waitFor: 'ack'}`: waits for server-side acknowledgment; returns `Promise<boolean>`

**Error Modes**:
| Error | When | Handling |
|-------|------|----------|
| Type mismatch | Compile time | TypeScript catches |
| Validation fails | Dev: throws; runtime: never | Dev fix payload before ship |
| Socket closed | Async (via onError event) | App logs; doesn't crash handler |
| Backpressure | Opt-in via waitFor | Returns false; app decides retry/backoff |

**Design Rationale**:

- Sync by default keeps handlers fast and simple
- Opt-in async via `{waitFor}` unlocks backpressure control without base complexity
- `onError` event ensures network failures don't crash handlers
- Type safety prevents payload mismatches upfront

**Why Async Backpressure Over Sync Status Codes?**

Alternatives like returning integers (e.g., `0=ok, 2=buffer-full`) require manual status checks in every call site, adding boilerplate and cognitive load. Instead, `await ctx.send(..., {waitFor: 'drain'})` lets handlers naturally pause on slow clients using idiomatic `async/await`, yielding the event loop for better concurrency. This design keeps the base API simple (sync by default) while making backpressure composable and opt-in only where critical.

**Examples**:

```typescript
// Simple: fire-and-forget
ctx.send(PongMsg, { text: "pong" });

// Backpressure-sensitive (wait for buffer drain)
const sent = await ctx.send(LargeMsg, buffer, { waitFor: "drain" });
if (!sent) console.warn("buffer full; client may have disconnected");

// Cancellable
const signal = new AbortController().signal;
ctx.send(Msg, data, { signal });

// With metadata
ctx.send(Msg, payload, { meta: { timestamp: Date.now() } });
```

---

#### `ctx.reply(payload, opts?)` → `void | Promise<void>`

**Purpose**: Send a terminal response in an RPC handler (unicast, 1-to-1, RPC-only).

**Signature**:

```typescript
reply<T>(
  payload: T,
  opts?: ReplyOptions,
): void | Promise<void>;

interface ReplyOptions {
  signal?: AbortSignal;
  waitFor?: 'drain' | 'ack';
  meta?: Record<string, any>;
}
```

**Behavior**:

- Terminal: calling `.reply()` twice throws error (enforced at compile time via type system)
- Sends response to RPC caller; resolves client-side `.request()` Promise
- If called after `.progress()`: valid; marks end of streaming
- If called outside `.rpc()` handler: throws error
- Enqueues immediately (sync); opt-in async via `{waitFor}`
- Socket closed → fires `onError`; client's Promise rejects

**Error Modes**:
| Error | When | Handling |
|-------|------|----------|
| Called outside .rpc() | Handler call | Throws: "reply() requires RPC context" |
| Called twice | Handler call | Ignored by one-shot guard (optional dev-mode log); type system helps prevent at compile time |
| Invalid payload | Compile time | TypeScript catches schema mismatch |
| Socket closed | Async | onError event; client rejects |

**Design Rationale**:

- Sync by default matches RPC caller expectation (response queued immediately)
- Type system enforces terminal semantics (can't call twice)
- Opt-in `{waitFor}` for critical paths where client-side action depends on receipt
- Auto-correlation with request ensures client resolves correctly

**Examples**:

```typescript
// Simple RPC response
router.rpc(GetUser, (ctx) => {
  const user = db.get(ctx.payload.id);
  ctx.reply({ id: user.id, name: user.name });
});

// Client side
const user = await client.request(GetUser, { id: "123" });

// With streaming (progress then reply)
router.rpc(LongOp, async (ctx) => {
  for (const step of steps) {
    ctx.progress({ progress: step });
  }
  ctx.reply({ result: "done" }); // Terminal marker
});

// Wait for server-side confirmation (rare)
await ctx.reply({ status: "ok" }, { waitFor: "ack" });
```

---

### Terminal Semantics: One-Shot Reply Guard

To ensure RPC reliability and prevent duplicate responses (e.g., from handler bugs, incomplete error handling, or retries), the router uses per-correlationId state (via RpcManager) to enforce "one-shot" terminals.

**Behavior**:

- **First call** to `.reply()` or `.error()` is terminal: Sends the response and marks the RPC as complete.
- **Subsequent calls** to `.reply()` or `.error()`: Ignored (no send); optionally logged in dev mode for debugging.
- **`.progress()` before terminal**: Allowed multiple times; all sent (or throttled).
- **`.progress()` after terminal**: Ignored; optionally logged in dev mode.
- **Type system**: Helps prevent duplicates at compile time where possible (e.g., RpcContext inference).

**Rationale**:

- Suppresses duplicates safely without runtime throws, preserving handler composability.
- Aligns with idempotency (prevents duplicate wire messages), reliability (ADR-012), and incomplete handling patterns.
- Handlers remain robust against edge cases (bugs, incomplete error paths, retries).

**Testing**:

See `packages/core/test/features/rpc-reliability.test.ts` for duplicate suppression behavior; `rpc-incomplete-warning.test.ts` for incomplete handling.

**Examples**:

```typescript
// Valid: Progress then terminal
ctx.progress({ step: 1 });
ctx.reply({ result: "done" }); // Sent ✅

// Duplicate terminal: Ignored (no send, optional dev log)
ctx.reply({ result: "done" });
ctx.reply({ result: "oops" }); // Ignored; dev log: "Duplicate reply for RPC; use .error() for failure"

// Post-terminal progress: Ignored (no send, optional dev log)
ctx.reply({ result: "done" });
ctx.progress({ step: 2 }); // Ignored; dev log if enabled

// Mixed terminals: First wins, second ignored
ctx.error("FAILED", "Something went wrong");
ctx.reply({ result: "ok" }); // Ignored; only error was sent
```

---

#### `ctx.error(code, message, details?, opts?)` → `void | Promise<void>`

**Purpose**: Terminal application-level error response for RPC (symmetric to `.reply()`).

**Signature**:

```typescript
error<T = unknown>(
  code: string,               // Standardized error code (e.g., "NOT_FOUND", "PERMISSION_DENIED")
  message: string,            // Human-readable error description
  details?: T,                // Optional structured error details (type-inferred)
  opts?: ReplyOptions,        // Reuse: signal, waitFor, meta
): void | Promise<void>;
```

**Behavior**:

- Only valid inside `.rpc()` handlers; throws if called outside (enforced by type system and runtime).
- Terminal: Uses the same one-shot guard as `.reply()`—first call to either `.reply()` or `.error()` marks the RPC as responded; further calls are suppressed (no-ops, logged in dev mode).
- Enqueues immediately (sync); opt-in async via `{waitFor}`.
- Sends structured `RPC_ERROR` wire frame per ADR-012: `{code, message, details, retryable, retryAfterMs}`.
- Connection closed: Fires `onError` event; client's RPC Promise rejects with `RpcError`.
- Never throws for I/O—errors are semantic payloads, not exceptions.

**Error Modes**:
| Error | Type | When | Handling |
|-------|------|------|----------|
| Called outside .rpc() | Dev | Handler call | Throws: "error() requires RPC context" |
| Called after .reply() | Runtime | Handler call | Ignored by one-shot guard (optional dev-mode log) |
| Called after terminal | Runtime | Handler call | Ignored by one-shot guard (optional dev-mode log); first terminal wins |
| Invalid details | Dev | Compile time | TypeScript catches schema mismatch |
| Socket closed | Runtime | Async | onError event; client rejects |

**Design Rationale**:

- Sync by default keeps error handling simple and symmetric with `.reply()`.
- One-shot guard (shared with `.reply()`) prevents duplicate or mixed terminals (success then error, or vice versa).
- Reuse `.reply()` options for composability; no new surface area.
- Structured `RPC_ERROR` payload (code, message, details) allows clients to distinguish retryable failures (e.g., "RESOURCE_EXHAUSTED") from fatal ones (e.g., "NOT_FOUND").
- Treats errors as payloads (not exceptions) to avoid crashing handlers—aligns with ADR-012 reliability principles.

**Examples**:

```typescript
// Simple error response
router.rpc(GetUserMsg, (ctx) => {
  const user = db.get(ctx.payload.id);
  if (!user) {
    return ctx.error("NOT_FOUND", "User not found", { id: ctx.payload.id });
  }
  ctx.reply({ id: user.id, name: user.name });
});

// Error with retry hint
router.rpc(FetchDataMsg, async (ctx) => {
  try {
    const data = await externalApi.fetch(ctx.payload.url);
    ctx.reply({ data });
  } catch (err) {
    if (err.isRetryable) {
      // Client-side can retry after backoff
      return ctx.error("TEMPORARY_ERROR", "Service temporarily unavailable",
        { retryAfterMs: 5000 }
      );
    }
    ctx.error("PERMANENT_ERROR", "Invalid request", { reason: err.message });
  }
});

// Permission error
router.rpc(DeleteUserMsg, (ctx) => {
  if (!ctx.data.roles?.includes("admin")) {
    return ctx.error("PERMISSION_DENIED", "Only admins can delete users");
  }
  db.deleteUser(ctx.payload.id);
  ctx.reply({ success: true });
});

// Wait for confirmation (rare, like .reply)
router.rpc(CriticalMsg, async (ctx) => {
  if (validation.failed(ctx.payload)) {
    await ctx.error("VALIDATION_ERROR", "Invalid input", { errors: [...] }, { waitFor: 'ack' });
  } else {
    ctx.reply({ ok: true });
  }
});
```

---

#### `ctx.progress(update, opts?)` → `void | Promise<void>`

**Purpose**: Send non-terminal updates in an RPC streaming handler (unicast, 1-to-1, RPC-only).

**Signature**:

```typescript
progress<T>(
  update: T,
  opts?: ProgressOptions,
): void | Promise<void>;

interface ProgressOptions {
  signal?: AbortSignal;
  waitFor?: 'drain' | 'ack';
  meta?: Record<string, any>;
  throttleMs?: number;  // Optional rate limiting
}
```

**Behavior**:

- Non-terminal: calling multiple times is valid; all sent (or throttled)
- Must precede `.reply()` in same handler; calling after `.reply()` throws error
- Enqueues immediately (sync); opt-in async via `{waitFor}`
- Client receives via `.onProgress(callback)` on the Promise
- If `{throttleMs}` set: batches rapid updates (e.g., 100ms throttle = max 10/sec)
- Socket closed → fires `onError`; further calls are no-ops

**Error Modes**:
| Error | When | Handling |
|-------|------|----------|
| Called outside .rpc() | Handler call | Throws: "progress() requires RPC context" |
| Called after .reply() | Handler call | Ignored by one-shot guard (optional dev-mode log) |
| Invalid payload | Compile time | TypeScript catches schema mismatch |
| Throttle delay | On opt-in | Update queued; sent in batch |

**Design Rationale**:

- Sync by default keeps streaming handlers simple
- Non-terminal semantics allow multiple calls without error
- Type system enforces ordering (progress before reply)
- Optional throttling reduces network/processing load on rapid updates
- Client-side `.onProgress()` callback integrates naturally with Promise pattern

**Examples**:

```typescript
// Streaming large response
router.rpc(ProcessFile, async (ctx) => {
  const chunks = await loadFile(ctx.payload.path);

  for (const chunk of chunks) {
    ctx.progress({ processed: chunk.bytes, total: chunks.total });
  }

  ctx.reply({ success: true, itemsProcessed: chunks.count });
});

// Client side
client.request(ProcessFile, { path: "/data.csv" }).then(
  (result) => console.log("Done:", result), // .reply
  (error) => console.error("Error:", error), // Connection error
  (update) => updateProgressBar(update.processed), // .progress
);

// Throttle rapid updates (10 per second)
for (const frame of animation) {
  ctx.progress({ frameNum: frame }, { throttleMs: 100 });
}
```

---

#### `ctx.publish(topic, schema, payload, opts?)` → `Promise<PublishResult>`

**Purpose**: Broadcast a message to all subscribers of a topic (1-to-many, async, requires PubSub plugin).

**Signature**:

```typescript
publish<T>(
  topic: string,
  schema: Schema<T>,
  payload: T,
  opts?: PublishOptions,
): Promise<PublishResult>;

interface PublishResult {
  ok: boolean;
  error?: string;                    // Error code: 'INVALID_PAYLOAD', 'ADAPTER_ERROR', etc.
  matched?: number;                  // Approximate subscriber count reached
  capability: 'local' | 'distributed' | 'partial';  // Delivery guarantee level
}

interface PublishOptions {
  signal?: AbortSignal;
  excludeSelf?: boolean;             // Default: false (memory/Redis; Bun: UNSUPPORTED)
  partitionKey?: string;             // For distributed consistency
  waitFor?: 'enqueued' | 'settled';  // Default: 'enqueued'
  meta?: Record<string, any>;
}
```

**Behavior**:

- Always async (returns Promise immediately)
- Broadcasts to all subscribers of `topic` (distributed or local, adapter-dependent)
- Returns structured result; never throws at runtime (throws upfront if plugin missing)
- `{waitFor: 'enqueued'}` (default): returns when message enqueued by adapter; fast feedback
- `{waitFor: 'settled'}`: returns when message delivered to all subscribers (slower, more certain)
- `{excludeSelf: true}`: skips current connection (memory/Redis adapters; Bun returns UNSUPPORTED)
- `{partitionKey}`: ensures order within partition for distributed systems (e.g., Redis Streams)
- `{signal}`: aborts if provided AbortController fires before publish starts

**Error Modes**:
| Error | Result |
|-------|--------|
| Missing `withPubSub()` plugin | Throws upfront: "PubSub plugin required" |
| Validation fails | `{ok: false, error: 'INVALID_PAYLOAD'}` |
| Adapter error | `{ok: false, error: 'ADAPTER_ERROR'}` |
| No subscribers | `{ok: true, matched: 0, capability: 'local'}` |
| Successful (local) | `{ok: true, matched: N, capability: 'local'}` |
| Partial delivery (distributed) | `{ok: true, matched: N, capability: 'partial'}` |

**Design Rationale**:

- Async by default because distributed coordination can't be sync
- Structured result allows apps to observe success/failure/metrics without exceptions
- `waitFor` option lets critical paths wait for settlement; typical cases use default (fast)
- `capability` field reports delivery guarantee level (local = definite; distributed = eventual)
- `partitionKey` enables ordering guarantees in distributed setups
- Plugin gating ensures pub/sub is explicitly enabled upfront

**Examples**:

```typescript
// Basic broadcast: fire-and-forget
const res = await ctx.publish("users:online", UserEvent, {
  userId: ctx.data.userId,
  action: "joined",
});
console.log(`Reached ${res.matched} subscribers`);

// Exclude self (chat pattern: don't echo back to sender)
await ctx.publish("room:123:chat", ChatMsg, message, { excludeSelf: true });

// Critical path: wait for settlement
const res = await ctx.publish("payments", PaymentMsg, txn, {
  waitFor: "settled",
  partitionKey: ctx.data.userId, // Ensure order per user
});

if (!res.ok) {
  ctx.send(ErrorMsg, { reason: res.error });
  // Optionally retry or escalate
}

// Cancellable with timeout
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
const res = await ctx.publish(topic, schema, data, {
  signal: controller.signal,
});
clearTimeout(timeout);
```

---

### Decision Matrix

Quick reference for choosing the right method:

| Aspect               | `.send()`         | `.reply()`        | `.error()`             | `.progress()`     | `.publish()`  |
| -------------------- | ----------------- | ----------------- | ---------------------- | ----------------- | ------------- |
| **Scope**            | 1-to-1            | 1-to-1 RPC        | 1-to-1 RPC             | 1-to-1 RPC        | 1-to-many     |
| **Use When**         | Fire-and-forget   | RPC success       | RPC failure (expected) | Long-running ops  | Broadcast     |
| **Default Async**    | No (sync)         | No (sync)         | No (sync)              | No (sync)         | Yes (Promise) |
| **Opt-in Async**     | Yes (`{waitFor}`) | Yes (`{waitFor}`) | Yes (`{waitFor}`)      | Yes (`{waitFor}`) | N/A           |
| **Terminal**         | N/A               | Yes (one-shot)    | Yes (one-shot)         | No (multiple ok)  | N/A           |
| **Plugin Required**  | None              | Validator         | Validator              | Validator         | PubSub        |
| **Error Reporting**  | onError event     | onError event     | onError event          | onError event     | Result object |
| **Type Inference**   | From schema       | From RPC schema   | From RPC schema        | From RPC schema   | From schema   |
| **Returns**          | void              | void              | void                   | void              | Promise       |
| **Throw at Runtime** | Never             | Never             | Never                  | Never             | Never         |

---

### Error Handling Philosophy

**Dev-Time Errors (Throws)**:

- Type mismatches (TypeScript compile time)
- Validation failures (dev must fix payload)
- API misuse (e.g., `.reply()` outside `.rpc()` context)
- Missing plugin (e.g., `.publish()` without `withPubSub()`)

**Runtime Errors (No Throw)**:

- Connection closed (via `onError` event)
- Adapter failure (via result object for publish; onError for unicast)
- Backpressure (opt-in `{waitFor}` return value or onError)

**Rationale**: Handlers should never crash due to I/O or network failures. Events and result objects keep handler flow composable and observable.

For detailed error catalogs by method, see [docs/specs/context-methods.md#Error-Handling](../specs/context-methods.md#error-handling).

**Rule of Thumb: Mutations Throw, Actions Return**

This aligns with the pub/sub spec (docs/specs/pubsub.md): state-changing mutations (e.g., `ctx.topics.subscribe()`) throw on failures like invalid topics or ACL denials for fail-fast safety. The context methods here (`ctx.send()`, `ctx.reply()`, `ctx.progress()`, `ctx.publish()`) are action-oriented and never throw at runtime for I/O or transient issues—they use `onError` events (unicast) or structured results like `PublishResult` (broadcast) for graceful, observable handling.

---

### Why This Design

#### Sync-First for Unicast

| Alternative             | Tradeoff                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| All async               | Simpler mental model; but adds noise (await everywhere) and latency for simple sends |
| All sync                | Can't do distributed pub/sub; blocks on I/O                                          |
| **Sync + opt-in async** | ✅ Minimal boilerplate for 90% of cases; power available when needed                 |

#### Async for Broadcast

| Alternative                  | Tradeoff                                                  |
| ---------------------------- | --------------------------------------------------------- |
| Sync publish                 | Blocks entire handler on distributed I/O; unscalable      |
| Fire-and-forget (no return)  | Can't observe success/failure/metrics                     |
| **`Promise<PublishResult>`** | ✅ Non-blocking; apps can opt to await or fire-and-forget |

#### No Runtime Throws

| Alternative           | Tradeoff                                                      |
| --------------------- | ------------------------------------------------------------- |
| Throws on I/O failure | Crashes handler; hard to recover or compose                   |
| Silent failures       | No visibility; hard to debug                                  |
| **Events + results**  | ✅ Observable, composable, debuggable; handler flow preserved |

#### Plugin Gating

| Alternative                              | Tradeoff                                                       |
| ---------------------------------------- | -------------------------------------------------------------- |
| No gating (all methods always available) | Runtime errors if plugin missing; confusing                    |
| Runtime checks (hasCapability)           | Verbose; requires if-guards in handlers                        |
| **Throw upfront if plugin missing**      | ✅ Clear error at startup; guaranteed availability in handlers |

---

## Consequences

### Positive

- ✅ **Simple handlers**: Minimal noise; typical cases are `ctx.send(schema, data)` with no await
- ✅ **Powerful composability**: Opt-in async (`{waitFor}`) unlocks backpressure, metrics, confirmation without complicating base API
- ✅ **Safe by default**: Type system enforces RPC sequencing; no duplicate `.reply()` calls
- ✅ **Observable**: Errors and metrics visible through events/results; handler flow never interrupted
- ✅ **Testable**: Sync methods are easy to mock; async results are inspectable
- ✅ **Scalable**: Async pub/sub doesn't block; distributed systems can coordinate via result.capability

### Negative

- **Learning curve**: Developers must understand sync vs async distinction; mitigate with examples and docs
- **Eventual consistency**: Distributed pub/sub results are eventually consistent; mitigate with `partitionKey` and `waitFor: 'settled'`
- **Opt-in async complexity**: `{waitFor}` adds surface area; most users won't need it

### Risks

- **Silent backpressure**: If developer ignores `waitFor`, high-throughput handlers may lose messages; mitigate with monitoring and docs
- **Distributed race conditions**: Pub/sub can have partial delivery or ordering issues; mitigate with adapter guarantees and `partitionKey`

### Event Correlation Helper: `{inheritCorrelationId: true}` Option

**Rationale**: Event handlers sometimes need to respond with acknowledgments for correlated messages (e.g., optional acks for tracing/observability). The RPC design (ADR-015) auto-preserves `correlationId` in `.reply()` and `.progress()` via `baseMeta()`, but event handlers (`.send()`) lack this convenience. The `{inheritCorrelationId: true}` option on `SendOptions` fills this gap without introducing RPC semantics.

**Design**: Lightweight opt-in flag that auto-copies `ctx.meta.correlationId` to outgoing meta if present. Graceful no-op if no correlation ID (silent, not an error). Fully composable with other options (`meta`, `waitFor`, `signal`).

**Use Cases**:

- Acknowledging fire-and-forget events that request optional acks
- Tracing/observability: client includes correlationId, server echoes it back
- Best-effort round-trips: no guarantee client receives ack, unlike RPC (which uses one-shot guard)

**Benefits**:

- ✅ **Zero API bloat**: Adds single boolean option, not a new method
- ✅ **Composable**: Works with `meta`, `waitFor`, `signal` without forcing manual copy
- ✅ **Respects event/RPC boundary**: No new semantics, purely convenience for correlation preservation
- ✅ **Low implementation cost**: ~20 LOC in plugin, reuses `.send()` validation chain
- ✅ **Easy deprecation**: If unused, can mark deprecated and retire in next major version
- ✅ **Self-documenting**: Name clearly indicates "preserve the correlation ID from request"

**When NOT to Use**: If you need guaranteed request-response semantics, use `router.rpc()` and `ctx.reply()` (provides one-shot guard, deadlines, client-side integration).

---

## Alternatives Considered

### 1. All Async (Everything Returns Promise)

```typescript
ctx.send(schema, payload)  // → Promise<void>
ctx.reply(payload)         // → Promise<void>
ctx.publish(topic, ...)    // → Promise<PublishResult>
```

**Pros**: Single mental model (always await); eliminates return-type overloading complexity at compile-time
**Cons**:

- Noise for 90% of unicast cases (fire-and-forget doesn't need confirmation)
- Unnecessary Promise allocations for zero-async-work sends
- Return-type overloading trade-off: Current design trades the cognitive load of overloading for minimal boilerplate in the happy path. If metrics show developers find overloading more confusing than `await` noise, this should be revisited (see Future Considerations).
- Latency penalty from awaiting sends that complete synchronously
  **Rejected**: Overkill for unicast; type safety via schema-driven inference mitigates overloading confusion in practice

### 2. All Sync (Everything Returns void)

```typescript
ctx.publish(topic, ...)    // → void (no observability)
```

**Pros**: Simplicity; no awaits
**Cons**: Can't do distributed pub/sub; blocks on I/O; no metrics or error feedback
**Rejected**: Unscalable for broadcast

### 3. Throws for Runtime Errors

```typescript
try {
  ctx.send(schema, data);
} catch (e) {
  // Handle connection closed, backpressure, etc.
}
```

**Pros**: Familiar error handling pattern
**Cons**: Breaks handler flow; exception-based control is error-prone; handlers crash on I/O
**Rejected**: Not composable; violates principle that I/O failures shouldn't crash handler

### 4. No Opt-In Async (No `{waitFor}` option)

```typescript
ctx.send(schema, data); // Always void; no way to wait for drain
```

**Pros**: Simpler API
**Cons**: Can't handle backpressure; no way to observe delivery in critical paths
**Rejected**: Loses power; forces wrappers for advanced cases

### 5. Always Use Result Objects

```typescript
const result = ctx.send(schema, data); // → {ok: boolean, error?: string}
```

**Pros**: Consistent error handling
**Cons**: Every send requires null-check; noisy; most sends succeed (result checking is waste)
**Rejected**: Terrible DX for happy path

---

## Implementation Notes

### Plugin Gating

Each method checks for required plugin at module load:

```typescript
// In @ws-kit/core/src/handler/context.ts
class HandlerContext<T> {
  send(schema, payload, opts) {
    // Always available; no check needed
    return this.ws.send(JSON.stringify(...));
  }

  reply(payload, opts) {
    if (!this.router.pluginHost.hasCapability('validator')) {
      throw new Error('reply() requires validation plugin (withZod/withValibot)');
    }
    // ...
  }

  progress(update, opts) {
    if (!this.router.pluginHost.hasCapability('validator')) {
      throw new Error('progress() requires validation plugin');
    }
    // ...
  }

  publish(topic, schema, payload, opts) {
    if (!this.router.pluginHost.hasCapability('pubsub')) {
      throw new Error('publish() requires pubsub plugin (withPubSub)');
    }
    // ...
  }
}
```

This fail-fast approach at module load ensures missing plugins are caught during startup (e.g., tests or boot), guaranteeing method availability in handlers without runtime guards or fallbacks.

### Type-Level RPC Enforcement

`.reply()` and `.progress()` are only typed when inside `.rpc()` handler. Attempting them in `.on()` fails at compile time.

### Optional Metadata

All methods accept `meta` for tracing, correlation, and custom context:

```typescript
ctx.send(Msg, data, { meta: { traceId: req.headers.get("x-trace-id") } });
```

### Validation

All methods validate payloads at dev time (compile-time types + runtime validation plugin). Never at runtime (throws only in dev).

---

## References

- **ADR-015**: RPC API design (rationale for `.reply()` vs `.send()`)
- **ADR-014**: RPC client-side design (`.request()` pattern)
- **ADR-020**: Method naming (send vs publish rationale)
- **ADR-028**: Plugin architecture (capability gating)
- **docs/specs/context-methods.md**: Full implementation specification
- **docs/specs/error-handling.md**: Error codes and patterns
- **docs/specs/pubsub.md**: Pub/sub guarantees and patterns
- **docs/specs/router.md**: Handler registration and middleware

---

## Future Considerations

1. **Backpressure Middleware**: Framework-level rate limiting based on socket buffer state
2. **Correlation IDs**: Auto-injection of tracing IDs into meta
3. **Metrics**: Built-in observability for send/reply/publish counts and latencies
4. **Batch Publishing**: `ctx.publishBatch(topic, messages)` for efficiency
5. **Partial Replay**: Resuming failed publishes after handler restarts
6. **Response Caching**: Optional caching of RPC responses for deduplication
7. **Revisit "Always Async" for Unicast**: Monitor real-world usage and adopter feedback. If return-type overloading (`void | Promise<boolean>`) proves more confusing than the `await` noise it eliminates, consider shifting unicast methods to always-async. Triggers for reconsideration:
   - User error reports about forgetting `await` on `{waitFor}` in async contexts
   - Type confusion in IDE tooltips or type checking
   - Patterns emerging where sync-first introduces subtle bugs

   Data to collect: % of `{waitFor}` usage, handler complexity metrics from tests/examples, feedback from adopter projects. No change without evidence—current design is pragmatic and well-reasoned.

These are future enhancements; the current design is sufficient for production use.
