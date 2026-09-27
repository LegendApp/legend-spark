import { SparkError } from "./index";
/** Drive-qualified and UNC paths are absolute on Windows; C:foo and \foo are not. */
export function absolutePath(path: string, platform: string) {
  if (typeof path !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected an absolute path or file URL");
  const windows = /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(path);
  if (path.includes("\0") ||
      !(path.startsWith("file://") || (platform === "windows" ? windows : path.startsWith("/")))) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected an absolute path or file URL");
  }
  return path;
}

/** Decode local file URLs once, preserving native absolute paths. */
export function nativePath(path: string, platform: string): string {
  absolutePath(path, platform);
  if (!path.startsWith("file://")) return path;
  try {
    const url = new URL(path);
    if ((url.hostname && url.hostname !== "localhost") || url.search || url.hash || url.username || url.password || url.port) throw new Error("Expected a local file URL without a query or fragment");
    let decoded = decodeURIComponent(url.pathname);
    if (platform === "windows") decoded = decoded.replace(/^\/(?=[a-z]:)/i, "").replaceAll("/", "\\");
    return absolutePath(decoded, platform);
  } catch (cause) { throw new SparkError("E_INVALID_ARGUMENT", "Expected a native absolute path or local file URL", { cause }); }
}
