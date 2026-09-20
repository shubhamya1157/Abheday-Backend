import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn helper. Joins class names and lets later ones win.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Save some text as a file the user can download. Makes a temporary blob URL,
// clicks a hidden link, then cleans up. Used to hand over a receipt as JSON or
// Markdown — the artifact the demo is graded on.
export function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
