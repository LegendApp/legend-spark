import { openFileDialog } from "@legendapp/spark-file-dialog";
import { watch } from "@legendapp/spark-file-system";
import type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { useMenu, type MenuAction, type MenuItem } from "@legendapp/spark-native-menu";
import { subscribeToOpenRequests } from "./requests";
export * from "./requests";
import { usePrimaryWindowLifecycle } from "@legendapp/spark-desktop-windows/src/windows/usePrimaryWindowLifecycle";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
export { createDocumentTransitionGuard } from "./documentTransition";

export type DocumentAppController = {
  isDocumentWindowOpen: () => boolean;
  reportError: (error: unknown) => void;
  setDocumentWindowOpen: (isOpen: boolean) => void;
};

export type UseDocumentAppControllerOptions = {
  createMenuHandlers: (controller: DocumentAppController) => Record<string, (action: MenuAction) => void>;
  launchArguments?: string[];
  menus: readonly MenuItem[];
  onInitialOpen: (launchArguments: string[] | undefined, controller: DocumentAppController) => Promise<void> | void;
  onOpenDocument?: (path: string, controller: DocumentAppController) => Promise<void> | void;
  onReopenRequested?: (controller: DocumentAppController) => Promise<void> | void;
  ownerId: string;
  reportError: (error: unknown) => void;
  windowId: string;
};

export type OpenSelectedDocumentPathOptions = {
  allowedFileTypes: readonly string[];
  invalidSelectionMessage?: string;
  isDocumentPath: (path: string) => boolean;
};

export type GetLaunchDocumentPathOptions = {
  isDocumentPath: (path: string) => boolean;
  launchArguments?: string[];
};

export type UseWatchedDocumentReloadOptions = {
  delayMs?: number;
  enabled?: boolean;
  onReload: () => void | Promise<void>;
  onError: (error: unknown) => void;
  path: string | null | undefined;
  shouldReload?: () => boolean;
};

export function getPathExtension(path: string) {
  return path.split(".").pop()?.toLowerCase();
}

export function pathMatchesExtensions(path: string, extensions: readonly string[]) {
  const extension = getPathExtension(path);
  return extension !== undefined && extensions.includes(extension);
}

export function getLaunchDocumentPath({
  isDocumentPath,
  launchArguments,
}: GetLaunchDocumentPathOptions) {
  const argv = typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
  return launchArguments?.find(isDocumentPath) ?? argv.find(isDocumentPath) ?? null;
}

export function getDirectory(path: string) {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : undefined;
}

export function getFilename(path: string) {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

export async function openSelectedDocumentPath({
  allowedFileTypes,
  invalidSelectionMessage,
  isDocumentPath,
}: OpenSelectedDocumentPathOptions) {
  const result = await openFileDialog({
    filters: [{ extensions: allowedFileTypes }],
    selection: "files",
  });
  const paths = result.canceled ? [] : result.paths;
  const path = paths.find(isDocumentPath) ?? null;

  if (path) {
    return path;
  }

  if (paths && paths.length > 0) {
    throw new Error(
      invalidSelectionMessage ?? `Choose a supported file (${allowedFileTypes.map((type) => `.${type}`).join(", ")}).`,
    );
  }

  return null;
}

export function useWatchedDocumentReload({
  delayMs = 100,
  enabled = true,
  onReload,
  onError,
  path,
  shouldReload,
}: UseWatchedDocumentReloadOptions) {
  const handlers = useRef({ onReload, onError, shouldReload });
  useLayoutEffect(() => { handlers.current = { onReload, onError, shouldReload }; });
  useEffect(() => {
    if (!enabled || !path) return;
    let reloadTimeout: ReturnType<typeof setTimeout> | undefined;
    let subscription: AsyncRegistration | undefined;
    let disposed = false;
    const reportError = (error: unknown) => handlers.current.onError(error);
    void watch(path, () => {
      if (disposed) return;
      if (reloadTimeout) clearTimeout(reloadTimeout);
      reloadTimeout = setTimeout(() => {
        void Promise.resolve().then(() => {
          if (!disposed && (!handlers.current.shouldReload || handlers.current.shouldReload())) return handlers.current.onReload();
        }).catch(reportError);
      }, delayMs);
    }).then(value => {
      if (disposed) void value.remove().catch(reportError);
      else subscription = value;
    }).catch(reportError);
    return () => {
      disposed = true;
      if (reloadTimeout) clearTimeout(reloadTimeout);
      void subscription?.remove().catch(reportError);
    };
  }, [delayMs, enabled, path]);
}

export function useDocumentAppController({
  createMenuHandlers,
  launchArguments,
  menus,
  onInitialOpen,
  onOpenDocument,
  onReopenRequested,
  ownerId,
  reportError,
  windowId,
}: UseDocumentAppControllerOptions) {
  const [isDocumentWindowOpen, setDocumentWindowOpen] = useState(false);
  const controller = useMemo<DocumentAppController>(() => ({
    isDocumentWindowOpen: () => isDocumentWindowOpen,
    reportError,
    setDocumentWindowOpen,
  }), [isDocumentWindowOpen, reportError]);
  const menuHandlers = useMemo(() => createMenuHandlers(controller), [controller, createMenuHandlers]);

  useMenu({ id: ownerId, items: menus, onAction: action => menuHandlers[action.itemId]?.(action), onError: reportError });

  const documentCallbacks = useRef({ onOpenDocument, controller, reportError });
  useLayoutEffect(() => { documentCallbacks.current = { onOpenDocument, controller, reportError }; });
  const handledRequests = useRef(new Set<string>());
  const handlesDocuments = !!onOpenDocument;
  useEffect(() => {
    if (!handlesDocuments) return;
    let disposed = false;
    let subscription: { remove(): void } | undefined;
    void subscribeToOpenRequests(event => {
      if (disposed || event.type !== "file" || handledRequests.current.has(event.id)) return;
      handledRequests.current.add(event.id);
      if (handledRequests.current.size > 200) handledRequests.current.delete(handledRequests.current.values().next().value!);
      Promise.resolve().then(() => {
        if (!disposed) { const { onOpenDocument, controller } = documentCallbacks.current; return onOpenDocument?.(event.path, controller); }
      }).catch(error => documentCallbacks.current.reportError(error));
    }).then(value => { if (disposed) value.remove(); else subscription = value; }).catch(error => { if (!disposed) documentCallbacks.current.reportError(error); });
    return () => { disposed = true; subscription?.remove(); };
  }, [handlesDocuments]);

  usePrimaryWindowLifecycle({
    onInitialOpen: () => onInitialOpen(launchArguments, controller),
    onReopenRequested: () => onReopenRequested ? onReopenRequested(controller) : onInitialOpen(undefined, controller),
    onWindowClosed: windowId ? () => controller.setDocumentWindowOpen(false) : undefined,
    onError: reportError,
    windowId,
  });

  return controller;
}
