/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { HeadersInit, Server, ServerWebSocket } from "bun";

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

// Generic types that will be specialized by each validator
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendFunction = (schema: any, data: any, meta?: any) => void;

export type MessageContext<Data> = {
  ws: ServerWebSocket<Data>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  send: SendFunction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Record<string, any>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type MessageHandler<_Schema, Data> = (
  context: MessageContext<Data>,
) => void | Promise<void>;

export type MessageSchemaType = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}
