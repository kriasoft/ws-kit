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
import type { MessageDescriptor } from "@ws-kit/core";
import {
  DESCRIPTOR,
  ZOD_PAYLOAD,
  setSchemaOpts,
  type SchemaOpts,
} from "./metadata.js";

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
  M extends ZodRawShape = {},
>(spec: {
  readonly type: T;
  readonly payload?: P;
  readonly meta?: M;
  readonly options?: SchemaOpts;
}): ZodObject<any> & {
  readonly kind: "event";
  readonly __zod_payload: P;
  readonly __descriptor: { readonly type: T };
  readonly __runtime: "ws-kit-schema";
};

// Positional form (compact)
export function message<
  const T extends string,
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
): ZodObject<any> & {
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
>(spec: {
  readonly req: {
    readonly type: ReqT;
    readonly payload?: ReqP;
    readonly meta?: ZodRawShape;
    readonly options?: SchemaOpts;
  };
  readonly res: {
    readonly type: ResT;
    readonly payload?: ResP;
    readonly meta?: ZodRawShape;
    readonly options?: SchemaOpts;
  };
}): ZodObject<any> & {
  readonly kind: "rpc";
  readonly response: ZodObject<any>;
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
): ZodObject<any> & {
  readonly kind: "rpc";
  readonly response: ZodObject<any>;
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
): ZodObject<any> & {
  readonly kind: "rpc";
  readonly response: ZodObject<any>;
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
