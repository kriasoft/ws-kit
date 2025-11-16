// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Global constants: default values, reserved prefixes, internal flags.
 */

// Default configuration
export const DEFAULTS = {
  HEARTBEAT_INTERVAL_MS: 30_000,
  HEARTBEAT_TIMEOUT_MS: 5_000,
  MAX_PENDING: Infinity,
  MAX_PAYLOAD_BYTES: Infinity,
} as const;

// Reserved type prefixes
export const RESERVED_TYPE_PREFIXES = ["__", "$"] as const;

// System message types
export const SYSTEM_MESSAGE_TYPES = {
  HEARTBEAT: "__heartbeat",
  HEARTBEAT_ACK: "__heartbeat_ack",
  CLOSE: "__close",
} as const;

// Reserved meta keys (set by server, cannot be overridden by client)
// clientId: assigned by server when connection opens (prevents spoofing)
// receivedAt: assigned by server at message ingress (authoritative timestamp, prevents clock-skew attacks)
export const RESERVED_META_KEYS = new Set([
  "clientId",
  "receivedAt",
]) as ReadonlySet<string>;
