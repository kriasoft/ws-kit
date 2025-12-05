// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Types for the withMessaging() plugin.
 *
 * Provides fire-and-forget unicast messaging (send) and broadcast messaging (publish).
 */

// Re-export from core for canonical access
export type {
  SendOptions,
  SendOptionsAsync,
  SendOptionsBase,
  SendOptionsSync,
} from "@ws-kit/core";

/**
 * Messaging plugin capability interface.
 *
 * Provides context methods for fire-and-forget messaging (send, publish).
 * These methods are always available once withMessaging() is applied.
 */
export interface WithMessagingCapability {
  /**
   * Marker for capability-gating in type system.
   * @internal
   */
  readonly messaging: true;
}
