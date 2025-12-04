// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { CloseError } from "./error.js";

describe("CloseError", () => {
  it("should create CloseError with code and reason", () => {
    const error = new CloseError(4401, "Invalid token");

    expect(error.code).toBe(4401);
    expect(error.reason).toBe("Invalid token");
    expect(error.message).toBe("Invalid token");
    expect(error.name).toBe("CloseError");
  });

  it("should create CloseError with code only", () => {
    const error = new CloseError(4500);

    expect(error.code).toBe(4500);
    expect(error.reason).toBe("");
    expect(error.message).toBe("Connection closed with code 4500");
  });

  it("should identify CloseError with static method", () => {
    const closeError = new CloseError(4401);
    const regularError = new Error("Regular error");

    expect(CloseError.isCloseError(closeError)).toBe(true);
    expect(CloseError.isCloseError(regularError)).toBe(false);
    expect(CloseError.isCloseError(null)).toBe(false);
    expect(CloseError.isCloseError(undefined)).toBe(false);
  });
});
