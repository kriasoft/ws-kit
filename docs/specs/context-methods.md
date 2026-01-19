# Context Methods Specification

**Status**: ✅ Implemented

This specification defines the complete API for context methods in handlers: `.send()`, `.reply()`, `.error()`, `.progress()`, `.publish()`.

For **rationale and design decisions**, see [ADR-030: Context Methods Design](../adr/030-context-methods-design.md). For **sync-first trade-offs** (return-type overloading vs always-async), see [Alternatives Considered](../adr/030-context-methods-design.md#alternatives-considered).

## Section Map

Quick navigation for developers and AI tools:

- [#Overview](#overview) — Big picture: unicast, broadcast, RPC patterns
- [#Method-Reference](#method-reference) — Full API signature and behavior for each method
- [#Error-Handling](#error-handling) — Dev-time vs runtime errors
- [#Type-Inference](#type-inference) — How schema types flow through handlers
- [#Plugin-Dependencies](#plugin-dependencies) — Which plugins enable each method
- [#Async-Patterns](#async-patterns) — When and how to use `{waitFor}`
- [#Pub-Sub-Guarantees](#pub-sub-guarantees) — Local vs distributed delivery semantics
- [#Examples](#examples) — Real-world handler patterns
- [#Full-Signatures](#full-signatures) — Copy-paste ready type definitions

## Overview

The context object (`ctx`) passed to every handler provides five core methods for sending/broadcasting messages:

| Method            | Scope     | Pattern                               | Async           |
| ----------------- | --------- | ------------------------------------- | --------------- |
| **`.send()`**     | 1-to-1    | Fire-and-forget to current connection | Sync by default |
| **`.reply()`**    | 1-to-1    | Terminal RPC response (success)       | Sync by default |
| **`.error()`**    | 1-to-1    | Terminal RPC response (failure)       | Sync by default |
| **`.progress()`** | 1-to-1    | Non-terminal RPC streaming            | Sync by default |
| **`.publish()`**  | 1-to-many | Broadcast to topic subscribers        | Always async    |

### Design Principles

1. **Sync-first for unicast** — Minimal latency, simple DX (`ctx.send(schema, data)` with no await)
2. **Async for broadcast** — Non-blocking coordination in distributed systems
3. **Opt-in async** — Unicast methods accept `{waitFor}` for backpressure control, confirmation
4. **No runtime throws** — Errors via `onError` events or result objects; only dev-time throws
5. **Plugin gating** — Methods throw upfront (module load) if required plugin missing

### When to Use Each Method

**Use `.send()` for**:

- Notifications, state updates, acknowledgments
- Fire-and-forget messaging (no response expected)
- One-way commands to client

**Use `.reply()` for**:

- RPC success responses (inside `.rpc()` handlers only)
- Sending result back to client request
- Terminal: call exactly once per RPC (or after `.progress()`)

**Use `.error()` for**:

- RPC error responses (inside `.rpc()` handlers only)
- Sending application-level failures (e.g., "NOT_FOUND", "PERMISSION_DENIED")
- Terminal: call exactly once per RPC (symmetric with `.reply()`)
- One-shot guard: prevents duplicate or mixed terminals (success then error, or vice versa)

**Use `.progress()` for**:

- Streaming long-running RPC operations
- Sending multiple non-terminal updates before final response
- Can precede either `.reply()` (success) or `.error()` (failure) as terminal marker

**Use `.publish()` for**:

- Broadcasting to multiple subscribers
- Events, notifications, state changes to topic
- Always `await` and check `result.ok` for critical operations

---

## Method Reference

### ctx.send(schema, payload, opts?)

Sends a one-way message to the current connection.

#### Signature

```typescript
send<T>(schema: Schema<T>, payload: T, opts?: SendOptionsSync): void;
send<T>(schema: Schema<T>, payload: T, opts: SendOptionsAsync): Promise<boolean>;

interface SendOptionsBase {
  signal?: AbortSignal;             // Cancel before send
  meta?: Record<string, any>;       // Custom metadata
  inheritCorrelationId?: boolean;   // Auto-copy correlationId from request if present (default: false)
}

interface SendOptionsSync extends SendOptionsBase {
  waitFor?: undefined;
}

interface SendOptionsAsync extends SendOptionsBase {
  waitFor: 'drain' | 'ack';         // Make async; wait for buffer/ack
}

type SendOptions = SendOptionsSync | SendOptionsAsync;
```

#### Parameters

- **`schema: Schema<T>`** — Message schema (defines type field and payload shape)
  - Created via `message()` helper from `@ws-kit/zod` or `@ws-kit/valibot`
  - Example: `const PongMsg = message("PONG", { reply: z.string() })`

- **`payload: T`** — Message data
  - Type-checked against schema at compile time
  - Example: `{ reply: "pong" }`

- **`opts?: SendOptions`** — Optional configuration
  - `signal`: Cancel the send (if not yet enqueued)
  - `waitFor`: Make the method async; wait for buffer drain or server ack
  - `meta`: Attach custom metadata (tracing, correlation IDs)
  - `inheritCorrelationId`: Auto-copy `correlationId` from inbound `ctx.meta` to outgoing message if present (default: false)

#### Returns

- **`void`** (default) — Method returns immediately; fire-and-forget
- **`Promise<boolean>`** (if `waitFor` specified) — Returns when condition met
  - `true`: Buffer drained or ack received
  - `false`: Timeout or socket closed

#### Behavior

| Scenario                               | Result                                                |
| -------------------------------------- | ----------------------------------------------------- |
| Connection open, no waitFor            | Enqueues immediately; returns void                    |
| Connection open, waitFor='drain'       | Returns Promise; resolves when buffer empty           |
| Connection open, waitFor='ack'         | Returns Promise; resolves when server acks            |
| Connection closed                      | Fires `onError` event; message dropped                |
| Backpressure (buffer full, no waitFor) | Message queued; may drop if buffer exceeds limit      |
| Invalid payload                        | Throws during dev (type/validation); never at runtime |
| Signal aborts                          | Cancels if not yet sent                               |

#### Error Modes

| Error             | Category | When                             | Handling                                                |
| ----------------- | -------- | -------------------------------- | ------------------------------------------------------- |
| Type mismatch     | Dev-Time | Compile time (TypeScript)        | TypeScript catches `{reply: 123}` when expecting string |
| Validation fails  | Dev-Time | Module load or handler call      | Throws; app must fix payload                            |
| Socket closed     | Runtime  | `onError` event                  | Handler continues; log/monitor                          |
| Timeout (waitFor) | Runtime  | Promise rejects or returns false | Check return value; retry if needed                     |

#### Examples

**Basic fire-and-forget** (most common):

```typescript
router.on(PingMsg, (ctx) => {
  ctx.send(PongMsg, { reply: "pong" });
  // Returns immediately; no await needed
});
```

**Wait for buffer drain** (backpressure):

```typescript
router.on(LargeDataMsg, async (ctx) => {
  const sent = await ctx.send(FileDataMsg, largeBuffer, {
    waitFor: "drain",
  });

  if (!sent) {
    console.warn("Buffer full; client may be slow");
    // Optionally backoff or escalate
  }
});
```

**Cancellable send**:

```typescript
router.on(SlowMsg, async (ctx) => {
  const controller = new AbortController();

  // Cancel if not sent within 5 seconds
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    await ctx.send(Msg, data, {
      waitFor: "drain",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
});
```

**With metadata** (tracing):

```typescript
ctx.send(Msg, payload, {
  meta: {
    traceId: req.headers.get("x-trace-id"),
    sendTime: Date.now(),
  },
});
```

**Correlated acknowledgment** (echo correlation ID):

```typescript
// Client: Fire-and-forget with optional ack request
conn.send(UserAction, {
  correlationId: crypto.randomUUID(), // Request optional ack
  userId: "user-123",
  action: "created",
});

// Server: Acknowledge with auto-preserved correlation
router.on(UserAction, async (ctx) => {
  await processEvent(ctx.payload);

  // Client optionally requested an ack via correlationId
  if (ctx.meta.correlationId) {
    ctx.send(AckMsg, { success: true }, { inheritCorrelationId: true });
    // ✅ correlationId auto-copied to outgoing meta
  }
});

// Equivalent to (but without manual copy):
// ctx.send(AckMsg, { success: true }, {
//   meta: { correlationId: ctx.meta.correlationId }
// });
```

---

### ctx.reply(payload, opts?)

Sends a terminal response in an RPC handler.

#### Signature

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

#### Parameters

- **`payload: T`** — Response data
  - Type-checked against RPC response schema
  - Example: `{ id: user.id, name: user.name }`

- **`opts?: ReplyOptions`** — Same as SendOptions

#### Returns

- **`void`** (default) — Returns immediately
- **`Promise<void>`** (if `waitFor` specified) — Resolves when condition met

#### Behavior

| Scenario                            | Result                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inside `.rpc()` handler, first call | Sends response; client's Promise resolves                                                                                                                          |
| Second call to `.reply()`           | Ignored by one-shot guard (optional dev-mode log); see [ADR-030: Terminal Semantics](../adr/030-context-methods-design.md#terminal-semantics-one-shot-reply-guard) |
| After `.progress()` call            | Valid; marks end of streaming                                                                                                                                      |
| Outside `.rpc()` handler            | Throws error at runtime                                                                                                                                            |
| Connection closed                   | Fires `onError`; client's Promise rejects                                                                                                                          |

#### Error Modes

| Error                 | Category | When         | Handling                                                                                     |
| --------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------- |
| Called outside .rpc() | Dev-Time | Handler call | Throws: "reply() requires RPC context"                                                       |
| Called twice          | Runtime  | Second call  | Ignored by one-shot guard (optional dev-mode log); type system helps prevent at compile time |
| Invalid payload       | Dev-Time | Compile time | TypeScript catches schema mismatch                                                           |
| Socket closed         | Runtime  | Async        | onError event; client rejects                                                                |

#### Examples

**Simple RPC response**:

```typescript
const GetUserMsg = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

router.rpc(GetUserMsg, (ctx) => {
  // ctx.payload: { id: string } ✅ Inferred from request schema
  const user = db.get(ctx.payload.id);

  // Returns immediately; client Promise resolves
  ctx.reply({
    id: user.id,
    name: user.name,
  });
  // Type: { id: string; name: string } ✅ Must match response schema
});

// Client side
const user = await client.request(GetUserMsg, { id: "123" });
console.log(user); // { id: "123", name: "Alice" }
```

**With async streaming** (progress then reply):

```typescript
const ProcessFileMsg = rpc(
  "PROCESS_FILE",
  { path: z.string() },
  "FILE_PROCESSED",
  { processed: z.number() },
);

router.rpc(ProcessFileMsg, async (ctx) => {
  const file = await readFile(ctx.payload.path);

  // Send progress updates (non-terminal)
  for (const chunk of file.chunks) {
    ctx.progress({ processed: chunk.size });
  }

  // Terminal response (after progress)
  ctx.reply({ processed: file.totalSize });
});

// Client side
client.request(ProcessFileMsg, { path: "/data.csv" }).then(
  (result) => console.log("Complete:", result), // .reply
  (error) => console.error("Error:", error), // Connection error
  (update) => updateProgressBar(update.processed), // .progress
);
```

**Wait for server-side confirmation** (rare):

```typescript
router.rpc(CriticalMsg, async (ctx) => {
  // Process and reply, waiting for server to confirm delivery
  await ctx.reply({ status: "ok" }, { waitFor: "ack" });

  // Only reaches here after server ack (rare pattern)
  console.log("Client received response");
});
```

---

### ctx.error(code, message, details?, opts?)

Sends a terminal application-level error response in an RPC handler.

#### Signature

```typescript
error<T = unknown>(
  code: string,               // Standardized error code (e.g., "NOT_FOUND", "PERMISSION_DENIED")
  message: string,            // Human-readable error description
  details?: T,                // Optional structured error details (type-inferred)
  opts?: ReplyOptions,        // Reuse: signal, waitFor, meta
): void | Promise<void>;

interface ReplyOptions {
  signal?: AbortSignal;
  waitFor?: 'drain' | 'ack';
  meta?: Record<string, any>;
}
```

#### Parameters

- **`code: string`** — Standardized error code
  - Examples: `"NOT_FOUND"`, `"PERMISSION_DENIED"`, `"VALIDATION_ERROR"`, `"TEMPORARY_ERROR"`
  - Used by client-side to distinguish retryable errors from fatal ones

- **`message: string`** — Human-readable error description
  - Example: `"User not found"`, `"Permission denied"`, `"Service unavailable"`

- **`details?: T`** — Optional structured error details
  - Type-checked against handler context (schema-inferred if defined)
  - Example: `{ id: "123", field: "email", reason: "Already exists" }`

- **`opts?: ReplyOptions`** — Same as `.reply()` options
  - `signal`: Cancel before send
  - `waitFor`: Make async; wait for buffer drain or ack
  - `meta`: Custom metadata

#### Returns

- **`void`** (default) — Method returns immediately; error enqueued
- **`Promise<void>`** (if `waitFor` specified) — Resolves when condition met

#### Behavior

| Scenario                            | Result                                                         |
| ----------------------------------- | -------------------------------------------------------------- |
| Inside `.rpc()` handler, first call | Sends error response; client's Promise rejects with `RpcError` |
| After `.reply()` call               | Suppressed (no-op); logged in dev mode (one-shot guard)        |
| Second call to `.error()`           | Suppressed (no-op); logged in dev mode (one-shot guard)        |
| After `.progress()` call            | Valid; marks end of streaming with error terminal              |
| Outside `.rpc()` handler            | Throws error at runtime                                        |
| Connection closed                   | Fires `onError` event; client's Promise rejects                |

#### Error Modes

| Error                 | Category | When         | Handling                                                               |
| --------------------- | -------- | ------------ | ---------------------------------------------------------------------- |
| Called outside .rpc() | Dev-Time | Handler call | Throws: "error() requires RPC context"                                 |
| Called after .reply() | Runtime  | Handler call | Ignored by one-shot guard (optional dev-mode log)                      |
| Called after terminal | Runtime  | Handler call | Ignored by one-shot guard (optional dev-mode log); first terminal wins |
| Invalid details       | Dev-Time | Compile time | TypeScript catches schema mismatch                                     |
| Socket closed         | Runtime  | Async        | onError event; client rejects                                          |

#### Examples

**Simple error response**:

```typescript
const GetUserMsg = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

router.rpc(GetUserMsg, (ctx) => {
  const user = db.get(ctx.payload.id);

  if (!user) {
    return ctx.error("NOT_FOUND", "User not found", { id: ctx.payload.id });
  }

  ctx.reply({ id: user.id, name: user.name });
});

// Client side
try {
  const user = await client.request(GetUserMsg, { id: "999" });
} catch (error) {
  if (error.code === "NOT_FOUND") {
    console.log("User does not exist");
  }
}
```

**Error with details and retry hint**:

```typescript
router.rpc(FetchDataMsg, async (ctx) => {
  try {
    const data = await externalApi.fetch(ctx.payload.url);
    ctx.reply({ data });
  } catch (err) {
    if (err.isNetworkError) {
      // Retryable: client should backoff and retry
      return ctx.error("TEMPORARY_ERROR", "Service temporarily unavailable", {
        retryAfterMs: 5000,
      });
    }
    // Fatal: don't retry
    ctx.error("INVALID_URL", "URL is invalid or unreachable", {
      url: ctx.payload.url,
      reason: err.message,
    });
  }
});
```

**Permission-based error**:

```typescript
router.rpc(DeleteUserMsg, (ctx) => {
  if (!ctx.data.roles?.includes("admin")) {
    return ctx.error("PERMISSION_DENIED", "Only admins can delete users");
  }

  db.deleteUser(ctx.payload.id);
  ctx.reply({ success: true });
});
```

**Validation error with structured details**:

```typescript
const CreateUserMsg = rpc(
  "CREATE_USER",
  { email: z.string().email(), name: z.string() },
  "USER_CREATED",
  { id: z.string() },
);

router.rpc(CreateUserMsg, async (ctx) => {
  // Custom validation (beyond schema)
  const errors: Record<string, string> = {};

  if (await db.userExists(ctx.payload.email)) {
    errors.email = "Email already registered";
  }

  if (ctx.payload.name.length < 2) {
    errors.name = "Name must be at least 2 characters";
  }

  if (Object.keys(errors).length > 0) {
    return ctx.error("VALIDATION_ERROR", "Invalid input", { errors });
  }

  const user = await db.createUser(ctx.payload);
  ctx.reply({ id: user.id });
});
```

**Wait for confirmation** (rare, like `.reply()`):

```typescript
router.rpc(CriticalMsg, async (ctx) => {
  if (validation.failed(ctx.payload)) {
    // Wait for client to acknowledge critical error
    await ctx.error("VALIDATION_ERROR", "Invalid input",
      { errors: [...] },
      { waitFor: 'ack' }
    );
  } else {
    ctx.reply({ ok: true });
  }
});
```

---

### ctx.progress(update, opts?)

Sends non-terminal updates in an RPC streaming handler.

#### Signature

```typescript
progress<T>(
  update: T,
  opts?: ProgressOptions,
): void | Promise<void>;

interface ProgressOptions {
  signal?: AbortSignal;
  waitFor?: 'drain' | 'ack';
  meta?: Record<string, any>;
  throttleMs?: number;  // Rate-limit rapid updates
}
```

#### Parameters

- **`update: T`** — Progress data
  - Type-checked against RPC progress schema (if defined)

- **`opts?.throttleMs: number`** — Optional rate limiting
  - Example: `{throttleMs: 100}` batches updates; max 10 per second
  - Useful for high-frequency updates (animations, sensor data)

#### Returns

- **`void`** (default) — Returns immediately
- **`Promise<void>`** (if `waitFor` specified) — Resolves when condition met

#### Behavior

| Scenario                           | Result                                               |
| ---------------------------------- | ---------------------------------------------------- |
| Inside `.rpc()`, before `.reply()` | Sends update; client receives in onProgress callback |
| Multiple calls                     | All sent (or throttled if throttleMs set)            |
| After `.reply()`                   | Ignored by one-shot guard (optional dev-mode log)    |
| Outside `.rpc()`                   | Throws error                                         |

#### Error Modes

| Error                 | Category | When         | Handling                                          |
| --------------------- | -------- | ------------ | ------------------------------------------------- |
| Called outside .rpc() | Dev-Time | Handler call | Throws: "progress() requires RPC context"         |
| Called after .reply() | Runtime  | Handler call | Ignored by one-shot guard (optional dev-mode log) |
| Invalid payload       | Dev-Time | Compile time | TypeScript catches schema mismatch                |

#### Examples

**Streaming large response**:

```typescript
const DownloadMsg = rpc("DOWNLOAD_FILE", { fileId: z.string() }, "FILE_CHUNK", {
  chunk: z.instanceof(Buffer),
  offset: z.number(),
});

router.rpc(DownloadMsg, async (ctx) => {
  const chunks = await loadFileChunks(ctx.payload.fileId);

  for (const chunk of chunks) {
    ctx.progress({
      chunk: chunk.data,
      offset: chunk.offset,
    });
  }

  ctx.reply({ totalSize: chunks.totalSize });
});

// Client side: collect chunks
const chunks = [];
client.request(DownloadMsg, { fileId: "123" }).then(
  (result) => {
    // Assemble final file
    const file = Buffer.concat(chunks);
    console.log("Download complete:", file.length);
  },
  undefined,
  (update) => chunks.push(update.chunk), // Collect each chunk
);
```

**Throttled updates** (animations, sensor data):

```typescript
const LiveGraphicsMsg = rpc(
  "RENDER_FRAME",
  { frameCount: z.number() },
  "FRAME_RENDERED",
  { total: z.number() },
);

router.rpc(LiveGraphicsMsg, async (ctx) => {
  // Render many frames; throttle updates to 10/sec
  for (let i = 0; i < ctx.payload.frameCount; i++) {
    ctx.progress({ frame: i }, { throttleMs: 100 });

    // Actual rendering work...
    await renderFrame(i);
  }

  ctx.reply({ total: ctx.payload.frameCount });
});
```

**Processing with progress metrics**:

```typescript
router.rpc(BulkImportMsg, async (ctx) => {
  const items = await loadItems(ctx.payload.importId);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await processItem(item);

    ctx.progress({
      processed: i + 1,
      total: items.length,
      percentage: Math.round(((i + 1) / items.length) * 100),
    });
  }

  ctx.reply({ importedCount: items.length });
});
```

---

### ctx.publish(topic, schema, payload, opts?)

Broadcasts a message to all subscribers of a topic.

#### Signature

```typescript
publish<T>(
  topic: string,
  schema: Schema<T>,
  payload: T,
  opts?: PublishOptions,
): Promise<PublishResult>;

interface PublishResult {
  ok: boolean;
  error?: string;                    // Error code if failed
  matched?: number;                  // Approx subscribers reached
  capability: 'local' | 'distributed' | 'partial';  // Delivery guarantee
}

interface PublishOptions {
  signal?: AbortSignal;
  excludeSelf?: boolean;             // Default: false (memory/Redis; Bun: UNSUPPORTED)
  partitionKey?: string;             // For distributed consistency
  waitFor?: 'enqueued' | 'settled';  // Default: 'enqueued'
  meta?: Record<string, any>;
}
```

#### Parameters

- **`topic: string`** — Topic name
  - Pattern-based; format depends on adapter (e.g., `users:*`, `room:123:chat`)
  - Subscribers must match pattern exactly

- **`schema: Schema<T>`** — Message schema
  - Same as `.send()`; defines payload shape

- **`payload: T`** — Broadcast data

- **`opts?: PublishOptions`** — Configuration:
  - `excludeSelf`: Don't send to current connection (default: false)
  - `partitionKey`: For distributed systems; ensures order within partition
  - `waitFor`: `'enqueued'` (fast, default) or `'settled'` (certain)
  - `signal`: Cancel before publish starts

#### Returns

**Always `Promise<PublishResult>`**:

```typescript
interface PublishResult {
  ok: boolean; // Success flag
  error?: string; // Error code if !ok
  // 'INVALID_PAYLOAD', 'ADAPTER_ERROR', etc.
  matched?: number; // Approx count of subscribers reached
  capability: string; // 'local' = definite
  // 'distributed' = eventual
  // 'partial' = some failed
}
```

#### Behavior

| Scenario                       | Result                                          |
| ------------------------------ | ----------------------------------------------- |
| Successful publish, local      | `{ok: true, matched: 5, capability: 'local'}`   |
| No subscribers                 | `{ok: true, matched: 0, capability: 'local'}`   |
| Validation fails               | `{ok: false, error: 'INVALID_PAYLOAD'}`         |
| Adapter error                  | `{ok: false, error: 'ADAPTER_ERROR'}`           |
| Partial delivery (distributed) | `{ok: true, matched: 3, capability: 'partial'}` |
| Missing `withPubSub()` plugin  | Throws at module load time                      |

#### Error Modes

| Error            | Category | When                       | Handling                               |
| ---------------- | -------- | -------------------------- | -------------------------------------- |
| No pubsub plugin | Dev-Time | Module load                | Throws: "PubSub plugin required"       |
| Validation fails | Dev-Time | Compile time or validation | Throws or returns `{ok: false}`        |
| Adapter failure  | Runtime  | Async                      | Returns `{ok: false, error: '...'}`    |
| Signal aborts    | Runtime  | If abort before publish    | Returns or rejects (adapter-dependent) |

#### Examples

**Basic broadcast** (fire-and-forget):

```typescript
router.on(UserJoinedMsg, async (ctx) => {
  // Notify all subscribers of users:online topic
  const res = await ctx.publish("users:online", UserStatusMsg, {
    userId: ctx.data.userId,
    action: "joined",
  });

  console.log(`Notified ${res.matched} subscribers`);
});
```

**Exclude self** (common in chat/rooms):

```typescript
router.on(ChatMessageMsg, async (ctx) => {
  // Broadcast to everyone except sender
  await ctx.publish("room:123:chat", ChatMsg, ctx.payload, {
    excludeSelf: true,
  });

  // Optionally echo back to sender separately
  ctx.send(ChatAckMsg, { id: ctx.payload.id });
});
```

**Critical path with settlement waiting**:

```typescript
router.on(PaymentMsg, async (ctx) => {
  const txn = processTransaction(ctx.payload);

  // Wait for settlement in critical systems
  const res = await ctx.publish("payments:processed", TxnEvent, txn, {
    waitFor: "settled",
    partitionKey: ctx.data.userId, // Ensures order per user
  });

  if (!res.ok) {
    // Handle failure: log, alert, retry, etc.
    ctx.send(ErrorMsg, { reason: res.error });
    await escalateToAdmin(txn);
  } else if (res.capability === "partial") {
    // Some subscribers got the message; some didn't
    await logPartialFailure(txn, res);
  }
});
```

**Cancellable with timeout**:

```typescript
router.on(TimeoutMsg, async (ctx) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await ctx.publish("events:broadcast", EventMsg, data, {
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn("Publish failed or timed out:", res.error);
    }
  } finally {
    clearTimeout(timeout);
  }
});
```

**Distributed system with partition key**:

```typescript
router.on(OrderMsg, async (ctx) => {
  const order = await createOrder(ctx.payload);

  // Partition by user: all orders for same user stay ordered
  const res = await ctx.publish("orders:created", OrderEvent, order, {
    partitionKey: ctx.data.userId,
    waitFor: "settled", // Ensure distributed consistency
  });

  if (res.ok) {
    ctx.send(OrderConfirmMsg, { orderId: order.id });
  } else {
    ctx.send(ErrorMsg, { message: "Failed to create order" });
  }
});
```

---

## Error Handling

For stateful pub/sub mutations integrated with `.publish()`, see the "Mutations throw, actions return" principle in [docs/specs/pubsub.md](./pubsub.md); the context methods here focus on the "actions return/event" side for transient operations.

### Dev-Time Errors (Throws)

These errors occur during development and must be fixed before deployment:

| Error              | Location                  | Example                                                 | Fix                                   |
| ------------------ | ------------------------- | ------------------------------------------------------- | ------------------------------------- |
| Type mismatch      | Compile time (TypeScript) | `ctx.send(Msg, {id: 123})` when schema expects `string` | Fix payload to match schema           |
| Validation failure | Module load or handler    | Schema validation rejects payload                       | Ensure payload matches schema rules   |
| API misuse         | Handler execution         | Calling `.reply()` outside `.rpc()`                     | Only call in `.rpc()` handlers        |
| Duplicate reply    | Handler execution         | Calling `.reply()` twice in same handler                | Call only once per RPC                |
| Missing plugin     | Module load               | Calling `.publish()` without `withPubSub()`             | Add `.plugin(withPubSub())` to router |

**Error handling strategy**: These are invariant violations. Fix your code; don't try to recover.

### Runtime Errors (No Throw)

These errors occur during operation (I/O, network, adapter failures) and don't throw:

| Error             | Reporting                | Example                     | Response                           |
| ----------------- | ------------------------ | --------------------------- | ---------------------------------- |
| Connection closed | `onError` event          | Client disconnects mid-send | Handler continues; message dropped |
| Adapter failure   | Result object (publish)  | Redis unavailable           | Check `result.ok`                  |
| Backpressure      | Opt-in `waitFor` return  | Large message, slow client  | Returns false; app decides action  |
| Signal aborted    | Promise rejects (varies) | Timeout during publish      | Catch and handle                   |

**Error handling strategy**: Log, monitor, optionally retry or escalate. Handler never crashes.

---

## Type Inference

### Handler Context Types

When you register a handler with `.on()` or `.rpc()`, the context type includes full type information:

```typescript
// Event handler: fire-and-forget
router.on(MyMsg, (ctx: HandlerContext<ConnectionData, MyPayloadType>) => {
  ctx.payload; // ✅ Type: MyPayloadType
  ctx.data; // ✅ Type: ConnectionData
  ctx.send(); // ✅ Type-safe send
  ctx.publish(); // ✅ Type-safe publish
});

// RPC handler: request-response
router.rpc(
  GetData,
  (ctx: RpcContext<ConnData, ReqType, RespType, ProgType>) => {
    ctx.payload; // ✅ Type: ReqType
    ctx.reply(); // ✅ Type: RespType
    ctx.progress(); // ✅ Type: ProgType
  },
);
```

### Schema-Driven Payload Typing

Payload types are **fully inferred** from your schema definition:

```typescript
import { z, message } from "@ws-kit/zod";

// Define message with schema
const UserMsg = message("USER", {
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Handler receives fully typed payload
router.on(UserMsg, (ctx) => {
  // ctx.payload is inferred as:
  // { id: string; name: string; email: string }

  ctx.payload.id; // ✅ string
  ctx.payload.role; // ❌ Error: property doesn't exist
});

// Sending is also type-safe
ctx.send(UserMsg, {
  id: "123",
  name: "Alice",
  email: "alice@example.com",
}); // ✅ OK

ctx.send(UserMsg, {
  id: "123",
  name: "Alice",
}); // ❌ Error: missing email
```

### Connection Data Typing

Define custom connection data via module augmentation (once, globally):

```typescript
// Typically in src/types.ts or router setup
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    roles?: string[];
    sessionId?: string;
  }
}

// Now all handlers see typed connection data
router.on(SomeMsg, (ctx) => {
  ctx.data.userId; // ✅ string | undefined
  ctx.data.roles; // ✅ string[] | undefined
  ctx.data.unknown; // ❌ Error: property doesn't exist
});
```

---

## Plugin Dependencies

Each method requires specific plugins to function:

| Method        | Plugin Required                            | Error if Missing                             | Behavior                                                                                                                                                                       |
| ------------- | ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.send()`     | **None**                                   | N/A                                          | Always available; no plugin needed                                                                                                                                             |
| `.reply()`    | **Validator** (`withZod` or `withValibot`) | Throws: "validation plugin required for RPC" | Only available in `.rpc()` with validator; one-shot guard enforced automatically (see [ADR-030](../adr/030-context-methods-design.md#terminal-semantics-one-shot-reply-guard)) |
| `.progress()` | **Validator**                              | Throws: "validation plugin required for RPC" | Only available in `.rpc()` with validator                                                                                                                                      |
| `.publish()`  | **PubSub** (`withPubSub`)                  | Throws: "PubSub plugin required"             | Only available if plugin applied                                                                                                                                               |

**Note on RPC Safety**: The one-shot guard (preventing duplicate `.reply()` and `.error()` calls) is automatically enforced by the router for all RPC handlers. See [ADR-030: Terminal Semantics](../adr/030-context-methods-design.md#terminal-semantics-one-shot-reply-guard) for detailed behavior and examples.

**Note on Plugin Gating**: Methods fail at startup if plugins are missing, ensuring handlers can safely assume availability and avoiding verbose runtime checks. This is a design feature—missing configuration is caught early rather than discovered mid-handler.

### Setup Example

```typescript
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { redisPubSub } from "@ws-kit/redis";
import { createClient } from "redis";

const redis = createClient();
await redis.connect();

const router = createRouter<ConnectionData>()
  // Validator plugin (required for .rpc, .reply, .progress)
  // ✅ Automatically applied by @ws-kit/zod

  // PubSub plugin (required for .publish)
  .plugin(withPubSub({ adapter: redisPubSub(redis) }));

// Now all methods are available
router.on(SomeMsg, (ctx) => {
  ctx.send(); // ✅ Always available
  ctx.publish(); // ✅ Available (withPubSub applied)
});

router.rpc(GetData, (ctx) => {
  ctx.reply(); // ✅ Available (validator applied)
  ctx.progress(); // ✅ Available (validator applied)
  ctx.publish(); // ✅ Available (withPubSub applied)
});
```

---

## Async Patterns

### When to Use Sync (Default)

```typescript
// Most common: fire-and-forget
ctx.send(Msg, data);
ctx.reply({ result: "ok" });
ctx.progress({ progress: 50 });
```

Use when:

- Message is small or timing-insensitive
- Handler doesn't depend on delivery confirmation
- Minimizes latency (typical case, 90% of usage)

### When to Use `{waitFor: 'drain'}`

```typescript
// Backpressure-sensitive: wait for buffer to empty
const sent = await ctx.send(LargeMsg, buffer, { waitFor: "drain" });

if (!sent) {
  console.warn("Client buffer full; may need to backoff");
}
```

Use when:

- Sending large messages or bursts
- Handler should slow down if client can't keep up
- Critical delivery matters (e.g., financial transactions)

**Performance tip**: Only use for 1-5% of sends; impacts handler latency.

### When to Use `{waitFor: 'ack'}`

```typescript
// Server confirmation (rare): wait for acknowledgment
await ctx.reply({ status: "ok" }, { waitFor: "ack" });
```

Use when:

- Handler must wait for client-side action
- **Rare pattern**; most RPC calls don't need this
- Increases latency significantly; use sparingly

### Throttling Rapid Updates

```typescript
// Batch rapid progress updates (10 per second)
for (const frame of frames) {
  ctx.progress({ frame }, { throttleMs: 100 });
}
```

Use when:

- Client can't process all updates (e.g., 1000 frames/sec)
- Network bandwidth is limited
- Reduces load while maintaining responsiveness

### Publish: Enqueued vs Settled

```typescript
// Fast path: enqueued (default)
// Returns after adapter enqueues; doesn't wait for delivery
const res = await ctx.publish(topic, schema, data);

// Safe path: settled (wait for all subscribers)
// Returns after all subscribers receive (or timeout)
const res = await ctx.publish(topic, schema, data, {
  waitFor: "settled",
});
```

| Option                 | Latency | Certainty | Use When                         |
| ---------------------- | ------- | --------- | -------------------------------- |
| `'enqueued'` (default) | Fast    | Eventual  | Fire-and-forget broadcasts       |
| `'settled'`            | Slower  | Higher    | Critical events (payments, auth) |

---

## Pub-Sub Guarantees

### Local (Same Server Instance)

When using in-memory pub/sub (default, no external adapter):

| Guarantee          | Status                               |
| ------------------ | ------------------------------------ |
| Order              | ✅ Guaranteed (FIFO per topic)       |
| Delivery           | ✅ Guaranteed (if subscriber active) |
| Matched count      | ✅ Exact                             |
| Duplicate messages | ❌ Not prevented                     |

### Distributed (Redis, etc.)

When using external adapter (e.g., `redisPubSub`):

| Guarantee          | Status                                        |
| ------------------ | --------------------------------------------- |
| Order              | ⚠️ Only within partition (use `partitionKey`) |
| Delivery           | ⚠️ Eventually consistent                      |
| Matched count      | ⚠️ Approximate                                |
| Duplicate messages | ❌ Not prevented                              |

**Mitigation strategies**:

1. **Use `partitionKey` for order**:

   ```typescript
   await ctx.publish(topic, schema, data, {
     partitionKey: ctx.data.userId, // All user events stay ordered
   });
   ```

2. **Use `waitFor: 'settled'` for critical events**:

   ```typescript
   const res = await ctx.publish(topic, schema, data, {
     waitFor: "settled", // Wait for distributed settlement
   });
   ```

3. **Check `result.capability`** for visibility:
   ```typescript
   const res = await ctx.publish(topic, schema, data);
   if (res.capability === "partial") {
     console.warn("Partial delivery; some subscribers may have missed");
   }
   ```

---

## Examples

Complete, runnable examples are available in the examples directory:

- **[examples/flow-control/](../../examples/flow-control/)** — Backpressure and buffering patterns
  - Uses `.send()` with `{waitFor: 'drain'}`
  - Demonstrates queue overflow handling

- **[examples/state-channels/](../../examples/state-channels/)** — RPC streaming
  - Uses `.reply()` and `.progress()`
  - Shows long-running operation streaming

- **[examples/delta-sync/](../../examples/delta-sync/)** — Broadcast and subscriptions
  - Uses `.publish()` for state synchronization
  - Demonstrates subscriber management

### Real-World Pattern: Chat Room

```typescript
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId: string;
    username: string;
    roomId?: string;
  }
}

const ChatMsg = message("CHAT", { text: z.string() });
const UserJoined = message("USER_JOINED", { username: z.string() });

// User joins room
router.on(JoinRoomMsg, (ctx) => {
  const roomId = ctx.payload.roomId;
  ctx.data.roomId = roomId;

  // Notify room (exclude self)
  await ctx.publish(
    `room:${roomId}`,
    UserJoined,
    {
      username: ctx.data.username,
    },
    {
      excludeSelf: true,
    },
  );

  // Acknowledge to user
  ctx.send(JoinedMsg, { roomId });
});

// Broadcast message to room
router.on(ChatMsg, (ctx) => {
  const roomId = ctx.data.roomId;

  if (!roomId) {
    ctx.send(ErrorMsg, { message: "Not in a room" });
    return;
  }

  // Broadcast to all subscribers (exclude self; send separate echo)
  await ctx.publish(
    `room:${roomId}`,
    ChatMsg,
    {
      text: ctx.payload.text,
    },
    {
      excludeSelf: true,
    },
  );

  // Echo back to sender
  ctx.send(ChatMsg, { text: ctx.payload.text });
});
```

### Real-World Pattern: RPC with Streaming

```typescript
const ExportDataMsg = rpc(
  "EXPORT_DATA",
  { format: z.enum(["csv", "json"]), count: z.number() },
  "EXPORT_CHUNK",
  { chunk: z.string(), offset: z.number() },
);

router.rpc(ExportDataMsg, async (ctx) => {
  const data = await fetchData(ctx.payload.count);
  const format = ctx.payload.format;

  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = formatChunk(data.slice(i, i + CHUNK_SIZE), format);

    ctx.progress(
      {
        chunk,
        offset: i,
      },
      { throttleMs: 50 },
    ); // Throttle to 20 chunks/sec
  }

  ctx.reply({ totalSize: data.length });
});

// Client side
const chunks = [];
client
  .request(ExportDataMsg, {
    format: "csv",
    count: 10000,
  })
  .then(
    (result) => {
      // All chunks received
      const csv = chunks.join("\n");
      downloadFile(csv, "data.csv");
    },
    (error) => {
      console.error("Export failed:", error);
    },
    (update) => {
      chunks.push(update.chunk);
      updateProgressBar(update.offset);
    },
  );
```

---

## Full Signatures

All method signatures in one place, copy-paste ready:

```typescript
// Fire-and-forget unicast
interface SendOptionsBase {
  signal?: AbortSignal;
  meta?: Record<string, any>;
  inheritCorrelationId?: boolean;  // Auto-copy correlationId from request if present
}

interface SendOptionsSync extends SendOptionsBase {
  waitFor?: undefined;
}

interface SendOptionsAsync extends SendOptionsBase {
  waitFor: 'drain' | 'ack';
}

type SendOptions = SendOptionsSync | SendOptionsAsync;

send<T>(schema: Schema<T>, payload: T, opts?: SendOptionsSync): void;
send<T>(schema: Schema<T>, payload: T, opts: SendOptionsAsync): Promise<boolean>;

// ---

// RPC response (terminal)
interface ReplyOptions {
  signal?: AbortSignal;
  waitFor?: 'drain' | 'ack';
  meta?: Record<string, any>;
}

reply<T>(
  payload: T,
  opts?: ReplyOptions,
): void | Promise<void>;

// ---

// RPC error response (terminal)
error<T = unknown>(
  code: string,
  message: string,
  details?: T,
  opts?: ReplyOptions,
): void | Promise<void>;

// ---

// RPC update (non-terminal)
interface ProgressOptions {
  signal?: AbortSignal;
  waitFor?: 'drain' | 'ack';
  meta?: Record<string, any>;
  throttleMs?: number;
}

progress<T>(
  update: T,
  opts?: ProgressOptions,
): void | Promise<void>;

// ---

// Broadcast to topic
interface PublishOptions {
  signal?: AbortSignal;
  excludeSelf?: boolean;
  partitionKey?: string;
  waitFor?: 'enqueued' | 'settled';
  meta?: Record<string, any>;
}

interface PublishResult {
  ok: boolean;
  error?: string;
  matched?: number;
  capability: 'local' | 'distributed' | 'partial';
}

publish<T>(
  topic: string,
  schema: Schema<T>,
  payload: T,
  opts?: PublishOptions,
): Promise<PublishResult>;
```

---

## Related Documentation

- **[ADR-030: Context Methods Design](../adr/030-context-methods-design.md)** — Rationale, alternatives, consequences
- **[docs/specs/error-handling.md](./error-handling.md)** — Error codes and patterns
- **[docs/specs/pubsub.md](./pubsub.md)** — Pub/sub patterns and guarantees
- **[docs/specs/router.md](./router.md)** — Handler registration, middleware, lifecycle hooks
- **[docs/specs/schema.md](./schema.md)** — Message schema definitions and type inference
