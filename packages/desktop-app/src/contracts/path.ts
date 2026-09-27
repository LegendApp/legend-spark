import { SparkError } from "./index";
/** Drive-qualified and UNC paths are absolute on Windows; C:foo and \foo are not. */
export function absolutePath(path: string, platform: string) {
  const windows = /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(path);
  if (typeof path !== "string" || path.includes("\0") ||
      !(path.startsWith("file://") || (platform === "windows" ? windows : path.startsWith("/")))) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected an absolute path or file URL");
  }
  return path;
}
