// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ZodObject, ZodRawShape, ZodType, z as zType } from "zod";
import { validateMetaSchema } from "@ws-kit/core";

/**
 * Minimal interface for Zod instance to avoid circular type references.
 * WARNING: Using `typeof z` directly causes TypeScript declaration generation to fail
 * with stack overflow errors. This interface captures only the methods we actually use.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface ZodLike {
  object: (...args: any[]) => any;
  string: (...args: any[]) => any;
  number: (...args: any[]) => any;
  literal: (...args: any[]) => any;
  union: (...args: any[]) => any;
  discriminatedUnion: (...args: any[]) => any;
  optional: (...args: any[]) => any;
  record: (...args: any[]) => any;
  any: (...args: any[]) => any;
  enum: (...args: any[]) => any;
  instanceof: (...args: any[]) => any;
  ZodType?: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Type helper utilities for better cross-package type inference
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type BaseMessageShape<T extends string> = {
  type: zType.ZodLiteral<T>;
  meta: ZodObject<{
    timestamp: zType.ZodOptional<zType.ZodNumber>;
    correlationId: zType.ZodOptional<zType.ZodString>;
  }>;
};

type MessageWithPayloadShape<
  T extends string,
  P extends ZodType,
> = BaseMessageShape<T> & {
  payload: P;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type MessageWithExtendedMetaShape<T extends string, M extends ZodRawShape> = {
  type: zType.ZodLiteral<T>;
  meta: ZodObject<
    {
      timestamp: zType.ZodOptional<zType.ZodNumber>;
      correlationId: zType.ZodOptional<zType.ZodString>;
    } & M
  >;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type MessageWithPayloadAndMetaShape<
  T extends string,
  P extends ZodType,
  M extends ZodRawShape,
> = {
  type: zType.ZodLiteral<T>;
  meta: ZodObject<
    {
      timestamp: zType.ZodOptional<zType.ZodNumber>;
      correlationId: zType.ZodOptional<zType.ZodString>;
    } & M
  >;
  payload: P;
};

/**
 * Factory function to create messageSchema using the consumer's Zod instance.
 *
 * CRITICAL: This factory pattern is required to fix discriminated union support.
 * Without it, the library and consumer use different Zod instances, causing
 * instanceof checks to fail and discriminatedUnion to throw runtime errors.
 *
 * The factory pattern ensures:
 * - Both library and app use the same Zod instance (no dual package hazard)
 * - Discriminated unions work correctly with proper instanceof checks
 * - Type inference flows through without manual type assertions
 * - Schemas are composable and can be used in unions
 *
 * @param zod - The Zod instance from the consuming application
 * @returns Object with messageSchema function and related utilities
 *
 * @example Basic usage:
 * ```typescript
 * import { z } from "zod";
 * import { createMessageSchema } from "@ws-kit/zod";
 *
 * const { messageSchema } = createMessageSchema(z);
 * const PingSchema = messageSchema("PING");
 * ```
 *
 * @example Singleton pattern (recommended for apps):
 * ```typescript
 * // schemas/factory.ts
 * export const { messageSchema, createMessage } = createMessageSchema(z);
 *
 * // schemas/messages.ts
 * import { messageSchema } from "./factory";
 * const LoginSchema = messageSchema("LOGIN", { username: z.string() });
 * ```
 *
 * @example With discriminated unions:
 * ```typescript
 * const PingSchema = messageSchema("PING");
 * const PongSchema = messageSchema("PONG");
 *
 * // This now works correctly!
 * const MessageUnion = z.discriminatedUnion("type", [PingSchema, PongSchema]);
 * ```
 */
