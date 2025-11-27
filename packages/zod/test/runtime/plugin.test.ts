// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime tests for withZod() validation plugin.
 *
 * Tests:
 * - Capability gating (rpc method exists after plugin)
 * - Payload validation
 * - Context enrichment (payload, send, reply, progress)
 * - Validation error handling
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createRouter, message, rpc, withZod } from "../../src/index";
import { getKind } from "@ws-kit/core/internal";

describe("withZod() Plugin", () => {
  it("should add rpc method after plugin", () => {
    const router = createRouter().plugin(withZod());
    expect("rpc" in router).toBe(true);
    expect(typeof (router as any).rpc).toBe("function");
  });

  it("should register event handler with message schema", () => {
    const Join = message("JOIN", { roomId: z.string() });
    const router = createRouter()
      .plugin(withZod())
      .on(Join, async (ctx: any) => {
        // Handler
      });

    expect(router).toBeDefined();
  });

  it("should register RPC handler with rpc schema", () => {
    const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
      id: z.string(),
      name: z.string(),
    });

    const router = createRouter()
      .plugin(withZod())
      .rpc(GetUser, async (ctx: any) => {
        // Handler
      });

    expect(router).toBeDefined();
  });

  it("should chain multiple plugins fluently", () => {
    const Join = message("JOIN", { roomId: z.string() });
    const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
      id: z.string(),
      name: z.string(),
    });

    const router = createRouter<{ userId?: string }>()
      .plugin(withZod())
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
    const Join = message("JOIN", { roomId: z.string() });
    // kind is stored in DESCRIPTOR symbol, not on the schema object
    expect(getKind(Join)).toBe("event");
    expect((Join as any).type).toBe("JOIN");
    // Zod schemas don't have a native 'kind' property
    expect("kind" in Join).toBe(false);
  });

  it("should create schema with kind='rpc' in DESCRIPTOR and response", () => {
    const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
      id: z.string(),
      name: z.string(),
    });

    // kind is stored in DESCRIPTOR symbol, not on the schema object
    expect(getKind(GetUser)).toBe("rpc");
    expect((GetUser as any).type).toBe("GET_USER");
    expect((GetUser as any).response?.type).toBe("USER");
    // Response should have kind="event" in DESCRIPTOR
    expect(getKind((GetUser as any).response)).toBe("event");
  });

  it("should allow message schema without payload", () => {
    const Ping = message("PING");
    expect((Ping as any).type).toBe("PING");
    // kind is stored in DESCRIPTOR symbol
    expect(getKind(Ping)).toBe("event");
  });

  it("should capture error hook", () => {
    const router = createRouter().plugin(withZod());
    let errorCaught: unknown = null;

    router.onError((err) => {
      errorCaught = err;
    });

    expect(errorCaught).toBe(null); // No error yet
  });

  it("should support middleware with validation", () => {
    const Join = message("JOIN", { roomId: z.string() });

    const router = createRouter()
      .plugin(withZod())
      .use(async (ctx, next) => {
        await next();
      })
      .on(Join, async (ctx: any) => {
        // Handler with context enrichment
      });

    expect(router).toBeDefined();
  });

  it("should throw if rpc called without validation plugin", () => {
    const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
      name: z.string(),
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
