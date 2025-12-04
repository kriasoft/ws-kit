/**
 * Reserved type prefixes and meta keys.
 * Avoid collisions in message routing.
 *
 * Reservations:
 * - __* (double underscore) → system/internal use
 * - $* (dollar) → private/implementation detail (framework)
 * - $ws:* → router lifecycle events (open/close)
 */

export const RESERVED_PREFIXES = ["__", "$"] as const;

/**
 * System message types for heartbeat.
 */
export const SYSTEM_MESSAGES = {
  HEARTBEAT: "__heartbeat",
  HEARTBEAT_ACK: "__heartbeat_ack",
} as const;

/**
 * Router lifecycle event types.
 * These are used internally for onOpen/onClose handlers
 * and bypass validation plugins.
 */
export const SYSTEM_LIFECYCLE = {
  OPEN: "$ws:open",
  CLOSE: "$ws:close",
} as const;

/**
 * Check if a type is reserved (system/internal use only).
 */
export function isReserved(type: string): boolean {
  return RESERVED_PREFIXES.some((p) => type.startsWith(p));
}

/**
 * Check if a type is a lifecycle event ($ws:open, $ws:close).
 * Lifecycle events bypass validation but are handled by router lifecycle hooks.
 */
export function isLifecycle(type: string): boolean {
  return type === SYSTEM_LIFECYCLE.OPEN || type === SYSTEM_LIFECYCLE.CLOSE;
}
