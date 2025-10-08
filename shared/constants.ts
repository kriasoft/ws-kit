// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Reserved server-only meta keys.
 *
 * Defense-in-depth enforcement:
 * - Schema creation: Throws if extended meta defines these keys (design-time)
 * - Runtime normalization: Strips these keys from inbound messages (security boundary)
 *
 * CANONICAL LIST: @specs/rules.md#reserved-keys
 * IMPLEMENTATION: @specs/validation.md#normalization-rules
 * SCHEMA ENFORCEMENT: @specs/schema.md#Reserved-Server-Only-Meta-Keys
 */
export const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);

export type ReservedMetaKey = "clientId" | "receivedAt";
