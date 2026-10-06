import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
// Requires a built Kitchen Sink macOS development runtime. Exercises real reloads.
import path from "node:path";
import {writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {availablePort} from '../packages/cli/src/local.ts';
import {nodeCommand} from '../packages/cli/src/windows.ts';
import {projectEnvironment} from '../packages/cli/src/project.ts';
if (process.platform !== 'darwin') throw Error('Fabric reload acceptance requires macOS');
const framework=path.resolve(import.meta.dirname,'..');
const root=path.join(framework,'examples/kitchen-sink');
const entry=root+'/FabricReloadAcceptance.tsx';
const report=path.join(framework,'.spark/fabric-reload-report.json');
const executable=root+'/.spark/platforms/macos/products/dev/KitchenSink.app/Contents/MacOS/KitchenSink';
if(!existsSync(executable))throw Error('Build Kitchen Sink first: bun run spark build --dev --project examples/kitchen-sink');
if(existsSync(entry))throw Error('Temporary entry already exists');
rmSync(report,{force:true});rmSync(report+'.count',{force:true});
writeFileSync(entry,`import {registerRootComponent} from 'expo'; import {useEffect} from 'react'; import {Text,DevSettings} from 'react-native'; import * as files from '@legendapp/spark/files'; import * as windows from '@legendapp/spark/windows';
const report=${JSON.stringify(report)};
function App({windowId}){return windowId&&windowId!=='main'?<Text>Child</Text>:<Checks/>;}
function Checks(){useEffect(()=>{const timer=setTimeout(()=>{void(async()=>{try{const n=await files.exists(report+'.count')?Number(await files.readText(report+'.count')):0;for(let i=0;i<10;i++){await windows.openWindow({id:'reload-race',component:'main',props:{windowId:'reload-race'}});await windows.closeWindow('reload-race');}if(n<3){await files.writeText(report+'.count',String(n+1));DevSettings.reload();}else await files.writeText(report,JSON.stringify({passed:true,reloads:n,cycles:40}));}catch(error){await files.writeText(report,JSON.stringify({passed:false,error:String(error)}));}})();},500);return()=>clearTimeout(timer)},[]);return <Text>Fabric reload acceptance</Text>};registerRootComponent(App);`);
const port=await availablePort();const log=processLog(path.join(framework,'.spark/fabric-reload-metro.log'));
const metro=spawnProcess(nodeCommand(root,'expo','expo',['start','--localhost','--port',String(port),'--max-workers','2']),{cwd:root,env:{...process.env,CI:'1',SPARK_PLATFORM:'macos'},stdout:log,stderr:log});let app;
try{const end=Date.now()+60000;while(!await fetch(`http://127.0.0.1:${port}/status`).then(r=>r.ok,()=>false)){if(Date.now()>end)throw Error('Metro timeout');await sleep(200);}
const output=processLog(path.join(framework,'.spark/fabric-reload-app.log'));app=spawnProcess([executable,'-RCT_jsLocation',`127.0.0.1:${port}`],{cwd:root,env:{...process.env,...projectEnvironment(root),SPARK_BUNDLE_URL:`http://127.0.0.1:${port}/FabricReloadAcceptance.bundle?platform=macos&dev=true&minify=false`},stdout:output,stderr:output});const deadline=Date.now()+90000;while(!existsSync(report)){if(Date.now()>deadline||app.exitCode!==null||app.signalCode!==null)throw Error('Reload probe did not report');await sleep(200);}console.log(readFileSync(report,'utf8'));if(!JSON.parse(readFileSync(report,'utf8')).passed)throw Error('Reload failed');
}finally{app?.kill();if(app)await app.exited;metro.kill();await metro.exited;rmSync(entry,{force:true});}
