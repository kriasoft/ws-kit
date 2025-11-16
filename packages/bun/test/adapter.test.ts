// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import { expectTypeOf } from "bun:test";
import type { PubSubAdapter } from "@ws-kit/core";
import { createBunPubSub } from "../src/adapter.js";
import { BunPubSub } from "../src/pubsub.js";

describe("createBunPubSub", () => {
  it("should return a BunPubSub instance", () => {
    const mockServer = {
      publish: () => {},
    } as any;

    const adapter = createBunPubSub(mockServer);
    expect(adapter).toBeInstanceOf(BunPubSub);
  });

  it("should implement PubSubAdapter interface", () => {
    const mockServer = {
      publish: () => {},
    } as any;

    const adapter = createBunPubSub(mockServer);

    // Check required methods
    expect(typeof adapter.publish).toBe("function");
    expect(typeof adapter.subscribe).toBe("function");
    expect(typeof adapter.unsubscribe).toBe("function");
    expect(typeof adapter.getSubscribers).toBe("function");
  });

  it("should match PubSubAdapter type", () => {
    const mockServer = {
      publish: () => {},
    } as any;

    const adapter = createBunPubSub(mockServer);
    expectTypeOf(adapter).toMatchTypeOf<PubSubAdapter>();
  });

  it("should create different adapter instances for different servers", () => {
    const server1 = { publish: () => {} } as any;
    const server2 = { publish: () => {} } as any;

    const adapter1 = createBunPubSub(server1);
    const adapter2 = createBunPubSub(server2);

    expect(adapter1).not.toBe(adapter2);
  });
});
