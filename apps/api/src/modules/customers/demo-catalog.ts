import { randomInt } from "node:crypto";
import catalog from "./demo-catalog.data.json" with { type: "json" };

// Fake Store IDs 9, 2, 3, 4, 10, 11, 12. Image URLs only; photographs are not redistributed.
// Names/descriptions/categories/images match the external catalog. BRL prices are independently defined here.
export const DEMO_CATALOG_VERSION = "support-brl-v3";
export const DEMO_CATALOG = catalog;

export function selectDemoProducts(
  random: () => number = () => randomInt(0, 0x1000000) / 0x1000000,
) {
  const pool = [...DEMO_CATALOG];
  for (let index = pool.length - 1; index > 0; index--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid catalog random source");
    const other = Math.floor(value * (index + 1));
    [pool[index], pool[other]] = [pool[other]!, pool[index]!];
  }
  return pool.slice(0, 6);
}
