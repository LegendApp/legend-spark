import path from "node:path";
import { createRequire } from "node:module";
const spark=path.resolve(import.meta.dir,"../..");
const req=createRequire(path.join(spark,"package.json"));
const { transformSync }=req("@babel/core");
const root=process.env.SQLITE_BENCHMARK_WORK ?? path.join(spark,".spark/benchmarks/sqlite");
for(const provider of ["op","nitro"]){
 const entry=path.join(root,`${provider}-entry.ts`);
 const importPath=provider==="op" ? `${spark}/node_modules/@op-engineering/op-sqlite/src/functions.ts` : `${root}/nitro/package/src/operations/session.ts`;
 await Bun.write(entry,`import { open } from ${JSON.stringify(importPath)};\nimport { run } from ${JSON.stringify(path.join(import.meta.dir,"suite.ts"))};\nglobalThis.global=globalThis;globalThis.setImmediate=(callback,...args)=>setTimeout(()=>callback(...args),0);\nrun(open).catch(error=>{__print(JSON.stringify({error:String(error),stack:error.stack}));globalThis.__benchmarkFailed=true;globalThis.__benchmarkDone=true;});`);
 const result=await Bun.build({entrypoints:[entry],outdir:root,naming:`${provider}-suite.js`,target:"browser",format:"iife",plugins:[{name:"native-bootstrapped-host",setup(build){
 build.onResolve({filter:/^react-native$/},()=>({path:"rn",namespace:"shim"}));
 build.onResolve({filter:/^react-native-nitro-modules$/},()=>({path:"nitro",namespace:"shim"}));
 build.onResolve({filter:/^@legendapp\/spark-desktop-app\/src\/contracts$/},()=>({path:`${spark}/packages/desktop-app/src/contracts/index.ts`}));
 build.onLoad({filter:/.*/,namespace:"shim"},args=>({contents:args.path==="rn"?'export const Platform={OS:"macos"}; export const NativeModules={};':'export const NitroModules=globalThis.NitroModulesProxy;',loader:"js"}));
 } }]});
 if(!result.success)throw new Error(result.logs.map(String).join("\n"));
 const built=path.join(root,`${provider}-suite.js`);
 const transformed=transformSync(await Bun.file(built).text(),{filename:built,babelrc:false,configFile:false,presets:[[req.resolve("@react-native/babel-preset"),{disableImportExportTransform:true}]]}).code;
 const temp=path.join(root,`${provider}-transformed.js`);await Bun.write(temp,transformed);
 const rebundle=await Bun.build({entrypoints:[temp],outdir:root,naming:`${provider}-suite.js`,format:"iife",target:"browser",plugins:[{name:"babel-runtime",setup(build){build.onResolve({filter:/^@babel\/runtime\//},args=>({path:req.resolve(args.path)}));}}]});
 if(!rebundle.success)throw new Error(rebundle.logs.map(String).join("\n"));
}
