# ws-kit Modularization Plan

## Rationale

The current monolithic `bun-ws-router` package limits extensibility and forces consumers to adopt Bun-specific APIs. Splitting into modular packages enables:

1. **Platform Support**: Server-side works with Bun AND Cloudflare Durable Objects (DO) with the same core router logic
2. **Universal Adoption**: Framework developers can build adapters for other platforms (Deno, Node.js, etc.)
3. **Independent Versioning**: Each package evolves independently, reducing coupling and faster iteration
4. **Validator Agility**: Zod and Valibot plugins can be upgraded separately without affecting core
5. **Client Parity**: Unified client library works across all server implementations
6. **Org Branding**: Publish under `@ws-kit` org to signal ecosystem maturity and interoperability

## Target Architecture

```
packages/
├── core/                    # @ws-kit/core - Platform-agnostic router & types
├── bun/                     # @ws-kit/bun - Bun WebSocket server adapter
├── cloudflare-do/           # @ws-kit/cloudflare-do - Durable Objects adapter
├── zod/                     # @ws-kit/zod - Zod validator plugin
├── valibot/                 # @ws-kit/valibot - Valibot validator plugin
├── client/                  # @ws-kit/client - Browser/Node.js client
└── redis-pubsub/            # @ws-kit/redis-pubsub - Optional scale-out PubSub (post-launch)
```

## Package Breakdown

### @ws-kit/core (NEW)

**Purpose**: Platform-agnostic WebSocket router and type system with composition-based adapter support

**Contains**:

- Single `WebSocketRouter<V>` class (generic over validator adapter, platform-agnostic)
- `MessageContext`, `ServerWebSocket` type definitions (abstracted)
- Message handling pipeline with pluggable validation interface
- Connection lifecycle hooks (`onAuth`, `onClose`, `onError`)
- Heartbeat management (ping/pong with configurable intervals and timeouts)
- Message limits and payload size constraints
- Error codes and standardized error handling
- **Validator adapter interface** (for Zod, Valibot, or custom):
  ```typescript
  interface ValidatorAdapter {
    validate(schema: unknown, payload: unknown): Promise<ValidationResult>;
  }
  ```
- **Platform adapter interface** (for Bun, Cloudflare, Node.js, etc.):
  ```typescript
  interface PlatformAdapter {
    pubsub: PubSub;
    getServerWebSocket(ws: unknown): ServerWebSocket;
  }
  ```
- **PubSub interface** (abstract with default in-memory implementation)
  ```typescript
  interface PubSub {
    publish(channel: string, message: unknown): Promise<void>;
    subscribe(channel: string, handler: (message: unknown) => void): void;
    unsubscribe(channel: string, handler: (message: unknown) => void): void;
  }
  ```
- Default `MemoryPubSub` implementation (suitable for single-server or testing)
- Type utilities and discriminated union support
- Composition helpers for combining adapters

**Does NOT contain**:

- Validator implementations (Zod/Valibot) — passed via adapter
- Platform-specific implementations — passed via adapter
- Concrete high-performance PubSub — provided by platform adapters

**Dependencies**:

- None (fully decoupled)

**Core API**:

```typescript
// Base router is validator-agnostic
const router = new WebSocketRouter({
  // Pluggable adapters
  validator: createZodValidator(z), // Optional validator
  platform: createBunAdapter(), // Optional platform adapter
  pubsub: createRedisPubSub(options), // Optional custom PubSub (default: MemoryPubSub)

  // Lifecycle hooks
  hooks: {
    onAuth: (ctx) => (ctx.ws.data?.token ? true : false), // Authenticate before first message
    onClose: (ctx, code, reason) => {
      /* cleanup */
    },
    onError: (err, ctx) => {
      /* log and handle */
    },
  },

  // Connection heartbeat
  heartbeat: {
    intervalMs: 30000, // Server sends ping every 30s
    timeoutMs: 5000, // Consider dead if no pong in 5s
  },

  // Payload constraints
  limits: {
    maxPayloadBytes: 1_000_000, // Reject messages over 1MB
  },
});

// Type inference flows from validator adapter
router.onMessage(PingSchema, (ctx) => {
  // ctx.payload is properly typed as PingSchema shape
});
```

**Exports**:

```typescript
export { WebSocketRouter } from "./router";
export { MessageContext, ServerWebSocket, WebSocketData } from "./types";
export { ErrorCode, ErrorMessage } from "./error";
export { PubSub, MemoryPubSub } from "./pubsub";
export type {
  ValidatorAdapter,
  PlatformAdapter,
  WebSocketRouterOptions,
  RouterHooks,
  HeartbeatConfig,
  LimitsConfig,
} from "./adapters";
```

---

### @ws-kit/bun (NEW)

**Purpose**: Bun.serve platform adapter leveraging Bun's native high-performance features

**Contains**:

- `createBunAdapter()` factory function returning a `PlatformAdapter`
- **BunPubSub** implementation wrapping Bun's native `server.publish()`
  - Zero-copy broadcasting within single Bun process
  - Optimal performance for horizontal scaling with load balancing
  - Direct integration with WebSocket API
- Bun-specific server binding and request upgrade handling
- `createBunHandler(router)` factory returning `{ fetch, websocket }` for Bun.serve integration
- Bun backpressure handling and compression support
- Bun types and runtime detection (isomorphic with `bunx` compatibility)

**Platform Advantages Leveraged**:

- **Native PubSub**: Uses Bun's event-loop integrated broadcasting (no third-party message queue needed)
- **Zero-copy**: Messages broadcast without serialization overhead
- **Auto-cleanup**: Subscriptions cleaned up on connection close via Bun's garbage collection
- **Backpressure handling**: Respects WebSocket write buffer limits automatically

**Dependencies**:

- `@ws-kit/core`
- `@types/bun` (peer)

**Core API**:

```typescript
import { createBunAdapter } from "@ws-kit/bun";
import { createBunHandler } from "@ws-kit/bun";
import { WebSocketRouter } from "@ws-kit/core";
import { zodValidator } from "@ws-kit/zod";

// Compose router with Bun platform adapter and Zod validator
const router = new WebSocketRouter({
  platform: createBunAdapter(),
  validator: zodValidator(),
});

// Create Bun handler
const { fetch, websocket } = createBunHandler(router);

// Use with Bun.serve
Bun.serve({
  fetch,
  websocket,
});
```

**Exports**:

```typescript
export { createBunAdapter } from "./adapter";
export { createBunHandler } from "./handler";
export { BunPubSub } from "./pubsub";
export type { BunHandlerOptions } from "./types";
```

**Backward Compatibility**:

- Users can import from `@ws-kit/bun` instead of deprecated `bun-ws-router`

---

### @ws-kit/cloudflare-do (NEW)

**Purpose**: Cloudflare Durable Objects platform adapter maximizing DO's state management and messaging capabilities

**Contains**:

- **DurablePubSub** implementation using `BroadcastChannel` for in-DO broadcasting
  - All active WebSocket connections in a DO instance receive broadcasts
  - Persists subscription state in DO durable storage if needed
  - Supports cross-DO messaging via HTTP RPC (explicit, opt-in for federation)
- DO-specific state management integration with persistent storage
- `createDurableObjectHandler(router)` factory for DO's fetch handler integration
- **Automatic connection recovery**: Reconnects to DO state on socket upgrade
- DO lifecycle hooks (`onOpen`, `onMessage`, `onClose` with state access)
- Built-in cost optimization helpers (request batching, efficient publishing)
- State serialization helpers for persistence (e.g., room membership, game state)
- Internal platform adapter for composing with @ws-kit/core router

**Platform Advantages Leveraged**:

