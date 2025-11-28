/**
 * Type guards for MessageDescriptor.
 * Used by router to discriminate event handlers from RPC handlers.
 *
 * Note: kind is read from DESCRIPTOR symbol via getKind(), not from obj.kind directly.
 */

import type { MessageDescriptor } from "../protocol/message-descriptor";
import { getKind } from "./metadata";

export function isMessageDescriptor(obj: unknown): obj is MessageDescriptor {
  const kind = getKind(obj);
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as any).messageType === "string" &&
    (kind === "event" || kind === "rpc")
  );
}

export function isEventDescriptor(
  obj: unknown,
): obj is MessageDescriptor & { kind: "event" } {
  return isMessageDescriptor(obj) && getKind(obj) === "event";
}

export function isRpcDescriptor(
  obj: unknown,
): obj is MessageDescriptor & { kind: "rpc"; response: MessageDescriptor } {
  return (
    isMessageDescriptor(obj) &&
    getKind(obj) === "rpc" &&
    typeof (obj as any).response === "object" &&
    (obj as any).response !== null
  );
}
