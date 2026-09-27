# Spark contributors

Before adding or changing a public API, read [the API design rules](docs/api-design.md).
The approved capability contracts are in [docs/api-contracts.md](docs/api-contracts.md).

Public hook changes must pass `tests/api-hook-policy.test.ts`, the affected imperative
and React lifecycle tests, and `npm run typecheck`. The export inventory in that test
requires an imperative counterpart or a justified React-only exception for every hook.
