// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Plugin } from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";

describe("@ws-kit/core - Plugin Type Safety", () => {
  it("Plugin should work with typed connection data", () => {
    type PluginTest = Plugin<{ clientId: string }, { validation: true }>;

    // Plugin should be usable with typed connection data
    // Type-level test: just ensure the type is valid
    expectTypeOf<PluginTest>().toMatchTypeOf<object>();
  });

  it("Plugin should compose multiple extensions correctly", () => {
    type ValidatorPlugin = Plugin<{ userId: string }, { validation: true }>;
    type PubSubPlugin = Plugin<{ userId: string }, { pubsub: true }>;
    type CombinedPlugin = Plugin<
      { userId: string },
      { validation: true; pubsub: true }
    >;

    // Type-level tests: ensure all types are valid
    expectTypeOf<ValidatorPlugin>().toMatchTypeOf<object>();
    expectTypeOf<PubSubPlugin>().toMatchTypeOf<object>();
    expectTypeOf<CombinedPlugin>().toMatchTypeOf<object>();
  });
});
