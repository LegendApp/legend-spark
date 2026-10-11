import { Image, ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { argument } from "../../launch";
import { useFileSystemAPIs, type FileAPIReport } from "./useFileSystemAPIs";

const ID = "files-filesystem-os-integration";
const label = (value: { available: true } | { available: false; reason: string }) => value.available ? "available" : value.reason;

/** Bookmarks, Full Disk Access, coordination, open-with, previews, xattrs, quarantine, disk space and typed volume errors. */
export function OSIntegration({ report }: { report?: FileAPIReport }) {
  const api = useFileSystemAPIs(report);
  const { demo } = api;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">File system APIs</Text>
    <View className="flex-row flex-wrap gap-3">
      <Button testID={`${ID}-run`} disabled={api.running} onPress={api.run}>{api.running ? "Running file API checks…" : "Run file API checks"}</Button>
      <Button testID={`${ID}-bookmark-folder`} onPress={api.bookmarkFolder}>Bookmark a folder…</Button>
      <Button testID={`${ID}-fda-settings`} onPress={api.openFullDiskAccessSettings}>Full Disk Access settings</Button>
      <Button testID={`${ID}-quick-look`} disabled={!demo?.samplePath} onPress={() => api.quickLook([demo!.samplePath!.replace(/sample\.txt$/, "sample.png"), demo!.samplePath!])}>Quick Look sample files</Button>
    </View>
    <Text selectable className="text-sm text-foreground" testID={`${ID}-bookmark-restored`}>Persisted bookmark: {api.restored ?? "Restoring…"}</Text>
    {api.status && <Text selectable className="text-sm text-muted" testID={`${ID}-status`}>{api.status}</Text>}
    {demo && <>
      <View className="flex-row flex-wrap gap-x-6 gap-y-1">
        {demo.availability.map(item => <Text key={item.name} className="text-sm text-muted" testID={`${ID}-availability-${item.name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`}>{item.name}: <Text className={item.value.available ? "text-foreground" : "text-danger"}>{label(item.value)}</Text></Text>)}
      </View>
      <Text selectable className="text-sm text-foreground" testID={`${ID}-fda`}>Full Disk Access: {demo.fullDiskAccess ?? "unavailable"}</Text>
      <Text selectable className="text-sm text-foreground" testID={`${ID}-space`}>Disk space: {demo.diskSpace ?? "unavailable"}</Text>
      {demo.bookmark && <Text selectable className="text-sm text-foreground" testID={`${ID}-bookmark`}>Bookmark check: {demo.bookmark}</Text>}
      <View className="flex-row flex-wrap items-end gap-6">
        {demo.icon && <View className="items-center gap-1"><Image testID={`${ID}-icon`} source={{ uri: demo.icon }} style={{ width: 64, height: 64 }} /><Text className="text-xs text-muted">sample.txt icon</Text></View>}
        {demo.thumbnail && <View className="items-center gap-1"><Image testID={`${ID}-thumbnail`} source={{ uri: demo.thumbnail }} style={{ width: 96, height: 64 }} resizeMode="contain" /><Text className="text-xs text-muted">sample.png thumbnail</Text></View>}
      </View>
      {demo.applications.length > 0 && <View className="gap-2" testID={`${ID}-applications`}>
        <Text className="text-sm font-semibold text-foreground">Open sample.txt with</Text>
        <View className="flex-row flex-wrap gap-3">{demo.applications.slice(0, 4).map(app => <Button key={app.path} onPress={() => api.openWith(demo.samplePath!, app)}>{`${app.name}${app.isDefault ? " (default)" : ""}`}</Button>)}</View>
      </View>}
      {/* Report mode lists IDs compactly so one window shows every result; details are in the JSON report. */}
      <View className={report ? "flex-row flex-wrap gap-x-4 gap-y-1 rounded-md border border-border p-3" : "gap-1 rounded-md border border-border p-3"} testID={`${ID}-checks`}>
        {demo.checks.map(check => <Text key={check.id} selectable testID={`${ID}-${check.id.toLowerCase()}`} className={`${report ? "w-40 text-xs" : "text-sm"} ${check.passed ? "text-muted" : "text-danger"}`}>
          {check.passed ? "PASS" : "FAIL"} {check.id}{report ? "" : ` — ${check.detail}`}
        </Text>)}
      </View>
    </>}
  </ScrollView>;
}

/** --spark-files-api-report launch: runs every check once and writes the JSON report (see e2e/verification/103/verify.ts). */
export function OSIntegrationReport({ report, args }: { report: string; args: readonly string[] }) {
  return <OSIntegration report={{
    report, phase: argument(args, "--spark-files-api-phase") as "create" | "restore" | undefined,
    readOnlyPath: argument(args, "--spark-files-readonly"), fullPath: argument(args, "--spark-files-full"),
    openWith: argument(args, "--spark-files-api-open-with"), quickLook: args.includes("--spark-files-api-quick-look"),
  }} />;
}
