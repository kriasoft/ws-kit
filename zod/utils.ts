/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ZodError } from "zod";

/**
 * Formats a Zod validation error into a user-friendly message.
 * Leverages Zod v4's prettifyError for better error messages.
 */
export function formatValidationError(error: unknown): string {
  if (error && typeof error === "object" && "formatted" in error) {
    // If we have a prettified error from our adapter
    const formatted = error.formatted as Record<string, unknown>;
    return JSON.stringify(formatted, null, 2);
  }

  // Fallback for raw ZodError
  if (error && typeof error === "object" && "issues" in error) {
    const zodError = error as ZodError;
    const messages = zodError.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
    return messages.join("\n");
  }

  return "Validation error";
}

/**
 * Extract error context for debugging from a validation error.
 */
export function getErrorContext(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { path?: (string | number)[] }[] })
      .issues;
    return {
      errorCount: issues.length,
      fields: issues.map((issue) => issue.path?.join(".")).filter(Boolean),
    };
  }
  return {};
}
