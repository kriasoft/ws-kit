// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { memoryPubSub } from "@ws-kit/memory";
import { createRouter, message, withPubSub, z } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createBunHandler } from "../src/index.js";

/**
 * Integration tests for @ws-kit/bun Bun WebSocket handler.
 *
 * Test organization:
 * - "HTTP upgrade pipeline" tests: Use fetch handler to simulate real HTTP upgrade requests
 * - "Lifecycle hooks" tests: Verify onOpen/onClose lifecycle execution with correct context
 * - "Message routing" tests: Unit-level (registration) + runtime (message flow) behavior
 * - "Error handling" tests: Unit-level (registration) + runtime (handler throws) behavior
 * - "Pub/Sub" tests: Verify publishing and subscription mechanisms
 * - "Concurrent connections" tests: Verify multiple simultaneous HTTP upgrades
 * - "Router composition" tests: Verify router merging
 *
 * GOTCHA: Leak detection - tests MUST call websocket.close() or afterEach will fail.
 * The leak check runs BEFORE cleanup, so forgetting close() is caught immediately.
 */
describe("@ws-kit/bun integration tests", () => {
  let router: ReturnType<typeof createRouter> | undefined;
  let createdWebSockets: { close: () => void }[];

  beforeEach(() => {
    // Create router with pub/sub plugin for broadcasting tests
    router = createRouter<{ userId?: string; connectedAt?: number }>().plugin(
      withPubSub({ adapter: memoryPubSub() }),
    );
    createdWebSockets = [];
  });

  afterEach(() => {
    // CRITICAL PATTERN: Check size BEFORE closing to detect leaks.
    // If we checked after, closing would remove items and size would always be 0.
    const leakedCount = createdWebSockets.length;

    // Copy keys before closing (in case close handlers modify the array)
    const keysToClose = createdWebSockets.slice();

    // Clean up all websockets
    for (const ws of keysToClose) {
      ws.close?.();
    }
    createdWebSockets = [];

    // Assert: if test didn't properly close connections, fail the suite.
    // This catches resource leaks during test development.
    if (leakedCount > 0) {
      throw new Error(
        `Test leaked ${leakedCount} websocket connection(s). ` +
          `Each test must call websocket.close() before completing.`,
      );
    }

    router = undefined;
  });

  describe("HTTP upgrade pipeline", () => {
    // NOTE: These tests use the FULL integration pattern: fetch handler simulates HTTP upgrade.
    // This exercises the critical path: HTTP request -> authenticate -> upgrade -> WebSocket creation.
    // Tests verify that the fetch handler correctly prepares upgrade options (clientId, headers, auth).
    it("should process HTTP upgrade request via fetch handler", async () => {
      const { fetch } = createBunHandler(router!);
      let capturedWs: any = null;

      // Mock server that captures the WebSocket created by upgrade
      const mockServer = {
        upgrade: (req: Request, options: any) => {
          expect(req.url).toContain("ws://");
          expect(options.data).toBeDefined();
          expect(options.data.clientId).toBeDefined();
          expect(typeof options.data.clientId).toBe("string");

          // Return a proper mock WebSocket
          const ws = {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };

          capturedWs = ws;
          return ws;
        },
      };

      const req = new Request("ws://localhost/ws");
      await fetch(req, mockServer as any);

      expect(capturedWs).toBeDefined();
      expect(capturedWs.data.clientId).toBeDefined();
    });

    it("should inject x-client-id header during upgrade", async () => {
      const { fetch } = createBunHandler(router!);
      let capturedHeaders: any = null;

      const mockServer = {
        upgrade: (req: Request, options: any) => {
          capturedHeaders = options.headers;
          return {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
        },
      };

      const req = new Request("ws://localhost/ws");
      await fetch(req, mockServer as any);

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders["x-client-id"]).toBeDefined();
      expect(typeof capturedHeaders["x-client-id"]).toBe("string");
      expect(capturedHeaders["x-client-id"].length).toBe(36); // UUID format
    });

    it("should support custom client ID header name", async () => {
      const { fetch } = createBunHandler(router!, {
        clientIdHeader: "x-session-id",
      });
      let capturedHeaders: any = null;

      const mockServer = {
        upgrade: (req: Request, options: any) => {
          capturedHeaders = options.headers;
          return {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
        },
      };

      const req = new Request("ws://localhost/ws");
      await fetch(req, mockServer as any);

      expect(capturedHeaders["x-session-id"]).toBeDefined();
      expect(capturedHeaders["x-client-id"]).toBeUndefined();
    });

    it("should call authenticate function during upgrade", async () => {
      let authCalled = false;

      const { fetch } = createBunHandler(router!, {
        authenticate: (req) => {
          authCalled = true;
          return { userId: "test-user" };
        },
      });

      const mockServer = {
        upgrade: (req: Request, options: any) => {
          return {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
        },
      };

      const req = new Request("ws://localhost/ws");
      await fetch(req, mockServer as any);

      expect(authCalled).toBe(true);
    });

    it("should support async authenticate function", async () => {
      let asyncAuthCalled = false;

      const { fetch } = createBunHandler(router!, {
        authenticate: async (req) => {
          asyncAuthCalled = true;
          await Promise.resolve(); // Simulate async work
          return { userId: "async-user" };
        },
      });

      const mockServer = {
        upgrade: (req: Request, options: any) => {
          return {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
        },
      };

      const req = new Request("ws://localhost/ws");
      await fetch(req, mockServer as any);

      expect(asyncAuthCalled).toBe(true);
    });

    it("should return 400 when upgrade fails", async () => {
      const { fetch } = createBunHandler(router!);

      const mockServer = {
        upgrade: () => false, // Simulate upgrade failure
      };

      const req = new Request("ws://localhost/ws");
      const response = await fetch(req, mockServer as any);

      expect(response instanceof Response && response.status).toBe(400);
    });
  });

  describe("lifecycle hooks via HTTP upgrade", () => {
    // NOTE: These tests simulate Bun's lifecycle by manually calling webhookWs.open/close
    // after the HTTP upgrade completes. This is a realistic representation of Bun's behavior
    // but relies on test-specific timing (setImmediate, setTimeout). In production, the actual
    // Bun server controls the timing of these callbacks after upgrade.
    // Edge cases like rapid upgrades or upgrade failures during the open callback are not
    // tested here; refer to handler.test.ts for unit-level error propagation tests.

    it("should call onOpen handler when connection is upgraded", async () => {
      let openCalled = false;
      let clientIdInContext: string | undefined;

      // Pass lifecycle hooks to createBunHandler, not router
      const { fetch, websocket: webhookWs } = createBunHandler(router!, {
        onOpen: ({ ws, data }) => {
          openCalled = true;
          clientIdInContext = data.clientId as string;
        },
      });

      let capturedWs: any = null;
      const mockServer = {
        upgrade: (req: Request, options: any) => {
          const ws = {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
          capturedWs = ws;

          // Simulate the server calling websocket.open after upgrade
          setImmediate(() => {
            webhookWs.open!(ws as any);
          });
          return ws;
        },
      };

      const req = new Request("ws://localhost/ws");
      await fetch(req, mockServer as any);

      // Give async open handler time to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(openCalled).toBe(true);
      expect(clientIdInContext).toBeDefined();
    });

    it("should call onClose handler when connection closes via upgrade", async () => {
      let closeCalled = false;
      let clientIdInClose: string | undefined;

      // Pass lifecycle hooks to createBunHandler, not router
      const { fetch, websocket: webhookWs } = createBunHandler(router!, {
        onClose: ({ ws, data }) => {
          closeCalled = true;
          clientIdInClose = data.clientId as string;
        },
      });

      let capturedWs: any = null;
      const mockServer = {
        upgrade: (req: Request, options: any) => {
          const ws = {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
          capturedWs = ws;

          // Simulate the server calling websocket.open after upgrade
          setImmediate(() => {
            webhookWs.open!(ws as any);
            // Then close after a brief delay
            setTimeout(() => {
              webhookWs.close!(ws as any, 1000, "Normal closure");
            }, 5);
          });
          return ws;
        },
      };

      const req = new Request("ws://localhost/ws");
      await fetch(req, mockServer as any);

      // Give async open and close handlers time to run
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(closeCalled).toBe(true);
      expect(clientIdInClose).toBeDefined();
    });
  });

  describe("message routing - runtime behavior", () => {
    // NOTE: Tests in this suite verify RUNTIME behavior (actual message execution).
    // Distinguish from unit-level tests below that verify CONFIGURATION (handler registration).
    // Runtime tests: Call websocket.open() + websocket.message() to drive handler execution.
    // Unit tests: Access _testing property to inspect internal state.
    it("should execute handler when message is received", async () => {
      let handlerExecuted = false;
      let receivedPayload: any = null;

      const TestMsg = message("TEST_MSG", { text: z.string() });

      router!.on(TestMsg, (ctx) => {
        handlerExecuted = true;
        receivedPayload = ctx.payload;
      });

      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "msg-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        // Simulate incoming message
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "TEST_MSG",
            meta: {},
            payload: { text: "hello" },
          }),
        );

        expect(handlerExecuted).toBe(true);
        expect(receivedPayload?.text).toBe("hello");
      } finally {
        // Clean up connection
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });

    it("should verify handler registration via message dispatch", async () => {
      const TestMsg = message("TEST", { text: z.string() });
      let handlerCalled = false;

      router!.on(TestMsg, () => {
        handlerCalled = true;
      });

      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "reg-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "TEST",
            meta: {},
            payload: { text: "test" },
          }),
        );

        expect(handlerCalled).toBe(true);
      } finally {
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });

    it("should register multiple handlers", async () => {
      const Msg1 = message("MSG1", { id: z.number() });
      const Msg2 = message("MSG2", { name: z.string() });

      const calls: string[] = [];

      router!.on(Msg1, () => {
        calls.push("msg1");
      });
      router!.on(Msg2, () => {
        calls.push("msg2");
      });

      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "multi-handler-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        // Send first message
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "MSG1",
            meta: {},
            payload: { id: 1 },
          }),
        );

        // Send second message
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "MSG2",
            meta: {},
            payload: { name: "test" },
          }),
        );

        expect(calls).toEqual(["msg1", "msg2"]);
      } finally {
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });
  });

  describe("error handling - runtime behavior", () => {
    it("should call onError when handler throws", async () => {
      let errorCaught: Error | null = null;

      const TestMsg = message("THROW_MSG", { value: z.number() });

      router!.on(TestMsg, () => {
        throw new Error("Handler intentionally failed");
      });

      router!.onError((error) => {
        if (error instanceof Error) {
          errorCaught = error;
        }
      });

      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "error-handler-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        // Send message that triggers handler error
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "THROW_MSG",
            meta: {},
            payload: { value: 42 },
          }),
        );

        expect(errorCaught).not.toBeNull();
        expect(errorCaught!.message).toContain("intentionally failed");
        expect(errorCaught!.constructor).toBe(Error);
      } finally {
        // IMPORTANT: Tests that call websocket.open() must call websocket.close().
        // Use try/finally to ensure cleanup runs even if assertions fail.
        // Must also remove from createdWebSockets to avoid leak detection failure in afterEach.
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });
  });

  describe("error handling - configuration", () => {
    it("should call error handler when registered", async () => {
      const errorCalls: string[] = [];

      router!.onError((error) => {
        if (error instanceof Error) {
          errorCalls.push(error.message);
        }
      });

      const TestMsg = message("ERROR_MSG", { value: z.number() });
      router!.on(TestMsg, () => {
        throw new Error("Test error 1");
      });

      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "error-config-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "ERROR_MSG",
            meta: {},
            payload: { value: 1 },
          }),
        );

        expect(errorCalls).toContain("Test error 1");
      } finally {
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });

    it("should support multiple error handlers", async () => {
      const handler1Calls: string[] = [];
      const handler2Calls: string[] = [];

      router!.onError((error) => {
        if (error instanceof Error) {
          handler1Calls.push(error.message);
        }
      });
      router!.onError((error) => {
        if (error instanceof Error) {
          handler2Calls.push(error.message);
        }
      });

      const TestMsg = message("MULTI_ERROR", { value: z.number() });
      router!.on(TestMsg, () => {
        throw new Error("Test error");
      });

      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "multi-error-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "MULTI_ERROR",
            meta: {},
            payload: { value: 1 },
          }),
        );

        // Both handlers should be called
        expect(handler1Calls).toContain("Test error");
        expect(handler2Calls).toContain("Test error");
      } finally {
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });
  });

  describe("pub/sub integration - runtime behavior", () => {
    it("should publish messages via router.publish()", async () => {
      const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });

      // Publish message to a topic
      const result = await (router as any).publish("room:123", RoomMsg, {
        text: "Hello room",
      });

      // Verify publish result includes metadata
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("ok");
      expect(typeof result.ok).toBe("boolean");
    });

    it("should return publish result with metadata", async () => {
      const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });

      const publishPromise = (router as any).publish("room:456", RoomMsg, {
        text: "Test message",
      });

      expect(publishPromise).toBeInstanceOf(Promise);
      const result = await publishPromise;
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("ok");
    });

    it("should allow handlers to publish to topics", async () => {
      const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });
      let handlerExecuted = false;

      // Handler that publishes to a topic
      router!.on(RoomMsg, async (ctx) => {
        handlerExecuted = true;
        // ctx.publish is available when pub/sub plugin is enabled (see beforeEach)
        if (typeof ctx.publish === "function") {
          await ctx.publish("notifications", RoomMsg, {
            text: `Message from ${ctx.data.clientId}: ${ctx.payload.text}`,
          });
        }
      });

      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "pub-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        // Send message that triggers handler
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "ROOM_MESSAGE",
            meta: {},
            payload: { text: "broadcast test" },
          }),
        );

        // Verify handler was executed
        expect(handlerExecuted).toBe(true);
      } finally {
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });
  });

  describe("concurrent connections", () => {
    it("should handle multiple concurrent HTTP upgrades via fetch", async () => {
      const { fetch } = createBunHandler(router!);
      const upgradedConnections: any[] = [];

      const mockServer = {
        upgrade: (req: Request, options: any) => {
          const ws = {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
          upgradedConnections.push(ws);
          return ws;
        },
      };

      // Simulate multiple concurrent upgrade requests
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          fetch(new Request("ws://localhost/ws"), mockServer as any),
        );
      }

      await Promise.all(requests);

      expect(upgradedConnections.length).toBe(5);

      // Each connection should have a unique clientId
      const clientIds = upgradedConnections.map((ws) => ws.data.clientId);
      const uniqueClientIds = new Set(clientIds);
      expect(uniqueClientIds.size).toBe(5);
    });
  });

  describe("router composition", () => {
    it("should support merging routers", async () => {
      const router2 = createRouter<{ userId?: string; connectedAt?: number }>();
      const Msg1 = message("MSG1", { id: z.number() });
      const Msg2 = message("MSG2", { name: z.string() });

      const calls: string[] = [];

      router!.on(Msg1, () => {
        calls.push("msg1");
      });
      router2.on(Msg2, () => {
        calls.push("msg2");
      });

      router!.merge(router2);

      // Test that merged handlers work via message dispatch
      const { websocket } = createBunHandler(router!);
      const ws = {
        data: { clientId: "merge-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open!(ws as any);

      try {
        // Send first message (from original router)
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "MSG1",
            meta: {},
            payload: { id: 1 },
          }),
        );

        // Send second message (from merged router)
        await websocket.message(
          ws as any,
          JSON.stringify({
            type: "MSG2",
            meta: {},
            payload: { name: "test" },
          }),
        );

        // Both handlers should have been called
        expect(calls).toContain("msg1");
        expect(calls).toContain("msg2");
      } finally {
        await websocket.close!(ws as any, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });
  });

  describe("BunPubSub adapter integration", () => {
    // NOTE: These tests verify BunPubSub adapter with mock Bun server.
    // The adapter receives messages from handlers and publishes via server.publish().
    // Full end-to-end testing with real subscriptions would require a full Bun
    // server instance with WebSocket connections; see examples/ for real-world usage.

    it("should accept BunPubSub adapter in router configuration", async () => {
      const { bunPubSub } = await import("../src/adapter.js");

      // Mock Bun server
      const mockBunServer = {
        publish: () => {},
      };

      // Verify BunPubSub can be used with router
      const bunRouter = createRouter<{
        userId?: string;
        connectedAt?: number;
      }>().plugin(withPubSub({ adapter: bunPubSub(mockBunServer as any) }));

      expect(bunRouter).toBeDefined();
      // If plugin initialization fails, bunRouter would throw or be undefined
    });

    it("should verify BunPubSub adapter exports correct interface", async () => {
      const { bunPubSub } = await import("../src/adapter.js");

      // Mock Bun server with publish tracking
      const publishCalls: [string, string | ArrayBuffer | Uint8Array][] = [];
      const mockBunServer = {
        publish: (topic: string, data: string | ArrayBuffer | Uint8Array) => {
          publishCalls.push([topic, data]);
          return true;
        },
      };

      const adapter = bunPubSub(mockBunServer as any);

      // Verify adapter has the expected interface
      expect(typeof adapter.publish).toBe("function");
      expect(typeof adapter.subscribe).toBe("function");
      expect(typeof adapter.unsubscribe).toBe("function");
      expect(typeof adapter.getSubscribers).toBe("function");

      // Test publish directly via adapter
      const result = await adapter.publish({
        topic: "test-topic",
        payload: { message: "test" },
        type: "TEST",
        meta: {},
      });

      expect(result.ok).toBe(true);
      expect(publishCalls).toHaveLength(1);
      const call = publishCalls[0];
      expect(call).toBeDefined();
      if (call) {
        const [topic, data] = call;
        expect(topic).toBe("test-topic");
        expect(data).toBe(JSON.stringify({ message: "test" }));
      }
    });

    it("should handle BunPubSub publish errors via adapter", async () => {
      const { bunPubSub } = await import("../src/adapter.js");

      const errorServer = {
        publish: () => {
          throw new Error("Server publish failed");
        },
      };

      const adapter = bunPubSub(errorServer as any);

      // Test error handling
      const result = await adapter.publish({
        topic: "error-topic",
        payload: { value: 42 },
        type: "ERROR_TEST",
        meta: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("ADAPTER_ERROR");
        expect(result.retryable).toBe(true);
      }
    });
  });
});
