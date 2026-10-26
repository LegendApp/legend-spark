import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "./CameraText";
import { CompatibilityViewComponent, type CompatibilityView } from "@legendapp/spark-nitro-view-probe";
import { callback } from "react-native-nitro-modules";
import { writeText } from "@legendapp/spark/files";

export type ProofCheck = { name: string; passed: boolean; detail?: unknown };
export function NitroCompatibility({ report, onComplete }: { report?: string; onComplete?: (passed: boolean) => void }) {
  const native = useRef<CompatibilityView | null>(null);
  const hybridRef = useMemo(() => callback((view: CompatibilityView) => { native.current = view; }), []);
  const [label, setLabel] = useState("Initial native label");
  const [width, setWidth] = useState(320);
  const [mounted, setMounted] = useState(true);
  const [checks, setChecks] = useState<ProofCheck[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const waitFor = async (predicate: () => boolean) => {
      for (let i = 0; i < 100; i++) {
        if (disposed) throw new Error("Probe unmounted");
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error("Native view did not reach the expected state within five seconds");
    };
    const results: ProofCheck[] = [];
    const check = (name: string, detail: unknown) => { results.push({ name, passed: true, detail }); setChecks([...results]); };
    // Defer so an effect's development cleanup can cancel before touching the view.
    const timer = setTimeout(() => { void (async () => {
      try {
        await waitFor(() => native.current !== null && JSON.parse(native.current.snapshot()).attached);
        const first = native.current!;
        await waitFor(() => { const s = JSON.parse(first.snapshot()); return s.label === "Initial native label" && s.width === 320; });
        check("Mount, native props and layout", JSON.parse(first.snapshot()));
        setLabel("Updated from React"); setWidth(480);
        await waitFor(() => { const s = JSON.parse(first.snapshot()); return s.label === "Updated from React" && s.width === 480; });
        check("React prop update and native resize", JSON.parse(first.snapshot()));
        setMounted(false);
        await waitFor(() => { const s = JSON.parse(first.snapshot()); return !s.attached && s.drops === 1; });
        check("Unmount detaches and cleans up exactly once", JSON.parse(first.snapshot()));
        native.current = null; setMounted(true);
        await waitFor(() => native.current !== null && JSON.parse(native.current.snapshot()).attached);
        const last = JSON.parse(native.current!.snapshot());
        if (last.label !== "Updated from React") throw new Error("Remounted native view lost its props");
        check("Remount and native method call", last);
        if (report) await writeText(report, JSON.stringify({ passed: true, react: "19.2.0", reactNative: "0.83.10", reactNativeMacOS: "0.83.0", nitro: "0.37.0", results }, null, 2));
        if (!disposed) onComplete?.(true);
      } catch (cause) {
        if (disposed) return;
        setError(String(cause));
        if (report) await writeText(report, JSON.stringify({ passed: false, error: String(cause), results }, null, 2));
        onComplete?.(false);
      }
    })(); }, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [report, onComplete]);
  return <View style={{ gap: 12 }} testID="nitro-compatibility">
    <Text style={{ fontSize: 18, fontWeight: "600" }}>Native view compatibility</Text>
    <Text>React Native macOS 0.83.0 · Nitro 0.37.0</Text>
    {mounted && <CompatibilityViewComponent label={label} style={{ width, height: 120 }} hybridRef={hybridRef} />}
    {checks.map(check => <Text key={check.name}>PASS · {check.name}</Text>)}
    {error ? <Text style={{ color: "#b42318" }}>{error}</Text> : null}
  </View>;
}