- **State Durability**: Each DO instance maintains persistent state across connections
- **BroadcastChannel**: Low-latency in-memory messaging for all connected clients to a DO
- **Automatic Coordination**: Durable Objects provide inherent coordination (no distributed consensus needed)
- **Cost Optimization**: Broadcasts are free; only pays for fetch/RPC calls
- **Strong Isolation**: DO instances are naturally isolated, preventing cross-tenant leaks
- **Automatic Failover**: Cloudflare automatically restarts failed DO instances

**⚠️ Critical Scaling Consideration - Per-DO Broadcast Isolation**:

- `router.publish()` broadcasts **ONLY to WebSocket connections within THIS DO instance** (not across shards)
- Cross-DO federation requires **explicit opt-in via RPC calls**—there is no automatic multi-shard broadcast
- This design is intentional: each DO is an isolated unit; federation is explicit for cost control, clarity, and preventing subtle bugs in distributed systems
- For multi-DO setups (e.g., sharded chat rooms), use the `federate()` helper to explicitly broadcast to a shard set
- Single-DO architectures (one DO per resource) use `router.publish()` normally with no federation overhead

**Core API**:

```typescript
import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
import { zodValidator } from "@ws-kit/zod";
import { WebSocketRouter } from "@ws-kit/core";

// Create router with Zod validator
const router = new WebSocketRouter({
  validator: zodValidator(),
});

// Single DO per resource (broadcasts to all connections in this instance)
router.onMessage(MessageSchema, async (ctx) => {
  ctx.ws.publish("messages", ctx.payload); // ✅ Local to this DO
});

// Multi-DO shard setup (explicit federation)
router.onMessage(GlobalAnnouncementSchema, async (ctx) => {
  const relatedRooms = ["room:1", "room:2", "room:3"];

  // ✅ Explicitly broadcast to shard set
  await federate(env.ROOMS, relatedRooms, async (room) => {
    await room.fetch(
      new Request("https://internal/announce", {
        method: "POST",
        body: JSON.stringify({ text: ctx.payload.text }),
      }),
    );
  });
});

// Create DO fetch handler
const handler = createDurableObjectHandler({
  router,
});

export default {
  fetch(req: Request, state: DurableObjectState, env: Env) {
    return handler.fetch(req);
  },
};
```

**Dependencies**:

- `@ws-kit/core`
- `wrangler` (peer dev)

**Exports**:

```typescript
export { createDurableObjectHandler } from "./handler";
export { DurablePubSub } from "./pubsub";
export { federate } from "./federate";
export type { DurableObjectHandlerOptions } from "./types";
```

(These are exported from `@ws-kit/cloudflare-do` package)

**`federate()` Helper** (for multi-DO broadcasting):

```typescript
/**
 * Broadcast a message to a set of Durable Object instances (shards).
 * Use this to explicitly coordinate across multiple DO instances.
 *
 * @param env - Cloudflare environment binding (e.g., env.ROOMS)
 * @param shardIds - Array of shard keys to target (e.g., roomIds)
 * @param action - Handler function receiving each shard's fetch API
 *
 * @example
 * // Broadcast "user joined" to multiple room shards
 * await federate(env.ROOMS, ['room:1', 'room:2'], async (room) => {
 *   await room.fetch(new Request('https://internal/announce', {
 *     method: 'POST',
 *     body: JSON.stringify({ event: 'USER_JOINED', userId: '123' })
 *   }));
 * });
 */
export async function federate<T extends DurableObjectNamespace>(
  env: T,
  shardIds: string[],
  action: (shard: DurableObjectStub) => Promise<void>,
): Promise<void> {
  const promises = shardIds.map((id) => action(env.get(id)));
  await Promise.allSettled(promises);
}
```

**Note**: Designed for per-resource DO instances (e.g., one DO per chat room, game session, etc.); cross-DO communication is explicit via fetch/RPC

---

### @ws-kit/redis-pubsub (NEW, OPTIONAL - POST-LAUNCH)

**Purpose**: Optional PubSub adapter for multi-process or distributed deployments using Redis

**Contains**:

- `createRedisPubSub(options)` factory returning a `PubSub` implementation
- **RedisPubSub** implementation using Redis publish/subscribe
  - Enables broadcasting across multiple server instances (Bun cluster, Node.js cluster, etc.)
  - Plugs into core router's PubSub interface
  - Connection pooling and error handling
  - Automatic reconnection with exponential backoff
- Redis client management (passthrough or pooled)
- Channel namespace helpers for multi-tenancy

**When to Use**:

- Multiple Bun instances behind a load balancer (stateless cluster)
- Node.js cluster deployments
- Any deployment requiring cross-process messaging

**When NOT Needed**:

- Single Bun process (use default `BunPubSub`)
- Cloudflare DO (use `DurablePubSub` with `federate()`)
- Single-server deployments (use `MemoryPubSub`)

**Core API**:

```typescript
import { WebSocketRouter } from "@ws-kit/core";
import { createBunAdapter } from "@ws-kit/bun";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import { zodValidator } from "@ws-kit/zod";

// Use Redis as shared PubSub for multi-instance cluster
const router = new WebSocketRouter({
  platform: createBunAdapter(),
  validator: zodValidator(),
  pubsub: createRedisPubSub({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  }),
});

// router.publish() now broadcasts across all instances
router.onMessage(BroadcastSchema, async (ctx) => {
  await router.publish("notifications", ctx.payload); // ✅ Reaches all servers
});
```

**Dependencies**:

- `@ws-kit/core`
- `redis` (peer)

**Exports**:

```typescript
export { createRedisPubSub } from "./pubsub";
export type { RedisPubSubOptions } from "./types";
```

**Note**: Optional add-on; core router works without it. Useful for scaling beyond single-server deployments.

---

### @ws-kit/zod (NEW)

**Purpose**: Zod validator adapter for @ws-kit/core

**Contains**:

- `zodValidator()` default export (convenience; uses default Zod config)
- `createZodValidator(z)` factory for advanced users (custom Zod instances/configs)
- `createMessageSchema(z)` factory for defining typed message schemas
- `ZodMessageSchemaType` type definitions for inference
- Zod-based schema validation implementation
- Type-safe message handlers with full discriminated union support
- Type overloads for `router.onMessage()` to preserve Zod schema types

**Dependencies**:

- `@ws-kit/core`
- `zod` (peer)

**Core API**:

**Simple (most users)**:

```typescript
import { zodValidator } from "@ws-kit/zod";
import { messageSchema } from "@ws-kit/zod";
import { WebSocketRouter } from "@ws-kit/core";
import { z } from "zod";

// Use defaults (Zod imported internally)
const router = new WebSocketRouter({ validator: zodValidator() });

// Define typed schemas
const PingMessage = messageSchema("PING", { text: z.string() });
const PongMessage = messageSchema("PONG", { reply: z.string() });

// Handler gets full type inference from schema
router.onMessage(PingMessage, (ctx) => {
  // ctx.payload is typed as { text: string }
  ctx.send(PongMessage, { reply: ctx.payload.text });
});
```

**Advanced (custom Zod configs)**:

```typescript
import { createZodValidator } from "@ws-kit/zod";
import { createMessageSchema } from "@ws-kit/zod";
import { WebSocketRouter } from "@ws-kit/core";
import { z } from "zod";

// Use custom Zod instance or config
const customZ = z.strict(); // Example: strict mode
const validator = createZodValidator(customZ);
const { messageSchema } = createMessageSchema(customZ);

// Same API from here on
const router = new WebSocketRouter({ validator });
// ... rest is identical
```

**Exports**:

```typescript
// Default export (convenience)
export { default as zodValidator } from "./validator";
export { default as messageSchema } from "./schema";

// Named exports (advanced)
export { createZodValidator } from "./validator";
export { createMessageSchema } from "./schema";
export type { ZodMessageSchema } from "./types";
```

**Note**: Platform-agnostic. Compose with any platform adapter (Bun, Cloudflare, Node.js, etc.)

---

### @ws-kit/valibot (NEW)

**Purpose**: Valibot validator adapter for @ws-kit/core

