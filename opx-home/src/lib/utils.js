import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn helper. Joins class names and lets later ones win.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
