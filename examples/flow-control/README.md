# Flow Control

Backpressure strategies (drop-oldest, drop-new, queue) with server retry hints.

**Spec:** [docs/patterns/flow-control.md](../../docs/patterns/flow-control.md)
**Schema:** `contract.json` | **Tests:** `conformance.test.ts` | **Fixtures:** `fixtures/`

## Run This Example

```bash
# Run conformance tests
bun test examples/flow-control/conformance.test.ts

# Check message contract
cat contract.json
```

See [docs/patterns/flow-control.md](../../docs/patterns/flow-control.md) for full specification, failure modes, and implementation details.

## Fixtures

The `fixtures/` directory contains numbered JSON files (001, 002, 003, etc.) that define test scenarios for each backpressure strategy:

- **001-\*** — Drop-oldest strategy under load
- **002-\*** — Drop-new strategy under load
- **003-\*** — Queue strategy with retry hints

These are schema validation tests that verify the contract structure. For detailed semantics of each scenario, see the pattern specification document.
