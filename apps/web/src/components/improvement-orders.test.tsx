// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductImage } from "./ProductImage";
import { OrderDetails } from "./Orders";
import { publicOrderText } from "../services/order-presentation";
import type { Order } from "../types";
const order: Order = {
  orderId: "e62fc3de-6b19-44fd-8cfb-1ffb2b2e71ce",
  orderNumber: 48213,
  status: "PROCESSING",
  currency: "BRL",
  totalCents: 24990,
  createdAt: "2026-10-20T12:00:00Z",
  updatedAt: "2026-10-20T12:00:00Z",
  cancelledAt: null,
  items: [
    {
      productId: 1,
      title: "Fjallraven - Foldsack",
      imageUrl: "https://fakestoreapi.com/img/81fPKd-2AYL._AC_SL1500_t.png",
      description: "Backpack",
      category: "men's clothing",
      quantity: 1,
      unitPriceCents: 24990,
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('simplifies only compact order details without changing desktop data', () => {
  const cancelled = { ...order, status: 'CANCELLED' as const, cancelledAt: order.createdAt, items: [{ ...order.items[0]!, category: 'electronics' }] };
  const view = render(<OrderDetails compact order={cancelled} busy={false} onAsk={() => {}} onBack={() => {}} />);
  expect(screen.queryByText('electronics')).toBeNull();
  expect(screen.queryByText(/^Cancelado em/)).toBeNull();
  expect(screen.queryByText(/^Unidade:/)).toBeNull();
  expect(screen.getByText(/Quantidade: 1/)).toBeTruthy();
  view.rerender(<OrderDetails order={cancelled} busy={false} onAsk={() => {}} onBack={() => {}} />);
  expect(screen.getByText('electronics')).toBeTruthy();
  expect(screen.getByText(/^Cancelado em/)).toBeTruthy();
  expect(screen.getByText(/^Unidade:/)).toBeTruthy();
  expect(screen.getByText(/As informações dos produtos são baseadas no catálogo da Fake Store API/).textContent?.replace(/\s+/g, ' ')).toBe('As informações dos produtos são baseadas no catálogo da Fake Store API, utilizado como fonte complementar. Os valores, pedidos e status apresentados são definidos pelo Support AI.');
  expect(screen.queryByText(/Consulte o catálogo complementar/)).toBeNull();
});
it("shows the snapshot photo and falls back without hiding the product when it fails", () => {
  render(
    <ProductImage
      imageUrl={order.items[0]!.imageUrl}
      title={order.items[0]!.title}
    />,
  );
  const photo = screen.getByRole("img", { name: "Fjallraven - Foldsack" });
  expect(photo.getAttribute("src")).toBe(order.items[0]!.imageUrl);
  fireEvent.error(photo);
  expect(
    screen.getByRole("img", {
      name: "Imagem indisponível: Fjallraven - Foldsack",
    }),
  ).toBeTruthy();
});
it("never loads unsupported image sources", () => {
  render(
    <ProductImage
      imageUrl="https://unknown.example.test/track"
      title="Product"
    />,
  );
  expect(document.querySelector("img")).toBeNull();
});
it("shows and copies a public number, keeping the recorded BRL total", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(
    <OrderDetails
      order={order}
      busy={false}
      onAsk={() => {}}
      onBack={() => {}}
    />,
  );
  expect(document.body.textContent).not.toContain(order.orderId);
  expect(document.body.textContent).toContain("#48213");
  expect(document.body.textContent).toContain("249,90");
  fireEvent.click(
    screen.getByRole("button", { name: "Copiar número do pedido 48213" }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("48213"));
  expect(await screen.findByText("Número copiado")).toBeTruthy();
});
it("adapts old UUID text only in presentation, without inventing numbers for unknown orders", () => {
  const original = `Pedido ${order.orderId}`;
  expect(publicOrderText(original, [order])).toBe("Pedido #48213");
  expect(original).toContain(order.orderId);
  expect(publicOrderText(original, [])).toBe("Pedido [pedido indisponível]");
});
it("preserves USD display on legacy orders", () => {
  render(
    <OrderDetails
      order={{ ...order, currency: "USD", totalCents: 2500 }}
      busy={false}
      onAsk={() => {}}
      onBack={() => {}}
    />,
  );
  expect(document.body.textContent).toContain("US$");
  expect(document.body.textContent).toContain("25,00");
});
