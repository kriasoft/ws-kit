// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Types for test harness: TestRouter, TestConnection, and frame records.
 */

import type { Router } from "../core/router";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { Clock } from "./fake-clock";

/**
 * Outgoing frame: message sent from server to client via ctx.send() or publish.
 */
export interface OutgoingFrame {
  type: string;
  payload?: unknown;
  meta?: Record<string, unknown>;
  // Correlation ID for RPC responses (if present)
  // For control messages like $ws:rpc-progress, the correlation ID is in meta.correlationId
  _rpcId?: string;
}

/**
 * Publish record: message broadcast via router.publish().
 *
 * **Note**: When captured via pub/sub observer (test harness), the `schema` field
 * will be undefined since the adapter layer only has access to the message type (string).
 * For assertions, you typically check `topic` and `payload`.
 */
export interface PublishRecord {
  topic: string;
  schema?: MessageDescriptor;
  payload: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Test connection: models a single in-memory WebSocket connection.
 */
export interface TestConnection<TContext = unknown> {
  /**
   * Unique client ID for this connection.
   */
  readonly clientId: string;

  /**
   * Internal: access to the underlying TestWebSocket for debugging.
   * Typically used to inspect raw messages or test binary frames.
   */
  readonly ws: any;

  /**
   * Send inbound message to router (as if from client).
   * Routes through the websocket bridge to exercise the same code paths as production adapters.
   * Returns immediately; use tr.flush() to wait for message processing to complete.
   */
  send(type: string, payload?: unknown, meta?: Record<string, unknown>): void;

  /**
   * Get all messages sent to this connection.
   */
  outgoing(): readonly OutgoingFrame[];

  /**
   * Wait for pending microtasks to settle on this connection.
   */
  drain(): Promise<void>;

  /**
   * Get topic subscriptions for this connection (if pubsub enabled).
   * Returns empty array if pubsub not present.
   */
  subscriptions(): readonly string[];

  /**
   * Get current connection data.
   */
  getData(): Readonly<TContext>;

  /**
   * Update connection data (partial merge).
   */
  setData(patch: Partial<TContext>): void;

  /**
   * Close this connection.
   */
  close(): Promise<void>;
}

/**
 * Capture helpers for assertions.
 */
export interface TestCapture<TContext = unknown> {
  /**
   * Get all errors caught by router.onError().
   */
  errors(): readonly unknown[];

  /**
   * Get all messages published via router.publish() (if pubsub enabled).
   * Returns empty array if pubsub not present.
   */
  publishes(): readonly PublishRecord[];

  /**
   * Get all messages sent across all connections.
   */
  messages(): readonly OutgoingFrame[];

  /**
   * Clear all captured data.
   */
  clear(): void;
}

/**
 * Test router: wraps a real router with testing utilities.
 * Includes clock control, connection management, and capture helpers.
 */
export interface TestRouter<TContext = unknown> extends Router<TContext, any> {
  /**
   * Establish a connection and wait for all `onConnect` hooks to settle.
   * Always await this method before sending messages.
   */
  connect(init?: {
    data?: Partial<TContext>;
    headers?: Record<string, string>;
  }): Promise<TestConnection<TContext>>;

  /**
   * Capture helpers for assertions.
   */
  capture: TestCapture<TContext>;

  /**
   * Fake clock for deterministic time control.
   */
  clock: Clock;

  /**
   * Advance fake clock by ms and run all due timers.
   */
  tick(ms: number): Promise<void>;

  /**
   * Flush pending microtasks without advancing time.
   */
  flush(): Promise<void>;

  /**
   * Close the test harness and verify no resource leaks.
   */
  close(): Promise<void>;
}
