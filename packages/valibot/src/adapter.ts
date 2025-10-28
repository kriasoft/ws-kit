// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import * as v from "valibot";
import type { ValidatorAdapter } from "@ws-kit/core";
import type { MessageSchemaType } from "./types";

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
  // Error format is simpler - just the issues array without prettification.
  safeParse(schema: MessageSchemaType, data: unknown) {
    const result = v.safeParse(schema, data);
    return {
      success: result.success,
      data: result.success ? result.output : undefined,
      error: result.success ? undefined : result.issues,
    };
  }

  // Type helper for TypeScript inference - not used at runtime.
  // EXISTS FOR: Satisfying the ValidatorAdapter interface type requirements.
  infer<T extends MessageSchemaType>(): v.InferOutput<T> {
    return {} as v.InferOutput<T>;
  }
}
