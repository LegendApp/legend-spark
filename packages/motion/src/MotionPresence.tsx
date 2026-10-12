import type { ReactNode } from "react";
import { motionModule } from "./motion";
import { PresenceContext, usePresence } from "./presence-hooks";

export interface MotionPresenceProps { children?: ReactNode }

/**
 * Keeps a removed child mounted, where it was, while the `exit` animations of the MotionViews in it play, then unmounts
 * it. Children are matched by key. A child added back while it exits stays and plays `enter`. Throws a SparkError where
 * motion is unavailable.
 */
export function MotionPresence({ children }: MotionPresenceProps) {
  motionModule();
  return usePresence(children).map(({ key, element, state }) => <PresenceContext.Provider key={key} value={state}>{element}</PresenceContext.Provider>);
}
