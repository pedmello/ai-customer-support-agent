import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../src/config/logger.js";
import {
  createResendClient,
  recoveryTemplate,
} from "../src/integrations/email/email.client.js";

const input = {
  to: "fake@example.test",
  code: "12345678",
  challengeId: "test-challenge",
  expiresInMinutes: 10,
};
describe("isolated Resend HTTP client", () => {
  it("sends only to the fixed HTTPS endpoint with timeout, template and idempotency", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = createResendClient({
      apiKey: "test-key",
      from: "support@example.test",
      timeoutMs: 100,
      logger: createLogger("silent"),
      fetcher,
    });
    await client.sendRecovery(input);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({
      "Idempotency-Key": "password-recovery/test-challenge",
    });
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain(input.code);
    expect(body.to).toEqual([input.to]);
  });
  it.each([429, 500])("sanitizes provider HTTP %s", async (status) => {
    const client = createResendClient({
      apiKey: "test",
      from: "support@example.test",
      timeoutMs: 100,
      logger: createLogger("silent"),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private error", { status })),
    });
    await expect(client.sendRecovery(input)).rejects.toThrow(
      "Email delivery unavailable",
    );
  });
  it("sanitizes transport timeouts and refuses unconfigured delivery", async () => {
    const client = createResendClient({
      apiKey: "test",
      from: "support@example.test",
      timeoutMs: 100,
      logger: createLogger("silent"),
      fetcher: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException("private details", "TimeoutError")),
    });
    await expect(client.sendRecovery(input)).rejects.toThrow(
      "Email delivery unavailable",
    );
    await expect(
      createResendClient({
        timeoutMs: 100,
        logger: createLogger("silent"),
      }).sendRecovery(input),
    ).rejects.toThrow("Email delivery unavailable");
    expect(() => recoveryTemplate("<script>", 10)).toThrow();
  });
});
