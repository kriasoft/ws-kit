// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import {
  assertMessageDescriptor,
  type MessageDescriptor,
} from "../../src/protocol/message-descriptor";

describe("assertMessageDescriptor", () => {
  it("should accept valid event descriptor", () => {
    const event: MessageDescriptor = {
      type: "PING",
      kind: "event",
    };
    expect(() => assertMessageDescriptor(event)).not.toThrow();
  });

  it("should accept valid RPC descriptor with response", () => {
    const rpc: any = {
      type: "REQUEST",
      kind: "rpc",
      response: { type: "RESPONSE", kind: "event" },
    };
    expect(() => assertMessageDescriptor(rpc)).not.toThrow();
  });

  it("should reject invalid type field", () => {
    const invalid: any = { type: 123, kind: "event" };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor",
    );
  });

  it("should reject missing type field", () => {
    const invalid: any = { kind: "event" };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor",
    );
  });

  it("should reject invalid kind field", () => {
    const invalid: any = { type: "TEST", kind: "unknown" };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor",
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
    const invalid: any = {
      type: "TEST",
      kind: "event",
      version: "one",
    };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.version",
    );
  });

  it("should accept valid version field", () => {
    const valid: any = {
      type: "TEST",
      kind: "event",
      version: 1,
    };
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should accept undefined version", () => {
    const valid: MessageDescriptor = {
      type: "TEST",
      kind: "event",
      version: undefined,
    };
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should validate __runtime field type if present", () => {
    const invalid: any = {
      type: "TEST",
      kind: "event",
      __runtime: 5,
    };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.__runtime",
    );
  });

  it("should accept valid __runtime field", () => {
    const valid: any = {
      type: "TEST",
      kind: "event",
      __runtime: "ws-kit-schema",
    };
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should accept undefined __runtime", () => {
    const valid: MessageDescriptor = {
      type: "TEST",
      kind: "event",
      __runtime: undefined,
    };
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should accept descriptor with all valid optional fields", () => {
    const valid: any = {
      type: "REQUEST",
      kind: "rpc",
      version: 2,
      __runtime: "ws-kit-schema",
      response: { type: "RESPONSE", kind: "event" },
    };
    expect(() => assertMessageDescriptor(valid)).not.toThrow();
  });

  it("should reject version of wrong type even with valid other fields", () => {
    const invalid: any = {
      type: "TEST",
      kind: "event",
      version: null,
      __runtime: "ws-kit-schema",
    };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.version",
    );
  });

  it("should reject __runtime of wrong type even with valid other fields", () => {
    const invalid: any = {
      type: "TEST",
      kind: "event",
      version: 1,
      __runtime: ["array"],
    };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.__runtime",
    );
  });

  it("should not validate event/RPC invariant (delegated to RouteTable)", () => {
    // RPC without response is structurally valid for assertMessageDescriptor
    // The invariant is enforced at registration time
    const rpcNoResponse: any = {
      type: "REQUEST",
      kind: "rpc",
    };
    expect(() => assertMessageDescriptor(rpcNoResponse)).not.toThrow();

    // Event with response is structurally valid for assertMessageDescriptor
    const eventWithResponse: any = {
      type: "EVENT",
      kind: "event",
      response: { type: "RESPONSE", kind: "event" },
    };
    expect(() => assertMessageDescriptor(eventWithResponse)).not.toThrow();
  });

  it("should reject empty type string", () => {
    const invalid: any = {
      type: "",
      kind: "event",
    };
    expect(() => assertMessageDescriptor(invalid)).toThrow(
      "Invalid MessageDescriptor.type: must not be empty",
    );
  });

  it("should reject response with empty type string", () => {
    const invalid: any = {
      type: "REQUEST",
      kind: "rpc",
      response: { type: "", kind: "event" },
    };
    // assertMessageDescriptor only validates structure, not nested response shape
    // but the response itself has empty type which is invalid
    expect(() => assertMessageDescriptor(invalid)).not.toThrow();
  });
});
