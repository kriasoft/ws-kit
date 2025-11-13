// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/core/plugin — Plugin authoring helpers and types
 *
 * Use this import path when writing plugins:
 * ```typescript
 * import { definePlugin } from "@ws-kit/core/plugin";
 *
 * export const withMyFeature = definePlugin<MyContext, MyAPI>(
 *   (router) => ({ ... }),
 * );
 * ```
 *
 * The core exports:
 * - definePlugin() — Helper for type-safe plugin definition
 * - Plugin — Type for plugin functions (rarely used directly)
 * - Router — Re-exported for convenience
 *
 * Optional semantic layer (for advanced type documentation):
 * - RouterCapabilityAPIs — Registry of capability names to APIs
 * - RouterWithCapabilities — Type alias for routers with specific capabilities
 *
 * @example Using the semantic layer:
 * ```typescript
 * import type { RouterWithCapabilities } from "@ws-kit/core/plugin";
 *
 * type AppRouter = RouterWithCapabilities<MyContext, ["validation", "pubsub"]>;
 * ```
 */

export { definePlugin } from "./define";
export type { Plugin } from "../core/router";
export type { Router } from "../core/router";
export type {
  RouterCapabilityAPIs,
  RouterWithCapabilities,
} from "./capabilities";
