import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
it.skipIf(process.platform !== 'darwin')('compiles the native host and verifies activation, rollback and factory recovery', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'spark-editable-native-'));
  try {
    const app = path.join(temporary, 'EditableTest.app/Contents'); mkdirSync(path.join(app, 'MacOS'), { recursive: true }); mkdirSync(path.join(app, 'Resources'));
    writeFileSync(path.join(app, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.spark.editable-native</string><key>CFBundleExecutable</key><string>EditableTest</string></dict></plist>');
    writeFileSync(path.join(app, 'Resources/main.jsbundle'), 'original');
    const binary = path.join(app, 'MacOS/EditableTest');
    const compile = spawnSync('/usr/bin/clang++', ['-fobjc-arc', '-Wno-deprecated-declarations', 'tests/editable-native.mm', '-framework', 'AppKit', '-framework', 'Security', '-o', binary], { encoding: 'utf8' });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 15000 });
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('9 checks passed');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 30000);
