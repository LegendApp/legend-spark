import { VERSION } from "../../cli/src/project.ts";

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
    } else forwarded.push(arg);
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
    const args = forwarded.filter(arg => arg !== "--").map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
    throw new Error(`Spark ${requested} resolves to ${resolved}, but this creator bundles ${VERSION}. Run the matching self-contained creator:\nnpx @legendapp/create-spark@${resolved} ${args}`);
  }
}
