// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime envelope builders for message schemas.
 * Creates stable MessageDescriptor objects that the core router can read
 * without peeking into validator internals.
 */

import type { MessageDescriptor } from "@ws-kit/core";
import type { ZodObject, ZodRawShape, ZodType } from "zod";

/**
 * Creates a message schema with stable runtime shape.
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: z.string() });
 * const Ping = message("PING"); // No payload
 * ```
 */
export function message<T extends string, P extends ZodRawShape | ZodObject<any>>(
  type: T,
  payload?: P,
): MessageDescriptor & {
  readonly kind: "event";
  readonly __zod_payload: P;
} {
  return {
    type,
    kind: "event",
    __runtime: "ws-kit-schema",
    __zod_payload: payload as any,
  } as any;
}

/**
 * Creates an RPC schema with request and response message types.
 *
 * @example
 * ```typescript
 * const GetUser = rpc(
 *   "GET_USER",
 *   { id: z.string() },
 *   "USER",
 *   { id: z.string(), name: z.string() }
 * );
 * ```
 */
export function rpc<
  ReqT extends string,
  ReqP extends ZodRawShape | ZodObject<any> | undefined,
  ResT extends string,
  ResP extends ZodRawShape | ZodObject<any> | undefined,
>(
  requestType: ReqT,
  requestPayload: ReqP,
  responseType: ResT,
  responsePayload: ResP,
): MessageDescriptor & {
  readonly kind: "rpc";
  readonly response: MessageDescriptor & { readonly __zod_payload: ResP };
  readonly __zod_payload: ReqP;
} {
  const responseSchema = {
    type: responseType,
    kind: "event" as const,
    __runtime: "ws-kit-schema",
    __zod_payload: responsePayload,
  };

  return {
    type: requestType,
    kind: "rpc" as const,
    __runtime: "ws-kit-schema",
    response: responseSchema as any,
    __zod_payload: requestPayload,
  } as any;
}
