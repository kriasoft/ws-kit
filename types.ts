/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { HeadersInit, Server, ServerWebSocket } from "bun";
import type { ZodObject, ZodType, ZodTypeAny } from "zod";
import { z, ZodLiteral } from "zod";
import { MessageMetadataSchema } from "./schema";

export interface WebSocketRouterOptions {
  server?: Server;
}

export type WebSocketData<T> = {
  clientId: string;
} & T;

export interface UpgradeOptions<T> {
  server: Server;
  data?: T;
  headers?: HeadersInit;
}

export type SendFunction = <Schema extends MessageSchemaType>(
  schema: Schema,
  data: Schema["shape"] extends { payload: infer P }
    ? P extends ZodTypeAny
      ? z.infer<P>
      : unknown
    : unknown,
  meta?: z.infer<Schema["shape"]["meta"]>,
) => void;

export type MessageContext<Schema extends MessageSchemaType, Data> = {
  ws: ServerWebSocket<Data>;
  meta: z.infer<Schema["shape"]["meta"]>;
  send: SendFunction;
} & (Schema["shape"] extends { payload: infer P }
  ? P extends ZodTypeAny
    ? { payload: z.infer<P> }
    : Record<string, never>
  : Record<string, never>);

export type MessageHandler<Schema extends MessageSchemaType, Data> = (
  context: MessageContext<Schema, Data>,
) => void | Promise<void>;

export type MessageSchemaType = ZodObject<{
  type: ZodLiteral<string>; // Must have a literal string type
  meta: ZodType<z.infer<typeof MessageMetadataSchema>>;
  payload?: ZodTypeAny;
}>;

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}

export interface OpenHandlerContext<Data> {
  ws: ServerWebSocket<Data>;
  send: SendFunction;
}

export type OpenHandler<Data = unknown> = (
  context: OpenHandlerContext<Data>,
) => void | Promise<void>;

export interface CloseHandlerContext<Data> {
  ws: ServerWebSocket<Data>;
  code: number;
  reason?: string;
  send: SendFunction;
}

export type CloseHandler<Data = unknown> = (
  context: CloseHandlerContext<Data>,
) => void | Promise<void>;
