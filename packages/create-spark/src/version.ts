import { createRequire } from "node:module";
import { VERSION } from "../../cli/src/project.ts";
import { managerCommand } from "../../cli/src/package-manager.ts";
import { spawnProcess } from "../../cli/src/process.ts";

export function creatorArguments(args: string[]) {
  const forwarded: string[] = [];
  let requested: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--spark-version" || arg.startsWith("--spark-version=") || arg === "--next" || arg === "--latest") {
      if (requested !== undefined) throw new Error("Choose only one of --next, --latest, or --spark-version.");
      const value = arg === "--spark-version" ? args[++index] : arg.startsWith("--spark-version=") ? arg.slice(16) : arg.slice(2);
      if (!value || value.startsWith("-")) throw new Error("--spark-version requires a version or tag");
      requested = value;
    } else if (arg !== "--") forwarded.push(arg);
  }
  return { requested, forwarded };
}

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export async function resolveCreatorVersion(requested: string, fetcher: typeof fetch = fetch) {
  if (exactVersion.test(requested)) return requested;
  if (!/^[a-zA-Z][\w.-]*$/.test(requested)) throw new Error(`Invalid Spark version or tag: ${requested}`);
  const response = await fetcher("https://registry.npmjs.org/-/package/@legendapp%2fspark/dist-tags", { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Could not resolve Spark tag ${requested}: npm registry HTTP ${response.status}`);
  const tags = await response.json() as Record<string, string>;
  const version = tags[requested];
  if (!version || !exactVersion.test(version)) throw new Error(`npm has no exact Spark version for tag ${requested}`);
  return version;
}

export async function checkCreatorVersion(requested: string, forwarded: string[]) {
  const resolved = await resolveCreatorVersion(requested);
  if (resolved !== VERSION) {
    throw new Error(`Spark ${requested} resolves to ${resolved}, but this creator bundles ${VERSION}. Run the matching self-contained creator:\nnpx @legendapp/create-spark@${resolved} ${shellArguments(forwarded)}`);
  }
}

// pnpm 11+ skips versions younger than a day (minimumReleaseAge), so on release day
// `pnpm create`/`pnpm dlx` can run an older creator. Re-run the newest one instead.
export function rerunCommand(spec: string, args: string[], env: Record<string, string | undefined> = process.env) {
  const agent = env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm/")) return managerCommand("pnpm", ["dlx", spec, ...args], env);
  if (agent.startsWith("bun/")) return managerCommand("bun", ["x", spec, ...args], env);
  if (/^yarn\/[2-9]/.test(agent)) return managerCommand("yarn", ["dlx", "-p", spec, "create-spark", ...args], env);
  return managerCommand("npm", ["exec", "--yes", `--package=${spec}`, "--", "create-spark", ...args], env);
}

export async function rerunNewerCreator(requested: string | undefined, args: string[], fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env) {
  const channel = VERSION.match(/-([^.]+)/)?.[1] ?? "latest";
  if (env.SPARK_CREATOR_RERUN || (requested && requested !== channel) || args.some(arg => arg === "--spark-version" || arg.startsWith("--spark-version="))) return undefined;
  // Managers do not always expose the original spec. Honor it when available;
  // otherwise only refresh the bundled creator's default channel.
  const selections = [...args, ...Object.entries(env).filter(([key]) => /^(npm_config_(user_agent|argv|package)|pnpm_config_(argv|package)|npx_package)$/i.test(key)).map(([, value]) => value ?? "")];
  for (const selection of selections) {
    for (const spec of selection.matchAll(/(?:@legendapp\/(?:create-)?spark|create-spark)[@/]([^\s"',\]\\]+)/g)) {
      if (spec[1] !== channel) return undefined;
    }
  }
  let tags: Record<string, string>, valid: (version: string) => string | null, gt: (a: string, b: string) => boolean;
  try {
    const response = await fetcher("https://registry.npmjs.org/-/package/@legendapp%2fcreate-spark/dist-tags", { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return undefined;
    tags = await response.json() as Record<string, string>;
    ({ valid, gt } = createRequire(createRequire(import.meta.url).resolve("npm/package.json"))("semver"));
  } catch (error) {
    // Fail open: a creator that cannot check for a newer one still creates the app.
    if (env.SPARK_DEBUG === "1") console.error(`Skipped the newer-creator check: ${error}`);
    return undefined;
  }
  const newer = tags[channel];
  if (!newer || !valid(newer) || !gt(newer, VERSION) || (newer.match(/-([^.]+)/)?.[1] ?? "latest") !== channel) return undefined;
  const argv = rerunCommand(`@legendapp/create-spark@${newer}`, args, env);
  console.log(`Running @legendapp/create-spark@${newer}; this creator is ${VERSION}.`);
  try {
    return await spawnProcess(argv, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...env, SPARK_CREATOR_RERUN: "1", pnpm_config_minimum_release_age: "0", npm_config_minimum_release_age: "0" } }).exited;
  } catch {
    throw new Error(`Run the current creator instead:\nnpx @legendapp/create-spark@${newer} ${shellArguments(args)}`);
  }
}

function shellArguments(args: string[]) {
  return args.filter(arg => arg !== "--").map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
}
