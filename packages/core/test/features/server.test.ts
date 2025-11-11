// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { createRouter, message, z } from "@ws-kit/zod";
import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
import { MemoryPubSub } from "@ws-kit/pubsub/internal";

// Mock console methods to prevent noise during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = mock(() => {
    /* Mock implementation */
  });
  console.warn = mock(() => {
    /* Mock implementation */
  });
  console.error = mock(() => {
    /* Mock implementation */
  });
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;

  // Verify console methods are ACTUALLY restored after each test
  // Ensures no test crash leaves console mocked, preventing isolation issues
  if (console.log !== originalConsoleLog) {
    throw new Error(
      "console.log was not properly restored - mock leak detected",
    );
  }
  if (console.warn !== originalConsoleWarn) {
    throw new Error(
      "console.warn was not properly restored - mock leak detected",
    );
  }
  if (console.error !== originalConsoleError) {
    throw new Error(
      "console.error was not properly restored - mock leak detected",
    );
  }
});

// ———————————————————————————————————————————————————————————————————————————
// Test Helpers
// ———————————————————————————————————————————————————————————————————————————

/**
 * Robustly connect to WebSocket server with automatic retries.
 * Eliminates arbitrary timeouts; uses native WebSocket events.
 */
async function connectToServer(
  port: number,
  options: { maxAttempts?: number } = {},
): Promise<WebSocket> {
  const { maxAttempts = 10 } = options;
  let attempts = 0;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      attempts++;
      const socket = new WebSocket(`ws://localhost:${port}/ws`);

      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onError);
      };

      const onOpen = () => {
        cleanup();
        resolve(socket);
      };

      const onClose = () => {
        cleanup();
        if (attempts < maxAttempts) {
          setTimeout(tryConnect, 50);
        } else {
          reject(new Error(`Failed to connect after ${maxAttempts} attempts`));
        }
      };

      const onError = (error: Event) => {
        cleanup();
        if (attempts < maxAttempts) {
          setTimeout(tryConnect, 50);
        } else {
          reject(
            new Error(`Connection failed: ${(error as ErrorEvent).message}`),
          );
        }
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onError);
    };

    tryConnect();
  });
}

/**
 * Create a message listener for capturing server responses.
 */
function createMessageListener(): {
  messages: unknown[];
  attach: (socket: WebSocket) => void;
} {
  const messages: unknown[] = [];

  return {
    messages,
    attach(socket: WebSocket) {
      socket.addEventListener("message", (event) => {
        messages.push(JSON.parse(event.data as string));
      });
    },
  };
}

// Test message schemas
const Ping = message("PING", {
  message: z.string(),
});

const Pong = message("PONG", {
  message: z.string(),
  timestamp: z.number(),
});

const Error = message("ERROR", {
  code: z.number(),
  message: z.string(),
});

