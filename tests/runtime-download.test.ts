import { expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { runtimeFixture } from "./helpers/js-runtimes.ts";

const source = path.resolve(import.meta.dirname, "../packages/cli/src");
test.skipIf(process.env.SPARK_TEST_BOOTSTRAP_DOWNLOADS !== "1").each(["bun", "node"])("real %s download bootstraps and reuses a runtime with neither engine on PATH", async name => {
  const fixture = runtimeFixture();
  try {
    const entry = path.join(fixture.root, "entry.cjs");
    writeFileSync(entry, `require(${JSON.stringify(path.join(source, "js-runtime.cjs"))}).initializeRuntime().then(runtime => {
      const child = require('node:child_process').spawnSync('node', ['-p', "process.versions.bun ? 'bun' : 'node'"], {encoding:'utf8'});
      if (child.status !== 0) throw new Error(child.stderr);
      console.log('SPARK_RUNTIME_TEST:' + JSON.stringify({name:runtime.name, executable:runtime.executable, child:child.stdout.trim(), args:process.argv.slice(2)}));
    });`);
    // Bun exercises the default; Node exercises the alternate download choice.
    fixture.env.SPARK_RUNTIME_DOWNLOAD = name === "node" ? "node" : "";
    const command = process.platform === "win32"
      ? [path.join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(source, "runtime-bootstrap.ps1")]
      : ["/bin/sh", path.join(source, "runtime-bootstrap.sh")];
    let executable: string | undefined;
    for (let i = 0; i < 2; i++) {
      const child = spawnProcess([...command, entry, "two words", "$(literal)"], { env: fixture.env });
      try {
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code, out + err).toBe(0);
        const report = JSON.parse(out.split("SPARK_RUNTIME_TEST:")[1]!);
        expect(report).toMatchObject({ name, child: name, args: ["two words", "$(literal)"] });
        expect(report.executable).toContain(path.join(fixture.env.SPARK_HOME, "tooling", "runtimes"));
        expect((out + err).includes("Downloading Spark's private")).toBe(i === 0);
        if (executable) expect(report.executable).toBe(executable);
        executable = report.executable;
      } finally { if (child.exitCode === null) child.kill(); }
    }
    const cli = spawnProcess([executable!, path.resolve(import.meta.dirname, "../packages/desktop/bin/spark.cjs"), "--help"], { env: fixture.env });
    try {
      const [code, out, err] = await Promise.all([cli.exited, new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
      expect(code, err).toBe(0);
      expect(out).toContain("spark create");
    } finally { if (cli.exitCode === null) cli.kill(); }
  } finally { fixture.dispose(); }
}, 360_000);
