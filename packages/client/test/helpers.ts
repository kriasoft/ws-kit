// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Test helpers for client tests
 */

/**
 * Deterministically wait for client state to reach expected value.
 * Polls state with small intervals instead of fixed timeouts for reliability
 * across fast and slow environments.
 */
export async function waitForState(
  client: { state: string },
  expectedState: string,
  timeoutMs = 1000,
) {
  const start = Date.now();
  const pollIntervalMs = 5;

  while (client.state !== expectedState) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout waiting for state "${expectedState}", got "${client.state}"`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Creates a mock WebSocket for testing that properly simulates lifecycle events
 */
export function createMockWebSocket() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let readyState = 0; // CONNECTING
  const sentMessages: string[] = [];

  const mockWs = {
    get readyState() {
      return readyState;
    },
    protocol: "",
    onopen: null as ((event: unknown) => void) | null,
    onmessage: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onclose: null as ((event: unknown) => void) | null,

    send(data: string) {
      if (readyState !== 1) {
        throw new Error("WebSocket is not open");
      }
      sentMessages.push(data);
    },

    addEventListener(event: string, handler: (event: unknown) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    },

    removeEventListener(event: string, handler: (event: unknown) => void) {
      listeners.get(event)?.delete(handler);
    },

    close(code = 1000, reason = "") {
      if (readyState === 2 || readyState === 3) return; // Already closing/closed
      readyState = 2; // CLOSING

      // Trigger close event
      setTimeout(() => {
        readyState = 3; // CLOSED
        trigger("close", { code, reason, wasClean: true });
      }, 0);
    },

    // Test helpers
    _trigger: {
      open() {
        readyState = 1; // OPEN
        trigger("open");
      },
      message(data: unknown) {
        trigger("message", { data: JSON.stringify(data) });
      },
      error() {
        trigger("error", new Error("WebSocket error"));
      },
    },

    _getSentMessages() {
      return sentMessages.map((msg) => JSON.parse(msg));
    },

    _clearSentMessages() {
      sentMessages.length = 0;
    },
  };

  function trigger(event: string, eventData?: unknown) {
    // Trigger direct handler (onopen, onmessage, etc.)
    const directHandler = mockWs[`on${event}` as keyof typeof mockWs] as
      | ((event: unknown) => void)
      | null;
    if (directHandler) {
      directHandler(eventData);
    }

    // Trigger event listeners
    const handlers = listeners.get(event);
    if (handlers) {
      for (const handler of Array.from(handlers)) {
        handler(eventData);
      }
    }
  }

  return mockWs;
}
