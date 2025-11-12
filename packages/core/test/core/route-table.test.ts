// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { RouteTable } from "../../src/core/route-table";
import type { MessageDescriptor } from "../../src/protocol/message-descriptor";
import type { RouteEntry } from "../../src/core/types";

// Helper to create test message descriptors
function createMessageDescriptor(type: string): MessageDescriptor {
  return {
    type,
    kind: "event",
  };
}

// Helper to create test route entries
function createRouteEntry(): RouteEntry<unknown> {
  return {
    schema: createMessageDescriptor("TEST"),
    middlewares: [],
    handler: async () => {},
  };
}

describe("RouteTable", () => {
  describe("register()", () => {
    it("should register a handler and return this for chaining", () => {
      const table = new RouteTable<unknown>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      const result = table.register(schema, entry);

      expect(result).toBe(table);
      expect(table.has("PING")).toBe(true);
    });

    it("should throw on duplicate registration", () => {
      const table = new RouteTable<unknown>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      table.register(schema, entry);

      expect(() => table.register(schema, entry)).toThrow(
        `Handler already registered for type "PING". Use merge() with onConflict if needed.`,
      );
    });

    it("should validate that schema.type is a non-empty string", () => {
      const table = new RouteTable<unknown>();
      const entry = createRouteEntry();

      // Test empty string
      expect(() => table.register(createMessageDescriptor(""), entry)).toThrow(
        "Invalid schema.type:",
      );

      // Test undefined
      const badSchema = { kind: "event" } as MessageDescriptor;
      expect(() => table.register(badSchema, entry)).toThrow(
        "Invalid schema.type:",
      );

      // Test null (via descriptor with null type)
      const nullSchema: any = { type: null, kind: "event" };
      expect(() => table.register(nullSchema, entry)).toThrow(
        "Invalid schema.type:",
      );
    });
  });

  describe("get()", () => {
    it("should retrieve a registered handler", () => {
      const table = new RouteTable<unknown>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      table.register(schema, entry);
      const retrieved = table.get("PING");

      expect(retrieved).toBe(entry);
    });

    it("should return undefined for unregistered types", () => {
      const table = new RouteTable<unknown>();

      expect(table.get("NONEXISTENT")).toBeUndefined();
    });
  });

  describe("has()", () => {
    it("should check if a handler exists", () => {
      const table = new RouteTable<unknown>();
      const schema = createMessageDescriptor("PING");
      const entry = createRouteEntry();

      expect(table.has("PING")).toBe(false);
      table.register(schema, entry);
      expect(table.has("PING")).toBe(true);
    });
  });

  describe("size()", () => {
    it("should return the number of registered handlers", () => {
      const table = new RouteTable<unknown>();

      expect(table.size()).toBe(0);

      table.register(createMessageDescriptor("PING"), createRouteEntry());
      expect(table.size()).toBe(1);

      table.register(createMessageDescriptor("PONG"), createRouteEntry());
      expect(table.size()).toBe(2);
    });
  });

  describe("list()", () => {
    it("should return all registered entries", () => {
      const table = new RouteTable<unknown>();
      const pingEntry = createRouteEntry();
      const pongEntry = createRouteEntry();

      table.register(createMessageDescriptor("PING"), pingEntry);
      table.register(createMessageDescriptor("PONG"), pongEntry);

      const entries = table.list();

      expect(entries).toHaveLength(2);
      expect(entries[0][0]).toBe("PING");
      expect(entries[0][1]).toBe(pingEntry);
      expect(entries[1][0]).toBe("PONG");
      expect(entries[1][1]).toBe(pongEntry);
    });
  });

  describe("merge()", () => {
    it("should merge handlers from another table and return this for chaining", () => {
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

      source.register(createMessageDescriptor("PING"), createRouteEntry());
      source.register(createMessageDescriptor("PONG"), createRouteEntry());

      const result = target.merge(source);

      expect(result).toBe(target);
      expect(target.size()).toBe(2);
      expect(target.has("PING")).toBe(true);
      expect(target.has("PONG")).toBe(true);
    });

    it("should throw on conflict with error policy (default)", () => {
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

      const entry1 = createRouteEntry();
      const entry2 = { ...createRouteEntry() };

      source.register(createMessageDescriptor("PING"), entry1);
      target.register(createMessageDescriptor("PING"), entry2);

      expect(() => target.merge(source)).toThrow(
        `merge() conflict: handler for type "PING" already exists (policy: "error").`,
      );
    });

    it("should skip existing handler with skip policy", () => {
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

      const originalEntry = createRouteEntry();
      const incomingEntry = { ...createRouteEntry() };

      source.register(createMessageDescriptor("PING"), incomingEntry);
      target.register(createMessageDescriptor("PING"), originalEntry);

      target.merge(source, { onConflict: "skip" });

      expect(target.get("PING")).toBe(originalEntry);
    });

    it("should replace existing handler with replace policy", () => {
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

      const originalEntry = createRouteEntry();
      const incomingEntry = { ...createRouteEntry() };

      source.register(createMessageDescriptor("PING"), incomingEntry);
      target.register(createMessageDescriptor("PING"), originalEntry);

      target.merge(source, { onConflict: "replace" });

      expect(target.get("PING")).toBe(incomingEntry);
    });

    it("should support method chaining", () => {
      const table1 = new RouteTable<unknown>();
      const table2 = new RouteTable<unknown>();
      const table3 = new RouteTable<unknown>();

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
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

      source.register(createMessageDescriptor("LOGIN"), createRouteEntry());
      source.register(createMessageDescriptor("LOGOUT"), createRouteEntry());

      const result = target.mount("auth.", source);

      expect(result).toBe(target);
      expect(target.size()).toBe(2);
      expect(target.has("auth.LOGIN")).toBe(true);
      expect(target.has("auth.LOGOUT")).toBe(true);
    });

    it("should update schema.type in mounted entries", () => {
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

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
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

      const sourceSchema: MessageDescriptor & Record<string, unknown> = {
        type: "LOGIN",
        kind: "event",
        version: 1,
        custom: "value",
      };

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
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

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
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

      const originalEntry = createRouteEntry();

      source.register(createMessageDescriptor("LOGIN"), createRouteEntry());
      target.register(createMessageDescriptor("auth.LOGIN"), originalEntry);

      target.mount("auth.", source, { onConflict: "skip" });

      expect(target.get("auth.LOGIN")).toBe(originalEntry);
    });

    it("should replace existing handler with replace policy", () => {
      const source = new RouteTable<unknown>();
      const target = new RouteTable<unknown>();

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
      const main = new RouteTable<unknown>();
      const auth = new RouteTable<unknown>();
      const chat = new RouteTable<unknown>();

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
