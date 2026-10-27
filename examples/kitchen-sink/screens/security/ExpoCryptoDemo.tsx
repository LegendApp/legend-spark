import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as Crypto from "expo-crypto";

// Test IDs: security-expo-crypto-passed, or -failed with the failing cases.
const ID = "security-expo-crypto";

async function check() {
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, "abc");
  const sha1 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, "abc", { encoding: Crypto.CryptoEncoding.BASE64 });
  // The sync getRandomBytes falls back to Math.random in development builds; the async one always asks the native module.
  const bytes = await Crypto.getRandomBytesAsync(16);
  return [
    sha256 !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" && "sha256",
    sha1 !== "qZk+NkcGgWq6PiVxeFDCbJzQ2J0=" && `sha1 (${sha1})`,
    (bytes.length !== 16 || bytes.every(byte => byte === 0)) && "random bytes",
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(Crypto.randomUUID()) && "uuid",
  ].filter(Boolean);
}

/** expo-crypto through its own API; it supports macOS upstream. */
export function ExpoCryptoDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">SHA-256 and SHA-1 digests of "abc" match published vectors; random bytes and a v4 UUID come from the native module.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