**Contains**:

- `valibotValidator()` default export (convenience; uses default Valibot config)
- `createValibotValidator(v)` factory for advanced users (custom Valibot instances/configs)
- `createMessageSchema(v)` factory for defining typed message schemas
- `ValibotMessageSchemaType` type definitions for inference
- Valibot-based schema validation implementation
- Type-safe message handlers with full discriminated union support
- Type overloads for `router.onMessage()` to preserve Valibot schema types

**Dependencies**:

- `@ws-kit/core`
- `valibot` (peer)

**Core API**:

**Simple (most users)**:

```typescript
import { valibotValidator } from "@ws-kit/valibot";
import { messageSchema } from "@ws-kit/valibot";
import { WebSocketRouter } from "@ws-kit/core";
import * as v from "valibot";

// Use defaults (Valibot imported internally)
const router = new WebSocketRouter({ validator: valibotValidator() });

// Define typed schemas
const PingMessage = messageSchema("PING", { text: v.string() });
const PongMessage = messageSchema("PONG", { reply: v.string() });

// Handler gets full type inference from schema
router.onMessage(PingMessage, (ctx) => {
  // ctx.payload is typed as { text: string }
  ctx.send(PongMessage, { reply: ctx.payload.text });
});
```

**Advanced (custom Valibot configs)**:

```typescript
import { createValibotValidator } from "@ws-kit/valibot";
import { createMessageSchema } from "@ws-kit/valibot";
import { WebSocketRouter } from "@ws-kit/core";
import * as v from "valibot";

// Use custom Valibot instance or config
const customV = { ...v, strict: true }; // Example: custom config
const validator = createValibotValidator(customV);
const { messageSchema } = createMessageSchema(customV);

// Same API from here on
const router = new WebSocketRouter({ validator });
// ... rest is identical
```

**Exports**:

```typescript
// Default export (convenience)
export { default as valibotValidator } from "./validator";
export { default as messageSchema } from "./schema";

// Named exports (advanced)
export { createValibotValidator } from "./validator";
export { createMessageSchema } from "./schema";
export type { ValibotMessageSchema } from "./types";
```

**Note**: Platform-agnostic. Compose with any platform adapter (Bun, Cloudflare, Node.js, etc.)

---

### @ws-kit/client (EXISTING, NEW LOCATION)

**Purpose**: Universal WebSocket client for browsers and Node.js with optional validator integration

**Contains**:

- `createClient()` factory (core, validator-agnostic)
- Auto-reconnection with exponential backoff
- Message queueing and request/response patterns
- Authentication helpers
- Support for schema-based type inference via optional validator plugins

**Core Package (`@ws-kit/client`)**:

- No dependencies; works standalone with `unknown` message types
- Suitable for projects without schema sharing or cross-platform clients

**Optional Validator Integrations** (Phase 6+):

- `@ws-kit/client/zod` - Zod-based type inference for handlers
- `@ws-kit/client/valibot` - Valibot-based type inference for handlers

```typescript
// Universal (no validator)
const { createClient } = await import("@ws-kit/client");
const client = createClient({ url: "..." });
client.on("message", (msg: unknown) => {
  /* ... */
});

// With Zod integration (full type inference)
const { createClient } = await import("@ws-kit/client/zod");
const client = createClient({
  url: "...",
  schemas: [PingMessage, PongMessage], // Re-use server schemas
});
client.on("message", (msg) => {
  // msg typed as PingMessage | PongMessage
  if (msg.type === "PING") {
    // TypeScript knows msg.payload shape
  }
});
```

**Dependencies**:

- Core: None (universal)
- `/zod` variant: `zod` (peer), `@ws-kit/core` (shared interface)
- `/valibot` variant: `valibot` (peer), `@ws-kit/core` (shared interface)

**Exports**:

```typescript
// Core
export { createClient } from "./client";
export type { WebSocketClient, ClientOptions } from "./types";

// Sub-packages (optional)
// @ws-kit/client/zod exports enhanced createClient with Zod inference
// @ws-kit/client/valibot exports enhanced createClient with Valibot inference
```

**Note**: Core client is validator-agnostic for maximum portability. Optional validator sub-packages enable type-safe message handling by re-using server schemas

---

## PubSub Architecture Strategy

### Core Principle: Abstraction with Platform Optimization

**@ws-kit/core** provides:

- **Abstract PubSub interface** that all adapters implement consistently
- **Default MemoryPubSub** implementation for single-server and testing
- **Guaranteed router.publish() method** available on all router instances

**Adapters override with platform-specific implementations**:

| Scope              | PubSub Implementation                        | Platform(s)              | State Management             | Use Case                                       |
| ------------------ | -------------------------------------------- | ------------------------ | ---------------------------- | ---------------------------------------------- |
| **Single process** | `MemoryPubSub` (in-memory)                   | Any                      | Transient (memory)           | Testing, single-server deployments             |
| **Single process** | `BunPubSub` (native server.publish)          | Bun                      | Transient (memory)           | Real-time apps with Bun, load-balanced cluster |
| **Per-resource**   | `DurablePubSub` (BroadcastChannel + storage) | Cloudflare DO            | Persistent (durable storage) | Per-resource state (rooms, games, sessions)    |
| **Multi-instance** | `RedisPubSub` (Redis pub/sub)                | Any (Bun, Node.js, etc.) | Varies by choice             | Multi-process clusters, distributed systems    |

### Adapter API Consistency

All adapters expose the same core interface:

```typescript
// Works identically on all adapters
router.publish("channel:123", message);
router.onMessage(schema, (ctx) => {
  ctx.ws.publish("room:123", response);
});
```

### Implementation Details by Adapter

**Bun**: PubSub is write-optimized

- Calls `server.publish(channel, data)` directly
- WebSocket writes handled by Bun's event loop
- No serialization overhead

**Cloudflare DO**: PubSub is state-optimized

- Uses `BroadcastChannel` for in-process messaging
- Extends with durable storage for persistence if needed
- Each DO instance is isolated; federation is explicit (via RPC)

**Redis** (Optional): PubSub is scale-optimized

- Enables broadcasting across multiple server instances
- Works with any platform (Bun cluster, Node.js cluster, etc.)
- Added post-launch as optional `@ws-kit/redis-pubsub` package
- Not required for single-server deployments

---

## Type Testing Strategy

### Rationale

Type inference is a **primary value proposition** of ws-kit, especially for validator adapters. Runtime tests cannot catch regressions in type inference—only TypeScript's type checker can verify that discriminated unions narrow correctly, generics preserve shape across compositions, and schema types propagate to handlers.

### Approach: Bun's `expectTypeOf`

Use **`expectTypeOf`** from `bun:test` to assert types at compile-time:

- **Zero runtime overhead**: These are no-ops at runtime; verification happens via `tsc --noEmit`
- **Built-in to Bun**: No additional dependencies needed
- **Full type inspection**: Assert on function parameters, return types, object shapes, discriminated unions, etc.

### Test Structure

Create `test/types/` folders in each package:

```
packages/
├── core/
│   └── test/
│       ├── types/
│       │   ├── router.test.ts          # Router type assertions
│       │   ├── adapters.test.ts        # Adapter interface types
│       │   └── pubsub.test.ts          # PubSub type correctness
│       └── ...
├── zod/
│   └── test/
│       ├── types/
│       │   ├── validator.test.ts       # Zod validator adapter types
│       │   ├── schema.test.ts          # Message schema type inference
│       │   └── inference.test.ts       # Handler context typing
│       └── ...
└── ...
```

### Example Type Tests

```typescript
// packages/core/test/types/router.test.ts
import { expectTypeOf } from "bun:test";
import { WebSocketRouter, MessageContext } from "@ws-kit/core";

// Assert router is generic over validator
const router = new WebSocketRouter();
expectTypeOf(router).toMatchTypeOf<WebSocketRouter<never>>();

// Assert publish method exists and accepts channel + message
expectTypeOf(router.publish).toBeFunction();
expectTypeOf(router.publish).parameters.toEqualTypeOf<[string, unknown]>();
expectTypeOf(router.publish).returns.resolves.toBeVoid();
```

