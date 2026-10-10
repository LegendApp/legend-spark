import * as files from "@legendapp/spark/files";
type Availability = ReturnType<typeof files.getBookmarkAvailability>;
import { fromByteArray, toByteArray } from "base64-js";
import { Platform } from "react-native";

export type FileAPICheck = { id: string; passed: boolean; detail: string };
export type FileAPIDemo = {
  checks: FileAPICheck[];
  availability: { name: string; value: Availability }[];
  fullDiskAccess?: string;
  bookmark?: string;
  diskSpace?: string;
  applications: files.FileApplication[];
  icon?: string;
  thumbnail?: string;
  samplePath?: string;
  bookmarkTarget?: string;
};
/** openWith: an application to open the sample with. quickLook: show the panel (activates the app). Without them those checks only list or are skipped. */
export type FileAPIOptions = { phase?: "create" | "restore"; readOnlyPath?: string; fullPath?: string; openWith?: string; quickLook?: boolean };

const BOOKMARK_FILE = "kitchen-sink-bookmark.bin";
const pngURI = (bytes: Uint8Array) => `data:image/png;base64,${fromByteArray(bytes)}`;
const errorCode = (error: unknown) => (error as { code?: string })?.code ?? String(error);
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
// Two-band 96×64 PNG used as thumbnail and Quick Look content.
const SAMPLE_PNG = toByteArray("iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAAcElEQVR42u3QMQ0AMAgAMJTsnjqEIWw2hgN+kiZV0Ph1GIQCQYIECRIkSJAgBAkSJEiQIEGCECRIkCBBggQJQpAgQYIECVocdPMxECRIkCBBggQJEoQgQYIECRIkSBCCBAkSJEiQIEEIEiRIkCBBizVDQyZKVDlL0gAAAABJRU5ErkJggg==");

export const availabilityQueries = {
  bookmarks: files.getBookmarkAvailability, fullDiskAccess: files.getFullDiskAccessAvailability, coordination: files.getFileCoordinationAvailability,
  openWith: files.getOpenWithAvailability, fileIcons: files.getFileIconAvailability, thumbnails: files.getThumbnailAvailability,
  quickLook: files.getQuickLookAvailability, extendedAttributes: files.getExtendedAttributeAvailability, quarantine: files.getQuarantineAvailability,
  diskSpace: files.getDiskSpaceAvailability,
} as const;

/** Persisted security-scoped bookmark: proves bookmarks survive relaunch. */
export async function bookmarkPath() { return `${await files.getDirectory("data")}/${BOOKMARK_FILE}`; }
export async function saveBookmark(target: string) {
  await files.writeBytes(await bookmarkPath(), await files.createBookmark(target));
  return target;
}
export async function restoreBookmark(): Promise<string | undefined> {
  const path = await bookmarkPath();
  if (!await files.exists(path)) return undefined;
  return files.withBookmarkAccess(await files.readBytes(path), async access => {
    if (access.stale) await files.writeBytes(path, await files.createBookmark(access.path));
    const info = await files.stat(access.path);
    const entries = info.type === "directory" ? `${(await files.list(access.path)).length} items` : `${info.size} bytes`;
    return `${access.path} · ${entries}${access.stale ? " · refreshed" : ""}`;
  });
}

/**
 * Each feature gets three checks: -01 works where available, -02 rejects with a typed
 * SparkError where unavailable, -03 availability agrees with what the operation did.
 */
