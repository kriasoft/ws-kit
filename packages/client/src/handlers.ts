// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Multi-handler dispatch for client-side message routing.
 * See @docs/specs/client.md#multiple-handlers and @docs/specs/rules.md#server-client-asymmetry.
 */

import type { AnyMessageSchema, MessageHandler } from "./types.js";

export class HandlerRegistry {
  // Multi-handler storage: type → array of handlers
  private handlers = new Map<string, MessageHandler[]>();

  // Schema storage for validation: type → schema
  private schemas = new Map<string, AnyMessageSchema>();

  /**
   * Registers a handler for a message type.
   * Returns unsubscribe function that removes only this handler.
   */
  register<S extends AnyMessageSchema>(
    schema: S,
    handler: MessageHandler,
    extractType: (schema: S) => string,
  ): () => void {
    const type = extractType(schema);

    // Store schema for validation (first registration wins)
    if (!this.schemas.has(type)) {
      this.schemas.set(type, schema);
    }

    // Add handler to array
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler);
    this.handlers.set(type, handlers);

    // Return unsubscribe function
    return () => {
      const current = this.handlers.get(type);
      if (current) {
        const index = current.indexOf(handler);
        if (index !== -1) {
          current.splice(index, 1);
        }
      }
    };
  }

  /**
   * Dispatches message to registered handlers.
   * Executes in registration order with error isolation.
   * Returns true if handlers were found, false otherwise.
   */
  dispatch(msg: { type: string; [key: string]: unknown }): boolean {
    const handlers = this.handlers.get(msg.type);
    if (!handlers || handlers.length === 0) {
      return false; // No handlers found
    }

    // Stable iteration: snapshot handlers array before dispatch
    // (allows unsubscribe during dispatch without affecting current iteration)
    const snapshot = [...handlers];

    for (const handler of snapshot) {
      try {
        handler(msg);
      } catch (error) {
        console.error(`[Client] Handler error for ${msg.type}:`, error);
        // Continue dispatching remaining handlers (error isolation)
      }
    }

    return true; // Handlers executed
  }

  /**
   * Gets schema for validation by message type.
   */
  getSchema(type: string): AnyMessageSchema | undefined {
    return this.schemas.get(type);
  }

  /**
   * Validates message against registered schema.
   * Returns { success: true, data } if validation succeeds.
   * Returns { success: false, reason: "no-schema" } if no schema registered.
   * Returns { success: false, reason: "validation-failed" } if validation fails.
   */
  validate(
    msg: unknown,
    safeParse: (
      schema: AnyMessageSchema,
      data: unknown,
    ) => { success: boolean; data?: unknown; error?: unknown },
  ):
    | { success: true; data: unknown }
    | { success: false; reason: "no-schema" }
    | { success: false; reason: "validation-failed"; error: unknown } {
    if (!msg || typeof msg !== "object" || !("type" in msg)) {
      return { success: false, reason: "validation-failed", error: null };
    }

    const type = (msg as { type: unknown }).type;
    if (typeof type !== "string") {
      return { success: false, reason: "validation-failed", error: null };
    }

    const schema = this.getSchema(type);
    if (!schema) {
      return { success: false, reason: "no-schema" }; // No schema registered
    }

    const result = safeParse(schema, msg);
    if (!result.success) {
      console.warn(`[Client] Validation failed for ${type}:`, result.error);
      return {
        success: false,
        reason: "validation-failed",
        error: result.error,
      };
    }

    return { success: true, data: result.data };
  }
}
