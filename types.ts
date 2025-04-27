/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { HeadersInit, Server, ServerWebSocket } from "bun";
import { z, ZodLiteral, type ZodRawShape } from "zod";
import { MessageMetadataSchema } from "./schema";

export type WebSocketRouterOptions = {
  server?: Server;
};

export type WebSocketData<T> = {
  clientId: string;
} & T;

export type UpgradeOptions<T> = {
  server: Server;
  data?: T;
  headers?: HeadersInit;
};

export type SendFunction = <Schema extends MessageSchemaType>(
  schema: Schema,
  data: Schema["shape"] extends { payload: infer P }
    ? P extends z.ZodTypeAny
      ? z.infer<P>
      : unknown
    : unknown,
  meta?: z.infer<Schema["shape"]["meta"]>
) => void;

export type MessageContext<Schema extends MessageSchemaType, Data> = {
  ws: ServerWebSocket<Data>;
  meta: z.infer<Schema["shape"]["meta"]>;
  send: SendFunction;
} & (Schema["shape"] extends { payload: infer P }
  ? P extends z.ZodTypeAny
    ? { payload: z.infer<P> }
    : {}
  : {});

export type MessageHandler<Schema extends MessageSchemaType, Data> = (
  context: MessageContext<Schema, Data>
) => void | Promise<void>;

export type MessageSchemaType = z.ZodObject<
  {
    type: ZodLiteral<string>; // Must have a literal string type
    meta: typeof MessageMetadataSchema; // Must have compatible meta
  } & ZodRawShape // Allows for other fields like 'payload'
>;

export type MessageHandlerEntry = {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, any>;
};

export type OpenHandlerContext<Data> = {
  ws: ServerWebSocket<Data>;
  send: SendFunction;
};

export type OpenHandler<Data = any> = (
  context: OpenHandlerContext<Data>
) => void | Promise<void>;

export type CloseHandlerContext<Data> = {
  ws: ServerWebSocket<Data>;
  code: number;
  reason?: string;
  send: SendFunction;
};

export type CloseHandler<Data = any> = (
  context: CloseHandlerContext<Data>
) => void | Promise<void>;
