// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Plugin host: manages plugin registration and capability widening.
 * - Ensures idempotency: same plugin applied twice is a no-op
 * - Tracks capabilities: merges { validation, pubsub, ... } from applied plugins
 * - Returns the widened router type (same instance, type-level only)
 *
 * Internal; called by router.plugin().
 */

import type { ConnectionData } from "../context/base-context";
import type { Router } from "../core/router";
import type { Capabilities, Plugin } from "./types";

export class PluginHost<TContext extends ConnectionData = ConnectionData> {
  private readonly applied = new WeakSet<Function>();
  private capabilities: Capabilities = {};

  constructor(private readonly router: Router<TContext, any>) {}

  /**
   * Apply a plugin with idempotency check.
   * - If the plugin was already applied, return the router as-is (type-widened).
   * - Otherwise, call the plugin, merge capabilities, and return the result.
   * @param plugin Pure function: (router) => Router<TContext, TCaps>
   */
  apply<P extends Plugin<TContext, any>>(plugin: P): ReturnType<P> {
    // Idempotency: if plugin was already applied, skip silently
    if (this.applied.has(plugin)) {
      return this.router as unknown as ReturnType<P>;
    }

    // Mark as applied before calling (prevents infinite recursion if plugin calls itself)
    this.applied.add(plugin);

    // Call the plugin with the router
    const result = plugin(this.router);

    // Merge capabilities from result (plugins attach __caps to the result)
    const caps = (result as any).__caps as Capabilities | undefined;
    if (caps) {
      Object.assign(this.capabilities, caps);
    }

    // Return widened type (same instance, typed as having new capabilities)
    // Type is guaranteed by the plugin function signature
    return result as unknown as ReturnType<P>;
  }

  /**
   * Get readonly view of merged capabilities.
   */
  getCapabilities(): Readonly<Capabilities> {
    return { ...this.capabilities };
  }
}