export async function runFileAPIChecks(options: FileAPIOptions = {}): Promise<FileAPIDemo> {
  const demo: FileAPIDemo = { checks: [], applications: [], availability: Object.entries(availabilityQueries).map(([name, query]) => ({ name, value: query() })) };
  const record = (id: string, passed: boolean, detail: string) => { demo.checks.push({ id, passed, detail }); };
  async function feature(prefix: string, available: boolean, works: () => Promise<string>, unsupported: () => Promise<unknown>) {
    if (available) {
      try { record(`${prefix}-01`, true, await works()); record(`${prefix}-03`, true, "available and the operation succeeded"); }
      catch (error) { record(`${prefix}-01`, false, String(error)); record(`${prefix}-03`, false, `available but failed: ${errorCode(error)}`); }
      return;
    }
    try { await unsupported(); record(`${prefix}-02`, false, "unsupported operation succeeded"); record(`${prefix}-03`, false, "unavailable but the operation succeeded"); }
    catch (error) {
      const typed = error instanceof Error && error.name === "SparkError" && errorCode(error) === "E_UNSUPPORTED_PLATFORM";
      record(`${prefix}-02`, typed, `rejected ${errorCode(error)}`); record(`${prefix}-03`, typed, "unavailable and the operation rejected");
    }
  }
  const root = `${await files.getDirectory("temp")}/file-api-checks`;
  await files.remove(root, { recursive: true }); await files.mkdir(root);
  const sample = `${root}/sample.txt`, image = `${root}/sample.png`;
  await files.writeText(sample, "Kitchen Sink file API sample\n"); await files.writeBytes(image, SAMPLE_PNG);
  demo.samplePath = sample;
  const is = (name: keyof typeof availabilityQueries) => availabilityQueries[name]().available;

  // Bookmarks: phase "create" persists; a relaunched phase "restore" resolves the moved target.
  const target = `${await files.getDirectory("data")}/bookmark-target.txt`, moved = `${await files.getDirectory("data")}/bookmark-target-moved.txt`;
  await feature("FILE-BOOKMARK", is("bookmarks"), async () => {
    if (options.phase === "restore") return files.withBookmarkAccess(await files.readBytes(await bookmarkPath()), async access => {
      assert(access.path.endsWith("bookmark-target-moved.txt"), `Resolved ${access.path}`);
      assert(await files.readText(access.path) === "bookmark target", "Unreadable target");
      return demo.bookmark = `Restored after relaunch: ${access.path}`;
    });
    await files.remove(moved); await files.writeText(target, "bookmark target");
    demo.bookmarkTarget = target;
    await saveBookmark(target);
    demo.bookmark = `Bookmarked ${target}`;
    if (options.phase !== "create") { await files.move(target, moved); const restored = await restoreBookmark(); assert(restored?.startsWith(moved), `Restored ${restored}`); demo.bookmark = `Tracked move: ${restored}`; }
    return demo.bookmark;
  }, () => files.createBookmark(sample));

  await feature("FILE-FDA", is("fullDiskAccess"), async () => { demo.fullDiskAccess = await files.getFullDiskAccessStatus(); return `status: ${demo.fullDiskAccess}`; }, () => files.getFullDiskAccessStatus());

  await feature("FILE-COORD", is("coordination"), async () => {
    const path = `${root}/coordinated.txt`;
    await files.writeText(path, "coordinated", { coordinated: true });
    assert(await files.readText(path, { coordinated: true }) === "coordinated", "Coordinated read mismatch");
    await files.copy(path, `${path}.copy`, { coordinated: true }); await files.move(`${path}.copy`, `${path}.moved`, { coordinated: true });
    await files.remove(`${path}.moved`, { coordinated: true });
    return "write, read, copy, move and remove ran under NSFileCoordinator";
  }, () => files.readText(sample, { coordinated: true }));

  await feature("FILE-OPENWITH", is("openWith"), async () => {
    demo.applications = await files.getApplicationsForFile(sample);
    assert(demo.applications.length > 0 && demo.applications.filter(app => app.isDefault).length === 1, "Expected applications with one default");
    const listed = `${demo.applications.length} apps; default ${demo.applications.find(app => app.isDefault)!.name}`;
    if (!options.openWith) return `${listed}; open not exercised`;
    await files.openWithApplication(sample, options.openWith);
    return `${listed}; opened with ${options.openWith}`;
  }, () => files.getApplicationsForFile(sample));

  await feature("FILE-ICON", is("fileIcons"), async () => { const bytes = await files.getFileIcon(sample, { size: 64 }); demo.icon = pngURI(bytes); return `${bytes.length} byte PNG`; }, () => files.getFileIcon(sample, { size: 64 }));
  await feature("FILE-THUMB", is("thumbnails"), async () => {
    const bytes = await files.getThumbnail(image, { size: 128 }); demo.thumbnail = pngURI(bytes);
    const opaque = `${root}/data.sparkunknown`;
    await files.writeBytes(opaque, new Uint8Array([0, 1, 2]));
    const none = await files.getThumbnail(opaque, { size: 128 }).then(() => undefined, error => error);
    assert(errorCode(none) === "E_UNAVAILABLE", `Unknown content gave ${errorCode(none)} instead of E_UNAVAILABLE`);
    return `${bytes.length} byte PNG; unknown content is E_UNAVAILABLE (no icon substitute)`;
  }, () => files.getThumbnail(image, { size: 128 }));
  // Showing the panel activates the app, so only an explicit Quick Look run records FILE-QL-01.
  if (options.quickLook || !is("quickLook")) await feature("FILE-QL", is("quickLook"), async () => { await files.showQuickLook([image, sample]); return "panel visible"; }, () => files.showQuickLook([sample]));

  await feature("FILE-XATTR", is("extendedAttributes"), async () => {
    const value = new TextEncoder().encode("blue");
    assert(await files.getExtendedAttribute(sample, "so.legend.kitchen-sink.tag") === null, "Unexpected attribute");
    await files.setExtendedAttribute(sample, "so.legend.kitchen-sink.tag", value);
    assert(new TextDecoder().decode((await files.getExtendedAttribute(sample, "so.legend.kitchen-sink.tag"))!) === "blue", "Attribute mismatch");
    assert((await files.listExtendedAttributes(sample)).includes("so.legend.kitchen-sink.tag"), "Attribute not listed");
    await files.removeExtendedAttribute(sample, "so.legend.kitchen-sink.tag"); await files.removeExtendedAttribute(sample, "so.legend.kitchen-sink.tag");
    return "set, read, list and idempotent remove";
  }, () => files.listExtendedAttributes(sample));

  await feature("FILE-QUAR", is("quarantine"), async () => {
    assert(await files.getQuarantine(sample) === null, "Fresh file is quarantined");
    await files.setQuarantine(sample, Platform.OS === "windows" ? { dataURL: "https://example.com/sample.txt" } : { agentName: "Kitchen Sink" });
    const info = await files.getQuarantine(sample);
    assert(info, "Quarantine not recorded");
    await files.clearQuarantine(sample);
    assert(await files.getQuarantine(sample) === null, "Quarantine not cleared");
    return `recorded ${JSON.stringify(info)} then cleared`;
  }, () => files.getQuarantine(sample));

  await feature("FILE-SPACE", is("diskSpace"), async () => {
    const space = await files.getDiskSpace(root);
    assert(space.totalBytes > 0 && space.availableBytes <= space.totalBytes, "Invalid capacity");
    demo.diskSpace = `${gb(space.availableBytes)} available of ${gb(space.totalBytes)}${space.macos ? ` · ${gb(space.macos.importantUsageBytes)} for important use` : ""}`;
    return demo.diskSpace;
  }, () => files.getDiskSpace(root));

  // Typed volume errors. Read-only and full volumes come from the verification harness.
  async function expectCode(id: string, path: string | undefined, code: string, write: (path: string) => Promise<unknown>) {
    if (!path) { record(id, false, "not run: no volume path supplied"); return; }
    const error = await write(path).then(() => undefined, error => error);
    record(id, errorCode(error) === code, error ? `rejected ${errorCode(error)}` : "write succeeded");
  }
  await expectCode("FILE-ERR-01", Platform.OS === "windows" ? undefined : "/Library/spark-permission-probe.txt", "E_PERMISSION_DENIED", path => files.writeText(path, "x"));
  await expectCode("FILE-ERR-02", options.readOnlyPath, "E_READ_ONLY", path => files.writeText(`${path}/spark-read-only-probe.txt`, "x"));
  await expectCode("FILE-ERR-03", options.fullPath, "E_NO_SPACE", path => files.writeBytes(`${path}/spark-full-probe.bin`, new Uint8Array(8 * 1024 * 1024)));
  return demo;
}