```typescript
// packages/zod/test/types/schema.test.ts
import { expectTypeOf } from "bun:test";
import { createMessageSchema } from "@ws-kit/zod";
import { z } from "zod";

const { messageSchema } = createMessageSchema(z);

// Define schemas
const PingMessage = messageSchema("PING", { text: z.string() });
const PongMessage = messageSchema("PONG", { reply: z.string() });

// Assert discriminated union types are preserved
type PingType = typeof PingMessage;
type PongType = typeof PongMessage;

expectTypeOf<PingType["_type"]>().toEqualTypeOf<"PING">();
expectTypeOf<PingType["_payload"]>().toEqualTypeOf<{ text: string }>();

// Assert handler context receives correctly typed payload
const mockContext: MessageContext<typeof PingMessage> = {
  payload: { text: "hello" },
  // ... other fields
} as any;

expectTypeOf(mockContext.payload).toMatchObjectType<{ text: string }>();
expectTypeOf(mockContext.payload.text).toBeString();
```

```typescript
// packages/zod/test/types/inference.test.ts
import { expectTypeOf } from "bun:test";
import { WebSocketRouter, MessageContext } from "@ws-kit/core";
import { zodValidator, messageSchema } from "@ws-kit/zod"; // Simple pattern
import { z } from "zod";

const router = new WebSocketRouter({ validator: zodValidator() });

const AuthMessage = messageSchema("AUTH", {
  token: z.string(),
  exp: z.number(),
});

// Assert handler receives correctly typed context
router.onMessage(AuthMessage, (ctx) => {
  // ctx.payload should be { token: string; exp: number }
  expectTypeOf(ctx.payload).toMatchObjectType<{ token: string; exp: number }>();
  expectTypeOf(ctx.payload.token).toBeString();
  expectTypeOf(ctx.payload.exp).toBeNumber();
});

// Assert discriminated union narrowing in multi-message handlers
const PingMessage = messageSchema("PING", { id: z.number() });
const PongMessage = messageSchema("PONG", { id: z.number() });

type AllMessages = typeof PingMessage | typeof PongMessage;

const handler = (msg: AllMessages) => {
  if (msg.type === "PING") {
    // TypeScript narrows to PingMessage
    expectTypeOf(msg.payload).toMatchObjectType<{ id: number }>();
  } else {
    // TypeScript narrows to PongMessage
    expectTypeOf(msg.payload).toMatchObjectType<{ id: number }>();
  }
};
```

### CI Integration

Add to root `package.json` scripts:

```json
{
  "scripts": {
    "test:types": "tsc --noEmit",
    "test": "bun test && bun run test:types"
  }
}
```

Run in CI before build:

```bash
# Type check (catches type regressions)
bun run test:types

# Runtime tests
bun test

# Build all packages
bun run build
```

### Coverage Goals

**Per-package type assertions**:

- ✅ **@ws-kit/core**: Router generics, PubSub interface, MessageContext shape
- ✅ **@ws-kit/zod**: Schema type inference, discriminated union narrowing, handler context typing
- ✅ **@ws-kit/valibot**: Schema type inference, discriminated union narrowing, handler context typing
- ✅ **@ws-kit/bun**: Adapter type compatibility, platform-specific extensions
- ✅ **@ws-kit/cloudflare-do**: Adapter type compatibility, DO state integration
- ✅ **@ws-kit/client**: Client message types, optional validator plugin types

**Cross-package composition**:

- ✅ Zod + Bun: Type inference preserved through platform adapter
- ✅ Valibot + Cloudflare: Type inference preserved through platform adapter
- ✅ No validator + Bun: Falls back to `unknown` payload types (but still type-safe)

---

## Router Configuration Reference (Phase 2)

### Option Schema: `WebSocketRouterOptions<V>`

```typescript
type WebSocketRouterOptions<V extends ValidatorAdapter = never> = {
  // Pluggable adapters
  validator?: V; // Validator adapter (Zod, Valibot, or custom)
  platform?: PlatformAdapter; // Platform adapter (Bun, Cloudflare, etc.)
  pubsub?: PubSub; // Custom PubSub (default: MemoryPubSub)

  // Lifecycle hooks
  hooks?: {
    onAuth?: (ctx: MessageContext) => Promise<boolean> | boolean;
    onClose?: (ctx: MessageContext, code: number, reason?: string) => void;
    onError?: (err: Error, ctx?: MessageContext) => void;
  };

  // Connection management
  heartbeat?: {
    intervalMs?: number; // Ping interval (default: 30000ms)
    timeoutMs?: number; // Pong timeout (default: 5000ms)
  };

  // Constraints
  limits?: {
    maxPayloadBytes?: number; // Reject payloads over limit (default: 1MB)
  };
};
```

### Deferred to Phase 8+ (Post-Launch)

- **Codec system** (`codec?: Codec`): Generic serialization abstraction (JSON assumed for v1)
- **Middleware chain** (`middleware?: Middleware[]`): Ordered middleware with continuation (use hooks for v1)
- **Protocol versioning** (`protocol?: { version, strictUnknownTypes }`): Message envelope versioning
- **Backpressure policies** (`backpressure?: { policy: 'reject' | 'buffer' | 'drop' }`): Platform-specific write buffer handling

**Rationale**: These add abstraction cost and are not required for v1. Can be added without breaking current API by extending `WebSocketRouterOptions`.

---

## Migration Path (Phase by Phase)

### Phase 1: Setup Monorepo Structure

- [ ] Create `packages/` directory
- [ ] Migrate to `bun` workspaces in root `package.json`
- [ ] Add `@changesets/cli` to root dev dependencies
- [ ] Create `.changeset` directory for change tracking
- [ ] Initialize individual `package.json` files for each package
- [ ] Configure TypeScript Project References for incremental builds and dependency enforcement:
  - [ ] Create root `tsconfig.json` with `"composite": true` and `"references"` array
  - [ ] Add per-package `tsconfig.json` files with `"composite": true` and package dependencies listed in `"references"`
  - [ ] Configure `tsc --build` for ordered, incremental compilation (see CLI Commands section)
  - [ ] Document dependency graph: `core` (no deps) → `zod`, `valibot`, `bun`, `cloudflare-do`, `client` (all depend on core)
  - [ ] Enforce via CI: any import violating the graph fails at type-check time
- [ ] Configure ESM-only setup:
  - [ ] Set `"type": "module"` in root and all package `package.json` files
  - [ ] Create `package.json` template with `"exports"` field patterns (see Module Format section)
  - [ ] Configure TypeScript to generate `.d.ts` files alongside JS output
  - [ ] Document ESM requirement in README (Node.js 14+, Bun, modern bundlers only)

### Phase 2: Implement @ws-kit/core (Composition Foundation)

- [ ] Define **adapter interfaces** (NOT implementation):
  - [ ] `ValidatorAdapter` interface for pluggable validators
  - [ ] `PlatformAdapter` interface for pluggable platforms
  - [ ] `PubSub` interface with `publish()`, `subscribe()`, `unsubscribe()`
- [ ] Implement single **`WebSocketRouter<V>`** class (generic over `ValidatorAdapter`)
  - [ ] Constructor accepts `{ validator?, platform?, pubsub?, hooks?, heartbeat?, limits? }`
  - [ ] `onMessage()` method with type overloads for type inference
  - [ ] `publish()` delegating to platform's PubSub
  - [ ] Authentication hook (`onAuth`) invoked on first message before handler dispatch
  - [ ] Close hook (`onClose`) with connection code and reason
  - [ ] Error hook (`onError`) for all recoverable/fatal errors
