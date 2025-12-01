// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { MessageDescriptor } from "./message-descriptor.js";

/**
 * Symbol for branding schemas at the type level.
 * Purely type-level; not exposed at runtime.
 * @internal
 */
export declare const SchemaTag: unique symbol;

/**
 * Schema branded with type metadata for inference.
 * Works entirely at the type level using TypeScript utility types.
 * @internal
 */
export interface BrandedSchema<
  TType extends string = string,
  TPayload extends unknown = unknown,
  TResponse extends unknown = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly [SchemaTag]: {
    readonly type: TType;
    readonly payload: TPayload;
    readonly response: TResponse;
    readonly meta: TMeta;
  };
}

/**
 * Event message schema.
 */
export type MessageSchema = MessageDescriptor &
  BrandedSchema<string, unknown, never>;

/**
 * RPC request-response schema.
 */
export type RpcSchema = MessageDescriptor & {
  readonly response: MessageDescriptor;
} & BrandedSchema<string, unknown, unknown>;

/**
 * Union of all schema types.
 */
export type AnySchema = MessageSchema | RpcSchema;

/**
 * Extract payload type from a branded schema.
 */
export type InferPayload<S extends { readonly [SchemaTag]?: any }> = S extends {
  readonly [SchemaTag]: infer B;
}
  ? B extends { readonly payload: infer P }
    ? P
    : never
  : never;

/**
 * Extract response type from a branded RPC schema.
 */
export type InferResponse<S extends { readonly [SchemaTag]?: any }> =
  S extends {
    readonly [SchemaTag]: infer B;
  }
    ? B extends { readonly response: infer P }
      ? P
      : never
    : never;

/**
 * Extract message type literal from a branded schema.
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
 */
export type InferMeta<S extends { readonly [SchemaTag]?: any }> = S extends {
  readonly [SchemaTag]: infer B;
}
  ? B extends { readonly meta: infer M }
    ? M
    : never
  : never;

/**
 * Infer full message type from a branded schema (convenience alias).
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

export type { MessageDescriptor };
