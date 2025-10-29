// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import {
  federate,
  federateWithErrors,
  federateWithFilter,
} from "../src/federate.js";

describe("federate", () => {
  it("should execute action for each shard", async () => {
    const results: string[] = [];

    const mockNamespace = {
      get: (id: string) => ({
        fetch: async () => {
          results.push(id);
          return new Response("ok");
        },
      }),
    } as any;

    const shardIds = ["shard1", "shard2", "shard3"];
    const settled = await federate(mockNamespace, shardIds, async (shard) => {
      await shard.fetch(new Request("https://internal"));
    });

    expect(results).toEqual(shardIds);
    expect(settled).toHaveLength(3);
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("should handle errors with allSettled", async () => {
    const mockNamespace = {
      get: (id: string) => ({
        fetch: async () => {
          if (id === "shard2") throw new Error("Failed");
          return new Response("ok");
        },
      }),
    } as any;

    const shardIds = ["shard1", "shard2", "shard3"];
    const settled = await federate(mockNamespace, shardIds, async (shard) => {
      await shard.fetch(new Request("https://internal"));
    });

    expect(settled).toHaveLength(3);
    expect(settled[0].status).toBe("fulfilled");
    expect(settled[1].status).toBe("rejected");
    expect(settled[2].status).toBe("fulfilled");
  });

  it("should work with empty shard list", async () => {
    const mockNamespace = { get: () => ({}) } as any;

    const settled = await federate(mockNamespace, [], async () => {});

    expect(settled).toHaveLength(0);
  });
});

describe("federateWithErrors", () => {
  it("should return detailed error information", async () => {
    const mockNamespace = {
      get: (id: string) => ({
        fetch: async () => {
          if (id === "shard2") throw new Error("Network error");
          return { status: 200 };
        },
      }),
    } as any;

    const shardIds = ["shard1", "shard2", "shard3"];
    const results = await federateWithErrors(
      mockNamespace,
      shardIds,
      async (shard) => {
        return await shard.fetch(new Request("https://internal"));
      },
    );

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    if (results[1].status === "rejected") {
      expect(results[1].reason).toBeInstanceOf(Error);
    }
    expect(results[2].status).toBe("fulfilled");
  });
});

describe("federateWithFilter", () => {
  it("should only execute for matching shard IDs", async () => {
    const executed: string[] = [];

    const mockNamespace = {
      get: (id: string) => ({
        fetch: async () => {
          executed.push(id);
          return new Response("ok");
        },
      }),
    } as any;

    const shardIds = ["us:shard1", "eu:shard2", "us:shard3", "ap:shard4"];

    await federateWithFilter(
      mockNamespace,
      shardIds,
      (id) => id.startsWith("us:"),
      async (shard) => {
        await shard.fetch(new Request("https://internal"));
      },
    );

    expect(executed).toEqual(["us:shard1", "us:shard3"]);
  });

  it("should handle empty filter results", async () => {
    const mockNamespace = {
      get: () => ({ fetch: async () => new Response("ok") }),
    } as any;

    const shardIds = ["eu:shard1", "eu:shard2"];

    // Should not throw
    await federateWithFilter(
      mockNamespace,
      shardIds,
      (id) => id.startsWith("us:"),
      async () => {},
    );
  });
});
