/**
 * Connection data persistence test
 *
 * Verifies that ctx.setData() persists across multiple messages on the same connection.
 * This test validates the fix for the critical bug where connection data was not persisted.
 */

import { describe, it, expect } from "bun:test";
import { createRouter } from "../../src/core/createRouter";
import { createTestRouter } from "../../src/testing";
import type { Router } from "../../src/core/types";

interface TestAppData {
  userId?: string;
  messageCount?: number;
  name?: string;
}

describe("Connection data persistence", () => {
  it("should persist data across multiple messages on same connection", async () => {
    // Create a simple router for testing
    const router = createTestRouter<TestAppData>({
      create: () => createRouter<TestAppData>(),
    });

    // Create a test connection
    const conn = router.connect();

    // Simulate first message handler that sets data
    const route1Called: boolean[] = [];
    router.on({ type: "SET_USER", kind: "event" } as any, (ctx) => {
      ctx.setData({ userId: "user-123" });
      route1Called.push(true);
    });

    // Simulate second message handler that reads and updates data
    const route2Called: any[] = [];
    router.on({ type: "UPDATE_COUNT", kind: "event" } as any, (ctx) => {
      // This should have access to the previously set userId
      const currentData = ctx.data;
      route2Called.push({
        userId: currentData.userId,
        hadUserId: !!currentData.userId,
      });
      // Update count
      const count = (currentData.messageCount ?? 0) + 1;
      ctx.setData({ messageCount: count });
    });

    // Send first message to set user
    conn.send("SET_USER", {});
    await router.flush();

    // Send second message that should see the previously set userId
    conn.send("UPDATE_COUNT", {});
    await router.flush();

    // Verify the second handler saw the data from the first handler
    expect(route1Called.length).toBe(1);
    expect(route2Called.length).toBe(1);
    expect(route2Called[0].hadUserId).toBe(true);
    expect(route2Called[0].userId).toBe("user-123");

    // Send third message and verify count persists
    const route3Called: any[] = [];
    router.on({ type: "GET_COUNT", kind: "event" } as any, (ctx) => {
      route3Called.push({
        count: ctx.data.messageCount,
        userId: ctx.data.userId,
      });
    });

    conn.send("GET_COUNT", {});
    await router.flush();

    expect(route3Called.length).toBe(1);
    expect(route3Called[0].count).toBe(1); // Should be 1 from previous increment
    expect(route3Called[0].userId).toBe("user-123"); // Should still have userId

    await router.close();
  });

  it("should maintain separate data for different connections", async () => {
    const router = createTestRouter<TestAppData>({
      create: () => createRouter<TestAppData>(),
    });

    // Create two connections
    const conn1 = router.connect();
    const conn2 = router.connect();

    const dataLog: any[] = [];

    router.on({ type: "TEST", kind: "event" } as any, (ctx) => {
      dataLog.push({
        clientId: (ctx.ws as any).clientId,
        data: { ...ctx.data },
      });
    });

    // Connection 1: set userId A
    router.on({ type: "SET_ID", kind: "event" } as any, (ctx) => {
      ctx.setData({ userId: "user-A", name: "Alice" });
    });

    conn1.send("SET_ID", {});
    await router.flush();

    // Connection 2: set userId B
    conn2.send("SET_ID", {});
    await router.flush();

    // Now change conn2's name
    router.on({ type: "SET_NAME", kind: "event" } as any, (ctx) => {
      ctx.setData({ name: "Bob" });
    });

    conn2.send("SET_NAME", {});
    await router.flush();

    // Send TEST message on both and verify they have different data
    conn1.send("TEST", {});
    conn2.send("TEST", {});
    await router.flush();

    // Filter logs for TEST messages
    const testLogs = dataLog.filter((log) => log);

    // Should have 2 TEST message logs (one from each connection)
    expect(testLogs.length).toBe(2);

    // Verify they have different data
    const user1Data = testLogs[0].data;
    const user2Data = testLogs[1].data;

    // conn1 should still have Alice
    expect(user1Data.userId).toBe("user-A");
    expect(user1Data.name).toBe("Alice");

    // conn2 should have default userId (not set to A) and Bob
    expect(user2Data.name).toBe("Bob");

    await router.close();
  });

  it("should initialize connection data on first access", async () => {
    const router = createTestRouter<TestAppData>({
      create: () => createRouter<TestAppData>(),
    });

    const conn = router.connect();
    const dataSnapshots: any[] = [];

    router.on({ type: "CHECK", kind: "event" } as any, (ctx) => {
      dataSnapshots.push({ ...ctx.data });
    });

    // First message - data should be empty object
    conn.send("CHECK", {});
    await router.flush();

    expect(dataSnapshots[0]).toEqual({});

    // Set some data
    router.on({ type: "SET", kind: "event" } as any, (ctx) => {
      ctx.setData({ userId: "test-user" });
    });

    conn.send("SET", {});
    await router.flush();

    // Check again - should have the data
    conn.send("CHECK", {});
    await router.flush();

    expect(dataSnapshots[1]).toEqual({ userId: "test-user" });

    await router.close();
  });
});
