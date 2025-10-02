// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { BaseIssue } from "valibot";

/**
 * Formats a Valibot validation error into a user-friendly message.
 * Converts the issues array into readable error messages.
 */
export function formatValidationError(error: unknown): string {
  // Handle Valibot issues array
  if (Array.isArray(error)) {
    const issues = error as BaseIssue<unknown>[];
    const messages = issues.map((issue) => {
      const path = issue.path?.map((p) => p.key).join(".") || "root";
      return `${path}: ${issue.message}`;
    });
    return messages.join("\n");
  }

  // Handle wrapped error object with issues
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: BaseIssue<unknown>[] }).issues;
    const messages = issues.map((issue) => {
      const path = issue.path?.map((p) => p.key).join(".") || "root";
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
  let issues: BaseIssue<unknown>[] | undefined;

  if (Array.isArray(error)) {
    issues = error as BaseIssue<unknown>[];
  } else if (error && typeof error === "object" && "issues" in error) {
    issues = (error as { issues: BaseIssue<unknown>[] }).issues;
  }

  if (issues) {
    return {
      errorCount: issues.length,
      fields: issues
        .map((issue) => issue.path?.map((p) => p.key).join("."))
        .filter(Boolean),
    };
  }

  return {};
}
