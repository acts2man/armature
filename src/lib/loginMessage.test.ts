import { describe, expect, it } from "vitest";
import { loginDetailsMessage } from "./loginMessage.ts";

describe("loginDetailsMessage", () => {
  it("names the portal, the link, the email and the temporary password, and nothing else", () => {
    const message = loginDetailsMessage({
      portalName: "Acme Client Portal",
      signInUrl: "https://portal.example/signin",
      email: "sam@bakery.example",
      temporaryPassword: "Blue-Kettle-4291",
    });
    expect(message).toBe(
      "Here is your login for Acme Client Portal: https://portal.example/signin, email: sam@bakery.example, temporary password: Blue-Kettle-4291. " +
        "You'll be asked to choose your own password the first time you sign in.",
    );
    expect(message).not.toContain("Armature");
  });
});
