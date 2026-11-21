import { execFileSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { KitchenSinkApp } from "./kitchen-sink.ts";
import type { Driver } from "./driver.ts";

export function releaseSocketProblems(output: string, pid: number, driverSocket: string): string[] {
  if (!output.startsWith(`p${pid}\n`) || !/^f.+$/m.test(output) || !/^t.+$/m.test(output)) throw new Error(`lsof did not list files for the release app (PID ${pid}).`);
  const canonical = (file: string) => file.replace(/^\/private\/var\//, "/var/");
  const problems: string[] = [];
  for (const record of output.split(/^f/m).slice(1)) {
    const type = /^t(.*)$/m.exec(record)?.[1];
    const name = /^n(.*)$/m.exec(record)?.[1] ?? "";
    if (type === "IPv4" || type === "IPv6" || (type === "unix" && name.startsWith("/") && canonical(name) !== canonical(driverSocket))) {
      problems.push(`${type} ${name}`.trim());
    }
  }
  return problems;
}

export async function probeKitchenSinkRelease(app: string) {
  const sink = new KitchenSinkApp(app, true);
  let connections = 0;
  const server = net.createServer(socket => { connections++; socket.destroy(); });
  let driver: Driver | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as net.AddressInfo;
    const host = `127.0.0.1:${port}`;
    await sink.open();
    driver = await sink.launch({
      arguments: ["-RCT_jsLocation", host],
      env: { SPARK_BUNDLE_URL: `http://${host}/index.bundle?platform=macos&dev=true&minify=false` },
    });
    await driver.waitFor("infra-shell-summary");
    await delay(2_000);
    const pid = driver.app.pid;
    if (!pid || !driver.running) throw new Error("The release app exited during the runtime probe.");
    const output = execFileSync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-F", "pftn"], { encoding: "utf8" });
    const problems = releaseSocketProblems(output, pid, path.join(driver.directory, "driver.sock"));
    if (problems.length) throw new Error(`Unexpected sockets in the Kitchen Sink release: ${problems.join(", ")}.`);
  } catch (error) {
    if (!connections) throw error;
  } finally {
    try { await driver?.close(); }
    finally { await Promise.all([sink.close(), new Promise<void>(resolve => server.close(() => resolve()))]); }
  }
  if (connections) throw new Error(`Kitchen Sink contacted the decoy development server (${connections} connections).`);
}
