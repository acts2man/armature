import { describe, expect, it } from "vitest";
import { GENERATED_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, generateTemporaryPassword, passwordProblem } from "./passwordRules.ts";

describe("passwordProblem", () => {
  it("accepts a reasonable password", () => {
    expect(passwordProblem("Blue-Kettle-42", "sam@example.com")).toBeNull();
  });

  it("rejects short passwords", () => {
    expect(passwordProblem("Short1!", "sam@example.com")).toContain(`${MIN_PASSWORD_LENGTH} characters`);
  });

  it("rejects one character repeated", () => {
    expect(passwordProblem("aaaaaaaaaaaa")).toContain("same character");
    expect(passwordProblem("AAAAaaaaaaaa")).toContain("same character");
  });

  it('rejects anything containing "password"', () => {
    expect(passwordProblem("MyPassword2026!")).toContain('"password"');
  });

  it("rejects the email address and the part before the @", () => {
    expect(passwordProblem("Sam.Client@Example.com", "sam.client@example.com")).toContain("email address");
    expect(passwordProblem("sam.client.jones", "Sam.Client.Jones@example.com")).toContain("email address");
  });

  it("rejects obvious sequences", () => {
    expect(passwordProblem("x1234567890x")).toContain("sequence");
    expect(passwordProblem("qwertyuiop!!")).toContain("sequence");
  });
});

describe("generateTemporaryPassword", () => {
  it("makes passwords of the right length that pass the rules and mix character classes", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(passwordProblem(password, "sam@example.com")).toBeNull();
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%&*?+\-=]/);
    }
  });

  it("never makes the same password twice in a row", () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });

  it("never goes below twelve characters even when asked", () => {
    expect(generateTemporaryPassword(4).length).toBeGreaterThanOrEqual(12);
  });
});
