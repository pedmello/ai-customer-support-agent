import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi, ApiError, decisionMessage } from "./api";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("HTTP seguro", () => {
  it("encerra a espera HTTP no prazo sem reenviar uma mutação", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = createApi('', fetcher).send('conversation', decisionMessage('confirmation', true)).catch(error => error);
    await vi.advanceTimersByTimeAsync(45000);
    expect(await pending).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps passwords and recovery codes exact, sends credentials, and never adds customerId', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
    const api = createApi('', fetcher);
    await api.register(' Ana ', ' ANA@example.test ', '  Exact Password  ', '  Exact Password  ');
    await api.login(' ANA@example.test ', '  Exact Password  ');
    await api.requestRecovery(' ANA@example.test ');
    await api.resetPassword(' ANA@example.test ', '00123456', '  New Password  ', '  New Password  ');
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(init?.body as string));
    expect(bodies[0]).toEqual({ name: 'Ana', email: 'ana@example.test', password: '  Exact Password  ', passwordConfirmation: '  Exact Password  ' });
    expect(bodies[1]).toEqual({ email: 'ana@example.test', password: '  Exact Password  ' });
    expect(bodies[3].code).toBe('00123456'); expect(bodies[3].password).toBe('  New Password  ');
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
    expect(bodies.every((body) => !('customerId' in body))).toBe(true);
  });
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
    await expect(api.register("Ana", "ana@example.test", "Test-password-123!", "Test-password-123!")).rejects.toMatchObject(
      { status: 409, code: "EMAIL_ALREADY_REGISTERED" },
    );
    await expect(
      api.register("Ana", "ana@example.test", "Test-password-123!", "Test-password-123!"),
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
