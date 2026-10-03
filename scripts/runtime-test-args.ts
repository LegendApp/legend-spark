export function runtimeTestArgs(args: string[], defaultRoot: string) {
  let root: string | undefined;
  let packageManifest: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const value = args[i]!;
    if (value === "--packages") {
      const manifest = args[++i];
      if (!manifest || manifest.startsWith("--")) throw new Error("--packages requires a path to an existing, verified SDK package manifest.");
      packageManifest = manifest;
    } else if (!value.startsWith("--")) {
      if (root) throw new Error(`Unexpected extra runtime test path: ${value}`);
      root = value;
    }
  }
  return { root: root ?? defaultRoot, packageManifest };
}
