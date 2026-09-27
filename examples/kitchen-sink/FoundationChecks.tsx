import { useEffect, useRef } from "react";
import { Text, View, TurboModuleRegistry, type TurboModule } from "react-native";
import { DragDropView, type DropEvent, type DragOverEvent } from "@legendapp/spark/drag-drop";
import { writeText } from "@legendapp/spark/files";
import { openWindow, closeWindow } from "@legendapp/spark/windows";
import type { TestDriver } from "./test-driver";
const testDriver = TurboModuleRegistry.get<TestDriver & TurboModule>("NativeSDKTestDriver");
import { runFoundationChecks } from "./foundation-checks";
const source = { data: { "application/x-spark-test-item": '{"id":42}' } };
const types = ["application/x-spark-test-item"];
const move: "move"[] = ["move"];
export function FoundationChecks({ report }: { report: string }) {
  const drag = useRef<{ drop?: DropEvent; over?: DragOverEvent; operation?: string }>({});
  useEffect(() => {
    const timer = setTimeout(() => {
      const results: { name: string; passed: boolean; error?: string }[] = [];
      const check = async (name: string, action: () => Promise<void>) => {
        try { await action(); results.push({ name, passed: true }); }
        catch (error) { results.push({ name, passed: false, error: String(error) }); }
      };
      void (async () => {
        await runFoundationChecks(check);
        const driver = testDriver;
        if (driver) {
          await check("AppKit overlay is transparent, borderless, nonactivating and status-level", async () => {
            try {
              await openWindow({ id: "foundation-overlay", kind: "overlay", component: "main", size: { width: 340, height: 140 }, props: { windowId: "foundation-overlay", windowProps: {} } });
              const info = JSON.parse(await driver.call("overlayInfo", JSON.stringify({ identifier: "spark.foundation-overlay" })));
              if (!info.panel || info.canBecomeKey || !info.borderless || !info.transparent || !info.statusLevel) throw new Error(JSON.stringify(info));
            } finally { await closeWindow("foundation-overlay"); }
          });
          await check("native custom drag data, hover and move completion round-trip", async () => {
            await driver.call("dragDrop", JSON.stringify({ source: "foundation-drag-source", target: "foundation-drop-target", custom: true, operation: "move" }));
            const deadline = Date.now() + 3000;
            while ((!drag.current.drop || !drag.current.over || !drag.current.operation) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
            const { drop, over, operation } = drag.current;
            if (drop?.data?.[types[0]!] !== '{"id":42}' || drop.operation !== "move" || over?.x !== 12 || over.y !== 14 || operation !== "move") throw new Error(JSON.stringify(drag.current));
            drag.current = {};
            await driver.call("dragDrop", JSON.stringify({ source: "foundation-drag-source", target: "foundation-drop-target", custom: true, operation: "copy", expectRejected: true }));
            await new Promise(resolve => setTimeout(resolve, 100));
            if (drag.current.drop || drag.current.over || drag.current.operation !== "none") throw new Error("Rejected operation delivered drop/hover");
          });
        }
        await writeText(report, JSON.stringify({ passed: results.every(result => result.passed), nativeDriver: !!testDriver, results }, null, 2));
      })().catch(error => void writeText(report, JSON.stringify({ passed: false, error: String(error), results })));
    }, 250);
    return () => clearTimeout(timer);
  }, [report]);
  return <View style={{ flex: 1 }}><Text>Desktop foundation checks</Text>
    <DragDropView testID="foundation-drag-source" source={source} sourceOperations={move} onDragEnd={event => { drag.current.operation = event.operation; }} style={{ height: 70 }}><Text>Custom drag source</Text></DragDropView>
    <DragDropView testID="foundation-drop-target" acceptedTypes={types} acceptedOperations={move} onDrop={event => { drag.current.drop = event; }} onDragOver={event => { drag.current.over = event; }} style={{ height: 70 }}><Text>Custom drop target</Text></DragDropView>
  </View>;
}
