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
  fallback,
  literal,
  number,
  optional,
  parseAsync,
  strictObject,
  string,
  safeParse as valibot_safeParse,
  type GenericSchema,
} from "valibot";
import {
  DESCRIPTOR,
  setSchemaOpts,
  type SchemaOpts,
} from "@ws-kit/core/internal";
import type {
  BrandedSchema,
  InferPayloadShape,
  InferMetaShape,
  SafeParseResult,
} from "./types.js";

/**
 * Symbol for Valibot payload schema (validator-specific).
 * Stores the Valibot schema for the payload field.
 */
export const VALIBOT_PAYLOAD = Symbol.for("@ws-kit/valibot-payload");

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
 * These are managed by the router/adapter layer and cannot be overridden in schema definitions.
 *
 * @internal
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
  P extends Record<string, GenericSchema> | GenericSchema | undefined =
    undefined,
  M extends Record<string, GenericSchema> | undefined = undefined,
>(spec: {
  readonly type: T;
  readonly payload?: P;
  readonly meta?: M;
  readonly options?: SchemaOpts;
}): GenericSchema &
  BrandedSchema<
    T,
    P extends undefined ? never : InferPayloadShape<P>,
    never,
    InferMetaShape<M>
  > & {
    readonly _types?: unknown;
    readonly __valibot_payload: P;
    readonly __descriptor: { readonly type: T; readonly kind: "event" };
    readonly __runtime: "ws-kit-schema";
    readonly safeParse: (data: unknown) => SafeParseResult;
    readonly parse: (data: unknown) => Promise<any>;
  };

// Positional form (compact)
export function message<
  const T extends string,
  P extends Record<string, GenericSchema> | GenericSchema | undefined =
    undefined,
  M extends Record<string, GenericSchema> | undefined = undefined,
>(
  type: T,
  payload?: P,
  metaShape?: M,
): GenericSchema &
  BrandedSchema<
    T,
    P extends undefined ? never : InferPayloadShape<P>,
    never,
    InferMetaShape<M>
  > & {
    readonly _types?: unknown;
    readonly __valibot_payload: P;
    readonly __descriptor: { readonly type: T; readonly kind: "event" };
    readonly __runtime: "ws-kit-schema";
    readonly safeParse: (data: unknown) => SafeParseResult;
    readonly parse: (data: unknown) => Promise<any>;
  };

// Implementation
export function message<
  T extends string,
  P extends Record<string, GenericSchema> | GenericSchema | undefined =
    undefined,
  M extends Record<string, GenericSchema> | undefined = undefined,
