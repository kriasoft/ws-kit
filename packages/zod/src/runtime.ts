// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime envelope builders for message schemas.
 * Provides two forms: object-oriented (primary) and positional (compact).
 *
 * Both return strict Zod root objects with non-enumerable hints for the router
 * and per-schema options (validateOutgoing, strict) for granular control.
 *
 * Users can compose schemas before wrapping to preserve type safety:
 * const JoinPayload = z.object({roomId: z.string()}).transform(...);
 * const Join = message({ type: "JOIN", payload: JoinPayload, options: {...} });
 */

import { z, type ZodObject, type ZodRawShape, type ZodType } from "zod";
import {
  DESCRIPTOR,
  setSchemaOpts,
  type SchemaOpts,
} from "@ws-kit/core/internal";
import type { BrandedSchema } from "./types.js";

/**
 * Symbol for Zod payload schema (validator-specific).
 * Stores the Zod schema for the payload field.
 */
export const ZOD_PAYLOAD = Symbol.for("@ws-kit/zod-payload");

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
 * These are managed by the router/adapter layer and cannot be overridden in schema definitions.
 *
 * @internal
 */
const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);

/**
 * Helper type to infer actual types from ZodRawShape or ZodObject.
 * Converts each Zod schema in a shape to its inferred type.
 *
 * @internal
 */
type InferPayloadShape<P extends ZodRawShape | ZodObject<any> | undefined> =
  P extends undefined
    ? never
    : P extends ZodRawShape
      ? { [K in keyof P]: P[K] extends ZodType<infer U> ? U : never }
      : P extends ZodObject<any>
        ? z.infer<P>
        : never;

/**
 * Creates a strict Zod root message schema.
 * Supports two forms: object-oriented (primary) and positional (compact).
 *
 * Object form (recommended for clarity and extensibility):
 * ```typescript
 * const Join = message({
 *   type: "USER_JOIN",
 *   payload: z.object({ roomId: z.string() }),
 *   options: { strict: true }
 * });
 * ```
 *
 * Positional form (for small, one-off schemas):
 * ```typescript
 * const Ping = message("PING");
 * const Join = message("USER_JOIN", { roomId: z.string() });
 * ```
 */

// Object form (primary)
export function message<
  const T extends string,
  P extends ZodRawShape | ZodObject<any> | undefined = undefined,
  M extends ZodRawShape | undefined = undefined,
>(spec: {
  type: T;
  payload?: P;
  meta?: M;
  options?: SchemaOpts;
}): ZodObject<any> &
  BrandedSchema<
    T,
    P extends undefined ? never : InferPayloadShape<P>,
    never,
    M extends ZodRawShape
      ? { [K in keyof M]: M[K] extends ZodType<infer U> ? U : never }
      : {}
  > & {
    readonly kind: "event";
    readonly __zod_payload: P;
    readonly __descriptor: { readonly type: T };
    readonly __runtime: "ws-kit-schema";
  };

// Positional form (compact)
export function message<
  const T extends string,
  P extends ZodRawShape | ZodObject<any> | undefined = undefined,
  M extends ZodRawShape | undefined = undefined,
>(
  type: T,
  payload?: P,
  metaShape?: M,
): ZodObject<any> &
  BrandedSchema<
    T,
    P extends undefined ? never : InferPayloadShape<P>,
    never,
    M extends ZodRawShape
      ? { [K in keyof M]: M[K] extends ZodType<infer U> ? U : never }
      : {}
  > & {
    readonly kind: "event";
    readonly __zod_payload: P;
    readonly __descriptor: { readonly type: T };
    readonly __runtime: "ws-kit-schema";
  };

// Implementation
export function message<
  T extends string,
  P extends ZodRawShape | ZodObject<any> | undefined = undefined,
  M extends ZodRawShape = {},
