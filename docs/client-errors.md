# Error Handling

The WebSocket client provides comprehensive error handling with type-safe error classes and centralized reporting.

## Quick Reference

- **Error Classes**: See [#error-classes](#error-classes) for all available error types
- **Error Codes**: See [RpcError section](#rpcerror-advanced) for the 13 standard error codes (gRPC-aligned)
- **Error Patterns**: See [#error-patterns](#error-patterns) for common error handling examples
- **Centralized Reporting**: See [#centralized-error-reporting](#centralized-error-reporting) for logging integration
- **Server-side errors**: See `docs/specs/error-handling.md` for server error specification

## Error Classes

Import error classes from the client package:

```typescript
import {
  ValidationError,
  TimeoutError,
  ServerError,
  ConnectionClosedError,
  StateError,
  RpcError,
  WsDisconnectedError,
  type RpcErrorCode,
} from "@ws-kit/client";
```

**Error classes:**

- `ValidationError` - Message validation failures
- `TimeoutError` - Request timeouts
- `ServerError` - Server error responses with error codes and optional retry hints
- `ConnectionClosedError` - Connection closed during request
- `StateError` - Invalid operation state
- `RpcError` - Enhanced RPC error with retry hints, `retryAfterMs`, and correlation tracking
- `WsDisconnectedError` - Disconnection error for auto-resend and idempotency support
- `RpcErrorCode` - Type for 13 standard error codes aligned with gRPC (per ADR-015)

**Note**: Error codes are aligned with the server-side error handling specification (see `docs/specs/error-handling.md`). The same 13 standard codes are used on both client and server for consistency.

### ValidationError

Thrown when message validation fails (outbound or inbound).

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string[]; message: string }>
  );
}
```

**Occurs when:**

- Outbound: Payload doesn't match schema before sending
- Inbound: Server reply has wrong type or fails schema validation

**Example:**

```typescript
try {
  await client.request(Hello, { name: "test" }, HelloOk);
} catch (err) {
  if (err instanceof ValidationError) {
    console.error("Validation failed:", err.message);
    err.issues.forEach((issue) => {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    });
  }
}
```

### TimeoutError

Thrown when request times out.

```typescript
class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number);
}
```

**Occurs when:**

- No reply received within `timeoutMs`
- `correlationId` never matched

**Example:**

```typescript
try {
  await client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
  });
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn(`Request timed out after ${err.timeoutMs}ms`);
    // Retry or show user feedback
  }
}
```

### ServerError

Thrown when server sends error response.

```typescript
class ServerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  );
}
```

**Occurs when:**

- Server sends `ERROR` message with matching `correlationId`

**Example:**

```typescript
try {
  await client.request(DeleteItem, { id: 123 }, DeleteItemOk);
} catch (err) {
  if (err instanceof ServerError) {
    console.error(`Server error: ${err.code}`, err.context);

    if (err.code === "NOT_FOUND") {
      console.warn("Item not found");
    } else if (err.code === "UNAUTHENTICATED") {
      redirectToLogin();
    }
  }
}
```

**Note**: The server's ERROR payload uses `details` field (per ADR-015), but the client's `ServerError` class currently uses `context` for backward compatibility. This will be unified when `RpcError` replaces `ServerError` in a future release.

### ConnectionClosedError

Thrown when connection closes before reply.

```typescript
class ConnectionClosedError extends Error {}
```

**Occurs when:**

- Connection closes while waiting for request reply
- Server disconnects before responding

**Example:**

```typescript
try {
  await client.request(Hello, { name: "test" }, HelloOk);
} catch (err) {
  if (err instanceof ConnectionClosedError) {
    console.warn("Connection closed before reply");
    // Reconnect or show offline UI
  }
}
```

### StateError

Thrown when operation is invalid in current state.

```typescript
class StateError extends Error {}
```

**Occurs when:**

- Request aborted via `AbortSignal`
- `request()` called with `queue: "off"` while disconnected
- Pending request limit exceeded

**Example:**

```typescript
const controller = new AbortController();

const promise = client.request(Hello, { name: "test" }, HelloOk, {
  signal: controller.signal,
});

// Cancel request
controller.abort();

