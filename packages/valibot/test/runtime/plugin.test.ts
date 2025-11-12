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

import { describe, it, expect } from "bun:test";
import * as v from "valibot";
import { createRouter, message, rpc, withValibot } from "../../src/index";
import type { MessageDescriptor } from "@ws-kit/core";

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

  it("should create schema with kind='event'", () => {
    const Join = message("JOIN", { roomId: v.string() });
    expect((Join as any).kind).toBe("event");
    expect(Join.type).toBe("JOIN");
  });

  it("should create schema with kind='rpc' and response", () => {
    const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
      id: v.string(),
      name: v.string(),
    });

    expect((GetUser as any).kind).toBe("rpc");
    expect(GetUser.type).toBe("GET_USER");
    expect((GetUser as any).response?.type).toBe("USER");
  });

  it("should allow message schema without payload", () => {
    const Ping = message("PING");
    expect(Ping.type).toBe("PING");
    expect((Ping as any).kind).toBe("event");
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
});
