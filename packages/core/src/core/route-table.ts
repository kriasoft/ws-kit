// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Handler registry: stores routes by schema.type.
 * Implements conflict resolution for merge() and mount().
 */

import type { ConnectionData } from "../context/base-context";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import { assertMessageDescriptor } from "../protocol/message-descriptor";
import { DESCRIPTOR, getDescriptor, getKind } from "../schema/metadata";
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
export class RouteTable<TContext extends ConnectionData = ConnectionData> {
  private handlers = new Map<string, RouteEntry<TContext>>();

  /**
   * Register a handler for a message type.
   * Validates schema shape, kind literal, and event/RPC invariants.
   * Throws if type already registered (use merge() for conflict handling).
   */
  register(schema: MessageDescriptor, entry: RouteEntry<TContext>): this {
    const type = schema?.messageType;

    // Validate schema structure: checks type (non-empty), kind ("event"|"rpc"), and optional fields.
    // Rejects unknown kind values (e.g., "Rpc", "rPc") before invariant checks.
    try {
      assertMessageDescriptor(schema);
    } catch (err) {
      throw new Error(
        `Invalid schema for type "${type}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Ensure type is defined (validated by assertMessageDescriptor)
    if (!type) {
      throw new Error("Invalid schema: missing type");
    }

    // Enforce event/RPC invariant at registration time (fail-fast).
    // RPC descriptors must have a response; events must not.
    // Catches schema misconfiguration before system boots.
    // Read kind from DESCRIPTOR symbol (no fallback to schema.kind)
    const kind = getKind(schema);
    if (kind === "rpc") {
      if (!schema.response) {
        throw new Error(
          `RPC schema for type "${type}" must have a response descriptor.`,
        );
      }
      // Validate response is itself a valid MessageDescriptor.
      // Prevents downstream code from reading undefined properties.
      try {
        assertMessageDescriptor(schema.response);
      } catch (err) {
        throw new Error(
          `RPC schema for type "${type}" has invalid response descriptor: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (kind === "event" && schema.response !== undefined) {
      throw new Error(
        `Event schema for type "${type}" must not have a response descriptor.`,
      );
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
   * Assumes entries in both tables were validated at registration time.
   * Only use with tables created via register(), merge(), or mount().
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
   * Assumes entries in other table were validated at registration time.
   * Only use with tables created via register(), merge(), or mount().
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
      // Create new schema with prefixed type, preserving DESCRIPTOR symbol
      const originalDesc = getDescriptor(entry.schema);
      const newSchema: MessageDescriptor = {
        ...entry.schema,
        messageType: prefixedType,
      };
      if (originalDesc) {
        Object.defineProperty(newSchema, DESCRIPTOR, {
          value: { ...originalDesc, messageType: prefixedType },
          enumerable: false,
        });
      }
      const nextEntry: RouteEntry<TContext> = {
        ...entry,
        schema: newSchema,
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
