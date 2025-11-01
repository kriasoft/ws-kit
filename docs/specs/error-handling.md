# Error Handling

**Status**: ✅ Implemented (ADR-009: Error Handling and Lifecycle Hooks)

**Core Requirements** (see ADR-009 for design rationale):

- Use type-safe `ctx.error()` helper with discriminated union error codes
- Provide context in error details (e.g., `{ roomId, userId }`)
- Log errors with `clientId` for traceability
- Connections stay open unless handler explicitly closes
- Unhandled errors trigger `onError` lifecycle hook (if registered in serve options)

See @rules.md#error-handling and ADR-009 for complete rules.

**Note**: Error semantics are **identical across all adapters** (Bun, Cloudflare DO, Deno). For adapter-specific behavior, see `docs/specs/adapters.md`.

## Error Message Direction {#Error-Message-Direction}

**`ERROR` type messages are server-to-client only.**

Clients MUST NOT send `ERROR` type messages. Use instead:

- **Connection close codes** for transport errors (`ws.close(1011, "reason")`)
- **Application messages** for business errors (e.g., `UPLOAD_FAILED` schema)

**Server behavior**: Inbound `ERROR` messages from clients are undefined. Servers MAY:

- Log and ignore (recommended)
- Close connection with protocol error (`1002`)
- Treat as unhandled message type (if no handler registered)

**Rationale**: Reserving `ERROR` for server responses simplifies protocol semantics and prevents clients from injecting error-handling logic into request/response flows.

**Explicit handler registration**: If server registers `router.on(ErrorMessage, handler)`, it WILL process inbound `ERROR` messages like any other type. This is **not recommended** but allowed for custom protocols.

## Standard Error Schema

```typescript
import { z, message } from "@ws-kit/zod";
// or: import { v, message } from "@ws-kit/valibot";

const ErrorMessage = message("ERROR", {
  code: z.enum([
    // Standard codes (13) - per ADR-015, gRPC-aligned
    // Terminal errors (don't auto-retry):
    "UNAUTHENTICATED",
    "PERMISSION_DENIED",
    "INVALID_ARGUMENT",
    "FAILED_PRECONDITION",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "ABORTED",
    // Transient errors (retry with backoff):
    "DEADLINE_EXCEEDED",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    // Server/evolution:
    "UNIMPLEMENTED",
    "INTERNAL",
    "CANCELLED",
  ]),
  message: z.string().optional(),
  details: z.record(z.any()).optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.union([z.number().int().nonnegative(), z.null()]).optional(),
});

// Unified wire format for both ERROR and RPC_ERROR:
// {
//   type: "ERROR" | "RPC_ERROR",
//   meta: {
//     timestamp: number,          // always present (server-generated)
//     correlationId?: string      // present for RPC_ERROR; absent for ERROR
//   },
//   payload: {
//     code: ErrorCode,
//     message?: string,
//     details?: Record<string, any>,
//     retryable?: boolean,        // inferred from code if omitted
//     retryAfterMs?: number | null // backoff hint for transient errors
//                                  // - number (≥0): retry after this many ms
//                                  // - null: operation impossible under policy (non-retryable)
//                                  // - absent: no retry guidance
//   }
// }
//
// Note: When an RPC message fails validation before a valid correlationId can be
// extracted, the server sends ERROR (not RPC_ERROR) with code INVALID_ARGUMENT,
// since the error cannot be correlated back to the request.
```

## Standard Error Codes {#error-code-enum}

**Standard codes (per ADR-015, gRPC-aligned, 13 codes)**:

For the complete error taxonomy, detailed rationale, and decision tree, see **[ADR-015](../adr/015-unified-rpc-api-design.md)** (section 3.3: Error Code Reference & Decision Matrix).

**Quick reference** — use the code that best matches your scenario:

