import { Button } from "./Controls";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { writeText } from "@legendapp/spark/files";
import { quit } from "@legendapp/spark/app";
import { runAPIChecks } from "./api-checks";
import { sdkTestDriver } from "./sdk-test-driver";
import type { Check } from "./checks";

async function execute(onResult: (check: Check) => void, expectedInitial?: string | null) {
  const results: (Check & { contracts?: string[] })[] = [];
  await runAPIChecks(async (name, action, contracts) => {
    const start = Date.now(); let error: string | undefined;
    try { await action(); } catch (cause) { error = String(cause); }
    const result = { name, contracts, passed: error === undefined, error, duration: Date.now() - start };
    results.push(result); onResult(result);
  }, sdkTestDriver, expectedInitial);
  return { passed: results.every(check => check.passed), results, nativeDriver: !!sdkTestDriver };
}
export function APIChecks({ report, expectedInitial }: { report?: string; expectedInitial?: string | null }) {
  const [results, setResults] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!report) return;
    // A cancelled development mount must not start native mutations.
    const timer = setTimeout(() => {
      void execute(result => setResults(previous => [...previous, result]), expectedInitial)
        .then(outcome => writeText(report, JSON.stringify(outcome, null, 2)))
        .catch(error => writeText(report, JSON.stringify({ passed: false, error: String(error) })))
        .then(() => quit()).catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [report, expectedInitial]);
  async function run() {
    setRunning(true); setResults([]);
    try { await execute(result => setResults(previous => [...previous, result])); }
    finally { setRunning(false); }
  }
  return <View style={{ gap: 8 }} testID="expo-api-checks">
    {!report && <Button disabled={running} onPress={() => void run().catch(console.error)}>{running ? "Checking APIs…" : "Run Expo API checks"}</Button>}
    {!sdkTestDriver && <Text style={styles.note} className="text-muted">Clipboard mutation and injected URL checks run in the dedicated native test build.</Text>}
    {results.map(result => <Text key={result.name} className={result.passed ? "text-success" : "text-danger"} style={{ fontSize: 14 }}>{result.passed ? "PASS" : "FAIL"} {result.name}{result.error ? `: ${result.error}` : ""}</Text>)}
  </View>;
}

const styles = StyleSheet.create({
  note: { fontSize: 13 },
});
