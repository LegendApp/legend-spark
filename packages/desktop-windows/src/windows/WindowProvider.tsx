import type { ComponentType, ReactNode } from "react";
import { createContext, useContext } from "react";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { windowId } from "../validation";
const WindowContext = createContext<string | null>(null);
export function useWindowId(): string {
  const id = useContext(WindowContext);
  if (id === null) throw new SparkError("E_UNAVAILABLE", "useWindowId requires a WindowProvider for this React root");
  return id;
}
export interface WindowProviderProps { children: ReactNode; id: string }
export function WindowProvider({ children, id }: WindowProviderProps) {
  windowId(id); return <WindowContext.Provider value={id}>{children}</WindowContext.Provider>;
}
export function withWindowProvider<P extends object>(Component: ComponentType<P>, id: string): ComponentType<P> {
  windowId(id);
  const Wrapped = (props: P) => <WindowProvider id={id}><Component {...props} /></WindowProvider>;
  Wrapped.displayName = `Window(${id})`;
  return Wrapped;
}
