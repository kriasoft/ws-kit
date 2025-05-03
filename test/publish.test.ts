/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import { describe, expect, it, mock, spyOn } from "bun:test";
import { z } from "zod";
import { publish } from "../publish";
import { messageSchema } from "../schema";

// Type for our mock ServerWebSocket
type MockWebSocketData = { clientId: string } & Record<string, unknown>;

// Create a simple mock for ServerWebSocket
class MockServerWebSocket {
  data: MockWebSocketData;
  publishedMessages: { topic: string; data: string }[] = [];

  constructor(clientId: string, additionalData: Record<string, unknown> = {}) {
    this.data = { clientId, ...additionalData };
  }

  publish(topic: string, data: string) {
    this.publishedMessages.push({ topic, data });
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  subscribe(topic: string) {
    // Mock implementation
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  unsubscribe(topic: string) {
    // Mock implementation
  }
}

// Define type for the message data structure
interface PublishedMessage {
  type: string;
  meta: {
    clientId: string;
    timestamp: number;
    corelationId?: string;
    [key: string]: unknown;
  };
  payload?: Record<string, unknown>;
}

describe("publish function", () => {
  // Common test schemas
  const TestMessage = messageSchema("TEST_MESSAGE", {
    content: z.string(),
    count: z.number().optional(),
  });

  const TestMetaMessage = messageSchema(
    "TEST_META_MESSAGE",
    { content: z.string() },
    z.object({
      roomId: z.string(),
    }),
  );

  // Helper to cast our mock to the type expected by the publish function
  function castMockWebSocket(
    ws: MockServerWebSocket,
  ): ServerWebSocket<MockWebSocketData> {
    return ws as unknown as ServerWebSocket<MockWebSocketData>;
  }

  it("should validate and publish a message", () => {
    // Create a mock WebSocket
    const ws = new MockServerWebSocket("client-123");

    // Call publish with valid data
    const result = publish(castMockWebSocket(ws), "test-topic", TestMessage, {
      content: "Hello World",
      count: 42,
    });

    // Verify result and published message
    expect(result).toBe(true);
    expect(ws.publishedMessages.length).toBe(1);

    // Safe access with proper checks
    const message = ws.publishedMessages[0];
    expect(message).toBeDefined();
    if (message) {
      const publishedData = JSON.parse(message.data) as PublishedMessage;
      expect(publishedData.type).toBe("TEST_MESSAGE");
      expect(publishedData.meta.clientId).toBe("client-123");
      expect(publishedData.meta.timestamp).toBeGreaterThan(0);
      expect(publishedData.payload?.content).toBe("Hello World");
      expect(publishedData.payload?.count).toBe(42);
    }
  });

  it("should include metadata in published message", () => {
    const ws = new MockServerWebSocket("client-123");

    // Only use known metadata fields from the MessageMetadataSchema
    const result = publish(
      castMockWebSocket(ws),
      "test-topic",
      TestMessage,
      {
        content: "Hello with meta",
      },
      {
        corelationId: "corr-456", // This is a recognized field in the MessageMetadataSchema
      },
    );

    expect(result).toBe(true);
    expect(ws.publishedMessages.length).toBe(1);

    // Safe access with proper checks
    const message = ws.publishedMessages[0];
    expect(message).toBeDefined();
    if (message) {
      const publishedData = JSON.parse(message.data) as PublishedMessage;
      expect(publishedData.meta.corelationId).toBe("corr-456");
    }
  });

  it("should reject invalid messages and return false", () => {
    const ws = new MockServerWebSocket("client-123");

    // Setup spy on console.error
    const errorSpy = spyOn(console, "error");

    // Create a type for our payload but intentionally pass invalid data
    interface ValidPayload {
      content: string;
      count?: number;
    }

    // We're using a type assertion to bypass TypeScript's type checking
    // because we're intentionally testing invalid data handling
    const invalidPayload = {
      content: 123,
      count: 42,
    } as unknown as ValidPayload;

    const result = publish(
      castMockWebSocket(ws),
      "test-topic",
      TestMessage,
      invalidPayload,
    );

    // Verify failure
    expect(result).toBe(false);
    expect(ws.publishedMessages.length).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should handle custom metadata schemas", () => {
    const ws = new MockServerWebSocket("client-123");

    // Publish with a schema that has custom metadata requirements
    const result = publish(
      castMockWebSocket(ws),
      "room-1",
      TestMetaMessage,
      {
        content: "Message with custom meta",
      },
      {
        roomId: "room-1", // Required by the schema
      },
    );

    expect(result).toBe(true);
    expect(ws.publishedMessages.length).toBe(1);

    // Safe access with proper checks
    const message = ws.publishedMessages[0];
    expect(message).toBeDefined();
    if (message) {
      const publishedData = JSON.parse(message.data) as PublishedMessage;
      expect(publishedData.meta.roomId).toBe("room-1");
    }
  });

  it("should fail when required metadata is missing", () => {
    const ws = new MockServerWebSocket("client-123");

    // Setup spy on console.error
    const errorSpy = spyOn(console, "error");

    // Try to publish without required metadata
    const result = publish(
      castMockWebSocket(ws),
      "room-1",
      TestMetaMessage,
      {
        content: "Message with custom meta",
      },
      {
        // Missing roomId which is required
      },
    );

    // Verify failure
    expect(result).toBe(false);
    expect(ws.publishedMessages.length).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should handle exceptions gracefully", () => {
    const ws = new MockServerWebSocket("client-123");

    // Create a mock that throws when publish is called
    const throwingPublish = mock(() => {
      throw new Error("Test error");
    });

    // Replace the publish method with the proper typed casting
    ws.publish = throwingPublish as unknown as typeof ws.publish;

    // Setup spy on console.error
    const errorSpy = spyOn(console, "error");

    // Try to publish
    const result = publish(castMockWebSocket(ws), "test-topic", TestMessage, {
      content: "Should not be published",
    });

    // Verify failure
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should properly handle messages without payload", () => {
    const NoPayloadMessage = messageSchema("NO_PAYLOAD");
    const ws = new MockServerWebSocket("client-123");

    // Publish a message with no payload
    const result = publish(
      castMockWebSocket(ws),
      "test-topic",
      NoPayloadMessage,
      undefined,
    );

    expect(result).toBe(true);
    expect(ws.publishedMessages.length).toBe(1);

    // Safe access with proper checks
    const message = ws.publishedMessages[0];
    expect(message).toBeDefined();
    if (message) {
      const publishedData = JSON.parse(message.data) as PublishedMessage;
      expect(publishedData.type).toBe("NO_PAYLOAD");
      expect(publishedData.meta.clientId).toBe("client-123");
      expect(publishedData).not.toHaveProperty("payload");
    }
  });
});