- [ ] Implement **heartbeat management**:
  - [ ] Configurable ping interval (default 30s)
  - [ ] Configurable pong timeout (default 5s)
  - [ ] Auto-close stale connections (no pong within timeout)
  - [ ] Per-socket heartbeat tracking
- [ ] Implement **message limits**:
  - [ ] `maxPayloadBytes` enforced before deserialization (default 1MB)
  - [ ] Reject oversized messages with appropriate error code
- [ ] Implement **`MemoryPubSub`** as default for testing and single-server
- [ ] Define abstract `ServerWebSocket` interface
- [ ] Define `MessageContext` type with full type inference support
- [ ] Error codes and standardized error handling
- [ ] Remove platform-specific code; ensure interface contracts are clear
- [ ] **Type tests** (see Type Testing Strategy):
  - [ ] Create `test/types/` folder structure
  - [ ] Assert router generics and composition behavior with `expectTypeOf`
  - [ ] Assert PubSub interface types
  - [ ] Assert MessageContext type inference
  - [ ] Assert hook types (onAuth return bool, onClose/onError params)
  - [ ] Assert config option types (heartbeat, limits)
  - [ ] Verify `tsc --noEmit` passes all type assertions

### Phase 3: Implement @ws-kit/bun (Platform Adapter)

- [ ] Create **`createBunAdapter()`** factory function
  - Returns `PlatformAdapter` with `BunPubSub` implementation
  - Wraps Bun's native `server.publish()` with zero-copy semantics
  - Handles WebSocket upgrade and request binding
- [ ] Implement **`createBunHandler(router)`** factory returning `{ fetch, websocket }`
  - Integrates seamlessly with `Bun.serve()`
- [ ] Add `@types/bun` as peer dependency
- [ ] Test with load balancing setup (verify channel-based routing works)
- [ ] No inheritance; pure factory composition
- [ ] **Type tests**:
  - [ ] Create `test/types/` folder structure
  - [ ] Assert `createBunAdapter()` returns compatible `PlatformAdapter`
  - [ ] Assert `createBunHandler()` returns properly typed handlers
  - [ ] Verify composition with Zod/Valibot validators preserves type inference
  - [ ] Assert Bun-specific extensions are properly typed

### Phase 4: Implement @ws-kit/zod & @ws-kit/valibot (Validator Adapters)

- [ ] For Zod:
  - [ ] Create **`zodValidator()`** default export (convenience wrapper) returning `ValidatorAdapter`
  - [ ] Create **`createZodValidator(z)`** factory (advanced) for custom Zod instances
  - [ ] Implement `messageSchema()` default export and `createMessageSchema(z)` factory for schema definition
  - [ ] Add type overloads for `router.onMessage()` to preserve Zod inference
  - [ ] Depend on `@ws-kit/core` only (platform-agnostic)
  - [ ] **Type tests**: Schema inference, discriminated union narrowing, handler context
- [ ] For Valibot:
  - [ ] Create **`valibotValidator()`** default export (convenience wrapper) returning `ValidatorAdapter`
  - [ ] Create **`createValibotValidator(v)`** factory (advanced) for custom Valibot instances
  - [ ] Implement `messageSchema()` default export and `createMessageSchema(v)` factory for schema definition
  - [ ] Add type overloads for `router.onMessage()` to preserve Valibot inference
  - [ ] Depend on `@ws-kit/core` only (platform-agnostic)
  - [ ] **Type tests**: Mirror Zod tests with Valibot schema system
- [ ] No inheritance; both are adapters that slot into core
- [ ] Support both simple and advanced patterns:
  - [ ] Simple: `new WebSocketRouter({ validator: zodValidator() })`
  - [ ] Advanced: `new WebSocketRouter({ validator: createZodValidator(customZ) })`
- [ ] **Cross-package composition type tests**:
  - [ ] Zod + Bun: Type inference preserved through adapter composition
  - [ ] Valibot + Cloudflare: Type inference preserved through adapter composition

### Phase 5: Relocate Client

- [ ] Move `client/` to `packages/client`
- [ ] Keep core package validator-agnostic (no Zod/Valibot coupling)
- [ ] Export base `createClient()` factory and types
- [ ] Document opt-in validator integration pattern
- [ ] **Type tests**:
  - [ ] Create `test/types/` folder structure
  - [ ] Assert `createClient()` returns properly typed client
  - [ ] Verify client event handlers accept correct message types

### Phase 5.5: Optional Client Validator Plugins (Post-Launch)

- [ ] Create `@ws-kit/client/zod` sub-package for Zod-based type inference
  - [ ] Export enhanced `createClient()` that accepts schemas array
  - [ ] Provide typed message handler callbacks with discriminated union inference
  - [ ] Ensure schemas can be re-used from server side
- [ ] Create `@ws-kit/client/valibot` sub-package for Valibot-based type inference
  - [ ] Mirror Zod implementation for Valibot
- [ ] **Type tests**: Schema-based type inference for client handlers, discriminated union narrowing
- [ ] Add examples showing schema sharing between server and client
- [ ] Document in getting started guides

### Phase 6: Implement @ws-kit/cloudflare-do (Platform Adapter)

- [ ] Implement **`createDurableObjectHandler(router)`** factory returning DO fetch handler
  - Returns handler with `fetch(req)` method for DO integration
  - Internal platform adapter for composing with @ws-kit/core
- [ ] Implement **`DurablePubSub`** for per-DO-instance broadcasting via BroadcastChannel
  - Integrates with DO durable storage
- [ ] Add **`federate()`** helper for explicit multi-DO coordination
- [ ] Add state management hooks and cost optimization features
- [ ] Test with real Durable Objects or Cloudflare local environment (wrangler)
- [ ] Document per-resource DO pattern (one DO per room, game, session, etc.)
- [ ] Document federation patterns for cross-DO messaging
- [ ] No inheritance; pure factory composition
- [ ] **Type tests**:
  - [ ] Create `test/types/` folder structure
  - [ ] Assert `createDurableObjectHandler()` returns properly typed handler
  - [ ] Verify composition with Zod/Valibot validators preserves type inference
  - [ ] Assert DO state integration is properly typed

### Phase 7: Testing & Examples

- [ ] Create example apps in `examples/` (top-level)
  - [ ] Bun server with Zod validator
  - [ ] Cloudflare DO with Valibot validator
  - [ ] Browser client with schema-based type inference
  - [ ] Multi-platform composition example
- [ ] Ensure **all runtime AND type tests pass** across packages
  - [ ] Run `bun test` for runtime validation
  - [ ] Run `bun run test:types` (via `tsc --noEmit`) for type regression detection
  - [ ] Verify all `expectTypeOf` assertions pass
  - [ ] CI enforces both test suites before build
- [ ] Test composition patterns (multiple adapter combinations)
- [ ] Update test structure to mirror package structure

### Phase 8: Optional @ws-kit/redis-pubsub (Post-Launch)

- [ ] Create **`createRedisPubSub()`** factory returning `PubSub` implementation
  - Plugs into router's optional `pubsub` constructor option
  - Connection pooling and automatic reconnection
  - Works with any platform adapter (Bun, Cloudflare, Node.js, etc.)
- [ ] Add Redis client management helpers
- [ ] Channel namespace utilities for multi-tenancy
- [ ] Example: Multi-process Bun cluster with Redis PubSub
- [ ] **Type tests**: Verify RedisPubSub implements `PubSub` interface correctly
- [ ] Document when to use (multi-instance deployments) vs. not needed (single server)

### Phase 9: Documentation & Release

- [ ] Update docs to reflect new package names and composition pattern
- [ ] Add migration guide for existing users (`bun-ws-router` → `@ws-kit/bun` + `@ws-kit/core`)
- [ ] Create "Getting Started" guides per combination (e.g., "Bun + Zod", "Cloudflare + Valibot")
- [ ] Document adapter interface for custom validators/platforms
- [ ] Set up NPM organization and publish first versions
- [ ] Add GitHub workflows for multi-package publishing

