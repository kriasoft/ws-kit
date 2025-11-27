// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level schema branding and inference utilities for Valibot.
 * All operations are compile-time only (zero runtime cost).
 */

import type { InferOutput, GenericSchema } from "valibot";
import type { BrandedSchema as CoreBrandedSchema } from "@ws-kit/core";

/**
 * Schema branded with type metadata for inference.
 * Works entirely at the type level using TypeScript utility types.
 * @internal
 */
export type BrandedSchema<
  TType extends string = string,
  TPayload extends unknown = unknown,
  TResponse extends unknown = unknown,
  TMeta extends Record<string, unknown> = Record<string, never>,
> = CoreBrandedSchema<TType, TPayload, TResponse, TMeta>;

/**
 * Helper type to infer actual types from GenericSchema.
 * Converts each Valibot schema in a shape to its inferred output type.
 *
 * @internal
 */
export type InferPayloadShape<
  P extends Record<string, GenericSchema> | GenericSchema | undefined,
> =
  P extends Record<string, GenericSchema>
    ? { [K in keyof P]: P[K] extends GenericSchema ? InferOutput<P[K]> : never }
    : P extends GenericSchema
      ? InferOutput<P>
      : never;

/**
 * Helper type to infer meta fields from a meta shape.
 * Includes standard fields (timestamp, correlationId) and extended fields.
 *
 * @internal
 */
export type InferMetaShape<
  M extends Record<string, GenericSchema> | undefined,
> =
  M extends Record<string, GenericSchema>
    ? { timestamp?: number; correlationId?: string } & {
        [K in keyof M]: M[K] extends GenericSchema ? InferOutput<M[K]> : never;
      }
    : { timestamp?: number; correlationId?: string };

/**
 * Event message schema: a Valibot schema with message type hint.
 * Returned by message() builder for fire-and-forget messages.
 *
 * Exactly captures what ctx.send() and router.on() expect at runtime:
 * a real Valibot schema with .safeParse() method and __descriptor metadata.
 */
export type MessageSchema = GenericSchema & {
  readonly __descriptor: { readonly type: string };
};

/**
 * RPC request-response schema: a message schema with response definition.
 * Returned by rpc() builder for request-response patterns.
 */
export type RpcSchema = MessageSchema & {
  readonly response: GenericSchema;
};

/**
 * Union of all schema types: event messages and RPC requests.
 * Use this for functions that accept any schema type.
 */
export type AnySchema =
  | (MessageSchema & BrandedSchema)
  | (RpcSchema & BrandedSchema);

/**
 * Extract message type literal from a branded schema.
 *
 * @example
 * ```typescript
 * const HelloOk = message("HELLO_OK", { text: v.string() });
 * type Type = InferType<typeof HelloOk>; // "HELLO_OK"
 * ```
 */
export type InferType<S> = S extends {
  readonly __descriptor: { readonly type: infer T };
}
  ? T
  : S extends BrandedSchema<infer T, any, any, any>
    ? T
    : S extends CoreBrandedSchema<infer T, any, any, any>
      ? T
      : never;

/**
 * Infer full inbound message type (as received by handlers).
 *
 * Includes optional timestamp/correlationId (may be present from client),
 * plus schema-defined extended meta and payload (if defined).
 *
 * @example
 * ```typescript
 * const HelloOk = message("HELLO_OK", { text: v.string() });
 * type Msg = InferMessage<typeof HelloOk>;
 * // { type: "HELLO_OK", meta: { timestamp?: number, correlationId?: string }, payload: { text: string } }
 *
 * client.on(HelloOk, (msg) => {
 *   msg.type // "HELLO_OK" (literal type)
 *   msg.meta.timestamp // number | undefined
 *   msg.payload.text // string
 * });
 * ```
 */
export type InferMessage<S> = S extends {
  readonly __descriptor: { readonly type: infer T };
}
  ? S extends {
      readonly __valibot_payload: infer PayloadDef extends
        | Record<string, GenericSchema>
        | GenericSchema
        | undefined;
    }
    ? {
        type: T;
        meta: { timestamp?: number; correlationId?: string };
        payload: InferPayloadShape<PayloadDef>;
      }
    : {
        type: T;
        meta: { timestamp?: number; correlationId?: string };
      }
  : never;

/**
 * Infer payload type from schema, or never if no payload defined.
 *
 * Returns `never` (not `undefined`) for no-payload schemas to enable
 * clean overload discrimination in send() and request() methods.
 *
 * @example
 * ```typescript
 * const WithPayload = message("MSG", { id: v.number() });
 * const NoPayload = message("PING");
 *
 * type P1 = InferPayload<typeof WithPayload>; // { id: number }
 * type P2 = InferPayload<typeof NoPayload>;   // never
 * ```
 */
export type InferPayload<S> = S extends {
  readonly __valibot_payload: infer P extends
    | Record<string, GenericSchema>
    | GenericSchema
    | undefined;
}
  ? InferPayloadShape<P>
  : never;

/**
 * Infer extended meta fields for outbound messages.
 *
 * Omits auto-injected fields (timestamp, correlationId) which are provided
 * via opts.meta or opts.correlationId. Only includes schema-defined extended meta.
 *
 * Used to enforce required extended meta fields at compile time for send/request.
 *
 * @example
 * ```typescript
 * const RoomMsg = message("CHAT", { text: v.string() }, { roomId: v.string() });
 * type Meta = InferMeta<typeof RoomMsg>; // { roomId: string }
 * // timestamp and correlationId are omitted (auto-injected by client)
 *
 * client.send(RoomMsg, { text: "hi" }, { meta: { roomId: "general" } });
 * ```
 */
export type InferMeta<S> = S extends {
  readonly __descriptor: { readonly type: infer T extends string };
}
  ? S extends BrandedSchema<T, any, any, infer M>
    ? M
    : S extends CoreBrandedSchema<T, any, any, infer M>
      ? M
      : never
  : never;

/**
 * Extract response type from an RPC schema.
 * Returns never if no response is defined.
 *
 * @example
 * ```typescript
 * const GetUser = rpc("GET_USER", { id: v.string() }, "USER", { id: v.string(), name: v.string() });
 * type Response = InferResponse<typeof GetUser>; // { id: string, name: string }
 * ```
 */
export type InferResponse<S> = S extends { readonly response: infer Res }
  ? Res extends {
      readonly __valibot_payload: infer P extends
        | Record<string, GenericSchema>
        | GenericSchema
        | undefined;
    }
    ? InferPayloadShape<P>
    : never
  : never;

/** Validator-agnostic safeParse result (Zod/Valibot compatible). */
export interface SafeParseResult<T = unknown> {
  readonly success: boolean;
  readonly data: T | undefined;
  readonly issues: readonly unknown[] | undefined;
}

/** Re-export shared types that are validator-agnostic. See: @ws-kit/core */
export type { WebSocketData } from "@ws-kit/core";
