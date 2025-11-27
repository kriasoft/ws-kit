# Testing Requirements

## Test Organization

Hybrid structure: unit tests in `src/` (co-located), feature tests in `test/`, cross-package in `tests/`.

### Package Tests

```text
packages/<name>/
├── src/*.test.ts          # Unit tests next to implementation
└── test/features/         # Feature/integration tests (optional)
```

- **Unit tests** (`src/`): Test individual modules directly (e.g., `plugin.test.ts`, `types.test.ts`)
- **Feature tests** (`test/features/`): Integration-style specs, validator scenarios

### Cross-Package Tests (`tests/`)

```text
tests/
├── integration/           # Cross-package integration
├── e2e/                   # Full client-server scenarios
├── benchmarks/            # Performance benchmarks
└── helpers/               # Shared utilities
```

### When Adding Tests

- **Unit tests**: `packages/*/src/*.test.ts` (next to the file being tested)
- **Feature tests**: `packages/*/test/features/` (integration scenarios)
- **Validator features**: Mirror Zod tests in Valibot
- **Cross-package**: `tests/integration/` or `tests/e2e/`

### Running Tests

```bash
bun test                           # All tests
bun test packages/core/src         # Package unit tests
bun test packages/zod/test         # Package feature tests
bun test --grep "pattern"          # By pattern
```

## Test Harness Basics

### Lifecycle Hooks

| Scenario                                                                    | Hook(s) to use                 | Where to register                                                                                                                                      | Why                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared fixtures created in `beforeEach` (most suites)                       | `beforeEach` + `afterEach`     | Declare fixture in `beforeEach`, dispose in matching `afterEach`                                                                                       | Guarantees deterministic per-test setup/teardown                                                                                                                                  |
| Ad-hoc resource created directly inside an `it` block (e.g., helper client) | `onTestFinished`               | Call `onTestFinished` **inside the same `it`** right after creating the resource                                                                       | Ensures cleanup even if the test fails midway; no shared state needed                                                                                                             |
| Suite-level final assertion/cleanup (leak detection, metrics)               | `afterAll` (+ guard if needed) | Prefer `afterAll` for once-per-suite assertions; if `onTestFinished` is required, register it inside `afterAll` so it runs immediately after that hook | `onTestFinished` attaches to the currently running test/hook—calling it from `beforeEach`/`afterEach` still executes per test, so it cannot enforce suite-level checks on its own |

> Rule of thumb: `afterEach` handles anything spawned in shared hooks; `onTestFinished` handles one-off resources or final suite checks.

```typescript
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from "bun:test";
import { createClient } from "../../src/index.js";
import { createMockWebSocket } from "./helpers.js";

describe("Client runtime example", () => {
  let client: ReturnType<typeof createClient>;
  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    mockWs = createMockWebSocket();
    client = createClient({
      url: "ws://test",
      wsFactory: () => {
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it("creates an ad-hoc client", async () => {
    const mockWs = createMockWebSocket();
    const localClient = createClient({
      url: "ws://example",
      wsFactory: () => {
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
    });
    onTestFinished(async () => localClient.close());
    await localClient.connect();
  });
});
```

### Mock WebSocket Helpers

- Use `createMockWebSocket()` from `tests/helpers/client.ts` to deterministically simulate lifecycle events.
- Define helpers once per suite and reuse them in tests:

```typescript
let simulateReceive: (msg: unknown) => void;
let simulateRaw: (raw: string) => void;

beforeEach(() => {
  mockWs = createMockWebSocket();
  simulateReceive = (msg) => mockWs._trigger.message(msg);
  simulateRaw = (raw) => mockWs.onmessage?.({ data: raw });
  client = createClient({
    url: "ws://test",
    wsFactory: () => {
      setTimeout(() => mockWs._trigger.open(), 0);
      return mockWs as unknown as WebSocket;
    },
    reconnect: { enabled: false },
  });
});
```

All runtime examples below assume `simulateReceive(payload)` JSON-encodes structured data, while `simulateRaw(rawJson)` feeds literal strings for parse-failure tests.
When a snippet references `client`, `mockWs`, or these helpers without redefining them, it relies on this shared fixture.

## Section Map

Quick navigation for AI tools:

