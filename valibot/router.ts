/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { WebSocketRouter as BaseWebSocketRouter } from "../shared/router";
import { ValibotValidatorAdapter } from "./adapter";

/**
 * WebSocket router for Bun that provides type-safe message routing with Valibot validation.
 * Routes incoming messages to handlers based on message type.
 *
 * @template T - Application-specific data to store with each WebSocket connection.
 *               Always includes a clientId property generated automatically.
 */
export class WebSocketRouter<
  T extends Record<string, unknown> = Record<string, never>,
> extends BaseWebSocketRouter<T> {
  constructor() {
    super(new ValibotValidatorAdapter());
  }
}