try {
  await promise;
} catch (err) {
  if (err instanceof StateError) {
    console.log("Request aborted");
  }
}
```

### RpcError

Enhanced error class for RPC operations with retry hints and correlation tracking. **Preferred over `ServerError` for new code.** Includes gRPC-aligned error codes and client-driven retry semantics.

```typescript
class RpcError<TCode extends RpcErrorCode = RpcErrorCode> extends Error {
  constructor(
    message: string,
    public readonly code: TCode,
    public readonly details?: unknown,
    public readonly retryable?: boolean,
    public readonly retryAfterMs?: number,
    public readonly correlationId?: string
  );
}
```

**Standard error codes** (per ADR-015, gRPC-aligned):

**Terminal errors** (don't auto-retry):

- `UNAUTHENTICATED` - Missing or invalid authentication
- `PERMISSION_DENIED` - Authenticated but insufficient permissions
- `INVALID_ARGUMENT` - Input validation failed
- `FAILED_PRECONDITION` - Stateful precondition not met
- `NOT_FOUND` - Resource does not exist
- `ALREADY_EXISTS` - Uniqueness or idempotency violation
- `ABORTED` - Concurrency conflict (race condition)

**Transient errors** (retry with backoff):

- `DEADLINE_EXCEEDED` - RPC timed out
- `RESOURCE_EXHAUSTED` - Rate limit, quota, or buffer overflow
- `UNAVAILABLE` - Transient infrastructure error

**Server/evolution**:

- `UNIMPLEMENTED` - Feature not supported or deployed
- `INTERNAL` - Unexpected server error (unhandled exception)
- `CANCELLED` - Call cancelled (client disconnect, abort)

See [Error Handling Spec](./specs/error-handling.md) for complete error code taxonomy and retry semantics.

**Usage example:**

```typescript
try {
  const result = await client.request(GetUser, { id: "123" });
} catch (err) {
  if (err instanceof RpcError) {
    if (err.code === "RESOURCE_EXHAUSTED" && err.retryAfterMs) {
      // Type-narrowed: retryAfterMs is present
      await sleep(err.retryAfterMs);
      // Retry request
    } else if (err.code === "UNAUTHENTICATED") {
      redirectToLogin();
    }
  }
}
```

### WsDisconnectedError (Future)

Enhanced disconnection error with idempotency support. Defined in the codebase but **not yet used** by the client implementation. Future versions will use this for more sophisticated reconnection handling.

```typescript
class WsDisconnectedError extends Error {
  constructor(message = "WebSocket disconnected");
}
```

**Future behavior:**

When connection closes during an RPC request:

- If `idempotencyKey` is provided, client auto-resends on reconnect within `resendWindowMs` (default 5000ms)
- This error is only thrown if reconnect happens too late or `idempotencyKey` is not set
- Without `idempotencyKey`, the current `ConnectionClosedError` is thrown immediately

**Current behavior**: The client currently throws `ConnectionClosedError` for all disconnections during RPC requests. Idempotency-aware reconnection is planned but not yet implemented.

## Error Patterns

### Fire-and-Forget (send)

`send()` **never throws** - use return value:

```typescript
const sent = client.send(ChatMessage, { text: "Hello!" });

if (!sent) {
  console.warn("Message dropped (offline, queue full, or invalid)");
  // Show user feedback, don't retry
}
```

**Returns `false` when:**

- `queue === "off"` while offline
- Queue overflow with `queue === "drop-newest"`
- Payload validation fails

### Request/Response

`request()` **never throws synchronously** - always returns Promise:

```typescript
try {
  const reply = await client.request(Hello, { name: "Anna" }, HelloOk, {
    timeoutMs: 5000,
  });

  console.log("Success:", reply.payload);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn("Timeout - retry or show feedback");
  } else if (err instanceof ServerError) {
    console.error("Server error:", err.code);
    // Handle specific error codes
    if (err.code === "UNAUTHENTICATED") {
      redirectToLogin();
    } else if (err.code === "NOT_FOUND") {
      showNotFound();
    }
  } else if (err instanceof ConnectionClosedError) {
    console.warn("Disconnected - reconnecting...");
  } else if (err instanceof ValidationError) {
    console.error("Invalid data:", err.issues);
  } else if (err instanceof StateError) {
    console.log("Request cancelled or limit exceeded");
  }
}
```

### Connection Errors

`connect()` rejects on connection failure:

```typescript
try {
  await client.connect();
  console.log("Connected!");
} catch (err) {
  console.error("Connection failed:", err.message);
  // Show offline UI or retry
}
```

`close()` **never rejects** - always safe:

```typescript
// Always safe, never throws
await client.close({ code: 1000, reason: "Done" });
```

## Centralized Error Reporting

Use `onError()` for non-fatal internal errors:

```typescript
client.onError((error, context) => {
  switch (context.type) {
    case "parse":
      // Invalid JSON from server
      console.warn("Parse error:", error.message);
      Sentry.captureException(error, { tags: { type: "ws-parse" } });
      break;

    case "validation":
      // Message validation failed
      console.warn("Validation error:", error.message, context.details);
      Sentry.captureException(error, {
        tags: { type: "ws-validation" },
        extra: context.details,
      });
      break;

    case "overflow":
      // Queue overflow (message dropped)
      console.warn("Queue overflow:", error.message);
      metrics.increment("ws.queue.overflow");
      break;

    case "unknown":
      // Other internal errors
      console.warn("Unknown error:", error.message, context.details);
      Sentry.captureException(error, { tags: { type: "ws-unknown" } });
      break;
  }
});
```

**Fires for:**

- Parse failures (invalid JSON)
- Validation failures (invalid messages)
- Queue overflow (message dropped)
- Unknown internal errors

**Does NOT fire for:**

- `request()` rejections (caller handles with try/catch)
- Handler errors (automatically logged to `console.error`)

### Integration Examples

#### Sentry

```typescript
import * as Sentry from "@sentry/browser";

