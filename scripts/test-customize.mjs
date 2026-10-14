import { spawnSync } from 'node:child_process';
import { buildCLI } from './build-node.mjs';
if (process.platform !== 'darwin') throw new Error('Customize app acceptance requires macOS');
buildCLI();
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/customize.test.ts', 'tests/customize-providers.test.ts', 'tests/customize-api.test.ts', 'tests/customize-hooks.test.ts', 'tests/customize-github.test.ts', 'tests/customize-local.test.ts', 'tests/customize-native.test.ts', 'tests/customize.integration.test.ts'], {
  stdio: 'inherit', env: { ...process.env, SPARK_TEST_CUSTOMIZE: '1', SPARK_TEST_REQUIRE_BOTH_RUNTIMES: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
