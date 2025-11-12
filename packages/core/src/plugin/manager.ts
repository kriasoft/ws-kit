/**
 * Plugin host: manages plugin registration and capability widening.
 * - Ensures idempotency: same plugin applied twice is a no-op
 * - Tracks capabilities: merges { validation, pubsub, ... } from applied plugins
 * - Returns the widened router type (same instance, type-level only)
 *
 * Internal; called by router.plugin().
 */

import type { Plugin, CapabilityMap } from "./types";
import type { Router } from "../core/router";

export class PluginHost<TConn> {
  private readonly applied = new WeakSet<Function>();
  private capabilities: CapabilityMap = {};

  constructor(private readonly router: Router<TConn, any>) {}

  /**
   * Apply a plugin with idempotency check.
   * - If the plugin was already applied, return the router as-is (type-widened).
   * - Otherwise, call the plugin, merge capabilities, and return the result.
   * @param plugin Pure function: (router) => Router<TConn, CapAdd>
   */
  apply<P extends Plugin<TConn, any>>(plugin: P): ReturnType<P> {
    // Idempotency: if plugin was already applied, skip silently
    if (this.applied.has(plugin)) {
      return this.router as unknown as ReturnType<P>;
    }

    // Mark as applied before calling (prevents infinite recursion if plugin calls itself)
    this.applied.add(plugin);

    // Call the plugin with the router
    const result = plugin(this.router);

    // Merge capabilities from result (plugins attach __caps to the result)
    const caps = (result as any).__caps as CapabilityMap | undefined;
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
  getCapabilities(): Readonly<CapabilityMap> {
    return { ...this.capabilities };
  }
}
