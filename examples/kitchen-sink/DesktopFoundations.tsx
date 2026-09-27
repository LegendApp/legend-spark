import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "./ActionButton";
import { EventResults, useEventResults } from "./EventResults";
import * as files from "@legendapp/spark/files";
import * as windows from "@legendapp/spark/windows";
import { DragDropView, type DragOverEvent } from "@legendapp/spark/drag-drop";
const source = { data: { "application/x-spark-example-item": '{"id":"sample","title":"Example item"}' } };
const types = ["application/x-spark-example-item"];
const move: "move"[] = ["move"];
export function DesktopFoundations({ report }: { report: (value: unknown) => void }) {
  return <View style={{ gap: 10 }}>
    <Text className="text-foreground">Desktop foundations</Text>
    <ActionButton onPress={async () => {
      await windows.openWindow({ id: "overlay-demo", kind: "overlay", component: "main", size: { width: 340, height: 140 }, props: { windowId: "overlay-demo", windowProps: { overlay: true } } });
      report("Overlay opened without requesting focus. Its background is transparent; click its Close button when finished.");
    }}>Open nonactivating overlay</ActionButton>
    <RecursiveWatchDemo report={report} />
    <CustomDragDemo report={report} />
  </View>;
}
function RecursiveWatchDemo({ report }: { report: (value: unknown) => void }) {
  const [root, setRoot] = useState("");
  const [entries, log] = useEventResults(report);
  const current = useRef<{ root: string; watch: Awaited<ReturnType<typeof files.watch>> } | undefined>(undefined);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; const value = current.current; current.current = undefined; if (value) void value.watch.remove().then(() => files.remove(value.root, { recursive: true })).catch(console.error); }; }, []);
  return <View style={{ gap: 8 }}>
    <ActionButton onPress={async () => {
      if (current.current) {
        const value = current.current; current.current = undefined; setRoot(""); await value.watch.remove(); await files.remove(value.root, { recursive: true }); log("Watch stopped");
      } else {
        const directory = `${await files.getDirectory("temp")}/watch-demo-${Date.now()}`;
        await files.mkdir(`${directory}/nested/deep`);
        const watch = await files.watch(directory, changed => log({ changed }), { recursive: true });
        if (!active.current) { await watch.remove(); await files.remove(directory, { recursive: true }); return; }
        current.current = { root: directory, watch }; setRoot(directory); log(`Watching ${directory}`);
      }
    }}>{root ? "Stop recursive watch" : "Start recursive watch"}</ActionButton>
    <ActionButton disabled={!root} onPress={async () => { await files.writeText(`${root}/nested/deep/example.txt`, `Changed at ${Date.now()}`); }}>Write a deeply nested file</ActionButton>
    <EventResults testID="recursive-watch-events" entries={entries} empty="Start a watch, then write the nested file. Each event invalidates the watched tree." />
  </View>;
}
function CustomDragDemo({ report }: { report: (value: unknown) => void }) {
  const [over, setOver] = useState<DragOverEvent>();
  const [entries, log] = useEventResults(report);
  return <View style={{ gap: 8 }}>
    <DragDropView source={source} sourceOperations={move} onDragEnd={event => log({ type: "end", ...event })} style={{ padding: 12, borderWidth: 1 }}><Text className="text-foreground">Drag custom item (move)</Text></DragDropView>
    <DragDropView acceptedTypes={types} acceptedOperations={move} onDragOver={setOver} onDragLeave={() => setOver(undefined)} onDrop={event => { setOver(undefined); log({ type: "drop", ...event }); }} style={{ padding: 12, borderWidth: 1, minHeight: 70 }}>
      <Text className="text-foreground">{over ? `${over.operation} at ${Math.round(over.x)}, ${Math.round(over.y)}` : "Drop the custom item here; unrelated formats are rejected"}</Text>
    </DragDropView>
    <EventResults testID="custom-drag-events" entries={entries} empty="Drop an item to inspect its MIME data and negotiated operation." />
  </View>;
}
