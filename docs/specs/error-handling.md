# Error Handling

**Status**: ✅ Implemented (ErrorCode enum and patterns)

**Core Requirements**:

- Use ErrorCode enum values (not arbitrary strings)
- Provide context in errors (e.g., `{ roomId, userId }`)
- Log errors with `clientId` for traceability
- Connections stay open unless handler explicitly closes

See @rules.md#error-handling for complete rules.

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

**Explicit handler registration**: If server registers `router.onMessage(ErrorMessage, handler)`, it WILL process inbound `ERROR` messages like any other type. This is **not recommended** but allowed for custom protocols.

## Standard Error Schema

```typescript
const { ErrorMessage, ErrorCode } = createMessageSchema(z);

// Schema structure:
// {
//   type: "ERROR",
//   meta: { timestamp?, correlationId? },
//   payload: {
//     code: ErrorCode,
//     message?: string,
//     context?: Record<string, any>
//   }
// }
```

## ErrorCode Enum {#error-code-enum}

**CANONICAL DEFINITION** (reference this for error handling):

```typescript
type ErrorCode =
  | "INVALID_MESSAGE_FORMAT" // Message isn't valid JSON or lacks required structure
  | "VALIDATION_FAILED" // Message failed schema validation
  | "UNSUPPORTED_MESSAGE_TYPE" // No handler registered for this message type
  | "AUTHENTICATION_FAILED" // Client isn't authenticated or has invalid credentials
  | "AUTHORIZATION_FAILED" // Client lacks permission for the requested action
  | "RESOURCE_NOT_FOUND" // Requested resource doesn't exist
  | "RATE_LIMIT_EXCEEDED" // Client is sending messages too frequently
  | "INTERNAL_SERVER_ERROR"; // Unexpected server error occurred
```

**Usage Guidelines:**

- **Use enum values, not arbitrary strings** — Ensures consistency across handlers
- **Provide context** — Include debugging information in the `context` field (e.g., `{ roomId, userId }`)
- **Log with clientId** — Always include `ctx.ws.data.clientId` in error logs for traceability

## Sending Errors

**Note**: Error messages include a producer `meta.timestamp`; **never** base server actions on it — use `ctx.receivedAt` for server logic (see @schema.md#Which-timestamp-to-use).

```typescript
router.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  if (!roomExists(roomId)) {
    ctx.send(ErrorMessage, {
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: `Room ${roomId} does not exist`,
      context: { roomId },
    });
    return;
  }

  // Continue with normal flow
});
```

## Error Handling in Handlers

```typescript
router.onMessage(SomeMessage, async (ctx) => {
  try {
    await riskyOperation();
  } catch (error) {
    ctx.send(ErrorMessage, {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
});
```

## Broadcasting Errors

```typescript
// Notify all users in a room
publish(ctx.ws, roomId, ErrorMessage, {
  code: ErrorCode.RESOURCE_NOT_FOUND,
  message: "This room is being deleted",
  context: { roomId },
});
```

## Explicit Connection Close

Handlers must explicitly close connections when needed. The library never closes connections automatically.

```typescript
router.onMessage(RateLimitExceeded, (ctx) => {
  // Send error message first
  ctx.send(ErrorMessage, {
    code: ErrorCode.RATE_LIMIT_EXCEEDED,
    message: "Too many requests",
  });

  // Then close connection
  ctx.ws.close(1008, "Rate limit exceeded");
});
```

**When to close explicitly:**

- Security violations (auth failures, rate limits, policy violations)
- Protocol violations (client repeatedly sends malformed messages)
- Resource exhaustion (client exceeds quota)

**Normal errors** (business logic failures, not found, validation errors) should **not** close the connection.

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
