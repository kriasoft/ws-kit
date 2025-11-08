# @ws-kit/core

Platform-agnostic WebSocket router and type system with composition-based adapter support.

## Purpose

`@ws-kit/core` provides the foundation for WS-Kit: a single `WebSocketRouter<V>` class (generic over validator adapter), platform-agnostic lifecycle hooks, message routing, and pluggable adapter interfaces.

## Scope (What Core IS)

- **Platform-agnostic router**: Single `WebSocketRouter<V>` class, works with any platform
- **Adapter interfaces**: `ValidatorAdapter`, `PlatformAdapter`, and `PubSub` abstractions
- **Lifecycle hooks**: `onAuth`, `onClose`, `onError` with proper type safety
- **Message handling**: Type-safe message dispatch with full TypeScript inference
- **Heartbeat management**: Configurable ping intervals and pong timeouts
- **Message limits**: Payload size constraints enforced before deserialization
- **Error codes**: Standardized WebSocket error handling
- **Type inference**: Full support for discriminated unions and schema-based typing

## Not in Scope (What Core IS NOT)

- **Validator implementations**: Zod/Valibot adapters live in separate packages
- **Platform implementations**: Bun/Cloudflare adapters live in separate packages
- **High-performance PubSub**: Provided by platform adapters (default `MemoryPubSub` for testing)
- **Middleware & extensions**: Rate limiting, logging, auth helpers in `@ws-kit/middleware`
- **Pluggable adapters**: Rate limiters and other adapters in `@ws-kit/adapters`
- **Codec abstraction**: Uses JSON (post-launch feature)
- **Protocol versioning**: Handled per-platform (post-launch feature)
- **Backpressure policies**: Platform-specific (handled by adapters)

## Design Principles

This package follows **composition over inheritance**:

- No parallel class hierarchies (no `ZodWebSocketRouter`, `BunWebSocketRouter`, etc.)
- Single generic class with pluggable adapters
- Any validator + any platform combination works without N×M class explosion
- Adding new validators/platforms requires no changes to core

## Dependencies

- **None** — `@ws-kit/core` is fully decoupled and can be used standalone for testing or as a reference implementation

## Future PR Review Principle

When evaluating PRs that propose new features for core, ask:

> **Does this benefit ALL platform adapters equally, or can it be implemented in a specific adapter?**

If the answer is "specific adapter," the feature belongs in that adapter, not core. This keeps core lean and lets platforms optimize independently.

## Implementation Status

✅ **Core Types & Interfaces** — Complete

- Abstract adapter interfaces (`ValidatorAdapter`, `PlatformAdapter`, `PubSub`)
- Type definitions (`ServerWebSocket`, `MessageContext`, lifecycle hooks)
- Error handling (`ErrorCode`, `WebSocketError`)
- Default `MemoryPubSub` implementation

✅ **Router Implementation** — Complete

- `WebSocketRouter<V, TData>` class with full message routing
- Lifecycle hooks (`onOpen`, `onClose`, `onAuth`, `onError`)
- Heartbeat management with configurable ping/pong
- Payload size limits enforcement
- Router composition via `merge()`
- Message normalization and validation pipeline
- PubSub integration with pluggable implementations

## API Reference

### WebSocketRouter

Platform-agnostic router for type-safe WebSocket message handling.

#### Constructor

```typescript
new WebSocketRouter<V, TData>(options?: WebSocketRouterOptions<V, TData>)
```

**Options**:

- `validator?: V` — Validator adapter (Zod, Valibot, etc.)
- `platform?: PlatformAdapter` — Platform adapter (Bun, Cloudflare DO, etc.)
- `pubsub?: PubSub` — Custom PubSub (default: `MemoryPubSub`)
- `hooks?: RouterHooks<TData>` — Lifecycle hooks
- `heartbeat?: HeartbeatConfig` — Ping/pong settings (default: 30s interval, 5s timeout)
- `limits?: LimitsConfig` — Message size constraints (default: 1MB)

#### Methods

**Handler Registration**:

- `on(schema, handler): this` — Register fire-and-forget message handler
- `rpc(schema, handler): this` — Register request/response (RPC) handler
- `onOpen(handler): this` — Register connection open handler
- `onClose(handler): this` — Register connection close handler
- `onAuth(handler): this` — Register authentication handler (called via validator)
- `onError(handler): this` — Register error handler

