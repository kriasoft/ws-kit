---
"@ws-kit/core": minor
---

**Features:**

- Enhance RPC configuration options with backwards-compatible names (`rpcMaxInflightPerSocket`, `rpcCleanupCadenceMs`, `rpcDedupWindowMs`)
- Add internal testing API `_testingConfigureRpc()` for integration test configuration
- Organize test structure with features directory for better test discoverability

**Improvements:**

- Support both legacy and new option naming conventions for RPC settings
- Provide safe access to RPC dedup window configuration for test tuning
