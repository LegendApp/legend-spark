import type { SparkConfig } from "@legendapp/spark/config";

export const config = {
  name: "Updates",
  projectId: "updates",
  version: "1.0.0",
  macos: { bundleIdentifier: "com.example.updates" },
  updates: {
    feedURL: "https://example.com/appcast.xml",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    maximumDeltas: 3,
  },
} satisfies SparkConfig;