- **Authentication/Authorization**: `UNAUTHENTICATED` (missing/invalid token), `PERMISSION_DENIED` (authorized but insufficient rights)
- **Input/Validation**: `INVALID_ARGUMENT` (validation failed), `FAILED_PRECONDITION` (state not ready)
- **Resource Issues**: `NOT_FOUND` (doesn't exist), `ALREADY_EXISTS` (duplicate/idempotency violation), `ABORTED` (race condition)
- **Transient Issues**: `DEADLINE_EXCEEDED` (timeout), `RESOURCE_EXHAUSTED` (rate limit/buffer full), `UNAVAILABLE` (temporarily unreachable)
- **Server/Evolution**: `UNIMPLEMENTED` (feature not deployed), `INTERNAL` (unexpected error), `CANCELLED` (user/peer cancelled)

Use `ctx.error(code, message, details)` for type-safe responses. The framework logs all errors with connection identity for traceability.

### Authoritative Error Code Table

| Code                  | Retryable | Description                                                | `retryAfterMs` rule    |
| --------------------- | --------- | ---------------------------------------------------------- | ---------------------- |
| `UNAUTHENTICATED`     | ❌ No     | Auth token missing, expired, or invalid                    | Forbidden              |
| `PERMISSION_DENIED`   | ❌ No     | Authenticated but lacks rights (authZ)                     | Forbidden              |
| `INVALID_ARGUMENT`    | ❌ No     | Input validation or semantic violation                     | Forbidden              |
| `FAILED_PRECONDITION` | ❌ No     | State requirement not met                                  | Forbidden              |
| `NOT_FOUND`           | ❌ No     | Target resource absent                                     | Forbidden              |
| `ALREADY_EXISTS`      | ❌ No     | Uniqueness or idempotency replay violation                 | Forbidden              |
| `UNIMPLEMENTED`       | ❌ No     | Feature not supported or deployed                          | Forbidden              |
| `CANCELLED`           | ❌ No     | Call cancelled (client disconnect, timeout abort)          | Forbidden              |
| `DEADLINE_EXCEEDED`   | ✅ Yes    | RPC timed out (retry immediately)                          | Optional               |
| `RESOURCE_EXHAUSTED`  | ✅ Yes    | Rate limit, quota, or buffer overflow                      | Optional (recommended) |
| `UNAVAILABLE`         | ✅ Yes    | Transient infrastructure error                             | Optional               |
| `ABORTED`             | ✅ Yes    | Concurrency conflict (race condition)                      | Optional               |
| `INTERNAL`            | ⚠️ Maybe  | Unexpected server error (bug); server decides if retryable | Optional               |

**Client Inference Rules**:

- If `retryable` field is **present**, use its value
- If `retryable` field is **absent**:
  - Infer `true` for transient codes (`DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `ABORTED`)
  - Infer `false` for terminal codes (all others)
  - For `INTERNAL`, infer `false` (conservative: assume bug, don't retry)

**Server Validation Rules**:

- For codes marked "Forbidden": `retryAfterMs` **must be absent**
- For codes marked "Optional": `retryAfterMs` may be present when server has a backoff hint
- For codes marked "Recommended" (e.g., `RESOURCE_EXHAUSTED`): servers **should** include `retryAfterMs` when due to backpressure or rate limiting
- `retryAfterMs: null` signals a non-retryable failure (e.g., cost exceeds capacity in rate limiting). Use `FAILED_PRECONDITION` with `retryAfterMs: null` for impossible operations
- Example retryable: `ctx.error("RESOURCE_EXHAUSTED", "Rate limited", undefined, { retryable: true, retryAfterMs: 100 })`
- Example impossible: `ctx.error("FAILED_PRECONDITION", "Operation cost exceeds limit", undefined, { retryable: false, retryAfterMs: null })`

### Extending Error Codes

Add domain-specific error codes by extending the base enum:

```typescript
type AppErrorCode =
  | ErrorCode
  | "INVALID_ROOM_NAME"
  | "DUPLICATE_USER"
  | "SUBSCRIPTION_EXPIRED";

// Type-safe helper for custom codes
declare global {
  interface ErrorCodeMap {
    INVALID_ROOM_NAME: true;
    DUPLICATE_USER: true;
    SUBSCRIPTION_EXPIRED: true;
  }
}

// Use extended codes with ctx.error()
router.on(CreateRoom, (ctx) => {
  if (!isValidRoomName(ctx.payload.name)) {
    ctx.error("INVALID_ROOM_NAME", "Room name must be 3-50 characters", {
      name: ctx.payload.name,
    });
    return;
  }
});
```

**Guidelines:**

- Extend with domain-specific, actionable codes
- Provide context in `details` (e.g., `{ roomId, field, reason }`)
- Keep error messages human-readable and helpful
- Errors are automatically logged with `clientId` for debugging

## Reserved Control Message Namespace {#control-namespace}

The `$ws:` prefix is **reserved** for system messages sent by ws-kit. Do not use this prefix in your application message types.

**System Control Messages:**

- `$ws:rpc-progress` — Non-terminal RPC progress updates (used internally by `ctx.progress()`)
- `$ws:abort` — RPC cancellation request (client-initiated, used internally by AbortSignal support)

Future system messages may use this namespace, so applications must avoid colliding with names like:

- `$ws:cancel`
- `$ws:ping`
- `$ws:pong`
- `$ws:keepalive`

**Example (do NOT register handlers for):**

```typescript
// ❌ Avoid this
router.on({ type: "$ws:custom-message" }, (ctx) => {
  // This will conflict with future system messages
});

// ✅ Use your own prefix instead
router.on({ type: "APP:custom-message" }, (ctx) => {
  // This is safe and explicit
});
```

## Sending Errors

### Using ctx.error() (Recommended)

Use the `ctx.error()` helper for type-safe error sending:

```typescript
router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  if (!roomExists(roomId)) {
    // ✅ Type-safe: code is validated against ErrorCode enum
    ctx.error("NOT_FOUND", `Room ${roomId} does not exist`, {
      roomId,
    });
    return;
  }

  // Continue with normal flow
});
```

**Note**: Error messages include a producer `meta.timestamp`; **never** base server actions on it — use `ctx.receivedAt` for server logic (see @schema.md#Which-timestamp-to-use).

### Error Detail Sanitization

Error details are automatically sanitized before transmission to prevent accidental credential leaks.

**Forbidden keys (case-insensitive)**: `password`, `token`, `authorization`, `bearer`, `jwt`, `apikey`, `api_key`, `accesstoken`, `access_token`, `refreshtoken`, `refresh_token`, `cookie`, `secret`, `credentials`, `auth`

**Size limits**: Nested objects (JSON > 500 chars) and oversized values are omitted. If all details are stripped, the `details` field is omitted entirely.

**Note**: Sanitization is a **safety net**, not a substitute for careful error design. Always think before including details:

- ✅ Include: Resource IDs, field names, error context for troubleshooting
- ❌ Avoid: Passwords, tokens, API keys, internal state, huge blobs

## Error Handling in Handlers

```typescript
router.on(SomeMessage, async (ctx) => {
  try {
    await riskyOperation();
  } catch (error) {
    ctx.error("INTERNAL", "Operation failed", {
      reason: String(error),
    });
    // onError hook will be called with this error
  }
});
```

### Async Error Handling

Unhandled promise rejections in handlers are caught and trigger the `onError` lifecycle hook:

```typescript
router.on(AsyncMessage, async (ctx) => {
  // This error will be caught by the router
  // and onError(error, { type: "ASYNC_MESSAGE", userId: "..." }) will be called
  const result = await unstableAPI();
  ctx.send(AsyncResponse, result);
});
```

## Broadcasting Errors

Send domain-specific error notifications to rooms or channels:

```typescript
const RoomDeletedMessage = message("ROOM_DELETED", { roomId: z.string() });

