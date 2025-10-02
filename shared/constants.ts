// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Reserved server-only meta keys.
 *
 * These keys MUST NOT be:
 * - Sent by clients (stripped during normalization)
 * - Defined in extended meta schemas (validation error at schema creation)
 *
 * SOURCE: @specs/constraints.md#reserved-keys
 * USAGE: @specs/validation.md#normalization-rules
 */
export const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);

export type ReservedMetaKey = "clientId" | "receivedAt";