>(
  specOrType: { type: T; payload?: P; meta?: M; options?: SchemaOpts } | T,
  payload?: P,
  metaShape?: M,
): ZodObject<any> &
  BrandedSchema<
    T,
    P extends undefined ? never : InferPayloadShape<P>,
    never,
    M extends ZodRawShape
      ? { [K in keyof M]: M[K] extends ZodType<infer U> ? U : never }
      : {}
  > & {
    readonly kind: "event";
    readonly __zod_payload: P;
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
  const metaObj = z
    .object({
      ...STANDARD_META_FIELDS,
      ...(metaDef || {}),
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
  // If strict option is explicitly false, keep as-is; otherwise apply .strict()
  const payloadObj = payloadDef
    ? isZodSchema(payloadDef)
      ? options?.strict === false
        ? (payloadDef as ZodObject<any>)
        : (payloadDef as ZodObject<any>).strict()
      : z.object(payloadDef as ZodRawShape).strict()
    : undefined;

  // Build root schema: { type, meta, payload? }
  const rootShape: ZodRawShape = {
    type: z.literal(type),
    meta: metaObj.optional().default({}),
    ...(payloadObj ? { payload: payloadObj } : {}),
  };

  const root = z.object(rootShape).strict();

  // Attach non-enumerable runtime hints for router/plugin
  Object.defineProperties(root, {
    type: { value: type, enumerable: false }, // Convenience property for quick access
    kind: { value: "event" as const, enumerable: false, configurable: true },
    __runtime: { value: "ws-kit-schema" as const, enumerable: false },
    [DESCRIPTOR]: { value: { type }, enumerable: false },
    [ZOD_PAYLOAD]: { value: payloadObj, enumerable: false },
  });

  // Attach per-schema options if provided
  if (options) {
    setSchemaOpts(root, options);
  }

  return root as ZodObject<any> &
    BrandedSchema<
      T,
      P extends undefined ? never : InferPayloadShape<P>,
      never,
      M extends ZodRawShape
        ? { [K in keyof M]: M[K] extends ZodType<infer U> ? U : never }
        : {}
    > & {
      readonly kind: "event";
      readonly __zod_payload: P;
      readonly __descriptor: { readonly type: T };
      readonly __runtime: "ws-kit-schema";
    };
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
 *     payload: z.object({ id: z.string() })
 *   },
 *   res: {
 *     type: "USER",
 *     payload: z.object({ id: z.string(), name: z.string() }),
 *     options: { validateOutgoing: true }
 *   }
 * });
 * ```
 *
 * Positional form (for simple, compact contracts):
 * ```typescript
 * const GetUser = rpc(
 *   "GET_USER", { id: z.string() },
 *   "USER",     { id: z.string(), name: z.string() }
 * );
 * ```
 */

// Object form (primary)
export function rpc<
  const ReqT extends string,
  ReqP extends ZodRawShape | ZodObject<any> | undefined,
  ResT extends string,
  ResP extends ZodRawShape | ZodObject<any> | undefined,
  ReqM extends ZodRawShape | undefined = undefined,
  ResM extends ZodRawShape | undefined = undefined,
>(spec: {
  req: {
    type: ReqT;
    payload?: ReqP;
    meta?: ReqM;
    options?: SchemaOpts;
  };
  res: {
    type: ResT;
    payload?: ResP;
    meta?: ResM;
    options?: SchemaOpts;
  };
}): ZodObject<any> &
  BrandedSchema<
    ReqT,
    ReqP extends undefined ? never : InferPayloadShape<ReqP>,
    ResP extends undefined ? never : InferPayloadShape<ResP>,
    ReqM extends ZodRawShape
      ? { [K in keyof ReqM]: ReqM[K] extends ZodType<infer U> ? U : never }
      : {}
  > & {
    readonly kind: "rpc";
    readonly response: ZodObject<any> &
      BrandedSchema<
        ResT,
        ResP extends undefined ? never : InferPayloadShape<ResP>,
        never,
        ResM extends ZodRawShape
          ? { [K in keyof ResM]: ResM[K] extends ZodType<infer U> ? U : never }
          : {}
      > & {
        readonly kind: "event";
        readonly __zod_payload: ResP;
        readonly __descriptor: { readonly type: ResT };
        readonly __runtime: "ws-kit-schema";
      };
    readonly __zod_payload: ReqP;
    readonly __descriptor: { readonly type: ReqT };
    readonly __runtime: "ws-kit-schema";
  };

// Positional form (compact)
export function rpc<
  const ReqT extends string,
  ReqP extends ZodRawShape | ZodObject<any> | undefined,
  ResT extends string,
  ResP extends ZodRawShape | ZodObject<any> | undefined,
>(
  requestType: ReqT,
  requestPayload: ReqP,
  responseType: ResT,
  responsePayload: ResP,
): ZodObject<any> &
  BrandedSchema<
    ReqT,
    ReqP extends undefined ? never : InferPayloadShape<ReqP>,
    ResP extends undefined ? never : InferPayloadShape<ResP>,
    {}
  > & {
    readonly kind: "rpc";
    readonly response: ZodObject<any> &
      BrandedSchema<
        ResT,
        ResP extends undefined ? never : InferPayloadShape<ResP>,
        never,
        {}
      > & {
        readonly kind: "event";
        readonly __zod_payload: ResP;
        readonly __descriptor: { readonly type: ResT };
        readonly __runtime: "ws-kit-schema";
      };
    readonly __zod_payload: ReqP;
    readonly __descriptor: { readonly type: ReqT };
    readonly __runtime: "ws-kit-schema";
  };

// Implementation
export function rpc<
  ReqT extends string,
  ReqP extends ZodRawShape | ZodObject<any> | undefined,
  ResT extends string,
  ResP extends ZodRawShape | ZodObject<any> | undefined,
>(
  specOrReqType:
    | {
        req: {
          type: ReqT;
          payload?: ReqP;
          meta?: ZodRawShape;
          options?: SchemaOpts;
        };
        res: {
          type: ResT;
          payload?: ResP;
          meta?: ZodRawShape;
          options?: SchemaOpts;
        };
      }
    | ReqT,
  requestPayload?: ReqP,
  responseType?: ResT,
  responsePayload?: ResP,
): ZodObject<any> &
  BrandedSchema<
    ReqT,
    ReqP extends undefined ? never : InferPayloadShape<ReqP>,
    ResP extends undefined ? never : InferPayloadShape<ResP>,
    {}
  > & {
    readonly kind: "rpc";
    readonly response: ZodObject<any> &
      BrandedSchema<
        ResT,
        ResP extends undefined ? never : InferPayloadShape<ResP>,
        never,
        {}
      > & {
        readonly kind: "event";
        readonly __zod_payload: ResP;
        readonly __descriptor: { readonly type: ResT };
        readonly __runtime: "ws-kit-schema";
      };
    readonly __zod_payload: ReqP;
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
    ...(reqOptions !== undefined ? { options: reqOptions } : {}),
  });

  // Build response schema using message() with per-response options
  const responseRoot = message({
    type: resType,
    payload: resPayload,
    ...(resOptions !== undefined ? { options: resOptions } : {}),
  });

  // Replace kind and attach response to request
  Object.defineProperties(requestRoot, {
    kind: { value: "rpc" as const, enumerable: false, configurable: true },
    response: { value: responseRoot, enumerable: false, configurable: true },
    responseType: { value: resType, enumerable: false },
  });

  return requestRoot as any;
}
