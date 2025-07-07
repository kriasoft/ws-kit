/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import type { InferOutput, ObjectSchema } from "valibot";

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

export type MessageContext<Schema extends MessageSchemaType, Data> = {
  ws: ServerWebSocket<Data>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: Schema extends ObjectSchema<infer TEntries, any>
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TEntries extends Record<string, any>
      ? "meta" extends keyof TEntries
        ? InferOutput<TEntries["meta"]>
        : unknown
      : unknown
    : unknown;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageSchemaType = ObjectSchema<any, any>;

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}

// Re-export shared types
export type {
  WebSocketRouterOptions,
  WebSocketData,
  UpgradeOptions,
  OpenHandlerContext,
  OpenHandler,
  CloseHandlerContext,
  CloseHandler,
} from "../shared/types";
