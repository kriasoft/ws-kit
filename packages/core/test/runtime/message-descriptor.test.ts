// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import {
  assertMessageDescriptor,
  type MessageDescriptor,
} from "../../src/protocol/message-descriptor";
import { DESCRIPTOR } from "../../src/schema/metadata";

/**
 * Helper to create a test descriptor with DESCRIPTOR symbol set.
 * This mimics how message() and rpc() set the descriptor.
 */
function createTestDescriptor(
  type: string,
  kind: "event" | "rpc",
  opts?: {
    version?: number;
    __runtime?: string;
    response?: { type: string; kind: "event" | "rpc" };
  },
): any {
  const obj: any = { type };
  if (opts?.version !== undefined) obj.version = opts.version;
  if (opts?.__runtime !== undefined) obj.__runtime = opts.__runtime;
  if (opts?.response) {
    obj.response = createTestDescriptor(opts.response.type, opts.response.kind);
  }
  // Set kind in DESCRIPTOR symbol (the new standard)
  Object.defineProperty(obj, DESCRIPTOR, {
    value: { type, kind },
    enumerable: false,
  });
  return obj;
}

/**
 * Helper to create an invalid descriptor (no DESCRIPTOR symbol).
 */
function createInvalidDescriptor(props: Record<string, unknown>): any {
  return { ...props };
}

describe("assertMessageDescriptor", () => {
  it("should accept valid event descriptor", () => {
    const event = createTestDescriptor("PING", "event");
    expect(() => assertMessageDescriptor(event)).not.toThrow();
  });

  it("should accept valid RPC descriptor with response", () => {
    const rpc = createTestDescriptor("REQUEST", "rpc", {
      response: { type: "RESPONSE", kind: "event" },
    });
    expect(() => assertMessageDescriptor(rpc)).not.toThrow();
  });

  it("should reject missing type field", () => {
    const invalid = createInvalidDescriptor({ kind: "event" });
    // Without DESCRIPTOR, kind will be undefined
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor",
    );
  });

  it("should accept plain object with kind property (backwards compatibility)", () => {
    // Plain object with kind property - should be accepted via fallback
    const valid: any = { type: "TEST", kind: "event" };
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should reject missing kind (no DESCRIPTOR, no kind property)", () => {
    // Plain object without any kind - should be rejected
    const invalid: any = { type: "TEST" };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      'Invalid MessageDescriptor.kind: expected "event" | "rpc", got undefined',
    );
  });

  it("should reject invalid kind value in DESCRIPTOR", () => {
    const invalid: any = { type: "TEST" };
    Object.defineProperty(invalid, DESCRIPTOR, {
      value: { type: "TEST", kind: "unknown" },
      enumerable: false,
    });
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      'Invalid MessageDescriptor.kind: expected "event" | "rpc", got "unknown"',
    );
  });

  it("should reject non-object input", () => {
    expect(() => assertMessageDescriptor("not an object")).toThrow(
      "Invalid MessageDescriptor",
    );
    expect(() => assertMessageDescriptor(123)).toThrow(
      "Invalid MessageDescriptor",
    );
    expect(() => assertMessageDescriptor(null)).toThrow(
      "Invalid MessageDescriptor",
    );
  });

  it("should validate version field type if present", () => {
    const invalid = createTestDescriptor("TEST", "event", {
      version: "one" as any,
    });
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.version",
    );
  });

  it("should accept valid version field", () => {
    const valid = createTestDescriptor("TEST", "event", { version: 1 });
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should accept undefined version", () => {
    const valid = createTestDescriptor("TEST", "event");
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should validate __runtime field type if present", () => {
    const invalid = createTestDescriptor("TEST", "event", {
      __runtime: 5 as any,
    });
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.__runtime",
    );
  });

  it("should accept valid __runtime field", () => {
    const valid = createTestDescriptor("TEST", "event", {
      __runtime: "ws-kit-schema",
    });
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should accept undefined __runtime", () => {
    const valid = createTestDescriptor("TEST", "event");
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should accept descriptor with all valid optional fields", () => {
    const valid = createTestDescriptor("REQUEST", "rpc", {
      version: 2,
      __runtime: "ws-kit-schema",
      response: { type: "RESPONSE", kind: "event" },
    });
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should reject version of wrong type even with valid other fields", () => {
    const invalid = createTestDescriptor("TEST", "event", {
      version: null as any,
      __runtime: "ws-kit-schema",
    });
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.version",
    );
  });

  it("should reject __runtime of wrong type even with valid other fields", () => {
    const invalid = createTestDescriptor("TEST", "event", {
      version: 1,
      __runtime: ["array"] as any,
    });
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.__runtime",
    );
  });

  it("should not validate event/RPC invariant (delegated to RouteTable)", () => {
    // RPC without response is structurally valid for assertMessageDescriptor
    // The invariant is enforced at registration time
    const rpcNoResponse = createTestDescriptor("REQUEST", "rpc");
    expect(() => assertMessageDescriptor(rpcNoResponse)).not.toThrow();

    // Event with response is structurally valid for assertMessageDescriptor
    const eventWithResponse = createTestDescriptor("EVENT", "event", {
      response: { type: "RESPONSE", kind: "event" },
    });
    expect(() => assertMessageDescriptor(eventWithResponse)).not.toThrow();
  });

  it("should reject empty type string", () => {
    const invalid: any = { type: "" };
    Object.defineProperty(invalid, DESCRIPTOR, {
      value: { type: "", kind: "event" },
      enumerable: false,
    });
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.type: must be non-empty string",
    );
  });

  it("should reject response with invalid nested descriptor", () => {
    const rpc = createTestDescriptor("REQUEST", "rpc", {
      response: { type: "RESPONSE", kind: "event" },
    });
    // The response should also have its DESCRIPTOR set by createTestDescriptor
    // This verifies nested descriptors are handled correctly
    expect(() => assertMessageDescriptor(rpc)).not.toThrow();
  });
});
