import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import QuickCrypto from "react-native-quick-crypto";

// Test IDs: security-quick-crypto-passed, or security-quick-crypto-failed with the failing cases.
const ID = "security-quick-crypto";
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");

async function check() {
  const key = QuickCrypto.randomBytes(32), iv = QuickCrypto.randomBytes(12);
  const cipher = QuickCrypto.createCipheriv("aes-256-gcm", key, iv);
  const sealed = QuickCrypto.Buffer.concat([cipher.update("desktop 🔐", "utf8"), cipher.final()]);
  const decipher = QuickCrypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(cipher.getAuthTag());
  const opened = QuickCrypto.Buffer.concat([decipher.update(sealed), decipher.final()]).toString("utf8");
  const digest = await QuickCrypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"));
  return [
    QuickCrypto.createHash("sha256").update("abc").digest("hex") !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" && "sha256",
    QuickCrypto.createHmac("sha256", "key").update("The quick brown fox jumps over the lazy dog").digest("hex") !== "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8" && "hmac",
    QuickCrypto.pbkdf2Sync("password", "salt", 1, 20, "sha1").toString("hex") !== "0c60c80f961f0e71f3a9b524af6012062fe037a6" && "pbkdf2",
    opened !== "desktop 🔐" && "aes-256-gcm",
    hex(digest) !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" && "subtle.digest",
    (key.length !== 32 || hex(key) === hex(QuickCrypto.randomBytes(32))) && "randomBytes",
    !/^[0-9a-f-]{36}$/.test(QuickCrypto.randomUUID()) && "randomUUID",
  ].filter(Boolean);
}

/** react-native-quick-crypto through its own Node-style API; nothing Spark-specific. */
export function QuickCryptoDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">SHA-256, HMAC, PBKDF2 and WebCrypto digests match published test vectors; AES-256-GCM round-trips.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
