import { Platform } from "react-native";
import { callLinks, linksCommand } from "@legendapp/spark-desktop-links/src/native";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
export { subscribeToOpenRequests, type OpenRequest } from "@legendapp/spark-desktop-app/src/open-requests";
export interface RecentDocument { path: string; name: string }
export async function noteRecentDocument(path: string): Promise<void> { await linksCommand("noteRecent", { path: nativePath(path, Platform.OS) }); }
export function clearRecentDocuments(): Promise<void> { return linksCommand("clearRecent"); }
export async function getRecentDocuments(): Promise<RecentDocument[]> {
  const paths = await callLinks("recent", {}, (value): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string"));
  return paths.map(value => {
    try { const path = nativePath(value, Platform.OS); return { path, name: (Platform.OS === "windows" ? path.replaceAll("\\", "/") : path).split("/").filter(Boolean).at(-1) ?? path }; }
    catch (cause) { throw new SparkError("E_INVALID_DATA", "Recent document contains an invalid path", { cause }); }
  });
}
