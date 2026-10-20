import { useSyncExternalStore } from "react";

const query = "(max-width: 760px)";
function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function snapshot() {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}
/** Changes only the placement of the shared order details; data and actions stay identical. */
export function useCompactLayout() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
