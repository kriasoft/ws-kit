// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import { DESCRIPTOR } from "../schema/metadata";
import { RouteTable } from "./route-table";
import type { RouteEntry } from "./types";

// Test connection data type
type TestContext = Record<string, unknown>;

// Helper to create test message descriptors with DESCRIPTOR symbol
function createMessageDescriptor(type: string): MessageDescriptor {
  const obj: MessageDescriptor = { type };
  Object.defineProperty(obj, DESCRIPTOR, {
    value: { type, kind: "event" },
    enumerable: false,
  });
  return obj;
}

// Helper to create descriptors with DESCRIPTOR symbol for RPC/event tests
function createDescWithKind(
  type: string,
  kind: "event" | "rpc",
  response?: MessageDescriptor,
): MessageDescriptor {
  const obj: MessageDescriptor = { type };
  if (response) (obj as any).response = response;
  Object.defineProperty(obj, DESCRIPTOR, {
    value: { type, kind },
    enumerable: false,
  });
  return obj;
}

// Helper to create test route entries
function createRouteEntry(): RouteEntry<TestContext> {
  return {
    schema: createMessageDescriptor("TEST"),
    middlewares: [],
    handler: async () => {},
  };
}

describe("RouteTable", () => {
  describe("register()", () => {
    it("should register a handler and return this for chaining", () => {
      const table = new RouteTable<TestContext>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      const result = table.register(schema, entry);

      expect(result).toBe(table);
      expect(table.has("PING")).toBe(true);
    });

    it("should throw on duplicate registration", () => {
      const table = new RouteTable<TestContext>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      table.register(schema, entry);

      expect(() => table.register(schema, entry)).toThrow(
        `Handler already registered for type "PING". Use merge() with onConflict if needed.`,
      );
    });

    it("should validate that schema.type is a non-empty string", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Test empty string
      expect(() => table.register(createMessageDescriptor(""), entry)).toThrow(
        /Invalid schema/,
      );

      // Test missing type
      const badSchema = {} as MessageDescriptor;
      expect(() => table.register(badSchema, entry)).toThrow(/Invalid schema/);

      // Test null type
      const nullSchema: any = { type: null };
      expect(() => table.register(nullSchema, entry)).toThrow(/Invalid schema/);
    });

    it("should reject unknown kind values (e.g., 'Rpc', 'rPc')", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Case-sensitive kind check - invalid kind in DESCRIPTOR
      const invalidKind: any = { type: "REQUEST" };
      Object.defineProperty(invalidKind, DESCRIPTOR, {
        value: { type: "REQUEST", kind: "Rpc" }, // Wrong case
        enumerable: false,
      });
      expect(() => table.register(invalidKind, entry)).toThrow(
        /Invalid schema for type "REQUEST"/,
      );
    });

    it("should enforce RPC invariant: RPC must have response descriptor", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // RPC without response should throw
      const rpcSchema = createDescWithKind("REQUEST", "rpc");
      expect(() => table.register(rpcSchema, entry)).toThrow(
        'RPC schema for type "REQUEST" must have a response descriptor.',
      );
    });

    it("should reject RPC with invalid response descriptor (non-descriptor value)", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // RPC with response: true (not a descriptor)
      const rpcSchema = createDescWithKind("REQUEST", "rpc");
      (rpcSchema as any).response = true;
      expect(() => table.register(rpcSchema, entry)).toThrow(
        /RPC schema for type "REQUEST" has invalid response descriptor/,
      );
    });

    it("should reject RPC with response missing DESCRIPTOR symbol", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Response missing DESCRIPTOR symbol
      const rpcSchema = createDescWithKind("REQUEST", "rpc");
      (rpcSchema as any).response = { type: "RESPONSE" }; // No DESCRIPTOR
      expect(() => table.register(rpcSchema, entry)).toThrow(
        /RPC schema for type "REQUEST" has invalid response descriptor/,
      );
    });

    it("should reject RPC with response having invalid field types", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Response with invalid version type
      const responseSchema = createDescWithKind("RESPONSE", "event");
      (responseSchema as any).version = "bad";
      const rpcSchema = createDescWithKind("REQUEST", "rpc", responseSchema);
      expect(() => table.register(rpcSchema, entry)).toThrow(
        /RPC schema for type "REQUEST" has invalid response descriptor/,
      );
    });

    it("should reject RPC with response having empty type", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Response with empty type string - create manually
      const responseSchema: any = { type: "" };
      Object.defineProperty(responseSchema, DESCRIPTOR, {
        value: { type: "", kind: "event" },
        enumerable: false,
      });
      const rpcSchema = createDescWithKind("REQUEST", "rpc", responseSchema);
      expect(() => table.register(rpcSchema, entry)).toThrow(
        /RPC schema for type "REQUEST" has invalid response descriptor/,
      );
    });

    it("should enforce event invariant: event must not have response descriptor", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Event with response should throw
      const responseSchema = createDescWithKind("RESPONSE", "event");
      const eventSchema = createDescWithKind("EVENT", "event", responseSchema);
      expect(() => table.register(eventSchema, entry)).toThrow(
        'Event schema for type "EVENT" must not have a response descriptor.',
      );
    });

    it("should accept valid RPC with response descriptor", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Valid RPC with response (using DESCRIPTOR symbol)
      const responseSchema = createDescWithKind("RESPONSE", "event");
      const rpcSchema = createDescWithKind("REQUEST", "rpc", responseSchema);
      expect(() => table.register(rpcSchema, entry)).not.toThrow();
      expect(table.has("REQUEST")).toBe(true);
    });

    it("should accept valid event without response descriptor", () => {
      const table = new RouteTable<TestContext>();
      const entry = createRouteEntry();

      // Valid event without response (using DESCRIPTOR symbol)
      const eventSchema = createDescWithKind("NOTIFY", "event");
      expect(() => table.register(eventSchema, entry)).not.toThrow();
      expect(table.has("NOTIFY")).toBe(true);
    });
  });

  describe("get()", () => {
    it("should retrieve a registered handler", () => {
      const table = new RouteTable<TestContext>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      table.register(schema, entry);
      const retrieved = table.get("PING");

      expect(retrieved).toBe(entry);
    });

    it("should return undefined for unregistered types", () => {
      const table = new RouteTable<TestContext>();

      expect(table.get("NONEXISTENT")).toBeUndefined();
    });
  });

  describe("has()", () => {
    it("should check if a handler exists", () => {
      const table = new RouteTable<TestContext>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      expect(table.has("PING")).toBe(false);
      table.register(schema, entry);
      expect(table.has("PING")).toBe(true);
    });
  });

  describe("size()", () => {
    it("should return the number of registered handlers", () => {
      const table = new RouteTable<TestContext>();

      expect(table.size()).toBe(0);

      table.register(createMessageDescriptor("PING"), createRouteEntry());
      expect(table.size()).toBe(1);

      table.register(createMessageDescriptor("PONG"), createRouteEntry());
      expect(table.size()).toBe(2);
    });
  });

  describe("list()", () => {
    it("should return all registered entries", () => {
      const table = new RouteTable<TestContext>();
      const pingEntry = createRouteEntry();
      const pongEntry = createRouteEntry();

      table.register(createMessageDescriptor("PING"), pingEntry);
      table.register(createMessageDescriptor("PONG"), pongEntry);

      const entries = table.list();

      expect(entries).toHaveLength(2);
      expect(entries[0]![0]).toBe("PING");
      expect(entries[0]![1]).toBe(pingEntry);
      expect(entries[1]![0]).toBe("PONG");
      expect(entries[1]![1]).toBe(pongEntry);
    });
  });

  describe("merge()", () => {
    it("should merge handlers from another table and return this for chaining", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      source.register(createMessageDescriptor("PING"), createRouteEntry());
      source.register(createMessageDescriptor("PONG"), createRouteEntry());

      const result = target.merge(source);

      expect(result).toBe(target);
      expect(target.size()).toBe(2);
      expect(target.has("PING")).toBe(true);
      expect(target.has("PONG")).toBe(true);
    });

    it("should throw on conflict with error policy (default)", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      const entry1 = createRouteEntry();
      const entry2 = { ...createRouteEntry() };

      source.register(createMessageDescriptor("PING"), entry1);
      target.register(createMessageDescriptor("PING"), entry2);

      expect(() => target.merge(source)).toThrow(
        `merge() conflict: handler for type "PING" already exists (policy: "error").`,
      );
    });

    it("should skip existing handler with skip policy", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      const originalEntry = createRouteEntry();
      const incomingEntry = { ...createRouteEntry() };

      source.register(createMessageDescriptor("PING"), incomingEntry);
      target.register(createMessageDescriptor("PING"), originalEntry);

      target.merge(source, { onConflict: "skip" });

      expect(target.get("PING")).toBe(originalEntry);
    });

    it("should replace existing handler with replace policy", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      const originalEntry = createRouteEntry();
      const incomingEntry = { ...createRouteEntry() };

      source.register(createMessageDescriptor("PING"), incomingEntry);
      target.register(createMessageDescriptor("PING"), originalEntry);

      target.merge(source, { onConflict: "replace" });

      expect(target.get("PING")).toBe(incomingEntry);
    });

    it("should support method chaining", () => {
      const table1 = new RouteTable<TestContext>();
      const table2 = new RouteTable<TestContext>();
      const table3 = new RouteTable<TestContext>();

      table1.register(createMessageDescriptor("MSG1"), createRouteEntry());
      table2.register(createMessageDescriptor("MSG2"), createRouteEntry());
      table3.register(createMessageDescriptor("MSG3"), createRouteEntry());

      const result = table1.merge(table2).merge(table3);

      expect(result).toBe(table1);
      expect(table1.size()).toBe(3);
    });
  });

  describe("mount()", () => {
    it("should prefix all message types and return this for chaining", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      source.register(createMessageDescriptor("LOGIN"), createRouteEntry());
      source.register(createMessageDescriptor("LOGOUT"), createRouteEntry());

      const result = target.mount("auth.", source);

      expect(result).toBe(target);
      expect(target.size()).toBe(2);
      expect(target.has("auth.LOGIN")).toBe(true);
      expect(target.has("auth.LOGOUT")).toBe(true);
    });

    it("should update schema.type in mounted entries", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      const sourceEntry = {
        schema: createMessageDescriptor("LOGIN"),
        middlewares: [],
        handler: async () => {},
      };

      source.register(sourceEntry.schema, sourceEntry);
      target.mount("auth.", source);

      const mounted = target.get("auth.LOGIN");
      expect(mounted).toBeDefined();
      expect(mounted!.schema.type).toBe("auth.LOGIN");
    });

    it("should preserve other schema fields when mounting", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      const sourceSchema: MessageDescriptor & Record<string, unknown> = {
        type: "LOGIN",
        version: 1,
        custom: "value",
      };
      Object.defineProperty(sourceSchema, DESCRIPTOR, {
        value: { type: "LOGIN", kind: "event" },
        enumerable: false,
      });

      const sourceEntry = {
        schema: sourceSchema,
        middlewares: [],
        handler: async () => {},
      };

      source.register(sourceEntry.schema, sourceEntry);
      target.mount("auth.", source);

      const mounted = target.get("auth.LOGIN");
      expect(mounted).toBeDefined();
      expect(mounted!.schema.version).toBe(1);
      expect((mounted!.schema as any).custom).toBe("value");
    });

    it("should throw on conflict with error policy (default)", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      source.register(createMessageDescriptor("LOGIN"), createRouteEntry());
      target.register(
        createMessageDescriptor("auth.LOGIN"),
        createRouteEntry(),
      );

      expect(() => target.mount("auth.", source)).toThrow(
        `mount("auth.") conflict: handler for type "auth.LOGIN" already exists (policy: "error").`,
      );
    });

    it("should skip existing handler with skip policy", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      const originalEntry = createRouteEntry();

      source.register(createMessageDescriptor("LOGIN"), createRouteEntry());
      target.register(createMessageDescriptor("auth.LOGIN"), originalEntry);

      target.mount("auth.", source, { onConflict: "skip" });

      expect(target.get("auth.LOGIN")).toBe(originalEntry);
    });

    it("should replace existing handler with replace policy", () => {
      const source = new RouteTable<TestContext>();
      const target = new RouteTable<TestContext>();

      const incomingEntry = {
        schema: createMessageDescriptor("LOGIN"),
        middlewares: [],
        handler: async () => {},
      };

      source.register(incomingEntry.schema, incomingEntry);
      target.register(
        createMessageDescriptor("auth.LOGIN"),
        createRouteEntry(),
      );

      target.mount("auth.", source, { onConflict: "replace" });

      const mounted = target.get("auth.LOGIN");
      expect(mounted).toBeDefined();
      expect(mounted!.schema.type).toBe("auth.LOGIN");
    });

    it("should support method chaining", () => {
      const main = new RouteTable<TestContext>();
      const auth = new RouteTable<TestContext>();
      const chat = new RouteTable<TestContext>();

      auth.register(createMessageDescriptor("LOGIN"), createRouteEntry());
      chat.register(createMessageDescriptor("SEND"), createRouteEntry());

      const result = main.mount("auth.", auth).mount("chat.", chat);

      expect(result).toBe(main);
      expect(main.size()).toBe(2);
      expect(main.has("auth.LOGIN")).toBe(true);
      expect(main.has("chat.SEND")).toBe(true);
    });
  });
});
