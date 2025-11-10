/**
 * Test harness exports: createTestRouter, wrapTestRouter, FakeClock, and types.
 * Usage: import { test } from "@ws-kit/core" or import * from "@ws-kit/core/test"
 *
 * Example:
 * ```ts
 * import { test } from "@ws-kit/core";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const tr = test.createTestRouter({ create: () => createRouter() });
 * const conn = tr.connect();
 * conn.send("PING", { text: "hello" });
 * await tr.flush();
 * expect(conn.outgoing()).toContainEqual({ type: "PONG", ... });
 * ```
 */

// Core exports
export { createTestRouter, wrapTestRouter } from "./test-harness";
export type { CreateTestRouterOptions } from "./test-harness";

// Clock exports
export { FakeClock, RealClock } from "./fake-clock";
export type { Clock } from "./fake-clock";

// Type exports
export type {
  TestRouter,
  TestConnection,
  TestCapture,
  OutboundFrame,
  PublishedFrame,
} from "./types";

// Act helpers (optional convenience)
export { act } from "./act";

// Internal exports (for advanced use)
export { MockWebSocket, type ConnectionState } from "./test-websocket";
export { MockPlatformAdapter } from "./test-adapter";
export { TestPubSub } from "./test-pubsub";
