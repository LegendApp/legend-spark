import "react-native-get-random-values";
import { useEffect, useState } from "react";
import { ScrollView, Text, TurboModuleRegistry, type TurboModule } from "react-native";

// Test IDs: security-get-random-values-passed, or -failed with the failing cases.
const ID = "security-get-random-values";

function rejects(action: () => unknown, message: string) {
  try { action(); } catch (error) { return String((error as Error).message).includes(message); }
  return false;
}

function check() {
  const first = crypto.getRandomValues(new Uint8Array(32));
  const second = crypto.getRandomValues(new Uint8Array(32));
  const words = crypto.getRandomValues(new Uint32Array(8));
  // With expo-crypto installed the polyfill delegates to it; call the library's own macOS module too.
  const native = TurboModuleRegistry.get<{ getRandomBase64(length: number): string } & TurboModule>("RNGetRandomValues")?.getRandomBase64(24);
  return [
    first.every(byte => byte === 0) && "uint8 bytes",
    first.every((byte, index) => byte === second[index]) && "repeated bytes",
    words.every(word => word === 0) && "uint32 words",
    !rejects(() => crypto.getRandomValues(new Uint8Array(65537)), "65536") && "65,537-byte request not rejected",
    !rejects(() => crypto.getRandomValues(new Float32Array(4) as unknown as Uint8Array), "integer array") && "float array not rejected",
    (!native || atob(native).length !== 24) && `native module base64 (${native})`,
  ].filter(Boolean);
}

/** react-native-get-random-values: crypto.getRandomValues backed by its native module (or expo-crypto when the app has it). */
export function GetRandomValuesDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { try { const failures = check(); setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"); } catch (error) { setResult(`failed: ${String(error)}`); } }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Fills typed arrays through crypto.getRandomValues, rejects requests the Web Crypto spec forbids, and reads bytes from the library's own native module.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
