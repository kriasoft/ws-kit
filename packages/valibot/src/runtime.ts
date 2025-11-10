// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime envelope builders for Valibot schemas.
 * Creates stable MessageDescriptor objects that the core router can read
 * without peeking into validator internals.
 *
 * Mirrors the Zod runtime.ts pattern.
 */

import type { MessageDescriptor } from "@ws-kit/core";
import type { GenericSchema } from "valibot";

/**
 * Creates a message schema with stable runtime shape.
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: v.string() });
 * const Ping = message("PING"); // No payload
 * ```
 */
export function message<T extends string, P extends Record<string, GenericSchema> | GenericSchema | undefined>(
  type: T,
  payload?: P,
): MessageDescriptor & {
  readonly kind: "event";
  readonly __valibot_payload: P;
} {
  return {
    type,
    kind: "event",
    __runtime: "ws-kit-schema",
    __valibot_payload: payload as any,
  } as any;
}

/**
 * Creates an RPC schema with request and response message types.
 *
 * @example
 * ```typescript
 * const GetUser = rpc(
 *   "GET_USER",
 *   { id: v.string() },
 *   "USER",
 *   { id: v.string(), name: v.string() }
 * );
 * ```
 */
export function rpc<
  ReqT extends string,
  ReqP extends Record<string, GenericSchema> | GenericSchema | undefined,
  ResT extends string,
  ResP extends Record<string, GenericSchema> | GenericSchema | undefined,
>(
  requestType: ReqT,
  requestPayload: ReqP,
  responseType: ResT,
  responsePayload: ResP,
): MessageDescriptor & {
  readonly kind: "rpc";
  readonly response: MessageDescriptor & { readonly __valibot_payload: ResP };
  readonly __valibot_payload: ReqP;
} {
  const responseSchema = {
    type: responseType,
    kind: "event" as const,
    __runtime: "ws-kit-schema",
    __valibot_payload: responsePayload,
  };

  return {
    type: requestType,
    kind: "rpc" as const,
    __runtime: "ws-kit-schema",
    response: responseSchema as any,
    __valibot_payload: requestPayload,
  } as any;
}