#### Critical Documentation Priorities

**⚠️ PubSub Scope Distinction (Prevent User Confusion)**

The most significant documentation risk: `publish()` has different scopes per platform:

- **Bun**: Process-wide broadcast (load-balanced cluster with stateless instances)
- **Cloudflare DO**: Per-instance broadcast (explicit federation required for multi-DO coordination)

Users familiar with Bun may deploy to DO and be baffled when cross-room broadcasts fail, incorrectly assuming the feature is "broken."

Required documentation:

- [ ] **PubSub Scope Guide** (`docs/guides/pubsub-scope.md`)
  - [ ] Side-by-side comparison table: Bun vs. Cloudflare DO broadcast behavior
  - [ ] Clear diagrams showing scope (process-wide vs. per-instance)
  - [ ] Real-world example: "Why my cross-room broadcast isn't working in DO"
  - [ ] When and how to use `federate()` helper for multi-DO coordination
  - [ ] Link prominently from both `@ws-kit/bun` and `@ws-kit/cloudflare-do` READMEs

- [ ] **Platform Adapter Comparison Matrix** (main docs)
  - [ ] Quick reference table: `publish()` scope, state management, scaling characteristics per adapter
  - [ ] Early warning in getting-started guides about platform differences

- [ ] **Platform Migration/Porting Guide** (when deploying to different platforms)
  - [ ] Explicit section: "What changes when you switch from Bun to Cloudflare DO (or vice versa)"
  - [ ] Code snippets showing `router.publish()` → `federate()` conversion patterns
  - [ ] Scaling checklist: which PubSub strategy to use for each deployment model

---

## Deprecation & Backward Compatibility

### Strategy: Direct Migration (Chosen)

With the v1.0.0 launch under the `@ws-kit` organization, `bun-ws-router` is **deprecated in favor of** `@ws-kit/bun` + `@ws-kit/core`.

**Rationale**:

- A facade package adds **maintenance overhead** without value—as `@ws-kit/bun` evolves with new features, the facade either falls behind or requires constant syncing
- The v1.0.0 launch under a new organization is already a major breaking change; users expect API changes
- A **clean break is clearer** than half-maintained compatibility shim
- Honest deprecation messaging is better than false expectations of seamless migration

**Implementation**:

1. **Final `bun-ws-router` release** includes clear deprecation notice:

   ```typescript
   // bun-ws-router/index.ts (final version)
   console.warn(
     "bun-ws-router is deprecated. Migrate to @ws-kit/bun + @ws-kit/core.\n" +
       "Migration guide: https://ws-kit.dev/migrate\n" +
       "New packages: https://npm.im/@ws-kit/bun",
   );
   export * from "@ws-kit/bun"; // Re-export for graceful shutdown period
   ```

2. **Publish migration guide** with:
   - Side-by-side comparison of old vs. new API
   - Copy-paste examples for common patterns
   - 5-minute migration checklist

3. **Users can**:
   - Migrate immediately to `@ws-kit/bun` + `@ws-kit/core`
   - Pin old `bun-ws-router` version indefinitely if needed (unsupported but functional)

**Timeline**:

- v0.7.0+: Add deprecation warning to `bun-ws-router`
- v1.0.0: Release under `@ws-kit` org with new architecture
- Documentation includes prominent migration guide

---

## Key Implementation Considerations

### Composition Over Inheritance (Critical)

- ✅ **Single `WebSocketRouter<V>` class** in `@ws-kit/core`
  - Generic over `ValidatorAdapter`, not subclassed per validator
  - Accepts `{ validator?, platform? }` in constructor
- ✅ **No parallel class hierarchies**
  - No `ZodWebSocketRouter`, `ValibotWebSocketRouter`, `BunWebSocketRouter`
  - Instead: `createZodValidator()`, `createValibotValidator()`, `createBunAdapter()` factories
- ✅ **N×M combination support without explosion**
  - Any validator + any platform combo works automatically
  - Add new validators/platforms without changing core or existing adapters
  - Examples: Zod + Bun, Valibot + Cloudflare, no-validator + Bun, etc.

### Type Inference Without Inheritance

- Core `WebSocketRouter` uses **generic type parameters** and **function overloads**
  ```typescript
  class WebSocketRouter<V extends ValidatorAdapter = never> {
    onMessage<T>(schema: T, handler: (ctx: MessageContext<T>) => void): this;
    // Validator adapters provide overloads that narrow T type
  }
  ```
- **Validator adapters provide type overloads** via module augmentation or composition
  - Zod's `createZodValidator` returns adapter with type-narrowing capabilities
  - Valibot's `createValibotValidator` does the same independently
- **No dual package hazard**: Factory pattern ensures single validator instance

### Peer Dependency Strategy

- **Validators**: Zod/Valibot are peer dependencies (optional)
  - User chooses which validator(s) they want
  - Smaller bundle for those using only one
- **Platforms**: `@types/bun` is peer (only needed in projects using Bun)
  - Cloudflare projects don't need `@types/bun`
  - Future Node.js adapter won't force unneeded types

### PubSub Composition (Not String Literals)

- **Decision**: `pubsub` option accepts `PubSub` instances only, not string literals like `'bun'` or `'memory'`
- **Rationale**:
  - String literals would couple `@ws-kit/core` to knowledge of all platform implementations
  - Factory pattern (e.g., `createRedisPubSub()`) is extensible without core changes
  - Users can pass `undefined` (or omit) to use `MemoryPubSub` default
  - Explicit factories make dependencies clear in code
- **Pattern**:

  ```typescript
  // ✅ Correct - explicit composition
  const router = new WebSocketRouter({
    platform: createBunAdapter(),
    pubsub: createRedisPubSub({ host: "localhost" }),
  });

  // ✅ Also correct - use default MemoryPubSub
  const router = new WebSocketRouter({
    platform: createBunAdapter(),
    // pubsub omitted → defaults to MemoryPubSub
  });

  // ❌ Wrong - magic strings couple core to implementation
  const router = new WebSocketRouter({ pubsub: "redis" });
  ```

### Module Format & Package Configuration (ESM-Only)

**Decision**: All packages export pure ESM with TypeScript type declarations.

**Rationale**:

- **Platform alignment**: Bun and Cloudflare DO are ESM-only
- **Future-proof**: Node.js increasingly favors ESM; CJS is legacy
- **Tree-shaking**: Modern bundlers optimize ESM better
- **No dual package hazard**: Single format eliminates entrypoint confusion
- **Simpler maintenance**: One code path, one build target

**Template for @ws-kit/core package.json**:

```json
{
  "name": "@ws-kit/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "engines": {
    "node": ">=18"
  }
}
```

**Template for @ws-kit/client with sub-exports (Phase 5.5)**:

```json
{
  "name": "@ws-kit/client",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./zod": {
      "types": "./dist/zod/index.d.ts",
      "default": "./dist/zod/index.js"
    },
    "./valibot": {
      "types": "./dist/valibot/index.d.ts",
      "default": "./dist/valibot/index.js"
    }
  },
  "files": ["dist"]
}
```

**TypeScript Configuration** (`tsconfig.json` per package):

- Set `"module": "esnext"` for ESM output
- Set `"declaration": true` for `.d.ts` generation
- Set `"declarationDir": "dist"` to output types alongside compiled JS
- Set `"moduleResolution": "bundler"` for proper subpath export resolution

**Compatibility Statement**:

- ws-kit requires **ESM environments**: Bun, Node.js 14+, modern bundlers (Vite, esbuild, Rollup)
- **Not compatible** with: CommonJS-only projects, old Node.js versions, or legacy build tools
- If CommonJS compatibility needed in future, evaluate as separate decision (would not add to core ws-kit packages)

### Validator & Platform Adapter Independence (Critical)

