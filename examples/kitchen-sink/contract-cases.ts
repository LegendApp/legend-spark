// Portable assertions: these run inside the app against its real platform bindings.
// Keep this file free of Node and native imports so every runner uses the same cases.
export interface ClipboardBinding {
  getStringAsync(): Promise<string>;
  setStringAsync(value: string): Promise<unknown>;
  hasStringAsync(): Promise<boolean>;
}
export interface SecureStorageBinding {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}
export interface LinkingBinding { canOpenURL(url: string): Promise<boolean>; getInitialURL(): Promise<string | null> }
export interface FileBinding {
  writeText(path: string, text: string): Promise<unknown>;
  readText(path: string): Promise<string>;
  writeTextIfUnchanged(path: string, expected: string, text: string): Promise<{ written: boolean }>;
}
export function assertContract(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function clipboardRead(clipboard: ClipboardBinding) {
  assertContract(typeof await clipboard.getStringAsync() === "string", "Clipboard read must return a string");
  assertContract(typeof await clipboard.hasStringAsync() === "boolean", "Clipboard presence must return a boolean");
}
export async function clipboardRoundTrip(clipboard: ClipboardBinding, token: string) {
  const original = await clipboard.getStringAsync();
  try {
    assertContract(await clipboard.setStringAsync(token) !== false, "Clipboard write was denied");
    assertContract(await clipboard.getStringAsync() === token, "Clipboard text round trip failed");
    assertContract(await clipboard.hasStringAsync(), "Clipboard presence did not reflect the write");
    await clipboard.setStringAsync("");
    assertContract(await clipboard.getStringAsync() === "", "Empty clipboard string changed");
  } finally { assertContract(await clipboard.setStringAsync(original) !== false, "Clipboard restoration was denied"); }
}
export async function secureStorageLifecycle(storage: SecureStorageBinding, token: string) {
  assertContract(await storage.isAvailableAsync(), "Secure storage backend unavailable");
  try {
    await storage.deleteItemAsync(token);
    assertContract(await storage.getItemAsync(token) === null, "Missing credential must be null");
    await storage.setItemAsync(token, "test 🌍");
    assertContract(await storage.getItemAsync(token) === "test 🌍", "Credential round trip failed");
    await storage.setItemAsync(token, "");
    assertContract(await storage.getItemAsync(token) === "", "Empty credential is not missing");
    await storage.deleteItemAsync(token);
    await storage.deleteItemAsync(token);
    assertContract(await storage.getItemAsync(token) === null, "Credential removal failed");
  } finally { await storage.deleteItemAsync(token); }
}
export async function linkingResolution(linking: LinkingBinding) {
  const initial = await linking.getInitialURL();
  assertContract(initial === null || typeof initial === "string", "Invalid initial URL");
  assertContract(await linking.getInitialURL() === initial, "Initial URL changed between reads");
  assertContract(await linking.canOpenURL("https://example.com"), "No HTTPS handler");
}
export async function fileConflict(files: FileBinding, file: string) {
  await files.writeText(file, "before");
  assertContract((await files.writeTextIfUnchanged(file, "before", "after")).written, "File save failed");
  assertContract(!(await files.writeTextIfUnchanged(file, "wrong", "lost")).written, "File conflict was ignored");
  assertContract(await files.readText(file) === "after", "Conflicting save changed the file");
}
