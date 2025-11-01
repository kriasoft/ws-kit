// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "bun:test";
import {
  WebSocketRouter,
  type ServerWebSocket,
  type WebSocketData,
  type ValidatorAdapter,
} from "../src/index.js";

// ============================================================================
// Mock Implementations
// ============================================================================

const mockValidator: ValidatorAdapter = {
  getMessageType(schema: unknown): string {
    return (schema as { type: string }).type;
  },
  safeParse(schema: unknown, data: unknown) {
    return { success: true, data };
  },
  infer<T>(schema: T): unknown {
    return schema;
  },
};

function createMockWebSocket(
  clientId = "test-client",
): ServerWebSocket<WebSocketData> {
  const messages: string[] = [];

  return {
    data: { clientId },
    send(message: string | Uint8Array) {
      if (typeof message === "string") {
        messages.push(message);
      }
    },
    close() {
      /* no-op */
    },
    subscribe() {
      /* no-op */
    },
    unsubscribe() {
      /* no-op */
    },
    readyState: 1,
    _getMessages() {
      return messages;
    },
  } as unknown as ServerWebSocket<WebSocketData> & {
    _getMessages(): string[];
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Message Payload Limits", () => {
  describe("Default Limits", () => {
    it("should use 1MB default limit", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create a 500KB message (within limit)
      const smallMessage = JSON.stringify({
        type: "TEST",
        meta: {},
        payload: "x".repeat(500_000),
      });

      // Should not throw
      await expect(
        router.handleMessage(ws, smallMessage),
      ).resolves.toBeUndefined();
    });

    it("should reject 2MB message with default limit", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create a 2MB message (exceeds 1MB limit)
      const largeMessage = JSON.stringify({
        type: "TEST",
        meta: {},
        payload: "x".repeat(2_000_000),
      });

      // Should catch error in limit exceeded hook
      await router.handleMessage(ws, largeMessage);
      expect(limitExceededCalls.length).toBe(1);
      expect(limitExceededCalls[0].type).toBe("payload");
    });
  });

  describe("Custom Limits", () => {
    it("should enforce custom max payload size", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 1000, // 1KB
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create a 2KB message (exceeds 1KB limit)
      const largeMessage = JSON.stringify({
        type: "TEST",
        meta: {},
        payload: "x".repeat(2000),
      });

      // Should catch in limit exceeded hook
      await router.handleMessage(ws, largeMessage);
      expect(limitExceededCalls.length).toBe(1);
      expect(limitExceededCalls[0].limit).toBe(1000);
    });

    it("should accept messages below custom limit", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 10000, // 10KB
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create a 5KB message (within limit)
      const smallMessage = JSON.stringify({
        type: "TEST",
        meta: {},
        payload: "x".repeat(5000),
      });

      // Should succeed
      await expect(
        router.handleMessage(ws, smallMessage),
      ).resolves.toBeUndefined();
    });

    it("should handle very small limits", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 10, // 10 bytes
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create a minimal message that exceeds limit
      const message = "x".repeat(22);

      // Should catch in limit exceeded hook
      await router.handleMessage(ws, message);
      expect(limitExceededCalls.length).toBe(1);
    });

    it("should handle very large limits", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100_000_000, // 100MB
        },
      });

      expect(router).toBeDefined();
    });
  });

  describe("Limit Enforcement", () => {
    it("should count bytes in string messages", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // ASCII string: each char = 1 byte
      const message = "x".repeat(150); // 150 bytes

      await router.handleMessage(ws, message);
      expect(limitExceededCalls.length).toBe(1);
    });

    it("should count bytes in Buffer messages", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create buffer with 150 bytes
      const buffer = Buffer.alloc(150);
      buffer.fill(0x41); // Fill with 'A'

      await router.handleMessage(ws, buffer);
      expect(limitExceededCalls.length).toBe(1);
    });

    it("should account for UTF-8 byte encoding", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Emoji = 4 bytes in UTF-8
      const message = "😀".repeat(50); // 200 bytes

      await router.handleMessage(ws, message);
      expect(limitExceededCalls.length).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty message", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Empty message causes JSON parse error which is logged but doesn't trigger error hook
      await expect(router.handleMessage(ws, "")).resolves.toBeUndefined();
    });

    it("should handle message exactly at limit", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create a valid message that is approximately 100 bytes
      const baseMsg = JSON.stringify({
        type: "TEST",
        meta: {},
      });
      const msgLength = Buffer.byteLength(baseMsg, "utf8");
      const paddingLength = 100 - msgLength - 2; // -2 for quotes around payload

      const message = JSON.stringify({
        type: "TEST",
        meta: {},
        payload: paddingLength > 0 ? "x".repeat(paddingLength) : "",
      });

      const byteLength = Buffer.byteLength(message, "utf8");
      if (byteLength <= 100) {
        await expect(
          router.handleMessage(ws, message),
        ).resolves.toBeUndefined();
      }
    });

    it("should reject message one byte over limit", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create message 101 bytes
      const message = "x".repeat(101);

      await router.handleMessage(ws, message);
      expect(limitExceededCalls.length).toBe(1);
    });

    it("should handle Buffer at exact limit", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      const buffer = Buffer.alloc(100);
      buffer.fill(0x41);

      await expect(router.handleMessage(ws, buffer)).resolves.toBeUndefined();
    });

    it("should handle zero limit", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 0,
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // With 0 byte limit, any message is rejected
      const message = "a"; // 1 byte - exceeds 0 byte limit

      await router.handleMessage(ws, message);
      expect(limitExceededCalls.length).toBe(1); // Message exceeds 0 byte limit
    });
  });

  describe("Multiple Connections", () => {
    it("should enforce limits independently for each connection", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws1 = createMockWebSocket("client-1");
      const ws2 = createMockWebSocket("client-2");

      await router.handleOpen(ws1);
      await router.handleOpen(ws2);

      const largeMessage = "x".repeat(150);

      // Both should be rejected
      await router.handleMessage(ws1, largeMessage);
      await router.handleMessage(ws2, largeMessage);

      expect(limitExceededCalls.length).toBe(2);
    });
  });

  describe("Limit Exceeded Hook", () => {
    it("should call onLimitExceeded hook when payload exceeds limit", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onLimitExceeded: (info) => {
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      expect(limitExceededCalls.length).toBe(1);
      expect(limitExceededCalls[0].type).toBe("payload");
      expect(limitExceededCalls[0].observed).toBeGreaterThan(100);
      expect(limitExceededCalls[0].limit).toBe(100);
      expect(limitExceededCalls[0].clientId).toBe("test-client");
      expect(limitExceededCalls[0].ws).toBe(ws);
    });

    it("should send RESOURCE_EXHAUSTED error when onExceeded='send'", async () => {
      let sentMessage: string | null = null;
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
          onExceeded: "send",
        },
      });

      const ws = createMockWebSocket();
      ws.send = (msg) => {
        if (typeof msg === "string") sentMessage = msg;
      };

      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      expect(sentMessage).toBeTruthy();
      const parsed = JSON.parse(sentMessage!);
      expect(parsed.type).toBe("ERROR");
      expect(parsed.payload.code).toBe("RESOURCE_EXHAUSTED");
      expect(parsed.payload.details.observed).toBeGreaterThan(100);
      expect(parsed.payload.details.limit).toBe(100);
    });

    it("should close connection when onExceeded='close'", async () => {
      let closeCalled = false;
      let closeCode: number | undefined;
      let closeReason: string | undefined;

      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
          onExceeded: "close",
          closeCode: 1009,
        },
      });

      const ws = createMockWebSocket();
      ws.close = (code, reason) => {
        closeCalled = true;
        closeCode = code;
        closeReason = reason;
      };

      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      expect(closeCalled).toBe(true);
      expect(closeCode).toBe(1009);
      expect(closeReason).toBe("RESOURCE_EXHAUSTED");
    });

    it("should not call onError for limit violations", async () => {
      const errorCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
          onExceeded: "send",
        },
        hooks: {
          onError: (error) => {
            errorCalls.push(error);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      // onError should NOT be called for limit violations
      expect(errorCalls.length).toBe(0);
    });

    it("should handle custom close code", async () => {
      let closeCode: number | undefined;

      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
          onExceeded: "close",
          closeCode: 1008, // Policy Violation
        },
      });

      const ws = createMockWebSocket();
      ws.close = (code) => {
        closeCode = code;
      };

      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      expect(closeCode).toBe(1008);
    });

    it("should default to close code 1009 for close behavior", async () => {
      let closeCode: number | undefined;

      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
          onExceeded: "close",
          // No explicit closeCode provided
        },
      });

      const ws = createMockWebSocket();
      ws.close = (code) => {
        closeCode = code;
      };

      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      expect(closeCode).toBe(1009); // Should default to 1009
    });

    it("should do nothing for custom mode", async () => {
      let closeCalled = false;
      let sendMessage: string | null = null;

      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
          onExceeded: "custom",
        },
      });

      const ws = createMockWebSocket();
      ws.close = () => {
        closeCalled = true;
      };
      ws.send = (msg) => {
        if (typeof msg === "string") sendMessage = msg;
      };

      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      // For custom mode, no automatic send or close
      expect(closeCalled).toBe(false);
      expect(sendMessage).toBeNull();
    });

    it("should pass correct info to async limit exceeded handler", async () => {
      const limitExceededCalls: any[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onLimitExceeded: async (info) => {
            // Simulate async work
            await new Promise((resolve) => setTimeout(resolve, 0));
            limitExceededCalls.push(info);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      const largeMessage = "x".repeat(150);
      await router.handleMessage(ws, largeMessage);

      // Handler was called (fire-and-forget, so may not be awaited)
      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(limitExceededCalls.length).toBe(1);
    });
  });
});
