// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import { expectTypeOf } from "bun:test";
import type { PlatformAdapter, PubSub } from "@ws-kit/core";
import {
  createBunAdapter,
  createBunAdapterWithServer,
} from "../src/adapter.js";
import { BunPubSub } from "../src/pubsub.js";

describe("createBunAdapter", () => {
  it("should return a PlatformAdapter", () => {
    const adapter = createBunAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter).toBe("object");
  });

  it("should return adapter with undefined pubsub initially", () => {
    const adapter = createBunAdapter();
    expect(adapter.pubsub).toBeUndefined();
  });

  it("should return adapter compatible with PlatformAdapter interface", () => {
    const adapter = createBunAdapter();

    // PlatformAdapter has optional pubsub, getServerWebSocket, init, destroy
    // getServerWebSocket should be undefined
    expect(adapter.getServerWebSocket).toBeUndefined();
  });

  it("should match PlatformAdapter type", () => {
    const adapter = createBunAdapter();
    expectTypeOf(adapter).toMatchTypeOf<PlatformAdapter>();
  });
});

describe("createBunAdapterWithServer", () => {
  it("should return a PlatformAdapter with BunPubSub", () => {
    const mockServer = {
      publish: () => {},
    } as any;

    const adapter = createBunAdapterWithServer(mockServer);

    expect(adapter).toBeDefined();
    expect(adapter.pubsub).toBeDefined();
  });

  it("should create BunPubSub instance", () => {
    const mockServer = {
      publish: () => {},
    } as any;

    const adapter = createBunAdapterWithServer(mockServer);

    expect(adapter.pubsub).toBeInstanceOf(BunPubSub);
  });

  it("should match PlatformAdapter type with pubsub", () => {
    const mockServer = {
      publish: () => {},
    } as any;

    const adapter = createBunAdapterWithServer(mockServer);
    expectTypeOf(adapter).toMatchTypeOf<PlatformAdapter>();
    expectTypeOf(adapter.pubsub).toMatchTypeOf<PubSub>();
  });

  it("should create different adapter instances for different servers", () => {
    const server1 = { publish: () => {} } as any;
    const server2 = { publish: () => {} } as any;

    const adapter1 = createBunAdapterWithServer(server1);
    const adapter2 = createBunAdapterWithServer(server2);

    expect(adapter1.pubsub).not.toBe(adapter2.pubsub);
  });
});
