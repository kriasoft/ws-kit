# Testing Requirements

**Status**: ✅ Implemented (type-level tests with expectTypeOf)

See @constraints.md for testing patterns.

## Type-Level Testing

Use `expectTypeOf` from `expect-type` for compile-time validation:

```typescript
import { expectTypeOf } from "expect-type";

// Test conditional payload typing
const WithPayload = messageSchema("WITH", { id: z.number() });
const WithoutPayload = messageSchema("WITHOUT");

router.onMessage(WithPayload, (ctx) => {
  expectTypeOf(ctx.payload).toEqualTypeOf<{ id: number }>();
  expectTypeOf(ctx.payload.id).toBeNumber();
});

router.onMessage(WithoutPayload, (ctx) => {
  // @ts-expect-error - payload should not exist
  ctx.payload;
});
```

## Handler Context Inference

```typescript
// Test inline handler type inference
router.onMessage(TestMessage, (ctx) => {
  expectTypeOf(ctx.type).toEqualTypeOf<"TEST">();

  // Server-provided timestamp is always present (server clock)
  expectTypeOf(ctx.receivedAt).toBeNumber();

  // Client's timestamp in meta is optional (client's clock, untrusted)
  expectTypeOf(ctx.meta.timestamp).toEqualTypeOf<number | undefined>();

  // Connection identity is always present in ws.data
  expectTypeOf(ctx.ws.data).toHaveProperty("clientId");
  expectTypeOf(ctx.ws.data.clientId).toBeString();

  expectTypeOf(ctx.send).toBeFunction();
});
```

## Discriminated Union Testing

```typescript
const PingMsg = messageSchema("PING");
const PongMsg = messageSchema("PONG", { reply: z.string() });

// Test discriminated union creation
const MessageUnion = z.discriminatedUnion("type", [PingMsg, PongMsg]);
expectTypeOf(MessageUnion.parse({ type: "PING", meta: {} })).toMatchTypeOf<{
  type: "PING";
  meta: MessageMetadata;
}>();
```

## Cross-Package Type Compatibility

```typescript
// Test factory pattern preserves types across package boundaries
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);
const TestSchema = messageSchema("TEST", { value: z.number() });

// Should work in discriminated unions
const union = z.discriminatedUnion("type", [TestSchema]);
expectTypeOf(union).toMatchTypeOf<z.ZodDiscriminatedUnion<"type", any>>();
```

## Runtime Testing

