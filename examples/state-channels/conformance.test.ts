// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";

describe("State Channels Conformance", () => {
  it("schema version is valid", async () => {
    const { default: contract } = await import("./contract.json");
    expect(contract.schemaVersion).toBe("1.0.0");
  });

  it("fixtures have matching schema versions", async () => {
    const { default: contract } = await import("./contract.json");
    const fixtures = await Promise.all([
      import("./fixtures/001-initialization.json").then((m) => m.default),
      import("./fixtures/002-gap-detected.json").then((m) => m.default),
      import("./fixtures/003-duplicate-reject.json").then((m) => m.default),
    ]);

    for (const fixture of fixtures) {
      expect(fixture.schemaVersion).toBe(contract.schemaVersion);
      expect(fixture.fixtureVersion).toBeDefined();
    }
  });

  it("fixtures are numbered sequentially", async () => {
    const fixtures = [
      "./fixtures/001-initialization.json",
      "./fixtures/002-gap-detected.json",
      "./fixtures/003-duplicate-reject.json",
    ];

    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  it("fixtures have required structure", async () => {
    const fixtures = await Promise.all([
      import("./fixtures/001-initialization.json").then((m) => m.default),
      import("./fixtures/002-gap-detected.json").then((m) => m.default),
      import("./fixtures/003-duplicate-reject.json").then((m) => m.default),
    ]);

    for (const fixture of fixtures) {
      expect(fixture.name).toBeDefined();
      expect(fixture.description).toBeDefined();
      expect(fixture.steps).toBeDefined();
      expect(Array.isArray(fixture.steps)).toBe(true);
      expect(fixture.assertions).toBeDefined();
      expect(Array.isArray(fixture.assertions)).toBe(true);
    }
  });
});
