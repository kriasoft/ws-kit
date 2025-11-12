// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { z, message, createRouter } from "@ws-kit/zod";
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
  let router: ReturnType<typeof createRouter>;
  let createdWebSockets: { close: () => void }[];

  beforeEach(() => {
    // Create router with testing mode for internal state inspection
    router = createRouter({ testing: true });
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
      const { fetch } = createBunHandler(router);
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
      const { fetch } = createBunHandler(router);
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
      const { fetch } = createBunHandler(router, {
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

      const { fetch } = createBunHandler(router, {
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

      const { fetch } = createBunHandler(router, {
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

    it("should return 500 when upgrade fails", async () => {
      const { fetch } = createBunHandler(router);

      const mockServer = {
        upgrade: () => null, // Simulate upgrade failure
      };

      const req = new Request("ws://localhost/ws");
      const response = await fetch(req, mockServer as any);

      expect(response.status).toBe(500);
    });
  });

  describe("lifecycle hooks via HTTP upgrade", () => {
    it("should call onOpen handler when connection is upgraded", async () => {
      let openCalled = false;
      let clientIdInContext: string | undefined;

      router.onOpen((ctx) => {
        openCalled = true;
        clientIdInContext = ctx.ws.data.clientId;
      });

      const { fetch } = createBunHandler(router);

      const mockServer = {
        upgrade: (req: Request, options: any) => {
          const ws = {
            data: options.data,
            send: () => {},
            close: () => {},
            subscribe: () => {},
            unsubscribe: () => {},
          };
          // Simulate the server calling websocket.open after upgrade
          setImmediate(() => {
            const { websocket } = createBunHandler(router);
            websocket.open(ws);
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
      let closeCode: number | undefined;

      router.onClose((ctx) => {
        closeCalled = true;
        closeCode = ctx.code;
      });

      const { fetch } = createBunHandler(router);
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
            const { websocket } = createBunHandler(router);
            websocket.open(ws);
            // Then close after a brief delay
            setTimeout(() => {
              websocket.close(ws, 1000, "Normal closure");
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
      expect(closeCode).toBe(1000);
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

      router.on(TestMsg, (ctx) => {
        handlerExecuted = true;
        receivedPayload = ctx.payload;
      });

      const { websocket } = createBunHandler(router);
      const ws = {
        data: { clientId: "msg-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open(ws);

      try {
        // Simulate incoming message
        await websocket.message(
          ws,
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
        await websocket.close(ws, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });

    it("should verify handler registration via testing API", () => {
      const TestMsg = message("TEST", { text: z.string() });

      router.on(TestMsg, () => {});

      // NOTE: createRouter from @ws-kit/zod returns a facade over the core router.
      // Use Symbol.for("ws-kit.core") escape hatch to access _testing property.
      // The facade forwards method calls to the core router but doesn't expose _testing directly.
      const coreRouter =
        (router as any)[Symbol.for("ws-kit.core")] || router._core;
      expect(coreRouter._testing?.handlers.size).toBe(1);
    });

    it("should register multiple handlers", () => {
      const Msg1 = message("MSG1", { id: z.number() });
      const Msg2 = message("MSG2", { name: z.string() });

      router.on(Msg1, () => {});
      router.on(Msg2, () => {});

      const coreRouter =
        (router as any)[Symbol.for("ws-kit.core")] || router._core;
      expect(coreRouter._testing?.handlers.size).toBe(2);
    });
  });

  describe("error handling - runtime behavior", () => {
    it("should call onError when handler throws", async () => {
      let errorCaught = false;
      let errorMessage: string | undefined;

      const TestMsg = message("THROW_MSG", { value: z.number() });

      router.on(TestMsg, () => {
        throw new Error("Handler intentionally failed");
      });

      router.onError((error) => {
        errorCaught = true;
        errorMessage = error.message;
      });

      const { websocket } = createBunHandler(router);
      const ws = {
        data: { clientId: "error-handler-test", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open(ws);

      try {
        // Send message that triggers handler error
        await websocket.message(
          ws,
          JSON.stringify({
            type: "THROW_MSG",
            meta: {},
            payload: { value: 42 },
          }),
        );

        expect(errorCaught).toBe(true);
        expect(errorMessage).toContain("intentionally failed");
      } finally {
        // IMPORTANT: Tests that call websocket.open() must call websocket.close().
        // Use try/finally to ensure cleanup runs even if assertions fail.
        // Must also remove from createdWebSockets to avoid leak detection failure in afterEach.
        await websocket.close(ws, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });
  });

  describe("error handling - configuration", () => {
    it("should register error handlers via testing API", () => {
      router.onError((error) => {
        // Error handler registered
      });

      const coreRouter =
        (router as any)[Symbol.for("ws-kit.core")] || router._core;
      expect(coreRouter._testing?.errorHandlers.length).toBe(1);
    });

    it("should support multiple error handlers", () => {
      router.onError(() => {});
      router.onError(() => {});

      const coreRouter =
        (router as any)[Symbol.for("ws-kit.core")] || router._core;
      expect(coreRouter._testing?.errorHandlers.length).toBe(2);
    });
  });

  describe("pub/sub integration - runtime behavior", () => {
    it("should publish messages to router pubsub", async () => {
      const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });
      const publishedMessages: any[] = [];

      // NOTE: Access core router's pubsub API via Symbol escape hatch.
      // The Zod facade doesn't expose pubsub directly; must access core for testing.
      const coreRouter =
        (router as any)[Symbol.for("ws-kit.core")] || router._core;
      coreRouter.pubsub.subscribe("room:123", (msg: any) => {
        publishedMessages.push(msg);
      });

      // Publish message to topic
      const result = await router.publish("room:123", RoomMsg, {
        text: "Hello room",
      });

      // Verify message was published with correct payload.
      // This test asserts the actual message flow, not just that publish() succeeds.
      expect(publishedMessages.length).toBeGreaterThan(0);
      expect(publishedMessages[0].type).toBe("ROOM_MESSAGE");
      expect(publishedMessages[0].payload.text).toBe("Hello room");

      // Verify publish result includes metadata
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    it("should return publish metadata with matched count", async () => {
      const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });

      const publishPromise = router.publish("room:456", RoomMsg, {
        text: "Test message",
      });

      expect(publishPromise).toBeInstanceOf(Promise);
      const result = await publishPromise;
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("matched");
      expect(typeof result.matched).toBe("number");
      expect(result.matched).toBeGreaterThanOrEqual(0);
    });

    it("should support connection topic subscriptions", async () => {
      const { websocket } = createBunHandler(router);
      const subscribeTopics: string[] = [];

      const ws = {
        data: { clientId: "sub-test-2", connectedAt: Date.now() },
        send: () => {},
        close: () => {},
        subscribe: (topic: string) => {
          subscribeTopics.push(topic);
        },
        unsubscribe: () => {},
      };

      createdWebSockets.push(ws);
      await websocket.open(ws);

      try {
        // Simulate subscription to topics
        ws.subscribe("room:456");
        ws.subscribe("notifications");
        ws.subscribe("alerts");

        expect(subscribeTopics).toContain("room:456");
        expect(subscribeTopics).toContain("notifications");
        expect(subscribeTopics).toContain("alerts");
        expect(subscribeTopics.length).toBe(3);
      } finally {
        // Clean up connection
        await websocket.close(ws, 1000, "Test complete");
        const idx = createdWebSockets.indexOf(ws);
        if (idx >= 0) createdWebSockets.splice(idx, 1);
      }
    });
  });

  describe("concurrent connections", () => {
    it("should handle multiple concurrent HTTP upgrades via fetch", async () => {
      const { fetch } = createBunHandler(router);
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
    it("should support merging routers", () => {
      const router2 = createRouter({ testing: true });
      const Msg1 = message("MSG1", { id: z.number() });
      const Msg2 = message("MSG2", { name: z.string() });

      router.on(Msg1, () => {});
      router2.on(Msg2, () => {});

      router.merge(router2);

      const coreRouter =
        (router as any)[Symbol.for("ws-kit.core")] || router._core;
      expect(coreRouter._testing?.handlers.size).toBe(2);
    });
  });
});
