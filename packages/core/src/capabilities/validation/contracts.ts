/**
 * Validator adapter contract (core-level).
 * Actual validators (Zod, Valibot, custom) implement this interface.
 *
 * Core never creates validators; they are injected by plugins.
 */

import type { MessageDescriptor } from "../../protocol/message-descriptor";

/**
 * Validator: parses + validates message payloads against schemas.
 */
export interface ValidatorAdapter {
  /**
   * Validate incoming message against schema.
   * Returns validated payload or throws ValidationError.
   */
  validate(schema: MessageDescriptor, raw: unknown): unknown;

  /**
   * Validate outgoing payload against schema.
   * Used by ctx.send(), ctx.reply(), etc. to catch errors early.
   */
  validateOutgoing(schema: MessageDescriptor, payload: unknown): unknown;
}

/**
 * Context extensions provided by validation (used by handlers).
 */
export interface ValidationContext {
  /**
   * Validated payload (inferred from schema).
   */
  readonly payload: unknown;

  /**
   * Send event (only in event handlers).
   */
  send?(schema: MessageDescriptor, payload: unknown): Promise<void>;

  /**
   * RPC reply (only in RPC handlers).
   */
  reply?(payload: unknown): Promise<void>;

  /**
   * RPC progress (only in RPC handlers).
   */
  progress?(payload: unknown): Promise<void>;
}
