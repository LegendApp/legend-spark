import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createMenu, type Menu, type MenuOptions, type MenuAction } from "./api";
export interface UseMenuOptions extends MenuOptions { onError?: (error: unknown) => void; onCleanupError?: (error: unknown, menu: Menu) => void }
export type MenuState = { status: "loading" } | { status: "ready"; menu: Menu } | { status: "error"; error: unknown };
interface Lifetime { menu?: Menu; removing?: Promise<void>; blocker?: Lifetime; items: MenuOptions["items"]; disposed: boolean; completion: Promise<void> }
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
    const owner: Lifetime = { items: options.items, disposed: false, completion: Promise.resolve(), blocker: previous?.disposed ? previous.blocker ?? previous : undefined };
    current.current = owner; setState({ status: "loading" });
    const report = (error: unknown) => {
      if (!owner.disposed) setState({ status: "error", error });
      try {
        if (callbacks.current.onError) callbacks.current.onError(error);
        else console.error("Menu lifecycle failed", error);
      } catch (callbackError) { console.error(callbackError); }
    };
    const remove = (target: Lifetime) => {
      const menu = target.menu;
      if (!menu) return Promise.resolve();
      if (!target.removing) target.removing = menu.remove().then(() => {
        if (target.menu === menu) target.menu = undefined;
        if (lifetimes.get(options.id) === target) lifetimes.delete(options.id);
      }).catch(error => {
        if (!owner.disposed) setState({ status: "error", error });
        try {
          if (callbacks.current.onCleanupError) callbacks.current.onCleanupError(error, menu);
          else {
            console.error("Menu cleanup failed; menu handle remains retryable", error, menu);
            report(error);
          }
        } catch (callbackError) { console.error(callbackError); }
        throw error;
      }).finally(() => { target.removing = undefined; });
      return target.removing;
    };
    if (!previous || previous.disposed) lifetimes.set(options.id, owner);
    owner.completion = Promise.resolve().then(async () => {
      // A remount waits for allocation/disposal, then retries a retained failed removal.
      if (previous?.disposed) {
        await previous.completion.catch(() => {});
        const blocked = owner.blocker;
        if (blocked) {
          await blocked.completion.catch(() => {});
          try { if (blocked.menu) await remove(blocked); }
          catch { return; }
          owner.blocker = undefined;
        }
      }
      if (owner.disposed) {
        if (lifetimes.get(options.id) === owner) lifetimes.delete(options.id);
        return;
      }
      const initial = owner.items;
      let menu: Menu;
      try {
        menu = await createMenu({ id: options.id, items: initial, onAction: (event: MenuAction) => { if (!owner.disposed) callbacks.current.onAction?.(event); } });
        owner.menu = menu;
      } catch (error) {
        report(error);
        if (lifetimes.get(options.id) === owner) lifetimes.delete(options.id);
        return;
      }
      try {
        if (!owner.disposed && owner.items !== initial) await menu.update({ items: owner.items });
        if (!owner.disposed) setState({ status: "ready", menu });
      } catch (error) { report(error); }
      await ended;
      if (owner.disposed) await remove(owner).catch(() => {});
    }).catch(report);
    return () => { owner.disposed = true; end(); };
  }, [options.id]);
  useEffect(() => {
    const owner = current.current;
    if (!owner || owner.disposed || owner.items === options.items) return;
    owner.items = options.items;
    if (owner.menu) void owner.menu.update({ items: options.items }).then(() => {
      // Reusing the previous state keeps an identical-content update from cascading renders.
      if (!owner.disposed) setState(state => state.status === "ready" && state.menu === owner.menu ? state : { status: "ready", menu: owner.menu! });
    }).catch(error => {
      if (!owner.disposed) setState({ status: "error", error });
      try {
        if (callbacks.current.onError) callbacks.current.onError(error);
        else console.error("Menu update failed", error);
      } catch (callbackError) { console.error(callbackError); }
    });
  }, [options.id, options.items]);
  return state;
}
