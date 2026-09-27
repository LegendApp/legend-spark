import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { serveTestHTTP } from "./testing/http.ts";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { create } from "../packages/cli/src/create.ts";
import { run } from "../packages/cli/src/commands.ts";
import { buildWindows, nodeCommand, prepareWindows } from "../packages/cli/src/windows.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { readJson, writeJson, stateFile, projectEnvironment } from "../packages/cli/src/project.ts";
import { createReport, record, saveReport, installedVersions } from "./testing/report.ts";
import { architecture } from "../packages/cli/src/platform.ts";
const framework = path.resolve(import.meta.dirname, "..");
const prepareOnly = process.argv.includes("--prepare-only");
if (!prepareOnly && process.platform !== "win32") throw new Error("Native acceptance requires Windows. Use --prepare-only for generation/bundling.");
process.env.SPARK_PLATFORM = "windows";
const at = process.argv.indexOf("--project");
const root = path.resolve(at < 0 ? `.spark/windows-features/WindowsFeatures${Date.now()}` : process.argv[at + 1]!);
await run(framework, [process.execPath, "scripts/pack.ts", "--platform=windows"]);
await create(root, path.join(framework, "artifacts/packages/manifest.json"), "windows", true);
const pkg = readJson(path.join(root, "package.json"));
for (const name of ["@legendapp/spark"]) pkg.dependencies[name] = pkg.overrides[name];
writeJson(path.join(root, "package.json"), pkg); await run(root, managerCommand(packageManager(root), ["install"]));
for (const file of ["contract-cases.ts", "contract-report.ts", "desktop-contract-cases.ts"]) cpSync(path.join(framework, "examples/kitchen-sink", file), path.join(root, file));
const coverage = createReport(framework, root, { platform: "windows", arch: architecture("windows"), device: "Windows desktop", mode: "dev" }, prepareOnly ? "prepare" : "runtime");
const coverageFile = path.join(framework, ".spark/test-results", `${coverage.runId}.json`);
coverage.versions = installedVersions(root);
let coverageStage = "build.project";
saveReport(coverageFile, coverage);
const token = crypto.randomUUID();
let finish!: (value: any) => void;
const result = new Promise<any>(resolve => finish = resolve);
let latestReport: any;
const server = await serveTestHTTP({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (request.method !== "POST" || new URL(request.url).pathname !== `/${token}`) return new Response("Not found", { status: 404 });
  const report = latestReport = await request.json();
  for (const check of report.contracts ?? []) record(coverage, check);
  saveReport(coverageFile, coverage);
  if (report.error || report.passed) finish(report); return new Response("ok");
} });
const reportURL = `http://127.0.0.1:${server.port}/${token}`;
const sampleFile = path.join(root, ".spark/windows-feature-sample.txt");
writeFileSync(path.join(root, "App.tsx"), `import { useEffect, useState } from 'react';
import { View, Text, Appearance } from 'react-native';
import { Button, TextInput, Select } from '@legendapp/spark/ui';
import * as Clipboard from '@legendapp/spark/clipboard';
import * as SecureStore from '@legendapp/spark/secure-storage';
import * as Linking from '@legendapp/spark/links';
import * as Files from '@legendapp/spark/files';
import * as FileSystem from '@legendapp/spark/files';
import { settings } from '@legendapp/spark/settings';
import { filesystemLifecycle, settingsLifecycle } from './desktop-contract-cases';
import * as Windows from '@legendapp/spark/windows';
import { clipboardRead, clipboardRoundTrip, secureStorageLifecycle, linkingResolution, fileConflict } from './contract-cases';
import { executeCase, type CaseResult } from './contract-report';
const contracts: CaseResult[]=[];
async function check(id: string, action:()=>Promise<void>) { const result=await executeCase(id,action); contracts.push(result); if(result.status==='failed')throw Error(result.detail); }
const options = [{label:'First',value:'first'},{label:'Second',value:'second'}];
export default function App({windowId='main'}: {windowId?: string}) {
 return windowId==='main' ? <Main/> : <Text>Secondary window acceptance</Text>;
}
function Main() {
 const [launchURLs,setLaunchURLs]=useState<string[]>([]);
 useEffect(()=>{let removed=false;let subscription: {remove():void}|undefined;
  void Linking.onOpen(event=>setLaunchURLs(current=>current.includes(event.url)?current:[...current,event.url])).then(value=>{if(removed)value.remove();else subscription=value;});
  return ()=>{removed=true;subscription?.remove();};
 },[]);
 const [api,setAPI]=useState(false), [pressed,setPressed]=useState(false), [text,setText]=useState(''), [value,setValue]=useState('first');
 useEffect(()=>{void (async()=>{
  await check('clipboard.read',()=>clipboardRead(Clipboard));
  await check('clipboard.roundtrip',()=>clipboardRoundTrip(Clipboard,'Spark native probe'));
  await check('storage.lifecycle',()=>secureStorageLifecycle(SecureStore,'probe-${token}'));
  await check('links.resolution',()=>linkingResolution(Linking));
  await check('files.conflict',()=>fileConflict(Files,${JSON.stringify(sampleFile)}));
  await check('desktop.filesystem',()=>filesystemLifecycle(FileSystem,'${token}'));
  await check('desktop.settings',async()=>{
   await settingsLifecycle(settings,'${token}');
   const key='restart-${token}', previous=await settings.get(key);
   if((await Linking.getInitialURL())==='spark-probe://recovered') {
    if(previous!=='saved before termination') throw Error('Settings did not survive process restart');
    await settings.remove(key);
   } else { if(previous!==undefined) throw Error('Test settings key was not isolated'); await settings.set(key,'saved before termination'); }
  });
  await check('windows.geometry',async()=>{
  const displays=await Windows.getDisplays();
  if(!displays.length||!displays.every(d=>d.scale>0&&d.frame.width>0&&d.workArea.height>0)) throw Error('Invalid displays');
  const child='acceptance-window';
  try {
   await Windows.openWindow({id:child,title:'Window acceptance',width:500,height:400,minWidth:300,minHeight:200,maxWidth:900,maxHeight:700,resizable:true,alwaysOnTop:false});
   if(!(await Windows.listWindows()).some(w=>w.id===child)) throw Error('Secondary window missing');
   await Windows.setWindowOptions(child,{title:'Changed title',resizable:false,alwaysOnTop:true});
   const changed=await Windows.getWindow(child);
   if(changed.title!=='Changed title'||changed.resizable||!changed.alwaysOnTop) throw Error('Window options ignored');
   await Windows.setWindowOptions(child,{resizable:true,alwaysOnTop:false});
   await Windows.setWindowFrame(child,{x:displays[0].workArea.x+40,y:displays[0].workArea.y+40,width:600,height:450});
   const moved=await Windows.getWindow(child);
   if(moved.frame.width!==600||moved.frame.height!==450) throw Error('Window frame ignored');
   await Windows.centerWindow(child);
   await Windows.setFullscreen(child,true); if(!(await Windows.getWindow(child)).fullscreen) throw Error('Fullscreen ignored');
   await Windows.setFullscreen(child,false); if((await Windows.getWindow(child)).fullscreen) throw Error('Fullscreen restore failed');
  } finally {await Windows.closeWindow(child);await Windows.showWindow('main');}
  });
  await check('appearance.override',async()=>{
  const system=Appearance.getColorScheme();
  for(const theme of ['dark','light',null] as const) {
   await new Promise<void>((resolve,reject)=>{
    const expected=theme??system, before=Appearance.getColorScheme();
    const timer=setTimeout(()=>{subscription.remove();reject(Error('Appearance change event missing'));},5000);
    const subscription=Appearance.addChangeListener(event=>{if(event.colorScheme===expected){clearTimeout(timer);subscription.remove();resolve();}});
    Appearance.setColorScheme(theme);
    if(Appearance.getColorScheme()!==expected){clearTimeout(timer);subscription.remove();reject(Error('Appearance override ignored'));}
    // Resetting to the already-effective system theme needs no redundant event.
    if(before===expected){clearTimeout(timer);subscription.remove();resolve();}
   });
  }
  });
  setAPI(true);
 })().catch(error=>fetch(${JSON.stringify(reportURL)},{method:'POST',body:JSON.stringify({error:String(error),contracts})}));},[]);
 useEffect(()=>{const passed=api&&pressed&&text==='Native edit'&&value==='second'&&launchURLs.includes('spark-probe://first')&&launchURLs.includes('spark-probe://second');
  void fetch(${JSON.stringify(reportURL)},{method:'POST',body:JSON.stringify({passed,api,launchURLs,contracts:[...contracts,...(pressed?[{id:'ui.button',status:'passed'}]:[]),...(text==='Native edit'?[{id:'ui.input',status:'passed'}]:[]),...(value==='second'?[{id:'ui.select',status:'passed'}]:[])],checks:['clipboard','credentials','linking','files','windows','appearance','simultaneous-launch-forwarding','button','text-input','select'],hermes:!!(globalThis as any).HermesInternal})});
 },[api,pressed,text,value,launchURLs]);
 return <View style={{padding:30,gap:20}}><Text>Windows native acceptance</Text><Button testID='spark-button' onPress={()=>setPressed(true)}>Native button</Button><TextInput testID='spark-input' defaultValue='Initial' onChangeText={setText}/><Select testID='spark-select' options={options} value={value} onValueChange={setValue}/><Text>{api?'APIs passed':'Checking APIs'} {text} {value}</Text></View>;
}`);
let metro: ReturnType<typeof spawnProcess> | undefined, app: ReturnType<typeof spawnProcess> | undefined;
const clients: ReturnType<typeof spawnProcess>[] = [];
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) { if (latestReport?.error) throw new Error(latestReport.error); if (check()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
try {
  await prepareWindows(root, "dev");
  record(coverage, { id: "build.project", status: "passed" }); coverageStage = "build.bundle";
  await run(root, nodeCommand(root, "expo", "expo", ["export:embed", "--entry-file", "index.ts", "--platform", "windows", "--dev", "true", "--max-workers", "2", "--bundle-output", stateFile(root, "features.js")]), { capture: true });
  record(coverage, { id: "build.bundle", status: "passed" });
  if (prepareOnly) console.log(`PASS Windows feature project and bundle: ${root}`);
  else {
    coverageStage = "build.native";
    const product = await buildWindows(root, "dev", false), port = await availablePort();
    coverage.runtime = product.runtime; record(coverage, { id: "build.native", status: "passed" }); coverageStage = "runtime.launch";
    writeJson(stateFile(root, "session.json"), { compatible: true, target: "test", port });
    const log = processLog(stateFile(root, "features-metro.log"));
    metro = spawnProcess(nodeCommand(root, "expo", "expo", ["start", "--localhost", "--port", String(port), "--max-workers", "2"]), { cwd: root, env: { ...process.env, CI: "1" }, stdout: log, stderr: log });
    for (let i = 0; i < 120; i++) {
      if (await fetch(`http://127.0.0.1:${port}/status`).then(r => r.ok, () => false)) break;
      await sleep(500);
    }
    const startClient = (url: string) => {
      const child = spawnProcess([path.join(product.app, "MyApp.exe"), url], { cwd: product.app,
        env: { ...process.env, ...projectEnvironment(root), SPARK_METRO_PORT: String(port) }, stdout: "inherit", stderr: "inherit" });
      clients.push(child); return child;
    };
    const first = startClient("spark-probe://first"), second = startClient("spark-probe://second");
    await until(() => [first, second].filter(child => child.exitCode === null).length === 1, "one primary instance");
    app = first.exitCode === null ? first : second;
    const forwarded = first === app ? second : first;
    if (forwarded.exitCode !== 0) throw new Error("Secondary launch failed to forward");
    await until(() => latestReport?.api && latestReport?.launchURLs?.includes("spark-probe://first") && latestReport?.launchURLs?.includes("spark-probe://second"), "queued and forwarded launches in the primary");
    record(coverage, { id: "runtime.launch", status: "passed" }); record(coverage, { id: "lifecycle.forwarding", status: "passed" });
    coverageStage = "ui-driver";
    await run(root, ["pwsh.exe", "-NoProfile", "-File", path.join(framework, "scripts/windows-feature-controls.ps1"), "-AppProcess", String(app.pid)], { capture: true });
    const report = await Promise.race([result, sleep(60_000).then(() => { throw new Error("Timed out waiting for Windows native callbacks"); })]);
    if (!report.passed || !report.hermes) throw new Error(JSON.stringify(report));
    for (const id of ["ui.button", "ui.input", "ui.select"]) record(coverage, { id, status: "passed", evidence: "Windows UI Automation and verified React callbacks" });
    coverageStage = "lifecycle.recovery";
    // Terminating the owner abandons its mutex. A new process must recover without
    // an existing window/property or a manual registry cleanup.
    app.kill(); await app.exited; latestReport = undefined;
    app = startClient("spark-probe://recovered");
    await until(() => latestReport?.api && latestReport?.launchURLs?.includes("spark-probe://recovered"), "restart after owner termination");
    record(coverage, { id: "lifecycle.recovery", status: "passed" });
    report.checks.push("single-instance-crash-recovery");
    writeJson(stateFile(root, "features-results.json"), report);
    console.log(`PASS Windows native acceptance: ${report.checks.join(", ")}`);
  }
} catch (error) {
  coverage.execution = "failed"; coverage.error = String(error);
  if (coverageStage !== "ui-driver" && !coverage.results.some(c => c.status === "failed")) record(coverage, { id: coverageStage, status: "failed", detail: String(error) });
  throw error;
} finally {
  if (coverage.execution === "running") coverage.execution = "completed";
  coverage.finishedAt = new Date().toISOString(); saveReport(coverageFile, coverage);
  console.log(`Platform coverage: ${coverageFile}`);
  for (const client of clients) if (client.exitCode === null) { client.kill(); await client.exited; }
  if (metro) { metro.kill(); await metro.exited; }
  await server.stop(true);
}
