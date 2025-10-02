// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "bun";
import type { ZodObject, ZodType } from "zod";
import { z, ZodLiteral } from "zod";

/**
 * Type-safe function for sending validated messages through WebSocket.
 * Extracts payload/meta types from ZodObject shape for compile-time validation.
 */
export type SendFunction = <Schema extends MessageSchemaType>(
  schema: Schema,
  data: Schema["shape"] extends { payload: infer P }
    ? P extends ZodType
      ? z.infer<P>
      : unknown
    : unknown,
  meta?: z.infer<Schema["shape"]["meta"]>,
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
  /** Message type literal from schema */
  type: Schema["shape"]["type"]["value"];
  /** Message metadata inferred from schema */
  meta: z.infer<Schema["shape"]["meta"]>;
  /** Server receive timestamp (milliseconds since epoch) - authoritative for server logic */
  receivedAt: number;
  /** Type-safe send function for validated messages */
  send: SendFunction;
} & ("payload" extends keyof Schema["shape"]
  ? Schema["shape"]["payload"] extends ZodType
    ? { payload: z.infer<Schema["shape"]["payload"]> }
    : Record<string, never>
  : Record<string, never>);

export type MessageHandler<Schema extends MessageSchemaType, Data> = (
  context: MessageContext<Schema, Data>,
) => void | Promise<void>;

/**
 * Base constraint for all message schemas created by messageSchema().
 * type is ZodLiteral for exact string matching during routing.
 * meta uses ZodType to allow MessageMetadataSchema extensions.
 */
export type MessageSchemaType = ZodObject<{
  type: ZodLiteral<string>;
  meta: ZodType;
  payload?: ZodType;
}>;

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
