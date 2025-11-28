// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Symbol-based metadata infrastructure for all runtime schema hints.
 * Provides safe, collision-free, composition-aware property attachment.
 *
 * Uses Symbol.for() to avoid collisions, survive minification, and remain unspoofable.
 * Centralizes all non-enumerable property access through helpers.
 *
 * This module is shared by all validator adapters (@ws-kit/zod, @ws-kit/valibot, etc.)
 * to maintain consistent schema metadata handling across the ecosystem.
 *
 * @internal
 */

/**
 * Symbol for message type descriptor.
 * Stores the message type literal (e.g., "USER_JOIN", "GET_USER").
 */
export const DESCRIPTOR = Symbol.for("@ws-kit/descriptor");

/**
 * Per-schema behavior overrides for validation and strictness.
 * All fields are optional; defaults are resolved at plugin runtime.
 */
export interface SchemaOpts {
  /**
   * Validate outgoing payloads (check replies, progress, sends).
   * Overrides plugin default if set.
   */
  validateOutgoing?: boolean;

  /**
   * Use strict object validation (reject extra keys).
   * Default: true. Set to false to allow unknown keys.
   */
  strict?: boolean;

  /**
   * Mark schema as deprecated with optional reason.
   * For future tooling and IDE warnings.
   */
  deprecated?: string | boolean;
}

/**
 * Symbol for schema option metadata.
 * Stores per-schema behavior overrides (validateOutgoing, strict, deprecated).
 */
export const SCHEMA_OPTS = Symbol.for("@ws-kit/schema-opts");

/**
 * Attach schema options to a schema without polluting enumerable keys.
 * Uses non-enumerable property definition to keep the schema clean.
 *
 * @internal
 */
export function setSchemaOpts<T extends any>(schema: T, opts: SchemaOpts): T {
  Object.defineProperty(schema, SCHEMA_OPTS, {
    value: Object.freeze(opts),
    enumerable: false,
    configurable: true,
  });
  return schema;
}

/**
 * Retrieve schema options attached to a schema.
 * Returns undefined if no options are set.
 *
 * @internal
 */
export function getSchemaOpts(schema: any): SchemaOpts | undefined {
  return schema?.[SCHEMA_OPTS];
}

/**
 * Clone options from one schema to another during composition.
 * Call this whenever you create a derivative schema via transform, refine, pipe, etc.
 *
 * Preserves the intent and options of the original schema through chained operations.
 *
 * @internal
 */
export function cloneWithOpts<T extends any>(from: any, to: T): T {
  const opts = getSchemaOpts(from);
  if (opts) {
    setSchemaOpts(to, opts);
  }
  return to;
}

/**
 * Descriptor shape stored under DESCRIPTOR symbol.
 * Contains type and kind for routing decisions.
 */
export interface DescriptorValue {
  readonly messageType: string;
  readonly kind?: "event" | "rpc";
}

/**
 * Get message type descriptor from a schema.
 * @internal
 */
export function getDescriptor(schema: any): DescriptorValue | undefined {
  return schema?.[DESCRIPTOR];
}

/**
 * Get schema kind from DESCRIPTOR symbol.
 * Returns undefined if descriptor is not set.
 * @internal
 */
export function getKind(schema: any): "event" | "rpc" | undefined {
  return getDescriptor(schema)?.kind;
}

/**
 * Dereference message type from schema descriptor.
 * Centralizes descriptor access: tries schemaObj first, falls back to schema.
 * This single point of access reduces copy-paste and future refactoring noise.
 * @internal
 */
export function typeOf(
  schemaObj: unknown,
  schema?: unknown,
): string | undefined {
  return (
    (schemaObj as any)?.[DESCRIPTOR]?.messageType ??
    (schema as any)?.messageType ??
    (schema as any)?.type
  );
}
