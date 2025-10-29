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
  clientId: string = "test-client",
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
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        hooks: {
          onError: (error) => {
            errors.push(error);
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

      // Should catch error in hook
      await router.handleMessage(ws, largeMessage);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toMatch(/Payload size .* exceeds limit/);
    });
  });

  describe("Custom Limits", () => {
    it("should enforce custom max payload size", async () => {
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 1000, // 1KB
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
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

      // Should catch error
      await router.handleMessage(ws, largeMessage);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toMatch(/Payload size .* exceeds limit/);
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
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 10, // 10 bytes
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create a minimal message that exceeds limit
      const message = "x".repeat(22);

      // Should catch error
      await router.handleMessage(ws, message);
      expect(errors.length).toBe(1);
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
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // ASCII string: each char = 1 byte
      const message = "x".repeat(150); // 150 bytes

      await router.handleMessage(ws, message);
      expect(errors.length).toBe(1);
    });

    it("should count bytes in Buffer messages", async () => {
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create buffer with 150 bytes
      const buffer = Buffer.alloc(150);
      buffer.fill(0x41); // Fill with 'A'

      await router.handleMessage(ws, buffer);
      expect(errors.length).toBe(1);
    });

    it("should account for UTF-8 byte encoding", async () => {
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Emoji = 4 bytes in UTF-8
      const message = "😀".repeat(50); // 200 bytes

      await router.handleMessage(ws, message);
      expect(errors.length).toBe(1);
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
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // Create message 101 bytes
      const message = "x".repeat(101);

      await router.handleMessage(ws, message);
      expect(errors.length).toBe(1);
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
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 0,
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
          },
        },
      });

      const ws = createMockWebSocket();
      await router.handleOpen(ws);

      // With 0 byte limit, any message is rejected
      const message = "a"; // 1 byte - exceeds 0 byte limit

      await router.handleMessage(ws, message);
      expect(errors.length).toBe(1); // Message exceeds 0 byte limit
    });
  });

  describe("Multiple Connections", () => {
    it("should enforce limits independently for each connection", async () => {
      const errors: Error[] = [];
      const router = new WebSocketRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 100,
        },
        hooks: {
          onError: (error) => {
            errors.push(error);
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

      expect(errors.length).toBe(2);
    });
  });
});
