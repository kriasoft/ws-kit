// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  GenericSchema,
  LiteralSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  StringSchema,
} from "valibot";
import { validateMetaSchema } from "@ws-kit/core";

/**
 * Schema with safeParse method for compatibility with test expectations.
 * Wraps Valibot's ObjectSchema to add a safeParse method that normalizes
 * the result format to match Zod's { success, data, issues } structure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaWithSafeParse<T extends ObjectSchema<any, undefined>> = T & {
  safeParse(data: unknown): {
    success: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    issues: any;
  };
};

/**
 * Minimal interface for Valibot instance to avoid circular type references.
 * WARNING: Using `typeof v` directly causes TypeScript declaration generation to fail
 * with stack overflow errors. This interface captures only the methods we actually use.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface ValibotLike {
  object: (...args: any[]) => any;
  strictObject: (...args: any[]) => any;
  string: (...args: any[]) => any;
  number: (...args: any[]) => any;
  boolean: (...args: any[]) => any;
  literal: (...args: any[]) => any;
  union: (...args: any[]) => any;
  optional: (...args: any[]) => any;
  record: (...args: any[]) => any;
  any: (...args: any[]) => any;
  picklist: (...args: any[]) => any;
  pipe: (...args: any[]) => any;
  integer: (...args: any[]) => any;
  minValue: (...args: any[]) => any;
  safeParse: (...args: any[]) => any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Shape helper types for better cross-package type inference
 * These mirror the Zod implementation patterns exactly
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type BaseMessageEntries<T extends string> = {
  type: LiteralSchema<T, undefined>;
  meta: ObjectSchema<
    {
      timestamp: OptionalSchema<NumberSchema<undefined>, undefined>;
      correlationId: OptionalSchema<StringSchema<undefined>, undefined>;
    },
    undefined
  >;
};

type MessageWithPayloadEntries<
  T extends string,
  P extends Record<string, GenericSchema>,
> = BaseMessageEntries<T> & {
  payload: ObjectSchema<P, undefined>;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type MessageWithExtendedMetaEntries<
  T extends string,
  M extends Record<string, GenericSchema>,
> = {
  type: LiteralSchema<T, undefined>;
  meta: ObjectSchema<
    {
      timestamp: OptionalSchema<NumberSchema<undefined>, undefined>;
      correlationId: OptionalSchema<StringSchema<undefined>, undefined>;
    } & M,
    undefined
  >;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type MessageWithPayloadAndMetaEntries<
  T extends string,
  P extends Record<string, GenericSchema>,
  M extends Record<string, GenericSchema>,
> = {
  type: LiteralSchema<T, undefined>;
  meta: ObjectSchema<
    {
      timestamp: OptionalSchema<NumberSchema<undefined>, undefined>;
      correlationId: OptionalSchema<StringSchema<undefined>, undefined>;
    } & M,
    undefined
  >;
  payload: ObjectSchema<P, undefined>;
};

/**
 * @internal Internal implementation detail.
 *
 * Not part of public API. Use `message()` helper exported from `@ws-kit/zod` or `@ws-kit/valibot` instead.
 * This function is only exported to support internal module structure. End users should not import this directly.
 */