- **Each adapter package depends ONLY on @ws-kit/core**
  - Validators (`@ws-kit/zod`, `@ws-kit/valibot`) are platform-agnostic
  - Platforms (`@ws-kit/bun`, `@ws-kit/cloudflare-do`) are validator-agnostic
  - No coupling between validators and platforms
- **Composition at application level** (both simple and advanced patterns work):

  ```typescript
  // Simple (most apps)
  const router = new WebSocketRouter({
    validator: zodValidator(),
    platform: createBunAdapter(),
  });

  // Advanced (custom configs)
  const router = new WebSocketRouter({
    validator: createZodValidator(customZ),
    platform: createBunAdapter(),
  });
  // Works with any combination; no pre-built "zod-bun" needed
  ```

### Package Version Independence

- Each package has independent semver
- Use `@changesets/cli` for tracking changes per package
- Root `package.json` coordinates workspaces, not versions
- Consumers can upgrade `@ws-kit/zod` without upgrading `@ws-kit/bun`

### TypeScript Project References (Critical for Boundary Enforcement)

**Purpose**: Enforce the dependency graph at the type-checking level and enable incremental builds.

**Root `tsconfig.json`**:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2020",
    "module": "esnext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true
  },
  "references": [
    { "path": "packages/core" },
    { "path": "packages/bun" },
    { "path": "packages/cloudflare-do" },
    { "path": "packages/zod" },
    { "path": "packages/valibot" },
    { "path": "packages/client" },
    { "path": "packages/redis-pubsub" }
  ]
}
```

**Per-package `tsconfig.json` example** (`packages/bun/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

**Key Benefits**:

- **Dependency graph enforcement**: TypeScript ensures only intended dependencies exist (e.g., `@ws-kit/zod` cannot import from `@ws-kit/bun`)
- **Incremental compilation**: Only recompile changed packages and their dependents (critical as org grows with more adapters)
- **Type caching**: Faster IDE feedback and watch-mode development
- **CI/CD clarity**: Build order is explicit; parallel builds only happen where safe

**Dependency Graph**:

```
core (no dependencies)
  ↓
┌─┴─┬────┬────────┬─────────┐
zod valibot bun cloudflare-do client
```

**Build behavior**:

- `tsc --build` respects the graph: always builds `core` first, then dependents
- Only changes since last build are recompiled (unless `--force` flag used)
- Types are cached; depending packages don't re-typecheck core on every change

### Monorepo Tooling

- **Workspace manager**: Bun workspaces (native)
- **Type-checking**: TypeScript Project References with `tsc --build` (enforces boundaries)
- **Publishing**: Use `@changesets/cli` with GitHub Actions
- **Testing**: `bun test` at root runs all packages
- **Linting**: ESLint across all packages (single config)
- **No shared code across packages except via npm** (enforce clean dependencies)

---

## Platform-Specific Features (Beyond Core Interface)

Each platform adapter exposes additional platform-specific APIs for power users. Access via context or direct API calls:

### @ws-kit/bun Extensions

```typescript
import { createBunAdapter } from "@ws-kit/bun";
import { createBunHandler } from "@ws-kit/bun";
import { WebSocketRouter } from "@ws-kit/core";
import { createZodValidator } from "@ws-kit/zod";
import { z } from "zod";

// Compose router with Bun adapter
const router = new WebSocketRouter({
  platform: createBunAdapter(),
  validator: createZodValidator(z),
});

// Access Bun-specific features via context
router.onMessage(schema, (ctx) => {
  ctx.ws.backpressure; // Write buffer size (Bun-specific)
  ctx.ws.data; // User data from upgrade
  ctx.ws.send(msg, "binary"); // Binary messages (Bun supports)
});

// Direct Bun serve integration
const { fetch, websocket } = createBunHandler(router);

Bun.serve({
  fetch,
  websocket,
});
```

### @ws-kit/cloudflare-do Extensions

```typescript
import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
import { WebSocketRouter } from "@ws-kit/core";
import { createZodValidator } from "@ws-kit/zod";
import { z } from "zod";

// Create router with Zod validator
const router = new WebSocketRouter({
  validator: createZodValidator(z),
});

// Access DO state and persistence via context
router.onMessage(schema, async (ctx) => {
  // Direct DO storage access (provided by handler)
  await ctx.storage.put("user:" + userId, userData);
  const stored = await ctx.storage.get("user:" + userId);

  // Explicit cross-DO messaging
  const room = env.ROOMS.get(roomId);
  await room.fetch(
    new Request("https://internal/sync", {
      method: "POST",
      body: JSON.stringify(syncData),
    }),
  );
});

// Create DO fetch handler
const handler = createDurableObjectHandler({
  router,
});

export default {
  fetch(req: Request, state: DurableObjectState, env: Env) {
    return handler.fetch(req);
  },
};
```

---

## File Structure After Migration

```
ws-kit/
├── .changeset/                      # Changeset configs
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── router.ts            # Base WebSocketRouter
│   │   │   ├── types.ts             # Abstract interfaces
│   │   │   ├── error.ts             # Error codes and handling
│   │   │   ├── pubsub.ts            # PubSub interface + MemoryPubSub
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── bun/
│   │   ├── src/
│   │   │   ├── adapter.ts           # createBunAdapter factory
│   │   │   ├── handler.ts           # createBunHandler factory
│   │   │   ├── pubsub.ts            # BunPubSub (native server.publish)
│   │   │   ├── types.ts             # Bun-specific types
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── zod/
│   │   ├── src/
│   │   │   ├── validator.ts         # Implements ValidatorAdapter
│   │   │   ├── schema.ts            # Exports createMessageSchema()
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── valibot/
│   │   ├── src/
│   │   │   ├── validator.ts         # Implements ValidatorAdapter
│   │   │   ├── schema.ts            # Exports createMessageSchema()
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── client/
│   │   ├── src/
│   │   │   ├── client.ts             # Core universal client
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── zod/                      # Optional sub-package (Phase 5.5)
│   │   │   ├── src/
│   │   │   │   ├── client.ts         # Enhanced createClient with Zod inference
│   │   │   │   └── index.ts
│   │   │   └── package.json
│   │   ├── valibot/                  # Optional sub-package (Phase 5.5)
│   │   │   ├── src/
│   │   │   │   ├── client.ts         # Enhanced createClient with Valibot inference
│   │   │   │   └── index.ts
│   │   │   └── package.json
│   │   ├── test/
│   │   ├── package.json
│   │   └── README.md
│   ├── cloudflare-do/
│   │   ├── src/
│   │   │   ├── handler.ts           # createDurableObjectHandler factory
│   │   │   ├── adapter.ts           # Internal platform adapter
│   │   │   ├── pubsub.ts            # DurablePubSub (BroadcastChannel)
│   │   │   ├── federate.ts          # Cross-DO messaging helper
│   │   │   ├── types.ts             # DO-specific types
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   └── redis-pubsub/
│       ├── src/
│       │   ├── pubsub.ts            # RedisPubSub implementation
│       │   ├── types.ts             # Redis connection options
│       │   └── index.ts
│       ├── test/
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
├── examples/                         # Top-level examples
│   ├── bun-server/
│   ├── cloudflare-do/
│   └── browser-client/
├── docs/                             # Unified documentation
├── specs/                            # Architecture specs (unchanged)
├── .github/workflows/                # Multi-package workflows
├── package.json                      # Root monorepo config
├── tsconfig.json                     # Shared TS config
├── eslint.config.ts                  # Shared ESLint config
├── bun.lock
└── README.md                         # Top-level guide
```

---

## CLI Commands (After Migration)

```bash
# Install dependencies for all packages
bun install

# Type-check with incremental builds (respects project references)
tsc --build

# Type-check with clean rebuild
tsc --build --force

# Build all packages (compile JS output)
bun run build

# Watch mode with incremental compilation
tsc --build --watch

# Test all packages
bun test

# Lint all packages
bun run lint

# Format all packages
bun run format

# Add changeset for next release
bunx changeset

# Build changeset changelog
bunx changeset version

# Publish to NPM (automated via CI)
bunx changeset publish
```

