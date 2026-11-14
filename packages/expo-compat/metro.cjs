const fs = require("node:fs");
const path = require("node:path");

const libraries = ["clipboard"];

exports.withExpoCompat = config => {
  const root = path.resolve(config.projectRoot || process.cwd());
  const manifest = path.join(root, "package.json");
  const app = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : {};
  const dependencies = { ...app.dependencies, ...app.devDependencies, ...app.optionalDependencies };
  const redirects = new Map(libraries.filter(name => dependencies[`expo-${name}`])
    .map(name => [`expo-${name}`, path.join(__dirname, "src", `${name}.ts`)]));
  if (!redirects.size) return config;

  const owners = new Map();
  function sparkOwns(file) {
    let directory = path.dirname(file);
    const visited = [];
    while (!owners.has(directory)) {
      visited.push(directory);
      const manifest = path.join(directory, "package.json");
      if (fs.existsSync(manifest)) {
        const { name } = JSON.parse(fs.readFileSync(manifest, "utf8"));
        owners.set(directory, /^@legendapp\/spark(?:-|$)/.test(name || ""));
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) { owners.set(directory, false); break; }
      directory = parent;
    }
    const owned = owners.get(directory);
    for (const location of visited) owners.set(location, owned);
    return owned;
  }
  const resolve = config.resolver?.resolveRequest;
  return { ...config, resolver: { ...config.resolver, resolveRequest(context, name, platform) {
    // Spark's mobile adapters must keep importing the upstream implementation,
    // including when Metro crawls their sources from a workspace or vendor tree.
    if (platform === "macos" && redirects.has(name) && !sparkOwns(context.originModulePath)) {
      return { type: "sourceFile", filePath: redirects.get(name) };
    }
    return resolve ? resolve(context, name, platform) : context.resolveRequest(context, name, platform);
  } } };
};
