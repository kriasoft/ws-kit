// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { BunHandlerOptions } from "@ws-kit/bun";
import { createBunHandler } from "@ws-kit/bun";
import type { ConnectionData, Router } from "@ws-kit/core";
import type { Server } from "bun";

/**
 * Test server utilities for e2e and integration tests.
 */

export interface TestServer {
  server: Server;
  url: string;
  wsUrl: string;
  close: () => void;
}

/**
 * Creates a test server with automatic port allocation.
 * Uses createBunHandler from @ws-kit/bun for proper WebSocket configuration.
 */
export function createTestServer<TContext extends ConnectionData>(
  router: Router<TContext>,
  options?: BunHandlerOptions<TContext>,
): TestServer {
  const { fetch, websocket } = createBunHandler(router, options);

  const server = Bun.serve({
    port: 0, // Auto-assign available port
    fetch,
    websocket,
  });

  const url = `http://localhost:${server.port}`;
  const wsUrl = `ws://localhost:${server.port}`;

  return {
    server,
    url,
    wsUrl,
    close: () => server.stop(true),
  };
}

/**
 * Waits for a WebSocket to open.
 */
export function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error(`WebSocket did not open within ${timeoutMs}ms`));
    }, timeoutMs);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error during connection"));
    });
  });
}

/**
 * Collects messages from a WebSocket until count reached or timeout.
 */
export function collectMessages<T = unknown>(
  ws: WebSocket,
  count: number,
  timeoutMs = 5000,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const messages: T[] = [];

    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Only received ${messages.length}/${count} messages within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      messages.push(JSON.parse(event.data as string) as T);
      if (messages.length >= count) {
        clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        resolve(messages);
      }
    };

    ws.addEventListener("message", onMessage);

    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      if (messages.length >= count) {
        resolve(messages);
      } else {
        reject(
          new Error(
            `WebSocket closed after ${messages.length}/${count} messages`,
          ),
        );
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error while collecting messages"));
    });
  });
}

/**
 * Waits for a single message matching a predicate.
 */
export function waitForMessage<T = unknown>(
  ws: WebSocket,
  predicate: (msg: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Message not received within ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as T;
      if (predicate(msg)) {
        clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        resolve(msg);
      }
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error"));
    });
  });
}
