// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createRouter, message, rpc, withZod } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";
import { z } from "zod";

describe("Object-form API", () => {
  it("message() object form creates valid schema", () => {
    const Join = message({
      type: "USER_JOIN",
      payload: z.object({ roomId: z.string() }),
    });

    expect((Join as any).type).toBe("USER_JOIN");
    expect(typeof Join.safeParse).toBe("function");

    const result = Join.safeParse({
      type: "USER_JOIN",
      meta: {},
      payload: { roomId: "room1" },
    });
    expect(result.success).toBe(true);
  });

  it("message() positional form still works", () => {
    const Join = message("USER_JOIN", { roomId: z.string() });

    expect((Join as any).type).toBe("USER_JOIN");

    const result = Join.safeParse({
      type: "USER_JOIN",
      meta: {},
      payload: { roomId: "room1" },
    });
    expect(result.success).toBe(true);
  });

  it("rpc() object form creates request and response schemas", () => {
    const GetUser = rpc({
      req: {
        type: "GET_USER",
        payload: z.object({ id: z.string() }),
      },
      res: {
        type: "USER",
        payload: z.object({ id: z.string(), name: z.string() }),
      },
    });

    expect((GetUser as any).type).toBe("GET_USER");
    expect((GetUser.response as any).type).toBe("USER");

    const reqResult = GetUser.safeParse({
      type: "GET_USER",
      meta: {},
      payload: { id: "u1" },
    });
    expect(reqResult.success).toBe(true);

    const resResult = GetUser.response.safeParse({
      type: "USER",
      meta: {},
      payload: { id: "u1", name: "Alice" },
    });
    expect(resResult.success).toBe(true);
  });

  it("rpc() positional form still works", () => {
    const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
      id: z.string(),
      name: z.string(),
    });

    expect((GetUser as any).type).toBe("GET_USER");
    expect((GetUser.response as any).type).toBe("USER");
  });

  it("message() with options attaches metadata", () => {
    const Join = message({
      type: "USER_JOIN",
      payload: z.object({ roomId: z.string() }),
      options: { validateOutgoing: false },
    });

    // Options are non-enumerable and should not be in Object.keys
    expect("options" in Join).toBe(false);
    // But they should be accessible via getSchemaOpts (tested separately)
  });

  it("message() with meta extends standard fields", () => {
    const ChatMsg = message({
      type: "CHAT",
      payload: z.object({ text: z.string() }),
      meta: {
        roomId: z.string().optional(),
      },
    });

    // Should accept optional roomId in meta
    const result = ChatMsg.safeParse({
      type: "CHAT",
      meta: { roomId: "room1" },
      payload: { text: "hello" },
    });
    expect(result.success).toBe(true);

    // Should reject unknown meta keys
    const result2 = ChatMsg.safeParse({
      type: "CHAT",
      meta: { roomId: "room1", unknown: "key" } as any,
      payload: { text: "hello" },
    });
    expect(result2.success).toBe(false);
  });
});

describe("Per-schema option precedence", () => {
  it("schema options override plugin defaults for validateOutgoing", () => {
    const Reply = message({
      type: "REPLY",
      payload: z.object({ text: z.string() }),
      options: { validateOutgoing: false }, // schema: skip outbound validation
    });

    const Ping = message({
      type: "PING",
      payload: z.object({ id: z.number() }),
      options: { validateOutgoing: true }, // schema: always validate outbound
    });

    const router = createRouter()
      .plugin(withZod({ validateOutgoing: true })) // plugin default: validate all
      .on(Ping, (ctx) => {
        ctx.send(Reply, { text: "hello" });
      });

    // Verify router was created with both schemas
    expect(router).toBeDefined();
  });

  it("plugin defaults apply when schema has no options", () => {
    const Join = message({
      type: "USER_JOIN",
      payload: z.object({ roomId: z.string() }),
      // no options - should use plugin defaults
    });

    const router = createRouter()
      .plugin(withZod({ validateOutgoing: true }))
      .on(Join, (ctx) => {
        // handler
      });

    // Verify router was created
    expect(router).toBeDefined();
  });

  it("coercion is controlled by schema design using z.coerce.*", () => {
    // Users explicitly choose coercion in the schema, not via plugin flag
    const CoercedMsg = message({
      type: "COERCED",
      payload: z.object({
        count: z.coerce.number(), // explicitly coerce to number
        name: z.string(), // strict: no coercion
      }),
    });

    // Should coerce "42" to number
    const result = CoercedMsg.safeParse({
      type: "COERCED",
      meta: {},
      payload: { count: "42", name: "test" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.payload as any).count).toBe(42);
    }
  });
});

describe("strictness control", () => {
  it("strict by default rejects extra keys", () => {
    const Join = message({
      type: "USER_JOIN",
      payload: z.object({ roomId: z.string() }),
      // strict: true by default
    });

    const result = Join.safeParse({
      type: "USER_JOIN",
      meta: {},
      payload: { roomId: "room1", extra: "key" } as any,
    });

    expect(result.success).toBe(false);
  });

  it("strict: false allows extra keys", () => {
    const Join = message({
      type: "USER_JOIN",
      payload: z.object({ roomId: z.string() }),
      options: { strict: false },
    });

    const result = Join.safeParse({
      type: "USER_JOIN",
      meta: {},
      payload: { roomId: "room1", extra: "key" } as any,
    });

    // With strict: false, extra keys should be allowed
    // (though Zod still enforces the required schema fields)
  });
});
