// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Smoke test for quick-start example
 *
 * Verifies that:
 * 1. Server accepts WebSocket connections
 * 2. JoinRoom message triggers UserJoined response
 * 3. SendMessage triggers NewMessage broadcast
 * 4. Connection cleanup works
 *
 * Usage: Start the server first (bun run dev), then run this test (bun run smoke)
 */

import { describe, test, expect, beforeAll } from "bun:test";

const WS_URL = process.env.WS_URL || "ws://localhost:3000";

describe("Quick-start example", () => {
  beforeAll(async () => {
    // Give server a moment to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  test("joins room and sends message", async () => {
    const ws = new WebSocket(WS_URL);

    return new Promise<void>((resolve, reject) => {
      let receivedUserJoined = false;
      let receivedNewMessage = false;

      // Safety timeout (5 seconds)
      const timeoutId = setTimeout(() => {
        ws.close();
        reject(
          new Error(
            "Test timeout - expected messages not received. Is the server running?",
          ),
        );
      }, 5000);

      ws.onopen = () => {
        try {
          // Send JoinRoom message
          ws.send(
            JSON.stringify({
              type: "JOIN_ROOM",
              meta: { timestamp: Date.now() },
              payload: { roomId: "test-room" },
            }),
          );
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "USER_JOINED") {
            receivedUserJoined = true;
            expect(message.payload.roomId).toBe("test-room");

            // Send a message to the room
            ws.send(
              JSON.stringify({
                type: "SEND_MESSAGE",
                meta: { timestamp: Date.now() },
                payload: { roomId: "test-room", text: "Hello, test!" },
              }),
            );
          }

          if (message.type === "NEW_MESSAGE") {
            receivedNewMessage = true;
            expect(message.payload.roomId).toBe("test-room");
            expect(message.payload.text).toBe("Hello, test!");
            expect(message.payload.userId).toBeDefined();
            expect(message.payload.timestamp).toBeDefined();

            // Close connection after verifying
            clearTimeout(timeoutId);
            ws.close();
          }
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      };

      ws.onclose = () => {
        try {
          clearTimeout(timeoutId);
          expect(receivedUserJoined).toBe(true);
          expect(receivedNewMessage).toBe(true);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(
          error instanceof Event ? error.toString() : new Error(String(error)),
        );
      };
    });
  });
});
