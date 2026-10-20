import { describe, it, expect } from "vitest";
import { registerCustomerSchema } from "../src/modules/customers/customer.schemas.js";
import { hashPassword, verifyPassword } from "../src/modules/auth/password.js";

const input = {
  name: " Ana ",
  email: " ANA@example.test ",
  password: "  Uma senha longa!  ",
  passwordConfirmation: "  Uma senha longa!  ",
};
describe("password credentials", () => {
  it("normalizes identity but never changes passwords", () => {
    expect(registerCustomerSchema.parse(input)).toEqual({
      ...input,
      name: "Ana",
      email: "ana@example.test",
    });
  });
  it.each([
    { ...input, passwordConfirmation: "different password" },
    { ...input, password: "short", passwordConfirmation: "short" },
    {
      ...input,
      password: "a".repeat(129),
      passwordConfirmation: "a".repeat(129),
    },
    { name: "Ana", email: "ana@example.test" },
  ])("rejects missing, mismatched or out-of-policy passwords", (value) => {
    expect(registerCustomerSchema.safeParse(value).success).toBe(false);
  });
  it("uses salted Argon2id and verifies exact original content", async () => {
    const stored = await hashPassword(input.password);
    expect(stored).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(stored, input.password)).toBe(true);
    expect(await verifyPassword(stored, input.password.trim())).toBe(false);
    expect(await verifyPassword(null, input.password)).toBe(false);
    expect(await hashPassword(input.password)).not.toBe(stored);
  });
});
