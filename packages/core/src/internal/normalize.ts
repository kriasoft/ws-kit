// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { RESERVED_META_KEYS } from "../constants.js";

/**
 * Validates that extended meta schema does not define reserved keys.
 *
 * This check occurs in messageSchema() factory to fail fast at design time.
 *
 * @throws {Error} If meta schema contains reserved keys
 */
export function validateMetaSchema(meta?: Record<string, unknown>): void {
  if (!meta) return;

  const reservedInMeta = Object.keys(meta).filter((k) =>
    RESERVED_META_KEYS.has(k),
  );

  if (reservedInMeta.length > 0) {
    throw new Error(
      `Reserved meta keys not allowed in schema: ${reservedInMeta.join(", ")}. ` +
        `Reserved keys: ${Array.from(RESERVED_META_KEYS).join(", ")}`,
    );
  }
}

/**
 * Normalizes inbound message before validation (security boundary).
 *
 * MUST be called before schema validation to:
 * - Strip reserved server-only keys (prevents spoofing)
 * - Ensure meta exists (allows optional client meta)
 *
 * Mutates in place for performance (hot path, every message).
 * O(k) complexity where k = RESERVED_META_KEYS.size (currently 2).
 *
 * @param raw - Raw parsed message from client
 * @returns Normalized message (same reference, mutated in place)
 */
export function normalizeInboundMessage(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return raw as any; // Will fail validation
  }

  const msg = raw as Record<string, unknown>;

  // Ensure meta exists (default to empty object)
  if (!msg.meta || typeof msg.meta !== "object" || Array.isArray(msg.meta)) {
    msg.meta = {};
  }

  // Strip reserved server-only keys (security: client cannot set these)
  const meta = msg.meta as Record<string, unknown>;
  RESERVED_META_KEYS.forEach((key) => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete meta[key];
  });
  // O(k) where k = RESERVED_META_KEYS.size (currently 2)
  // Faster than iterating all meta keys: O(n)

  return msg;
}
