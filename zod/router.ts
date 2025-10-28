// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { WebSocketRouter as BaseWebSocketRouter } from "../packages/core/src/router";
import { ZodValidatorAdapter } from "../packages/zod/src/adapter";
import type {
  WebSocketData,
  MessageHandler as ZodMessageHandler,
  MessageSchemaType as ZodMessageSchemaType,
} from "../packages/zod/src/types";

/**
 * WebSocket router for Bun that provides type-safe message routing with Zod validation.
 * Routes incoming messages to handlers based on message type.
 *
 * ARCHITECTURE: This is a thin wrapper that binds the Zod validator adapter to the
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
    // NOTE: ZodValidatorAdapter handles schema validation and error formatting
    // specific to Zod. The base router handles all routing and connection logic.
    super(new ZodValidatorAdapter());
  }

  /**
   * Registers a message handler with Zod-specific type inference.
   *
   * This override provides validator-specific types for better IDE experience,
   * but creates a Liskov Substitution Principle variance issue. The more specific
   * handler signature means this class can't be used everywhere the base class is expected.
   * This is an intentional trade-off for better developer experience.
   *
   * @see specs/adrs.md#ADR-001 - Type override solution for IDE inference
   */
  // @ts-expect-error - Intentional override with more specific types for better DX
  onMessage<Schema extends ZodMessageSchemaType>(
    schema: Schema,
    handler: ZodMessageHandler<Schema, WebSocketData<T>>,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return super.onMessage(schema as any, handler as any);
  }
}
