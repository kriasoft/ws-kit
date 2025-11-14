// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Types and interfaces for the validation plugin system.
 *
 * This module defines the core validation interfaces that validator-specific
 * plugins (withZod, withValibot) implement. It's in core (not in validators)
 * because these types are part of the framework's public API.
 *
 * See ADR-031 for plugin-adapter architecture.
 */

import type { ConnectionData } from "../../context/base-context";

/**
 * Generic validator adapter interface.
 *
 * Implementations (Zod, Valibot) provide concrete schema types and validation logic.
 * This interface is a marker for the validation capability in the type system.
 *
 * @typeParam TSchema - Schema type from the validator library (z.ZodSchema, v.BaseSchema, etc.)
 *
 * @example Implementation in @ws-kit/zod:
 * ```typescript
 * export const withZod = definePlugin<TContext, ValidationAPI>((router) => {
 *   // Validate inbound/outbound payloads using Zod
 *   // Add ctx.payload and RPC methods
 *   return { validation: true };
 * });
 * ```
 */
export interface ValidatorAdapter<TSchema = any> {
  /**
   * Validate a value against a schema.
   * Should never throw; instead return success/failure tuple.
   */
  validate(schema: TSchema, value: unknown): { success: boolean; error?: any };

  /**
   * Safely parse a value against a schema.
   * Returns either validated data or error information.
   */
  safeParse(schema: TSchema, value: unknown): any;
}

/**
 * Validation plugin capability interface.
 *
 * Added to the Router when a validation plugin (withZod, withValibot) is applied.
 * This enables type-safe RPC handlers and payload validation.
 *
 * @typeParam TContext - Per-connection data structure (ConnectionData)
 *
 * @example
 * ```typescript
 * const router = createRouter<MyContext>()
 *   .plugin(withZod())  // Adds validation capability
 *   .rpc(GetUser, (ctx) => {
 *     ctx.payload; //  Now typed from schema
 *     ctx.reply({ id: "123" });
 *   });
 * ```
 */
export interface ValidationAPI<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Marker for capability-gating in Router type system.
   * @internal
   */
  readonly validation: true;
}

/**
 * Validation plugin options (base interface).
 *
 * Concrete validators (Zod, Valibot) extend this with validator-specific options.
 *
 * @example In @ws-kit/zod:
 * ```typescript
 * export interface WithZodOptions extends ValidationOptions {
 *   validateOutgoing?: boolean;
 *   onValidationError?: (error, context) => void;
 * }
 * ```
 */
export interface ValidationOptions {
  /**
   * Validate outgoing payloads (send, reply, publish).
   * Default: true for safety, can be disabled for performance.
   */
  validateOutgoing?: boolean;

  /**
   * Hook for validation errors (inbound/outbound).
   * If provided, called instead of routing to router.onError().
   */
  onValidationError?: (
    error: Error & { code: string; details: any },
    context: {
      type: string;
      direction: "inbound" | "outbound";
      payload: unknown;
    },
  ) => void | Promise<void>;
}
