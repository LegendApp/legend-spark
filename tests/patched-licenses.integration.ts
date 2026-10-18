import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Check the actual release assets, not just the unpacked preparation stages.
const manifestFile = path.resolve(process.argv[2]!);
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const root = path.resolve(import.meta.dirname, "..");
for (const name of ["expo-audio", "react-native-nitro-modules"]) {
  const archive = path.join(path.dirname(manifestFile), manifest[name]);
  const metadata = JSON.parse(execFileSync("tar", ["-xOzf", archive, "package/package.json"], { encoding: "utf8" }));
  const provenance = execFileSync("tar", ["-xOzf", archive, "package/LICENSE.provenance"], { encoding: "utf8" });
  assert.equal(provenance.split(/\r?\n/)[0], `Upstream: ${name}@${metadata.version}`, `${name}: stale license provenance`);
  for (const file of ["LICENSE", "LICENSE.provenance"]) {
    const packed = execFileSync("tar", ["-xOzf", archive, `package/${file}`], { encoding: "utf8" });
    assert.equal(packed, readFileSync(path.join(root, "patches/licenses", name, file), "utf8"), `${name}: ${file}`);
  }
  console.log(`PASS ${name}: authoritative LICENSE and pinned provenance in packed asset`);
}