router.on(DeleteRoomMessage, (ctx) => {
  const { roomId } = ctx.payload;

  // Notify all users in the room of deletion
  router.publish(`room:${roomId}`, RoomDeletedMessage, {
    roomId,
  });
});

// For cross-connection validation errors
router.on(ValidateFileMessage, (ctx) => {
  try {
    const result = await validateFile(ctx.payload.fileId);
    router.publish(`validation:${ctx.payload.fileId}`, FileValidated, result);
  } catch (error) {
    // Send error to all listeners
    ctx.error("INTERNAL", "File validation failed", {
      fileId: ctx.payload.fileId,
      reason: String(error),
    });
  }
});
```

**Note**: Use domain-specific message types (e.g., `ROOM_DELETED`, `FILE_VALIDATION_FAILED`) for broadcast errors. The ERROR message type is for point-to-point responses.

## Explicit Connection Close

Handlers must explicitly close connections when needed. The library never closes connections automatically.

```typescript
router.use(SendMessage, (ctx, next) => {
  if (isRateLimited(ctx.ws.data?.userId)) {
    // Send error message first
    ctx.error("RESOURCE_EXHAUSTED", "Too many requests");

    // Then close connection
    ctx.ws.close(1008, "Rate limit exceeded");
    return; // Skip handler
  }
  return next();
});
```

**When to close explicitly:**

- Security violations (auth failures, rate limits, policy violations)
- Protocol violations (client repeatedly sends malformed messages)
- Resource exhaustion (client exceeds quota)

**Normal errors** (business logic failures, not found, validation errors) should **not** close the connection.

**Connection Close Codes**:

- `1008` — Policy Violation (rate limit, security policy)
- `1009` — Message Too Big (payload exceeds limit)
- `1011` — Server Error (unexpected server failure)

## Limits Monitoring {#limits-monitoring}

Payload size limits are enforced at the protocol level (before message validation). When a client sends a message exceeding the configured limit, the router:

1. **Calls the `onLimitExceeded` hook** with structured limit information
2. **Sends a `RESOURCE_EXHAUSTED` error** or **closes the connection** (configurable)
3. **Does NOT call `onError`** (limit violations are protocol, not handler errors)

### Configuration

```typescript
import { createRouter } from "@ws-kit/zod";

