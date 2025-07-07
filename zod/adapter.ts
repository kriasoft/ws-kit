/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { z } from "zod";
import type { ValidatorAdapter } from "../shared/router";
import type { MessageSchemaType } from "./types";

export class ZodValidatorAdapter implements ValidatorAdapter {
  getMessageType(schema: MessageSchemaType): string {
    return schema.shape.type._def.value;
  }

  safeParse(schema: MessageSchemaType, data: unknown) {
    const result = schema.safeParse(data);
    return {
      success: result.success,
      data: result.success ? result.data : undefined,
      error: result.success ? undefined : result.error.errors,
    };
  }

  infer<T extends MessageSchemaType>(): z.infer<T> {
    return {} as z.infer<T>;
  }
}
