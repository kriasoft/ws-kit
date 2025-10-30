// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Outbound message normalization for client.
 * See @docs/specs/client.md#client-normalization and @docs/specs/rules.md#client-side-constraints.
 */

// Reserved server-only meta keys (MUST strip from user input)
const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);

/**
 * Normalizes outbound message meta before validation.
 *
 * Order of operations:
 * 1. Start with { timestamp: Date.now() }
 * 2. Merge user-provided meta (can override timestamp)
 * 3. Add correlationId if provided (highest precedence)
 * 4. Strip reserved server-only keys (security boundary)
 *
 * @returns Normalized meta object ready for validation
 */
export function normalizeOutboundMeta(
  userMeta?: Record<string, unknown>,
  correlationId?: string,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    timestamp: Date.now(), // Auto-inject (user can override)
    ...userMeta, // User-provided extended meta
  };

  // Add correlationId if provided (highest precedence)
  if (correlationId !== undefined) {
    meta.correlationId = correlationId;
  }

  // Strip reserved server-only keys (security boundary)
  for (const key of Array.from(RESERVED_META_KEYS)) {
    Reflect.deleteProperty(meta, key);
  }

  return meta;
}
