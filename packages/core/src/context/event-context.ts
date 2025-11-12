/**
 * Event handler context (after validation plugin adds payload).
 *
 * Extends MinimalContext with:
 * - payload: inferred from schema
 * - send(schema, payload): broadcast to clients
 */

import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { MinimalContext } from "./base-context";

export interface EventContext<TConn = unknown, TPayload = unknown>
  extends MinimalContext<TConn> {
  /**
   * Parsed + validated message payload.
   */
  readonly payload: TPayload;

  /**
   * Send event to other clients (1-to-many).
   * Available only in event handlers (kind="event").
   */
  send<T extends MessageDescriptor>(
    schema: T,
    payload: any, // InferPayload<T>
  ): Promise<void>;
}
