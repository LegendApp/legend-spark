import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import * as Location from "expo-location";

// Test IDs: system-integration-expo-location-passed, or -failed with the failing cases. The check reads
// state only: a permission prompt needs a person, and Macs have no compass.
const ID = "system-integration-expo-location";

async function check() {
  const permission = await Location.getForegroundPermissionsAsync();
  const services = await Location.hasServicesEnabledAsync();
  const provider = await Location.getProviderStatusAsync();
  const headingError = await Location.getHeadingAsync().then(() => "resolved", (error: { code?: string }) => error.code);
  return {
    info: `permission ${permission.status}, services ${services}, provider ${JSON.stringify(provider)}`,
    failures: [
      !["granted", "denied", "undetermined"].includes(permission.status) && `permission (${permission.status})`,
      typeof services !== "boolean" && "services",
      provider.locationServicesEnabled !== services && "provider status",
      headingError === "resolved" && "heading (a Mac has no compass)",
    ].filter(Boolean),
  };
}

/** expo-location through its own API; Spark's patch builds it for macOS's CoreLocation. */
export function ExpoLocationDemo() {
  const [result, setResult] = useState<string>();
  const [info, setInfo] = useState("");
  const [position, setPosition] = useState<string>();
  useEffect(() => { check().then(({ info, failures }) => { setInfo(info); setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"); }, error => setResult(`failed: ${String(error)}`)); }, []);
  async function locate() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return setPosition(`permission ${permission.status}`);
    const { coords } = await Location.getCurrentPositionAsync();
    const [place] = await Location.reverseGeocodeAsync(coords);
    setPosition(`${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)} ±${Math.round(coords.accuracy ?? 0)} m${place ? ` · ${place.city}, ${place.country}` : ""}`);
  }
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-muted">{info}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
    <Pressable className="self-start rounded-md bg-highlight px-3 py-2" onPress={() => void locate().catch(error => setPosition(String(error)))}>
      <Text className="text-foreground">Locate this Mac…</Text>
    </Pressable>
    {position && <Text selectable className="font-mono text-xs text-muted">{position}</Text>}
  </ScrollView>;
}
