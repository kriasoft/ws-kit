import { defineConfig } from "srcpack";

const base = ["README.md", "CLAUDE.md", "CLAUDE.local.md"];

// Specs for validation-related reviews
const validatorSpecs = [
  "docs/specs/schema.md",
  "docs/specs/validation.md",
  "docs/specs/router.md",
  "docs/specs/context-methods.md",
  "docs/adr/023-schema-driven-type-inference.md",
  "docs/adr/025-validator-plugins-configurable.md",
  "docs/adr/028-plugin-architecture-final-design.md",
];

// Core types needed for validator context
const coreTypes = [
  "packages/core/src/core/types.ts",
  "packages/core/src/plugin/define.ts",
  "packages/core/src/schema/metadata.ts",
];

export default defineConfig({
  bundles: {
    // Design docs: all specs and ADRs
    spec: [...base, "docs/specs/*.md", "docs/adr/*.md"],

    // Core router implementation
    core: [
      ...base,
      "docs/specs/router.md",
      "docs/specs/context-methods.md",
      "docs/specs/error-handling.md",
      "docs/specs/plugins.md",
      "packages/core/src/**/*.ts",
      "packages/plugins/src/**/*.ts",
      "!**/*.test.ts",
    ],

    // Zod validator plugin
    zod: [
      ...base,
      ...validatorSpecs,
      ...coreTypes,
      "packages/zod/src/**/*.ts",
      "!**/*.test.ts",
    ],

    // Valibot validator plugin
    valibot: [
      ...base,
      ...validatorSpecs,
      ...coreTypes,
      "packages/valibot/src/**/*.ts",
      "!**/*.test.ts",
    ],

    // Pub/Sub system: plugin + all adapters
    pubsub: [
      ...base,
      "docs/specs/pubsub.md",
      "docs/specs/adapters.md",
      "docs/adr/019-ctx-publish-convenience-method.md",
      "docs/adr/023-pubsub-adapter-split.md",
      "packages/pubsub/src/**/*.ts",
      "packages/memory/src/**/*.ts",
      "packages/redis/src/**/*.ts",
      "packages/bun/src/pubsub.ts",
      "packages/bun/src/pubsub.test.ts",
    ],

    // Client SDK
    client: [
      ...base,
      "docs/specs/client.md",
      "packages/client/src/**/*.ts",
      "!**/*.test.ts",
    ],

    // Bun platform adapter
    bun: [
      ...base,
      "docs/specs/adapters.md",
      "docs/adr/034-bun-upgrade-return-semantics.md",
      "docs/adr/035-bun-adapter-refinement.md",
      "packages/bun/src/**/*.ts",
      "!**/*.test.ts",
    ],

    // Cloudflare platform adapter
    cloudflare: [
      ...base,
      "docs/specs/adapters.md",
      "packages/cloudflare/src/**/*.ts",
      "!**/*.test.ts",
    ],
  },
});
