const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, symlinkSync, linkSync, copyFileSync, realpathSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const minimum = { node: [24, 19, 0], bun: [1, 3, 14] };
function supported(versions) {
  const name = versions.bun ? 'bun' : 'node';
  const version = versions[name];
  const parts = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(version ?? '')?.slice(1).map(Number);
  if (!parts) return false;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== minimum[name][i]) return parts[i] > minimum[name][i];
  }
  return true;
}

function candidates(command, env) {
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) return [path.resolve(command)];
  return (env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, command + (process.platform === 'win32' ? '.exe' : '')));
}

function selectRuntime(env = process.env, current = process.execPath) {
  const requested = env.SPARK_JS_RUNTIME;
  const choices = requested ? candidates(requested, env) : [current, ...candidates('node', env), ...candidates('bun', env)];
  for (const executable of [...new Set(choices)]) {
    if (!existsSync(executable)) continue;
    const result = spawnSync(executable, ['-p', 'JSON.stringify({node:process.versions.node,bun:process.versions.bun})'], { encoding: 'utf8', timeout: 5000, env });
    try {
      const versions = JSON.parse(result.stdout);
      const name = versions.bun ? 'bun' : 'node';
      if ((requested === 'node' || requested === 'bun') && requested !== name) continue;
      if (result.status === 0 && supported(versions)) return { executable: realpathSync(executable), name, version: versions.bun ?? versions.node };
    } catch {}
  }
  throw new Error(`${requested ? `Requested JavaScript runtime ${requested} is unavailable or unsupported.` : 'No compatible JavaScript runtime found.'} Spark needs Node 24.19.0+ or Bun 1.3.14+. Use the SDK bootstrap to download one.`);
}

function runtimeEnvironment(runtime, env = process.env) {
  const directories = [path.dirname(runtime.executable)];
  if (runtime.name === 'bun') {
    // Upstream scripts and native build phases still invoke "node". Scope its
    // compatibility alias to Spark's children, without changing the user's PATH.
    const key = createHash('sha256').update(runtime.executable + runtime.version).digest('hex').slice(0, 16);
    const bin = path.join(env.SPARK_HOME ?? path.join(os.homedir(), '.spark'), 'tooling', 'shims', key);
    const alias = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
    mkdirSync(bin, { recursive: true });
    if (!existsSync(alias)) {
      try {
        if (process.platform === 'win32') linkSync(runtime.executable, alias);
        else symlinkSync(runtime.executable, alias);
      } catch (error) {
        if (error.code === 'EXDEV' && process.platform === 'win32') copyFileSync(runtime.executable, alias);
        else if (error.code !== 'EEXIST') throw error;
      }
    }
    directories.unshift(bin);
  }
  return { ...env, SPARK_JS_RUNTIME: runtime.executable, NODE_BINARY: runtime.executable, PATH: [...directories, env.PATH ?? ''].join(path.delimiter) };
}

async function initializeRuntime() {
  const runtime = selectRuntime();
  const env = runtimeEnvironment(runtime);
  if (runtime.executable !== realpathSync(process.execPath)) {
    const child = spawn(runtime.executable, process.argv.slice(1), { env, stdio: 'inherit' });
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? 128 + (os.constants.signals[signal] ?? 1)));
    });
    process.exit(code);
  }
  Object.assign(process.env, env);
  return runtime;
}

module.exports = { minimum, supported, selectRuntime, runtimeEnvironment, initializeRuntime };

// Shell/PowerShell can probe an engine without quoting inline JavaScript.
if (require.main === module) {
  const requested = process.argv[2];
  const name = process.versions.bun ? 'bun' : 'node';
  process.exit(supported(process.versions) && (!requested || requested === name) ? 0 : 1);
}
