// @vitest-environment jsdom
/**
 * The forced "Choose your password" screen: a signed-in person whose account still
 * carries must_change_password cannot reach any other screen until it is done.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { User } from "@supabase/supabase-js";
import { CHOOSE_PASSWORD_PATH, mustChangePassword, passwordGateRedirect } from "./passwordGate.ts";

// --- fakes for the modules the screens touch -----------------------------------

const fakeAuth = {
  user: null as User | null,
  agency: { portal_name: "Acme Client Portal" },
  loading: false,
  session: { user: null } as unknown,
  signOut: vi.fn(async () => {}),
};

vi.mock("@/auth/AuthProvider.tsx", () => ({
  useAuth: () => ({ ...fakeAuth, session: fakeAuth.user ? { user: fakeAuth.user } : null }),
}));

const callFunction = vi.fn();
vi.mock("@/lib/functions.ts", () => ({ callFunction: (...args: unknown[]) => callFunction(...args) }));

const refreshSession = vi.fn(async () => ({ data: {}, error: null }));
vi.mock("@/lib/supabase.ts", () => ({
  supabase: { auth: { refreshSession: () => refreshSession() } },
  supabaseConfigured: true,
  missingSupabaseConfig: [],
}));

const { RequireAuth, RequirePasswordChosen } = await import("./RequireAuth.tsx");
const { ChoosePassword } = await import("@/pages/ChoosePassword.tsx");

const flagged = (flag: boolean): User =>
  ({ id: "user-1", email: "sam@bakery.example", app_metadata: { must_change_password: flag }, user_metadata: {} }) as unknown as User;

function renderApp(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RequireAuth />,
        children: [
          { path: CHOOSE_PASSWORD_PATH, element: <ChoosePassword /> },
          {
            element: <RequirePasswordChosen />,
            children: [
              { path: "/", element: <h1>Home screen</h1> },
              { path: "/projects", element: <h1>Projects screen</h1> },
              { path: "/sites/:siteId/pages", element: <h1>Pages screen</h1> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("passwordGateRedirect", () => {
  it("sends a flagged account to the password screen from anywhere else", () => {
    const user = flagged(true);
    expect(mustChangePassword(user)).toBe(true);
    for (const path of ["/", "/projects", "/sites/abc/pages/home", "/agency/settings"]) {
      expect(passwordGateRedirect(user, path)).toBe(CHOOSE_PASSWORD_PATH);
    }
    expect(passwordGateRedirect(user, CHOOSE_PASSWORD_PATH)).toBeNull();
  });

  it("keeps everyone else where they are, and off the password screen", () => {
    for (const user of [flagged(false), null, { app_metadata: {} }]) {
      expect(passwordGateRedirect(user, "/projects")).toBeNull();
      expect(passwordGateRedirect(user, CHOOSE_PASSWORD_PATH)).toBe("/");
    }
  });
});

describe("the forced password screen", () => {
  it("blocks every other screen until the person has chosen a password, then lets them through", async () => {
    fakeAuth.user = flagged(true);
    const router = renderApp("/projects");

    // Landed on the password screen instead of Projects, branded with the portal name only.
    expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeTruthy();
    expect(screen.queryByText("Projects screen")).toBeNull();
    expect(router.state.location.pathname).toBe(CHOOSE_PASSWORD_PATH);
    expect(screen.getByText("Acme Client Portal")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Armature");

    // Trying to go elsewhere by hand bounces straight back.
    await router.navigate("/sites/abc/pages");
    await waitFor(() => expect(router.state.location.pathname).toBe(CHOOSE_PASSWORD_PATH));
    expect(screen.queryByText("Pages screen")).toBeNull();

    // A weak password is refused locally, without calling the server.
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Repeat the new password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password and continue" }));
    expect(await screen.findByText(/at least 10 characters/)).toBeTruthy();
    expect(callFunction).not.toHaveBeenCalled();

    // A good password goes to password-set; the refreshed session no longer carries the flag.
    callFunction.mockImplementation(async () => {
      fakeAuth.user = flagged(false);
      return { ok: true };
    });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Green-Teapot-77" } });
    fireEvent.change(screen.getByLabelText("Repeat the new password"), { target: { value: "Green-Teapot-77" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password and continue" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(callFunction).toHaveBeenCalledWith("password-set", { password: "Green-Teapot-77" });
    expect(refreshSession).toHaveBeenCalled();
    expect(await screen.findByText("Home screen")).toBeTruthy();

    // And the password screen is no longer reachable.
    await router.navigate(CHOOSE_PASSWORD_PATH);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("does not get in the way of an account that never had the flag", async () => {
    fakeAuth.user = flagged(false);
    renderApp("/projects");
    expect(await screen.findByText("Projects screen")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Choose your password" })).toBeNull();
  });
});
