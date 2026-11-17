import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The WinUI header needs the Windows SDK; its plain-C++ newline helper is compiled on its own.
test.skipIf(process.platform === "win32")("Windows TextBox text reports \\r line breaks as \\n", () => {
  const header = readFileSync(path.resolve(import.meta.dirname, "../packages/ui/windows/SparkUI/SparkUI.h"), "utf8");
  const helper = header.match(/inline std::string NewlineText[\s\S]*?\n}\n/)?.[0];
  expect(helper).toBeTruthy();
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-windows-text-"));
  try {
    const source = path.join(directory, "text.cpp"), executable = path.join(directory, "text");
    writeFileSync(source, `#include <cstdio>\n#include <string>\n${helper}\nint main() { for (auto text : { "one", "one\\rtwo\\rthree", "a\\r\\nb", "\\r", "x\\n" }) printf("[%s]", NewlineText(text).c_str()); }\n`);
    execFileSync("c++", ["-std=c++17", source, "-o", executable]);
    expect(execFileSync(executable, { encoding: "utf8" })).toBe("[one][one\ntwo\nthree][a\nb][\n][x\n]");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
