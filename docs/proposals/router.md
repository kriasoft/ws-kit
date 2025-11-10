# 1. Core mental model

- `createRouter()` creates a **tiny** router. Out of the box it has only:
  - `use(mw)` / `use(schema, mw)` (global/per-route)
  - `on(schema, handler)` (events)
  - `.plugin(fn)` (add capabilities)
  - `onError(fn)` (lifecycle hook)
- Capabilities are **added exclusively via plugins**:
  - `withZod()` / `withValibot()` → validation + rich handler context (`ctx.payload`, `ctx.send`, `ctx.reply`, `ctx.progress`…)
  - `withPubSub(...)` → `router.publish(...)` + `ctx.subscribe()`, `ctx.subscriptions`
  - `withHeartbeat(cfg)` / `withLimits(cfg)` → transparent behavior (no new APIs)
  - `withTelemetry({ onMessage, onError, onPublish })` → observability hooks
- **No capability options in `createRouter()`**: only `heartbeat` and `limits` are plain options. Everything else is a plugin.
- APIs **exist only when enabled** (compile-time capability gating). No "method present but throws 'disabled'".

# 2. Minimal runtime schema contract (stable)

Every message schema has a **stable runtime shape** that the core can read without peeking into validator internals:

```ts
interface RuntimeMessageSchema {
  readonly type: string; // stable, frozen literal type
  readonly kind: "event" | "rpc"; // core discriminates RPC from events without peeking into validator internals
  readonly version?: number; // opt-in rolling upgrades (future-proof for schema evolution)
  readonly __runtime?: "ws-kit-schema"; // brand
  readonly response?: RuntimeMessageSchema; // present only for RPC
}
```

Validator helpers (`message()`, `rpc()`) **brand** schemas at the type level and expose the runtime shape. The `kind` field lets the core discriminate event handlers from RPC handlers without validator-specific knowledge; `version` enables safe rolling upgrades for applications that need to evolve their message contracts.

# 3. Public API surface

## 3.1 createRouter (factory)

```ts
type CreateRouterOptions = {
  heartbeat?: { intervalMs: number; timeoutMs?: number };
  limits?: { maxPending?: number; maxPayloadBytes?: number };
};

function createRouter<TData = unknown>(
  opts?: CreateRouterOptions,
): Router<TData>;
```

Returns a `Router<TData>` object. Methods and context type widen based on **plugins** (not options).

## 3.2 Router shape (capability-gated)

```ts
type Router<TData, Caps = {}> = BaseRouter<TData> &
  (Caps extends { validation: true } ? ValidationAPI<TData> : {}) &
  (Caps extends { pubsub: true } ? PubSubAPI<TData> : {});
// heartbeat/limits/telemetry add no surface; they attach behavior.

interface BaseRouter<TData> {
  use(mw: Middleware<TData>): this;

  on(schema: RuntimeMessageSchema, handler: EventHandler<TData>): this;

  // per-route builder (middleware + handler chain)
  route(schema: RuntimeMessageSchema): RouteBuilder<TData>;

  // composition
  merge(
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;

  mount(
    prefix: string,
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;

  // plugin system (first-class; only way to add capabilities)
  plugin<P extends Plugin<TData>>(plugin: P): ReturnType<P>;

  // error hook (always present, minimal base)
  onError(fn: (err: unknown, ctx: MinimalContext<TData> | null) => void): this;
}

interface RouteBuilder<TData> {
  use(mw: Middleware<TData>): this;
  on(handler: EventHandler<TData>): void;
}
```

### Validation API (appears after `withZod()`/`withValibot()`)

```ts
interface ValidationAPI<TData> {
  rpc(
    schema: RuntimeMessageSchema & { response: RuntimeMessageSchema },
    handler: RpcHandler<TData>,
  ): this;
}
```

The `kind` field (set by `message()` and `rpc()` helpers) **discriminates event handlers from RPC handlers at the type level** without runtime overhead:

