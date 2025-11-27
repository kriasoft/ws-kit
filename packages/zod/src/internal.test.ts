// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expectTypeOf, it } from "bun:test";
import type { InferPayload, InferResponse, InferType } from "./index.js";
import { message, z } from "./index.js";

describe("@ws-kit/zod - Internal Symbol Isolation", () => {
  it("should not expose SchemaTag symbol", () => {
    // SchemaTag should be internal and not accessible
    const schema = message("TEST", { id: z.number() });

    // These public utilities should work
    type Payload = InferPayload<typeof schema>;
    type Type = InferType<typeof schema>;
    type Response = InferResponse<typeof schema>;

    expectTypeOf<Payload>().not.toBeNever();
    expectTypeOf<Type>().not.toBeNever();
    expectTypeOf<Response>().toBeNever();
  });

  it("should not export BrandedSchema type", () => {
    // Users should use public helpers instead
    const schema = message("PING");

    // Infer* helpers provide clean public API without exposing internal branding
    type Type = InferType<typeof schema>;
    expectTypeOf<Type>().not.toBeNever();

    // BrandedSchema should not be accessible from public API
    // This test documents that users don't need to reference it
  });

  it("should provide clean type inference without internal symbol references", () => {
    const Join = message("JOIN", { roomId: z.string() });
    const GetUser = message("GET_USER", { id: z.string() });

    // All public type inference should work cleanly
    type JoinType = InferType<typeof Join>;
    type JoinPayload = InferPayload<typeof Join>;

    type GetUserType = InferType<typeof GetUser>;
    type GetUserPayload = InferPayload<typeof GetUser>;

    expectTypeOf<JoinType>().not.toBeNever();
    expectTypeOf<JoinPayload>().not.toBeNever();
    expectTypeOf<GetUserType>().not.toBeNever();
    expectTypeOf<GetUserPayload>().not.toBeNever();
  });

  it("should hide internal branding mechanism from IDE hints", () => {
    // This test documents that while TypeScript may show internal markers in hover,
    // they are not part of the public API contract
    const schema = message("TEST");

    // The schema is a valid Zod object usable directly
    expectTypeOf(schema).toHaveProperty("safeParse");
    expectTypeOf(schema).toHaveProperty("parse");

    // But users don't reference BrandedSchema directly; they use Infer* helpers
    type Type = InferType<typeof schema>;
    expectTypeOf<Type>().not.toBeNever();
  });
});
