// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime envelope builders for Valibot schemas.
 * Provides two forms: object-oriented (primary) and positional (compact).
 *
 * Both return strict Valibot root objects with non-enumerable hints for the router
 * and per-schema options (validateOutgoing, strict) for granular control.
 *
 * Users can compose schemas before wrapping to preserve type safety:
 * const JoinPayload = v.pipe(v.object({roomId: v.string()}), v.transform(...));
 * const Join = message({ type: "JOIN", payload: JoinPayload, options: {...} });
 *
 * Mirrors the Zod runtime.ts pattern for parity.
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
import {
  DESCRIPTOR,
  VALIBOT_PAYLOAD,
  setSchemaOpts,
  type SchemaOpts,
} from "./metadata.js";

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
 * Supports two forms: object-oriented (primary) and positional (compact).
 *
 * Object form (recommended for clarity and extensibility):
 * ```typescript
 * const Join = message({
 *   type: "USER_JOIN",
 *   payload: v.object({ roomId: v.string() }),
 *   options: { strict: true }
 * });
 * ```
 *
 * Positional form (for small, one-off schemas):
 * ```typescript
 * const Ping = message("PING");
 * const Join = message("USER_JOIN", { roomId: v.string() });
 * ```
 */

// Object form (primary)
export function message<
  const T extends string,
  P extends
    | Record<string, GenericSchema>
    | GenericSchema
    | undefined = undefined,
  M extends Record<string, GenericSchema> = {},
>(spec: {
  readonly type: T;
  readonly payload?: P;
  readonly meta?: M;
  readonly options?: SchemaOpts;
}): GenericSchema & {
  readonly kind: "event";
  readonly __valibot_payload: P;
  readonly __descriptor: { readonly type: T };
  readonly __runtime: "ws-kit-schema";
};

// Positional form (compact)
export function message<
  const T extends string,
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
};

// Implementation
export function message<
  T extends string,
  P extends
    | Record<string, GenericSchema>
    | GenericSchema
    | undefined = undefined,
  M extends Record<string, GenericSchema> = {},
>(
  specOrType: { type: T; payload?: P; meta?: M; options?: SchemaOpts } | T,
  payload?: P,
  metaShape?: M,
): GenericSchema & {
  readonly kind: "event";
  readonly __valibot_payload: P;
  readonly __descriptor: { readonly type: T };
  readonly __runtime: "ws-kit-schema";
} {
  // Normalize inputs: support both object and positional forms
  let type: T;
  let payloadDef: P | undefined;
  let metaDef: M | undefined;
  let options: SchemaOpts | undefined;

  if (typeof specOrType === "string") {
    // Positional form
    type = specOrType as T;
    payloadDef = payload;
    metaDef = metaShape;
  } else {
    // Object form
    type = specOrType.type as T;
    payloadDef = specOrType.payload;
    metaDef = specOrType.meta;
    options = specOrType.options;
  }
  // Validate that meta doesn't contain reserved keys
  if (metaDef) {
    const reservedKeysInMeta = Object.keys(metaDef).filter((key) =>
      RESERVED_META_KEYS.has(key),
    );
    if (reservedKeysInMeta.length > 0) {
      throw new Error(
        `Reserved meta keys not allowed in schema: ${reservedKeysInMeta.join(", ")}. ` +
          `Reserved keys: ${Array.from(RESERVED_META_KEYS).join(", ")}`,
      );
    }
  }

  // Build meta schema: standard fields + extended fields
  const metaObj = strictObject({
    ...STANDARD_META_FIELDS,
    ...(metaDef || {}),
  });

  // Build payload schema if provided.
  // Note: Valibot doesn't support .strict() method like Zod.
  // Pre-built schemas are used as-is (must be pre-built as strictObject to enforce strictness).
  // Raw shapes are always wrapped in strictObject for consistent strictness.
  // If strict: false option is set, use the payload as-is without strictObject wrapping.
  const payloadObj = payloadDef
    ? payloadDef && typeof payloadDef === "object" && "parse" in payloadDef
      ? options?.strict === false
        ? (payloadDef as GenericSchema) // Already a schema, use as-is (non-strict)
        : (payloadDef as GenericSchema) // Already a schema, use as-is
      : strictObject(payloadDef as Record<string, GenericSchema>) // Raw shape, make strict
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
    type: { value: type, enumerable: false }, // Convenience property for quick access
    kind: { value: "event" as const, enumerable: false, configurable: true },
    __runtime: { value: "ws-kit-schema" as const, enumerable: false },
    [DESCRIPTOR]: { value: { type }, enumerable: false },
    [VALIBOT_PAYLOAD]: { value: payloadObj, enumerable: false },
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

  // Attach per-schema options if provided
  if (options) {
    setSchemaOpts(root, options);
  }

  return root as any;
}

