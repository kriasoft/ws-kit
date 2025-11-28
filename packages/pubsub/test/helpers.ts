// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "bun";
import { mock, type Mock } from "bun:test";

export type MockWebSocket = ServerWebSocket &
  Record<string, unknown> & {
    subscribe: Mock<(topic: string) => void>;
    unsubscribe: Mock<(topic: string) => void>;
    send: Mock<() => number>;
    close: Mock<() => void>;
  };

interface MockOverrides {
  subscribe?: Mock<(topic: string) => void>;
  unsubscribe?: Mock<(topic: string) => void>;
}

// Return type matches what createTopics() expects
type CreateTopicsWsParam = Parameters<
  typeof import("../src/core/topics.js").createTopics
>[0];

export function createMockWs(
  clientId = "test-123",
  overrides?: MockOverrides,
): CreateTopicsWsParam {
  return {
    data: { clientId },
    subscribe: overrides?.subscribe ?? mock(() => {}),
    unsubscribe: overrides?.unsubscribe ?? mock(() => {}),
    send: mock(() => 0),
    close: mock(() => {}),
    readyState: 1,
  } as unknown as CreateTopicsWsParam;
}
