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
import { createBunAdapter, createBunHandler } from "../../../bun/src/index";

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
});

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
  let ws: ReturnType<typeof createZodRouter>;
  let port: number;

  beforeEach(() => {
    // Use a random port for each test to avoid conflicts
    port = 50000 + Math.floor(Math.random() * 10000);

    // Create a new router with platform adapter and validator
    ws = createZodRouter({
      platform: createBunAdapter(),
    });

    // Set up message handlers
    ws.onMessage(Ping, (ctx) => {
      // Echo back a PONG with the same message and add a timestamp
      ctx.send(Pong, {
        message: ctx.payload.message,
        timestamp: Date.now(),
      });
    });

    // Add an error message handler
    ws.onMessage(Error, () => {
      // Just for handling error messages in tests
    });

    // Set up open handler
    const openHandlerMock = mock(() => {
      // Optional: send a welcome message
      // ctx.send(...);
    });
    ws.onOpen(openHandlerMock);

    // Set up close handler
    const closeHandlerMock = mock(() => {
      /* Mock implementation */
    });
    ws.onClose(closeHandlerMock);

    // Create Bun handler from router
    const { fetch, websocket } = createBunHandler(ws._core);

    // Start the server
    server = Bun.serve({
      port,
      fetch,
      websocket,
    });
  });

  afterEach(() => {
    // Shutdown the server after each test
    server.stop();
  });

  it("should establish a WebSocket connection and exchange messages", async () => {
    // Wait a bit to ensure server is ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Connect to the server
    const socket = new WebSocket(`ws://localhost:${port}/ws`);

    // Keep track of messages received by the client
    const receivedMessages: any[] = [];

    // Set up message handler
    socket.addEventListener("message", (event) => {
      receivedMessages.push(JSON.parse(event.data as string));
    });

    // Wait for the connection to open
    await new Promise<void>((resolve) => {
      socket.addEventListener("open", () => resolve());
    });

    // Send a PING message
    const pingMessage = {
      type: "PING",
      meta: { clientId: "test-client" },
      payload: { message: "Hello Server!" },
    };

    socket.send(JSON.stringify(pingMessage));

    // Wait for a response (PONG)
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (receivedMessages.length > 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });

    // Check that we received the expected PONG message
    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0].type).toBe("PONG");
    expect(receivedMessages[0].payload.message).toBe("Hello Server!");
    expect(receivedMessages[0].payload.timestamp).toBeGreaterThan(0);

    // Clean up
    socket.close();
  });

  it("should handle multiple clients simultaneously", async () => {
    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Connect multiple clients
    const clients = await Promise.all(
      Array.from({ length: 3 }, async (_, i) => {
        const socket = new WebSocket(`ws://localhost:${port}/ws`);
        const messages: any[] = [];

        socket.addEventListener("message", (event) => {
          messages.push(JSON.parse(event.data as string));
        });

        // Wait for connection to open
        await new Promise<void>((resolve) => {
          socket.addEventListener("open", () => resolve());
        });

        return { socket, messages, id: `client-${i}` };
      }),
    );

    // Each client sends a message
    clients.forEach((client) => {
      const pingMessage = {
        type: "PING",
        meta: { clientId: client.id },
        payload: { message: `Hello from ${client.id}` },
      };
      client.socket.send(JSON.stringify(pingMessage));
    });

    // Wait for all clients to receive responses
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (clients.every((client) => client.messages.length > 0)) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });

    // Verify each client received the correct response
    clients.forEach((client) => {
      expect(client.messages.length).toBe(1);
      expect(client.messages[0].type).toBe("PONG");
      expect(client.messages[0].payload.message).toBe(
        `Hello from ${client.id}`,
      );
    });

    // Clean up
    clients.forEach((client) => client.socket.close());
  });

  it("should handle invalid message format gracefully", async () => {
    // Connect to the server
    await new Promise((resolve) => setTimeout(resolve, 100));
    const socket = new WebSocket(`ws://localhost:${port}/ws`);

    const receivedMessages: any[] = [];
    socket.addEventListener("message", (event) => {
      receivedMessages.push(JSON.parse(event.data as string));
    });

    // Wait for connection to open
    await new Promise<void>((resolve) => {
      socket.addEventListener("open", () => resolve());
    });

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

  it("should handle client disconnection properly", async () => {
    // Create a mock for the close handler
    const closeHandlerMock = mock(() => {
      /* Mock implementation */
    });

    // Register our mock as a close handler
    ws.onClose(closeHandlerMock);

    // Connect to the server
    await new Promise((resolve) => setTimeout(resolve, 100));
    const socket = new WebSocket(`ws://localhost:${port}/ws`);

    // Wait for connection to open
    await new Promise<void>((resolve) => {
      socket.addEventListener("open", () => resolve());
    });

    // Close the connection from the client side
    socket.close(1000, "Normal closure");

    // Wait for close event to be processed
    // Need a bit more time to ensure the close handler is called
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify close handler was called
    expect(closeHandlerMock).toHaveBeenCalled();
  });
});
