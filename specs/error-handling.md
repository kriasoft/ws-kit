# Error Handling

**Status**: ✅ Implemented (ErrorCode enum and patterns)

See @constraints.md#error-handling for core requirements.

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

## Key Constraints

> See @constraints.md for complete rules. Critical for error handling:

1. **Use ErrorCode enum** — No arbitrary strings; ensures consistency (see @error-handling.md#error-code-enum)
2. **Provide context** — Include debugging info in `context` field (e.g., `{ roomId, userId }`)
3. **Log with clientId** — Always include `ctx.ws.data.clientId` for traceability (see @constraints.md#error-handling)
4. **Explicit close required** — Connections stay open; handler MUST call `ctx.ws.close()` to disconnect (see @constraints.md#error-handling)
