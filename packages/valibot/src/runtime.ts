// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime envelope builders for Valibot schemas.
 * Returns strict Valibot root objects that users can validate directly,
 * with non-enumerable runtime hints for the core router.
 *
 * Mirrors the Zod runtime.ts pattern.
 */

import {
  literal,
  optional,
  string,
  number,
  strictObject,
  pipe,
  default as default_,
  parse as valibot_parse,
  safeParse as valibot_safeParse,
  type GenericSchema,
} from "valibot";
import type { MessageDescriptor } from "@ws-kit/core";

/**
 * Standard meta fields that are always allowed.
 * Users can extend with additional required or optional fields.
 */
const STANDARD_META_FIELDS = {
  timestamp: optional(number()),
  correlationId: optional(string()),
};

/**
 * Reserved meta field names that cannot be used in extended meta.
 * These are managed by the router/adapter layer.
 */
const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);

/**
 * Creates a strict Valibot root message schema.
 * Returns a real Valibot schema with parse() and safeParse(), not a plain descriptor.
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: v.string() });
 * const Ping = message("PING"); // No payload
 * ```
 */
export function message<
  T extends string,
  P extends
    | Record<string, GenericSchema>
    | GenericSchema
    | undefined = undefined,
  M extends Record<string, GenericSchema> = {},
>(
  type: T,
  payload?: P,
  metaShape?: M,
): GenericSchema & {
  readonly kind: "event";
  readonly __valibot_payload: P;
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
  const metaObj = strictObject({
    ...STANDARD_META_FIELDS,
    ...(metaShape || {}),
  });

  // Build payload schema if provided.
  // Note: Valibot doesn't support .strict() method like Zod.
  // Pre-built schemas are used as-is (must be pre-built as strictObject to enforce strictness).
  // Raw shapes are always wrapped in strictObject for consistent strictness.
  const payloadObj = payload
    ? payload && typeof payload === "object" && "parse" in payload
      ? (payload as GenericSchema) // Already a schema, use as-is
      : strictObject(payload as Record<string, GenericSchema>) // Raw shape, make strict
    : undefined;

  // Build root schema: { type, meta, payload? }
  const rootShape: Record<string, GenericSchema> = {
    type: literal(type),
    meta: pipe(metaObj, optional(), default_({})),
    ...(payloadObj ? { payload: payloadObj } : {}),
  };

  const root = strictObject(rootShape);

  // Attach non-enumerable runtime hints for router/plugin
  Object.defineProperties(root, {
    type: { value: type, enumerable: false },
    kind: { value: "event" as const, enumerable: false, configurable: true },
    __valibot_payload: { value: payloadObj, enumerable: false },
    __descriptor: { value: { type }, enumerable: false },
    __runtime: { value: "ws-kit-schema" as const, enumerable: false },
    // Attach Valibot's parse methods for ergonomic API (.safeParse() method call)
    parse: {
      value: (data: unknown) => valibot_parse(root, data),
      enumerable: false,
    },
    safeParse: {
      value: (data: unknown) => valibot_safeParse(root, data),
      enumerable: false,
    },
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
): GenericSchema & {
  readonly kind: "rpc";
  readonly response: GenericSchema;
  readonly __valibot_payload: ReqP;
  readonly __descriptor: { readonly type: ReqT };
  readonly __runtime: "ws-kit-schema";
} {
  // Build request schema using message() (returns Valibot schema)
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
