// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { validateMetaSchema } from "@ws-kit/core";
import type { ZodObject, ZodRawShape, ZodType, z as zType } from "zod";

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
  boolean: (...args: any[]) => any;
  literal: (...args: any[]) => any;
  union: (...args: any[]) => any;
  discriminatedUnion: (...args: any[]) => any;
  optional: (...args: any[]) => any;
  record: (...args: any[]) => any;
  any: (...args: any[]) => any;
  enum: (...args: any[]) => any;
  instanceof: (...args: any[]) => any;
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

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type MessageWithResponseShape<T extends string, R extends ZodType> = {
  type: zType.ZodLiteral<T>;
  meta: ZodObject<{
    timestamp: zType.ZodOptional<zType.ZodNumber>;
    correlationId: zType.ZodOptional<zType.ZodString>;
  }>;
  response: R;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type MessageWithPayloadAndResponseShape<
  T extends string,
  P extends ZodType,
  R extends ZodType,
> = {
  type: zType.ZodLiteral<T>;
  meta: ZodObject<{
    timestamp: zType.ZodOptional<zType.ZodNumber>;
    correlationId: zType.ZodOptional<zType.ZodString>;
  }>;
  payload: P;
  response: R;
};

/**
 * @internal Internal implementation detail.
 *
 * Not part of public API. Use `message()` helper exported from `@ws-kit/zod` or `@ws-kit/valibot` instead.
 * This function is only exported to support internal module structure. End users should not import this directly.
 */
export function createMessageSchema(zod: ZodLike) {
  // Create base schemas using the provided Zod instance
  const MessageMetadataSchema = zod.object({
    timestamp: zod.number().int().positive().optional(),
    correlationId: zod.string().optional(),
    timeoutMs: zod.number().int().positive().optional(),
  });

  // Canonical ErrorCode enum from core (per ADR-015, gRPC-aligned, 13 codes)
  // Terminal: UNAUTHENTICATED, PERMISSION_DENIED, INVALID_ARGUMENT, FAILED_PRECONDITION,
  //          NOT_FOUND, ALREADY_EXISTS, ABORTED
  // Transient: DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, UNAVAILABLE
  // Server/evolution: UNIMPLEMENTED, INTERNAL, CANCELLED
  const ErrorCode = zod.enum([
    "UNAUTHENTICATED",
    "PERMISSION_DENIED",
    "INVALID_ARGUMENT",
    "FAILED_PRECONDITION",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "ABORTED",
    "DEADLINE_EXCEEDED",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "UNIMPLEMENTED",
    "INTERNAL",
    "CANCELLED",
  ]);

  /**
   * Creates a type-safe WebSocket message schema with simplified overloads
   * for better cross-package type compatibility.
   *
   * Supports two patterns:
   * 1. Legacy positional arguments: message(type, payload?, meta?)
   * 2. New config-based: message(type, { payload?, response?, meta? })
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

  // New config-based overloads for unified message + RPC API
  function messageSchema<T extends string, R extends ZodType>(
    messageType: T,
    config: { response: R },
  ): ZodObject<MessageWithResponseShape<T, R>>;

  function messageSchema<
    T extends string,
    P extends ZodObject<ZodRawShape>,
    R extends ZodType,
  >(
    messageType: T,
    config: { payload: P; response: R },
  ): ZodObject<MessageWithPayloadAndResponseShape<T, P, R>>;

  function messageSchema<
    T extends string,
    P extends ZodRawShape,
    R extends ZodType,
  >(
    messageType: T,
    config: { payload: P; response: R },
  ): ZodObject<MessageWithPayloadAndResponseShape<T, ZodObject<P>, R>>;

  function messageSchema<
    T extends string,
    P extends ZodObject<ZodRawShape> | ZodRawShape | undefined,
  >(
    messageType: T,
    config: { payload?: P; response?: never; meta?: ZodRawShape },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): ZodObject<any>;

  function messageSchema<
    T extends string,
    P extends ZodRawShape | ZodObject<ZodRawShape> | undefined = undefined,
    M extends ZodRawShape = Record<string, never>,
  >(
    messageType: T,
    payloadOrConfig?:
      | P
      | { payload?: P; response?: ZodType; meta?: ZodRawShape },
    meta?: M,
  ) {
    // Support both legacy positional args and new config-based API
    let actualPayload: P | undefined;
    let actualMeta: ZodRawShape | undefined;
    let responseSchema: ZodType | undefined;

    if (
      payloadOrConfig &&
      typeof payloadOrConfig === "object" &&
      !("_def" in payloadOrConfig) &&
      !Array.isArray(payloadOrConfig) &&
      ("payload" in payloadOrConfig ||
        "response" in payloadOrConfig ||
        "meta" in payloadOrConfig)
    ) {
      // Config object pattern: { payload?, response?, meta? }
      const config = payloadOrConfig as {
        payload?: P;
        response?: ZodType;
        meta?: ZodRawShape;
      };
      actualPayload = config.payload;
      responseSchema = config.response;
      actualMeta = config.meta;
    } else {
      // Legacy positional pattern: (type, payload?, meta?)
      actualPayload = payloadOrConfig as P | undefined;
      actualMeta = meta;
    }

    // Validate that extended meta doesn't use reserved keys (fail-fast at schema creation)
    validateMetaSchema(actualMeta);

    // Meta schema is strict to prevent client spoofing of server-controlled fields.
    // The router injects clientId and receivedAt AFTER validation (not before),
    // so the schema doesn't need to allow these fields.
    const metaSchema = (
      actualMeta
        ? MessageMetadataSchema.extend(actualMeta)
        : MessageMetadataSchema
    ).strict();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseSchema: any = {
      type: zod.literal(messageType),
      meta: metaSchema,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let schema: any;
    if (actualPayload === undefined) {
      schema = zod.object(baseSchema).strict();
    } else {
      // Payloads can be a Zod object or a raw shape
      const payloadSchema = (
        (actualPayload as { _def?: unknown })._def
          ? (actualPayload as ZodObject<ZodRawShape>)
          : zod.object(actualPayload as ZodRawShape)
      ).strict(); // Payload must also be strict

      schema = zod
        .object({
          ...baseSchema,
          payload: payloadSchema,
        })
        .strict();
    }

    // Attach response schema if provided (for RPC messages)
    if (responseSchema) {
      Object.defineProperty(schema, "response", {
        value: responseSchema,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }

    // Mark schema with validator identity for runtime compatibility checks
    // This allows the router to detect mismatched validators at registration time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (schema as any).__wsKitValidatorId = zod.constructor;

    return schema;
  }

  // Standard schemas used across most WebSocket applications
  const ErrorMessage = messageSchema("ERROR", {
    code: ErrorCode,
    message: zod.string().optional(),
    details: zod.record(zod.string(), zod.any()).optional(),
    retryable: zod.boolean().optional(),
    retryAfterMs: zod.number().int().positive().optional(),
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
   * @throws Error if requestType or responseType uses reserved prefix ($ws:)
   *
   * @example
   * ```typescript
   * const ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });
   *
   * // Use with client - response schema auto-detected
   * const result = await client.request(ping, { text: "hello" });
   *
   * // Use with router - still works like a normal message schema
   * router.rpc(ping, (ctx) => {
   *   ctx.reply!(ping.response, { reply: `Got: ${ctx.payload.text}` });
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
    // Validate reserved prefix at definition time (fail-fast)
    const RESERVED_PREFIX = "$ws:";
    if (requestType.startsWith(RESERVED_PREFIX)) {
      throw new Error(
        `Reserved prefix "${RESERVED_PREFIX}" not allowed in message type. ` +
          `RequestType "${requestType}" uses reserved prefix. ` +
          `See docs/adr/012-rpc-minimal-reliable.md#reserved-control-prefix`,
      );
    }
    if (responseType.startsWith(RESERVED_PREFIX)) {
      throw new Error(
        `Reserved prefix "${RESERVED_PREFIX}" not allowed in message type. ` +
          `ResponseType "${responseType}" uses reserved prefix. ` +
          `See docs/adr/012-rpc-minimal-reliable.md#reserved-control-prefix`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestSchema: any =
      requestPayload === undefined
        ? messageSchema(requestType)
        : messageSchema(
            requestType,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            requestPayload as any,
          );
    const responseSchema =
      responsePayload === undefined
        ? messageSchema(responseType)
        : messageSchema(
            responseType,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responsePayload as any,
          );

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