- `router.on(schema, handler)` accepts schemas where `kind === "event"` (inferred as error if `kind === "rpc"`)
- `router.rpc(schema, handler)` accepts schemas where `kind === "rpc"` (inferred as error if `kind === "event"` or missing `response`)

**Schema branding** enables strong payload and response inference via `InferPayload<TSchema>` and `InferResponse<TSchema>` utility types without exposing the branding symbol:

```ts
// message() and rpc() brand schemas at the type level
const Join = message("JOIN", { roomId: z.string() });
const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

// Event handler: payload inferred, send() available
router.on(Join, (ctx) => {
  ctx.type; // "JOIN" (literal)
  ctx.payload; // { roomId: string } (inferred)
  ctx.send(Join, { roomId: "..." }); // allowed
  ctx.reply({}); // type error
});

// RPC handler: payload + response inferred, reply() / progress() available
router.rpc(GetUser, async (ctx) => {
  ctx.payload; // { id: string } (inferred)
  ctx.reply({ id: "u1", name: "Alice" }); // response inferred
  ctx.progress({ id: "u1", name: "Loading..." }); // progress inferred
  ctx.send(Join, {}); // type error (events only in on handlers)
});
```

#### Type branding for inference utilities

The schema branding works entirely at the **type level** using TypeScript utility types. The implementation pattern:

```ts
// Validator helpers brand schemas and expose stable runtime shape
function message<T extends Record<string, ZodType>>(
  type: string,
  schema: T,
): RuntimeMessageSchema & {
  readonly kind: "event";
  // ^ Discriminator at type level (not exposed at runtime)
  // Implementation tracks InferPayload<T> internally
} {
  return { type, kind: "event" } as const;
}

function rpc<
  TReq extends Record<string, ZodType>,
  TResp extends Record<string, ZodType>
>(
  type: string,
  request: TReq,
  responseType: string,
  response: TResp,
): RuntimeMessageSchema & {
  readonly kind: "rpc";
  readonly response: RuntimeMessageSchema;
  // ^ Discriminator + response schema at type level
} {
  return { type, kind: "rpc", response: { type: responseType } } as const;
}

// Inference utilities (exported, used only at type-check time)
type InferPayload<T> = T extends { [K in keyof T]: infer U } ? U extends ZodType ? z.infer<U> : never : never;
type InferResponse<T extends { response?: unknown }> = T extends { response: infer R } ? /* extract response type */ : never;
```

**No branding symbol is exposed**. Applications work with plain `RuntimeMessageSchema` objects at runtime while getting full type safety via TypeScript's type-level inference. The `kind` field alone provides the discriminator needed for router methods and handlers.

### Pub/Sub API (appears after `withPubSub()`)

```ts
interface PubSubAPI<TData> {
  publish(
    topic: string,
    schema: RuntimeMessageSchema,
    payload: unknown,
    opts?: { partitionKey?: string; meta?: Record<string, unknown> },
  ): Promise<void>;

  subscriptions: {
    list(): readonly string[];
    has(topic: string): boolean;
  };
}
```

### Context (capability-gated)

- **Base** (always): `ctx.ws`, `ctx.type` (literal), `ctx.data` (connection data), `ctx.setData(partial)`.
- **Validation**: `ctx.payload` (inferred from schema). **Event handlers** (`router.on()`) have `ctx.send(schema, payload)` for sending events. **RPC handlers** (`router.rpc()`) have `ctx.reply(payload)` (terminal response) and `ctx.progress(payload)` (non-terminal updates). TypeScript enforces this based on `schema.kind`.
- **Pub/Sub**: `ctx.subscribe(topic)`, `ctx.unsubscribe(topic)`, `ctx.subscriptions.has(topic)`, `ctx.subscriptions.list()`.

# 4. Plugins

All plugins are simple functions that take a router and return a **widened** router:

```ts
type Plugin<TData, CAdd = unknown> = (
  router: Router<TData, any>,
) => Router<TData, MergeCaps<CAdd>>;
```

