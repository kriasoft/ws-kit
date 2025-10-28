// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type tests for @ws-kit/client/zod
 *
 * Verifies:
 * - ZodWebSocketClient type inference
 * - Handler typing with Zod schema inference
 * - Message payload/meta typing
 * - Discriminated union narrowing
 *
 * NOTE: These tests are currently skipped because they execute code that attempts
 * WebSocket connections, which fail in the test environment. These should be
 * refactored to be pure type-level assertions using expectTypeOf without executing
 * any code that tries to establish connections.
 */

import { expectTypeOf, test } from "bun:test";
import { z } from "zod";
import type {
  InferMessage,
  InferPayload,
  InferMeta,
  MessageSchemaType,
} from "../../../../zod/src/types.js";

test.skip("Zod: Type inference tests (requires mock WebSocket server)", () => {
  // Placeholder - these need to be pure type tests
  expect(true).toBe(true);
});
