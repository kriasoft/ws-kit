// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Utilities for RPC and WebSocket operations.
 */

/**
 * Stable JSON stringify for canonical payload serialization.
 *
 * Produces consistent JSON output regardless of object key order,
 * suitable for hashing and idempotency key generation.
 *
 * Usage:
 * ```typescript
 * import { stableStringify } from "@ws-kit/core";
 * import crypto from "node:crypto";
 *
 * const payload = { user: "alice", action: "purchase" };
 * const hash = crypto
 *   .createHash("sha256")
 *   .update(stableStringify(payload))
 *   .digest("hex");
 * const idempotencyKey = `tenant:alice:purchase:${hash}`;
 * ```
 *
 * @param data - Data to serialize (should be JSON-serializable)
 * @returns Canonical JSON string with sorted keys
 */
export function stableStringify(data: unknown): string {
  return JSON.stringify(data, (key, value) => {
    // Handle objects with sorted keys
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(value).sort();
      for (const k of keys) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

/**
 * Helper to generate an idempotency key from request components.
 *
 * Recommended pattern for RPC idempotency:
 * ```typescript
 * const key = idempotencyKey({
 *   tenant: ctx.ws.data?.tenantId,
 *   user: ctx.ws.data?.userId,
 *   type: ctx.type,
 *   hash: crypto
 *     .createHash("sha256")
 *     .update(stableStringify(ctx.payload))
 *     .digest("hex"),
 * });
 * ```
 *
 * @param opts - Components for key generation
 * @returns Colon-separated idempotency key (max 256 chars recommended)
 */
export interface IdempotencyKeyOpts {
  tenant?: string;
  user?: string;
  type: string;
  hash: string;
}

export function idempotencyKey(opts: IdempotencyKeyOpts): string {
  const parts = [opts.tenant, opts.user, opts.type, opts.hash];
  const key = parts.filter(Boolean).join(":");

  // Cap at 256 chars to avoid storage issues
  if (key.length > 256) {
    return key.slice(0, 256);
  }

  return key;
}
