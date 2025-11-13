// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Internal escape hatches (symbols).
 * Used for plugin capability marking and cross-bundle duck-typing.
 */

export const CORE_SYMBOL = Symbol("@ws-kit/core");
export const CAP_VALIDATION = Symbol("@ws-kit/caps/validation");
export const CAP_PUBSUB = Symbol("@ws-kit/caps/pubsub");

/**
 * Symbol for accessing the route table.
 * Used internally by merge/mount to extract routes without instanceof brittleness.
 * Enables duck-typing across multiple bundle copies.
 *
 * Not part of public API. Use getRouteIndex() for plugin access.
 * @internal
 */
export const ROUTE_TABLE = Symbol("@ws-kit/route-table");

/**
 * Symbol for accessing the router implementation instance.
 * Used by plugins and test infrastructure to access internal details without
 * depending on implementation classes directly.
 *
 * Not part of public API. Escape hatch for rare cases where internals are needed.
 * @internal
 */
export const ROUTER_IMPL = Symbol("@ws-kit/router-impl");
