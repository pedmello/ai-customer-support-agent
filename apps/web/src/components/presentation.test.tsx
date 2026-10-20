import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Registration } from "./Registration";
import { OrderDetails } from "./Orders";
import { displayMessage } from "./Chat";
import { Status, money } from "./ui";
import type { Order } from "../types";
import { safeCatalogImage } from "./ExternalProducts";

const order: Order = {
  orderId: "db698adc-532b-4ab9-8854-ced9a270e334", orderNumber: 48213,
  status: "PROCESSING",
  currency: "USD",
  createdAt: "2026-10-19T12:00:00Z",
  updatedAt: "2026-10-19T12:00:00Z",
  cancelledAt: null,
  totalCents: 2500,
  items: [
    {
      productId: 1,
      title: "Item demonstrativo 1",
      quantity: 1,
      unitPriceCents: 2500,
    },
  ],
};
describe("Apresentação fiel aos dados oficiais", () => {
  it("aceita imagens HTTPS apenas do catálogo conhecido", () => {
    expect(safeCatalogImage("https://fakestoreapi.com/img/item.jpg")).toBe(
      "https://fakestoreapi.com/img/item.jpg",
    );
    expect(safeCatalogImage("javascript:alert(1)")).toBeUndefined();
    expect(
      safeCatalogImage("https://other.example.test/image"),
    ).toBeUndefined();
    expect(
      safeCatalogImage("http://fakestoreapi.com/img/item.jpg"),
    ).toBeUndefined();
  });
  it("explica o cadastro com senha sem promessa de compras reais", () => {
    const html = renderToStaticMarkup(
      <Registration busy={false} error="" onSubmit={async () => {}} />,
    );
    expect(html).toContain("O cadastro não verifica a posse");
    expect(html).toContain("pedidos fictícios");
    expect(html).toContain('type="password"');
  });
  it("mantém a moeda do pedido, sem converter para BRL", () => {
    expect(money(2500, "USD")).toContain("25,00");
    expect(money(2500, "USD")).not.toContain("R$");
  });
  it.each(["SHIPPED", "CANCELLED"] as const)(
    "não oferece cancelamento para %s",
    (status) => {
      const html = renderToStaticMarkup(
        <OrderDetails
          order={{ ...order, status }}
          busy={false}
          onAsk={() => {}}
          onBack={() => {}}
        />,
      );
      expect(html).not.toContain("Solicitar cancelamento");
      expect(html).toContain("Perguntar no chat");
    },
  );
  it("oferece solicitação conversacional para PROCESSING", () => {
    const html = renderToStaticMarkup(
      <OrderDetails
        order={order}
        busy={false}
        onAsk={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).toContain("Solicitar cancelamento");
    expect(html).toContain("exige confirmação no chat");
  });
  it("substitui instruções técnicas por controles sem revelar confirmationId", () => {
    const text = displayMessage(
      "Deseja cancelar o pedido abc? Envie CONFIRMAR CANCELAMENTO e o confirmationId retornado.",
    );
    expect(text).not.toContain("confirmationId");
    expect(text).toContain("Nenhum cancelamento foi executado");
    expect(displayMessage('CONFIRMAR CANCELAMENTO', 'USER')).toBe('Confirmar cancelamento');
    expect(displayMessage('O que significa confirmationId?', 'USER')).toBe('O que significa confirmationId?');
  });
  it("escapa conteúdo não confiável como texto", () => {
    const html = renderToStaticMarkup(
      <OrderDetails
        order={{
          ...order,
          items: [{ ...order.items[0]!, title: "<script>alert(1)</script>" }],
        }}
        busy={false}
        onAsk={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("apresenta status com texto, além da cor", () => {
    expect(renderToStaticMarkup(<Status status="SHIPPED" />)).toContain(
      "Enviado",
    );
  });
});
