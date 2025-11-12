/**
 * Test harness exports: createTestRouter, wrapTestRouter, FakeClock, and types.
 * Usage: import { test } from "@ws-kit/core" or import * from "@ws-kit/core/testing"
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
export { FakeClock, SystemClock } from "./fake-clock";
export type { Clock } from "./fake-clock";

// Type exports
export type {
  TestRouter,
  TestConnection,
  TestCapture,
  OutgoingFrame,
  PublishRecord,
} from "./types";

// Act helpers (optional convenience)
export { act } from "./act";

// Internal exports (for advanced use)
export { TestWebSocket, type ConnectionState } from "./test-websocket";
export { InMemoryPlatformAdapter } from "./test-adapter";

// Namespace re-export for convenience
import * as testHarness from "./test-harness";
import * as fakeClock from "./fake-clock";
import * as actModule from "./act";

export const testing = {
  createTestRouter: testHarness.createTestRouter,
  wrapTestRouter: testHarness.wrapTestRouter,
  FakeClock: fakeClock.FakeClock,
  SystemClock: fakeClock.SystemClock,
  act: actModule.act,
};

// Backward compatibility alias (prefer 'testing' over 'test')
export const test = testing;
