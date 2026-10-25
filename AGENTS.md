# Spark contributors

Use the pinned Bun version in `packageManager` for repository installs and tooling.
Run `bun install --frozen-lockfile`, `bun run typecheck`, and `bun run test` (Vitest).
Published consumers remain compatible with npm, pnpm, Yarn, Bun, and Node.

Before adding or changing a public API, read [the API design rules](docs/api-design.md).
The approved capability contracts are in [docs/api-contracts.md](docs/api-contracts.md).

Public hook changes must pass `tests/api-hook-policy.test.ts`, the affected imperative
and React lifecycle tests, and `bun run typecheck`. The export inventory in that test
requires an imperative counterpart or a justified React-only exception for every hook.

Public path changes must update `docs/api-export-inventory.json` and pass
`tests/api-export-inventory.test.ts`.

E2E verification flows (`e2e/`): write and check them with [docs/e2e-flows.md](docs/e2e-flows.md)
(`bun run e2e:validate`, `bun run e2e:lint`). After changing `scripts/e2e/format/commands.ts`,
run `bun run e2e:schema`.
