/**
 * MessageDescriptor: stable runtime contract.
 *
 * Every message (event or RPC) has this shape, regardless of validator.
 * Core reads only these fields; never introspects validator ASTs.
 *
 * Discriminators:
 * - kind: "event" | "rpc" → router.on() vs router.rpc()
 * - response: undefined | MessageDescriptor → event vs RPC
 * - type: literal string → handler lookup key
 * - version (optional): rolling upgrades
 * - __runtime (optional): brand flag (usually "ws-kit-schema")
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
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof (obj as any).type !== "string" ||
    !["event", "rpc"].includes((obj as any).kind)
  ) {
    throw new TypeError("Invalid MessageDescriptor");
  }
}
