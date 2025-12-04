// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Cross-package namespace enforcement tests.
 *
 * Verifies that $ws: prefix is reserved for internal use
 * across validator packages.
 */

import { describe, expect, it } from "bun:test";

describe("Namespace Enforcement", () => {
  it("should reject $ws: prefix in message type", async () => {
    const { message } = await import("@ws-kit/zod");

    expect(() => {
      message({ type: "$ws:custom" });
    }).toThrow("Message type cannot start with '$ws:'");
  });

  it("should reject $ws: prefix in rpc request type", async () => {
    const { rpc } = await import("@ws-kit/zod");
    const { z } = await import("zod");

    expect(() => {
      rpc({
        req: { type: "$ws:request", payload: z.object({}) },
        res: { type: "RESPONSE", payload: z.object({}) },
      });
    }).toThrow("RPC request type cannot start with '$ws:'");
  });

  it("should reject $ws: prefix in rpc response type", async () => {
    const { rpc } = await import("@ws-kit/zod");
    const { z } = await import("zod");

    expect(() => {
      rpc({
        req: { type: "REQUEST", payload: z.object({}) },
        res: { type: "$ws:response", payload: z.object({}) },
      });
    }).toThrow("RPC response type cannot start with '$ws:'");
  });

  it("should allow non-reserved message types", async () => {
    const { message } = await import("@ws-kit/zod");

    expect(() => {
      message({ type: "NORMAL_TYPE" });
      message({ type: "ws:custom" }); // Without $, should be fine
      message({ type: "custom$type" }); // $ not at start
    }).not.toThrow();
  });
});
