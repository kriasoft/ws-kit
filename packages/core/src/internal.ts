// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @internal
 * Internal API for plugins and test infrastructure.
 *
 * This module provides escape hatches for accessing router internals without
 * exposing implementation classes in the public API. Plugins and tests should
 * import from this path only.
 *
 * Usage:
 * ```ts
 * import { ROUTER_IMPL } from "@ws-kit/core/internal";
 *
 * const impl = router[ROUTER_IMPL]; // RouterImpl<TContext> | undefined
 * ```
 *
 * Never import from `core/router.ts` directly for internal access.
 */

export { ROUTER_IMPL } from "./core/symbols";
export type { RouterImpl } from "./core/router";
