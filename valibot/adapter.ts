/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import * as v from "valibot";
import type { ValidatorAdapter } from "../shared/router";
import type { MessageSchemaType } from "./types";

export class ValibotValidatorAdapter implements ValidatorAdapter {
  getMessageType(schema: MessageSchemaType): string {
    // In Valibot, we need to extract the literal value from the schema
    const typeSchema = schema.entries.type;
    if (typeSchema && typeSchema.type === "literal") {
      return typeSchema.literal;
    }
    throw new Error("Schema must have a literal type field");
  }

  safeParse(schema: MessageSchemaType, data: unknown) {
    const result = v.safeParse(schema, data);
    return {
      success: result.success,
      data: result.success ? result.output : undefined,
      error: result.success ? undefined : result.issues,
    };
  }

  infer<T extends MessageSchemaType>(): v.InferOutput<T> {
    return {} as v.InferOutput<T>;
  }
}
