import { toByteArray, fromByteArray } from "base64-js";
import type * as FileSystem from "@legendapp/spark/files";
import type { settings } from "@legendapp/spark/settings";
import { assertContract } from "./contract-cases";

async function rejectsCode(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) {
    assertContract((error as { code?: string }).code === code, `Expected ${code}, received ${String(error)}`); return;
  }
  throw new Error(`Expected ${code} rejection`);
}
export async function filesystemLifecycle(files: typeof FileSystem, token: string) {
  const dirs = await Promise.all(["data", "cache", "temp"].map(kind => files.getDirectory(kind as "data" | "cache" | "temp")));
  assertContract(new Set(dirs).size === 3, "App directories must be distinct");
  for (const dir of dirs) assertContract((await files.stat(dir)).type === "directory", "App directory missing");
  const root = `${dirs[2]}/spark-contract-${token}`, file = `${root}/space ü.txt`;
  let watch: Awaited<ReturnType<typeof files.watch>> | undefined;
  try {
    await files.mkdir(`${root}/nested/child`);
    await files.writeText(file, "hello 🌎\n\u0000tail");
    assertContract(await files.readText(file) === "hello 🌎\n\u0000tail", "UTF-8/NUL roundtrip failed");
    const url = `file://${file.startsWith("/") ? "" : "/"}${file.replaceAll("\\", "/").split("/").map((part, i) => i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join("/")}`;
    assertContract(await files.readText(url) === await files.readText(file), "File URL decoding failed");
    await files.writeBytes(`${root}/bytes`, new Uint8Array([0, 1, 2, 3, 254, 255]));
    assertContract(String(await files.readBytes(`${root}/bytes`)) === "0,1,2,3,254,255", "Binary roundtrip failed");
    await files.writeBytes(`${root}/empty`, new Uint8Array());
    assertContract((await files.readBytes(`${root}/empty`)).length === 0, "Empty binary roundtrip failed");
    await rejectsCode(() => files.writeBytes(`${root}/bytes`, "bad" as never), "E_INVALID_ARGUMENT");
    assertContract(String(await files.readBytes(`${root}/bytes`)) === "0,1,2,3,254,255", "Rejected write modified existing data");
    await files.writeBytes(`${root}/invalid-utf8`, new Uint8Array([255]));
    let invalidUTF8 = false; try { await files.readText(`${root}/invalid-utf8`); } catch { invalidUTF8 = true; }
    assertContract(invalidUTF8, "Invalid UTF-8 was silently replaced");
    const info = await files.stat(file);
    assertContract(info.type === "file" && info.size > 0 && Math.abs(info.modifiedAt - Date.now()) < 60000, "Invalid file metadata");
    await files.copy(file, `${root}/copy`); await files.move(`${root}/copy`, `${root}/moved`);
    assertContract(!await files.exists(`${root}/copy`) && await files.readText(`${root}/moved`) === await files.readText(file), "Copy/move failed");
    await rejectsCode(() => files.copy(file, `${root}/moved`), "E_ALREADY_EXISTS");
    await rejectsCode(() => files.move(file, `${root}/moved`), "E_ALREADY_EXISTS");
    assertContract(await files.exists(file), "Failed move removed source");
    await files.writeText(`${root}/nested/child/value`, "recursive");
    await files.copy(`${root}/nested`, `${root}/tree-copy`);
    assertContract(await files.readText(`${root}/tree-copy/child/value`) === "recursive", "Directory copy failed");
    const names = (await files.list(root)).map(entry => entry.name);
    assertContract(names.some(name => name.normalize("NFC") === "space ü.txt") && names.every(name => !name.includes("/") && !name.includes("\\")), "Directory listing must return names");
    await rejectsCode(() => files.readText(`${root}/absent`), "E_NOT_FOUND");
    assertContract(!await files.exists(`${root}/absent`), "Missing file exists");
    await rejectsCode(() => files.remove(`${root}/nested`), "E_NOT_EMPTY");
    await files.remove(`${root}/tree-copy`, { recursive: true });
    assertContract(!await files.exists(`${root}/tree-copy`), "Recursive deletion failed");
    await files.remove(`${root}/empty`);
    await files.remove(`${root}/empty`);
    assertContract(!await files.exists(`${root}/empty`), "Deletion must be idempotent");
    // Wait for distinct changes across two atomic replacements of the same path.
    let notifications = 0, invalidWatchPath = false;
    watch = await files.watch(file, observed => { invalidWatchPath ||= observed.replaceAll("\\", "/").normalize("NFC") !== file.replaceAll("\\", "/").normalize("NFC"); notifications++; });
    for (const text of ["replacement one", "replacement two"]) {
      const before = notifications; await files.writeText(file, text);
      const deadline = Date.now() + 5000;
      while (notifications === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assertContract(!invalidWatchPath && notifications > before && await files.readText(file) === text, `Watch did not survive atomic replacement (invalidPath=${invalidWatchPath}, notifications=${notifications}, before=${before})`);
    }
    await watch.remove(); await watch.remove(); watch = undefined;
    const stopped = notifications; await files.writeText(file, "after unwatch");
    await new Promise(resolve => setTimeout(resolve, 150));
    assertContract(notifications === stopped, "Removed watch still delivered callbacks");
    await files.mkdir(`${root}/watched-directory`);
    let directoryChanged = false;
    watch = await files.watch(`${root}/watched-directory`, () => { directoryChanged = true; });
    await files.move(`${root}/watched-directory`, `${root}/renamed-directory`);
    const deadline = Date.now() + 5000;
    while (!directoryChanged && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assertContract(directoryChanged, "Renaming the watched directory did not invalidate it");
  } finally { await watch?.remove(); await files.remove(root, { recursive: true }); }
}
export async function settingsLifecycle(store: typeof settings, token: string) {
  const key = `contract-${token}`, reserved = `CON.${token}`, escaped = `%43ON.${token}`;
  try {
    await store.set(reserved, "reserved"); await store.set(escaped, "literal percent");
    assertContract(await store.get(reserved) === "reserved" && await store.get(escaped) === "literal percent", "Windows device-name keys collided");
    await store.remove(key); assertContract(await store.get(key) === undefined, "Missing setting must be undefined");
    await store.set(key, { text: "Unicode 🌎", array: [true, null, 2] });
    assertContract(JSON.stringify(await store.get(key)) === JSON.stringify({ text: "Unicode 🌎", array: [true, null, 2] }), "JSON settings roundtrip failed");
    await store.set(key, 0);
    await Promise.all(Array.from({ length: 10 }, () => store.update<number>(key, value => { if (value !== undefined && typeof value !== "number") throw new Error("Invalid counter"); return (value ?? 0) + 1; })));
    assertContract(await store.get(key) === 10, "Concurrent updates lost data");
    try { await store.update(key, () => { throw new Error("expected failure"); }); } catch {}
    await store.update<number>(key, value => { if (value !== undefined && typeof value !== "number") throw new Error("Invalid counter"); return (value ?? 0) + 1; });
    assertContract(await store.get(key) === 11, "Failed update poisoned the queue");
    await store.remove(key); await store.remove(key);
    assertContract(await store.get(key) === undefined, "Settings deletion failed");
  } finally { await store.remove(key); await store.remove(reserved); await store.remove(escaped); }
}

export async function recentDocumentsLifecycle(files: typeof FileSystem, documents: typeof import("@legendapp/spark/app/documents"), token: string) {
  const original = await documents.getRecentDocuments();
  const file = `${await files.getDirectory("temp")}/spark-recent-${token}.txt`;
  try {
    await files.writeText(file, "recent contract");
    await documents.noteRecentDocument(file); await documents.noteRecentDocument(file);
    const recent = await documents.getRecentDocuments();
    const same = (path: string) => path.replaceAll("\\", "/") === file.replaceAll("\\", "/");
    assertContract(same(recent[0].path) && recent.filter(value => same(value.path)).length === 1, "Recent document order/deduplication failed");
    await documents.clearRecentDocuments();
    assertContract((await documents.getRecentDocuments()).length === 0, "Recent document clear failed");
  } finally {
    await documents.clearRecentDocuments();
    for (const value of original.reverse()) await documents.noteRecentDocument(value.path);
    await files.remove(file);
  }
}

export async function richClipboardLifecycle(files: typeof FileSystem, clipboard: typeof import("@legendapp/spark-clipboard/src/desktop"), token: string) {
  const original = await clipboard.readClipboard();
  const file = `${await files.getDirectory("temp")}/clipboard-${token}.txt`;
  try {
    await clipboard.writeClipboard({ text: "plain ü", html: "<b>rich ü</b>", rtf: "{\\rtf1\\ansi rich}" });
    const content = await clipboard.readClipboard();
    assertContract(content.text === "plain ü" && content.html?.includes("<b>rich ü</b>") && content.rtf?.includes("rtf"), "Rich text formats did not roundtrip together");
    assertContract((await clipboard.getClipboardFormats()).length >= 3, "Rich clipboard formats are missing");
    await clipboard.writeClipboard({ image: { format: "png", bytes: toByteArray("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==") } });
    const image = (await clipboard.readClipboard()).image;
    assertContract(image && fromByteArray(image.bytes).startsWith("iVBOR"), "Clipboard bitmap was not returned as PNG");
    await files.writeText(file, "clipboard file"); await clipboard.writeClipboard({ files: [file] });
    assertContract((await clipboard.readClipboard()).files?.[0]?.replaceAll("\\", "/") === file.replaceAll("\\", "/"), "Clipboard file list did not roundtrip");
    await clipboard.clearClipboard();
    assertContract(Object.keys(await clipboard.readClipboard()).length === 0, "Clear left clipboard formats behind");
  } finally {
    const { files: originalFiles, ...originalContent } = original;
    await clipboard.writeClipboard(originalFiles?.length ? { files: originalFiles } : originalContent);
    await files.remove(file);
  }
}

export async function processLifecycle(files: typeof FileSystem, processes: typeof import("@legendapp/spark/processes"), executable: string, windows: boolean, token: string) {
  const command = (script: string) => windows ? ["-NoProfile", "-NonInteractive", "-Command", script] : ["-c", script];
  const env = { SPARK_PROCESS_TEST: "space ü & $value" };
  const result = await processes.runCommand({ target: { type: "executable", path: executable }, env, args: command(windows ? "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Out.Write($env:SPARK_PROCESS_TEST); [Console]::Error.Write('err'); exit 7" : 'printf %s "$SPARK_PROCESS_TEST"; printf err >&2; exit 7') });
  assertContract(result.exit.type === "exited" && result.exit.code === 7 && new TextDecoder().decode(result.stdout) === env.SPARK_PROCESS_TEST && new TextDecoder().decode(result.stderr) === "err" && result.exit.type === "exited", "Process environment, output or exit status changed");
  const stdin = await processes.runCommand({ target: { type: "executable", path: executable }, input: "input ü\n", args: command(windows ? "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Out.Write([Console]::In.ReadToEnd())" : "cat") });
  assertContract(new TextDecoder().decode(stdin.stdout) === "input ü\n", "Initial stdin was not drained before EOF");
  const binary = await processes.runCommand({ target: { type: "executable", path: executable }, args: command(windows ? "$o=[Console]::OpenStandardOutput(); $o.Write([byte[]](0,255,1),0,3)" : "printf '\\000\\377\\001'") });
  assertContract(binary.stdout.join() === "0,255,1", "Binary process output was corrupted");
  const chunks: Uint8Array[] = [];
  const child = await processes.spawn({ target: { type: "executable", path: executable }, args: command(windows ? "[Console]::Out.Write([Console]::In.ReadToEnd())" : "cat"), onOutput: chunk => { if (chunk.stream === "stdout") chunks.push(chunk.bytes); } });
  await child.write("streamed"); await child.closeInput(); const streamed = await child.exited;
  assertContract(new TextDecoder().decode(streamed.stdout) === "streamed" && chunks.length > 0, "Streaming stdin/stdout did not finish");
  const timeout = await processes.runCommand({ target: { type: "executable", path: executable }, timeoutMs: 1000, args: command(windows ? "Start-Sleep -Seconds 30" : "sleep 30") });
  assertContract(timeout.timedOut && timeout.exit.type === "terminated", "Process timeout did not terminate the child");
  const stopped = await processes.spawn({ target: { type: "executable", path: executable }, args: command(windows ? "Start-Sleep -Seconds 30" : "sleep 30") });
  await stopped.terminate(); assertContract((await stopped.exited).exit.type === "terminated", "Explicit termination did not complete");
  if (windows) {
    const script = `${await files.getDirectory("temp")}/spark-args-${token}.ps1`;
    try {
      await files.writeText(script, "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); ConvertTo-Json -InputObject @($args) -Compress");
      const args = ["with spaces", 'embedded"quote', "ends\\", "", "ü&$()"];
      const quoted = await processes.runCommand({ target: { type: "executable", path: executable }, args: ["-NoProfile", "-NonInteractive", "-File", script, ...args] });
      assertContract(JSON.stringify(JSON.parse(new TextDecoder().decode(quoted.stdout))) === JSON.stringify(args), "Windows argument quoting changed values");
    } finally { await files.remove(script); }
  }
}
