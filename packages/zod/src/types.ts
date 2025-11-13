// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level schema branding and inference utilities.
 * All operations are compile-time only (zero runtime cost).
 */

import type { z, ZodObject, ZodRawShape, ZodType } from "zod";

/**
 * Symbol for branding schemas at the type level.
 * Purely type-level; not exposed at runtime.
 * @internal
 */
export declare const SchemaTag: unique symbol;

/**
 * Helper type to infer meta fields from ZodRawShape.
 * Converts ZodRawShape to inferred types.
 * @internal
 */
type InferMetaShape<M extends ZodRawShape | undefined> = M extends ZodRawShape
  ? M extends Record<string, infer V>
    ? V extends ZodType
      ? { [K in keyof M]: M[K] extends ZodType<infer U> ? U : never }
      : never
    : never
  : {};

/**
 * Schema branded with type metadata for inference.
 * Works entirely at the type level using TypeScript utility types.
 * @internal
 */
export interface BrandedSchema<
  TType extends string = string,
  TPayload extends unknown = unknown,
  TResponse extends unknown = never,
  TMeta extends Record<string, unknown> = Record<string, never>,
> {
  readonly [SchemaTag]: {
    readonly type: TType;
    readonly payload: TPayload;
    readonly response: TResponse extends never ? never : TResponse;
    readonly meta: TMeta;
  };
}

/**
 * Extract payload type from a branded schema.
 * Returns never if no payload is defined.
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: z.string() });
 * type Payload = InferPayload<typeof Join>; // { roomId: string }
 * ```
 */
export type InferPayload<S extends { readonly [SchemaTag]?: any }> = S extends {
  readonly [SchemaTag]: infer B;
}
  ? B extends { readonly payload: infer P }
    ? P extends never
      ? never
      : P
    : never
  : never;

/**
 * Extract response type from a branded RPC schema.
 * Returns never if no response is defined.
 *
 * @example
 * ```typescript
 * const GetUser = rpc("GET_USER", { id: z.string() }, "USER", { id: z.string(), name: z.string() });
 * type Response = InferResponse<typeof GetUser>; // { id: string, name: string }
 * ```
 */
export type InferResponse<S extends { readonly [SchemaTag]?: any }> =
  S extends {
    readonly [SchemaTag]: infer B;
  }
    ? B extends { readonly response: infer P }
      ? P extends never
        ? never
        : P extends ZodRawShape | ZodObject<any>
          ? P extends ZodRawShape
            ? { [K in keyof P]: P[K] extends ZodType<infer U> ? U : never }
            : P extends ZodObject<any>
              ? z.infer<P>
              : never
          : never
      : never
    : never;

/**
 * Extract message type literal from a branded schema.
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: z.string() });
 * type Type = InferType<typeof Join>; // "JOIN"
 * ```
 */
export type InferType<S extends { readonly [SchemaTag]?: any }> = S extends {
  readonly [SchemaTag]: infer B;
}
  ? B extends { readonly type: infer T }
    ? T
    : never
  : never;

/**
 * Extract extended meta fields from a branded schema.
 * Omits reserved keys (timestamp, correlationId) which are auto-injected by client.
 * Returns empty object if no meta is defined.
 *
 * @example
 * ```typescript
 * const ChatMsg = message("CHAT", { text: z.string() }, { roomId: z.string() });
 * type Meta = InferMeta<typeof ChatMsg>; // { roomId: string }
 * ```
 */
export type InferMeta<S extends { readonly [SchemaTag]?: any }> = S extends {
  readonly [SchemaTag]: infer B;
}
  ? B extends { readonly meta: infer M }
    ? M extends Record<string, unknown>
      ? Omit<M, "timestamp" | "correlationId">
      : never
    : never
  : never;

/**
 * Infer full message type from a branded schema (convenience alias).
 * Equivalent to z.infer<TSchema> but works with branded message schemas.
 * Excludes the response field (which is schema metadata, not part of the wire format).
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: z.string() });
 * type Msg = InferMessage<typeof Join>;
 * // { type: "JOIN"; meta: {...}; payload: { roomId: string } }
 * ```
 */
export type InferMessage<S extends { readonly [SchemaTag]?: any }> = S extends {
  readonly [SchemaTag]: infer B;
}
  ? B extends {
      readonly type: infer T;
      readonly payload: infer P;
      readonly meta: infer M;
    }
    ? { type: T; meta: M; payload: P extends never ? never : P }
    : never
  : never;

/**
 * Event message schema: a Zod object with message type hint.
 * Returned by message() builder for fire-and-forget messages.
 *
 * Exactly captures what ctx.send() and router.on() expect at runtime:
 * a real Zod schema with .safeParse() method and __descriptor metadata.
 */
export type MessageSchema = ZodObject<any> & {
  readonly __descriptor: { readonly type: string };
};

/**
 * RPC request-response schema: a message schema with response definition.
 * Returned by rpc() builder for request-response patterns.
 */
export type RpcSchema = MessageSchema & {
  readonly response: ZodObject<any>;
};

/**
 * Union of all schema types: event messages and RPC requests.
 * Use this for functions that accept any schema type.
 */
export type AnySchema = MessageSchema | RpcSchema;
