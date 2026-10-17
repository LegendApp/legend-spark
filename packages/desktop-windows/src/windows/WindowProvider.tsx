import type { ComponentType, ReactNode } from "react";
import { createContext, useContext } from "react";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { windowId } from "../validation";
const WindowContext = createContext<string | null>(null);
/** The ID of the window this React root renders in. Throws `E_UNAVAILABLE` outside a `WindowProvider`. */
export function useWindowId(): string {
  const id = useContext(WindowContext);
  if (id === null) throw new SparkError("E_UNAVAILABLE", "useWindowId requires a WindowProvider for this React root");
  return id;
}
/** Props of `WindowProvider`: the window ID its children render in. */
export interface WindowProviderProps { children: ReactNode; id: string }
/** Provides the window ID to `useWindowId` and the window hooks below it. Throws `E_INVALID_ARGUMENT` for a malformed ID. */
export function WindowProvider({ children, id }: WindowProviderProps) {
  windowId(id); return <WindowContext.Provider value={id}>{children}</WindowContext.Provider>;
}
/** Wraps a root component in a `WindowProvider` for the window `id`. Throws `E_INVALID_ARGUMENT` for a malformed ID. */
export function withWindowProvider<P extends object>(Component: ComponentType<P>, id: string): ComponentType<P> {
  windowId(id);
  const Wrapped = (props: P) => <WindowProvider id={id}><Component {...props} /></WindowProvider>;
  Wrapped.displayName = `Window(${id})`;
  return Wrapped;
}
