/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import type { InferOutput, ObjectSchema } from "valibot";

/**
 * Type-safe function for sending validated messages through WebSocket.
 * Uses nested conditionals to extract payload/meta types from Valibot's ObjectSchema entries.
 */
export type SendFunction = <Schema extends MessageSchemaType>(
  schema: Schema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Schema extends ObjectSchema<infer TEntries, any>
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TEntries extends Record<string, any>
      ? "payload" extends keyof TEntries
        ? InferOutput<TEntries["payload"]>
        : unknown
      : unknown
    : unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Schema extends ObjectSchema<infer TEntries, any>
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TEntries extends Record<string, any>
      ? "meta" extends keyof TEntries
        ? InferOutput<TEntries["meta"]>
        : unknown
      : unknown
    : unknown,
) => void;

/**
 * Handler context with type-safe payload/meta access from schema definition.
 * Uses intersection types to add payload only when schema defines it, avoiding
 * optional payload field that would require runtime checks.
 *
 * @see specs/adrs.md#ADR-001 - keyof check for discriminated unions
 */
export type MessageContext<Schema extends MessageSchemaType, Data> = {
  /** WebSocket connection with custom data */
  ws: ServerWebSocket<Data>;
  /** Message type extracted from schema */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: Schema extends ObjectSchema<infer TEntries, any>
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TEntries extends Record<string, any>
      ? "type" extends keyof TEntries
        ? InferOutput<TEntries["type"]>
        : unknown
      : unknown
    : unknown;
  /** Message metadata extracted from schema */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: Schema extends ObjectSchema<infer TEntries, any>
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TEntries extends Record<string, any>
      ? "meta" extends keyof TEntries
        ? InferOutput<TEntries["meta"]>
        : unknown
      : unknown
    : unknown;
  /** Type-safe send function for validated messages */
  send: SendFunction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & (Schema extends ObjectSchema<infer TEntries, any>
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TEntries extends Record<string, any>
    ? "payload" extends keyof TEntries
      ? { payload: InferOutput<TEntries["payload"]> }
      : Record<string, never>
    : Record<string, never>
  : Record<string, never>);

export type MessageHandler<Schema extends MessageSchemaType, Data> = (
  context: MessageContext<Schema, Data>,
) => void | Promise<void>;

/**
 * Base constraint for all message schemas created by messageSchema().
 * ObjectSchema with any entries allows flexible metadata structures.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageSchemaType = ObjectSchema<any, any>;

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}

/** Re-export shared types that are validator-agnostic. See: shared/types.ts */
export type {
  CloseHandler,
  CloseHandlerContext,
  OpenHandler,
  OpenHandlerContext,
  UpgradeOptions,
  WebSocketData,
  WebSocketRouterOptions,
} from "../shared/types";