**Note**: `tsc --build` should be added to the `lint` or `test` pre-step in CI to enforce dependency graph compliance before build.

---

## Naming Conventions

- **Packages**: `@ws-kit/<adapter|validator|utility>`
- **Classes**: `BunWebSocketRouter`, `DurableObjectRouter`, etc.
- **Exports**: Default export is the main class; named exports for utilities
- **Types**: Suffixed with validator or platform name where needed
  - `ZodMessageSchemaType`, `BunServerWebSocket`, etc.

---

## Risks & Mitigations

| Risk                        | Mitigation                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Circular dependencies       | Define dependency graph clearly; **use TypeScript Project References to enforce at type-check time**                          |
| Type inference degradation  | Thorough testing of type inference per adapter                                                                                |
| Complex build process       | **Use TypeScript Project References with `tsc --build` for incremental builds; use unified tsconfig; test builds in CI**      |
| Accidental adapter coupling | **TypeScript Project References prevent invalid imports** (e.g., `@ws-kit/zod` importing from `@ws-kit/bun` fails at compile) |
| User adoption friction      | Migration guide + facade package for backward compat                                                                          |
| Monorepo tooling complexity | Stick with Bun's built-in workspace support; Project References are standard TS feature                                       |

---

## Success Criteria

### Core Architecture (Composition Over Inheritance)

- ✅ **Single `WebSocketRouter<V>` class** in `@ws-kit/core` (no subclasses)
- ✅ **No parallel class hierarchies** (no `ZodWebSocketRouter`, `BunWebSocketRouter`, etc.)
- ✅ **Composition-based design**: factories return adapters plugged into constructor
  - `new WebSocketRouter({ validator: createZodValidator(z), platform: createBunAdapter() })`
- ✅ **Any validator + any platform combination works** without N×M class explosion
- ✅ **Adding new validators/platforms doesn't require changes** to core or existing adapters

### Core Requirements

- ✅ Each package publishes to NPM under `@ws-kit/` org
- ✅ All packages are **pure ESM** with proper TypeScript type declarations (`.d.ts`)
  - ✅ All `package.json` files have `"type": "module"`
  - ✅ All packages use `"exports"` field with conditional type mappings
  - ✅ Sub-package exports (e.g., `@ws-kit/client/zod`) resolve correctly
  - ✅ TypeScript `"types"` field points to generated `.d.ts` files
- ✅ Full TypeScript inference maintained per validator (via generics and overloads, not inheritance)
- ✅ **TypeScript Project References configured and enforced**
  - ✅ Root `tsconfig.json` with `"composite": true` and all package references listed
  - ✅ Each package has `tsconfig.json` with `"composite": true` and appropriate dependencies
  - ✅ `tsc --build` enforces dependency graph (prevents invalid cross-package imports)
  - ✅ CI runs `tsc --build` before build to catch coupling violations early
- ✅ Zero breaking changes for existing `bun-ws-router` users (via migration guide)
- ✅ Independent versioning with `@changesets/cli` working correctly
- ✅ CI/CD pipeline handles multi-package publishing
- ✅ All tests pass
- ✅ Documentation updated with composition patterns and ESM requirement

### Production-Grade Features

- ✅ **Authentication lifecycle** with `onAuth` hook (invoked before first message dispatch)
- ✅ **Connection heartbeat** with configurable ping intervals and pong timeouts
- ✅ **Message limits** with payload size constraints enforced before deserialization
- ✅ **Lifecycle hooks** for cleanup (`onClose`) and error handling (`onError`)
- ✅ **Type-safe hook definitions** ensuring callbacks receive correct signatures

### Adapter Design

- ✅ **Validator adapters** (`@ws-kit/zod`, `@ws-kit/valibot`)
  - Depend ONLY on `@ws-kit/core` (platform-agnostic)
  - Provide both simple and advanced APIs:
    - `xxxValidator()` default export (convenience, internally imports validator library)
    - `createXxxValidator(lib)` factory (advanced, custom instances)
  - Provide both simple and advanced schema factories:
    - `messageSchema()` default export (convenience)
    - `createMessageSchema(lib)` factory (advanced)
  - Full type inference via generic overloads, not inheritance
- ✅ **Platform adapters** (`@ws-kit/bun`, `@ws-kit/cloudflare-do`)
  - Depend ONLY on `@ws-kit/core` (validator-agnostic)
  - Provide `createXxxAdapter(options)` factory returning `PlatformAdapter`
  - Implement `PubSub` interface specific to platform constraints

### PubSub Architecture

- ✅ `@ws-kit/core` provides abstract `PubSub` interface with `MemoryPubSub` default
- ✅ `router.publish(channel, message)` has consistent API but scope differs by platform:
  - **Bun**: Broadcasts to all listeners on that channel within a single process (load-balanced cluster with stateless instances)
  - **Cloudflare DO**: Broadcasts **only to WebSocket connections within the same DO instance** (not across shards)
- ✅ BunPubSub leverages native `server.publish()` with zero-copy semantics
- ✅ DurablePubSub uses BroadcastChannel for per-DO instance broadcasts; use `federate()` helper for explicit multi-DO coordination
- ✅ Platform advantages are maximized (no unnecessary abstractions limiting performance)
- ✅ Broadcast scope differences are documented prominently to prevent scaling surprises in multi-DO setups

### Adapter-Specific

- ✅ Bun server works with `@ws-kit/bun` (backward compatible in API, forward-compatible in composition)
- ✅ Cloudflare DO adapter functional with state management and federation patterns
- ✅ Examples demonstrate per-resource DO pattern and explicit cross-DO messaging

### Client & Type Inference

- ✅ Core `@ws-kit/client` is universal (no dependencies, works with `unknown` types)
- ✅ Optional `@ws-kit/client/zod` enables full type inference by re-using server schemas
- ✅ Optional `@ws-kit/client/valibot` enables full type inference by re-using server schemas
- ✅ Message handler callbacks have discriminated union typing when using validator plugins
- ✅ Schemas defined once (server-side) can be imported and used on client-side

### Type Testing & Inference (Type Safety Guarantees)

- ✅ **Compile-time type verification using `expectTypeOf`** from `bun:test` in all packages
  - ✅ `test/types/` structure per package with focused type assertions
  - ✅ Type regression tests verified via `bun run test:types` (runs `tsc --noEmit`)
  - ✅ Zero runtime overhead (type tests are compile-time only)
- ✅ **Core type assertions** validate foundational types:
  - Router generics, PubSub interface, MessageContext shape
  - Adapter interface compatibility, composition semantics
- ✅ **Per-adapter type assertions** guarantee inference never regresses:
  - Zod: Schema type inference, discriminated union narrowing, handler context typing
  - Valibot: Mirror Zod tests with Valibot schema system
  - Platform adapters: Type compatibility, platform-specific extensions
- ✅ **Cross-package composition type tests** ensure adapters compose without type loss:
  - Zod + Bun: Type inference preserved through platform adapter
  - Valibot + Cloudflare: Type inference preserved through platform adapter
  - No-validator + any platform: Falls back to `unknown` payload types (still type-safe)
- ✅ **CI enforces type safety**:
  - `tsc --build` prevents invalid cross-package imports
  - `bun run test:types` catches type regressions before build
  - Both runtime (`bun test`) and type tests required to pass

---

## Next Steps

1. **Discuss this plan** with team/users for feedback
2. **Create feature branch**: `feat/monorepo-migration`
3. **Start Phase 1**: Setup monorepo structure
4. **Incremental commits**: One phase per commit/PR for reviewability
5. **Testing**: Extensive testing before public release
6. **Release**: v1.0.0 under @ws-kit org with migration guide
