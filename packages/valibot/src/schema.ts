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
 * Factory function to create messageSchema using the consumer's Valibot instance.
 *
 * CRITICAL: This factory pattern is required to fix discriminated union support.
 * Without it, the library and consumer use different Valibot instances, causing
 * instanceof checks to fail and discriminatedUnion to throw runtime errors.
 *
 * The factory pattern ensures:
 * - Both library and app use the same Valibot instance (no dual package hazard)
 * - Validation works correctly with proper instanceof checks
 * - Type inference flows through without manual type assertions
 * - Schemas are composable and can be used in unions
 *
 * @param valibot - The Valibot instance from the consuming application
 * @returns Object with messageSchema function and related utilities
 *
 * @example Basic usage:
 * ```typescript
 * import * as v from "valibot";
 * import { createMessageSchema } from "@ws-kit/valibot";
 *
 * const { messageSchema } = createMessageSchema(v);
 * const PingSchema = messageSchema("PING");
 * ```
 *
 * @example Singleton pattern (recommended for apps):
 * ```typescript
 * // schemas/factory.ts
 * export const { messageSchema, createMessage } = createMessageSchema(v);
 *
 * // schemas/messages.ts
 * import { messageSchema } from "./factory";
 * const LoginSchema = messageSchema("LOGIN", { username: v.string() });
 * ```
 *
 * @example With discriminated unions:
 * ```typescript
 * const PingSchema = messageSchema("PING");
 * const PongSchema = messageSchema("PONG");
 *
 * // This now works correctly!
 * const MessageUnion = v.union([PingSchema, PongSchema]);
 * ```
 */
export function createMessageSchema(valibot: ValibotLike) {
  // Create base schemas using the provided Valibot instance
  const MessageMetadataSchema = valibot.strictObject({
    timestamp: valibot.optional(
      valibot.pipe(valibot.number(), valibot.integer(), valibot.minValue(1)),
    ),
    correlationId: valibot.optional(valibot.string()),
  });

  const ErrorCode = valibot.picklist([
    "INVALID_MESSAGE_FORMAT",
    "VALIDATION_FAILED",
    "UNSUPPORTED_MESSAGE_TYPE",
    "AUTHENTICATION_FAILED",
    "AUTHORIZATION_FAILED",
    "RESOURCE_NOT_FOUND",
    "RATE_LIMIT_EXCEEDED",
    "INTERNAL_SERVER_ERROR",
  ]);

  /**
   * Creates a type-safe WebSocket message schema with simplified overloads
   * for better cross-package type compatibility.
   */
  function messageSchema<T extends string>(
    messageType: T,
  ): ObjectSchema<BaseMessageEntries<T>, undefined>;

  function messageSchema<
    T extends string,
    P extends ObjectSchema<Record<string, GenericSchema>, undefined>,
  >(
    messageType: T,
    payload: P,
  ): ObjectSchema<MessageWithPayloadEntries<T, P["entries"]>, undefined>;

  function messageSchema<
    T extends string,
    P extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: P,
  ): ObjectSchema<MessageWithPayloadEntries<T, P>, undefined>;

  function messageSchema<
    T extends string,
    M extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: undefined,
    meta: M,
  ): ObjectSchema<MessageWithExtendedMetaEntries<T, M>, undefined>;

  function messageSchema<
    T extends string,
    P extends ObjectSchema<Record<string, GenericSchema>, undefined>,
    M extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: P,
    meta: M,
  ): ObjectSchema<
    MessageWithPayloadAndMetaEntries<T, P["entries"], M>,
    undefined
  >;

  function messageSchema<
    T extends string,
    P extends Record<string, GenericSchema>,
    M extends Record<string, GenericSchema>,
  >(
    messageType: T,
    payload: P,
    meta: M,
  ): ObjectSchema<MessageWithPayloadAndMetaEntries<T, P, M>, undefined>;

  function messageSchema<
    T extends string,
    P extends
      | Record<string, GenericSchema>
      | ObjectSchema<Record<string, GenericSchema>, undefined>
      | undefined = undefined,
    M extends Record<string, GenericSchema> = Record<string, never>,
  >(messageType: T, payload?: P, meta?: M) {
    // Validate that extended meta doesn't use reserved keys (fail-fast at schema creation)
    validateMetaSchema(meta);

    const metaSchema = meta
      ? valibot.strictObject({ ...MessageMetadataSchema.entries, ...meta })
      : MessageMetadataSchema;

    const baseSchema = {
      type: valibot.literal(messageType),
      meta: metaSchema,
    };

    if (payload === undefined) {
      return valibot.strictObject(baseSchema);
    }

    // Payloads can be a Valibot object or a raw shape
    const payloadSchema =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload as any).kind === "object"
        ? (payload as ObjectSchema<Record<string, GenericSchema>, undefined>)
        : valibot.strictObject(payload as Record<string, GenericSchema>);

    return valibot.strictObject({
      ...baseSchema,
      payload: payloadSchema,
    });
  }

  // Standard schemas used across most WebSocket applications
  const ErrorMessage = messageSchema("ERROR", {
    code: ErrorCode,
    message: valibot.optional(valibot.string()),
    context: valibot.optional(valibot.record(valibot.string(), valibot.any())),
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

    return valibot.safeParse(schema, messageData);
  }

  return {
    messageSchema,
    MessageMetadataSchema,
    ErrorCode,
    ErrorMessage,
    createMessage,
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
> = [P] extends [never]
  ? ObjectSchema<BaseMessageEntries<T>, undefined>
  : ObjectSchema<MessageWithPayloadEntries<T, P>, undefined>;

// Type helper for discriminated unions
export type AnyMessageSchema = ObjectSchema<
  {
    type: LiteralSchema<string, undefined>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: ObjectSchema<any, undefined>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: ObjectSchema<any, undefined>;
  },
  undefined
>;
