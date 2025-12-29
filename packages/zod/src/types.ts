// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level schema branding and inference utilities for Zod.
 * All operations are compile-time only (zero runtime cost).
 */

import type {
  BrandedSchema as CoreBrandedSchema,
  InferMessage as CoreInferMessage,
  InferMeta as CoreInferMeta,
  InferPayload as CoreInferPayload,
  InferResponse as CoreInferResponse,
  InferType as CoreInferType,
} from "@ws-kit/core";
import type { ZodObject } from "zod";

/**
 * Symbol for branding schemas at the type level.
 * Purely type-level; not exposed at runtime.
 * @internal
 */
export declare const SchemaTag: unique symbol;

/**
 * Schema branded with type metadata for inference.
 * Works entirely at the type level using TypeScript utility types.
 */
export interface BrandedSchema<
  TType extends string = string,
  TPayload extends unknown = unknown,
  TResponse extends unknown = unknown,
  TMeta extends Record<string, unknown> = Record<string, never>,
> extends CoreBrandedSchema<TType, TPayload, TResponse, TMeta> {
  readonly [SchemaTag]: {
    readonly type: TType;
    readonly payload: TPayload;
    readonly response: TResponse;
    readonly meta: TMeta;
  };
}

/**
 * Event message schema: a Zod object with message type hint.
 */
export type MessageSchema = ZodObject<any> & {
  readonly __descriptor: {
    readonly messageType: string;
    readonly kind: "event" | "rpc";
  };
};

/**
 * RPC request-response schema: a message schema with response definition.
 */
export type RpcSchema = MessageSchema & {
  readonly response: ZodObject<any>;
};

/**
 * Union of all schema types: event messages and RPC requests.
 */
export type AnySchema =
  | (MessageSchema & BrandedSchema)
  | (RpcSchema & BrandedSchema);

/**
 * Extract payload type from a branded schema.
 */
export type InferPayload<S extends CoreBrandedSchema> = CoreInferPayload<S>;

/**
 * Extract response type from a branded RPC schema.
 */
export type InferResponse<S extends CoreBrandedSchema> = CoreInferResponse<S>;

/**
 * Extract message type literal from a branded schema.
 */
export type InferType<S extends CoreBrandedSchema> = CoreInferType<S>;

/**
 * Extract extended meta fields from a branded schema.
 */
export type InferMeta<S extends CoreBrandedSchema> = CoreInferMeta<S>;

/**
 * Infer full message type from a branded schema (convenience alias).
 */
export type InferMessage<S extends CoreBrandedSchema> = CoreInferMessage<S>;
