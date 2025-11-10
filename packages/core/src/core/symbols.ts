/**
 * Internal escape hatches (symbols).
 * Used for plugin capability marking and cross-bundle duck-typing.
 */

export const CORE_SYMBOL = Symbol("@ws-kit/core");
export const CAP_VALIDATION = Symbol("@ws-kit/caps/validation");
export const CAP_PUBSUB = Symbol("@ws-kit/caps/pubsub");

/**
 * Symbol for accessing internal route table.
 * Used by merge/mount to extract routes without instanceof brittleness.
 * Enables duck-typing across multiple bundle copies.
 */
export const INTERNAL_ROUTES = Symbol("@ws-kit/internal-routes");
