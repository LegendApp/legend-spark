import { type ClassValue as ClsxClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names with `clsx`, then merges conflicting Tailwind classes with `tailwind-merge` so later ones win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A value `cn` accepts: a class name string, a number or bigint, an array of values, or an object whose truthy keys are included. Falsy values are skipped. */
export type ClassValue = ClsxClassValue;
