import * as notifications from "@legendapp/spark/notifications";
import { createTray } from "@legendapp/spark/tray";
import * as updates from "@legendapp/spark/updates";
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejects(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) { assert((error as { code?: string }).code === code, `Expected ${code}, received ${String(error)}`); return; }
  throw new Error(`Expected ${code} rejection`);
}
async function until(predicate: () => boolean | Promise<boolean>, message: string, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(40); }
  throw new Error(message);
}
export async function runIntegrationChecks(check: (name: string, action: () => Promise<void>) => Promise<void>) {
  const token = `sdk-integrations-${Date.now()}`;
    await check("notifications: read permission and scoped pending/delivered lists without prompting", async () => {
      const permission = await notifications.getNotificationPermission();
      assert(["notDetermined", "denied", "authorized", "provisional", "unknown"].includes(permission), "Invalid permission");
      assert(Array.isArray(await notifications.getPendingNotifications()), "Missing pending list");
      assert(Array.isArray(await notifications.getDeliveredNotifications()), "Missing delivered list");
      const listener = await notifications.onNotificationResponse(() => {}); listener.remove();
      const notification = { id: token, title: "SDK scheduled test", delay: 3600 };
      if (permission === "authorized" || permission === "provisional") {
        try {
          await notifications.showNotification(notification);
          await until(async () => (await notifications.getPendingNotifications()).includes(token), "Notification was not scheduled");
        } finally { await notifications.cancelNotification(token); }
        await until(async () => !(await notifications.getPendingNotifications()).includes(token), "Notification cancellation did not complete");
      } else await rejects(() => notifications.showNotification(notification), "E_NOTIFICATION_PERMISSION");
      await notifications.cancelNotification(token);
    });
    await check("tray: create, duplicate conflict, update, remove and recreate", async () => {
      const tray = await createTray({ id: token, title: "SDK test", menu: [{ id: "checked", title: "Checked", checked: true }, { id: "disabled", title: "Disabled", enabled: false }] });
      try {
        await rejects(() => createTray({ id: token, title: "Duplicate" }), "E_TRAY_EXISTS");
        await tray.update({ title: "Updated", symbol: "star", menu: [] });
      } finally { await tray.remove(); }
      await (await createTray({ id: token, symbol: "star" })).remove();
    });
    await check("updates: Prebuilt/development runtimes refuse self-update without starting Sparkle", async () => {
      const status = await updates.getUpdateStatus();
      assert(!status.available && !status.started, "Development updater was enabled");
      const code = !status.available && status.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_UNAVAILABLE";
      await rejects(updates.checkForUpdates, code);
      await rejects(updates.startUpdates, code);
    });
}
