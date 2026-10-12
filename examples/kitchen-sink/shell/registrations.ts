import { useEffect, type DependencyList } from "react";

type Registration = { remove(): unknown };
export type Hold = (registration: Registration | Promise<Registration>) => void;

/** Holds sync or pending registrations. Any that resolve after remove() are removed on arrival. */
export function holdRegistrations(setup: (hold: Hold) => void, onError: (error: unknown) => void): { remove(): void } {
  let removed = false;
  const held: Registration[] = [];
  const release = (registration: Registration) => { Promise.resolve().then(() => registration.remove()).catch(onError); };
  try {
    setup(pending => { Promise.resolve(pending).then(registration => { if (removed) release(registration); else held.push(registration); }, onError); });
  } catch (error) { onError(error); }
  return { remove() { removed = true; held.splice(0).forEach(release); } };
}

/** Owns a screen's registrations; `setup` runs again when `deps` change. */
export function useRegistrations(setup: (hold: Hold) => void, onError: (error: unknown) => void, deps: DependencyList) {
  useEffect(() => holdRegistrations(setup, onError).remove, deps);
}
