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
    // RPC-standard codes (ADR-015)
    "INVALID_ARGUMENT",
    "DEADLINE_EXCEEDED",
    "CANCELLED",
    "PERMISSION_DENIED",
    "NOT_FOUND",
    "CONFLICT",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "INTERNAL_ERROR",
    // Legacy codes (deprecated)
    "VALIDATION_ERROR",
    "AUTH_ERROR",
    "RATE_LIMIT",
  ]),
  message: z.string(),
  details: z.record(z.any()).optional(),
  retryable: z.boolean().optional(),
});

// Schema structure:
// {
//   type: "ERROR",
//   meta: { timestamp?, correlationId? },
//   payload: {
//     code: ErrorCode,
//     message: string,
//     details?: Record<string, any>,
//     retryable?: boolean
//   }
// }
```

## Standard Error Codes {#error-code-enum}

**RPC-standard codes (aligned with gRPC conventions)**:

```typescript
type RpcErrorCode =
  | "INVALID_ARGUMENT" // Schema validation or semantic validation failed
  | "DEADLINE_EXCEEDED" // RPC request timed out
  | "CANCELLED" // Request was cancelled by client or peer
  | "PERMISSION_DENIED" // Authorization failed (after successful auth)
  | "NOT_FOUND" // Requested resource doesn't exist
  | "CONFLICT" // Correlation ID collision or uniqueness constraint
  | "RESOURCE_EXHAUSTED" // Buffer overflow, rate limits, or backpressure
  | "UNAVAILABLE" // Transient infrastructure error (retriable)
  | "INTERNAL_ERROR" // Unexpected server error (unhandled exception)
  | "VALIDATION_ERROR" // @deprecated Use INVALID_ARGUMENT
  | "AUTH_ERROR" // @deprecated Use PERMISSION_DENIED
  | "RATE_LIMIT"; // @deprecated Use RESOURCE_EXHAUSTED
```

**Quick Error Selection (ADR-015)**:

| Scenario                    | Code                 | Retryable           | Example                                        |
| --------------------------- | -------------------- | ------------------- | ---------------------------------------------- |
| Schema validation failed    | `INVALID_ARGUMENT`   | No                  | Missing field, wrong type                      |
| Timeout                     | `DEADLINE_EXCEEDED`  | Yes (with backoff)  | RPC didn't complete in time                    |
| Client aborted              | `CANCELLED`          | Yes (if idempotent) | `AbortSignal` fired                            |
| Not authorized              | `PERMISSION_DENIED`  | No                  | Insufficient role/scope                        |
| Not found                   | `NOT_FOUND`          | No                  | User/resource deleted                          |
| Collision                   | `CONFLICT`           | No                  | Duplicate correlation ID, constraint violation |
| Rate limited or buffer full | `RESOURCE_EXHAUSTED` | Yes                 | Too many requests, server backpressure         |
| Network/transient error     | `UNAVAILABLE`        | Yes                 | Server temporarily unreachable                 |
| Unhandled exception         | `INTERNAL_ERROR`     | No                  | Database crash, bug                            |

Use `ctx.error(code, message, details, { retryable })` for type-safe responses. The framework logs all errors with connection identity for traceability.

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

## Error Handling in Handlers

```typescript
router.on(SomeMessage, async (ctx) => {
  try {
    await riskyOperation();
  } catch (error) {
    ctx.error("INTERNAL_ERROR", "Operation failed", {
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
    ctx.error("INTERNAL_ERROR", "File validation failed", {
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
    ctx.error("RATE_LIMIT", "Too many requests");

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

## Error Behavior

| Error Type       | Connection | Logged | Handler Called |
| ---------------- | ---------- | ------ | -------------- |
| Parse error      | Stays open | ✅     | ❌             |
| Missing type     | Stays open | ✅     | ❌             |
| No handler       | Stays open | ✅     | ❌             |
| Validation fails | Stays open | ✅     | ❌             |
| Handler throws   | Stays open | ✅     | N/A            |
| Async rejection  | Stays open | ✅     | N/A            |

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
