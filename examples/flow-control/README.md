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
