import { createMenu, type Menu, type MenuAction, type MenuRootItem } from "@legendapp/spark-native-menu";
import { createPrimaryWindowLifecycle } from "@legendapp/spark-desktop-windows/src/windows/primaryWindowLifecycle";
import { SparkError, asyncRegistration, type AsyncRegistration, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { subscribeToOpenRequests } from "./requests";

export interface DocumentAppController extends AsyncRegistration {
  /** Resolves after document listeners and the menu are installed. Initial-open work reports through reportError. */
  readonly ready: Promise<void>;
  isDocumentWindowOpen(): boolean;
  setDocumentWindowOpen(isOpen: boolean): void;
  reportError(error: unknown): void;
  subscribe(listener: () => void): Subscription;
  updateMenus(menus: readonly MenuRootItem[]): Promise<void>;
}
export interface DocumentAppControllerOptions {
  onMenuAction?: (action: MenuAction, controller: DocumentAppController) => void | Promise<void>;
  launchArguments?: string[];
  menus: readonly MenuRootItem[];
  onInitialOpen: (launchArguments: string[] | undefined, controller: DocumentAppController) => Promise<void> | void;
  onOpenDocument?: (path: string, controller: DocumentAppController) => Promise<void> | void;
  onReopenRequested?: (controller: DocumentAppController) => Promise<void> | void;
  ownerId: string;
  reportError: (error: unknown) => void;
  windowId: string;
}

/** An application-owned controller. Await ready; remove also works during setup or after setup fails. */
export function createDocumentAppController(options: DocumentAppControllerOptions): DocumentAppController {
  const { ownerId, windowId, menus, onMenuAction, onInitialOpen, onOpenDocument, onReopenRequested, reportError } = options;
  if (![ownerId, windowId].every(id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id))) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected document owner and window IDs");
  }
  const launchArguments = options.launchArguments?.slice();
  let active = true, windowOpen = false, menu: Menu | undefined;
  let requests: Subscription | undefined, lifecycle: Subscription | undefined;
  const listeners = new Set<() => void>(), handled = new Set<string>();
  const stop = () => { active = false; listeners.clear(); requests?.remove(); lifecycle?.remove(); };
  const registration = asyncRegistration(stop, async () => {
    await controller.ready.catch(() => {});
    requests?.remove(); lifecycle?.remove();
    await menu?.remove();
  });
  const controller: DocumentAppController = {
    ready: Promise.resolve().then(async () => {
      if (!active) return;
      try {
        if (onOpenDocument) requests = await subscribeToOpenRequests(event => {
          if (!active || event.type !== "file" || handled.has(event.id)) return;
          handled.add(event.id);
          if (handled.size > 200) handled.delete(handled.values().next().value!);
          void Promise.resolve().then(() => { if (active) return onOpenDocument(event.path, controller); }).catch(reportError);
        });
        if (!active) { requests?.remove(); return; }
        menu = await createMenu({ id: ownerId, items: menus, onAction: action => {
          if (active) {
            try { void Promise.resolve(onMenuAction?.(action, controller)).catch(reportError); }
            catch (error) { reportError(error); }
          }
        } });
        if (!active) return;
        lifecycle = createPrimaryWindowLifecycle({
          windowId,
          onInitialOpen: () => onInitialOpen(launchArguments, controller),
          onReopenRequested: () => onReopenRequested ? onReopenRequested(controller) : onInitialOpen(undefined, controller),
          onWindowClosed: () => controller.setDocumentWindowOpen(false),
          onError: reportError,
        });
      } catch (error) {
        stop();
        try { await menu?.remove(); }
        catch (cleanup) { throw new SparkError("E_NATIVE", "Document setup and cleanup failed; retry controller.remove()", { cause: new AggregateError([error, cleanup]) }); }
        throw error;
      }
    }),
    isDocumentWindowOpen: () => windowOpen,
    setDocumentWindowOpen(isOpen) {
      if (!active) throw new SparkError("E_CLOSED", "Document controller was removed");
      if (typeof isOpen !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected a boolean window state");
      if (windowOpen !== isOpen) { windowOpen = isOpen; for (const listener of listeners) listener(); }
    },
    reportError,
    subscribe(listener) {
      if (!active) throw new SparkError("E_CLOSED", "Document controller was removed");
      listeners.add(listener); return { remove() { listeners.delete(listener); } };
    },
    async updateMenus(items) {
      if (!active) throw new SparkError("E_CLOSED", "Document controller was removed");
      await controller.ready;
      if (!active) throw new SparkError("E_CLOSED", "Document controller was removed");
      await menu!.update({ items });
    },
    remove: registration.remove,
  };
  // Removal need not await readiness first; the original promise still rejects to awaiters.
  void controller.ready.catch(() => {});
  return controller;
}
