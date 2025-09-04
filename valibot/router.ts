/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { WebSocketRouter as BaseWebSocketRouter } from "../shared/router";
import { ValibotValidatorAdapter } from "./adapter";

/**
 * WebSocket router for Bun that provides type-safe message routing with Valibot validation.
 * Routes incoming messages to handlers based on message type.
 *
 * ARCHITECTURE: This is a thin wrapper that binds the Valibot validator adapter to the
 * shared router implementation. The adapter pattern allows swapping between Zod and
 * Valibot without duplicating routing logic.
 *
 * @template T - Application-specific data to store with each WebSocket connection.
 *               Always includes a clientId property generated automatically.
 *               Example: { userId: string, roles: string[] }
 */
export class WebSocketRouter<
  T extends Record<string, unknown> = Record<string, never>,
> extends BaseWebSocketRouter<T> {
  constructor() {
    // NOTE: ValibotValidatorAdapter handles schema validation and error formatting
    // specific to Valibot. The base router handles all routing and connection logic.
    super(new ValibotValidatorAdapter());
  }
}
