import { spawnSync } from 'node:child_process';
import { buildCLI } from './build-node.mjs';
if (process.platform !== 'darwin') throw new Error('Editable app acceptance requires macOS');
buildCLI();
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/editable.test.ts', 'tests/editable-providers.test.ts', 'tests/editable-api.test.ts', 'tests/editable-local.test.ts', 'tests/editable-native.test.ts', 'tests/editable.integration.test.ts'], {
  stdio: 'inherit', env: { ...process.env, SPARK_TEST_EDITABLE: '1', SPARK_TEST_REQUIRE_BOTH_RUNTIMES: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