Built-ins:

```ts
function withZod(): Plugin<any, { validation: true }>;
function withValibot(): Plugin<any, { validation: true }>;

function withMemoryPubSub(): Plugin<any, { pubsub: true }>;
function withRedisPubSub(
  cfg: { url: string } | Redis,
): Plugin<any, { pubsub: true }>;

function withHeartbeat(cfg: {
  intervalMs: number;
  timeoutMs?: number;
}): Plugin<any>;
function withLimits(cfg: {
  maxPending?: number;
  maxPayloadBytes?: number;
}): Plugin<any>;

function withTelemetry(hooks: {
  onMessage?(meta: { type: string; size: number; ts: number }): void;
  onPublish?(meta: { topic: string; type: string }): void;
}): Plugin<any>;
```

# 5. Usage examples

## 5.1 Quick start (fluent plugin chaining)

```ts
import { z, message, rpc, withZod, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { withRedisPubSub } from "@ws-kit/redis";
import { withTelemetry } from "@ws-kit/telemetry";

const Join = message("JOIN", { roomId: z.string() });
const NewMessage = message("NEW_MESSAGE", {
  roomId: z.string(),
  text: z.string(),
});

const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

const router = createRouter<{ userId?: string }>({
  heartbeat: { intervalMs: 30_000, timeoutMs: 7_500 },
  limits: { maxPending: 128, maxPayloadBytes: 64 * 1024 },
})
  .plugin(withZod())
  .plugin(withRedisPubSub({ url: process.env.REDIS_URL! }))
  .plugin(withTelemetry({
    onMessage(meta) {
      console.log("message:", meta.type, meta.size);
    },
    onPublish(meta) {
      console.log("published to:", meta.topic);
    },
  }));

// Universal error sink (all errors flow here: validation, middleware, handler, pubsub)
// withTelemetry subscribes to this internally for observability
router.onError((err, ctx) => {
  console.error("error:", err, "type:", ctx?.type);
});

// Global middleware
router.use(async (ctx, next) => {
  // authenticate and set connection data
  ctx.setData({ userId: "u1" });
  return next();
});

// Per-route middleware + handler
router
  .route(Join)
  .use((ctx, next) => {
    if (!ctx.payload.roomId)
      ctx.send(NewMessage, { roomId: "system", text: "bad" });
    return next();
  })
  .on(async (ctx) => {
    await ctx.subscribe(ctx.payload.roomId);
    ctx.send(NewMessage, { roomId: ctx.payload.roomId, text: "joined" });
  });

// Or simple event without per-route middleware
// (kind === "event" discriminates from RPC; ctx.payload inferred)
router.on(Join, async (ctx) => {
  // ctx.type: "JOIN" (literal)
  // ctx.payload: { roomId: string } (inferred from message())
  await ctx.subscribe(ctx.payload.roomId);
  ctx.send(NewMessage, { roomId: ctx.payload.roomId, text: "joined" });
});

// RPC handler (kind === "rpc")
// (ctx.reply() and ctx.progress() only available here)
router.rpc(GetUser, async (ctx) => {
  // ctx.payload: { id: string } (inferred from rpc() request)
  // ctx.reply() response type: { id: string; name: string } (inferred from rpc() response)
  ctx.progress({ id: ctx.payload.id, name: "Loading..." });
  // fetch user…
  ctx.reply({ id: ctx.payload.id, name: "Alice" });
});

// Publishing from server code (not tied to a specific connection)
await router.publish("room:42", NewMessage, {
  roomId: "42",
  text: "server broadcast",
});

serve(router, { port: 3000 });
```

## 5.2 Conditional plugin loading

```ts
import { createRouter } from "@ws-kit/core";
import { withZod } from "@ws-kit/zod";
import { withRedisPubSub } from "@ws-kit/redis";

let router = createRouter<{ userId?: string }>();

if (process.env.VALIDATION !== "off") {
  router = router.plugin(withZod());
}
if (process.env.REDIS_URL) {
  router = router.plugin(withRedisPubSub({ url: process.env.REDIS_URL }));
}
```