**Router Operations**:

- `merge(router): this` — Merge handlers from another router
- `publish(channel, schema, payload, options?): Promise<PublishResult>` — Type-safe broadcast with delivery info
  - `options.excludeSelf?: boolean` — Exclude sender from recipients (default: false)
  - Returns `PublishResult` with `ok` status and `matched` count

**Platform Adapter Integration** (called by platform adapters):

- `handleOpen(ws): Promise<void>` — Handle connection open
- `handleClose(ws, code, reason): Promise<void>` — Handle connection close
- `handleMessage(ws, message): Promise<void>` — Handle incoming message
- `handlePong(clientId): void` — Handle heartbeat pong

### Lifecycle Hooks

**onAuth**: Called on connection open to authenticate. Return `true` to allow connection, `false` to reject:

```typescript
onAuth((ctx) => {
  // Validate token or other credentials
  const isValid = ctx.ws.data.token ? validateToken(ctx.ws.data.token) : false;
  return isValid; // true to allow, false to reject
});
```

**onOpen**: Called after successful auth

```typescript
onOpen((ctx) => {
  console.log(`Client ${ctx.ws.data.clientId} connected`);
});
```

**onClose**: Called when connection closes

```typescript
onClose((ctx) => {
  console.log(`Client ${ctx.ws.data.clientId} disconnected (${ctx.code})`);
});
```

**onError**: Called when errors occur during message processing

```typescript
onError((err, ctx) => {
  console.error(`Error for ${ctx?.ws.data.clientId}:`, err);
});
```

### Message Context

Passed to message handlers:

```typescript
interface MessageContext<TSchema, TData> {
  ws: ServerWebSocket<TData>; // WebSocket connection
  type: string; // Message type
  meta: MessageMeta; // Metadata (clientId, receivedAt, etc.)
  send: SendFunction; // Type-safe send function
  payload?: unknown; // Message payload (if defined)
}
```

### Error Codes

Standardized error codes (13 codes, gRPC-aligned per ADR-015) with automatic retry inference:

**Terminal Errors (Non-Retryable):**

- `UNAUTHENTICATED` — Missing or invalid authentication
- `PERMISSION_DENIED` — Authorization failed (after successful auth)
- `INVALID_ARGUMENT` — Input validation or semantic validation failed
- `FAILED_PRECONDITION` — Stateful precondition not met
- `NOT_FOUND` — Requested resource doesn't exist
- `ALREADY_EXISTS` — Uniqueness or idempotency violation
- `UNIMPLEMENTED` — Feature not supported or deployed
- `CANCELLED` — Request cancelled by client or peer

**Transient Errors (Retryable):**

- `DEADLINE_EXCEEDED` — RPC request timed out
- `RESOURCE_EXHAUSTED` — Rate limit, quota, or buffer overflow
- `UNAVAILABLE` — Transient infrastructure error
- `ABORTED` — Concurrency conflict (race condition)

**Mixed:**

- `INTERNAL` — Unexpected server error (retryability app-specific)

**Error Response Format:**

```typescript
{
  code: ErrorCode,          // Standard error code
  message?: string,         // Optional description
  details?: Record<string, any>,  // Optional context
  retryable?: boolean,      // Optional (auto-inferred from code)
  retryAfterMs?: number     // Optional backoff hint for transient errors
}
```

See [docs/specs/error-handling.md](../../docs/specs/error-handling.md) and `ERROR_CODE_META` for complete retry semantics and code metadata.

## Adapter Implementation

### ValidatorAdapter

Implement to support new validation libraries:

```typescript
interface ValidatorAdapter {
  getMessageType(schema): string;
  safeParse(schema, data): { success: boolean; data?: any; error?: any };
  infer<T>(schema: T): any; // Type-only
}
```

### PlatformAdapter

Implement to support new platforms:

```typescript
interface PlatformAdapter {
  pubsub?: PubSub;
  getServerWebSocket?(ws: unknown): ServerWebSocket;
  init?(): Promise<void>;
  destroy?(): Promise<void>;
}
```

### PubSub

Implement to support custom PubSub backends:

```typescript
interface PubSub {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, handler: Function): void;
  unsubscribe(channel: string, handler: Function): void;
}
```
