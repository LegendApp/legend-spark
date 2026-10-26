/** A release Runner that can be downloaded; `auto` when the session opens the desktop app without a keypress. */
export type RunnerDownload = { auto: boolean; size?: number };
/** Printed by the download itself, so it sits directly above the progress bar rather than before Metro output. */
export function runnerDownloadMessage(size?: number) {
  return `Downloading Spark Runner${size && size > 0 ? ` (${(size / 1e6).toFixed(1)} MB)` : ""}…`;
}
export function sessionStatus(target: "go" | "dev", available: boolean, issues: string[], running = false, download: RunnerDownload | false = false) {
  if (!available && target === "go" && !issues.length) return {
    compatible: false,
    canBuild: false,
    message: download ? (download.auto ? "" : "Spark Runner is ready to download. Press d to install and open it.") : "The Spark Runner isn’t installed for this SDK.\nInstall an SDK bundle containing a matching Spark Runner (node install.mjs), or register a Spark Runner with spark sdk register <runtime directory>.",
    actions: download && !download.auto ? "d  Download and open Runner · g  Use development build · Ctrl+C  Exit" : "g  Use development build · Ctrl+C  Exit",
  };
  if (issues.length || !available) return {
    compatible: false,
    canBuild: true,
    message: `${target === "dev" && available ? "The development build needs rebuilding." : "A development build is needed."}${issues.length ? "\n" + issues.join("\n") : ""}`,
    actions: `b  ${target === "dev" && available ? "Rebuild" : "Build"} and open · g  Change desktop runtime · Ctrl+C  Exit`,
  };
  return {
    compatible: true,
    canBuild: false,
    message: `● ${running ? "Running in " : "Ready to open "}${target === "go" ? "Spark Runner" : "development build"}\n  Fast Refresh enabled`,
    actions: "d  Open desktop · r  Reload · j  Debugger\ng  Change desktop runtime · Ctrl+C  Exit",
  };
}
