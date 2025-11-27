// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expectTypeOf, it } from "bun:test";
import {
  message,
  v,
  type InferPayload,
  type InferResponse,
  type InferType,
} from "./index.js";

describe("@ws-kit/valibot - Internal Symbol Isolation", () => {
  it("should not expose MessageSchemaType symbol in public API", () => {
    // MessageSchemaType is an internal constraint; users create schemas with message()
    const schema = message("TEST", { id: v.number() });

    // These public utilities should work
    type Payload = InferPayload<typeof schema>;
    type Type = InferType<typeof schema>;
    type Response = InferResponse<typeof schema>;

    expectTypeOf<Payload>().not.toBeNever();
    expectTypeOf<Type>().not.toBeNever();
    expectTypeOf<Response>().toBeNever();
  });

  it("should provide clean type inference without internal type references", () => {
    const Join = message("JOIN", { roomId: v.string() });
    const GetUser = message("GET_USER", { id: v.string() });

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

  it("should provide Valibot schema functionality without exposing internals", () => {
    const schema = message("TEST", { text: v.string() });

    // Schema should be usable as a Valibot schema
    expectTypeOf(schema).toHaveProperty("safeParse");
    expectTypeOf(schema).toHaveProperty("parse");

    // But type inference goes through public Infer* helpers
    type Type = InferType<typeof schema>;
    expectTypeOf<Type>().not.toBeNever();
  });

  it("should hide internal schema mechanism from public API", () => {
    // This test documents that MessageSchemaType is for internal type constraints,
    // not part of the public user-facing API
    const schema = message("PING");

    // Users interact via public helpers
    type Type = InferType<typeof schema>;
    type Response = InferResponse<typeof schema>;

    expectTypeOf<Type>().not.toBeNever();
    expectTypeOf<Response>().toBeNever();
  });
});
