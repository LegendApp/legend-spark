import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createMenu, type Menu, type MenuOptions, type MenuAction } from "./api";
export interface UseMenuOptions extends MenuOptions { onError?: (error: unknown) => void; onCleanupError?: (error: unknown, menu: Menu) => void }
export type MenuState = { status: "loading" } | { status: "ready"; menu: Menu } | { status: "error"; error: unknown };
interface Lifetime { menu?: Menu; items: MenuOptions["items"]; disposed: boolean; completion: Promise<void> }
const lifetimes = new Map<string, Lifetime>();
/** Callback changes do not recreate native menus. Structural updates use the same handle. */
export function useMenu(options: UseMenuOptions): MenuState {
  const [state, setState] = useState<MenuState>({ status: "loading" });
  const callbacks = useRef(options);
  useLayoutEffect(() => { callbacks.current = options; });
  const current = useRef<Lifetime | undefined>(undefined);
  useEffect(() => {
    const previous = lifetimes.get(options.id);
    let end!: () => void;
    const ended = new Promise<void>(resolve => { end = resolve; });
    const owner: Lifetime = { items: options.items, disposed: false, completion: Promise.resolve() };
    current.current = owner; setState({ status: "loading" });
    const report = (error: unknown) => { if (!owner.disposed) setState({ status: "error", error }); if (callbacks.current.onError) callbacks.current.onError(error); else console.error("Menu lifecycle failed", error); };
    owner.completion = Promise.resolve().then(async () => {
      // A remount may start while the previous mount is still allocating/disposing.
      if (previous?.disposed) await previous.completion;
      if (owner.disposed) return;
      const initial = owner.items;
      const menu = await createMenu({ id: options.id, items: initial, onAction: (event: MenuAction) => { if (!owner.disposed) callbacks.current.onAction?.(event); } });
      owner.menu = menu;
      try {
        if (!owner.disposed && owner.items !== initial) await menu.update({ items: owner.items });
        if (!owner.disposed) setState({ status: "ready", menu });
        await ended;
      } finally {
        try { await menu.remove(); }
        catch (error) { if (callbacks.current.onCleanupError) callbacks.current.onCleanupError(error, menu); else report(error); }
      }
    }).catch(report).finally(() => { if (lifetimes.get(options.id) === owner) lifetimes.delete(options.id); });
    if (!previous || previous.disposed) lifetimes.set(options.id, owner);
    return () => { owner.disposed = true; end(); };
  }, [options.id]);
  useEffect(() => {
    const owner = current.current;
    if (!owner || owner.disposed || owner.items === options.items) return;
    owner.items = options.items;
    if (owner.menu) void owner.menu.update({ items: options.items }).then(() => { if (!owner.disposed) setState({ status: "ready", menu: owner.menu! }); }).catch(error => {
      if (!owner.disposed) setState({ status: "error", error });
      if (callbacks.current.onError) callbacks.current.onError(error); else console.error("Menu update failed", error);
    });
  }, [options.id, options.items]);
  return state;
}
