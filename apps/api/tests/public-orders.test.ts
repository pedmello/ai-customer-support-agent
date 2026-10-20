import { describe, expect, it } from "vitest";
import { resolveOrderReference } from "../src/modules/agent/agent.safety.js";
import {
  DEMO_CATALOG,
  selectDemoProducts,
} from "../src/modules/customers/demo-catalog.js";

describe("public order references", () => {
  it("uses the WD external drive instead of the retired backpack for new orders", () => {
    expect(DEMO_CATALOG.some((item) => item.productId === 1)).toBe(false);
    expect(DEMO_CATALOG.find((item) => item.productId === 9)?.title).toContain(
      "WD 2TB Elements",
    );
  });
  it.each([
    "48213",
    "#48213",
    "pedido 48213",
    "Quero cancelar o pedido #48213",
    "pedido 48213, por favor",
  ])("accepts %s", (text) => {
    expect(resolveOrderReference(text, 48213, null, null)).toEqual({
      kind: "number",
      orderNumber: 48213,
    });
  });
  it.each([
    "R$ 48213,00",
    "USD 48213.00",
    "48213 unidades",
    "quantidade 48213",
    "pedido 48213 e 48214",
    "pedido #48213 e #48214",
  ])("does not authorize ambiguous or non-order numbers: %s", (text) => {
    expect(resolveOrderReference(text, 48213, null, null).kind).toBe("invalid");
  });
  it("rejects invented numbers and only uses the persisted context when no reference is present", () => {
    expect(resolveOrderReference("pedido 48213", 99999, null, "old").kind).toBe(
      "invalid",
    );
    expect(resolveOrderReference("esse pedido", 99999, null, "old").kind).toBe(
      "invalid",
    );
    expect(resolveOrderReference("esse pedido", null, null, "old")).toEqual({
      kind: "context",
      orderId: "old",
    });
    expect(
      resolveOrderReference("cancelar R$ 48213", null, null, "old").kind,
    ).toBe("invalid");
  });
  it("selects three distinct products deterministically when supplied a random source", () => {
    const first = selectDemoProducts(() => 0);
    expect(first).toEqual(selectDemoProducts(() => 0));
    expect(first).toHaveLength(3);
    expect(new Set(first.map((item) => item.productId)).size).toBe(3);
    expect(
      first.every(
        (item) =>
          item.imageUrl.startsWith("https://fakestoreapi.com/img/") &&
          item.unitPriceCents > 0 &&
          item.description &&
          item.category,
      ),
    ).toBe(true);
    expect(selectDemoProducts(() => 0.99)).not.toEqual(first);
  });
});
