// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level schema branding and inference utilities.
 * All operations are compile-time only (zero runtime cost).
 */

import type { ZodObject, ZodRawShape, ZodType } from "zod";
import { z } from "zod";

/**
 * Symbol for branding schemas at the type level.
 * Purely type-level; not exposed at runtime.
 * @internal
 */
declare const SchemaBrand: unique symbol;

/**
 * Schema branded with type metadata for inference.
 * Works entirely at the type level using TypeScript utility types.
 * @internal
 */
export type BrandedSchema<
  TType extends string = string,
  TPayload extends unknown = unknown,
  TResponse extends unknown = never,
> = {
  readonly [SchemaBrand]: {
    readonly type: TType;
    readonly payload: TPayload;
    readonly response: TResponse extends never ? never : TResponse;
  };
};

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
export type InferPayload<S extends { readonly [SchemaBrand]?: any }> = S extends {
  readonly [SchemaBrand]: infer B;
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
export type InferResponse<S extends { readonly [SchemaBrand]?: any }> = S extends {
  readonly [SchemaBrand]: infer B;
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
export type InferType<S extends { readonly [SchemaBrand]?: any }> = S extends {
  readonly [SchemaBrand]: infer B;
}
  ? B extends { readonly type: infer T }
    ? T
    : never
  : never;
