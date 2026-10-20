const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ "application/json": { schema: ref(name) } });
const error = (description: string) => ({
  description,
  content: json("Error"),
});
const password = {
  type: "string",
  minLength: 12,
  maxLength: 128,
  writeOnly: true,
  description:
    "Sem trim, normalização ou truncamento. Deve ser igual a passwordConfirmation.",
};
const email = {
  type: "string",
  format: "email",
  maxLength: 254,
  example: "ana@example.test",
};
const commonErrors = {
  "400": error("VALIDATION_ERROR: campos inválidos ou extras"),
  "403": error(
    "ORIGIN_NOT_ALLOWED ou CSRF_INVALID para recuperação com sessão ativa",
  ),
  "415": error("UNSUPPORTED_MEDIA_TYPE; use application/json"),
  "429": error("AUTH_RATE_LIMITED; aguarde antes de tentar novamente"),
  "500": error("INTERNAL_ERROR; sem detalhes internos"),
  "503": error("DATABASE_UNAVAILABLE"),
};
export const authPaths = {
  "/sessions": {
    post: {
      tags: ["Sessions"],
      operationId: "login",
      summary: "Entrar com e-mail e senha",
      description:
        "Verifica Argon2id e cria sessão opaca HttpOnly. Não cria pedidos. Credenciais inválidas, conta inexistente e conta legada sem senha retornam o mesmo erro. Limites persistentes: 10 tentativas por conta e 50 por origem a cada 15 minutos. Exige JSON e origem permitida; não há CSRF prévio ao login.",
      requestBody: { required: true, content: json("Login") },
      responses: {
        "201": {
          description:
            "Sessão criada, cookie HttpOnly e csrfToken para mutações",
          content: json("CurrentSession"),
        },
        "401": error("INVALID_CREDENTIALS: Invalid email or password"),
        ...commonErrors,
      },
    },
  },
  "/password-recovery/request": {
    post: {
      tags: ["Password recovery"],
      operationId: "requestPasswordRecovery",
      summary: "Solicitar código por e-mail",
      description:
        "Resposta genérica para conta existente/inexistente, cooldown e falha de envio. Não retorna código nem identificador do desafio. Código de 8 dígitos, até 10 minutos, 5 tentativas e cooldown mínimo de 60s. Limite de 5 solicitações por conta/hora (resposta genérica) e 30 por origem/hora (429). Envio desabilitado até configurar Resend. Com cookie de sessão ativa, envie também X-CSRF-Token; cookies expirados não impedem a recuperação pública.",
      parameters: [
        {
          in: "header",
          name: "X-CSRF-Token",
          required: false,
          schema: { type: "string" },
          description:
            "Obrigatório quando um cookie de sessão ativa estiver presente.",
        },
      ],
      requestBody: { required: true, content: json("RecoveryRequest") },
      responses: {
        "202": {
          description:
            "Solicitação recebida; não comprova entrega ou existência da conta",
          content: json("RecoveryAccepted"),
        },
        ...commonErrors,
      },
    },
  },
  "/password-recovery/reset": {
    post: {
      tags: ["Password recovery"],
      operationId: "resetPassword",
      summary: "Consumir código e definir nova senha",
      description:
        "Consome código atomicamente, atualiza Argon2id e credentialVersion, registra comprovação do e-mail e revoga todas as sessões. Não faz login automaticamente. Contas legadas podem definir senha pelo mesmo fluxo. Limites: 20 tentativas/conta e 50/origem a cada 15 minutos. Com sessão ativa, exige X-CSRF-Token. Senha anterior, código e hash nunca são retornados.",
      parameters: [
        {
          in: "header",
          name: "X-CSRF-Token",
          required: false,
          schema: { type: "string" },
          description: "Obrigatório com cookie de sessão ativa.",
        },
      ],
      requestBody: { required: true, content: json("RecoveryReset") },
      responses: {
        "204": {
          description: "Senha alterada e sessões revogadas; retorne ao login",
        },
        ...commonErrors,
        "400": error(
          "VALIDATION_ERROR ou PASSWORD_RESET_INVALID: código incorreto, expirado, consumido, bloqueado ou conta inexistente",
        ),
      },
    },
  },
};
export const authSchemas = {
  Login: {
    type: "object",
    additionalProperties: false,
    required: ["email", "password"],
    properties: {
      email,
      password: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        writeOnly: true,
      },
    },
  },
  RecoveryRequest: {
    type: "object",
    additionalProperties: false,
    required: ["email"],
    properties: { email },
  },
  RecoveryReset: {
    type: "object",
    additionalProperties: false,
    required: ["email", "code", "password", "passwordConfirmation"],
    properties: {
      email,
      code: { type: "string", pattern: "^\\d{8}$", writeOnly: true },
      password,
      passwordConfirmation: password,
    },
  },
  RecoveryAccepted: {
    type: "object",
    additionalProperties: false,
    required: ["message", "resendAfterSeconds"],
    properties: {
      message: { type: "string" },
      resendAfterSeconds: { type: "integer", minimum: 60, example: 60 },
    },
  },
};
