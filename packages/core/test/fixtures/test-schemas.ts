/**
 * Reusable test schemas for all tests.
 * Mirrors what validators (Zod, Valibot) will create.
 */

import type { MessageDescriptor } from "../src/protocol/message-descriptor";

export const JOIN: MessageDescriptor = {
  type: "JOIN",
  kind: "event",
};

export const MESSAGE: MessageDescriptor = {
  type: "MESSAGE",
  kind: "event",
};

export const GET_USER: MessageDescriptor & { response: MessageDescriptor } = {
  type: "GET_USER",
  kind: "rpc",
  response: { type: "USER", kind: "event" },
};
