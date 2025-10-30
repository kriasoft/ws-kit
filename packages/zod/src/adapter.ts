// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { z } from "zod";
import type { ValidatorAdapter } from "@ws-kit/core";
import type { MessageSchemaType } from "./types.js";

/**
 * Adapter that bridges Zod validation with the generic router implementation.
 * Translates between Zod-specific APIs and the router's validator interface.
 */
export class ZodValidatorAdapter implements ValidatorAdapter {
  // Extract the literal type value used for message routing.
  // INVARIANT: Schema must be created by messageSchema() which ensures type.value exists.
  getMessageType(schema: MessageSchemaType): string {
    return schema.shape.type.value;
  }

  // Validate incoming message data and normalize the result format.
  // NOTE: Includes prettified error for better debugging in development.
  safeParse(schema: MessageSchemaType, data: unknown) {
    const result = schema.safeParse(data);
    return {
      success: result.success,
      data: result.success ? result.data : undefined,
      error: result.success
        ? undefined
        : {
            issues: result.error.issues,
            formatted: z.prettifyError(result.error),
          },
    };
  }

  // Type helper for TypeScript inference - not used at runtime.
  // EXISTS FOR: Satisfying the ValidatorAdapter interface type requirements.
  infer<T extends MessageSchemaType>(): z.infer<T> {
    return {} as z.infer<T>;
  }
}
