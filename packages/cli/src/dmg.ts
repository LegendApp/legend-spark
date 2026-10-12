import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

/** Runs a command to completion and throws when it fails. */
export type Exec = (argv: string[]) => Promise<unknown>;

/**
 * Writes `dmg`: `app` and an `/Applications` link in a compressed, read-only (UDZO) disk image named after the app, as
 * `spark package` and the release harness's `--local` mode distribute it. The image stores no extended attributes of
 * the build machine. `hdiutil makehybrid` writes its HFS+ filesystem itself, so none of the source's attributes, nor
 * the `com.apple.provenance` macOS attaches to each file a tracked process creates, reach it; but it gives every file
 * Finder info, which `codesign --verify --strict` rejects. That is cleared on a writable copy, mounted without Finder
 * and always detached, before the image is compressed. Only the symbolic links keep theirs: HFS+ stores links in it.
 */
export async function createDmg(app: string, dmg: string, exec: Exec): Promise<string> {
  const stage = `${dmg}.stage`, hybrid = `${dmg}.hfs.dmg`, writable = `${dmg}.rw.dmg`, volume = `${dmg}.volume`;
  const temporary = [stage, hybrid, writable, volume];
  for (const file of [...temporary, dmg]) rmSync(file, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  mkdirSync(volume);
  try {
    await exec(["ditto", app, path.join(stage, path.basename(app))]);
    symlinkSync("/Applications", path.join(stage, "Applications"));
    await exec(["hdiutil", "makehybrid", "-quiet", "-hfs", "-hfs-volume-name", path.basename(app, ".app"), "-o", hybrid, stage]);
    await exec(["hdiutil", "convert", "-quiet", hybrid, "-format", "UDRW", "-o", writable]);
    await exec(["hdiutil", "attach", writable, "-nobrowse", "-noautoopen", "-mountpoint", volume]);
    try { await exec(["xattr", "-c", "-r", volume]); }
    finally { await exec(["hdiutil", "detach", volume]).catch(() => exec(["hdiutil", "detach", "-force", volume])); }
    await exec(["hdiutil", "convert", "-quiet", writable, "-format", "UDZO", "-o", dmg]);
  } finally {
    for (const file of temporary) rmSync(file, { recursive: true, force: true });
  }
  return dmg;
}