client.onError((error, context) => {
  Sentry.captureException(error, {
    tags: {
      source: "websocket",
      errorType: context.type,
    },
    extra: context.details,
  });
});
```

#### DataDog

```typescript
import { datadogLogs } from "@datadog/browser-logs";

client.onError((error, context) => {
  datadogLogs.logger.error("WebSocket error", {
    error: error.message,
    type: context.type,
    details: context.details,
  });
});
```

#### Custom Metrics

```typescript
const errorCounts = new Map<string, number>();

client.onError((error, context) => {
  const count = errorCounts.get(context.type) || 0;
  errorCounts.set(context.type, count + 1);

  // Send to analytics
  analytics.track("websocket_error", {
    type: context.type,
    message: error.message,
    count: count + 1,
  });
});
```

## Handler Errors

Handler errors are automatically logged to `console.error` and don't stop other handlers:

```typescript
client.on(HelloOk, (msg) => {
  throw new Error("Handler error");
  // Logged to console.error
  // Other handlers still execute
});

client.on(HelloOk, (msg) => {
  console.log("This still runs!");
});
```

## Error Recovery

### Retry Pattern

```typescript
async function sendWithRetry(
  schema: AnyMessageSchema,
  payload: any,
  maxRetries = 3,
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const reply = await client.request(schema, payload, ReplySchema, {
        timeoutMs: 5000,
      });
      return reply;
    } catch (err) {
      if (err instanceof TimeoutError && i < maxRetries - 1) {
        console.warn(`Retry ${i + 1}/${maxRetries}`);
        await sleep(1000 * (i + 1)); // Exponential backoff
        continue;
      }
      throw err;
    }
  }
}
```

### Graceful Degradation

```typescript
client.onUnhandled((msg) => {
  console.warn("Unhandled message type:", msg.type);

  // Show generic notification instead of failing
  if (msg.type.startsWith("NOTIFY_")) {
    showNotification(msg.payload?.text || "New notification");
  }
});
```

### Connection State Recovery

```typescript
client.onState((state) => {
  switch (state) {
    case "open":
      console.log("Connected - hiding offline UI");
      hideOfflineUI();
      break;

    case "reconnecting":
      console.log("Reconnecting - showing spinner");
      showReconnectingUI();
      break;

    case "closed":
      console.log("Disconnected - showing offline UI");
      showOfflineUI();
      break;
  }
});
```

## Best Practices

### Always Handle Request Errors

```typescript
// ✅ Good
try {
  const reply = await client.request(Hello, { name: "test" }, HelloOk);
  console.log(reply.payload);
} catch (err) {
  if (err instanceof TimeoutError) {
    showError("Request timed out");
  } else if (err instanceof ServerError) {
    showError(`Server error: ${err.code}`);
  }
}

// ❌ Bad - unhandled rejection
const reply = await client.request(Hello, { name: "test" }, HelloOk);
```

### Check send() Return Value

```typescript
// ✅ Good
const sent = client.send(ChatMessage, { text: "Hi" });
if (!sent) {
  showWarning("Message not sent (offline)");
}

// ❌ Bad - ignoring failure
client.send(ChatMessage, { text: "Hi" });
```

### Use Centralized Error Reporting

```typescript
// ✅ Good - centralized
client.onError((error, context) => {
  logError(error, context);
});

// ❌ Bad - scattered try/catch everywhere
try {
  client.send(...);
} catch (err) {
  logError(err);  // Won't catch internal errors
}
```

### Validate User Input

```typescript
// ✅ Good - validate before sending
function sendMessage(text: string) {
  if (!text.trim()) {
    showError("Message cannot be empty");
    return;
  }

  const sent = client.send(ChatMessage, { text });
  if (!sent) {
    showError("Failed to send (offline)");
  }
}

// ❌ Bad - no validation
function sendMessage(text: string) {
  client.send(ChatMessage, { text }); // May fail validation
}
```
