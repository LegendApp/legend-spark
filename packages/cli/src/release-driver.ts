import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Strings only the in-app test driver's code contains (docs/test-driver.md#builds): the driver's socket name and log
// prefix, commands of its own sources (commit watching, accessibility audit, exposed state), commands other packages
// register with it, the host's exposed-state reply, and diagnostics' simulated crash hook. A release build has them
// only with macos.testDriverInRelease, so the CLI checks every macOS release build for them.
const CORE = ["driver.sock", "Spark test driver:"];
const MARKERS = [...CORE, "startCommits", "accessibilityAudit", "driverListeners", "replyDriverState", "simulateSystemEvent",
  "simulateDisplays", "setTestClipboard", "testDrag", "advanceClock", "waitForMotion", "SPARK_SIMULATE_CRASH"];

/** The test driver markers in the app's code: every file under Contents/MacOS and Contents/Frameworks. */
export function testDriverMarkers(app: string): string[] {
  const found = new Set<string>();
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const bytes = readFileSync(file);
        for (const marker of MARKERS) if (bytes.includes(marker)) found.add(marker);
      }
    }
  };
  for (const directory of ["MacOS", "Frameworks"]) if (existsSync(path.join(app, "Contents", directory))) visit(path.join(app, "Contents", directory));
  return MARKERS.filter(marker => found.has(marker));
}

/** Throws unless the release app has the test driver exactly when `inRelease` (macos.testDriverInRelease) asks for it. */
export function checkReleaseTestDriver(app: string, inRelease: boolean) {
  const found = testDriverMarkers(app);
  if (!inRelease && found.length) throw new Error(`The release build contains test driver code (${found.join(", ")}) without macos.testDriverInRelease. Check that every Spark podspec sets SPARK_TEST_DRIVER and that driver code sits inside #if SPARK_TEST_DRIVER (docs/test-driver.md#builds).`);
  const missing = CORE.filter(marker => !found.includes(marker));
  if (inRelease && missing.length) throw new Error(`macos.testDriverInRelease is set, but the release build lacks the test driver (${missing.join(", ")}; docs/test-driver.md#builds).`);
}
