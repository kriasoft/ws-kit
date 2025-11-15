/**
 * MessageDescriptor: stable runtime contract.
 *
 * Every message (event or RPC) has this shape, regardless of validator.
 * Core reads only these fields; never introspects validator ASTs.
 *
 * Discriminators:
 * - kind: "event" | "rpc" → router.on() vs router.rpc()
 * - response: MessageDescriptor → only for RPC; validated at registration
 * - type: literal string → handler lookup key
 * - version (optional): rolling upgrades
 * - __runtime (optional): brand flag (usually "ws-kit-schema")
 *
 * Invariants enforced at RouteTable.register():
 * - RPC must have a response descriptor
 * - Event must not have a response descriptor
 */

export interface MessageDescriptor {
  readonly type: string;
  readonly kind: "event" | "rpc";
  readonly version?: number;
  readonly __runtime?: string;
  readonly response?: MessageDescriptor;
}

/**
 * Type guards + assertions (re-exported in guards.ts).
 */

export function assertMessageDescriptor(
  obj: unknown,
): asserts obj is MessageDescriptor {
  if (typeof obj !== "object" || obj === null) {
    throw new TypeError("Invalid MessageDescriptor");
  }

  const desc = obj as Record<string, unknown>;

  if (
    typeof desc.type !== "string" ||
    typeof desc.kind !== "string" ||
    !["event", "rpc"].includes(desc.kind)
  ) {
    throw new TypeError("Invalid MessageDescriptor");
  }

  // Validate type is non-empty string
  if ((desc.type as string).length === 0) {
    throw new TypeError("Invalid MessageDescriptor.type: must not be empty");
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
