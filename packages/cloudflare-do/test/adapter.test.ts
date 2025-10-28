// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import {
  createDurableObjectAdapter,
  isDurableObjectServerWebSocket,
} from "../src/adapter";
import type { PlatformAdapter, PubSub } from "@ws-kit/core";

describe("createDurableObjectAdapter", () => {
  it("should return a PlatformAdapter", () => {
    const adapter = createDurableObjectAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter).toBe("object");
  });

  it("should have pubsub property", () => {
    const adapter = createDurableObjectAdapter();
    expect(adapter.pubsub).toBeDefined();
  });

  it("pubsub should be a PubSub instance", () => {
    const adapter = createDurableObjectAdapter();
    const pubsub = adapter.pubsub;

    expect(pubsub).toBeDefined();
    expect(typeof pubsub?.publish).toBe("function");
    expect(typeof pubsub?.subscribe).toBe("function");
    expect(typeof pubsub?.unsubscribe).toBe("function");
  });

  it("should have destroy method", async () => {
    const adapter = createDurableObjectAdapter();
    expect(adapter.destroy).toBeFunction();

    // Should not throw
    await adapter.destroy?.();
  });

  it("getServerWebSocket should be undefined", () => {
    const adapter = createDurableObjectAdapter();
    expect(adapter.getServerWebSocket).toBeUndefined();
  });
});

describe("isDurableObjectServerWebSocket", () => {
  it("should return false for null/undefined", () => {
    expect(isDurableObjectServerWebSocket(null)).toBe(false);
    expect(isDurableObjectServerWebSocket(undefined)).toBe(false);
  });

  it("should return false for non-objects", () => {
    expect(isDurableObjectServerWebSocket("string")).toBe(false);
    expect(isDurableObjectServerWebSocket(123)).toBe(false);
    expect(isDurableObjectServerWebSocket(true)).toBe(false);
  });

  it("should return true for objects with WebSocket methods", () => {
    const mockWs = {
      send: () => {},
      close: () => {},
      accept: () => {},
      readyState: 1,
    };

    expect(isDurableObjectServerWebSocket(mockWs)).toBe(true);
  });

  it("should return false for objects missing required methods", () => {
    const incompleteMock = {
      send: () => {},
      close: () => {},
      // Missing accept and readyState
    };

    expect(isDurableObjectServerWebSocket(incompleteMock)).toBe(false);
  });
});
