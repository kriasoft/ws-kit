// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client Multi-Handler and onUnhandled Tests
 *
 * Critical ordering guarantees:
 * 1. Multi-handler: registration order, stable iteration, error isolation
 * 2. onUnhandled: fires ONLY for structurally valid messages with no schema
 * 3. Dispatch order: schema handlers → onUnhandled (invalid never reaches onUnhandled)
 *
 * See @docs/specs/client.md#Multiple-Handlers
 * See @docs/specs/client.md#message-processing-order
 * See @docs/specs/rules.md#inbound-message-routing
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { createClient } from "../../src/index";
import type { WebSocketClient } from "../../src/types";
import { createMessageSchema } from "@ws-kit/zod";
import { createMockWebSocket } from "./helpers";

const { messageSchema } = createMessageSchema(z);

// Test schemas
const TestMsg = messageSchema("TEST", { id: z.number() });
const OtherMsg = messageSchema("OTHER", { value: z.string() });

describe("Client: Multi-Handler Support", () => {
  let client: WebSocketClient;
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

  // Helper to simulate receiving a message
  function simulateReceive(msg: any) {
    mockWs._trigger.message(msg);
  }

  it("executes multiple handlers in registration order", async () => {
    const executionOrder: number[] = [];

    await client.connect();

    client.on(TestMsg, () => executionOrder.push(1));
    client.on(TestMsg, () => executionOrder.push(2));
    client.on(TestMsg, () => executionOrder.push(3));

    simulateReceive({ type: "TEST", meta: {}, payload: { id: 123 } });

    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it("unsubscribe removes only target handler", async () => {
    const calls: number[] = [];

    await client.connect();

    client.on(TestMsg, () => calls.push(1));
    const unsub2 = client.on(TestMsg, () => calls.push(2));
    client.on(TestMsg, () => calls.push(3));

    // Remove handler 2
    unsub2();

    simulateReceive({ type: "TEST", meta: {}, payload: { id: 123 } });

    // Only handlers 1 and 3 should run
    expect(calls).toEqual([1, 3]);
  });

  it("handler error does not stop remaining handlers (error isolation)", async () => {
    const calls: number[] = [];

    await client.connect();

    // Mock console.error to suppress error output during test
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      client.on(TestMsg, () => {
        calls.push(1);
        throw new Error("boom");
      });
      client.on(TestMsg, () => calls.push(2));
      client.on(TestMsg, () => calls.push(3));

      simulateReceive({ type: "TEST", meta: {}, payload: { id: 123 } });

      // All handlers should run despite error in handler 1
      expect(calls).toEqual([1, 2, 3]);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("unsubscribing during dispatch uses stable iteration", async () => {
    const calls: number[] = [];
    let unsub2: (() => void) | null = null;

    await client.connect();

    client.on(TestMsg, () => {
      calls.push(1);
      // Unsubscribe handler 2 during dispatch
      if (unsub2) unsub2();
    });
    unsub2 = client.on(TestMsg, () => calls.push(2));
    client.on(TestMsg, () => calls.push(3));

    simulateReceive({ type: "TEST", meta: {}, payload: { id: 123 } });

    // Handler 2 should still run (stable iteration - snapshot taken before dispatch)
    expect(calls).toEqual([1, 2, 3]);

    // But handler 2 should NOT run on next message
    calls.length = 0;
    simulateReceive({ type: "TEST", meta: {}, payload: { id: 456 } });
    expect(calls).toEqual([1, 3]);
  });

  it("different schemas have independent handler lists", async () => {
    const testCalls: number[] = [];
    const otherCalls: number[] = [];

    await client.connect();

    client.on(TestMsg, () => testCalls.push(1));
    client.on(TestMsg, () => testCalls.push(2));
    client.on(OtherMsg, () => otherCalls.push(1));

    simulateReceive({ type: "TEST", meta: {}, payload: { id: 123 } });
    simulateReceive({ type: "OTHER", meta: {}, payload: { value: "hello" } });

    expect(testCalls).toEqual([1, 2]);
    expect(otherCalls).toEqual([1]);
  });
});

describe("Client: onUnhandled Hook", () => {
  let client: WebSocketClient;
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

  function simulateReceive(msg: any) {
    if (typeof msg === "string") {
      // Directly trigger message handler with raw string (invalid JSON)
      const messageHandlers = (mockWs as any).onmessage;
      if (messageHandlers) {
        messageHandlers({ data: msg });
      }
    } else {
      mockWs._trigger.message(msg);
    }
  }

  it("receives valid messages with no registered schema", async () => {
    const handledMessages: any[] = [];
    const unhandledMessages: any[] = [];

    await client.connect();

    // Register handler for TEST only
    client.on(TestMsg, (msg) => {
      handledMessages.push(msg);
    });

    // Hook for unhandled messages
    client.onUnhandled((msg) => {
      unhandledMessages.push(msg);
    });

    // Send message with registered schema
    simulateReceive({ type: "TEST", meta: {}, payload: { id: 123 } });

    // Send message with NO registered schema
    simulateReceive({
      type: "UNKNOWN",
      meta: {},
      payload: { value: "hi" },
    });

    // TEST goes to schema handler
    expect(handledMessages).toHaveLength(1);
    expect(handledMessages[0].type).toBe("TEST");

    // UNKNOWN goes to onUnhandled
    expect(unhandledMessages).toHaveLength(1);
    expect(unhandledMessages[0].type).toBe("UNKNOWN");
  });

  it("never receives invalid messages", async () => {
    const unhandledMessages: any[] = [];

    await client.connect();

    // Mock console.warn to suppress warnings during test
    const originalConsoleWarn = console.warn;
    console.warn = () => {};

    try {
      client.onUnhandled((msg) => {
        unhandledMessages.push(msg);
      });

      // Invalid JSON
      simulateReceive("not json at all");

      // Missing type field
      simulateReceive({ meta: {}, payload: {} });

      // Invalid structure (type not a string)
      simulateReceive({ type: 123, payload: {} });

      // onUnhandled should NOT be called for any invalid message
      expect(unhandledMessages).toHaveLength(0);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it("schema handlers execute BEFORE onUnhandled", async () => {
    const executionOrder: string[] = [];

    await client.connect();

    client.on(TestMsg, () => {
      executionOrder.push("schema-handler");
    });

    client.onUnhandled(() => {
      executionOrder.push("onUnhandled");
    });

    // Send message with registered schema
    simulateReceive({ type: "TEST", meta: {}, payload: { id: 123 } });

    // Schema handler should execute, onUnhandled should NOT
    expect(executionOrder).toEqual(["schema-handler"]);
  });

  it("validation failures are dropped (never reach onUnhandled)", async () => {
    const handledMessages: any[] = [];
    const unhandledMessages: any[] = [];

    await client.connect();

    // Mock console.error to suppress validation errors
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      // Register handler for TEST (expects payload.id: number)
      client.on(TestMsg, (msg) => {
        handledMessages.push(msg);
      });

      client.onUnhandled((msg) => {
        unhandledMessages.push(msg);
      });

      // Send message with WRONG payload structure (id should be number)
      simulateReceive({ type: "TEST", meta: {}, payload: { id: "string" } });

      // Per @docs/specs/client.md#message-processing-order:
      // "Invalid messages (parse/validation failures) never reach onUnhandled()"
      //
      // Expected behavior: validation failures should be dropped (neither handler called)
      expect(handledMessages).toHaveLength(0); // Schema handler not called
      expect(unhandledMessages).toHaveLength(0); // Not passed to onUnhandled (dropped)
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("unsubscribe removes onUnhandled callback", async () => {
    const unhandledMessages: any[] = [];

    await client.connect();

    const unsub = client.onUnhandled((msg) => {
      unhandledMessages.push(msg);
    });

    // First message - callback active
    simulateReceive({ type: "UNKNOWN", meta: {}, payload: {} });
    expect(unhandledMessages).toHaveLength(1);

    // Unsubscribe
    unsub();

    // Second message - callback removed
    simulateReceive({ type: "UNKNOWN2", meta: {}, payload: {} });
    expect(unhandledMessages).toHaveLength(1); // Still 1 (not called again)
  });

  it("handles structurally valid messages with missing payload", async () => {
    const unhandledMessages: any[] = [];

    await client.connect();

    client.onUnhandled((msg) => {
      unhandledMessages.push(msg);
    });

    // Message with no payload (valid structure)
    simulateReceive({ type: "NO_PAYLOAD", meta: {} });

    expect(unhandledMessages).toHaveLength(1);
    expect(unhandledMessages[0].type).toBe("NO_PAYLOAD");
    expect(unhandledMessages[0]).not.toHaveProperty("payload");
  });

  it("preserves message structure for onUnhandled (readonly contract)", async () => {
    let receivedMessage: any = null;

    await client.connect();

    client.onUnhandled((msg) => {
      receivedMessage = msg;
    });

    const originalMessage = {
      type: "UNKNOWN",
      meta: { correlationId: "abc" },
      payload: { data: "test" },
    };

    simulateReceive(originalMessage);

    expect(receivedMessage).toMatchObject(originalMessage);
    // Verify structure is preserved (treat as readonly - don't test mutation)
    expect(receivedMessage.type).toBe("UNKNOWN");
    expect(receivedMessage.meta.correlationId).toBe("abc");
    expect(receivedMessage.payload.data).toBe("test");
  });
});