const router = createRouter({
  limits: {
    maxPayloadBytes: 1_000_000, // 1MB (default)

    // How to respond when limit exceeded
    onExceeded: "send", // Send RESOURCE_EXHAUSTED error (default)
    // "close" — Close with code 1009
    // "custom" — Do nothing (app handles in hook)

    // WebSocket close code when onExceeded === "close"
    closeCode: 1009, // RFC 6455 "Message Too Big" (default)
  },

  hooks: {
    onLimitExceeded: (info) => {
      // info.type = "payload" (extensible for future limits)
      // info.observed = actual payload size (bytes)
      // info.limit = configured limit
      // info.clientId = client identifier
      // info.ws = WebSocket connection

      // Emit metrics/alerts
      metrics.increment("limits.exceeded", {
        type: info.type,
        clientId: info.clientId,
        overage: info.observed - info.limit,
      });
    },
  },
});
```

### Behavior by Mode

| Mode     | Response to Client          | Connection | Hook Called |
| -------- | --------------------------- | ---------- | ----------- |
| `send`   | `ERROR: RESOURCE_EXHAUSTED` | Stays open | ✅          |
| `close`  | None (closes immediately)   | Closes     | ✅          |
| `custom` | None (up to app)            | Stays open | ✅          |

### Payload Limit → RESOURCE_EXHAUSTED Mapping

When `onExceeded: "send"`:

```json
{
  "type": "ERROR",
  "code": "RESOURCE_EXHAUSTED",
  "message": "Payload size exceeds limit (2000001 > 1000000)",
  "details": {
    "observed": 2000001,
    "limit": 1000000
  },
  "retryAfterMs": 0
}
```

Clients should treat `RESOURCE_EXHAUSTED` as transient and may retry with smaller payloads. When `onExceeded: "close"`, the connection closes with code `1009`.

### Rate Limit → RESOURCE_EXHAUSTED or FAILED_PRECONDITION Mapping

Rate limiting via `@ws-kit/middleware` uses the same error handling pipeline as payload limits. When a request exceeds the rate limit:

**Case 1: Retryable (attempted cost ≤ capacity)**:

```json
{
  "type": "ERROR",
  "code": "RESOURCE_EXHAUSTED",
  "message": "Rate limit exceeded",
  "details": {
    "observed": 1,
    "limit": 1
  },
  "retryAfterMs": 1250
}
```

Clients should retry after `retryAfterMs` milliseconds with the same request.

**Case 2: Impossible (attempted cost > capacity)**:

```json
{
  "type": "ERROR",
  "code": "FAILED_PRECONDITION",
  "message": "Operation cost exceeds rate limit capacity (5 > 3)",
  "details": {
    "observed": 5,
    "limit": 3
  }
}
```

Clients should NOT retry this operation under the current policy (cost exceeds capacity). Suggest contacting server admin or using a different approach.

### Example: Rate Limiting with Metrics and Alerts

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

const rateLimitMiddleware = rateLimit({
  limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 10 }),
  key: keyPerUserPerType,
});

serve(router, {
  middleware: [rateLimitMiddleware],

  onLimitExceeded(info) {
    if (info.type === "rate") {
      // Track rate limit violations
      const isImpossible =
        info.retryAfterMs === null || info.retryAfterMs === undefined;

      console.warn(
        `[RateLimit] ${info.clientId}: ${info.observed} tokens (capacity: ${info.limit})`,
        {
          retryAfterMs: info.retryAfterMs,
          impossible: isImpossible,
        },
      );

      // Emit metrics for monitoring
      metrics.histogram("rate_limit_violations", {
        observed: info.observed,
        limit: info.limit,
        retryable: !isImpossible,
      });

      // Alert on repeated violations (potential abuse)
      const violations = cache.incr(`rate_violations:${info.clientId}`, 60); // 60s TTL
      if (violations > 10) {
        alerts.notify("HIGH_RATE_LIMIT_VIOLATIONS", {
          clientId: info.clientId,
          violations,
        });
      }
    }
  },
});
```

