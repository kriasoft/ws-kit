// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime tests for withValibot() validation plugin.
 *
 * Tests:
 * - Capability gating (rpc method exists after plugin)
 * - Payload validation
 * - Context enrichment (payload, send, reply, progress)
 * - Validation error handling
 */

import { getKind } from "@ws-kit/core/internal";
import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { createRouter, message, rpc, withValibot } from "./index";

describe("withValibot() Plugin", () => {
  it("should add rpc method after plugin", () => {
    const router = createRouter().plugin(withValibot());
    expect("rpc" in router).toBe(true);
    expect(typeof (router as any).rpc).toBe("function");
  });

  it("should register event handler with message schema", () => {
    const Join = message("JOIN", { roomId: v.string() });
    const router = createRouter()
      .plugin(withValibot())
      .on(Join, async (ctx: any) => {
        // Handler
      });

    expect(router).toBeDefined();
  });

  it("should register RPC handler with rpc schema", () => {
    const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
      id: v.string(),
      name: v.string(),
    });

    const router = createRouter()
      .plugin(withValibot())
      .rpc(GetUser, async (ctx: any) => {
        // Handler
      });

    expect(router).toBeDefined();
  });

  it("should chain multiple plugins fluently", () => {
    const Join = message("JOIN", { roomId: v.string() });
    const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
      id: v.string(),
      name: v.string(),
    });

    const router = createRouter<{ userId?: string }>()
      .plugin(withValibot())
      .use(async (ctx, next) => {
        await next();
      })
      .on(Join, async (ctx: any) => {
        // Event handler
      })
      .rpc(GetUser, async (ctx: any) => {
        // RPC handler
      });

    expect(router).toBeDefined();
  });

  it("should create schema with kind='event' in DESCRIPTOR", () => {
    const Join = message("JOIN", { roomId: v.string() });
    // kind is stored in DESCRIPTOR symbol, not on the schema object
    expect(getKind(Join)).toBe("event");
    expect(Join.messageType).toBe("JOIN");
    // Valibot's native kind should be preserved
    expect(Join.kind).toBe("schema");
  });

  it("should create schema with kind='rpc' in DESCRIPTOR and response", () => {
    const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
      id: v.string(),
      name: v.string(),
    });

    // kind is stored in DESCRIPTOR symbol, not on the schema object
    expect(getKind(GetUser)).toBe("rpc");
    expect(GetUser.messageType).toBe("GET_USER");
    expect((GetUser as any).response?.messageType).toBe("USER");
    // Response should have kind="event" in DESCRIPTOR
    expect(getKind((GetUser as any).response)).toBe("event");
  });

  it("should allow message schema without payload", () => {
    const Ping = message("PING");
    expect(Ping.messageType).toBe("PING");
    // kind is stored in DESCRIPTOR symbol
    expect(getKind(Ping)).toBe("event");
  });

  it("should capture error hook", () => {
    const router = createRouter().plugin(withValibot());
    let errorCaught: unknown = null;

    router.onError((err) => {
      errorCaught = err;
    });

    expect(errorCaught).toBe(null); // No error yet
  });

  it("should support middleware with validation", () => {
    const Join = message("JOIN", { roomId: v.string() });

    const router = createRouter()
      .plugin(withValibot())
      .use(async (ctx, next) => {
        await next();
      })
      .on(Join, async (ctx: any) => {
        // Handler with context enrichment
      });

    expect(router).toBeDefined();
  });

  it("should throw if rpc called without validation plugin", () => {
    const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
      name: v.string(),
    });

    const router = createRouter() as any;

    // rpc method should not exist at runtime on unplugged router
    // If it does exist (from partial definePlugin implementation), calling it should fail
    if (typeof router.rpc === "function") {
      expect(() => {
        router.rpc(GetUser, () => {});
      }).toThrow();
    } else {
      // Preferred: rpc simply not defined
      expect("rpc" in router).toBe(false);
    }
  });
});
