declare const __provider: "op" | "nitro";
declare const __now: () => number;
declare const __print: (value: string) => void;
import { createDatabase } from "../../packages/sqlite/src/database";
const COUNT=20000, POINTS=1000;
function assert(ok:unknown,message:string){if(!ok)throw new Error(message);}
function rowArray(result:any){if(__provider!=="op")return result.rows._array;if(result.rows)return result.rows;return (result.rawRows??[]).map((values:any[])=>Object.fromEntries(result.columnNames.map((name:string,i:number)=>[name,values[i]])));}
export async function run(open:any) {
 const native=open({name:"benchmark.sqlite"});
 const asyncExecute=(sql:string,params:any[]=[])=>__provider==="op"?native.execute(sql,params):native.executeAsync(sql,params);
 const syncExecute=(sql:string,params:any[]=[])=>__provider==="op"?native.executeSync(sql,params):native.execute(sql,params);
 const batchCommands=(commands:any[])=>__provider==="op"?commands:commands.map(([query,params])=>({query,params}));
 const batch=(commands:any[])=>__provider==="op"?native.executeBatch(commands):native.executeBatchAsync(commands);
 const backend={async execute(sql:string,params:any[]){const result=await asyncExecute(sql,params);return {rows:rowArray(result),rowsAffected:result.rowsAffected,insertId:result.insertId};},close:()=>native.close()};
 const db=createDatabase(backend);
 const initial=await db.getFirst("PRAGMA journal_mode");
 await db.run("PRAGMA journal_mode=WAL"); await db.run("PRAGMA synchronous=FULL"); await db.run("PRAGMA busy_timeout=5000");
 const metadata={provider:__provider,sqlite:await db.getFirst("SELECT sqlite_version() AS version"),compileOptions:await db.getAll("PRAGMA compile_options"),initialJournal:initial,journal:await db.getFirst("PRAGMA journal_mode"),synchronous:await db.getFirst("PRAGMA synchronous"),rows:COUNT,points:POINTS};
 await db.run("DROP TABLE IF EXISTS items"); await db.run("DROP TABLE IF EXISTS writes");
 await db.run("CREATE TABLE items(id INTEGER PRIMARY KEY, group_id INTEGER, title TEXT, body TEXT, rating REAL, optional TEXT, content BLOB)");
 await db.run("CREATE INDEX items_group ON items(group_id,id)");
 await db.run("CREATE TABLE writes(id INTEGER PRIMARY KEY,value TEXT)");
 const body="α😀"+"x".repeat(252),blob=new Uint8Array([0,1,127,128,255]).buffer;
 const seed=batchCommands(Array.from({length:COUNT},(_,id)=>["INSERT INTO items VALUES(?,?,?,?,?,?,?)",[id,id%100,`Title ${id}`,body,id/10,null,blob]]));
 await batch(seed);
 // Exercise the exact Spark adapter's result, blob and transaction contracts.
 const first=await db.getFirst("SELECT * FROM items WHERE id=?",[0]);
 assert(first?.body===body&&first.optional===null&&first.content instanceof Uint8Array&&first.content[4]===255,"SQL value roundtrip");
 const change=await db.run("INSERT INTO writes(value) VALUES(?)",["first"]);assert(change.changes===1&&change.lastInsertRowId===1,"change metadata");
 try{await db.transaction(async tx=>{await tx.run("INSERT INTO writes(value) VALUES('rolled back')");throw new Error("rollback fixture");});}catch(error){assert(String(error).includes("rollback fixture"),"rollback error");}
 assert((await db.getFirst("SELECT count(*) AS n FROM writes"))?.n===1,"rollback atomicity");
 await db.transaction(async tx=>{await tx.run("INSERT INTO writes(value) VALUES('committed')");});
 assert((await db.getFirst("SELECT count(*) AS n FROM writes"))?.n===2,"commit atomicity");
 let rejected=false;await db.transaction(async()=>{try{await db.getFirst("SELECT 1");}catch(error){rejected=(error as any).code==="E_BUSY";}});assert(rejected,"transaction ownership");
 let failed=false;try{await db.run("invalid SQL");}catch(error){failed=(error as any).code==="E_NATIVE";}assert(failed,"error translation");
 assert((await db.getFirst("SELECT count(*) AS n FROM items"))?.n===COUNT,"seed cardinality");
 const reader=open({name:"benchmark.sqlite",readOnly:true,...(__provider==="nitro"?{connection:"independent"}:{})});
 await db.transaction(async tx=>{await tx.run("INSERT INTO writes(value) VALUES('uncommitted')");const query="SELECT count(*) AS n FROM writes";const result=__provider==="op"?await reader.execute(query):await reader.executeAsync(query);assert(rowArray(result)[0].n===2,"independent reader must not see uncommitted writes");});reader.close();
 __print(JSON.stringify({metadata,correctness:"passed"}));
 const samples:any[]=[];
 async function measure(name:string,units:number,fn:()=>Promise<void>|void){await fn();for(let trial=0;trial<7;trial++){const start=__now();await fn();samples.push({name,units,trial,ms:__now()-start});}}
 const pointSQL="SELECT id,title,rating FROM items WHERE id=?";
 await measure("spark.point-read",POINTS,async()=>{let sum=0;for(let i=0;i<POINTS;i++)sum+=(await db.getFirst(pointSQL,[i]))!.id as number;assert(sum===POINTS*(POINTS-1)/2,"point read checksum");});
 await measure("spark.filtered-pages",100,async()=>{for(let group=0;group<100;group++){const rows=await db.getAll("SELECT id,title FROM items WHERE group_id=? ORDER BY id LIMIT 20",[group]);assert(rows.length===20&&rows[0].id===group,"page checksum");}});
 await measure("spark.bulk-narrow",COUNT,async()=>{const rows=await db.getAll("SELECT id,title,rating FROM items ORDER BY id");let sum=0;for(const row of rows)sum+=row.id as number;assert(rows.length===COUNT&&sum===COUNT*(COUNT-1)/2,"narrow checksum");});
 await measure("spark.bulk-wide",COUNT,async()=>{const rows=await db.getAll("SELECT * FROM items ORDER BY id");let sum=0;for(const row of rows)sum+=(row.content as Uint8Array)[4];assert(rows.length===COUNT&&sum===COUNT*255,"wide checksum");});
 await measure("spark.transaction-insert",1000,async()=>{await db.run("DELETE FROM writes");await db.transaction(async tx=>{for(let i=0;i<1000;i++)await tx.run("INSERT INTO writes(id,value) VALUES(?,?)",[i,body]);});assert((await db.getFirst("SELECT count(*) AS n FROM writes"))?.n===1000,"transaction insert cardinality");});
 await measure("spark.autocommit-full",100,async()=>{await db.run("DELETE FROM writes");for(let i=0;i<100;i++)await db.run("INSERT INTO writes(id,value) VALUES(?,?)",[i,body]);});
 await measure("raw.async-point-read",POINTS,async()=>{let sum=0;for(let i=0;i<POINTS;i++)sum+=rowArray(await asyncExecute(pointSQL,[i]))[0].id;assert(sum===POINTS*(POINTS-1)/2,"raw async checksum");});
 await measure("raw.async-fanout",POINTS,async()=>{const results=await Promise.all(Array.from({length:POINTS},(_,i)=>asyncExecute(pointSQL,[i])));assert(results.reduce((sum,r)=>sum+rowArray(r)[0].id,0)===POINTS*(POINTS-1)/2,"raw fanout checksum");});
 await measure("raw.sync-point-read",POINTS,()=>{let sum=0;for(let i=0;i<POINTS;i++)sum+=rowArray(syncExecute(pointSQL,[i]))[0].id;assert(sum===POINTS*(POINTS-1)/2,"raw sync checksum");});
 const statement=__provider==="op"?native.prepareStatement(pointSQL):native.prepare(pointSQL);
 await measure("raw.prepared-sync-point",POINTS,()=>{let sum=0;for(let i=0;i<POINTS;i++){if(__provider==="op")statement.bindSync([i]);sum+=rowArray(__provider==="op"?statement.executeSync():statement.execute([i]))[0].id;}assert(sum===POINTS*(POINTS-1)/2,"prepared checksum");});
 await measure("raw.prepared-async-point",POINTS,async()=>{let sum=0;for(let i=0;i<POINTS;i++){if(__provider==="op")await statement.bind([i]);sum+=rowArray(__provider==="op"?await statement.execute():await statement.executeAsync([i]))[0].id;}assert(sum===POINTS*(POINTS-1)/2,"prepared async checksum");});
 await measure("raw.prepared-async-sync-bind",POINTS,async()=>{let sum=0;for(let i=0;i<POINTS;i++){if(__provider==="op")statement.bindSync([i]);sum+=rowArray(__provider==="op"?await statement.execute():await statement.executeAsync([i]))[0].id;}assert(sum===POINTS*(POINTS-1)/2,"prepared async with sync bind checksum");});
 if(__provider!=="op")statement.finalize();
 const inserts=batchCommands(Array.from({length:10000},(_,id)=>["INSERT INTO writes(id,value) VALUES(?,?)",[id,body]]));
 await measure("raw.batch-insert",10000,async()=>{await db.run("DELETE FROM writes");await batch(inserts);assert((await db.getFirst("SELECT count(*) AS n FROM writes"))?.n===10000,"batch cardinality");});
 // Timer lateness captures JS-side result materialization, not UI frame rates.
 let timerTrial=-1;
 await measure("spark.bulk-wide-js-pause",COUNT,async()=>{let running=true,last=__now(),maxDelay=0;const tick=()=>{const now=__now();maxDelay=Math.max(maxDelay,now-last-1);last=now;if(running)setTimeout(tick,1);};setTimeout(tick,1);const rows=await db.getAll("SELECT * FROM items ORDER BY id");assert(rows.length===COUNT,"pause cardinality");await new Promise(resolve=>setTimeout(resolve,1));running=false;if(timerTrial>=0)samples.push({name:"spark.bulk-wide-timer-delay",units:COUNT,trial:timerTrial,ms:Math.max(0,maxDelay)});timerTrial++;});
 await db.close();
 let closed=false;try{await db.getFirst("SELECT 1");}catch(error){closed=(error as any).code==="E_CLOSED";}assert(closed,"closed handle");
 const reopened=open({name:"benchmark.sqlite",readOnly:true});const persisted=__provider==="op"?await reopened.execute("SELECT count(*) AS n FROM items"):await reopened.executeAsync("SELECT count(*) AS n FROM items");assert(rowArray(persisted)[0].n===COUNT,"reopen persistence");reopened.close();
 __print(JSON.stringify({provider:__provider,samples,correctness:"passed",completed:true}));
 globalThis.__benchmarkFailed=false;globalThis.__benchmarkDone=true;
}
