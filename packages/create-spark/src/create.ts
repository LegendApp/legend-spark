import { cliArguments } from "../../cli/src/cli-arguments.ts";
import { create } from "../../cli/src/create.ts";
import { examples, type Example } from "../../cli/src/examples.ts";
import { hostPlatform, type AppPlatform } from "../../cli/src/platform.ts";
import type { PackageManager } from "../../cli/src/package-manager.ts";
import path from "node:path";

export async function createSpark(args: string[]) {
  const { positionals, values } = cliArguments(["create", ...args]);
  if (values.help) {
    console.log("Usage: npm create @legendapp/spark MyApp -- [--universal] [--platform macos|windows|ios|android|web] [--example document-editor|notes-lite|music-lite|diff-lite] [--packages manifest.json] [--package-manager npm|pnpm|yarn|bun]");
    return;
  }
  if (values.example && !examples.includes(values.example as Example)) throw new Error(`Use --example ${examples.join(" | ")}`);
  const platform = (values.platform ?? hostPlatform()) as AppPlatform;
  process.env.SPARK_PLATFORM = platform;
  await create(path.resolve(positionals[1]!), values.packages ? path.resolve(values.packages) : undefined, platform, !!values.universal, values.example as Example | undefined, values["package-manager"] as PackageManager | undefined);
}
