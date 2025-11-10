/**
 * Type guards for MessageDescriptor.
 * Used by router to discriminate event handlers from RPC handlers.
 */

import type { MessageDescriptor } from "../../protocol/message-descriptor";

export function isMessageDescriptor(obj: unknown): obj is MessageDescriptor {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as any).type === "string" &&
    ["event", "rpc"].includes((obj as any).kind)
  );
}

export function isEventDescriptor(
  obj: unknown,
): obj is MessageDescriptor & { kind: "event" } {
  return isMessageDescriptor(obj) && obj.kind === "event";
}

export function isRpcDescriptor(
  obj: unknown,
): obj is MessageDescriptor & { kind: "rpc"; response: MessageDescriptor } {
  return (
    isMessageDescriptor(obj) &&
    obj.kind === "rpc" &&
    typeof obj.response === "object" &&
    obj.response !== null
  );
}
