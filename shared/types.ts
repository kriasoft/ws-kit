/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { HeadersInit, Server, ServerWebSocket } from "bun";

export interface WebSocketRouterOptions {
  server?: Server;
}

// WebSocket connection data that always includes clientId (UUID v7).
// INVARIANT: clientId is generated on connection and never changes.
export type WebSocketData<T> = {
  clientId: string;
} & T;

// Options for upgrading HTTP request to WebSocket connection.
// NOTE: data is merged with auto-generated clientId to form WebSocketData<T>.
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

// [GENERIC VALIDATOR TYPES]
// These use any to allow Zod and Valibot adapters to specialize them.
// Each adapter provides its own strongly-typed version.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendFunction = (schema: any, data: any, meta?: any) => void;

// Base message context before validator-specific typing.
// NOTE: Record<string, any> allows payload to be added via intersection.
export type MessageContext<Data> = {
  ws: ServerWebSocket<Data>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  send: SendFunction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Record<string, any>;

// Generic message handler signature.
// NOTE: _Schema parameter exists for type consistency but isn't used in base type.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type MessageHandler<_Schema, Data> = (
  context: MessageContext<Data>,
) => void | Promise<void>;

// Placeholder for validator-specific schema types
export type MessageSchemaType = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}
