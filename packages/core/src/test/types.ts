/**
 * Types for test harness: TestRouter, TestConnection, and frame records.
 */

import type { Router } from "../core/types";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { Clock } from "./fake-clock";

/**
 * Outbound frame: message sent from server to client via ctx.send() or publish.
 */
export interface OutboundFrame {
  type: string;
  payload?: unknown;
  meta?: Record<string, unknown>;
  // Correlation ID for RPC responses (if present)
  _rpcId?: string;
  // Progress indicator for RPC (true = progress, false/undefined = terminal)
  _isProgress?: boolean;
}

/**
 * Published frame: message broadcast via router.publish().
 */
export interface PublishedFrame {
  topic: string;
  schema: MessageDescriptor;
  payload: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Test connection: models a single in-memory WebSocket connection.
 */
export interface TestConnection<TConn = unknown> {
  /**
   * Send inbound message to router (as if from client).
   */
  send(type: string, payload?: unknown, meta?: Record<string, unknown>): void;

  /**
   * Get all messages sent to this connection.
   */
  outgoing(): readonly OutboundFrame[];

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
  getData(): Readonly<TConn>;

  /**
   * Update connection data (partial merge).
   */
  setData(patch: Partial<TConn>): void;

  /**
   * Close this connection.
   */
  close(): Promise<void>;
}

/**
 * Capture helpers for assertions.
 */
export interface TestCapture<TConn = unknown> {
  /**
   * Get all errors caught by router.onError().
   */
  errors(): readonly unknown[];

  /**
   * Get all messages published via router.publish() (if pubsub enabled).
   * Returns empty array if pubsub not present.
   */
  publishes(): readonly PublishedFrame[];

  /**
   * Get all messages sent across all connections.
   */
  messages(): readonly OutboundFrame[];

  /**
   * Clear all captured data.
   */
  clear(): void;
}

/**
 * Test router: wraps a real router with testing utilities.
 * Includes clock control, connection management, and capture helpers.
 */
export interface TestRouter<TConn = unknown> extends Router<TConn, any> {
  /**
   * Create a new mock connection.
   */
  connect(init?: {
    data?: Partial<TConn>;
    headers?: Record<string, string>;
  }): TestConnection<TConn>;

  /**
   * Capture helpers for assertions.
   */
  capture: TestCapture<TConn>;

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
