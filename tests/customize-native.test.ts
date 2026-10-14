import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
it.skipIf(process.platform !== 'darwin')('compiles the native host and verifies activation, rollback and factory recovery', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'spark-customize-native-'));
  try {
    const app = path.join(temporary, 'CustomizeTest.app/Contents'); mkdirSync(path.join(app, 'MacOS'), { recursive: true }); mkdirSync(path.join(app, 'Resources'));
    writeFileSync(path.join(app, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.spark.customize-native</string><key>CFBundleExecutable</key><string>CustomizeTest</string></dict></plist>');
    writeFileSync(path.join(app, 'Resources/main.jsbundle'), 'original');
    const binary = path.join(app, 'MacOS/CustomizeTest');
    const compile = spawnSync('/usr/bin/clang++', ['-fobjc-arc', '-Wno-deprecated-declarations', 'tests/customize-native.mm', '-framework', 'AppKit', '-framework', 'Security', '-o', binary], { encoding: 'utf8' });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 15000 });
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toMatch(/loader and API: [4-9][0-9] checks passed/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 30000);
