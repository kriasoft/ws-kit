/**
 * Handler registry: stores routes by schema.type.
 * Implements conflict resolution for merge() and mount().
 */

import type { MessageDescriptor } from "../../protocol/message-descriptor";
import type { RouteEntry } from "./types";

export interface RegistryOptions {
  onConflict?: "error" | "skip" | "replace";
}

/**
 * Internal route table for handler lookups and merging.
 *
 * Stores handlers by message type. Supports deterministic conflict resolution:
 * - "error" (default): throw if type collision
 * - "skip": keep existing handler, ignore incoming
 * - "replace": replace existing with incoming
 */
export class RouteTable<TConn> {
  private handlers = new Map<string, RouteEntry<TConn>>();

  /**
   * Register a handler for a message type.
   * Throws if type already registered (use merge() for conflict handling).
   */
  register(schema: MessageDescriptor, entry: RouteEntry<TConn>): void {
    const type = schema.type;
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for type: ${type}`);
    }
    this.handlers.set(type, entry);
  }

  /**
   * Get handler for a message type.
   */
  get(type: string): RouteEntry<TConn> | undefined {
    return this.handlers.get(type);
  }

  /**
   * List all registered [type, entry] pairs.
   */
  list(): readonly [string, RouteEntry<TConn>][] {
    return Array.from(this.handlers.entries());
  }

  /**
   * Merge another route table into this one with conflict resolution.
   *
   * @param other - Route table to merge
   * @param opts.onConflict - Resolution strategy:
   *   - "error" (default): throw on collision
   *   - "skip": keep existing, ignore incoming
   *   - "replace": replace existing with incoming
   */
  merge(
    other: RouteTable<TConn>,
    opts: RegistryOptions = {},
  ): void {
    const { onConflict = "error" } = opts;

    for (const [type, entry] of other.list()) {
      if (this.handlers.has(type)) {
        switch (onConflict) {
          case "error":
            throw new Error(
              `Handler conflict during merge: type "${type}" already exists`,
            );
          case "skip":
            // Keep existing, ignore incoming
            continue;
          case "replace":
            // Replace with incoming
            this.handlers.set(type, entry);
            break;
        }
      } else {
        this.handlers.set(type, entry);
      }
    }
  }

  /**
   * Mount another route table with a prefix.
   * All message types from the other route table are prefixed with `prefix + type`.
   *
   * @param prefix - Prefix to add (e.g., "auth." → "auth.LOGIN", "auth.REGISTER")
   * @param other - Route table to mount
   * @param opts.onConflict - Resolution strategy (same as merge)
   */
  mount(
    prefix: string,
    other: RouteTable<TConn>,
    opts: RegistryOptions = {},
  ): void {
    const { onConflict = "error" } = opts;

    for (const [type, entry] of other.list()) {
      const prefixedType = prefix + type;

      if (this.handlers.has(prefixedType)) {
        switch (onConflict) {
          case "error":
            throw new Error(
              `Handler conflict during mount: type "${prefixedType}" already exists`,
            );
          case "skip":
            // Keep existing, ignore incoming
            continue;
          case "replace":
            // Replace with incoming
            this.handlers.set(prefixedType, {
              ...entry,
              schema: {
                ...entry.schema,
                type: prefixedType,
              },
            });
            break;
        }
      } else {
        this.handlers.set(prefixedType, {
          ...entry,
          schema: {
            ...entry.schema,
            type: prefixedType,
          },
        });
      }
    }
  }
}
