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
