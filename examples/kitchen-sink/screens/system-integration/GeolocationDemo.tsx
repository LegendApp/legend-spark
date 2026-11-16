import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import Geolocation from "@react-native-community/geolocation";

// Test IDs: system-integration-geolocation-passed, or -failed. The check never asks for permission:
// a prompt needs a person. Locating is a button.
const ID = "system-integration-geolocation";

/** @react-native-community/geolocation on CoreLocation: configuration, a watch id, and locating on demand. */
export function GeolocationDemo() {
  const [result, setResult] = useState<string>();
  const [position, setPosition] = useState<string>();
  useEffect(() => {
    try {
      Geolocation.setRNConfiguration({ skipPermissionRequests: true, authorizationLevel: "whenInUse", locationProvider: "auto" });
      setResult(typeof Geolocation.getCurrentPosition === "function" && typeof Geolocation.watchPosition === "function" ? "passed" : "failed: missing methods");
    } catch (error) { setResult(`failed: ${String(error)}`); }
  }, []);
  function locate() {
    Geolocation.setRNConfiguration({ skipPermissionRequests: false, authorizationLevel: "whenInUse" });
    Geolocation.getCurrentPosition(
      ({ coords }) => setPosition(`${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)} ±${Math.round(coords.accuracy)} m`),
      error => setPosition(`error ${error.code}: ${error.message}`),
      { timeout: 15000, maximumAge: 60000 });
  }
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
    <Pressable className="self-start rounded-md bg-highlight px-3 py-2" onPress={locate}>
      <Text className="text-foreground">Locate this Mac…</Text>
    </Pressable>
    {position && <Text selectable className="font-mono text-xs text-muted">{position}</Text>}
  </ScrollView>;
}