- [#Test-Organization](#test-organization) — Directory structure and running tests
- [#Router-Testability](#router-testability) — Testing utilities for router state inspection and reset
- [#Type-Level-Testing](#type-level-testing) — Compile-time validation with expectTypeOf
- [#Handler-Context-Inference](#handler-context-inference) — Server handler type tests
- [#Client-Type-Inference](#client-type-inference) — Client handler and request/response tests
- [#Runtime-Testing](#runtime-testing) — Validation, normalization, and strict schema tests
- [#Key-Constraints](#key-constraints) — Testing requirements summary
- **Testing patterns**: See docs/specs/rules.md for broader testing guidance

## Router Testability

The WebSocketRouter provides three opt-in testing utilities to simplify unit test setup and assertions:

### Testing Mode: Inspect Internal State

Enable testing mode to access internal state without reflection:

```typescript
import { createRouter } from "@ws-kit/zod";

const router = createRouter({ testing: true });

const TestMsg = message("TEST", { id: z.number() });
router.on(TestMsg, (ctx) => {
  /* handler */
});

// Inspect handlers, middleware, and lifecycle handlers
expect(router._testing?.handlers.size).toBe(1);
expect(router._testing?.middleware.length).toBe(0);
expect(router._testing?.openHandlers.length).toBe(0);
```

**When to use**: Unit testing where you need to verify router configuration without executing handlers.

**Convention**: The `_testing` prefix signals "testing internals" (borrowed from Vitest/Preact). Not part of public API.

### Reset Method: Reuse Router Instance

Clear all handlers and middleware without creating a new router instance:

```typescript
let router: WebSocketRouter;

beforeEach(() => {
  if (!router) {
    router = createRouter();
  } else {
    router.reset(); // Clear handlers, keep validator config
  }
});

test("first test", () => {
  router.on(Message1, handler1);
  expect(router.routes().length).toBe(1);
});

test("second test", () => {
  router.reset(); // Clean slate
  router.on(Message2, handler2);
  expect(router.routes().length).toBe(1); // Only Message2
});
```

**What's cleared**: Message handlers, global middleware, per-route middleware, lifecycle handlers.

**What's preserved**: Validator, platform adapter, heartbeat/limit configuration, active connection states.

**Returns**: `this` for method chaining.

### Validation Bypass: Test Edge Cases

Skip message validation for testing without schema:

```typescript
const router = createRouter({ testing: true });

// Send message without validation (useful for testing error paths)
let contextSend: SendFunction;
router.on(TestMsg, (ctx) => {
  contextSend = ctx.send;
});

// In test: call send with invalid payload, skip validation
const mockWs = createMockWebSocket();
const sendFn = (router as any).createSendFunction(mockWs);
sendFn(AnySchema, { invalid: "data" }, { validate: false });

// Message sent as-is, no validation error
expect(mockWs._getMessages().length).toBe(1);
```

> **Note**: `(router as any).createSendFunction()` is an intentional internal testing hook, akin to `router._testing`. It lets tests drive the outbound pipeline with a specific connection while skipping validation—behavior that the public API intentionally does not expose. Use this pattern whenever you need to send raw messages for error-path coverage.

**When to use**: Testing error handling, message processing pipelines, or edge cases that require bypassing validation.

**Default behavior**: Validation is always ON (production safe). Pass `validate: false` explicitly to disable.

**Metadata preservation**: Other metadata (correlationId, custom fields) is preserved when validation is skipped; only the `validate` flag is filtered out.

## Accessing Internal Router State (Plugins and Advanced Testing)

When writing plugins or advanced tests, you may need to access internal router implementation details such as lifecycle hooks, client connections, or the route table. Use the `ROUTER_IMPL` symbol pattern to do this safely without depending on implementation classes directly.

### Pattern: Symbol-Based Internal Access

All internal router access uses the `ROUTER_IMPL` symbol from `@ws-kit/core/internal` (marked `@internal`, not a public export):

```typescript
import { ROUTER_IMPL } from "@ws-kit/core/internal";
import type { RouterImpl } from "@ws-kit/core/internal";

// For plugins (e.g., @ws-kit/zod, @ws-kit/pubsub)
export function withMyPlugin(options?: Options) {
  return (router: Router<TContext>) => {
    // Get internal access with proper error handling
    const impl = (router as any)[ROUTER_IMPL] as
      | RouterImpl<TContext>
      | undefined;
    if (!impl) {
      throw new Error(
        "withMyPlugin requires internal router access (ROUTER_IMPL symbol)",
      );
    }

    // Now you can safely access impl.createContext, impl.getClientId(), etc.
    const originalCreateContext = impl.createContext.bind(impl);
    impl.createContext = function (params: any) {
      const ctx = originalCreateContext(params);
      // Attach custom methods to context
      return ctx;
    };
  };
}

// For test harness and test utilities
import { wrapTestRouter } from "@ws-kit/core/testing";

const testRouter = wrapTestRouter(router);
// testRouter has all test-specific methods: connect(), getMessages(), etc.
```

### Key Points

1. **Symbol is not exported from `@ws-kit/core`** — Only available via `@ws-kit/core/internal` to signal non-public dependency
2. **Error handling is mandatory** — If the symbol is missing, throw early with a clear message
3. **Type inference works** — Once accessed via symbol, TypeScript knows it's `RouterImpl<TContext>`
4. **Prefer public APIs** — Only use internal access when absolutely necessary (wrapping core methods, introspection)

### When to Use This Pattern

- **Plugins** — Wrapping `createContext`, intercepting lifecycle hooks, tracking connections
- **Test harnesses** — Accessing route tables, client IDs, live subscriptions
- **Monitoring/telemetry** — Introspecting router state (rare)

### When NOT to Use

- **Regular tests** — Use the public test harness (`wrapTestRouter`) instead
- **Application code** — Use public APIs (`ctx.send()`, `ctx.publish()`, etc.)
- **Configuration** — Use router options, not internal hooks

For more details, see **ADR-026: Internal Router Access Patterns**.

## Type-Level Testing

Use `expectTypeOf` from Bun for compile-time validation:

```typescript
import { expectTypeOf } from "bun:test";

// Test conditional payload typing
const WithPayload = message("WITH", { id: z.number() });
const WithoutPayload = message("WITHOUT");

router.on(WithPayload, (ctx) => {
  expectTypeOf(ctx.payload).toEqualTypeOf<{ id: number }>();
  expectTypeOf(ctx.payload.id).toBeNumber();
});

router.on(WithoutPayload, (ctx) => {
  // @ts-expect-error - payload should not exist
  ctx.payload;
});
```

## Handler Context Inference

```typescript
// Test inline handler type inference
router.on(TestMessage, (ctx) => {
  expectTypeOf(ctx.type).toEqualTypeOf<"TEST">();

  // Server-provided timestamp is always present (server clock)
  expectTypeOf(ctx.receivedAt).toBeNumber();

  // Client's timestamp in meta is optional (client's clock, untrusted)
  expectTypeOf(ctx.meta.timestamp).toEqualTypeOf<number | undefined>();

  // Connection identity is always present as ctx.clientId (UUID v7)
  expectTypeOf(ctx.clientId).toBeString();

  expectTypeOf(ctx.send).toBeFunction();
});
```

## Discriminated Union Testing

```typescript
const PingMsg = message("PING");
const PongMsg = message("PONG", { reply: z.string() });

// Test discriminated union creation
const MessageUnion = z.discriminatedUnion("type", [PingMsg, PongMsg]);
expectTypeOf(MessageUnion.parse({ type: "PING", meta: {} })).toMatchTypeOf<{
  type: "PING";
  meta: MessageMetadata;
}>();
```

## Cross-Package Type Compatibility

```typescript
// Test type inference preserves types across package boundaries
import { z, message } from "@ws-kit/zod";

const TestSchema = message("TEST", { value: z.number() });

// Should work in discriminated unions
const union = z.discriminatedUnion("type", [TestSchema]);
expectTypeOf(union).toMatchTypeOf<z.ZodDiscriminatedUnion<"type", any>>();
```

## RPC Context Inference Type Tests

**Location**: `packages/core/src/context/rpc-context-inference.test.ts`

**Purpose**: Verify RPC context (via `router.rpc()`) and event context (via `router.on()`) have properly discriminated types with correct inference for RPC-specific methods: `reply()`, `progress()`, `onCancel()`, `deadline`.

**Related**: ADR-001, ADR-002, ADR-015

### Context Type Discrimination

RPC context must have `isRpc: true` and RPC methods; event context must have `isRpc: false` without RPC methods:

```typescript
router.rpc(GetUser, (ctx) => {
  expectTypeOf(ctx.isRpc).toEqualTypeOf<true>();
  expectTypeOf(ctx.reply).toBeFunction();
  expectTypeOf(ctx.deadline).toBeNumber();
});

router.on(UserLoggedIn, (ctx) => {
  expectTypeOf(ctx.isRpc).toEqualTypeOf<false>();
  // @ts-expect-error - RPC methods should not exist
  ctx.reply;
});
```

### Payload Conditional Typing

Payload presence matches schema in both RPC and event contexts:

```typescript
const GetUser = rpc("GET_USER", { id: z.string() }, "USER_OK", {
  name: z.string(),
});
router.rpc(GetUser, (ctx) => {
  expectTypeOf(ctx.payload).toEqualTypeOf<{ id: string }>();
});

const Heartbeat = rpc("HEARTBEAT", undefined, "HEARTBEAT_ACK", undefined);
router.rpc(Heartbeat, (ctx) => {
  // @ts-expect-error - no payload
  ctx.payload;
});
```

### Middleware Context Narrowing

Use `isRpc` flag to narrow context in middleware:

```typescript
router.use((ctx, next) => {
  if (ctx.isRpc) {
    ctx.onCancel(() => {
      /* cleanup */
    });
  }
  return next();
});
```

### Test Coverage

The test file verifies:

- Context type discrimination and narrowing
- Payload conditional typing (RPC & Event)
- Union type handling (`MessageContext<T>` union)
- Custom data type preservation
- Complex generics (discriminated unions, nested payloads)
- Metadata type safety
- ADR-002 type override compatibility

## RPC Incomplete Handler Detection Tests

**Location**: `packages/core/src/context/rpc-incomplete-warning.test.ts`

**Purpose**: Verify that the router warns developers when RPC handlers complete without sending a terminal response (reply or error). This helps catch common bugs where `ctx.reply()` or `ctx.error()` is forgotten, causing client timeouts.

**Configuration tested**:

- `warnIncompleteRpc?: boolean` (default: true)
- Dev-mode only (`NODE_ENV !== "production"`)
- Configuration flag respected (disabled when false)

### Warning Triggering

Tests verify warnings fire when:

- Sync handler completes without reply or error
- Async handler completes without reply or error
- Handler returns early (e.g., without calling error in early-return branches)
- Progress is sent but terminal response is missing

### No Warning Cases

Tests verify warnings do NOT fire when:

- Handler calls `ctx.reply()` with response
- Handler calls `ctx.error()` with error code and message
- Non-RPC messages (event handlers) complete without reply
- Configuration flag is disabled (`warnIncompleteRpc: false`)

### Warning Message Content

Tests verify warning messages include:

- Message type being handled
- Correlation ID for request identification
- Actionable guidance (mention ctx.reply/error)
- Suggestion to disable warning for legitimate async patterns

### Configuration Behavior

```typescript
// Enabled by default
const router = createRouter();
// Warnings logged in dev mode

// Disabled
const router = createRouter({ warnIncompleteRpc: false });
// No warnings even if handlers forget reply

// Custom timeout config (orthogonal to warnings)
const router = createRouter({
  rpcTimeoutMs: 5000,
  warnIncompleteRpc: true,
});
```

### Legitimate Async Patterns

The implementation warns for common bugs while providing escape hatch for legitimate async patterns:

```typescript
// ✅ Will warn (legitimate false positive - pattern should be disabled)
router.rpc(LongTask, (ctx) => {
  setTimeout(() => {
    ctx.reply(Result, { done: true });
  }, 1000);
  // Handler completes before setTimeout fires
});

// Mitigation:
const router = createRouter({ warnIncompleteRpc: false });
// Or: configure per-router if needed
```

## Runtime Testing

```typescript
test("message validation", () => {
  const TestMsg = message("TEST", { id: z.number() });

  const valid = TestMsg.safeParse({
    type: "TEST",
    meta: { timestamp: Date.now() },
    payload: { id: 123 },
  });

  expect(valid.success).toBe(true);

  const invalid = TestMsg.safeParse({
    type: "TEST",
    meta: {},
    payload: { id: "string" },
  });

  expect(invalid.success).toBe(false);
});

test("server: inbound normalization strips reserved keys before validation", () => {
  const TestMsg = message("TEST", { id: z.number() });

  // Client tries to inject reserved keys
  const malicious = {
    type: "TEST",
    meta: { clientId: "fake-id", receivedAt: 999 },
    payload: { id: 123 },
  };

  // Server normalization strips reserved keys before validation
  // Message should pass validation (no unknown keys after stripping)
  const normalized = normalizeInboundMessage(malicious);
  expect(TestMsg.safeParse(normalized).success).toBe(true);
  expect(normalized.meta).not.toHaveProperty("clientId");
  expect(normalized.meta).not.toHaveProperty("receivedAt");
});

// See docs/specs/validation.md#Strict-Mode-Enforcement for strict validation requirements
test("strict schema rejects unknown keys", () => {
  const TestMsg = message("TEST", { id: z.number() });

  // Unknown key at root
  expect(
    TestMsg.safeParse({
      type: "TEST",
      meta: {},
      payload: { id: 123 },
      unknown: "bad", // ❌ Should fail
    }).success,
  ).toBe(false);

  // Unknown key in meta
  expect(
    TestMsg.safeParse({
      type: "TEST",
      meta: { junk: "xyz" }, // ❌ Should fail
      payload: { id: 123 },
    }).success,
  ).toBe(false);

  // Unknown key in payload
  expect(
    TestMsg.safeParse({
      type: "TEST",
      meta: {},
      payload: { id: 123, extra: "oops" }, // ❌ Should fail
    }).success,
  ).toBe(false);
});

// See docs/specs/validation.md#Strict-Mode-Enforcement for validation behavior table
test("strict schema rejects unexpected payload", () => {
  const NoPayloadMsg = message("NO_PAYLOAD");
  const WithPayloadMsg = message("WITH_PAYLOAD", { id: z.number() });

  // Schema without payload - must reject if payload key present
  expect(
    NoPayloadMsg.safeParse({
      type: "NO_PAYLOAD",
      meta: {},
      payload: {}, // ❌ Should fail - unexpected key
    }).success,
  ).toBe(false);

  expect(
    NoPayloadMsg.safeParse({
      type: "NO_PAYLOAD",
      meta: {},
      payload: undefined, // ❌ Should fail - unexpected key
    }).success,
  ).toBe(false);

  // Schema without payload - must accept when payload key absent
  expect(
    NoPayloadMsg.safeParse({
      type: "NO_PAYLOAD",
      meta: {},
    }).success,
  ).toBe(true);

  // Schema with payload - must reject when payload key absent
  expect(
    WithPayloadMsg.safeParse({
      type: "WITH_PAYLOAD",
      meta: {},
    }).success,
  ).toBe(false);

  // Schema with payload - must accept when payload present
  expect(
    WithPayloadMsg.safeParse({
      type: "WITH_PAYLOAD",
      meta: {},
      payload: { id: 123 },
    }).success,
  ).toBe(true);
});

test("server logic uses ctx.receivedAt, not meta.timestamp", () => {
  const TestMsg = message("TEST", { id: z.number() });
  const before = Date.now();

  router.on(TestMsg, (ctx) => {
    // ctx.receivedAt is server ingress time (authoritative)
    expect(ctx.receivedAt).toBeGreaterThanOrEqual(before);
    expect(ctx.receivedAt).toBeLessThanOrEqual(Date.now());

    // meta.timestamp is optional producer time (untrusted, may be skewed)
    if (ctx.meta.timestamp !== undefined) {
      // Server logic MUST NOT rely on meta.timestamp for ordering/rate-limiting
      expect(typeof ctx.meta.timestamp).toBe("number");
    }
  });
});

test("router.publish() never injects clientId", async () => {
  const ChatMsg = message("CHAT", { text: z.string() });
  const router = createRouter();

  let publishedMessage: any;
  router.pubsub.subscribe("room", (msg) => {
    publishedMessage = msg;
  });

  // Publish without custom meta
  await router.publish("room", ChatMsg, { text: "hi" });
  expect(publishedMessage.meta).not.toHaveProperty("clientId");
  expect(publishedMessage.meta).toHaveProperty("timestamp");
});

test("router.publish() with extended meta for sender tracking", async () => {
  const ChatMsg = message(
    "CHAT",
    { text: z.string() },
    { senderId: z.string().optional() },
  );
  const router = createRouter();

  let publishedMessage: any;
  router.pubsub.subscribe("room", (msg) => {
    publishedMessage = msg;
  });

  // Include sender in extended meta
  await router.publish(
    "room",
    ChatMsg,
    { text: "hi" },
    { meta: { senderId: "alice" } },
  );
  expect(publishedMessage.meta).toHaveProperty("senderId", "alice");
  expect(publishedMessage.meta).not.toHaveProperty("clientId");
});

test("custom metadata merges with auto-injected fields", async () => {
  const ChatMsg = message(
    "CHAT",
    { text: z.string() },
    { senderId: z.string().optional() },
  );
  const router = createRouter();

  let publishedMessage: any;
  router.pubsub.subscribe("room", (msg) => {
    publishedMessage = msg;
  });

  await router.publish(
    "room",
    ChatMsg,
    { text: "hi" },
    { meta: { senderId: "alice", priority: 5 } },
  );

  expect(publishedMessage.meta.senderId).toBe("alice");
  expect(publishedMessage.meta.priority).toBe(5);
  expect(publishedMessage.meta).toHaveProperty("timestamp"); // Auto-injected
});
```

### Client multi-handler + reserved meta rules {#client-multiple-handlers}

- Multiple handlers fire strictly in registration order, handler errors never short-circuit later handlers, and `unsubscribe()` removes only the targeted callback.
- Reserved meta keys (`clientId`, `receivedAt`) are rejected at schema creation time, even when mixed with otherwise valid custom meta fields.
- **Reference**: `packages/client/src/handlers.test.ts`, `packages/core/src/internal/normalization.test.ts`.

> **Standard Fixture Reminder**: Unless explicitly redefined, the runtime tests below reuse the shared `beforeEach` setup described in [Mock WebSocket Helpers](#mock-websocket-helpers) (`client`, `mockWs`, `simulateReceive`, `simulateRaw`). Recreate that scaffold when copying an individual test into a new suite.

```typescript
test("request() timeout starts after flush, not enqueue", async () => {
  const client = createClient({
    url: "ws://test",
    reconnect: { enabled: false },
  });

  // Don't open yet - message will be queued
  const startTime = Date.now();

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 1000,
  });

  // Wait 500ms while queued
  await Bun.sleep(500);

  // Now connect (triggers flush)
  const flushTime = Date.now();
  await client.connect();

  // Timeout should fire ~1000ms AFTER flush, not from initial request()
  await expect(reqPromise).rejects.toThrow(TimeoutError);

  const timeoutTime = Date.now();
  const totalTime = timeoutTime - startTime; // ~1500ms
  const timeFromFlush = timeoutTime - flushTime; // ~1000ms

  // Verify timeout counted from flush, not enqueue
  expect(timeFromFlush).toBeGreaterThanOrEqual(950);
  expect(timeFromFlush).toBeLessThanOrEqual(1100);
});

test("request() cancels timeout on disconnect", async () => {
  const client = createClient({ url: "ws://test" });
  await client.connect();

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
  });

  // Close connection before response arrives
  await client.close();

  // Should reject with ConnectionClosedError, not TimeoutError
  await expect(reqPromise).rejects.toThrow(ConnectionClosedError);
});

test("request() rejects with StateError when aborted before dispatch", async () => {
  const client = createClient({ url: "ws://test" });
  await client.connect();

  const controller = new AbortController();
  controller.abort(); // Abort before request

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    signal: controller.signal,
  });

  await expect(reqPromise).rejects.toThrow(StateError);
  await expect(reqPromise).rejects.toMatchObject({
    message: expect.stringContaining("Request aborted before dispatch"),
  });
});

test("request() rejects with StateError when aborted while pending", async () => {
  const client = createClient({ url: "ws://test" });
  await client.connect();

  const controller = new AbortController();

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 60000,
    signal: controller.signal,
  });

  // Abort while pending
  controller.abort();

  await expect(reqPromise).rejects.toThrow(StateError);
  await expect(reqPromise).rejects.toMatchObject({
    message: expect.stringContaining("Request aborted"),
  });
});

test("request() cleans up pending map and cancels timeout on abort", async () => {
  const client = createClient({ url: "ws://test" });
  await client.connect();

  const controller = new AbortController();
  const correlationId = "req-abort-cleanup";

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 60000,
    signal: controller.signal,
    correlationId,
  });

  // Abort request
  controller.abort();
  await expect(reqPromise).rejects.toThrow(StateError);

  // Server sends late reply (should be ignored - pending map cleaned)
  simulateReceive({
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "late reply" },
  });

  // No errors thrown; late reply dropped silently
});

test("request() rejects on wrong-type reply with matching correlationId", async () => {
  const client = createClient({ url: "ws://test" });
  const Hello = message("HELLO", { name: z.string() });
  const HelloOk = message("HELLO_OK", { text: z.string() });
  const Goodbye = message("GOODBYE", { message: z.string() });

  await client.connect();

  const correlationId = "req-wrong-type";
  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
    correlationId,
  });

  // Server sends wrong type but correct correlationId
  simulateReceive({
    type: "GOODBYE", // ❌ Wrong type
    meta: { correlationId },
    payload: { message: "bye" },
  });

  await expect(reqPromise).rejects.toThrow(ValidationError);
  await expect(reqPromise).rejects.toMatchObject({
    message: expect.stringContaining("Expected HELLO_OK, got GOODBYE"),
  });
});

test("request() rejects on malformed reply with matching correlationId", async () => {
  const client = createClient({ url: "ws://test" });
  const Hello = message("HELLO", { name: z.string() });
  const HelloOk = message("HELLO_OK", { text: z.string() });

  await client.connect();

  const correlationId = "req-invalid-reply";
  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
    correlationId,
  });

  // Server sends correct type but invalid payload
  simulateReceive({
    type: "HELLO_OK", // ✅ Correct type
    meta: { correlationId },
    payload: { text: 123 }, // ❌ Invalid: should be string
  });

  await expect(reqPromise).rejects.toThrow(ValidationError);
  await expect(reqPromise).rejects.toMatchObject({
    issues: expect.arrayContaining([
      expect.objectContaining({
        path: ["payload", "text"],
        message: expect.stringContaining("string"),
      }),
    ]),
  });
});

test("request() ignores duplicate replies with same correlationId", async () => {
  const client = createClient({ url: "ws://test" });
  const Hello = message("HELLO", { name: z.string() });
  const HelloOk = message("HELLO_OK", { text: z.string() });

  await client.connect();

  const correlationId = "req-duplicates";
  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
    correlationId,
  });

  // First reply - settles the promise
  simulateReceive({
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "first" },
  });

  const reply = await reqPromise;
  expect(reply.payload.text).toBe("first");

  // Second reply with same correlationId - dropped silently (no error)
  simulateReceive({
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "second" }, // Ignored
  });

  // Third reply - also dropped silently
  simulateReceive({
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "third" }, // Ignored
  });

  // No errors thrown; duplicates ignored after first settles
});
```

### Send / queue semantics

- Connected clients return `true` from `send()`; disconnected clients rely on queue mode (`drop-newest`, `drop-oldest`, `off`) to decide whether to buffer, drop newest, or reject immediately.
- Queue overflow honors the configured strategy: `drop-newest` rejects the incoming message, `drop-oldest` evicts the oldest buffered entry before accepting the new payload.
- Invalid payloads always return `false` synchronously (schema validation happens before enqueue).
- **Reference**: `packages/client/src/queue.test.ts`.

```typescript
test("request() rejects with ValidationError on invalid payload", async () => {
  const client = createClient({ url: "ws://test" });
  await client.connect();

  // @ts-expect-error - testing runtime validation
  const promise = client.request(
    ChatMsg,
    { text: 123 }, // Invalid type
    ChatResponse,
    { timeoutMs: 1000 },
  );

  await expect(promise).rejects.toThrow(ValidationError);
});

test("request() rejects with StateError when queue: off and disconnected", async () => {
  const client = createClient({
    url: "ws://test",
    queue: "off",
  });
  // Not connected - queue disabled

  const promise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 1000,
  });

  await expect(promise).rejects.toThrow(StateError);
  await expect(promise).rejects.toMatchObject({
    message: expect.stringContaining(
      "Cannot send request while disconnected with queue disabled",
    ),
  });
});

test("request() rejects with StateError when pending limit exceeded", async () => {
  const client = createClient({
    url: "ws://test",
    pendingRequestsLimit: 2,
    reconnect: { enabled: false },
  });

  await client.connect();

  // Fill pending queue (server doesn't reply)
  const req1 = client.request(Hello, { name: "1" }, HelloOk, {
    timeoutMs: 60000,
  });
  const req2 = client.request(Hello, { name: "2" }, HelloOk, {
    timeoutMs: 60000,
  });

  // Third request exceeds limit
  await expect(client.request(Hello, { name: "3" }, HelloOk)).rejects.toThrow(
    StateError,
  );

  await expect(
    client.request(Hello, { name: "3" }, HelloOk),
  ).rejects.toMatchObject({
    message: expect.stringContaining("Pending request limit exceeded"),
  });
});

test("pending request limit enforced before timeout check", async () => {
  const client = createClient({
    url: "ws://test",
    pendingRequestsLimit: 1,
  });
  await client.connect();

  const req1 = client.request(Hello, { name: "1" }, HelloOk, {
    timeoutMs: 100,
  });

  // Immediate rejection (does NOT wait for timeout)
  const startTime = Date.now();
  await expect(client.request(Hello, { name: "2" }, HelloOk)).rejects.toThrow(
    StateError,
  );

  const elapsed = Date.now() - startTime;
  expect(elapsed).toBeLessThan(50); // Fails fast, doesn't wait for timeout
});
```

### `onUnhandled()` contract

- Fires only for structurally valid messages with no registered schema; invalid JSON and validation failures are dropped before reaching the hook.
- Schema handlers always execute before `onUnhandled()`, and the hook must treat the message as readonly.
- **Reference**: `packages/client/src/handlers.test.ts`.

### Auto-connect behavior

- First `send()` or `request()` triggers connection when `autoConnect: true`; merely registering handlers does not.
- Connection failures surface through the initiating API: `send()` returns `false`, while `request()` rejects with the original error. When `queue: "off"`, subsequent calls reject with `StateError` until the caller reconnects manually.
- Auto-connect does not restart automatically after an explicit `close()`.
- **Reference**: `tests/integration/client/auto-connect.test.ts`.

### Extended meta & outbound normalization

- Required meta fields must be supplied when calling `send()`/`request()`; optional meta can be omitted. Type errors enforce this at compile time.
- Outbound normalization preserves user-provided timestamps, auto-injects them when missing, strips reserved keys (`clientId`, `receivedAt`, `correlationId`) from `opts.meta`, and only trusts `opts.correlationId`.
- Extended metadata travels with requests so replies can be scoped (e.g., `roomId`).
- **Reference**: `packages/client/src/normalize.test.ts`, `packages/client/src/requests.test.ts`.

### `onError` hook expectations

- Fires for parse failures, validation failures, and queue overflow events with structured context.
- Does **not** fire for caller-managed rejections (e.g., `request()` throwing `StateError`).
- **Reference**: `tests/integration/client/error-hook.test.ts`.

## Client Type Inference Tests {#client-type-inference}

- Typed adapters (`@ws-kit/client/zod`, `@ws-kit/client/valibot`) must surface fully inferred handler/request types, including meta/correlation fields.
- Schemas without payload must produce compile-time errors when accessing `ctx.payload`; overloads enforce supplying payloads only when schemas require them.
- Extended meta requirements/optionals are enforced by the type system.
- The generic `@ws-kit/client` export intentionally returns `unknown` message payloads, forcing consumers to narrow manually.
- **Reference**: `packages/client/src/types.test.ts`, ADR-002.

## Key Constraints

> See docs/specs/rules.md for complete rules. Critical for testing:

1. **Type-level tests** — Use `expectTypeOf` for compile-time validation (positive & negative cases)
2. **Payload conditional typing** — Test that `ctx.payload` is type error when schema omits it (see ADR-001)
3. **Client type inference** — Test typed clients provide full inference; generic client uses `unknown` (see ADR-002 and #client-type-inference)
4. **Discriminated unions** — Verify factory pattern enables union support (see docs/specs/schema.md#Discriminated-Unions)
5. **Strict schema enforcement** — Test rejection of unknown keys and unexpected `payload` (see docs/specs/schema.md#Strict-Schemas)
6. **Normalization** — Test reserved key stripping before validation (see normalization test above)
7. **Client onUnhandled ordering** — Test schema handlers execute BEFORE `onUnhandled()` hook (see docs/specs/client.md#message-processing-order and docs/specs/rules.md#inbound-message-routing)
8. **Client multi-handler** — Test registration order, stable iteration, error isolation (see docs/specs/client.md#Multiple-Handlers)
9. **Extended meta support** — Test required/optional meta fields, timestamp preservation, reserved key stripping (see extended meta tests above)
