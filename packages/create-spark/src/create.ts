import { cliArguments } from "../../cli/src/cli-arguments.ts";
import { create } from "../../cli/src/create.ts";
import { examples, type Example } from "../../cli/src/examples.ts";
import { hostPlatform, type AppPlatform } from "../../cli/src/platform.ts";
import type { PackageManager } from "../../cli/src/package-manager.ts";
import path from "node:path";
import { creatorArguments, checkCreatorVersion } from "./version.ts";

export async function createSpark(args: string[]) {
  const { requested, forwarded } = creatorArguments(args);
  const { positionals, values } = cliArguments(["create", ...forwarded]);
  if (values.help) {
    console.log("Usage: npm create @legendapp/spark@next MyApp -- [--next | --latest | --spark-version <version|tag>] [--universal] [--platform macos|windows|ios|android|web] [--example document-editor|notes-lite|music-lite|diff-lite] [--bundle-id com.yourcompany.myapp] [--packages manifest.json] [--package-manager npm|pnpm|yarn|bun]");
    return;
  }
  if (values.example && !examples.includes(values.example as Example)) throw new Error(`Use --example ${examples.join(" | ")}`);
  if (requested) {
    if (values.packages) throw new Error("Release version flags cannot be combined with --packages.");
    await checkCreatorVersion(requested, forwarded);
  }
  const platform = (values.platform ?? hostPlatform()) as AppPlatform;
  process.env.SPARK_PLATFORM = platform;
  try {
    await create(path.resolve(positionals[1]!), values.packages ? path.resolve(values.packages) : undefined, platform, !!values.universal, values.example as Example | undefined, values["package-manager"] as PackageManager | undefined, values["bundle-id"]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Use create --universal")) {
      throw new Error(error.message.replace("Use create --universal", `Use npm create @legendapp/spark@next ${positionals[1] ?? "MyApp"} -- --universal`));
    }
    if (error instanceof Error && error.message.includes("Run spark --help")) {
      throw new Error(error.message.replace("Run spark --help", "Run npm create @legendapp/spark@next -- --help"));
    }
    throw error;
  }
}
