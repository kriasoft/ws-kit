/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import type { ZodObject, ZodType, ZodTypeAny } from "zod";
import { z, ZodLiteral } from "zod";

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
  type: ZodLiteral<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: ZodType<any>;
  payload?: ZodTypeAny;
}>;

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