export function createMessageSchema(valibot: ValibotLike) {
  // Create base schemas using the provided Valibot instance
  const MessageMetadataSchema = valibot.strictObject({
    timestamp: valibot.optional(
      valibot.pipe(valibot.number(), valibot.integer(), valibot.minValue(1)),
    ),
    correlationId: valibot.optional(valibot.string()),
    timeoutMs: valibot.optional(
      valibot.pipe(valibot.number(), valibot.integer(), valibot.minValue(1)),
    ),
  });

  // Canonical ErrorCode enum from core (per ADR-015, gRPC-aligned, 13 codes)
  // Terminal: UNAUTHENTICATED, PERMISSION_DENIED, INVALID_ARGUMENT, FAILED_PRECONDITION,
  //          NOT_FOUND, ALREADY_EXISTS, ABORTED
  // Transient: DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, UNAVAILABLE
  // Server/evolution: UNIMPLEMENTED, INTERNAL, CANCELLED
  const ErrorCode = valibot.picklist([
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
   */
  function messageSchema<T extends string>(
    messageType: T,
  ): SchemaWithSafeParse<ObjectSchema<BaseMessageEntries<T>, undefined>>;

  function messageSchema<T extends string>(
    messageType: T,
    payload: undefined,
  ): SchemaWithSafeParse<ObjectSchema<BaseMessageEntries<T>, undefined>>;

  function messageSchema<
    T extends string,
    P extends ObjectSchema<Record<string, GenericSchema>, undefined>,
  >(
    messageType: T,
    payload: P,
  ): SchemaWithSafeParse<
    ObjectSchema<MessageWithPayloadEntries<T, P["entries"]>, undefined>
  >;

  function messageSchema<
    T extends string,
    P extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: P,
  ): SchemaWithSafeParse<
    ObjectSchema<MessageWithPayloadEntries<T, P>, undefined>
  >;

  function messageSchema<
    T extends string,
    M extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: undefined,
    meta: M,
  ): SchemaWithSafeParse<
    ObjectSchema<MessageWithExtendedMetaEntries<T, M>, undefined>
  >;

  function messageSchema<
    T extends string,
    P extends ObjectSchema<Record<string, GenericSchema>, undefined>,
    M extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: P,
    meta: M,
  ): SchemaWithSafeParse<
    ObjectSchema<
      MessageWithPayloadAndMetaEntries<T, P["entries"], M>,
      undefined
    >
  >;

  function messageSchema<
    T extends string,
    P extends Record<string, GenericSchema>,
    M extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: P,
    meta: M,
  ): SchemaWithSafeParse<
    ObjectSchema<MessageWithPayloadAndMetaEntries<T, P, M>, undefined>
  >;

  function messageSchema<
    T extends string,
    P extends
      | Record<string, GenericSchema>
      | ObjectSchema<Record<string, GenericSchema>, undefined>
      | undefined = undefined,
    M extends Record<string, GenericSchema> = Record<string, never>,
  >(
    messageType: T,
    payloadOrConfig?:
      | P
      | {
          payload?: P;
          response?: GenericSchema;
          meta?: Record<string, GenericSchema>;
        },
    meta?: M,
  ) {
    // Support both legacy positional args and new config-based API
    let actualPayload: P | undefined;
    let actualMeta: Record<string, GenericSchema> | undefined;
    let responseSchema: GenericSchema | undefined;

    if (
      payloadOrConfig &&
      typeof payloadOrConfig === "object" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payloadOrConfig as any).type !== "object" &&
      !Array.isArray(payloadOrConfig) &&
      ("payload" in payloadOrConfig ||
        "response" in payloadOrConfig ||
        "meta" in payloadOrConfig)
    ) {
      // Config object pattern: { payload?, response?, meta? }
      const config = payloadOrConfig as {
        payload?: P;
        response?: GenericSchema;
        meta?: Record<string, GenericSchema>;
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
    const metaSchema = actualMeta
      ? valibot.strictObject({
          timestamp: valibot.optional(
            valibot.pipe(
              valibot.number(),
              valibot.integer(),
              valibot.minValue(1),
            ),
          ),
          correlationId: valibot.optional(valibot.string()),
          ...actualMeta,
        })
      : valibot.strictObject({
          timestamp: valibot.optional(
            valibot.pipe(
              valibot.number(),
              valibot.integer(),
              valibot.minValue(1),
            ),
          ),
          correlationId: valibot.optional(valibot.string()),
        });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseSchema: any = {
      type: valibot.literal(messageType),
      meta: metaSchema,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let schema: ObjectSchema<any, undefined>;

    if (actualPayload === undefined) {
      schema = valibot.strictObject(baseSchema);
    } else {
      // Payloads can be a Valibot object or a raw shape
      const payloadSchema =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (actualPayload as any).type === "object"
          ? (actualPayload as ObjectSchema<
              Record<string, GenericSchema>,
              undefined
            >)
          : valibot.strictObject(
              actualPayload as Record<string, GenericSchema>,
            );

      schema = valibot.strictObject({
        ...baseSchema,
        payload: payloadSchema,
      });
    }

    // Add safeParse method to make schema compatible with generic client
    // Normalize Valibot's result format to match Zod's format (.data instead of .output)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (schema as any).safeParse = function (data: unknown) {
      const result = valibot.safeParse(schema, data);
      return {
        success: result.success,
        data: result.success ? result.output : undefined,
        issues: result.issues,
      };
    };

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
    (schema as any).__wsKitValidatorId = valibot.constructor;

    return schema;
  }

  // Standard schemas used across most WebSocket applications
  const ErrorMessage = messageSchema("ERROR", {
    code: ErrorCode,
    message: valibot.optional(valibot.string()),
    details: valibot.optional(valibot.record(valibot.string(), valibot.any())),
    retryable: valibot.optional(valibot.boolean()),
    retryAfterMs: valibot.optional(
      valibot.pipe(valibot.number(), valibot.integer(), valibot.minValue(1)),
    ),
  });

  // Client-side helper: validates and creates messages for sending
  function createMessage(
    schema: MessageSchemaType,
    payload?: unknown,
    meta?: Record<string, unknown>,
  ) {
    const messageData = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: (schema.entries.type as any).literal,
      ...(payload !== undefined && { payload }),
      meta: meta || {},
    };

    // Normalize Valibot's result format to match Zod's format
    const valibotResult = valibot.safeParse(schema, messageData);
    return {
      success: valibotResult.success,
      data: valibotResult.success ? valibotResult.output : undefined,
      issues: valibotResult.issues,
    };
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
   * const ping = rpc("PING", { text: v.string() }, "PONG", { reply: v.string() });
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
    ReqP extends
      | Record<string, GenericSchema>
      | ObjectSchema<Record<string, GenericSchema>, undefined>
      | undefined = undefined,
    ResT extends string = string,
    ResP extends
      | Record<string, GenericSchema>
      | ObjectSchema<Record<string, GenericSchema>, undefined>
      | undefined = undefined,
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
type MessageSchemaType = ObjectSchema<
  {
    type: LiteralSchema<string, undefined>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: ObjectSchema<any, undefined>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: ObjectSchema<any, undefined>;
  },
  undefined
>;

// Enhanced type helper for better cross-package inference (mirrors Zod version)
export type MessageSchema<
  T extends string,
  P extends Record<string, GenericSchema> = never,
> = SchemaWithSafeParse<
  [P] extends [never]
    ? ObjectSchema<BaseMessageEntries<T>, undefined>
    : ObjectSchema<MessageWithPayloadEntries<T, P>, undefined>
>;

// Type helper for discriminated unions
export type AnyMessageSchema = SchemaWithSafeParse<
  ObjectSchema<
    {
      type: LiteralSchema<string, undefined>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      meta: ObjectSchema<any, undefined>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload?: ObjectSchema<any, undefined>;
    },
    undefined
  >
>;
