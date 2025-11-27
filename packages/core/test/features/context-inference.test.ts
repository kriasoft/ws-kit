// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests: context inference.
 *
 * Scenarios (using tsd/expectType):
 * - ctx.type is a literal string (not union)
 * - ctx.payload is inferred from schema (after validation)
 * - Event handler ctx has send()
 * - RPC handler ctx has reply()/progress()
 * - Event handler ctx does NOT have reply()/progress()
 * - RPC handler ctx does NOT have send()
 */

import { describe } from "bun:test";

describe("context inference (types)", () => {
  // Placeholder: type-level tests
});
