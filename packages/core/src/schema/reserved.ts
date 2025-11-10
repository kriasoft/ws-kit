/**
 * Reserved type prefixes and meta keys.
 * Avoid collisions in message routing.
 *
 * Reservations:
 * - __* (double underscore) → system/internal use
 * - $* (dollar) → private/implementation detail (framework)
 */

export const RESERVED_PREFIXES = ["__", "$"] as const;

export const SYSTEM_MESSAGES = {
  HEARTBEAT: "__heartbeat",
  HEARTBEAT_ACK: "__heartbeat_ack",
} as const;

export function isReservedType(type: string): boolean {
  return RESERVED_PREFIXES.some((p) => type.startsWith(p));
}
