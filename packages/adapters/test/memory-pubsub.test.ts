// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe } from "bun:test";
import { memoryPubSub } from "../src/memory/pubsub.js";
import { createPubSubContractTests } from "./pubsub-contract.test.js";

/**
 * Test suite for memoryPubSub driver.
 * Verifies compliance with PubSubDriver contract.
 */
describe("memoryPubSub", () => {
  createPubSubContractTests("memoryPubSub", () => memoryPubSub());
});
