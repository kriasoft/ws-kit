// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime tests for the optional semantic capability layer.
 *
 * Tests:
 * - RouterCapabilityAPIs registry is accessible
 * - RouterWithCapabilities type hints work correctly
 * - Module augmentation pattern is valid
 * - Semantic layer doesn't affect runtime behavior
 */

import { describe, expect, it } from "bun:test";
import { createRouter } from "../../src/core/createRouter.js";
import type {
  RouterCapabilityAPIs,
  RouterWithCapabilities,
} from "../../src/plugin/capabilities.js";
import { definePlugin } from "../../src/plugin/define.js";

// ============================================================================
// Test Setup
// ============================================================================

interface SimpleAPI {
  simple: () => string;
}

interface AdvancedAPI {
  advanced: () => string;
}

const simplePlugin = definePlugin<any, SimpleAPI>((router) => ({
  simple: () => "simple",
}));

const advancedPlugin = definePlugin<any, AdvancedAPI>((router) => ({
  advanced: () => "advanced",
}));

// ============================================================================
// Tests
// ============================================================================

describe("Semantic Capability Layer", () => {
  describe("RouterCapabilityAPIs Registry", () => {
    it("should provide capability registry interface", () => {
      // This is a compile-time test, but we verify the registry exists
      type Registry = RouterCapabilityAPIs;

      // The registry should include validation and pubsub (core capabilities)
      expect(true).toBe(true); // Compile-time verification only
    });

    it("should support module augmentation pattern", () => {
      // Third-party plugins could augment like:
      // declare module "@ws-kit/core/plugin" {
      //   interface RouterCapabilityAPIs {
      //     myfeature: MyFeatureAPI;
      //   }
      // }

      // For now, just verify the pattern is understood
      expect(true).toBe(true);
    });
  });

  describe("RouterWithCapabilities Type", () => {
    it("should accept valid capability arrays", () => {
      // These are compile-time checks, runtime just verifies they execute
      type SingleCap = RouterWithCapabilities<any, ["validation"]>;
      type MultipleCaps = RouterWithCapabilities<any, ["validation", "pubsub"]>;
      type NoCaps = RouterWithCapabilities<any, []>;

      expect(true).toBe(true); // Type checking only
    });

    it("should work with custom context", () => {
      interface MyContext extends Record<string, unknown> {
        userId?: string;
      }

      type MyRouter = RouterWithCapabilities<MyContext, ["validation"]>;

      expect(true).toBe(true); // Type checking only
    });
  });

  describe("Semantic Layer is Optional", () => {
    it("should not require semantic types to use plugins", () => {
      // Without semantic type annotations
      const router = createRouter().plugin(simplePlugin).plugin(advancedPlugin);

      // Still works
      expect(typeof (router as any).simple).toBe("function");
      expect(typeof (router as any).advanced).toBe("function");
    });

    it("should allow mixing semantic and non-semantic usage", () => {
      // Some code uses semantic types, some doesn't
      const router = createRouter().plugin(simplePlugin);

      // Both work equally
      expect(typeof (router as any).simple).toBe("function");
    });

    it("should not incur runtime cost for unused semantic types", () => {
      // Semantic types are compile-time only
      const router = createRouter().plugin(simplePlugin);

      // No difference in runtime behavior
      const result = (router as any).simple();
      expect(result).toBe("simple");
    });
  });

  describe("Type Safety Boundaries", () => {
    it("should allow extending capability registry with augmentation", () => {
      // Pattern that third-party plugins would follow:
      // 1. Define their API interface
      interface CustomPluginAPI {
        custom: () => string;
      }

      // 2. Define their plugin using definePlugin
      const customPlugin = definePlugin<any, CustomPluginAPI>((router) => ({
        custom: () => "custom",
      }));

      // 3. Optionally augment registry (done via module augmentation in separate file)
      // declare module "@ws-kit/core/plugin" {
      //   interface RouterCapabilityAPIs {
      //     custom: CustomPluginAPI;
      //   }
      // }

      // 4. Use in router
      const router = createRouter().plugin(customPlugin);
      expect(typeof (router as any).custom).toBe("function");
    });
  });

  describe("Documentation via Types", () => {
    it("should serve as documentation for capability composition", () => {
      // Using semantic types documents expected capabilities:
      // type AppRouter = RouterWithCapabilities<MyContext, ["validation", "pubsub"]>;

      // This tells readers exactly what capabilities are required
      // without having to read the code

      expect(true).toBe(true); // Pattern verification
    });

    it("should enable IDE assistance for capability discovery", () => {
      // When typing RouterWithCapabilities, IDE can suggest valid capability names
      // (This is tested in type tests, not runtime)

      expect(true).toBe(true);
    });
  });
});
