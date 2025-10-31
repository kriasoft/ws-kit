// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import * as v from "valibot";
import type { ValidatorAdapter } from "@ws-kit/core";
import type { MessageSchemaType } from "./types.js";

/**
 * Adapter that bridges Valibot validation with the generic router implementation.
 * Handles the differences in Valibot's schema structure compared to Zod.
 */
export class ValibotValidatorAdapter implements ValidatorAdapter {
  // Extract the literal type value used for message routing.
  // COMPLEXITY: Valibot stores the literal value differently than Zod,
  // requiring runtime checks to safely access schema.entries.type.literal.
  getMessageType(schema: MessageSchemaType): string {
    const typeSchema = schema.entries.type;
    if (typeSchema && typeSchema.type === "literal") {
      return typeSchema.literal;
    }
    // This should never happen with schemas from messageSchema()
    throw new Error("Schema must have a literal type field");
  }

  // Validate incoming message data and normalize the result format.
  // NOTE: Valibot uses 'output' instead of Zod's 'data' for parsed results.
  // Includes prettified error for consistent error reporting with Zod adapter.
  safeParse(schema: MessageSchemaType, data: unknown) {
    const result = v.safeParse(schema, data);
    return {
      success: result.success,
      data: result.success ? result.output : undefined,
      error: result.success
        ? undefined
        : {
            issues: result.issues,
            formatted: this.formatError(result.issues),
          },
    };
  }

  // Format validation issues into a human-readable string for debugging.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatError(issues: any[]): string {
    const flattened = v.flatten(issues);
    const errors: string[] = [];

    // Add root-level errors if present
    if (flattened.root) {
      errors.push(...flattened.root);
    }

    // Add nested field errors
    if (flattened.nested) {
      for (const [field, fieldErrors] of Object.entries(flattened.nested)) {
        if (Array.isArray(fieldErrors)) {
          errors.push(...fieldErrors.map((err: string) => `${field}: ${err}`));
        }
      }
    }

    return errors.length > 0 ? errors.join("\n") : "Validation failed";
  }

  // Type helper for TypeScript inference - not used at runtime.
  // EXISTS FOR: Satisfying the ValidatorAdapter interface type requirements.
  infer<T extends MessageSchemaType>(): v.InferOutput<T> {
    return {} as v.InferOutput<T>;
  }
}
