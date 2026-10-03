import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AsyncRegistration, Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { createDocumentAppController, type DocumentAppController, type DocumentAppControllerOptions } from "./controller";
import { watchDocumentReload, type DocumentReloadOptions } from "./reload";

export interface UseWatchedDocumentReloadOptions extends Omit<DocumentReloadOptions, "path"> {
  path: string | null | undefined;
  enabled?: boolean;
  onCleanupError?: (error: unknown, registration: AsyncRegistration) => void;
}
type ReloadOwner = { registration: AsyncRegistration; removing?: Promise<void> };
type ReloadLifecycle = { tail: Promise<void>; owner?: ReloadOwner };
export function useWatchedDocumentReload(options: UseWatchedDocumentReloadOptions): void {
  const latest = useRef(options);
  const lifecycleRef = useRef<ReloadLifecycle | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = { tail: Promise.resolve() };
  const lifecycle = lifecycleRef.current;
  useLayoutEffect(() => { latest.current = options; });
  const { path, enabled = true, delayMs } = options;
  useEffect(() => {
    if (!enabled || !path) return;
    let active = true, owned: ReloadOwner | undefined;
    const report = (error: unknown) => {
      try { latest.current.onError(error); }
      catch (callbackError) { console.error(callbackError); }
    };
    const remove = (owner: ReloadOwner) => {
      if (!owner.removing) owner.removing = owner.registration.remove().then(() => {
        if (lifecycle.owner === owner) lifecycle.owner = undefined;
      }).catch(error => {
        try {
          if (latest.current.onCleanupError) latest.current.onCleanupError(error, owner.registration);
          else {
            console.error("Document reload watch cleanup failed; registration remains retryable", error, owner.registration);
            report(error);
          }
        } catch (callbackError) { console.error(callbackError); }
        throw error;
      }).finally(() => { owner.removing = undefined; });
      return owner.removing;
    };
    const creation = lifecycle.tail.then(async () => {
      if (!active) return;
      try {
        if (lifecycle.owner) await remove(lifecycle.owner);
      } catch { return; }
      if (!active) return;
      try {
        const registration = await watchDocumentReload({
          path, delayMs,
          onReload: () => { if (active) return latest.current.onReload(); },
          shouldReload: () => active && (latest.current.shouldReload?.() ?? true),
          onError: error => { if (active) report(error); },
        });
        owned = { registration };
        lifecycle.owner = owned;
      } catch (error) { if (active) report(error); }
    });
    lifecycle.tail = creation;
    return () => {
      active = false;
      const cleanup = creation.then(async () => { if (owned) await remove(owned).catch(() => {}); });
      lifecycle.tail = cleanup;
    };
  }, [path, enabled, delayMs]);
}

export interface UseDocumentAppControllerOptions extends DocumentAppControllerOptions {
  onCleanupError?: (error: unknown, controller: DocumentAppController) => void;
}
export type DocumentAppControllerState =
  | { status: "loading" }
  | { status: "ready"; controller: DocumentAppController }
  | { status: "error"; error: unknown };

/** Component-owned convenience. Use the factory for an application-owned lifetime. */
export function useDocumentAppController(options: UseDocumentAppControllerOptions): DocumentAppControllerState {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const [state, setState] = useState<DocumentAppControllerState>({ status: "loading" });
  const current = useRef<{ controller?: DocumentAppController; items: DocumentAppControllerOptions["menus"]; active: boolean; ready: boolean } | undefined>(undefined);
  const cleanup = useRef<{ promise: Promise<void>; controller?: DocumentAppController }>({ promise: Promise.resolve() });
  const handlesDocuments = !!options.onOpenDocument;
  useEffect(() => {
    const owner: NonNullable<typeof current.current> = { items: options.menus, active: true, ready: false };
    current.current = owner;
    let subscription: Subscription | undefined;
    setState({ status: "loading" });
    const report = (error: unknown) => { if (owner.active) setState({ status: "error", error }); latest.current.reportError(error); };
    const previous = cleanup.current;
    const setup = previous.promise.catch(() => previous.controller?.remove()).then(async () => {
      if (!owner.active) return;
      const initialItems = owner.items;
      const controller = createDocumentAppController({
        ownerId: options.ownerId, windowId: options.windowId, menus: initialItems,
        launchArguments: options.launchArguments,
        onMenuAction: (action, value) => { if (owner.active) return latest.current.onMenuAction?.(action, value); },
        onInitialOpen: (args, value) => { if (owner.active) return latest.current.onInitialOpen(args, value); },
        onOpenDocument: handlesDocuments ? (path, value) => { if (owner.active) return latest.current.onOpenDocument?.(path, value); } : undefined,
        onReopenRequested: value => {
          if (owner.active) return latest.current.onReopenRequested ? latest.current.onReopenRequested(value) : latest.current.onInitialOpen(undefined, value);
        },
        reportError: error => latest.current.reportError(error),
      });
      owner.controller = controller;
      await controller.ready;
      if (owner.active) {
        owner.ready = true;
        if (owner.items !== initialItems) await controller.updateMenus(owner.items).catch(error => latest.current.reportError(error));
        if (!owner.active) return;
        subscription = controller.subscribe(() => setState({ status: "ready", controller }));
        setState({ status: "ready", controller });
      }
    });
    void setup.catch(report);
    return () => {
      owner.active = false; subscription?.remove();
      // Stop callbacks immediately, even if setup is waiting on a native registration.
      if (owner.controller) {
        const controller = owner.controller;
        const promise = controller.remove();
        cleanup.current = { promise, controller };
        void promise.catch(error => {
          if (latest.current.onCleanupError) latest.current.onCleanupError(error, controller);
          else latest.current.reportError(error);
        });
      }
    };
  }, [options.ownerId, options.windowId, handlesDocuments]);
  useEffect(() => {
    const owner = current.current;
    if (!owner?.active || owner.items === options.menus) return;
    owner.items = options.menus;
    if (owner.ready && owner.controller) void owner.controller.updateMenus(options.menus).catch(error => {
      if (owner.active) latest.current.reportError(error);
    });
  }, [options.menus]);
  return state;
}
