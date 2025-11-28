/**
 * MessageDescriptor: stable runtime contract.
 *
 * Every message (event or RPC) has this shape, regardless of validator.
 * Core reads only these fields; never introspects validator ASTs.
 *
 * Fields:
 * - type: literal string → handler lookup key
 * - response: MessageDescriptor → only for RPC; validated at registration
 * - version (optional): rolling upgrades
 * - __runtime (optional): brand flag (usually "ws-kit-schema")
 *
 * The `kind` ("event" | "rpc") is stored in DESCRIPTOR symbol, not on the
 * interface, to avoid polluting the schema namespace. Use getKind() to read it.
 *
 * Invariants enforced at RouteTable.register():
 * - RPC must have a response descriptor
 * - Event must not have a response descriptor
 */

import { getKind } from "../schema/metadata.js";

export interface MessageDescriptor {
  readonly type: string;
  readonly version?: number;
  readonly __runtime?: string;
  readonly response?: MessageDescriptor;
}

/**
 * Type guards + assertions (re-exported in guards.ts).
 *
 * Uses getKind() to read kind from DESCRIPTOR symbol.
 * No fallback to obj.kind - strictly reads from DESCRIPTOR.
 */
export function assertMessageDescriptor(
  obj: unknown,
): asserts obj is MessageDescriptor {
  if (typeof obj !== "object" || obj === null) {
    throw new TypeError("Invalid MessageDescriptor");
  }

  const desc = obj as Record<string, unknown>;

  // Validate type is non-empty string
  if (typeof desc.type !== "string" || desc.type.length === 0) {
    throw new TypeError(
      "Invalid MessageDescriptor.type: must be non-empty string",
    );
  }

  // Read kind from DESCRIPTOR symbol (no fallback to obj.kind)
  const kind = getKind(obj);
  if (kind !== "event" && kind !== "rpc") {
    throw new TypeError(
      `Invalid MessageDescriptor.kind: expected "event" | "rpc", got ${kind === undefined ? "undefined" : `"${kind}"`}`,
    );
  }

  // Validate optional fields if present. Event/RPC invariant is enforced
  // at route registration time (RouteTable.register), not here.
  if (desc.version !== undefined && typeof desc.version !== "number") {
    throw new TypeError(
      `Invalid MessageDescriptor.version: expected number | undefined, got ${typeof desc.version}`,
    );
  }

  if (desc.__runtime !== undefined && typeof desc.__runtime !== "string") {
    throw new TypeError(
      `Invalid MessageDescriptor.__runtime: expected string | undefined, got ${typeof desc.__runtime}`,
    );
  }
}
