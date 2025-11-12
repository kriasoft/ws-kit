// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Symbol-based metadata infrastructure for all runtime schema hints.
 * Provides safe, collision-free, composition-aware property attachment.
 *
 * Uses Symbol.for() to avoid collisions, survive minification, and remain unspoofable.
 * Centralizes all non-enumerable property access through helpers.
 *
 * @internal
 */

import type { ZodType } from "zod";

/**
 * Symbol for message type descriptor.
 * Stores the message type literal (e.g., "USER_JOIN", "GET_USER").
 */
export const DESCRIPTOR = Symbol.for("@ws-kit/descriptor");

/**
 * Symbol for Zod payload schema.
 * Stores the Zod schema for the payload field.
 */
export const ZOD_PAYLOAD = Symbol.for("@ws-kit/zod-payload");

/**
 * Symbol for schema option metadata.
 * Stores per-schema behavior overrides (validateOutgoing, strict, deprecated).
 */
export const SCHEMA_OPTS = Symbol.for("@ws-kit/schema-opts");

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
 * Attach schema options to a Zod type without polluting enumerable keys.
 * Uses non-enumerable property definition to keep the schema clean.
 *
 * @internal
 */
export function setSchemaOpts<T extends ZodType>(
  schema: T,
  opts: SchemaOpts,
): T {
  Object.defineProperty(schema, SCHEMA_OPTS, {
    value: Object.freeze(opts),
    enumerable: false,
    configurable: true,
  });
  return schema;
}

/**
 * Retrieve schema options attached to a Zod type.
 * Returns undefined if no options are set.
 *
 * @internal
 */
export function getSchemaOpts(schema: any): SchemaOpts | undefined {
  return schema?.[SCHEMA_OPTS];
}

/**
 * Clone options from one schema to another during composition.
 * Call this whenever you create a derivative Zod type via transform, refine, pipe, etc.
 *
 * Preserves the intent and options of the original schema through chained operations.
 *
 * @internal
 */
export function cloneWithOpts<T extends ZodType>(from: any, to: T): T {
  const opts = getSchemaOpts(from);
  if (opts) {
    setSchemaOpts(to, opts);
  }
  return to;
}

/**
 * Get message type descriptor from a schema.
 * @internal
 */
export function getDescriptor(schema: any): { type: string } | undefined {
  return schema?.[DESCRIPTOR];
}

/**
 * Get Zod payload schema from a schema.
 * @internal
 */
export function getZodPayload(schema: any): ZodType | undefined {
  return schema?.[ZOD_PAYLOAD];
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
  return (schemaObj as any)?.[DESCRIPTOR]?.type ?? (schema as any)?.type;
}

/**
 * Augment ZodTypeAny to support all metadata symbols at the type level.
 * Purely for TypeScript awareness; actual properties are set via symbols.
 *
 * @internal
 */
declare module "zod" {
  interface ZodTypeAny {
    readonly [DESCRIPTOR]?: { type: string };
    readonly [ZOD_PAYLOAD]?: ZodType;
    readonly [SCHEMA_OPTS]?: SchemaOpts;
  }
}
