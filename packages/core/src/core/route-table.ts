// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Handler registry: stores routes by schema.type.
 * Implements conflict resolution for merge() and mount().
 */

import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { RouteEntry } from "./types";

export interface RouteTableOptions {
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
export class RouteTable<TContext> {
  private handlers = new Map<string, RouteEntry<TContext>>();

  /**
   * Register a handler for a message type.
   * Throws if type already registered (use merge() for conflict handling).
   */
  register(schema: MessageDescriptor, entry: RouteEntry<TContext>): this {
    const type = schema?.type;
    if (typeof type !== "string" || type.length === 0) {
      throw new Error(`Invalid schema.type: ${String(type)}`);
    }
    if (this.handlers.has(type)) {
      throw new Error(
        `Handler already registered for type "${type}". Use merge() with onConflict if needed.`,
      );
    }
    this.handlers.set(type, entry);
    return this;
  }

  /**
   * Get handler for a message type.
   */
  get(type: string): RouteEntry<TContext> | undefined {
    return this.handlers.get(type);
  }

  /**
   * Check if a handler is registered for a message type.
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Get the number of registered handlers.
   */
  size(): number {
    return this.handlers.size;
  }

  /**
   * List all registered [type, entry] pairs.
   */
  list(): readonly [string, RouteEntry<TContext>][] {
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
  merge(other: RouteTable<TContext>, opts: RouteTableOptions = {}): this {
    const { onConflict = "error" } = opts;

    for (const [type, entry] of other.list()) {
      if (this.handlers.has(type)) {
        switch (onConflict) {
          case "error":
            throw new Error(
              `merge() conflict: handler for type "${type}" already exists (policy: "error").`,
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
    return this;
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
    other: RouteTable<TContext>,
    opts: RouteTableOptions = {},
  ): this {
    const { onConflict = "error" } = opts;

    for (const [type, entry] of other.list()) {
      const prefixedType = prefix + type;
      const nextEntry: RouteEntry<TContext> = {
        ...entry,
        schema: {
          ...entry.schema,
          type: prefixedType,
        },
      };

      if (this.handlers.has(prefixedType)) {
        switch (onConflict) {
          case "error":
            throw new Error(
              `mount("${prefix}") conflict: handler for type "${prefixedType}" already exists (policy: "error").`,
            );
          case "skip":
            // Keep existing, ignore incoming
            continue;
          case "replace":
            // Replace with incoming
            this.handlers.set(prefixedType, nextEntry);
            break;
        }
      } else {
        this.handlers.set(prefixedType, nextEntry);
      }
    }
    return this;
  }
}