For complete rate limiting API and adapter implementations, see **[@ws-kit/middleware](https://github.com/kriasoft/ws-kit/tree/main/packages/middleware)** and **[rate limiting proposal](../proposals/rate-limiting.md)**.

### Example: Rate Limiting with Limits Monitoring

```typescript
const router = createRouter({
  limits: {
    maxPayloadBytes: 5_000_000, // 5MB
    onExceeded: "send",
  },
  hooks: {
    onLimitExceeded: async (info) => {
      // Check for repeated violations (potential abuse)
      const violations = await redis.incr(`limit_violations:${info.clientId}`);
      await redis.expire(`limit_violations:${info.clientId}`, 60);

      if (violations > 5) {
        // Ban client after 5 violations in 1 minute
        info.ws.close(1008, "POLICY_VIOLATION");
      }

      // Emit metrics for SLOs
      metrics.histogram("payload_size_violations", {
        observed: info.observed,
        limit: info.limit,
        clientId: info.clientId,
      });
    },
  },
});
```

## Error Behavior

| Error Type       | Connection | Logged | Handler Called    |
| ---------------- | ---------- | ------ | ----------------- |
| Limit exceeded   | Config¹    | ✅     | `onLimitExceeded` |
| Parse error      | Stays open | ✅     | ❌                |
| Missing type     | Stays open | ✅     | ❌                |
| No handler       | Stays open | ✅     | ❌                |
| Validation fails | Stays open | ✅     | ❌                |
| Handler throws   | Stays open | ✅     | `onError`         |
| Async rejection  | Stays open | ✅     | `onError`         |

¹ When `onExceeded: "send"` (default), connection stays open. When `onExceeded: "close"`, connection closes with code 1009.

**Critical**: Connections never auto-close on errors. Handler must explicitly call `ctx.ws.close()`.

## Process-Level Error Handling

**Out of scope:** The router handles message-level errors (parse, validation, handler exceptions). Process-level concerns (unhandled promise rejections, uncaught exceptions) are managed by the Bun runtime.

**Best practice:** Configure process-level error handlers in your application entry point:

```typescript
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection:", reason);
  // Send to error tracking service (Sentry, DataDog, etc.)
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  // Log and potentially exit gracefully
});
```

See [Bun Error Handling](https://bun.sh/docs/runtime/error-handling) for runtime configuration.

## Structured Error Objects for Observability

WsKitError provides standardized error objects for integration with observability tools (ELK, Sentry, DataDog, etc.).

### WsKitError Structure

All errors passed to `onError` handlers are standardized as `WsKitError` objects:

```typescript
import { WsKitError } from "@ws-kit/core";

// WsKitError follows WHATWG Error standard with protocol-specific fields:
class WsKitError extends Error {
  code: WsKitErrorCode; // Error code (e.g., INVALID_ARGUMENT)
  message: string; // Human-readable message
  details: Record<string, unknown>; // Additional context for client
  retryAfterMs?: number; // For transient errors
  correlationId?: string; // For distributed tracing
  cause?: unknown; // WHATWG standard: original error for debugging
}
```

### Error Handler with Structured Logging

The `onError` handler receives a fully structured `WsKitError` ready for logging:

```typescript
import { createRouter } from "@ws-kit/zod";
import { WsKitError } from "@ws-kit/core";

const router = createRouter();

// onError handler receives WsKitError
router.onError((error, context) => {
  // error is a WsKitError with code, message, details, and cause (WHATWG standard)

  // Send to observability tool
  logger.error({
    code: error.code,
    message: error.message,
    details: error.details,
    context: {
      type: context.type,
      clientId: context.ws.data?.clientId,
      receivedAt: context.receivedAt,
    },
    stack: error.stack,
    // Original error is in error.cause (WHATWG standard)
    cause:
      error.cause instanceof Error
        ? {
            name: error.cause.name,
            message: error.cause.message,
            stack: error.cause.stack,
          }
        : error.cause,
  });
});
```

### Creating Errors Programmatically

Use `WsKitError.from()` to create errors, or `WsKitError.wrap()` to preserve the original error as cause:

```typescript
router.on(CreateUser, (ctx) => {
  try {
    const user = await db.users.create(ctx.payload);
    ctx.send(UserCreated, user);
  } catch (err) {
    // Wrap unhandled errors with context (original error becomes cause)
    throw WsKitError.wrap(err, "INTERNAL", "Failed to create user", {
      email: ctx.payload.email,
    });
  }
});
```

### JSON Serialization for Logging

`WsKitError` provides both internal and client-safe serialization:

```typescript
const error = WsKitError.from("INVALID_ARGUMENT", "Email is required", {
  field: "email",
});

// For internal logging (includes cause, stack, retryAfterMs, etc.)
JSON.stringify(error.toJSON());
// {
//   "code": "INVALID_ARGUMENT",
//   "message": "Email is required",
//   "details": { "field": "email" },
//   "stack": "Error at ...",
//   "cause": null  // WHATWG standard (only present if set)
// }

// For client transmission (excludes cause, stack, debug info)
error.toPayload();
// {
//   "code": "INVALID_ARGUMENT",
//   "message": "Email is required",
//   "details": { "field": "email" }
// }
```

### Error Handler Return Value

Return `false` from `onError` to suppress automatic error response:

```typescript
router.onError((error) => {
  logger.error(error); // Log the error
  return false; // Prevent automatic ERROR message to client
});
```

When the handler returns `false` and `autoSendErrorOnThrow` is enabled, the router will NOT send an `INTERNAL` response to the client.
