// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { mock } from "bun:test";

/**
 * Shared test fixtures for @ws-kit/bun package.
 * Centralizes mock creation to reduce boilerplate and improve maintainability.
 */

export interface MockWsData {
  clientId: string;
  connectedAt?: number;
  [key: string]: any;
}

/**
 * Creates a mock WebSocket with optional custom data.
 * Use this instead of creating ws mocks inline to ensure consistency.
 */
export function createMockWs(data?: Partial<MockWsData>) {
  const now = Date.now();
  const defaultData: MockWsData = {
    clientId: `ws-${Math.random().toString(36).substr(2, 9)}`,
    connectedAt: now,
    ...data,
  };

  return {
    data: defaultData,
    send: mock(() => {}),
    close: mock(() => {}),
    subscribe: mock(() => {}),
    unsubscribe: mock(() => {}),
    readyState: "OPEN" as const,
  };
}

/**
 * Creates a mock Bun server for testing handler.fetch().
 * Captures upgrade calls for inspection.
 */
export function createMockServer() {
  const upgradeCalls: any[] = [];

  return {
    upgrade: mock((req: Request, options: any) => {
      upgradeCalls.push({ req, options });
      const ws = {
        data: options.data,
        send: mock(() => {}),
        close: mock(() => {}),
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };
      return ws;
    }),
    getUpgradeCalls: () => upgradeCalls,
    getLastUpgradeOptions: () => upgradeCalls[upgradeCalls.length - 1]?.options,
  };
}

/**
 * Creates a mock router with spied lifecycle methods.
 * Useful for testing handler integration.
 */
export function createMockRouter() {
  return {
    websocket: {
      open: mock(async () => {}),
      close: mock(async () => {}),
      message: mock(async () => {}),
    },
  };
}
