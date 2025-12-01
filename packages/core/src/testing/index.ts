// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Test harness exports: createTestRouter, wrapTestRouter, FakeClock, and types.
 * Usage: import { test } from "@ws-kit/core" or import * from "@ws-kit/core/testing"
 *
 * ## Basic Usage
 *
 * ```ts
 * import { test } from "@ws-kit/core";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const tr = test.createTestRouter({ create: () => createRouter() });
 * const conn = await tr.connect();
 * conn.send("PING", { text: "hello" });
 * await tr.flush();
 * expect(conn.outgoing()).toContainEqual({ type: "PONG", ... });
 * expect(tr.capture.errors()).toHaveLength(0);
 * ```
 *
 * ## Observing Events with `router.observe()`
 *
 * The router provides a public observation API for tests and monitoring plugins
 * to tap into lifecycle events without accessing internals.
 *
 * ```ts
 * const router = createRouter();
 *
 * // Register observer for publish, error, and connection events
 * const off = router.observe({
 *   onPublish: (record) => {
 *     console.log(`Published to ${record.topic}`);
 *   },
 *   onError: (err, meta) => {
 *     console.error(`Error on ${meta?.type}:`, err.message);
 *   },
 *   onConnectionOpen: (clientId, data) => {
 *     console.log(`Client connected: ${clientId}`);
 *   },
 *   onConnectionClose: (clientId, meta) => {
 *     console.log(`Client disconnected: ${clientId}`);
 *   },
 * });
 *
 * // Later, unsubscribe
 * off();
 * ```
 *
 * ## Key Semantics
 *
 * - **Synchronous dispatch**: Callbacks fire in registration order during event
 * - **Error isolation**: If an observer throws, the error is logged and other observers still run
 * - **Re-entrancy safe**: Observers can add/remove other observers without breaking dispatch (snapshot-based)
 * - **No payload redaction**: Publish records include full payload (don't expose sensitive data in observers)
 * - **Partial observers**: Only define callbacks for events you care about
 *
 * ## Use Cases
 *
 * - **Testing**: Capture publishes/errors for assertions (automatically done by test harness)
 * - **Monitoring**: Log/collect metrics on publishes, errors, and connection churn
 * - **Debugging**: Trace message flow without modifying handler code
 * - **Integration**: Plugin into router from monitoring/telemetry libraries
 */

// Core exports
export { createTestRouter, wrapTestRouter } from "./test-harness.js";
export type { CreateTestRouterOptions } from "./test-harness.js";

// Clock exports
export { FakeClock, SystemClock } from "./fake-clock.js";
export type { Clock } from "./fake-clock.js";

// Plugin testing utilities
export { mockPlugin } from "./plugin.js";

// Type exports
export type {
  ConnectionInfo,
  OutgoingFrame,
  PublishRecord,
  TestCapture,
  TestConnection,
  TestRouter,
} from "./types.js";

// Act helpers (optional convenience)
export { act } from "./act.js";

// Test schema helpers
export { createDescriptor, createRpcDescriptor } from "./test-schemas.js";

// Internal exports (for advanced use)
export { InMemoryPlatformAdapter } from "./test-adapter.js";
export { TestWebSocket, type ConnectionState } from "./test-websocket.js";

// Namespace re-export for convenience
import * as actModule from "./act.js";
import * as fakeClock from "./fake-clock.js";
import * as pluginModule from "./plugin.js";
import * as testHarness from "./test-harness.js";

export const testing = {
  createTestRouter: testHarness.createTestRouter,
  wrapTestRouter: testHarness.wrapTestRouter,
  FakeClock: fakeClock.FakeClock,
  SystemClock: fakeClock.SystemClock,
  act: actModule.act,
  mockPlugin: pluginModule.mockPlugin,
};

// Backward compatibility alias (prefer 'testing' over 'test')
export const test = testing;
