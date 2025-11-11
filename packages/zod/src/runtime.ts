// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime envelope builders for message schemas.
 * Returns strict Zod root objects that users can validate directly,
 * with non-enumerable runtime hints for the core router.
 */

import { z, type ZodObject, type ZodRawShape, type ZodType } from "zod";
import type { MessageDescriptor } from "@ws-kit/core";

/**
 * Standard meta fields that are always allowed.
 * Users can extend with additional required or optional fields.
 */
const STANDARD_META_FIELDS = {
  timestamp: z.number().optional(),
  correlationId: z.string().optional(),
};

/**
 * Reserved meta field names that cannot be used in extended meta.
 * These are managed by the router/adapter layer.
 */
const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);

/**
 * Creates a strict Zod root message schema.
 * Returns a real Zod object with .safeParse(), not a plain descriptor.
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: z.string() });
 * const Ping = message("PING"); // No payload
 * ```
 */
export function message<
  T extends string,
  P extends ZodRawShape | ZodObject<any> | undefined = undefined,
  M extends ZodRawShape = {},
>(
  type: T,
  payload?: P,
  metaShape?: M,
): ZodObject<any> & {
  readonly kind: "event";
  readonly __zod_payload: P;
  readonly __descriptor: { readonly type: T };
  readonly __runtime: "ws-kit-schema";
} {
  // Validate that metaShape doesn't contain reserved keys
  if (metaShape) {
    const reservedKeysInMeta = Object.keys(metaShape).filter((key) =>
      RESERVED_META_KEYS.has(key),
    );
    if (reservedKeysInMeta.length > 0) {
      throw new Error(
        `Reserved meta keys not allowed in schema: ${reservedKeysInMeta.join(", ")}. ` +
          `Reserved keys: ${Array.from(RESERVED_META_KEYS).join(", ")}`,
      );
    }
  }

  // Build meta schema: standard fields + extended fields from metaShape
  const metaObj = z
    .object({
      ...STANDARD_META_FIELDS,
      ...(metaShape || {}),
    })
    .strict();

  // Detect if value is a Zod schema via duck typing (ZodType is type-only, can't use instanceof).
  // Checks for parse(), safeParse(), and _def (Zod's internal definition object).
  const isZodSchema = (x: any): x is ZodType =>
    !!x &&
    typeof x.parse === "function" &&
    typeof x.safeParse === "function" &&
    !!x._def;

  // Build payload schema if provided.
  // Apply .strict() to both paths to enforce strictness consistently.
  const payloadObj = payload
    ? isZodSchema(payload)
      ? (payload as ZodObject<any>).strict()
      : z.object(payload as ZodRawShape).strict()
    : undefined;

  // Build root schema: { type, meta, payload? }
  const rootShape: ZodRawShape = {
    type: z.literal(type),
    meta: metaObj,
    ...(payloadObj ? { payload: payloadObj } : {}),
  };

  const root = z.object(rootShape).strict();

  // Attach non-enumerable runtime hints for router/plugin
  Object.defineProperties(root, {
    type: { value: type, enumerable: false },
    kind: { value: "event" as const, enumerable: false, configurable: true },
    __zod_payload: { value: payloadObj, enumerable: false },
    __descriptor: { value: { type }, enumerable: false },
    __runtime: { value: "ws-kit-schema" as const, enumerable: false },
  });

  return root as any;
}

/**
 * Creates an RPC schema with strict request and response roots.
 * The response schema is attached as a non-enumerable property.
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
): ZodObject<any> & {
  readonly kind: "rpc";
  readonly response: ZodObject<any>;
  readonly __zod_payload: ReqP;
  readonly __descriptor: { readonly type: ReqT };
  readonly __runtime: "ws-kit-schema";
} {
  // Build request schema using message() (returns Zod object)
  const requestRoot = message(requestType, requestPayload);

  // Build response schema separately
  const responseRoot = message(responseType, responsePayload);

  // Replace kind and attach response to request
  Object.defineProperties(requestRoot, {
    kind: { value: "rpc" as const, enumerable: false, configurable: true },
    response: { value: responseRoot, enumerable: false, configurable: true },
    responseType: { value: responseType, enumerable: false },
  });

  return requestRoot as any;
}
