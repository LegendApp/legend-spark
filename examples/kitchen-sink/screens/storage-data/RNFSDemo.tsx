import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as RNFS from "@dr.pogodin/react-native-fs";

// Test IDs: storage-data-rn-fs-passed, or -failed with the failing step.
const ID = "storage-data-rn-fs";

async function check() {
  const folder = `${RNFS.CachesDirectoryPath}/kitchen-sink-rn-fs-${Date.now()}`;
  const file = `${folder}/note.txt`;
  const text = "Spark ✓ héllo";
  await RNFS.mkdir(folder);
  try {
    await RNFS.writeFile(file, text, "utf8");
    await RNFS.appendFile(file, "!", "utf8");
    const read = await RNFS.readFile(file, "utf8");
    const base64 = await RNFS.readFile(file, "base64");
    const info = await RNFS.stat(file);
    const listing = await RNFS.readDir(folder);
    return [
      read !== `${text}!` && `read back (${read})`,
      !base64 && "base64",
      (!info.isFile() || Number(info.size) !== new TextEncoder().encode(`${text}!`).length) && `stat size ${info.size}`,
      (listing.length !== 1 || listing[0].name !== "note.txt") && "readDir",
      !RNFS.DocumentDirectoryPath && "document path",
    ].filter(Boolean);
  } finally {
    await RNFS.unlink(folder);
    if (await RNFS.exists(folder)) throw new Error("folder still exists after unlink");
  }
}

/** @dr.pogodin/react-native-fs: write, append, read, stat, list and delete files in the app's caches folder. */
export function RNFSDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Writes, appends to, reads, stats and lists a UTF-8 file in a temporary caches folder, then deletes the folder.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
    <Text selectable className="font-mono text-xs text-muted">{`Documents ${RNFS.DocumentDirectoryPath}\nCaches ${RNFS.CachesDirectoryPath}`}</Text>
  </ScrollView>;
}
