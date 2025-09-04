/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import type { ZodObject, ZodType } from "zod";
import { z, ZodLiteral } from "zod";

// Type-safe function for sending validated messages through WebSocket.
// Extracts payload and meta types from the schema for compile-time validation.
export type SendFunction = <Schema extends MessageSchemaType>(
  schema: Schema,
  data: Schema["shape"] extends { payload: infer P }
    ? P extends ZodType
      ? z.infer<P>
      : unknown
    : unknown,
  meta?: z.infer<Schema["shape"]["meta"]>,
) => void;

// Handler context that conditionally includes payload based on schema definition.
// DESIGN: Uses intersection types to add payload only when schema defines it,
// avoiding optional payload field that would require runtime checks.
export type MessageContext<Schema extends MessageSchemaType, Data> = {
  ws: ServerWebSocket<Data>;
  meta: z.infer<Schema["shape"]["meta"]>;
  send: SendFunction;
} & (Schema["shape"] extends { payload: infer P }
  ? P extends ZodType
    ? { payload: z.infer<P> }
    : Record<string, never>
  : Record<string, never>);

export type MessageHandler<Schema extends MessageSchemaType, Data> = (
  context: MessageContext<Schema, Data>,
) => void | Promise<void>;

// Base constraint for all message schemas created by messageSchema().
// NOTE: type is ZodLiteral for exact string matching during routing.
// meta uses ZodType to be flexible with MessageMetadataSchema and its extensions
export type MessageSchemaType = ZodObject<{
  type: ZodLiteral<string>;
  meta: ZodType;
  payload?: ZodType;
}>;

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}

// Re-export shared types that are validator-agnostic
export type {
  WebSocketRouterOptions,
  WebSocketData,
  UpgradeOptions,
  OpenHandlerContext,
  OpenHandler,
  CloseHandlerContext,
  CloseHandler,
} from "../shared/types";
