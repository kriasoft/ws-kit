# Bun WS Router: Client SDK

> **Goal:** A tiny, type-safe WebSocket client for browsers and Node.js that reuses the same message schemas as the server.
> **Non-goals:** State management, persistence, plugin systems, or anything not essential to sending/receiving typed messages.

## Section Map

Quick navigation for AI tools:

- [#Design-Principles](#design-principles) — Core design goals
- [#Public-API](#public-api-stable-v1) — Complete API surface (types and methods)
- [#Message-Contract](#message-contract-client--server) — Wire format and correlation
- [#Validation--Normalization](#validation--normalization) — Outbound message processing
- [#Reconnect--Queueing](#reconnect--queueing) — Connection state machine and queue behavior
- [#Error-Handling](#error-handling-client-side) — Error types and contract
- [#Usage-Examples](#usage-examples) — Integration patterns
- **Server-side routing**: See @router.md for server message handling

## Design Principles

- **Lean & predictable.** Minimal API surface, explicit behavior, no hidden magic.
- **Type-safe I/O.** Same schemas on both ends; strict mode enforced.
- **Hard to misuse.** Clear defaults; safe fallbacks; bounded queues.
- **Testable.** Pure helpers, DI for WebSocket factory, deterministic backoff.

## Runtime & Packaging

- **Runtime:** Modern browsers (standard `WebSocket`), works under bundlers.
- **Validator choice:** Valibot recommended for browser clients (smaller bundle); Zod acceptable for larger apps.
- **Imports:** Use export-with-helpers pattern (ADR-007) for canonical imports.
  - **Typed Client (Primary):** ✅ **Strongly recommended**
    - Zod: `import { wsClient } from "@ws-kit/client/zod"`
    - Valibot: `import { wsClient } from "@ws-kit/client/valibot"`
    - Schemas also available from same entry: `import { z, message } from "@ws-kit/client/zod"`
  - **Generic Client (Advanced):** `import { wsClient } from "@ws-kit/client"` (custom validators only; handlers infer as `unknown`)
  - **Shared schemas:** Portable between client and server; import from typed client packages with export-with-helpers pattern.

## Public API (Stable v1)

**Primary:** Use typed clients (`@ws-kit/client/zod` or `@ws-kit/client/valibot`) for full type inference and safe defaults. Generic client (`@ws-kit/client`) available for advanced use with custom validators. See ADR-002 for type override rationale.

````ts
// Primary: @ws-kit/client/zod or @ws-kit/client/valibot
// (Typed clients provide full type inference; see below for generic client)

export type ClientOptions = {
  url: string | URL;
  protocols?: string | string[]; // WebSocket subprotocols (Sec-WebSocket-Protocol header)

  reconnect?: {
    enabled?: boolean; // default: true
    maxAttempts?: number; // default: Infinity
    initialDelayMs?: number; // default: 300
    maxDelayMs?: number; // default: 10_000
    jitter?: "full" | "none"; // default: "full"
  };

  // Backoff calculation:
  //   delay = min(maxDelayMs, initialDelayMs × 2^(attempt-1))
  //   Backoff multiplier fixed at 2 (exponential doubling)
  //   - Without jitter ("none"): use delay exactly
  //   - With full jitter ("full"): use random(0, delay)
  // With defaults (300ms initial, 10s max, full jitter):
  //   attempt 1: random(0, 300ms)
  //   attempt 2: random(0, 600ms)
  //   attempt 3: random(0, 1200ms)
  //   attempt 4: random(0, 2400ms)
  //   attempt 5: random(0, 4800ms)
  //   attempt 6: random(0, 9600ms)
  //   attempt 7+: random(0, 10000ms) [capped at maxDelayMs]
  // Rationale: Full jitter prevents thundering herd on mass reconnects

  queue?: "drop-oldest" | "drop-newest" | "off"; // default: "drop-newest"
  // Controls outbound message queueing behavior when state !== "open" (disconnected):
  //   - "drop-oldest": Queue up to queueSize; evict oldest on overflow
  //   - "drop-newest": Queue up to queueSize; reject newest on overflow
  //   - "off": Drop immediately; send() returns false
  queueSize?: number; // default: 50 (maximum pending messages while offline)

  autoConnect?: boolean; // default: false
  // When true, client auto-connects on first send/request if state === "closed" and never connected.
  // Connection errors fail fast (reject pending operations).
  // Does NOT auto-reconnect from "closed" after manual disconnect.

  pendingRequestsLimit?: number; // default: 1000
  // Maximum concurrent pending requests. When exceeded, new request() rejects immediately with StateError; existing requests are unaffected.
  // Rationale: Prevents unbounded memory growth if server stops replying or timeout is too high.
  // Production note: If you hit this limit, add application-level request queueing/throttling.

  auth?: {
    getToken?: () => string | null | undefined | Promise<string | null | undefined>; // Called once per (re)connect; supports sync or async
    attach?: "query" | "protocol"; // default: "query"
    queryParam?: string; // default: "access_token" (for query attach)
    protocolPrefix?: string; // default: "bearer." (for protocol attach)
                             // MUST NOT contain spaces/commas (RFC 6455 constraint)
    protocolPosition?: "append" | "prepend"; // default: "append" (for protocol attach)
                                              // "append": token after user protocols
                                              // "prepend": token before user protocols
  };

  wsFactory?: (url: string | URL, protocols?: string | string[]) => WebSocket; // DI for tests
};

### Protocol Merging (Auth + User Protocols) {#protocol-merging}

When `auth.attach === "protocol"` AND `protocols` is provided:

1. Normalize `protocols` to array (scalar → `[value]`, `undefined` → `[]`)
2. Call `getToken()` to retrieve token
3. If token exists (not `null`/`undefined`): generate `"${protocolPrefix}${token}"`
4. Combine based on `protocolPosition`:
   - `"append"` (default): `combinedProtocols = [...normalizedUserProtocols, tokenProtocol]`
   - `"prepend"`: `combinedProtocols = [tokenProtocol, ...normalizedUserProtocols]`
5. De-duplicate preserving **first occurrence** (insertion order)
6. Filter out empty strings (prevent malformed `Sec-WebSocket-Protocol` header)
7. Pass combined array to WebSocket constructor

**Edge cases:**

| Scenario                           | Behavior (append)                             | Behavior (prepend)                            |
|------------------------------------|-----------------------------------------------|-----------------------------------------------|
| `protocols: undefined`, token exists | WebSocket receives `["bearer.<token>"]`      | WebSocket receives `["bearer.<token>"]`      |
| User protocol duplicates token     | Keep first occurrence only (user's wins)      | Keep first occurrence only (token wins)       |
| `getToken()` returns `null`        | WebSocket receives user protocols only        | WebSocket receives user protocols only        |
| Invalid `protocolPrefix`           | Throw `TypeError` during `connect()` (before WS) | Throw `TypeError` during `connect()` (before WS) |
| Server accepts connection but selects no subprotocol | Client proceeds with no selected protocol (`ws.protocol === ""`) | Client proceeds with no selected protocol (`ws.protocol === ""`) |

**Examples:**

```typescript
// Default: append token after user protocols
wsClient({
  url: "wss://api.example.com",
  protocols: "chat-v2", // User protocol
  auth: {
    getToken: () => "abc123",
    attach: "protocol", // Generates "bearer.abc123"
    protocolPrefix: "bearer.", // default
    protocolPosition: "append", // default
  },
});
// WebSocket constructor receives: ["chat-v2", "bearer.abc123"]

// Prepend: token before user protocols (some servers require auth first)
wsClient({
  url: "wss://api.example.com",
  protocols: "chat-v2",
  auth: {
    getToken: () => "abc123",
    attach: "protocol",
    protocolPosition: "prepend", // Auth protocol first
  },
});
// WebSocket constructor receives: ["bearer.abc123", "chat-v2"]
```

**Validation:** `protocolPrefix` MUST NOT contain spaces or commas (RFC 6455 subprotocol constraint). Client validates before calling `new WebSocket()`:

```typescript
if (!/^[^\s,]+$/.test(protocolPrefix)) {
  throw new TypeError(
    `Invalid protocolPrefix: "${protocolPrefix}" (must not contain spaces/commas)`
  );
}
```

**Security:** WebSocket subprotocols are visible in HTTP headers (plaintext over non-TLS). Use WSS:// (TLS) when transmitting tokens via protocols. Some proxies log headers; prefer short-lived tokens when using protocol auth. For HTTP-only environments, prefer `attach: "query"` with short-lived tokens.

**Server Protocol Selection:**

The server selects ONE protocol from client's list. Client can check `client.protocol` after connection:

- `client.protocol === "bearer.abc123"` → Server selected token protocol
- `client.protocol === "chat-v2"` → Server selected user protocol
- `client.protocol === ""` → Server accepted connection but selected no protocol

**Failure mode:** If app requires specific protocol (e.g., `"chat-v2"`) but server selects different one, close connection with `1002 Protocol Error`:

```typescript
client.onState((state) => {
  if (state === "open" && client.protocol !== "chat-v2" && client.protocol !== "") {
    client.close({ code: 1002, reason: "Unsupported protocol" });
  }
});
```

**Server considerations:** The server MUST be configured to accept the token-bearing protocol. Servers typically select ONE protocol from the client's list. If the server selects the token protocol (e.g., `"bearer.abc123"`), ensure application logic handles both authentication AND functional protocols.

export type ClientState =
  | "closed"       // No connection; initial state or post-disconnect
  | "connecting"   // Connection attempt in progress (maps to native WebSocket CONNECTING)
  | "open"         // WebSocket connected, messages flow (maps to native WebSocket OPEN)
  | "closing"      // Graceful disconnect initiated (maps to native WebSocket CLOSING)
  | "reconnecting"; // Waiting during backoff delay before retry (not a native WebSocket state)

export interface WebSocketClient {
readonly state: ClientState;
readonly isConnected: boolean; // Sugar for state === "open" (read-only getter)
readonly protocol: string; // Selected subprotocol; "" until connected or if none selected

// Idempotent: CLOSED → connect; CONNECTING → return in-flight promise; OPEN → resolved promise.
// Called implicitly by send/request when autoConnect: true and state === "closed".
connect(): Promise<void>;

// Graceful close: waits for CLOSING → CLOSED transition; cancels reconnect; pending requests reject
// Fully idempotent: safe to call in any state; resolves immediately if already closed
close(opts?: { code?: number; reason?: string }): Promise<void>;

// State change notifications (fires on every state transition)
onState(cb: (state: ClientState) => void): () => void; // returns unsubscribe

// Sugar: resolves when state becomes "open" (resolves immediately if already open)
onceOpen(): Promise<void>;

// Inbound routing with type-safe validation
// Multiple handlers may be registered for the same schema (execute in registration order)
// Returns unsubscribe function (removes only this handler)
// See @client.md#Multiple-Handlers for multi-handler semantics
on<S extends AnyMessageSchema>(
schema: S,
handler: (msg: InferMessage<S>) => void,
): () => void;

// Fire-and-forget to server (unicast)
// Returns true if sent/enqueued; false if dropped (see @client.md#fire-and-forget-return)
// Payload conditional: use overloads to omit payload param for no-payload schemas
send<S extends AnyMessageSchema>(
schema: S,
payload: InferPayload<S>,
opts?: { meta?: InferMeta<S>; correlationId?: string },
): boolean;

// Request/response with auto-detected response schema (RPC helper)
// Bind request and response schemas with rpc() for cleaner client calls
// Usage: const Ping = rpc("PING", {...}, "PONG", {...});
//        await client.request(Ping, {...}, opts?);
// Returns Promise resolving to fully typed reply message
// Rejects on timeout, validation error, connection close, or server error
request<S extends AnyMessageSchema & { response: AnyMessageSchema }>(
schema: S,
payload: InferPayload<S>,
opts?: { timeoutMs?: number; meta?: InferMeta<S>; correlationId?: string; signal?: AbortSignal }, // timeoutMs default: 30000
): Promise<InferMessage<S["response"]>>;

// Request/response with explicit reply schema (backward compatible)
// Note: opts.meta applies to the outbound request, not the reply
// Returns Promise resolving to fully typed reply message
// Rejects on timeout, validation error, connection close, or server error
request<S extends AnyMessageSchema, R extends AnyMessageSchema>(
schema: S,
payload: InferPayload<S>,
reply: R,
opts?: { timeoutMs?: number; meta?: InferMeta<S>; correlationId?: string; signal?: AbortSignal }, // timeoutMs default: 30000
): Promise<InferMessage<R>>;

// Hook for unhandled message types
// Contract: Receives only structurally valid messages whose type has no registered schema; messages for registered types that fail validation are dropped and do not reach onUnhandled()
// Input: AnyInboundMessage (treat as readonly; do not mutate)
onUnhandled(cb: (msg: AnyInboundMessage) => void): () => void;

// Hook for non-fatal internal errors (centralized error reporting)
// Fires for: parse failures, validation failures, queue overflow, invalid inbound messages
// Does NOT fire for: request() rejections (caller handles), handler errors (logged to console.error)
// Use for: centralized logging, error tracking (Sentry/DataDog), debugging
onError(cb: (error: Error, context: { type: "parse" | "validation" | "overflow" | "unknown"; details?: unknown }) => void): () => void;

// Dispatch order:
// - Schema handlers registered via on(schema, handler) execute first
// - onUnhandled() fires only for valid messages with no registered schema
// - Invalid messages (parse/validation failures) trigger onError() then dropped (never reach onUnhandled())
}

export function wsClient(opts: ClientOptions): WebSocketClient;

// Error classes for client-side error handling
export {
  ValidationError,
  TimeoutError,
  ServerError,
  ConnectionClosedError,
  StateError,
} from "@ws-kit/client";

````

**Type Inference**: Typed clients (`/zod/client`, `/valibot/client`) provide full inference via type overrides (see ADR-002):

```typescript
// Zod typed client
import { wsClient } from "@ws-kit/client/zod";

const client = wsClient({ url: "wss://api.example.com" });

client.on(HelloOk, (msg) => {
  // ✅ msg fully typed: { type: "HELLO_OK", meta: MessageMeta, payload: { text: string } }
  msg.type; // "HELLO_OK" (literal type)
  msg.meta.timestamp; // number | undefined
  msg.payload.text; // string (was `unknown` in generic client)
});
```

**Payload conditional typing** enforced via overloads:

```typescript
// Define schemas
const Hello = message("HELLO", { name: z.string() });
const Logout = message("LOGOUT"); // No payload

// ✅ Payload required (schema has payload)
client.send(Hello, { name: "Alice" });

// ✅ Payload omitted (schema has no payload)
client.send(Logout);

// ❌ Type error - payload required but missing
client.send(Hello);
// Error: Expected 2-3 arguments, but got 1

// ❌ Type error - payload provided but schema has none
client.send(Logout, {});
// Error: Expected 1-2 arguments, but got 2-3
```

### Advanced: Generic Client (Custom Validators Only)

For custom validators not supported by typed clients, the generic client is available but handlers receive `unknown`:

```typescript
// Generic client (advanced; custom validators only)
import { wsClient } from "@ws-kit/client";

client.on(HelloOk, (msg) => {
  // ⚠️ msg is unknown - requires manual type assertion
  const typed = msg as InferMessage<typeof HelloOk>;
});
```

**When to use:** Only if your validator is not supported by `@ws-kit/client/zod` or `@ws-kit/client/valibot`. For standard use, always prefer typed clients.

### Multiple Handlers

Multiple handlers MAY be registered for the same schema. Handlers execute in **registration order**.

```typescript
const unsubscribe1 = client.on(TestMsg, handler1);
const unsubscribe2 = client.on(TestMsg, handler2);

// Both run when TestMsg arrives: handler1 → handler2
// unsubscribe2() removes only handler2
```

**Error handling**: If a handler throws, remaining handlers still execute. Errors are logged via `console.error`.

**Removal during dispatch**: Unsubscribing a handler during dispatch does NOT affect the current dispatch cycle (stable iteration).

**Performance**: O(n) iteration where n = handler count per schema (typical n = 1-3; acceptable overhead).

**Rationale**: Multi-handler pattern is idiomatic for client-side event systems (browser `addEventListener` model). Enables composability across modules (e.g., logging + UI both listening for same message) without collision footgun.

### Request/Response Timeout Semantics {#request-timeout}

**Timeout behavior:**

- `timeoutMs` measures time from **message transmission** (flushed on OPEN socket) to response arrival
- Default: `30000` ms (30 seconds)
- If message is buffered (`state !== "open"`), timeout does NOT start until buffer is flushed
- If connection closes before response, promise rejects with `ConnectionClosedError` (timeout cancelled)

**Cancellation via AbortSignal:**

- `opts.signal` provides fetch-style cancellation semantics
- If `signal.aborted` is `true` before send → reject immediately with `StateError` ("Request aborted before dispatch")
- If aborted while pending → cancel timeout timer, remove from pending map, reject with `StateError` ("Request aborted")
- AbortSignal cleanup is automatic; no manual unsubscribe needed

**Example:**

```typescript
// Basic timeout
client.connect();
client.request(Hello, { name: "Anna" }, HelloOk, { timeoutMs: 5000 });
// ✅ Timeout starts ONLY after connection opens and message is sent
// ❌ Does NOT start counting while buffered during connection attempt

// Cancellation with AbortController
const controller = new AbortController();

const promise = client.request(Hello, { name: "Anna" }, HelloOk, {
  signal: controller.signal,
});

// Cancel the request (before or after dispatch)
controller.abort();
// Promise rejects with StateError: "Request aborted"
```

**Rationale:** Timeout measures network roundtrip time, not buffer wait time. AbortSignal provides composable cancellation (e.g., tying multiple requests to single controller, race conditions, component unmount).

### Fire-and-Forget Return Value Semantics {#fire-and-forget-return}

**`send()` return value:**

- **Returns `true`** when:
  - Message sent immediately (`state === "open"`)
  - Message queued successfully (`state !== "open"` AND `queue` is `"drop-oldest"` or `"drop-newest"`)
- **Returns `false`** when message is **dropped** (will not be retried):
  - `queue === "off"` while `state !== "open"`
  - Queue overflow with `queue === "drop-newest"`
  - Payload fails schema validation (logs to `console.error`)

**Example:**

```typescript
// Handle dropped messages
const sent = client.send(ChatMsg, { text: "hello" });
if (!sent) {
  console.warn("Message dropped (offline or buffer full)");
  // Show UI feedback, don't retry
}

// Validation errors return false (logged to console.error)
const sent2 = client.send(ChatMsg, { text: 123 }); // ❌ Type error caught by TS
if (!sent2) {
  // Message invalid, already logged
}
```

**Rationale:** Boolean return enables fire-and-forget patterns with optional backpressure handling. Validation errors return `false` to maintain fire-and-forget semantics (never throw).

### Extended Meta Usage {#extended-meta}

When schemas define extended meta fields, provide them via `opts.meta`:

```typescript
// Schema with extended meta (required field)
const RoomMsg = message(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Required meta field
);

// ✅ Provide extended meta
client.send(
  RoomMsg,
  { text: "hello" },
  {
    meta: { roomId: "general" },
  },
);

// ✅ Works with correlationId
client.request(RoomMsg, { text: "hello" }, RoomMsgOk, {
  meta: { roomId: "general" },
  correlationId: "req-123",
});

// ❌ Type error - missing required meta field
client.send(RoomMsg, { text: "hello" }); // Compile error: roomId required

// ✅ Optional extended meta
const OptionalMetaMsg = message(
  "NOTIFY",
  { text: z.string() },
  { priority: z.enum(["low", "high"]).optional() },
);

client.send(OptionalMetaMsg, { text: "hello" }); // OK - priority is optional
client.send(
  OptionalMetaMsg,
  { text: "hello" },
  {
    meta: { priority: "high" },
  },
); // Also OK
```

**Normalization**: See @client.md#client-normalization for outbound meta merging rules (auto-injection, reserved key stripping).

**Type safety**: `InferMeta<S>` enforces schema-defined meta fields at compile time. Required fields cause type errors if omitted; optional fields can be omitted.

### Message Processing Order {#message-processing-order}

**Inbound message pipeline:**

1. **Receive** — WebSocket `onmessage` event fires
2. **Parse** — JSON.parse() the raw string
3. **Extract type** — Read `type` field (drop if missing)
4. **Lookup schema** — Check internal schema registry `Map<type, schema>` built from `on(schema, handler)` registrations
5. **Validate & Route**:
   - **Schema found**: Validate against schema (strict mode)
     - Valid → Invoke all registered `on(schema, handler)` callbacks
     - Invalid → Drop message (console.warn), **NEVER** reach `onUnhandled()`
   - **No schema found**: Validate structural correctness (`{ type: string, meta?: object, payload?: any }`)
     - Structurally valid → Invoke `onUnhandled()` (if registered) with raw parsed message
     - Structurally invalid → Drop message (console.warn)

**Schema registry:**

- Client maintains `Map<type, schema>` updated by `on(schema, handler)` registrations
- Multiple handlers may register the same schema (multi-handler support)
- Schema is stored once per type; validation uses stored schema before routing

**onUnhandled use cases:**

- **Graceful degradation** — Handle unhandled server messages during version mismatch
- **Protocol negotiation** — Client knows message types server doesn't yet support
- **Debug/logging** — Observe unregistered message types in development

**Input contract:**

- Type: `AnyInboundMessage` (structurally valid message with unregistered type)
- **Treat as readonly** — Do not mutate the message object (same guidance as schema handlers)
- Structure: `{ type: string, meta?: object, payload?: any }`

**Ordering guarantees:**

- Schema handlers execute BEFORE `onUnhandled` (schema match takes precedence)
- Invalid messages **NEVER** reach `onUnhandled` (dropped at validation)
- `onUnhandled` receives only:
  - **Structurally valid** messages with unregistered `type` (no schema registered)
  - Messages that pass structural validation: `{ type: string, meta?: object, payload?: any }`
- Messages that fail schema validation (registered type, invalid structure) are **NEVER** passed to `onUnhandled`

## Message Contract (Client ↔ Server)

- Message structure is identical to server spec (`type`, `meta`, optional `payload`).
- **Strict schemas**: extra/unknown keys **MUST** fail validation.
- **Reserved meta keys** (never set by users):
  - `clientId` --- server/transport identity
  - `receivedAt` --- server ingress timestamp (ms since epoch)

### Timestamps

Client auto-injects `meta.timestamp = Date.now()` on `send()`/`request()` if not provided in `opts.meta`. Server sets `receivedAt` when message arrives.

**When to use which timestamp:** See @schema.md#Which-timestamp-to-use for canonical guidance (client UI vs server logic).

### Correlation

- If `opts.correlationId` is missing, client **MUST** generate a unique ID (UUIDv4 via `crypto.randomUUID()`).
- Servers **MUST** echo `meta.correlationId` in replies.
- `request()` resolves/rejects when an inbound message with matching `meta.correlationId` arrives:
  - **Type matches `reply` schema**: Resolve with validated message
  - **Type is `ERROR`**: Reject with `ServerError` (attach code/payload from error message)
  - **Type mismatches `reply` schema (non-error)**: Reject with `ValidationError` (stop waiting)
  - **Validation fails against `reply` schema**: Reject with `ValidationError` (malformed reply)
- `request()` also rejects on:
  - Timeout (`TimeoutError`) — no reply with matching `correlationId` within `timeoutMs`
  - Connection closed before response (`ConnectionClosedError`)

### Request Dispatch Implementation

Client maintains `Map<correlationId, PendingRequest>` where:

```typescript
type PendingRequest = {
  expectedType: string;
  schema: AnyMessageSchema;
  resolve: (msg: any) => void;
  reject: (err: Error) => void;
  timeoutHandle: number;
};
```

On inbound message with `meta.correlationId`:

1. Lookup pending request by `correlationId`
2. If found:
   - Cancel timeout
   - If `msg.type === "ERROR"`: reject with `ServerError`
   - Else if `msg.type !== expectedType`: reject with `ValidationError` ("Expected X, got Y")
   - Else: validate against `schema`
     - Success: resolve with validated message
     - Failure: reject with `ValidationError` (attach validation issues)
3. Remove from pending map
4. If NOT found (already settled or unknown): **drop silently** (no error, no handler invoked)

**Duplicate reply behavior:**

If multiple inbound messages arrive with the same `correlationId`, only the **first** settles the pending promise. Subsequent messages with the same `correlationId` are **ignored** (dropped silently) after the entry is removed from the pending map.

**Rationale:** Protects against server bugs (duplicate replies) and ensures each `request()` settles exactly once.

## Validation & Normalization

### Validation

- **Outbound:** Before buffer or send, client validates against the provided `schema`.
  - `send()` returns `false` on validation failure (never throws)
  - `request()` returns a rejected Promise with `ValidationError` (never throws synchronously)
  - Validation errors logged to `console.error` with validation issues
- **Inbound:** Extract `type` field, lookup schema in registration Map, validate.
  - Unknown/invalid messages are dropped; a diagnostic event is logged via `console.warn` (no throws).
  - Validation uses same strict mode as server (reject unknown keys).
- **Strict mode:** The client **MUST** validate with strict schemas that reject unknown keys in `meta` or `payload`.

**Validation consistency:** See @validation.md#normalization-rules for server normalization behavior.

### Normalization Rules {#client-normalization}

**Outbound normalization** (applied before validation):

Client MUST normalize messages before sending in `send()` and `request()`:

1. **Strip reserved/managed keys from user meta**: Remove `clientId`, `receivedAt`, `correlationId` from `opts.meta`
   - Security boundary: prevents spoofing server-only fields (`clientId`, `receivedAt`)
   - Client-managed field: `correlationId` MUST be provided via `opts.correlationId`, not `opts.meta` (ignored if present)

2. **Merge meta**: Combine default fields, sanitized user meta, and correlationId:

   ```typescript
   // Strip reserved + managed keys from user-provided meta
   const userMeta = omit(opts?.meta, [
     "clientId",
     "receivedAt",
     "correlationId",
   ]);

   // Build meta deterministically
   const meta = {
     timestamp: Date.now(), // Auto-inject (default)
     ...userMeta, // User-provided extended meta (sanitized)
     ...(opts?.correlationId && { correlationId: opts.correlationId }),
   };
   ```

3. **Auto-generate correlationId**: For `request()` only, if `opts.correlationId` is absent, generate UUIDv4 via `crypto.randomUUID()`

**Example normalization**:

```typescript
// User calls send()
client.send(RoomMsg, { text: "hi" }, {
  meta: { roomId: "general", timestamp: 123 } // User provides timestamp
});

// After normalization (timestamp NOT overwritten, user value preserved)
{
  type: "CHAT",
  meta: {
    timestamp: 123,          // User value preserved
    roomId: "general"        // User extended meta
  },
  payload: { text: "hi" }
}

// User tries to spoof reserved keys
client.send(RoomMsg, { text: "hi" }, {
  meta: { roomId: "general", clientId: "fake" } // clientId stripped
});

// After normalization (clientId stripped before validation)
{
  type: "CHAT",
  meta: {
    timestamp: Date.now(),   // Auto-injected
    roomId: "general"        // Preserved
    // clientId stripped
  },
  payload: { text: "hi" }
}

// User tries to set correlationId via meta (ignored)
client.send(RoomMsg, { text: "hi" }, {
  meta: { roomId: "general", correlationId: "sneaky" }, // correlationId stripped
  correlationId: "correct" // Only this is used
});

// After normalization (correlationId from meta ignored)
{
  type: "CHAT",
  meta: {
    timestamp: Date.now(),
    roomId: "general",
    correlationId: "correct"  // Only opts.correlationId used
  },
  payload: { text: "hi" }
}
```

### Inbound Normalization

- Client MUST NOT strip any fields from inbound messages (server already normalized)
- Trust server-provided `clientId` / `receivedAt` if present (though these typically don't appear in client-bound messages)

### Timestamp usage

See @schema.md#Which-timestamp-to-use for when to use `meta.timestamp` (producer time, UI display) vs `receivedAt` (server logic, authoritative).

## Reconnect & Queueing

### Connection State Machine

```mermaid
closed → connecting → open → closing → closed
  ↑__________________________________|  (manual reconnect)
closed → reconnecting → connecting      (auto-reconnect)
```

- **closed:** No connection; initial state or post-disconnect
- **connecting:** Connection attempt in progress (maps to native WebSocket `CONNECTING`)
- **open:** WebSocket connected, messages flow (maps to native WebSocket `OPEN`)
- **closing:** Graceful disconnect initiated (maps to native WebSocket `CLOSING`)
- **reconnecting:** Waiting before retry attempt (only when `reconnect.enabled: true`)

### Reconnect Behavior

- **Reconnect:** Exponential backoff (`initialDelayMs` ... `maxDelayMs`) with optional full jitter.
- **Auth refresh:** Before each (re)connect, call `getToken()` if provided.
  - `attach: "query"` (default): Append as `?${queryParam}=<token>` (default param: `access_token`)
  - `attach: "protocol"`: Use `Sec-WebSocket-Protocol: ${prefix}<token>` (default prefix: `bearer.`)

### Queue Behavior {#queue-behavior}

**When to queue**: When `state !== "open"`, outbound `send()`/`request()` behavior follows `queue` option.

**Modes**:

- `"drop-newest"` (default): Queue messages while offline; discard new messages when queue full
- `"drop-oldest"`: Queue messages while offline; evict oldest message when queue full
- `"off"`: Drop messages immediately when not connected; no queue

**Bounds**: `queueSize` (default: 1000) prevents memory leaks. Only applies to queue modes with buffer.

**Overflow logging**: Both queue modes log `console.warn` on overflow (oldest evicted or newest rejected).

**Auto-Connect Interaction**: When `autoConnect: true` and first operation triggers `connect()`:

- Auto-connect attempt happens **before** `queue` policy check
- Connection errors reject with connection error (not `StateError`)
- After failed auto-connect, subsequent operations follow `queue` policy (e.g., `queue: "off"` → immediate `StateError`)
- Auto-connect only triggers once per `"closed"` state (does NOT retry after failure)
- `send()`: Auto-connect failure → **returns `false`** (logged to `console.error`); **NEVER throws**
- `request()`: Auto-connect failure → **returns rejected Promise**; **NEVER throws synchronously**
- If auto-connect succeeds but socket not yet OPEN → apply `queue` policy

**Order of Operations** (for `request()` with `autoConnect=true` + `queue="off"`):

```text
request()
  ├─ state === "closed" && never connected? → YES
  ├─ Trigger connect() (autoConnect)
  ├─ connect() fails → Reject with connection error
  └─ (queue policy NOT evaluated on first attempt)

request() [second call]
  ├─ state === "closed" && never connected? → NO (already attempted)
  ├─ state !== "open" && queue === "off"? → YES
  └─ Reject immediately with StateError
```

See @test-requirements.md#L873 for edge case validation.

**Return values**:

- `send()` returns `true` if sent/queued, `false` if discarded/auto-connect failed (see @client.md#fire-and-forget-return)
- `request()` behavior when `state !== "open"`:
  - `queue: "drop-newest"` or `"drop-oldest"`: Queues pending request; timeout starts after flush (see @client.md#request-timeout)
  - `queue: "off"`: Rejects immediately with `StateError` ("Cannot send request while disconnected with queue disabled")
  - Auto-connect failure: Rejects with connection error (never throws synchronously)

## Error Handling (Client-Side)

**Fire-and-forget errors (`send()`):**

- `send()` **never throws**
- Returns `false` on outbound validation failure (logged to `console.error`)
- Returns `false` when message is dropped (queue overflow or `queue: "off"`)
- See @client.md#fire-and-forget-return for complete return value semantics

**Request/response errors (`request()`):**

`request()` returns a rejected Promise on:

- `ValidationError` (outbound) --- Invalid payload/meta before sending (client-side validation failure)
- `ValidationError` (inbound) --- Reply has wrong type or fails schema validation (server sent malformed/mismatched reply)
- `TimeoutError` --- No reply within `timeoutMs`
- `ServerError` --- Server sent `ERROR` message with matching `correlationId`
- `ConnectionClosedError` --- Connection closed before reply arrived
- `StateError` --- Request aborted via `signal`, attempted `request()` while `state !== "open"` and `queue: "off"`, or pending request limit exceeded (new requests rejected; existing requests unaffected)

**StateError rejection cases:**

`request()` rejects **immediately** (returns a rejected Promise) with `StateError` when:

- `opts.signal.aborted === true` before dispatch (message: "Request aborted before dispatch")
- `opts.signal` aborted while pending (message: "Request aborted"; timeout cancelled, pending map cleaned)
- `state !== "open"` AND `queue: "off"` (cannot send while disconnected with queue disabled)
- `pendingRequestsLimit` exceeded (prevents unbounded memory growth; existing pending requests unaffected)

**Example:**

```typescript
try {
  const controller = new AbortController();
  const promise = client.request(Hello, { name: "test" }, HelloOk, {
    signal: controller.signal,
  });

  // Cancel if needed
  controller.abort();

  await promise;
} catch (err) {
  if (err instanceof StateError) {
    // Aborted, queue disabled + offline, or pending limit exceeded
  }
}
```

**Important:** `StateError` is always a **Promise rejection**, never a synchronous throw.

## Error Contract {#error-contract}

**Synchronous validation (throws `TypeError`):**

Only during setup or preflight validation:

- `wsClient()` --- Invalid options (e.g., illegal `protocolPrefix` with spaces/commas)
- `connect()` --- Preflight validation failures (e.g., malformed URL)

**Fire-and-forget (`send()`):**

- **NEVER throws**
- Returns `boolean`: `true` if sent/queued, `false` if dropped/invalid

**Promise-based methods:**

| Method      | Synchronous Throws | Promise Rejection                                                                          | Notes                                                                                                                               |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `connect()` | ❌ **Never**       | ✅ Connection errors                                                                       | Idempotent: returns in-flight promise if connecting; resolves immediately if already open                                           |
| `request()` | ❌ **Never**       | ✅ `ValidationError`, `TimeoutError`, `ServerError`, `ConnectionClosedError`, `StateError` | `StateError` **only** when: (1) aborted, (2) `queue: "off"` + disconnected + autoConnect didn't trigger, (3) pending limit exceeded |
| `close()`   | ❌ **Never**       | ❌ **NEVER rejects**                                                                       | **Fully idempotent**: safe to call in any state (including already `"closed"`); no `StateError` possible                            |

**Key guarantees:**

- `connect()` is idempotent: returns in-flight promise if already connecting; resolves immediately if already open
- `close()` is **fully idempotent**: **NEVER rejects** due to state; safe to call in any state (including already `"closed"`); mirrors native `WebSocket#close()` ergonomics; **no `StateError` will ever be thrown**
- `send()` **NEVER throws** (returns `false` on failure)
- `request()` **NEVER throws synchronously** (returns rejected Promise)
- `correlationId` is client-managed: MUST be provided via `opts.correlationId`; values in `opts.meta.correlationId` are ignored and stripped during normalization

**Error Class Structures:**

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string[]; message: string }>,
  ) {}
}

class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {}
}

class ServerError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {}
}

class ConnectionClosedError extends Error {}

class StateError extends Error {}
```

**Observability:**

- The client may `console.debug` connection transitions and `console.warn` on drops, invalid inbound messages, and queue overflow.

### Catching Errors

```typescript
import {
  ValidationError,
  TimeoutError,
  ServerError,
  ConnectionClosedError,
} from "@ws-kit/client";

try {
  const reply = await client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
  });
  console.log("Reply:", reply.payload.text);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn(`Request timed out after ${err.timeoutMs}ms`);
  } else if (err instanceof ServerError) {
    console.error(`Server error: ${err.code}`, err.context);
  } else if (err instanceof ConnectionClosedError) {
    console.warn("Connection closed before reply");
  } else if (err instanceof ValidationError) {
    console.error("Invalid reply:", err.issues);
  }
}
```

### Centralized Error Reporting with `onError()`

For non-fatal internal errors (parse failures, validation errors, queue overflow), use the `onError()` hook:

```typescript
// Centralized error tracking (Sentry, DataDog, etc.)
client.onError((error, context) => {
  switch (context.type) {
    case "parse":
      console.warn("Invalid JSON from server:", error.message);
      Sentry.captureException(error, { tags: { type: "ws-parse" } });
      break;

    case "validation":
      console.warn(
        "Message validation failed:",
        error.message,
        context.details,
      );
      Sentry.captureException(error, {
        tags: { type: "ws-validation" },
        extra: context.details,
      });
      break;

    case "overflow":
      console.warn("Queue overflow (message dropped):", error.message);
      metrics.increment("ws.queue.overflow");
      break;

    case "unknown":
      console.warn("Unknown client error:", error.message, context.details);
      Sentry.captureException(error, { tags: { type: "ws-unknown" } });
      break;
  }
});

// onError does NOT fire for:
// - request() rejections (caller handles with try/catch)
// - Handler errors (logged to console.error automatically)
```

**Use cases:**

- ✅ Centralized logging across all non-fatal errors
- ✅ Error tracking integration (Sentry, DataDog, LogRocket)
- ✅ Debugging production issues (malformed server messages)
- ✅ Metrics collection (queue overflow frequency)

**Not for:**

- ❌ Request/response errors → use `try/catch` on `request()`
- ❌ Handler errors → already logged to `console.error`

## Security & Safety

- **Never** attach secrets into `meta` or `payload` unless encrypted.
- **Query-string auth:** Tokens in URLs may be logged by browsers, proxies, or servers. Prefer short-lived tokens when using `attach: "query"` (default).
- **Protocol auth:** Use `attach: "protocol"` to avoid URL logging. Tokens in `Sec-WebSocket-Protocol` headers are visible in plaintext over non-TLS; always use WSS:// (TLS) for production.
- **Custom auth:** For custom authentication mechanisms (e.g., cookies, header-based auth via server proxy), implement via `wsFactory` or server-side upgrade patterns.
- Client ignores any inbound attempt to override reserved meta keys.

## Bundle Size

- Client logic (without validator): ~2-3 kB min+gz
- Validator choice significantly impacts total size:
  - Valibot: Smaller footprint (recommended for browsers)
  - Zod: Larger but acceptable for apps already using Zod

Use tree-shaking and measure with your bundler.

## Performance Targets

- Message routing: **O(1)** type lookup + **O(n fields)** validation per message
- No deep cloning of messages
- Reconnect backoff: Microtask-scheduled; no timers < 250ms after connection stable
- Memory: Bounded queues (default 1000 messages); drop oldest on overflow

## Implementation Details

### Inbound Message Routing

Client MUST use Map-based schema lookup (same pattern as server):

1. Parse JSON
2. Extract `type` field (drop if missing)
3. Lookup schema in `Map<type, schema>` built from `on()` registrations
4. If schema found: validate with schema
   - Valid → Invoke all registered handlers for this type
   - Invalid → Drop message (console.warn), never reach `onUnhandled()`
5. If no schema found:
   - Validate structural correctness: `{ type: string, meta?: object, payload?: any }`
   - Structurally valid → Invoke `onUnhandled()` (if registered) with raw parsed message
   - Structurally invalid → Drop message (console.warn)

**Performance:** O(1) type lookup + O(n fields) validation per message.

**Type Safety:** Each `on()` call provides full type inference for its handler; no union needed.

## Testing Hooks

- `wsFactory` for dependency injection (FakeWebSocket in tests).
- Deterministic backoff when `jitter: "none"` for reproducible tests.
- Provide helper fakes in `@ws-kit/testing` (optional):
  - `createFakeWS()`, `flushBackoff()`, `tick(ms)`.

## Usage Examples

### Sharing Schemas Between Client and Server

Schemas are portable TypeScript values using the export-with-helpers pattern (ADR-007).

Define schemas once in a shared module, import in both client and server:

```ts
// shared/schemas.ts (imported by both client and server)
import { z, message } from "@ws-kit/zod"; // Single canonical import source

export const Hello = message("HELLO", { name: z.string() });
export const HelloOk = message("HELLO_OK", { text: z.string() });
export const ChatMessage = message("CHAT", { text: z.string() });

// client.ts
import { wsClient } from "@ws-kit/client/zod"; // Typed client
import { Hello, HelloOk } from "./shared/schemas";

const client = wsClient({ url: "wss://api.example.com/ws" });
await client.connect();
client.send(Hello, { name: "Anna" });

// Full type inference via typed client
client.on(HelloOk, (msg) => {
  console.log(msg.payload.text); // Fully typed
});

// server.ts
import { createRouter } from "@ws-kit/zod";
import { Hello, HelloOk } from "./shared/schemas";

const router = createRouter();
router.on(Hello, (ctx) => {
  ctx.send(HelloOk, { text: `Hello, ${ctx.payload.name}!` });
});
```

**Tree-shaking:** Bundlers eliminate server-only code when building client bundles. Schemas are pure data structures with no server dependencies.

### 1) Basic Client with Typed Request/Response

```ts
// client.ts
import { wsClient } from "@ws-kit/client/zod"; // ✅ Typed client
import { Hello, HelloOk } from "./shared/schemas"; // Shared schemas

// Explicit connection (default for production)
const client = wsClient({ url: "wss://example.com/ws" });
await client.connect();

// Fire-and-forget (one-way)
client.send(Hello, { name: "Anna" });

// Listen for inbound messages (fully typed)
client.on(HelloOk, (msg) => {
  // ✅ msg.payload fully typed: { text: string }
  console.log("Server says:", msg.payload.text);
});

// Request/response (typed reply, auto-timeout, auto-correlationId)
try {
  const reply = await client.request(Hello, { name: "Bob" }, HelloOk, {
    timeoutMs: 5000, // Default: 30000ms
  });
  // ✅ reply fully typed: { type: "HELLO_OK", meta: {...}, payload: { text: string } }
  console.log("Reply:", reply.payload.text);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error("Server did not reply in time");
  }
}

// Option: Auto-connection (lazy init on first operation)
const client2 = wsClient({
  url: "wss://example.com/ws",
  autoConnect: true, // Lazy connect on first send/request
});
client2.send(Hello, { name: "Alice" }); // Auto-connects if closed
```

### 2) Auth with Token Refresh & Reconnect

```ts
// client.ts
import { wsClient, TimeoutError, ServerError } from "@ws-kit/client/valibot"; // ✅ Typed client
import { Hello, HelloOk, Chat } from "./shared/schemas";

const client = wsClient({
  url: "wss://api.example.com/ws",
  autoConnect: true,

  // Reconnect (exponential backoff: 300ms → 600ms → 1.2s → ... → 10s cap)
  reconnect: {
    enabled: true,
    initialDelayMs: 300, // default
    maxDelayMs: 10_000, // default (10 seconds)
    jitter: "full", // default: randomize within delay
  },

  // Queue behavior while offline (drop-newest is default)
  queue: "drop-newest", // Keep oldest messages, drop newest on overflow
  queueSize: 1000, // default

  // Auth: refresh token on each (re)connect
  auth: {
    getToken: () => localStorage.getItem("access_token"), // Called once per (re)connect
    attach: "protocol",
    protocolPrefix: "bearer.",
  },
});

// Connection lifecycle
client.onState((state) => console.debug("Connection:", state));
await client.onceOpen();

// Listen for typed inbound messages
client.on(HelloOk, (msg) => {
  // ✅ msg fully typed via Valibot inference
  console.log("Server:", msg.payload.text);
});

// Fire-and-forget with extended meta
client.send(Chat, { text: "Hi there!" }, { meta: { roomId: "general" } });

// Request/response with typed reply (auto-correlationId, 30s default timeout)
try {
  const reply = await client.request(Hello, { name: "Anna" }, HelloOk, {
    timeoutMs: 5000, // Override default 30s
  });
  // ✅ reply fully typed: { type: "HELLO_OK", meta: {...}, payload: { text: string } }
  console.log("Reply:", reply.payload.text);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error(`Timed out after ${err.timeoutMs}ms`);
  } else if (err instanceof ServerError) {
    console.error(`Server error: ${err.code}`, err.context);
  }
}

// Request with AbortSignal (cancellable, e.g., component unmount)
const controller = new AbortController();
const replyPromise = client.request(Hello, { name: "Bob" }, HelloOk, {
  signal: controller.signal,
  timeoutMs: 30000,
});

// Cancel if needed
controller.abort();

try {
  const reply = await replyPromise;
  console.log("Reply:", reply.payload.text); // ✅ Typed
} catch (err) {
  if (err instanceof StateError && err.message.includes("aborted")) {
    console.log("Request was cancelled");
  }
}

await client.close({ code: 1000, reason: "Done" });
```

### 3) Testing with a fake WebSocket

```ts
// client.test.ts
import { wsClient } from "@ws-kit/client";
import { createFakeWS } from "@ws-kit/testing";

const client = wsClient({
  url: "ws://test",
  wsFactory: (url) => createFakeWS(url),
  reconnect: { enabled: false },
});
```

## Auto-Connection Behavior

By default, client requires explicit `connect()` before sending messages. Opt-in to lazy initialization:

```typescript
const client = wsClient({
  url: "wss://api.example.com",
  autoConnect: true, // Auto-connect on first operation
});

// No explicit connect() needed
client.send(Hello, { name: "Anna" }); // Triggers connection if idle
```

**Semantics**:

- First `send()` or `request()` triggers `connect()` if `state === "closed"` AND never connected before
- `send()`: Connection errors return `false` (logged); **never throws**
- `request()`: Connection errors reject Promise; **never throws synchronously**
- State observable via `client.state` property or `client.isConnected` getter
- Applies `queue` policy after auto-connection succeeds
- Does NOT auto-reconnect from `"closed"` after manual close

**Sugar: `isConnected` getter**

```typescript
// Instead of checking state explicitly
if (client.state === "open") {
  client.send(Hello, { name: "Anna" });
}

// Use isConnected for cleaner UI code
if (client.isConnected) {
  client.send(Hello, { name: "Anna" });
}

// Works well in reactive frameworks
const buttonDisabled = !client.isConnected;
```

**When to use**:

- ✅ Prototypes/demos where connection is assumed
- ✅ Apps with single connection lifecycle
- ❌ Complex apps needing connection lifecycle control
- ❌ Cases requiring explicit error handling for connection failures

## Behavioral Notes (Do/Don't)

- **Do:** register `on(schema, handler)` before `connect()` to avoid race on early messages.
- **Do:** use `request()` for command-reply flows (auto `correlationId` + timeout).
- **Do:** use `autoConnect: true` for prototypes where connection is assumed.
- **Don't:** rely on `meta.timestamp` for server logic; the server uses `receivedAt`.
- **Don't:** mutate messages passed to handlers or `onUnhandled()` (treat as readonly).
- **Don't:** use `autoConnect: true` in complex apps needing explicit connection lifecycle control.

## Status

- **Maturity:** Alpha (client).
- **Known gaps:** No topic helpers; no heartbeats (server ping/pong recommended).
- **Planned:** Optional `subscribe(topic)` once server topic API stabilizes.