>(
  specOrType: { type: T; payload?: P; meta?: M; options?: SchemaOpts } | T,
  payload?: P,
  metaShape?: M,
): GenericSchema &
  BrandedSchema<
    T,
    P extends undefined ? never : InferPayloadShape<P>,
    never,
    InferMetaShape<M>
  > & {
    readonly __valibot_payload: P;
    readonly __descriptor: { readonly type: T; readonly kind: "event" };
    readonly __runtime: "ws-kit-schema";
    readonly safeParse: (data: unknown) => SafeParseResult;
    readonly parse: (data: unknown) => Promise<any>;
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

  // Valibot lacks .strict() method, so strictness is set at construction.
  // Pre-built schemas: used as-is. Raw shapes: wrapped in strictObject().
  const isPrebuiltSchema =
    payloadDef && typeof payloadDef === "object" && "parse" in payloadDef;
  const payloadObj = payloadDef
    ? isPrebuiltSchema
      ? (payloadDef as unknown as GenericSchema) // Pre-built schema, use as-is
      : strictObject(payloadDef as Record<string, GenericSchema>) // Raw shape, make strict
    : undefined;

  // Build root schema: { type, meta, payload? }
  const rootShape: Record<string, GenericSchema> = {
    type: literal(type),
    meta: fallback(metaObj, {}) as GenericSchema,
    ...(payloadObj ? { payload: payloadObj } : {}),
  };

  const root = strictObject(rootShape);

  // Attach non-enumerable runtime hints for router/plugin
  // Note: kind is stored in DESCRIPTOR symbol to avoid polluting Valibot's own kind property
  // DESCRIPTOR is configurable so rpc() can override kind from "event" to "rpc"
  Object.defineProperties(root, {
    type: { value: type, enumerable: false }, // Convenience property for quick access
    __runtime: { value: "ws-kit-schema" as const, enumerable: false },
    [DESCRIPTOR]: {
      value: { type, kind: "event" as const },
      enumerable: false,
      configurable: true,
    },
    [VALIBOT_PAYLOAD]: { value: payloadObj, enumerable: false },
    // Ergonomic parse API: schema.safeParse(data), schema.parse(data)
    parse: {
      value: (data: unknown) => parseAsync(root, data),
      enumerable: false,
    },
    safeParse: {
      value: (data: unknown) => {
        const result = valibot_safeParse(root, data);
        // Normalize to { data, issues } for Zod API compatibility
        return {
          success: result.success,
          data: result.success ? result.output : undefined,
          issues: result.issues,
        };
      },
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
  ReqM extends Record<string, GenericSchema> | undefined = undefined,
  ResM extends Record<string, GenericSchema> | undefined = undefined,
>(spec: {
  readonly req: {
    readonly type: ReqT;
    readonly payload?: ReqP;
    readonly meta?: ReqM;
    readonly options?: SchemaOpts;
  };
  readonly res: {
    readonly type: ResT;
    readonly payload?: ResP;
    readonly meta?: ResM;
    readonly options?: SchemaOpts;
  };
}): GenericSchema &
  BrandedSchema<
    ReqT,
    InferPayloadShape<ReqP>,
    InferPayloadShape<ResP>,
    InferMetaShape<ReqM>
  > & {
    readonly response: GenericSchema &
      BrandedSchema<
        ResT,
        InferPayloadShape<ResP>,
        never,
        InferMetaShape<ResM>
      > & {
        readonly _types?: unknown;
        readonly __valibot_payload: ResP;
        readonly __descriptor: { readonly type: ResT; readonly kind: "event" };
        readonly __runtime: "ws-kit-schema";
        readonly safeParse: (data: unknown) => SafeParseResult;
        readonly parse: (data: unknown) => Promise<any>;
      };
    readonly _types?: unknown;
    readonly __valibot_payload: ReqP;
    readonly __descriptor: { readonly type: ReqT; readonly kind: "rpc" };
    readonly __runtime: "ws-kit-schema";
    readonly safeParse: (data: unknown) => SafeParseResult;
    readonly parse: (data: unknown) => Promise<any>;
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
): GenericSchema &
  BrandedSchema<
    ReqT,
    InferPayloadShape<ReqP>,
    InferPayloadShape<ResP>,
    { timestamp?: number; correlationId?: string }
  > & {
    readonly response: GenericSchema &
      BrandedSchema<
        ResT,
        InferPayloadShape<ResP>,
        never,
        { timestamp?: number; correlationId?: string }
      > & {
        readonly _types?: unknown;
        readonly __valibot_payload: ResP;
        readonly __descriptor: { readonly type: ResT; readonly kind: "event" };
        readonly __runtime: "ws-kit-schema";
        readonly safeParse: (data: unknown) => SafeParseResult;
        readonly parse: (data: unknown) => Promise<any>;
      };
    readonly _types?: unknown;
    readonly __valibot_payload: ReqP;
    readonly __descriptor: { readonly type: ReqT; readonly kind: "rpc" };
    readonly __runtime: "ws-kit-schema";
    readonly safeParse: (data: unknown) => SafeParseResult;
    readonly parse: (data: unknown) => Promise<any>;
  };

// Implementation
export function rpc<
  ReqT extends string,
  ReqP extends Record<string, GenericSchema> | GenericSchema | undefined,
  ResT extends string,
  ResP extends Record<string, GenericSchema> | GenericSchema | undefined,
  ReqM extends Record<string, GenericSchema> | undefined = undefined,
  ResM extends Record<string, GenericSchema> | undefined = undefined,
>(
  specOrReqType:
    | {
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
      }
    | ReqT,
  requestPayload?: ReqP,
  responseType?: ResT,
  responsePayload?: ResP,
): any {
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

  // Attach response to request and override DESCRIPTOR to set kind="rpc"
  // Note: message() sets kind="event", so we need to replace DESCRIPTOR for RPC
  Object.defineProperties(requestRoot, {
    response: { value: responseRoot, enumerable: false, configurable: true },
    responseType: { value: resType, enumerable: false },
    [DESCRIPTOR]: {
      value: { type: reqType, kind: "rpc" as const },
      enumerable: false,
    },
  });

  return requestRoot as any;
}
