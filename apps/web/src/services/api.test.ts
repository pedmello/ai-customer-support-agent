import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi, ApiError, decisionMessage } from "./api";

afterEach(() => vi.restoreAllMocks());
describe("HTTP seguro", () => {
  it("envia cookie e CSRF sem customerId e usa o protocolo exato de confirmação", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} })));
    const api = createApi("http://localhost:3000", fetcher);
    api.setCsrf("csrf-example");
    const message = decisionMessage("challenge", true);
    await api.send("conversation", message);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      "http://localhost:3000/conversations/conversation/messages",
    );
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-example");
    expect(JSON.parse(init.body)).toEqual({
      ...message,
      content: "CONFIRMAR CANCELAMENTO",
      confirmationId: "challenge",
    });
    expect(init.body).not.toContain("customerId");
  });
  it("mantém a mesma chave e conteúdo em uma repetição manual", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValue(new Response('{"data":{}}'));
    const api = createApi("", fetcher);
    const input = decisionMessage("challenge", false);
    await expect(api.send("conversation", input)).rejects.toBeInstanceOf(
      ApiError,
    );
    await api.send("conversation", input);
    expect(fetcher.mock.calls[0]![1].body).toBe(fetcher.mock.calls[1]![1].body);
    expect(input.content).toBe("DESISTIR");
  });
  it("traduz e-mail duplicado e não expõe mensagens internas", async () => {
    const api = createApi(
      "",
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              '{"error":{"code":"EMAIL_ALREADY_REGISTERED","message":"private"}}',
              { status: 409 },
            ),
        ),
    );
    await expect(api.register("Ana", "ana@example.test")).rejects.toMatchObject(
      { status: 409, code: "EMAIL_ALREADY_REGISTERED" },
    );
    await expect(
      api.register("Ana", "ana@example.test"),
    ).rejects.not.toHaveProperty("message", "private");
  });
  it("percorre todas as páginas de pedidos", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ orderId: "a" }],
            pagination: { totalPages: 2 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ orderId: "b" }],
            pagination: { totalPages: 2 },
          }),
        ),
      );
    expect(await createApi("", fetcher).orders()).toHaveLength(2);
  });
  it("não repete mutações automaticamente e aceita logout 204", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await createApi("", fetcher).logout();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
