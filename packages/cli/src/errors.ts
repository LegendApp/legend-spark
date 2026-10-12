import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Command failures retain diagnostics without making callers parse their message.
export class CommandError extends Error {
  constructor(readonly argv: string[], readonly code: number, readonly output: string, readonly log?: string) {
    super(`${argv.join(" ")} exited ${code}${log ? `. See ${log}` : ""}${output ? `\n${output.slice(-1800)}` : ""}`);
    this.name = "CommandError";
  }
}

export function isNetworkError(error: unknown) {
  const message = error instanceof CommandError ? error.output : error instanceof Error ? error.message : String(error);
  return /NSURLErrorDomain Code=-(?:1001|1005|1009)|internet connection appears to be offline|\b(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENETUNREACH)\b|could not resolve host|failed to connect|network is unreachable/i.test(message);
}

export function errorPresentation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const command = error instanceof CommandError ? error.argv.join(" ") : "";
  const details = error instanceof CommandError ? error.output : message;
  let summary = message.split("\n")[0] || "An unexpected error occurred.";
  let next: string | undefined;
  if (isNetworkError(error)) {
    summary = command.includes("notarytool") ? "Could not reach Apple’s notarization service." : "Could not reach the remote service.";
    next = "Check your internet connection or VPN, then retry the same command.";
  } else if ((/\b(?:E401|ENEEDAUTH)\b|401 Unauthorized/i.test(details) && /npm/.test(command || message)) || command === "npm whoami") {
    summary = "npm authentication failed.";
    next = "Run npm login, then retry the same release command.";
  } else if (command === "gh auth status" || /gh auth login/.test(details)) {
    summary = "GitHub authentication failed.";
    next = "Run gh auth login, then retry the same command.";
  } else if (/No Keychain password item found for profile:/.test(details)) {
    summary = "The selected notarization Keychain profile was not found.";
    next = "Run spark credentials to select an existing profile or explicitly create one.";
  } else if (/notarytool/.test(command) && /\b401\b|invalid credentials|authentication/i.test(details)) {
    summary = "Apple rejected the notarization credentials.";
    next = "Run spark credentials to select or explicitly create a valid Keychain profile.";
  } else if (error instanceof CommandError) {
    const checks: Record<string, string> = { "bun run test": "Tests failed.", "bun run typecheck": "Type checking failed.", "bun install --frozen-lockfile": "Dependency installation failed." };
    summary = checks[command] ?? `${command} failed (exit ${error.code}).`;
    next = "Review the diagnostic log or output above, fix the problem, then retry the same command.";
  }
  return { summary, next };
}

function diagnostics(error: unknown, seen = new Set<unknown>()): string {
  let result = String(error);
  if (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    result = error.stack ?? error.message;
    if (error instanceof CommandError && error.output) result += `\n\nCommand output:\n${error.output}`;
    if (error.cause) result += `\n\nCaused by:\n${diagnostics(error.cause, seen)}`;
  }
  return result;
}

export function reportError(root: string, error: unknown, label = "Release") {
  const { summary, next } = errorPresentation(error);
  console.error(`\n${label} stopped: ${summary}`);
  if (next) console.error(`Next: ${next}`);
  let log: string | undefined;
  try {
    const folder = path.join(root, ".spark/logs");
    mkdirSync(folder, { recursive: true });
    const destination = path.join(folder, `${Date.now()}-${crypto.randomUUID()}-error.log`);
    writeFileSync(destination, diagnostics(error));
    log = destination;
  } catch {
    // Reporting must still work when the original failure was a full disk.
    if (error instanceof CommandError) log = error.log;
  }
  if (log) console.error(`Details: ${log}`);
  else console.error("Could not save diagnostics. Set SPARK_DEBUG=1 to print them.");
  if (process.env.SPARK_DEBUG === "1") console.error(diagnostics(error));
}

export async function releaseCommand(root: string, action: () => Promise<void>) {
  try { await action(); }
  catch (error) {
    reportError(root, error);
    process.exitCode = 1;
  }
}