describe("WebSocketServer E2E", () => {
  let server: ReturnType<typeof Bun.serve>;
  let router: ReturnType<typeof createRouter>;
  let port: number;

  // Handler call tracking (replaces mocks with simpler counters)
  let openHandlerCalls: number;
  let closeHandlerCalls: number;

  beforeEach(() => {
    // Use a random port for each test to avoid conflicts
    port = 50000 + Math.floor(Math.random() * 10000);

    // Reset handler tracking
    openHandlerCalls = 0;
    closeHandlerCalls = 0;

    // Create a new router with platform adapter, validator, and pubsub
    router = createRouter({
      platform: createBunAdapter(),
      pubsub: new MemoryPubSub(),
    });

    // Set up message handlers
    router.on(Ping, (ctx) => {
      // Echo back a PONG with the same message and add a timestamp
      ctx.send(Pong, {
        message: ctx.payload.message,
        timestamp: Date.now(),
      });
    });

    // Add an error message handler
    router.on(Error, () => {
      // Just for handling error messages in tests
    });

    // Set up open handler with call tracking
    router.onOpen(() => {
      openHandlerCalls++;
    });

    // Set up close handler with call tracking
    router.onClose(() => {
      closeHandlerCalls++;
    });

    // Create Bun handler from router
    const { fetch, websocket } = createBunHandler(
      (router as any)[Symbol.for("ws-kit.core")],
    );

    // Start the server
    server = Bun.serve({
      port,
      fetch,
      websocket,
    });
  });

  afterEach(() => {
    // Shutdown the server after each test
    try {
      server.stop();
    } catch {
      // Server might already be stopped
    }
  });

  it("should call onOpen handler when client connects", async () => {
    const socket = await connectToServer(port);
    expect(openHandlerCalls).toBe(1);
    socket.close();
  });

  it("should establish a WebSocket connection and exchange messages", async () => {
    const socket = await connectToServer(port);
    const listener = createMessageListener();
    listener.attach(socket);

    // Send a PING message
    const pingMessage = {
      type: "PING",
      meta: { timestamp: Date.now() },
      payload: { message: "Hello Server!" },
    };

    socket.send(JSON.stringify(pingMessage));

    // Wait for response
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (listener.messages.length > 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });

    // Check that we received the expected PONG message
    expect(listener.messages.length).toBe(1);
    expect(listener.messages[0]).toMatchObject({
      type: "PONG",
      payload: { message: "Hello Server!" },
    });
    expect((listener.messages[0] as any).payload.timestamp).toBeGreaterThan(0);

    socket.close();
  });

  it("should handle multiple clients simultaneously", async () => {
    // Connect multiple clients
    const clients = await Promise.all(
      Array.from({ length: 3 }, async (_, i) => {
        const socket = await connectToServer(port);
        const listener = createMessageListener();
        listener.attach(socket);

        return { socket, listener, id: `client-${i}` };
      }),
    );

    // Verify onOpen was called for each client
    expect(openHandlerCalls).toBe(3);

    // Each client sends a message
    clients.forEach((client) => {
      const pingMessage = {
        type: "PING",
        meta: { timestamp: Date.now() },
        payload: { message: `Hello from ${client.id}` },
      };
      client.socket.send(JSON.stringify(pingMessage));
    });

    // Wait for all clients to receive responses
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (clients.every((client) => client.listener.messages.length > 0)) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });

    // Verify each client received the correct response
    clients.forEach((client) => {
      expect(client.listener.messages.length).toBe(1);
      expect((client.listener.messages[0] as any).type).toBe("PONG");
      expect((client.listener.messages[0] as any).payload.message).toBe(
        `Hello from ${client.id}`,
      );
    });

    // Clean up
    clients.forEach((client) => client.socket.close());
  });

  it("should handle invalid message format gracefully", async () => {
    const socket = await connectToServer(port);

    // Monitor console.error calls
    const errorSpy = spyOn(console, "error");

    // Send an invalid message (not JSON)
    socket.send("This is not JSON");

    // Send an invalid message (JSON but wrong format)
    socket.send(JSON.stringify({ notAValidMessage: true }));

    // Wait a bit to ensure messages are processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify error handling
    expect(errorSpy).toHaveBeenCalled();

    // Clean up
    socket.close();
  });

  it("should call onClose handler when client disconnects", async () => {
    const socket = await connectToServer(port);
    expect(openHandlerCalls).toBe(1);

    // Close the connection from the client side
    socket.close(1000, "Normal closure");

    // Wait for the socket's close event to actually fire
    await new Promise<void>((resolve) => {
      const onClose = () => {
        socket.removeEventListener("close", onClose);
        resolve();
      };
      socket.addEventListener("close", onClose);
    });

    // Verify close handler was called exactly once
    expect(closeHandlerCalls).toBe(1);
  });

  describe("Message Schema & Normalization", () => {
    it("should reject messages with unknown keys at root level", async () => {
      const socket = await connectToServer(port);
      const listener = createMessageListener();
      listener.attach(socket);

      // Send message with unknown field
      socket.send(
        JSON.stringify({
          type: "PING",
          meta: { timestamp: Date.now() },
          payload: { message: "test" },
          unknownField: "bad", // ❌ Unknown key
        }),
      );

      // Handler should not receive malformed message
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(listener.messages.length).toBe(0);

      socket.close();
    });

    it("should reject messages with unknown keys in meta", async () => {
      const socket = await connectToServer(port);
      const listener = createMessageListener();
      listener.attach(socket);

      socket.send(
        JSON.stringify({
          type: "PING",
          meta: {
            timestamp: Date.now(),
            junk: "xyz", // ❌ Unknown meta key
          },
          payload: { message: "test" },
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(listener.messages.length).toBe(0);

      socket.close();
    });

    it("should reject messages with unknown keys in payload", async () => {
      const socket = await connectToServer(port);
      const listener = createMessageListener();
      listener.attach(socket);

      socket.send(
        JSON.stringify({
          type: "PING",
          meta: { timestamp: Date.now() },
          payload: { message: "test", extra: "field" }, // ❌ Extra field
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(listener.messages.length).toBe(0);

      socket.close();
    });

    it("should provide valid metadata to handlers", async () => {
      let receivedMeta: unknown;

      router.on(Ping, (ctx) => {
        receivedMeta = ctx.meta;
      });

      const socket = await connectToServer(port);

      // Send a valid message with clean meta
      socket.send(
        JSON.stringify({
          type: "PING",
          meta: {
            timestamp: Date.now(),
          },
          payload: { message: "test" },
        }),
      );

      // Wait for handler to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Handler should receive valid metadata
      expect(receivedMeta).toBeDefined();
      expect(receivedMeta).toHaveProperty("timestamp");

      socket.close();
    });

    it("should reject message with payload key when schema defines none", async () => {
      const NoPayloadMsg = message("NO_PAYLOAD");
      const socket = await connectToServer(port);
      const listener = createMessageListener();
      listener.attach(socket);

      // Send message with payload key when schema has no payload
      socket.send(
        JSON.stringify({
          type: "NO_PAYLOAD",
          meta: { timestamp: Date.now() },
          payload: {}, // ❌ Unexpected - schema defines no payload
        }),
      );

      // Wait for potential response
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Handler should not receive this invalid message
      expect(listener.messages.length).toBe(0);

      socket.close();
    });

    it("should reject message missing payload key when schema requires one", async () => {
      const RequiresPayloadMsg = message("REQUIRES_PAYLOAD", {
        id: z.number(),
      });

      router.on(RequiresPayloadMsg, () => {
        // Should not be called
      });

      const socket = await connectToServer(port);
      const listener = createMessageListener();
      listener.attach(socket);

      // Send message without payload when schema requires it
      socket.send(
        JSON.stringify({
          type: "REQUIRES_PAYLOAD",
          meta: { timestamp: Date.now() },
          // ❌ Missing payload key
        }),
      );

      // Wait for potential response
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Handler should not receive this invalid message
      expect(listener.messages.length).toBe(0);

      socket.close();
    });

    it("should override client-injected reserved meta keys", async () => {
      let receivedMeta: unknown;
      const maliciousClientId = "malicious-fake-id";
      const maliciousReceivedAt = 999;

      // Register handler in a separate test context to avoid handler accumulation
      let capturedPing: any;
      router.on(Ping, (ctx) => {
        capturedPing = ctx;
        receivedMeta = ctx.meta;
      });

      const socket = await connectToServer(port);

      // Send message with reserved keys
      socket.send(
        JSON.stringify({
          type: "PING",
          meta: {
            timestamp: Date.now(),
            clientId: maliciousClientId, // ❌ Client tries to inject fake ID
            receivedAt: maliciousReceivedAt, // ❌ Client tries to inject fake timestamp
          },
          payload: { message: "test" },
        }),
      );

      // Wait for handler to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Handler should have received meta with server-injected values
      expect(receivedMeta).toBeDefined();
      expect((receivedMeta as any).clientId).toBeDefined();
      // The clientId should be server-generated, NOT the malicious one
      expect((receivedMeta as any).clientId).not.toBe(maliciousClientId);
      // receivedAt should be server time, NOT the malicious value
      expect((receivedMeta as any).receivedAt).toBeDefined();
      expect((receivedMeta as any).receivedAt).not.toBe(maliciousReceivedAt);
      expect((receivedMeta as any).receivedAt).toBeGreaterThan(0);

      socket.close();
    });

    it("should provide ctx.receivedAt as authoritative server timestamp", async () => {
      let receivedAt: number | undefined;
      let receivedMetaTimestamp: number | undefined;
      const beforeServerTime = Date.now();

      router.on(Ping, (ctx) => {
        receivedAt = ctx.receivedAt;
        receivedMetaTimestamp = ctx.meta.timestamp;
      });

      const socket = await connectToServer(port);

      // Send message with client's timestamp (which may be skewed)
      const clientTime = beforeServerTime - 5000; // Fake old timestamp
      socket.send(
        JSON.stringify({
          type: "PING",
          meta: {
            timestamp: clientTime, // ❌ Old/untrusted client time
          },
          payload: { message: "test" },
        }),
      );

      // Wait for handler to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      const afterServerTime = Date.now();

      // ctx.receivedAt should be server time (authoritative)
      expect(receivedAt).toBeGreaterThanOrEqual(beforeServerTime);
      expect(receivedAt).toBeLessThanOrEqual(afterServerTime);

      // meta.timestamp should be preserved from client (but untrusted)
      expect(receivedMetaTimestamp).toBe(clientTime);

      // Server time should be significantly different from client time
      expect(receivedAt! - receivedMetaTimestamp!).toBeGreaterThan(4000);

      socket.close();
    });
  });

  describe("router.publish()", () => {
    it("should not inject clientId into published messages", async () => {
      const ChatMsg = message("CHAT", { text: z.string() });

      // Access the internal router's pubsub
      const coreRouter = (router as any)[Symbol.for("ws-kit.core")];
      let publishedMessage: any;
      coreRouter.pubsub.subscribe("test-topic", (msg: any) => {
        publishedMessage = msg;
      });

      // Publish a message using the core router
      await coreRouter.publish("test-topic", ChatMsg, { text: "test" });

      // Verify the published message
      expect(publishedMessage).toBeDefined();
      expect(publishedMessage.meta).toBeDefined();
      // clientId should NOT be in published messages
      expect(publishedMessage.meta).not.toHaveProperty("clientId");
      // But timestamp should be auto-injected
      expect(publishedMessage.meta).toHaveProperty("timestamp");
      expect(publishedMessage.payload).toEqual({ text: "test" });
    });

    it("should preserve custom metadata in published messages", async () => {
      const ChatMsg = message(
        "CHAT",
        { text: z.string() },
        { senderId: z.string().optional() },
      );

      // Access the internal router's pubsub
      const coreRouter = (router as any)[Symbol.for("ws-kit.core")];
      let publishedMessage: any;
      coreRouter.pubsub.subscribe("test-topic-2", (msg: any) => {
        publishedMessage = msg;
      });

      // Publish with custom metadata using the core router
      await coreRouter.publish(
        "test-topic-2",
        ChatMsg,
        { text: "hello" },
        { meta: { senderId: "admin" } },
      );

      // Verify custom metadata is preserved
      expect(publishedMessage).toBeDefined();
      expect(publishedMessage.meta).toHaveProperty("senderId", "admin");
      expect(publishedMessage.meta).toHaveProperty("timestamp");
      expect(publishedMessage.payload).toEqual({ text: "hello" });
    });
  });
});
