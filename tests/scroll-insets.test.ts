import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, linkSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

const require = createRequire(import.meta.url);
const { replacements, insetEnum, insetMethods, patchScrollInsetSources, installScrollInsetsPatch } = require("../packages/config-plugin/scroll-insets.cjs");
const rn = path.dirname(require.resolve("react-native-macos/package.json"));
const pristine: Record<string, string> = Object.fromEntries(Object.entries(replacements as Record<string, [string,string][]>).map(([file,pairs]) => [file,
  pairs.reduce((text,[before,after]) => text.replace(after,before),readFileSync(path.join(rn,file),"utf8"))]));

test("scroll insets patch actual pinned source, preserve iOS and reset recycled macOS views", () => {
  const patched = patchScrollInsetSources(pristine);
  expect(patchScrollInsetSources(patched)).toEqual(patched);
  const component = patched[Object.keys(patched).find(file=>file.endsWith("RCTScrollViewComponentView.mm"))!];
  expect(component).toContain("scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentScrollableAxes");
  expect(component).toContain("scrollView.insetAdjustmentBehavior = RCTScrollViewInsetAdjustmentScrollableAxes");
  expect(component).toContain("((RCTEnhancedScrollView *)_scrollView).insetAdjustmentBehavior = RCTScrollViewInsetAdjustmentNever;");
  const header = Object.keys(pristine).find(file=>file.endsWith(".h"))!;
  expect(() => patchScrollInsetSources({...pristine,[header]:pristine[header].replace("@interface RCTEnhancedScrollView :", "@interface ChangedView :")})).toThrow("source changed");
});

test("scroll inset installation is atomic on drift and preserves cache hardlinks", () => {
  const root=mkdtempSync(path.join(os.tmpdir(),"spark-scroll-insets-"));
  try {
    const dependency=path.join(root,"node_modules/react-native-macos");mkdirSync(dependency,{recursive:true});
    writeFileSync(path.join(dependency,"package.json"),JSON.stringify({name:"react-native-macos",version:"0.83.0"}));
    const caches=new Map<string,string>();
    for(const [file,text] of Object.entries(pristine)){
      const target=path.join(dependency,file),cache=path.join(root,`cache-${caches.size}`);
      mkdirSync(path.dirname(target),{recursive:true});writeFileSync(cache,text);linkSync(cache,target);caches.set(file,cache);
    }
    const last=Object.keys(pristine).at(-1)!;
    writeFileSync(path.join(dependency,last),"changed upstream source");
    expect(()=>installScrollInsetsPatch(root)).toThrow("source changed");
    const first=Object.keys(pristine)[0];expect(readFileSync(path.join(dependency,first),"utf8")).toBe(pristine[first]);
    // Recreate the last hardlink after the deliberate drift mutation.
    writeFileSync(path.join(dependency,last),pristine[last]);
    installScrollInsetsPatch(root);
    for(const [file,cache] of caches){
      expect(readFileSync(cache,"utf8")).toBe(pristine[file]);
      expect(readFileSync(path.join(dependency,file),"utf8")).not.toBe(pristine[file]);
    }
    const inode=statSync(path.join(dependency,first)).ino;installScrollInsetsPatch(root);expect(statSync(path.join(dependency,first)).ino).toBe(inode);
    writeFileSync(path.join(dependency,"package.json"),JSON.stringify({version:"0.82.0"}));
    expect(()=>installScrollInsetsPatch(root)).toThrow("requires react-native-macos@0.83.0");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test.skipIf(process.platform!=="darwin")("native inset policy applies only scrolling axes and preserves explicit never/always", async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),"spark-scroll-insets-native-"));
  try {
    const input=path.join(directory,"probe.mm"),output=path.join(directory,"probe");
    const fixture=readFileSync(path.join(import.meta.dirname,"scroll-insets.native.mm"),"utf8");
    const componentFile=Object.keys(replacements).find(file=>file.endsWith("RCTScrollViewComponentView.mm"))!;
    const recycleSource=replacements[componentFile][1][1];
    writeFileSync(input,fixture.replace("// ACTUAL_ENUM",insetEnum).replace("// ACTUAL_METHODS",insetMethods).replace("// ACTUAL_RECYCLE",recycleSource));
    await runOk("clang++",["-fobjc-arc","-fblocks","-std=c++20","-framework","AppKit",input,"-o",output]);
    expect(await runOk(output,[],{timeout:15000})).toContain("Native scroll-inset policy passed");
  } finally {rmSync(directory,{recursive:true,force:true});}
},30000);