/**
 * Creates an RPC schema with separate request and response message definitions.
 * Supports two forms: object-oriented (primary) and positional (compact).
 *
 * Object form (recommended for granular control):
 * ```typescript
 * const GetUser = rpc({
 *   req: {
 *     type: "GET_USER",
 *     payload: v.object({ id: v.string() })
 *   },
 *   res: {
 *     type: "USER",
 *     payload: v.object({ id: v.string(), name: v.string() }),
 *     options: { validateOutgoing: true }
 *   }
 * });
 * ```
 *
 * Positional form (for simple, compact contracts):
 * ```typescript
 * const GetUser = rpc(
 *   "GET_USER", { id: v.string() },
 *   "USER",     { id: v.string(), name: v.string() }
 * );
 * ```
 */

// Object form (primary)
export function rpc<
  const ReqT extends string,
  ReqP extends Record<string, GenericSchema> | GenericSchema | undefined,
  ResT extends string,
  ResP extends Record<string, GenericSchema> | GenericSchema | undefined,
>(spec: {
  readonly req: {
    readonly type: ReqT;
    readonly payload?: ReqP;
    readonly meta?: Record<string, GenericSchema>;
    readonly options?: SchemaOpts;
  };
  readonly res: {
    readonly type: ResT;
    readonly payload?: ResP;
    readonly meta?: Record<string, GenericSchema>;
    readonly options?: SchemaOpts;
  };
}): GenericSchema & {
  readonly kind: "rpc";
  readonly response: GenericSchema;
  readonly __valibot_payload: ReqP;
  readonly __descriptor: { readonly type: ReqT };
  readonly __runtime: "ws-kit-schema";
};

// Positional form (compact)
export function rpc<
  const ReqT extends string,
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
};

// Implementation
export function rpc<
  ReqT extends string,
  ReqP extends Record<string, GenericSchema> | GenericSchema | undefined,
  ResT extends string,
  ResP extends Record<string, GenericSchema> | GenericSchema | undefined,
>(
  specOrReqType:
    | {
        req: {
          type: ReqT;
          payload?: ReqP;
          meta?: Record<string, GenericSchema>;
          options?: SchemaOpts;
        };
        res: {
          type: ResT;
          payload?: ResP;
          meta?: Record<string, GenericSchema>;
          options?: SchemaOpts;
        };
      }
    | ReqT,
  requestPayload?: ReqP,
  responseType?: ResT,
  responsePayload?: ResP,
): GenericSchema & {
  readonly kind: "rpc";
  readonly response: GenericSchema;
  readonly __valibot_payload: ReqP;
  readonly __descriptor: { readonly type: ReqT };
  readonly __runtime: "ws-kit-schema";
} {
  // Normalize inputs: support both object and positional forms
  let reqType: ReqT;
  let reqPayload: ReqP | undefined;
  let resType: ResT;
  let resPayload: ResP | undefined;
  let reqOptions: SchemaOpts | undefined;
  let resOptions: SchemaOpts | undefined;

  if (typeof specOrReqType === "string") {
    // Positional form
    reqType = specOrReqType as ReqT;
    reqPayload = requestPayload;
    resType = responseType as ResT;
    resPayload = responsePayload;
  } else {
    // Object form
    const spec = specOrReqType as any;
    reqType = spec.req.type as ReqT;
    reqPayload = spec.req.payload;
    resType = spec.res.type as ResT;
    resPayload = spec.res.payload;
    reqOptions = spec.req.options;
    resOptions = spec.res.options;
  }

  // Build request schema using message() with per-request options
  const requestRoot = message({
    type: reqType,
    payload: reqPayload,
    options: reqOptions,
  });

  // Build response schema using message() with per-response options
  const responseRoot = message({
    type: resType,
    payload: resPayload,
    options: resOptions,
  });

  // Replace kind and attach response to request
  Object.defineProperties(requestRoot, {
    kind: { value: "rpc" as const, enumerable: false, configurable: true },
    response: { value: responseRoot, enumerable: false, configurable: true },
    responseType: { value: resType, enumerable: false },
  });

  return requestRoot as any;
}