## 5.3 Deterministic `merge()` with conflicts

```ts
const auth = createRouter()
  .plugin(withZod())
  .on(Auth.Login, loginHandler);

const chat = createRouter()
  .plugin(withZod())
  .on(Join, joinHandler);

const app = createRouter()
  .plugin(withZod())
  .merge(auth) // ok
  .merge(chat, { onConflict: "error" }); // throws if types collide
```

## 5.4 Namespacing with `mount()`

For larger applications, `mount()` prefixes all schema types in a sub-router, automatically avoiding collisions and organizing routes:

```ts
const auth = createRouter()
  .plugin(withZod())
  .on(Login, loginHandler)
  .on(Register, registerHandler);

const chat = createRouter()
  .plugin(withZod())
  .on(Join, joinHandler)
  .on(Send, sendHandler);

const app = createRouter()
  .plugin(withZod())
  .mount("auth.", auth)      // Login → "auth.LOGIN", Register → "auth.REGISTER"
  .mount("chat.", chat)      // Join → "chat.JOIN", Send → "chat.SEND"
  .mount("admin.", adminRouter, { onConflict: "error" });
```

**Key difference from `merge()`:**
- `merge()`: combines routers as-is; types must not collide (or explicit conflict resolution).
- `mount()`: prefixes all types; always namespace-safe. Invaluable for organizing large feature areas.

Both are deterministic, support `{ onConflict: "error" | "skip" | "replace" }`, and work seamlessly with middleware and plugins.

## 5.5 Client parity (typed RPC calls & events)

_(Sketch — shows DX goal; client package mirrors server schemas)_

```ts
import { createClient } from "@ws-kit/client";
import { GetUser, NewMessage } from "./schemas";

const client = createClient({ url: "ws://localhost:3000" });

// Receive events (listener)
client.on(NewMessage, (msg) => {
  // msg.payload: inferred { roomId: string; text: string }
});

// Send events (same verb as server ctx.send())
client.send(NewMessage, { roomId: "42", text: "hello" });

// RPC call (request-response)
const call = client.call(GetUser, { id: "u1" });
for await (const chunk of call.progress()) {
  // chunk: inferred { id: string; name: string }
}
const user = await call.result(); // inferred User
```

# 6. Middleware semantics (clear and minimal)

- **Global**: `router.use(fn)` → executes for **all** messages in registration order.
- **Per-route**: `router.route(schema).use(fn)` → runs **only** for messages of `schema.type`; chainable with `.on(handler)`.
- Order is deterministic: _global (in reg order) → per-route (in reg order) → handler_.
- `route()` returns a builder; multiple `.use()` calls chain in order before `.on()` registers the handler.
- `next()` returns a promise; exceptions bubble to `onError`.

# 7. Error model (single consolidated sink)

- `router.onError(fn)` is **always** available as the universal error sink.
- All errors (validation, middleware, handler, pubsub) flow to this single `onError` hook.
- Plugins like `withTelemetry` **subscribe** to `router.onError()` internally; there is no duplicate `onError` entry point in plugin config.
- Validation plugin turns schema errors into a structured `WsKitError<"BAD_REQUEST">` (or your chosen code).
- RPC handlers: unhandled exceptions auto-translate into a single terminal error reply; events: errors go to `onError`, not to clients (unless app chooses to send).
- PubSub publish failures go to `onError`.

### WsKitError semantics

`WsKitError.wrap()` preserves error type safety without narrowing:

```ts
static wrap<E extends string>(
  err: unknown,
  code?: E,
  details?: Record<string, unknown>,
): WsKitError<E | Existing> {
  const base =
    err instanceof WsKitError
      ? err
      : WsKitError.from("INTERNAL", String(err));

  // If a new code is requested and differs from the existing code,
  // return an immutable clone (never mutate, never lie about the code)
  return code && code !== base.code
    ? base.with({ code, details })
    : base;
}
```

