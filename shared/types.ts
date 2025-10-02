// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { HeadersInit, Server, ServerWebSocket } from "bun";

export interface WebSocketRouterOptions {
  server?: Server;
}

/**
 * WebSocket connection data that always includes clientId (UUID v7).
 * INVARIANT: clientId is generated on connection and never changes.
 */
export type WebSocketData<T> = {
  /** Unique client identifier (UUID v7) generated on connection */
  clientId: string;
} & T;

/**
 * Options for upgrading HTTP request to WebSocket connection.
 * NOTE: data is merged with auto-generated clientId to form WebSocketData<T>.
 */
export interface UpgradeOptions<T> {
  /** Bun server instance for WebSocket upgrade */
  server: Server;
  /** Custom connection data, merged with clientId */
  data?: T;
  /** HTTP headers to send in upgrade response */
  headers?: HeadersInit;
}

export interface OpenHandlerContext<Data> {
  /** WebSocket connection with custom data */
  ws: ServerWebSocket<Data>;
  /** Type-safe send function for validated messages */
  send: SendFunction;
}

export type OpenHandler<Data = unknown> = (
  context: OpenHandlerContext<Data>,
) => void | Promise<void>;

export interface CloseHandlerContext<Data> {
  /** WebSocket connection with custom data */
  ws: ServerWebSocket<Data>;
  /** WebSocket close code */
  code: number;
  /** Optional close reason string */
  reason?: string;
  /** Type-safe send function for validated messages */
  send: SendFunction;
}

export type CloseHandler<Data = unknown> = (
  context: CloseHandlerContext<Data>,
) => void | Promise<void>;

/**
 * Generic validator-agnostic types that are specialized by Zod and Valibot adapters.
 * Each adapter provides strongly-typed versions in their respective modules.
 */

/** Generic send function, specialized by validator adapters */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendFunction = (schema: any, data: any, meta?: any) => void;

/**
 * Base message context before validator-specific typing.
 * Record<string, any> allows payload to be added via intersection.
 */
export type MessageContext<Data> = {
  /** WebSocket connection with custom data */
  ws: ServerWebSocket<Data>;
  /** Message metadata, typed by validator adapter */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  /** Type-safe send function for validated messages */
  send: SendFunction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Record<string, any>;

/**
 * Generic message handler signature.
 * NOTE: _Schema parameter exists for type consistency but isn't used in base type.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type MessageHandler<_Schema, Data> = (
  context: MessageContext<Data>,
) => void | Promise<void>;

/** Placeholder for validator-specific schema types */
export type MessageSchemaType = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}
