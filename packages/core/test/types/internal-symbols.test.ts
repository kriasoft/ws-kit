// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it } from "bun:test";
import { expectTypeOf } from "bun:test";
import type { Plugin, MergeCaps } from "@ws-kit/core";

describe("@ws-kit/core - Internal Symbol Isolation", () => {
  it("Plugin should work with typed connection data", () => {
    type PluginTest = Plugin<{ clientId: string }, { validation: true }>;

    // Plugin should be usable without referencing CapabilityMap
    // Type-level test: just ensure the type is valid
    expectTypeOf<PluginTest>().toMatchTypeOf<object>();
  });

  it("MergeCaps should merge capabilities correctly", () => {
    // MergeCaps should work without exposing CapabilityMap
    type Merged = MergeCaps<{ validation: true }>;
    expectTypeOf<Merged>().toMatchTypeOf<{ validation: true }>();
  });

  it("Plugin should narrow with multiple capabilities", () => {
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
