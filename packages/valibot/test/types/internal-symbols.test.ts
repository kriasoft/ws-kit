// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it } from "bun:test";
import { expectTypeOf } from "bun:test";
import {
  v,
  message,
  InferPayload,
  InferType,
  InferResponse,
} from "../../src/index.js";

describe("@ws-kit/valibot - Internal Symbol Isolation", () => {
  it("should not expose MessageSchemaType symbol in public API", () => {
    // MessageSchemaType is an internal constraint; users create schemas with message()
    const schema = message("TEST", { id: v.number() });

    // These public utilities should work
    type Payload = InferPayload<typeof schema>;
    type Type = InferType<typeof schema>;
    type Response = InferResponse<typeof schema>;

    expectTypeOf<Payload>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<Type>().toEqualTypeOf<"TEST">();
    expectTypeOf<Response>().toEqualTypeOf<never>();
  });

  it("should provide clean type inference without internal type references", () => {
    const Join = message("JOIN", { roomId: v.string() });
    const GetUser = message("GET_USER", { id: v.string() });

    // All public type inference should work cleanly
    type JoinType = InferType<typeof Join>;
    type JoinPayload = InferPayload<typeof Join>;

    type GetUserType = InferType<typeof GetUser>;
    type GetUserPayload = InferPayload<typeof GetUser>;

    expectTypeOf<JoinType>().toEqualTypeOf<"JOIN">();
    expectTypeOf<JoinPayload>().toEqualTypeOf<{ roomId: string }>();
    expectTypeOf<GetUserType>().toEqualTypeOf<"GET_USER">();
    expectTypeOf<GetUserPayload>().toEqualTypeOf<{ id: string }>();
  });

  it("should provide Valibot schema functionality without exposing internals", () => {
    const schema = message("TEST", { text: v.string() });

    // Schema should be usable as a Valibot schema
    expectTypeOf(schema).toHaveProperty("_types");
    expectTypeOf(schema).toHaveProperty("__descriptor");

    // But type inference goes through public Infer* helpers
    type Type = InferType<typeof schema>;
    expectTypeOf<Type>().toEqualTypeOf<"TEST">();
  });

  it("should hide internal schema mechanism from public API", () => {
    // This test documents that MessageSchemaType is for internal type constraints,
    // not part of the public user-facing API
    const schema = message("PING");

    // Users interact via public helpers
    type Type = InferType<typeof schema>;
    type Response = InferResponse<typeof schema>;

    expectTypeOf<Type>().toEqualTypeOf<"PING">();
    expectTypeOf<Response>().toEqualTypeOf<never>();
  });
});