```typescript
test("message validation", () => {
  const TestMsg = messageSchema("TEST", { id: z.number() });

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
  const TestMsg = messageSchema("TEST", { id: z.number() });

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

// See @validation.md#Strict-Mode-Enforcement for strict validation requirements
test("strict schema rejects unknown keys", () => {
  const TestMsg = messageSchema("TEST", { id: z.number() });

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

// See @validation.md#Strict-Mode-Enforcement for validation behavior table
test("strict schema rejects unexpected payload", () => {
  const NoPayloadMsg = messageSchema("NO_PAYLOAD");
  const WithPayloadMsg = messageSchema("WITH_PAYLOAD", { id: z.number() });

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
  const TestMsg = messageSchema("TEST", { id: z.number() });
  const before = Date.now();

  router.onMessage(TestMsg, (ctx) => {
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

test("publish() never injects clientId", () => {
  const ChatMsg = messageSchema("CHAT", { text: z.string() });

  // Without origin
  const msg1 = publish(ws, "room", ChatMsg, { text: "hi" });
  expect(msg1.meta).not.toHaveProperty("clientId");
  expect(msg1.meta).toHaveProperty("timestamp");

  // With origin
  const msg2 = publish(
    ws,
    "room",
    ChatMsg,
    { text: "hi" },
    { origin: "userId" },
  );
  expect(msg2.meta).toHaveProperty("senderId", ws.data.userId);
  expect(msg2.meta).not.toHaveProperty("clientId");
});

test("origin option injects from ws.data", () => {
  const ws = { data: { userId: "alice" } };
  const msg = publish(
    ws,
    "room",
    ChatMsg,
    { text: "hi" },
    { origin: "userId" },
  );
  expect(msg.meta.senderId).toBe("alice");
});

test("origin with missing field does not inject", () => {
  // #origin-with-missing-field
  const ws = { data: {} };
  const msg = publish(
    ws,
    "room",
    ChatMsg,
    { text: "hi" },
    { origin: "missing" },
  );
  expect(msg.meta).not.toHaveProperty("senderId"); // No-op when ws.data.missing undefined
});

// Client Multi-Handler Tests {#client-multiple-handlers}

test("client: multiple handlers run in order", async () => {
  const order: number[] = [];

  client.on(TestMsg, () => order.push(1));
  client.on(TestMsg, () => order.push(2));

  simulateReceive(client, { type: "TEST", meta: {}, payload: {} });

  expect(order).toEqual([1, 2]);
});

test("client: unsubscribe removes only target handler", async () => {
  const calls: number[] = [];

  client.on(TestMsg, () => calls.push(1));
  const unsub2 = client.on(TestMsg, () => calls.push(2));
  client.on(TestMsg, () => calls.push(3));

  unsub2();
  simulateReceive(client, { type: "TEST", meta: {}, payload: {} });

  expect(calls).toEqual([1, 3]); // Handler 2 removed
});

test("client: handler error does not stop remaining handlers", async () => {
  const calls: number[] = [];

  client.on(TestMsg, () => {
    throw new Error("boom");
  });
  client.on(TestMsg, () => calls.push(2));

  simulateReceive(client, { type: "TEST", meta: {}, payload: {} });

  expect(calls).toEqual([2]); // Handler 2 runs despite handler 1 error
});

test("schema creation rejects reserved meta keys", () => {
  expect(() => {
    messageSchema(
      "TEST",
      { id: z.number() },
      {
        clientId: z.string(), // ❌ Reserved key
      },
    );
  }).toThrow("Reserved meta keys not allowed in schema: clientId");

  expect(() => {
    messageSchema(
      "TEST",
      { id: z.number() },
      {
        receivedAt: z.number(), // ❌ Reserved key
      },
    );
  }).toThrow("Reserved meta keys not allowed in schema: receivedAt");

  // Multiple reserved keys
  expect(() => {
    messageSchema(
      "TEST",
      { id: z.number() },
      {
        clientId: z.string(),
        receivedAt: z.number(),
        userId: z.string(), // Valid, but mixed with reserved
      },
    );
  }).toThrow(/clientId.*receivedAt/);
});

test("request() timeout starts after flush, not enqueue", async () => {
  const client = createClient({
    url: "ws://test",
    wsFactory: (url) => createFakeWS(url),
    reconnect: { enabled: false },
  });

  // Don't open yet - message will be queued
  const startTime = Date.now();

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 1000,
  });

  // Wait 500ms while queued
  await sleep(500);

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

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 60000,
    signal: controller.signal,
  });

  const correlationId = extractCorrelationId(reqPromise); // Test helper

  // Abort request
  controller.abort();
  await expect(reqPromise).rejects.toThrow(StateError);

  // Server sends late reply (should be ignored - pending map cleaned)
  simulateReceive(client, {
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "late reply" },
  });

  // No errors thrown; late reply dropped silently
});

test("request() rejects on wrong-type reply with matching correlationId", async () => {
  const client = createClient({ url: "ws://test" });
  const Hello = messageSchema("HELLO", { name: z.string() });
  const HelloOk = messageSchema("HELLO_OK", { text: z.string() });
  const Goodbye = messageSchema("GOODBYE", { message: z.string() });

  await client.connect();

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
  });

  // Server sends wrong type but correct correlationId
  const correlationId = extractCorrelationId(reqPromise); // Test helper
  simulateReceive(client, {
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
  const Hello = messageSchema("HELLO", { name: z.string() });
  const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

  await client.connect();

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
  });

  // Server sends correct type but invalid payload
  const correlationId = extractCorrelationId(reqPromise); // Test helper
  simulateReceive(client, {
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
  const Hello = messageSchema("HELLO", { name: z.string() });
  const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

  await client.connect();

  const reqPromise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
  });

  const correlationId = extractCorrelationId(reqPromise);

  // First reply - settles the promise
  simulateReceive(client, {
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "first" },
  });

  const reply = await reqPromise;
  expect(reply.payload.text).toBe("first");

  // Second reply with same correlationId - dropped silently (no error)
  simulateReceive(client, {
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "second" }, // Ignored
  });

  // Third reply - also dropped silently
  simulateReceive(client, {
    type: "HELLO_OK",
    meta: { correlationId },
    payload: { text: "third" }, // Ignored
  });

  // No errors thrown; duplicates ignored after first settles
});

test("send() returns true when sent immediately", async () => {
  const client = createClient({ url: "ws://test" });
  await client.connect(); // CONNECTED state

  const sent = client.send(ChatMsg, { text: "hello" });

  expect(sent).toBe(true);
});

test("send() returns true when queued", () => {
  const client = createClient({
    url: "ws://test",
    queue: "drop-newest",
  });
  // Not connected yet - will queue

  const sent = client.send(ChatMsg, { text: "hello" });

  expect(sent).toBe(true); // Queued successfully
});

test("send() returns false with queue: off", () => {
  const client = createClient({
    url: "ws://test",
    queue: "off",
  });
  // Not connected - will discard

  const sent = client.send(ChatMsg, { text: "hello" });

  expect(sent).toBe(false); // Discarded, not queued
});

test("send() returns false on queue overflow with drop-newest", async () => {
  const client = createClient({
    url: "ws://test",
    queue: "drop-newest",
    queueSize: 2,
  });
  // Not open - messages will queue

  // Fill queue
  expect(client.send(ChatMsg, { text: "msg1" })).toBe(true);
  expect(client.send(ChatMsg, { text: "msg2" })).toBe(true);

  // Overflow - should drop new message
  expect(client.send(ChatMsg, { text: "msg3" })).toBe(false);
});

test("send() evicts oldest on queue overflow with drop-oldest", async () => {
  const client = createClient({
    url: "ws://test",
    queue: "drop-oldest",
    queueSize: 2,
  });
  // Not connected - messages will queue

  // Fill queue
  expect(client.send(ChatMsg, { text: "msg1" })).toBe(true); // Queue: [msg1]
  expect(client.send(ChatMsg, { text: "msg2" })).toBe(true); // Queue: [msg1, msg2]

  // Overflow - should evict oldest (msg1), accept new (msg3)
  expect(client.send(ChatMsg, { text: "msg3" })).toBe(true); // Queue: [msg2, msg3]

  // When connection opens, only msg2 and msg3 are sent
  await client.connect();
  // Verify msg1 was dropped (test implementation-specific assertion)
});

test("send() returns false on invalid payload", () => {
  const client = createClient({ url: "ws://test" });

  // @ts-expect-error - testing runtime validation
  const sent = client.send(ChatMsg, { text: 123 }); // Invalid type

  expect(sent).toBe(false); // Validation failure returns false
});

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

test("onUnhandled() receives valid messages with no schema handler", async () => {
  const client = createClient({ url: "ws://test" });
  const TestMsg = messageSchema("TEST", { id: z.number() });
  const UnknownMsg = messageSchema("UNKNOWN", { value: z.string() });

  const handledMessages: any[] = [];
  const unhandledMessages: any[] = [];

  // Register handler for TEST only
  client.on(TestMsg, (msg) => {
    handledMessages.push(msg);
  });

  // Hook for unhandled messages (receives AnyInboundMessage)
  client.onUnhandled((msg) => {
    // Message is structurally valid but type not registered
    // Treat as readonly (do not mutate)
    unhandledMessages.push(msg);
  });

  await client.connect();

  // Simulate receiving messages
  simulateReceive(client, { type: "TEST", meta: {}, payload: { id: 123 } });
  simulateReceive(client, {
    type: "UNKNOWN",
    meta: {},
    payload: { value: "hi" },
  });

  // TEST goes to schema handler
  expect(handledMessages).toHaveLength(1);
  expect(handledMessages[0].type).toBe("TEST");

  // UNKNOWN goes to onUnhandled (no schema registered)
  expect(unhandledMessages).toHaveLength(1);
  expect(unhandledMessages[0].type).toBe("UNKNOWN");
});

test("onUnhandled() never receives invalid messages", async () => {
  const client = createClient({ url: "ws://test" });
  const unhandledMessages: any[] = [];

  client.onUnhandled((msg) => {
    unhandledMessages.push(msg);
  });

  await client.connect();

  // Invalid JSON
  simulateReceive(client, "not json");

  // Missing type
  simulateReceive(client, { meta: {}, payload: {} });

  // Invalid structure
  simulateReceive(client, { type: "TEST", payload: "not an object" });

  // onUnhandled should NOT be called for any invalid message
  expect(unhandledMessages).toHaveLength(0);
});

test("schema handlers execute before onUnhandled", async () => {
  const client = createClient({ url: "ws://test" });
  const TestMsg = messageSchema("TEST", { id: z.number() });

  const executionOrder: string[] = [];

  client.on(TestMsg, (msg) => {
    executionOrder.push("schema-handler");
  });

  client.onUnhandled((msg) => {
    executionOrder.push("onUnhandled");
  });

  await client.connect();

  // Send message with registered schema
  simulateReceive(client, { type: "TEST", meta: {}, payload: { id: 123 } });

  // Schema handler executes, onUnhandled does NOT
  expect(executionOrder).toEqual(["schema-handler"]);
});

// Auto-Connect Tests

test("autoConnect triggers connection on first send", async () => {
  const client = createClient({
    url: "ws://test",
    autoConnect: true,
    wsFactory: (url) => createFakeWS(url),
  });

  expect(client.state).toBe("closed");

  // First send triggers connection
  client.send(Hello, { name: "test" });

  expect(client.state).toBe("connecting"); // Observable state change
});

test("autoConnect triggers connection on first request", async () => {
  const client = createClient({
    url: "ws://test",
    autoConnect: true,
    wsFactory: (url) => createFakeWS(url),
  });

  expect(client.state).toBe("closed");

  // First request triggers connection
  const promise = client.request(Hello, { name: "test" }, HelloOk, {
    timeoutMs: 5000,
  });

  expect(client.state).toBe("connecting");
});

test("autoConnect does NOT trigger connection on on()", async () => {
  const client = createClient({
    url: "ws://test",
    autoConnect: true,
    wsFactory: (url) => createFakeWS(url),
  });

  expect(client.state).toBe("closed");

  // Registering handler does NOT trigger connection
  client.on(Hello, (msg) => {});

  expect(client.state).toBe("closed"); // Still closed - connection not started

  // First send() triggers connection
  client.send(Hello, { name: "test" });
  expect(client.state).toBe("connecting");
});

test("autoConnect fails fast on connection error", async () => {
  const client = createClient({
    url: "ws://invalid",
    autoConnect: true,
    wsFactory: () => {
      throw new Error("Connection failed");
    },
  });

  // send() never throws - returns false on auto-connect failure
  const sent = client.send(Hello, { name: "test" });
  expect(sent).toBe(false);

  // request() rejects on auto-connect failure
  await expect(
    client.request(Hello, { name: "test" }, HelloOk, { timeoutMs: 1000 }),
  ).rejects.toThrow("Connection failed");
});

test("autoConnect does not trigger from closed state after manual close", async () => {
  const client = createClient({
    url: "ws://test",
    autoConnect: true,
    wsFactory: (url) => createFakeWS(url),
  });

  await client.connect();
  await client.close();

  expect(client.state).toBe("closed");

  // send() should not auto-reconnect after manual close
  const sent = client.send(Hello, { name: "test" });
  expect(sent).toBe(false); // Dropped (or queued per queue policy)
  expect(client.state).toBe("closed"); // Still closed
});

// Extended Meta Tests

test("send() with extended meta (required field)", async () => {
  const client = createClient({ url: "ws://test" });
  const RoomMsg = messageSchema(
    "CHAT",
    { text: z.string() },
    { roomId: z.string() }, // Required meta field
  );

  await client.connect();

  // ✅ Provide required meta
  const sent = client.send(
    RoomMsg,
    { text: "hello" },
    {
      meta: { roomId: "general" },
    },
  );

  expect(sent).toBe(true);
  // Verify message includes extended meta (test implementation-specific)
});

test("send() with extended meta type error on missing required field", () => {
  const RoomMsg = messageSchema(
    "CHAT",
    { text: z.string() },
    { roomId: z.string() }, // Required
  );

  // @ts-expect-error - missing required meta.roomId
  client.send(RoomMsg, { text: "hello" });
});

test("send() with optional extended meta", async () => {
  const OptionalMetaMsg = messageSchema(
    "NOTIFY",
    { text: z.string() },
    { priority: z.enum(["low", "high"]).optional() },
  );

  await client.connect();

  // ✅ Without optional meta
  expect(client.send(OptionalMetaMsg, { text: "hello" })).toBe(true);

  // ✅ With optional meta
  expect(
    client.send(
      OptionalMetaMsg,
      { text: "hello" },
      {
        meta: { priority: "high" },
      },
    ),
  ).toBe(true);
});

// Client Outbound Normalization Tests
// Note: Client does NOT strip inbound messages (server already normalized them)
// These tests verify client strips reserved/managed keys from OUTBOUND opts.meta

test("client normalization preserves user-provided timestamp", async () => {
  const TestMsg = messageSchema("TEST", { id: z.number() });
  const capturedMessages: any[] = [];

  // Mock send to capture message
  const mockSend = (msg: any) => capturedMessages.push(JSON.parse(msg));

  const client = createClient({
    url: "ws://test",
    wsFactory: () => ({ send: mockSend }) as any,
  });

  await client.connect();

  // User provides timestamp
  client.send(TestMsg, { id: 123 }, { meta: { timestamp: 999 } });

  expect(capturedMessages[0].meta.timestamp).toBe(999); // User value preserved
});

test("client normalization auto-injects timestamp if missing", async () => {
  const TestMsg = messageSchema("TEST", { id: z.number() });
  const capturedMessages: any[] = [];
  const beforeSend = Date.now();

  const mockSend = (msg: any) => capturedMessages.push(JSON.parse(msg));

  const client = createClient({
    url: "ws://test",
    wsFactory: () => ({ send: mockSend }) as any,
  });

  await client.connect();

  // User does not provide timestamp
  client.send(TestMsg, { id: 123 });

  const afterSend = Date.now();
  const sentTimestamp = capturedMessages[0].meta.timestamp;

  expect(sentTimestamp).toBeGreaterThanOrEqual(beforeSend);
  expect(sentTimestamp).toBeLessThanOrEqual(afterSend);
});

test("client normalization strips reserved keys from user meta", async () => {
  const TestMsg = messageSchema("TEST", { id: z.number() });
  const capturedMessages: any[] = [];

  const mockSend = (msg: any) => capturedMessages.push(JSON.parse(msg));

  const client = createClient({
    url: "ws://test",
    wsFactory: () => ({ send: mockSend }) as any,
  });

  await client.connect();

  // User tries to spoof reserved keys
  client.send(
    TestMsg,
    { id: 123 },
    {
      // @ts-expect-error - reserved keys not in type
      meta: { clientId: "fake", receivedAt: 999 },
    },
  );

  expect(capturedMessages[0].meta).not.toHaveProperty("clientId");
  expect(capturedMessages[0].meta).not.toHaveProperty("receivedAt");
  expect(capturedMessages[0].meta).toHaveProperty("timestamp"); // Auto-injected
});

test("client normalization strips correlationId from user meta", async () => {
  const TestMsg = messageSchema("TEST", { id: z.number() });
  const capturedMessages: any[] = [];

  const mockSend = (msg: any) => capturedMessages.push(JSON.parse(msg));

  const client = createClient({
    url: "ws://test",
    wsFactory: () => ({ send: mockSend }) as any,
  });

  await client.connect();

  // User tries to set correlationId via meta (ignored)
  client.send(
    TestMsg,
    { id: 123 },
    {
      // @ts-expect-error - correlationId not allowed in meta
      meta: { correlationId: "sneaky" },
      correlationId: "correct", // Only this is used
    },
  );

  // Only opts.correlationId is used, meta.correlationId stripped
  expect(capturedMessages[0].meta.correlationId).toBe("correct");
});

test("request() with extended meta", async () => {
  const RoomMsg = messageSchema(
    "CHAT",
    { text: z.string() },
    { roomId: z.string() },
  );
  const RoomMsgOk = messageSchema("CHAT_OK", { success: z.boolean() });

  const client = createClient({ url: "ws://test" });
  await client.connect();

  const promise = client.request(RoomMsg, { text: "hello" }, RoomMsgOk, {
    meta: { roomId: "general" },
    correlationId: "req-123",
  });

  // Simulate reply
  simulateReceive(client, {
    type: "CHAT_OK",
    meta: { correlationId: "req-123" },
    payload: { success: true },
  });

  const reply = await promise;
  expect(reply.payload.success).toBe(true);
});

test("isConnected getter reflects state === open", async () => {
  const client = createClient({ url: "ws://test" });

  // Initial state
  expect(client.state).toBe("closed");
  expect(client.isConnected).toBe(false);

  // After connect
  await client.connect();
  expect(client.state).toBe("open");
  expect(client.isConnected).toBe(true);

  // After close
  await client.close();
  expect(client.state).toBe("closed");
  expect(client.isConnected).toBe(false);
});

test("onError fires for parse failures", async () => {
  const client = createClient({ url: "ws://test" });
  const errors: Array<{ error: Error; context: any }> = [];

  client.onError((error, context) => {
    errors.push({ error, context });
  });

  await client.connect();

  // Simulate invalid JSON from server
  simulateReceive(client, "not valid json");

  expect(errors).toHaveLength(1);
  expect(errors[0].context.type).toBe("parse");
  expect(errors[0].error.message).toContain("JSON");
});

test("onError fires for validation failures", async () => {
  const client = createClient({ url: "ws://test" });
  const TestMsg = messageSchema("TEST", { id: z.number() });
  const errors: Array<{ error: Error; context: any }> = [];

  client.on(TestMsg, (msg) => {});

  client.onError((error, context) => {
    errors.push({ error, context });
  });

  await client.connect();

  // Simulate invalid message (wrong payload type)
  simulateReceive(client, {
    type: "TEST",
    meta: {},
    payload: { id: "string" }, // Should be number
  });

  expect(errors).toHaveLength(1);
  expect(errors[0].context.type).toBe("validation");
  expect(errors[0].context.details).toBeDefined();
});

test("onError fires for queue overflow", async () => {
  const client = createClient({
    url: "ws://test",
    queue: "drop-newest",
    queueSize: 2,
  });
  const errors: Array<{ error: Error; context: any }> = [];

  client.onError((error, context) => {
    errors.push({ error, context });
  });

  // Fill queue (not connected)
  client.send(TestMsg, { id: 1 });
  client.send(TestMsg, { id: 2 });

  // Overflow
  client.send(TestMsg, { id: 3 });

  expect(errors).toHaveLength(1);
  expect(errors[0].context.type).toBe("overflow");
});

test("onError does NOT fire for request() rejections", async () => {
  const client = createClient({
    url: "ws://test",
    queue: "off",
  });
  const errors: Array<{ error: Error; context: any }> = [];

  client.onError((error, context) => {
    errors.push({ error, context });
  });

  // request() rejects with StateError (queue off + disconnected)
  await expect(
    client.request(Hello, { name: "test" }, HelloOk),
  ).rejects.toThrow(StateError);

  // onError should NOT fire (caller handles rejection)
  expect(errors).toHaveLength(0);
});
```

## Key Constraints

> See @constraints.md for complete rules. Critical for testing:

1. **Type-level tests** — Use `expectTypeOf` for compile-time validation (positive & negative cases)
2. **Payload conditional typing** — Test that `ctx.payload` is type error when schema omits it (see @adrs.md#ADR-001)
3. **Discriminated unions** — Verify factory pattern enables union support (see @schema.md#Discriminated-Unions)
4. **Strict schema enforcement** — Test rejection of unknown keys and unexpected `payload` (see @schema.md#Strict-Schemas)
5. **Normalization** — Test reserved key stripping before validation (see normalization test above; implementation tracked in @implementation-status.md#GAP-001)
6. **Client onUnhandled ordering** — Test schema handlers execute BEFORE `onUnhandled()` hook (see @client.md#message-processing-order and @constraints.md#inbound-message-routing)
7. **Client multi-handler** — Test registration order, stable iteration, error isolation (see @client.md#Multiple-Handlers and @implementation-status.md#GAP-005)
8. **Extended meta support** — Test required/optional meta fields, timestamp preservation, reserved key stripping (see extended meta tests above; implementation tracked in @implementation-status.md#GAP-015)
