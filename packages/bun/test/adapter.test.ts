// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { bunPubSub } from "../src/adapter.js";

describe("bunPubSub", () => {
  it("should return a PubSubAdapter instance", () => {
    const mockServer = {
      publish: () => {},
    } as any;

    const adapter = bunPubSub(mockServer);
    expect(adapter).toBeDefined();
    expect(typeof adapter.publish).toBe("function");
  });

  it("should create different adapter instances for different servers", () => {
    const server1 = { publish: () => {} } as any;
    const server2 = { publish: () => {} } as any;

    const adapter1 = bunPubSub(server1);
    const adapter2 = bunPubSub(server2);

    expect(adapter1).not.toBe(adapter2);
  });
});
