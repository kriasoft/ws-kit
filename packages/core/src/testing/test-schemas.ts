// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Reusable test schemas for all tests.
 * Mirrors what validators (Zod, Valibot) will create.
 */

import type { MessageDescriptor } from "@ws-kit/core";
import { DESCRIPTOR } from "../schema/metadata";

/**
 * Create a test descriptor with DESCRIPTOR symbol properly set.
 * Use this instead of plain objects with `kind` property.
 */
export function createDescriptor(
  type: string,
  kind: "event" | "rpc",
): MessageDescriptor {
  const obj: MessageDescriptor = { type };
  Object.defineProperty(obj, DESCRIPTOR, {
    value: { type, kind },
    enumerable: false,
  });
  return obj;
}

/**
 * Create a test RPC descriptor with response.
 */
export function createRpcDescriptor(
  reqType: string,
  resType: string,
): MessageDescriptor & { response: MessageDescriptor } {
  const response = createDescriptor(resType, "event");
  const obj: MessageDescriptor & { response: MessageDescriptor } = {
    type: reqType,
    response,
  };
  Object.defineProperty(obj, DESCRIPTOR, {
    value: { type: reqType, kind: "rpc" },
    enumerable: false,
  });
  return obj;
}

export const JOIN = createDescriptor("JOIN", "event");
export const MESSAGE = createDescriptor("MESSAGE", "event");
export const GET_USER = createRpcDescriptor("GET_USER", "USER");
