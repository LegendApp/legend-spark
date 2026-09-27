import * as files from "@legendapp/spark/files";
import * as windows from "@legendapp/spark/windows";
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Expected native event was not delivered"); await delay(25); }
}
export async function runFoundationChecks(check: (name: string, action: () => Promise<void>) => Promise<void>) {
  await check("files.recursive-watch", async () => {
    const root = `${await files.getDirectory("temp")}/recursive-${Date.now()}`;
    await files.mkdir(`${root}/nested`);
    let count = 0;
    const watch = await files.watch(root, () => count++, { recursive: true });
    let step = 0;
    async function change(action: () => Promise<unknown>) {
      await delay(150); const before = count; await action(); try { await until(() => count > before); } catch (error) { throw new Error(`Recursive watch step ${step}: ${error}`); } step++;
    }
    try {
      await change(() => files.writeText(`${root}/nested/item.txt`, "one"));
      await change(() => files.writeText(`${root}/nested/item.txt`, "two"));
      await change(() => files.mkdir(`${root}/new/deep`));
      await change(() => files.writeText(`${root}/new/deep/item.txt`, "three"));
      await change(() => files.move(`${root}/nested/item.txt`, `${root}/nested/renamed.txt`));
      await change(() => files.remove(root, { recursive: true }));
      await change(() => files.mkdir(`${root}/reborn`));
      await change(() => files.writeText(`${root}/reborn/item.txt`, "four"));
      await watch.remove(); await watch.remove(); await delay(150); const stopped = count;
      await files.writeText(`${root}/reborn/item.txt`, "after removal"); await delay(250);
      assert(count === stopped, "Removed watch still delivered events");
      let rejected = false; try { await files.watch(`${root}/reborn/item.txt`, () => {}, { recursive: true }); } catch { rejected = true; }
      assert(rejected, "Recursive watch accepted a file");
    } finally { await watch.remove(); await files.remove(root, { recursive: true }); }
  });
  await check("windows.overlay", async () => {
    const before = (await windows.listWindows()).find(window => window.focused)?.id;
    const id = "foundation-overlay";
    try {
      const overlay = await windows.openWindow({ id, kind: "overlay", component: "main", size: { width: 340, height: 140 }, props: { windowId: id, windowProps: {} } });
      assert(overlay.kind === "overlay" && !overlay.focused, JSON.stringify(overlay));
      await windows.hideWindow(id); await windows.showWindow(id);
      const all = await windows.listWindows();
      assert(all.find(window => window.focused)?.id === before, "Overlay stole keyboard focus");
      await windows.setWindowBounds(id, { ...(await windows.getWindow(id)).bounds, x: 100, y: 100, width: 350, height: 150 });
      assert(!(await windows.getWindow(id)).focused, "Moving overlay took focus");
    } finally { await windows.closeWindow(id); }
  });
}
