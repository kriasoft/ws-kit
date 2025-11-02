# State Channels

Reliable FIFO state updates with client sequence tracking and recovery from gaps.

**Spec:** [docs/patterns/state-channels.md](../../docs/patterns/state-channels.md)
**Schema:** `contract.json` | **Tests:** `conformance.test.ts` | **Fixtures:** `fixtures/`

## Run This Example

```bash
# Run conformance tests
bun test examples/state-channels/conformance.test.ts

# Check message contract
cat contract.json
```

See [docs/patterns/state-channels.md](../../docs/patterns/state-channels.md) for full specification, failure modes, and implementation details.

## Fixtures

The `fixtures/` directory contains numbered JSON files (001, 002, 003, etc.) that define test scenarios:

- **001-\*** — Valid message delivery in sequence
- **002-\*** — Gap detection and catch-up
- **003-\*** — Duplicate handling

These are schema validation tests that verify the contract structure. For detailed semantics of each scenario, see the pattern specification document.