This ensures:
- Error codes are never narrowed or mis-reported.
- If an error is already a `WsKitError`, wrapping with a different code creates a new instance, not a mutation.

# 8. Pub/Sub nuances (explicit, symmetric)

- Not enabled by default; methods don't exist until `withPubSub(...)`.
- Two entry points:
  - `router.publish(topic, schema, payload)` from server code.
  - `ctx.subscribe(topic)` / `ctx.unsubscribe(topic)` per connection.
- `ctx.subscriptions.list()` / `ctx.subscriptions.has(topic)` are **per-connection**; `router.subscriptions.list()` / `router.subscriptions.has(topic)` are **process-local**.
- Delivery semantics documented in the pubsub adapter (at-least-once vs best-effort).

# 9. Testing ergonomics

`createTestRouter()` helper provides a minimal, ergonomic testing API:

```ts
import { createTestRouter } from "@ws-kit/core/test";

const testRouter = createTestRouter(router);

// Fake clock integration for heartbeats, timeouts, intervals
testRouter.clock.advance(30_000); // Advance by 30s
testRouter.clock.reset();         // Reset to t=0

// Capture helpers for assertions
testRouter.capture.sentEvents();     // All events sent via ctx.send()
testRouter.capture.publishedTopics(); // All published topics
testRouter.capture.errors();         // All errors caught by onError

// Example: verify heartbeat timeout behavior
testRouter.clock.advance(40_000); // Heartbeat sends, client doesn't respond
assert(testRouter.capture.errors().some(err => err.code === "STALE_CONNECTION"));
```

Features:
- **In-memory transport** replaces WebSocket; no real network calls.
- **Fake clock** lets you deterministically test timeouts, heartbeats, and intervals without waiting.
- **Capture helpers** record `sentEvents()`, `publishedTopics()`, and `errors()` for easy assertions.

**Unit testing plugins**: Plugins are plain functions → test them in isolation by chaining onto a test router. Integration tests plug real router into `createTestRouter()` for full end-to-end assertions.

# 10. Tiny but important guardrails

- **No hidden PubSub:** if you didn't `.plugin(withPubSub(...))`, there is no `publish()`, `subscribe()`, or `subscriptions`.
- **Stable `schema.type`:** core never inspects validator-specific ASTs.
- **No `.build()` required:** the router is usable right away; plugins are pure and idempotent.
- **Deterministic `merge()`:** conflict policy is explicit and tested.

## TL;DR

- **Event vs RPC:** `router.on(schema, handler)` for events (payload inferred, `ctx.send()` available); `router.rpc(schema, handler)` for RPC (payload + response inferred, `ctx.reply()`/`ctx.progress()` available). The `kind` field discriminates these at both type and runtime.
- **Type inference:** Schema branding (via `message()` and `rpc()` helpers) works at the type level, enabling `InferPayload<TSchema>` and `InferResponse<TSchema>` without exposing internal symbols. Full type safety without runtime overhead.
- **Fluent routing:** `router.on(schema, handler)` for simple events; `router.route(schema).use(mw).on(handler)` for per-route middleware chains.
- **Global middleware:** `router.use(mw)` applies to all messages; per-route via `.route()` builder.
- **Composition:** `merge()` combines routers as-is (with conflict resolution); `mount(prefix, router)` prefixes types for namespace-safe organization.
- **Single plugin path:** `createRouter().plugin(withZod()).plugin(withRedisPubSub(...))` — fluent, composable, type-safe.
- **Options vs plugins:** `heartbeat` and `limits` are plain options. **Everything else** (validation, pubsub, telemetry) is a plugin.
- **No hidden APIs:** If you didn't `.plugin(withPubSub(...))`, there is no `publish()`, `subscribe()`, or `subscriptions`. Compile-time capability gating.