export function createMessageSchema(zod: ZodLike) {
  // Create base schemas using the provided Zod instance
  const MessageMetadataSchema = zod.object({
    timestamp: zod.number().int().positive().optional(),
    correlationId: zod.string().optional(),
  });

  // Import canonical ErrorCode enum from core
  const ErrorCode = zod.enum([
    "VALIDATION_ERROR",
    "AUTH_ERROR",
    "INTERNAL_ERROR",
    "NOT_FOUND",
    "RATE_LIMIT",
  ]);

  /**
   * Creates a type-safe WebSocket message schema with simplified overloads
   * for better cross-package type compatibility.
   */
  function messageSchema<T extends string>(
    messageType: T,
  ): ZodObject<BaseMessageShape<T>>;

  function messageSchema<T extends string, P extends ZodObject<ZodRawShape>>(
    messageType: T,
    payload: P,
  ): ZodObject<MessageWithPayloadShape<T, P>>;

  function messageSchema<T extends string, P extends ZodRawShape>(
    messageType: T,
    payload: P,
  ): ZodObject<MessageWithPayloadShape<T, ZodObject<P>>>;

  function messageSchema<T extends string, M extends ZodRawShape>(
    messageType: T,
    payload: undefined,
    meta: M,
  ): ZodObject<MessageWithExtendedMetaShape<T, M>>;

  function messageSchema<
    T extends string,
    P extends ZodObject<ZodRawShape>,
    M extends ZodRawShape,
  >(
    messageType: T,
    payload: P,
    meta: M,
  ): ZodObject<MessageWithPayloadAndMetaShape<T, P, M>>;

  function messageSchema<
    T extends string,
    P extends ZodRawShape,
    M extends ZodRawShape,
  >(
    messageType: T,
    payload: P,
    meta: M,
  ): ZodObject<MessageWithPayloadAndMetaShape<T, ZodObject<P>, M>>;

  function messageSchema<
    T extends string,
    P extends ZodRawShape | ZodObject<ZodRawShape> | undefined = undefined,
    M extends ZodRawShape = Record<string, never>,
  >(messageType: T, payload?: P, meta?: M) {
    // Validate that extended meta doesn't use reserved keys (fail-fast at schema creation)
    validateMetaSchema(meta);

    // Meta schema is strict to prevent client spoofing of server-controlled fields.
    // The router injects clientId and receivedAt AFTER validation (not before),
    // so the schema doesn't need to allow these fields.
    const metaSchema = (
      meta ? MessageMetadataSchema.extend(meta) : MessageMetadataSchema
    ).strict();

    const baseSchema = {
      type: zod.literal(messageType),
      meta: metaSchema,
    };

    let schema: any;
    if (payload === undefined) {
      schema = zod.object(baseSchema).strict();
    } else {
      // Payloads can be a Zod object or a raw shape
      const payloadSchema = (
        (payload as { _def?: unknown })._def
          ? (payload as ZodObject<ZodRawShape>)
          : zod.object(payload as ZodRawShape)
      ).strict(); // Payload must also be strict

      schema = zod
        .object({
          ...baseSchema,
          payload: payloadSchema,
        })
        .strict();
    }

    // Mark schema with validator identity for runtime compatibility checks
    // This allows the router to detect mismatched validators at registration time
    (schema as any).__wsKitValidatorId = zod.constructor;

    return schema;
  }

  // Standard schemas used across most WebSocket applications
  const ErrorMessage = messageSchema("ERROR", {
    code: ErrorCode,
    message: zod.string().optional(),
    details: zod.record(zod.string(), zod.any()).optional(),
  });

  // Client-side helper: validates and creates messages for sending
  function createMessage<T extends MessageSchemaType>(
    schema: T,
    payload: T["shape"]["payload"] extends ZodType
      ? zType.infer<T["shape"]["payload"]>
      : undefined,
    meta?: Partial<zType.infer<T["shape"]["meta"]>>,
  ) {
    const messageData = {
      type: schema.shape.type.value,
      ...(payload !== undefined && { payload }),
      meta: meta || {},
    };

    return schema.safeParse(messageData);
  }

  /**
   * Creates a type-safe RPC schema that binds request and response message types.
   *
   * This helper eliminates repetition when defining request-response patterns by
   * attaching the response schema to the request schema as a property.
   *
   * @param requestType - Message type for the request
   * @param requestPayload - Validation schema for request payload
   * @param responseType - Message type for the response
   * @param responsePayload - Validation schema for response payload
   * @returns Message schema with attached .response property
   *
   * @example
   * ```typescript
   * const ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });
   *
   * // Use with client - response schema auto-detected
   * const result = await client.request(ping, { text: "hello" });
   *
   * // Use with router - still works like a normal message schema
   * router.on(ping, (ctx) => {
   *   ctx.reply({ reply: `Got: ${ctx.payload.text}` });
   * });
   * ```
   */
  function rpc<
    ReqT extends string,
    ReqP extends ZodRawShape | ZodObject<ZodRawShape> | undefined = undefined,
    ResT extends string = string,
    ResP extends ZodRawShape | ZodObject<ZodRawShape> | undefined = undefined,
  >(
    requestType: ReqT,
    requestPayload: ReqP,
    responseType: ResT,
    responsePayload: ResP,
  ) {
    const requestSchema = messageSchema(
      requestType,
      requestPayload as ReqP,
    ) as any;
    const responseSchema = messageSchema(responseType, responsePayload as ResP);

    // Attach response schema as non-enumerable property to avoid breaking schema iteration
    Object.defineProperty(requestSchema, "response", {
      value: responseSchema,
      enumerable: false,
      configurable: true,
      writable: true,
    });

    // Also attach response type for convenience
    Object.defineProperty(requestSchema, "responseType", {
      value: responseType,
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return requestSchema;
  }

  return {
    messageSchema,
    MessageMetadataSchema,
    ErrorCode,
    ErrorMessage,
    createMessage,
    rpc,
  };
}

// Type constraint for schemas created by messageSchema
type MessageSchemaType = ZodObject<{
  type: zType.ZodLiteral<string>;
  meta: ZodType;
  payload?: ZodType;
}>;

// Enhanced type helper for better cross-package inference
export type MessageSchema<T extends string, P extends ZodType = never> = [
  P,
] extends [never]
  ? ZodObject<BaseMessageShape<T>>
  : ZodObject<MessageWithPayloadShape<T, P>>;

// Type helper for discriminated unions
export type AnyMessageSchema = ZodObject<{
  type: zType.ZodLiteral<string>;
  meta: ZodType;
  payload?: ZodType;
}>;
