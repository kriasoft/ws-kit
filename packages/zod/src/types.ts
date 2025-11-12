// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level schema branding and inference utilities.
 * All operations are compile-time only (zero runtime cost).
 */

import type { ZodObject, ZodRawShape, ZodType } from "zod";

/**
 * Symbol for branding schemas at the type level.
 * Purely type-level; not exposed at runtime.
 * @internal
 */
declare const SchemaTag: unique symbol;

/**
 * Schema branded with type metadata for inference.
 * Works entirely at the type level using TypeScript utility types.
 * @internal
 */
export interface BrandedSchema<
  TType extends string = string,
  TPayload extends unknown = unknown,
  TResponse extends unknown = never,
> {
  readonly [SchemaTag]: {
    readonly type: TType;
    readonly payload: TPayload;
    readonly response: TResponse extends never ? never : TResponse;
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
    ? B extends { readonly response: infer R }
      ? R extends never
        ? never
        : R
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
    ? M extends Record<string, any>
      ? Omit<M, "timestamp" | "correlationId">
      : Record<string, never>
    : Record<string, never>
  : Record<string, never>;

/**
 * Infer full message type from a branded schema (convenience alias).
 * Equivalent to z.infer<TSchema> but works with branded message schemas.
 *
 * @example
 * ```typescript
 * const Join = message("JOIN", { roomId: z.string() });
 * type Msg = InferMessage<typeof Join>;
 * // { type: "JOIN"; payload: { roomId: string }; ... }
 * ```
 */
export type InferMessage<S extends { readonly [SchemaTag]?: any }> = S extends {
  readonly [SchemaTag]: infer B;
}
  ? B
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
