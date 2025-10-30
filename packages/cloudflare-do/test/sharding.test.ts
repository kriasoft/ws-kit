// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import {
  scopeToDoName,
  getShardedDoId,
  getShardedStub,
} from "../src/sharding.js";

describe("scopeToDoName", () => {
  it("should compute consistent hash for same scope", () => {
    const result1 = scopeToDoName("room:general", 10);
    const result2 = scopeToDoName("room:general", 10);
    expect(result1).toBe(result2);
  });

  it("should use default prefix", () => {
    const result = scopeToDoName("room:general", 10);
    expect(result).toMatch(/^ws-router-\d+$/);
  });

  it("should use custom prefix", () => {
    const result = scopeToDoName("room:general", 10, "custom");
    expect(result).toMatch(/^custom-\d+$/);
  });

  it("should distribute across shard range", () => {
    const shards = 10;
    const result = scopeToDoName("room:general", shards);
    // Format is "ws-router-X", get the last part
    const num = result.split("-").pop();
    const shardNum = parseInt(num!, 10);
    expect(shardNum).toBeGreaterThanOrEqual(0);
    expect(shardNum).toBeLessThan(shards);
  });

  it("should return different shards for different scopes", () => {
    const scopes = [
      "room:general",
      "room:random",
      "room:gaming",
      "room:support",
    ];
    const shardNames = scopes.map((s) => scopeToDoName(s, 10));
    // Not all should be the same (statistically very unlikely)
    const unique = new Set(shardNames);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("should respect shard count", () => {
    const result5 = scopeToDoName("scope", 5);
    const result10 = scopeToDoName("scope", 10);
    const result20 = scopeToDoName("scope", 20);

    // Extract shard numbers
    const num5 = parseInt(result5.split("-").pop()!, 10);
    const num10 = parseInt(result10.split("-").pop()!, 10);
    const num20 = parseInt(result20.split("-").pop()!, 10);

    expect(num5).toBeLessThan(5);
    expect(num10).toBeLessThan(10);
    expect(num20).toBeLessThan(20);
  });

  it("should handle empty scope", () => {
    const result = scopeToDoName("", 10);
    expect(result).toMatch(/^ws-router-\d+$/);
  });

  it("should handle special characters in scope", () => {
    const result = scopeToDoName("room:special-!@#$%", 10);
    expect(result).toMatch(/^ws-router-\d+$/);
  });

  it("should handle single shard", () => {
    const result = scopeToDoName("any-scope", 1);
    expect(result).toBe("ws-router-0");
  });

  it("should show distribution across multiple scopes", () => {
    // Test rough distribution across shards
    const shardCounts = new Map<number, number>();
    const shards = 10;

    for (let i = 0; i < 100; i++) {
      const scope = `room:${i}`;
      const name = scopeToDoName(scope, shards);
      const shardNum = parseInt(name.split("-").pop()!, 10);
      shardCounts.set(shardNum, (shardCounts.get(shardNum) ?? 0) + 1);
    }

    // All shards should be used (or nearly all for 100 items across 10 shards)
    expect(shardCounts.size).toBeGreaterThan(5);
    // No single shard should get all items
    const maxCount = Math.max(...Array.from(shardCounts.values()));
    expect(maxCount).toBeLessThan(100);
  });
});

describe("getShardedDoId", () => {
  it("should call idFromName with shard name", () => {
    let capturedName = "";
    const mockEnv = {
      ROUTER: {
        idFromName: (name: string) => {
          capturedName = name;
          return `id-${name}`;
        },
        get: () => ({}),
      },
    };

    const result = getShardedDoId(mockEnv, "room:general", 10);

    expect(capturedName).toMatch(/^ws-router-\d+$/);
    expect(result).toMatch(/^id-ws-router-\d+$/);
  });

  it("should use custom prefix", () => {
    let capturedName = "";
    const mockEnv = {
      ROUTER: {
        idFromName: (name: string) => {
          capturedName = name;
          return `id-${name}`;
        },
        get: () => ({}),
      },
    };

    getShardedDoId(mockEnv, "scope", 10, "custom");

    expect(capturedName).toMatch(/^custom-\d+$/);
  });

  it("should return stable IDs for same scope", () => {
    const mockEnv = {
      ROUTER: {
        idFromName: (name: string) => `id-${name}`,
        get: () => ({}),
      },
    };

    const id1 = getShardedDoId(mockEnv, "room:general", 10);
    const id2 = getShardedDoId(mockEnv, "room:general", 10);

    expect(id1).toBe(id2);
  });
});

describe("getShardedStub", () => {
  it("should call get with sharded DO ID", () => {
    let capturedId = "";
    const mockStub = { fetch: async () => new Response() };
    const mockEnv = {
      ROUTER: {
        idFromName: (name: string) => `id-${name}`,
        get: (id: string) => {
          capturedId = id;
          return mockStub;
        },
      },
    };

    const stub = getShardedStub(mockEnv, "room:general", 10);

    expect(capturedId).toMatch(/^id-ws-router-\d+$/);
    expect(stub).toBe(mockStub);
  });

  it("should return stub for fetching", () => {
    const expectedStub = { fetch: async () => new Response("ok") };
    const mockEnv = {
      ROUTER: {
        idFromName: () => "test-id",
        get: () => expectedStub,
      },
    };

    const stub = getShardedStub(mockEnv, "room:general", 10);

    expect(stub.fetch).toBeDefined();
    expect(stub).toBe(expectedStub);
  });

  it("should route consistent scopes to same stub", () => {
    const stubCache = new Map();
    const mockEnv = {
      ROUTER: {
        idFromName: (name: string) => `id-${name}`,
        get: (id: string) => {
          if (!stubCache.has(id)) {
            stubCache.set(id, { id, fetch: async () => new Response() });
          }
          return stubCache.get(id);
        },
      },
    };

    const stub1 = getShardedStub(mockEnv, "room:general", 10);
    const stub2 = getShardedStub(mockEnv, "room:general", 10);

    expect(stub1.id).toBe(stub2.id);
    expect(stub1).toBe(stub2);
  });

  it("should use custom prefix", () => {
    let capturedId = "";
    const mockEnv = {
      ROUTER: {
        idFromName: (name: string) => `id-${name}`,
        get: (id: string) => {
          capturedId = id;
          return { fetch: async () => new Response() };
        },
      },
    };

    getShardedStub(mockEnv, "scope", 10, "custom");

    expect(capturedId).toContain("custom");
  });
});
