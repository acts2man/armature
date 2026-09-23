import { Navigate, createBrowserRouter, RouterProvider } from "react-router";
import { RequireAuth, RequirePasswordChosen, RequireStaff } from "@/auth/RequireAuth.tsx";
import { CHOOSE_PASSWORD_PATH } from "@/auth/passwordGate.ts";
import { AppShell } from "@/components/AppShell.tsx";
import { SiteLayout } from "@/components/SiteLayout.tsx";
import { Account } from "@/pages/Account.tsx";
import { AddSite } from "@/pages/AddSite.tsx";
import { AgencyRequests } from "@/pages/AgencyRequests.tsx";
import { AgencySettings } from "@/pages/AgencySettings.tsx";
import { AgencyTeam } from "@/pages/AgencyTeam.tsx";
import { ChangeRequestDetail } from "@/pages/ChangeRequestDetail.tsx";
import { ChangeRequests } from "@/pages/ChangeRequests.tsx";
import { ChoosePassword } from "@/pages/ChoosePassword.tsx";
import { Fleet } from "@/pages/Fleet.tsx";
import { GithubSetup } from "@/pages/GithubSetup.tsx";
import { Home } from "@/pages/Home.tsx";
import { InviteAccept } from "@/pages/InviteAccept.tsx";
import { NewChangeRequest } from "@/pages/NewChangeRequest.tsx";
import { NotFound } from "@/pages/NotFound.tsx";
import { PageEditor } from "@/pages/PageEditor.tsx";
import { PublishHistory } from "@/pages/PublishHistory.tsx";
import { SignIn } from "@/pages/SignIn.tsx";
import { SiteHome } from "@/pages/SiteHome.tsx";
import { AppearanceFooter, AppearanceGlobals, AppearanceHeader, AppearanceMenus, SiteAppearance } from "@/pages/SiteAppearance.tsx";
import { SiteContact } from "@/pages/SiteContact.tsx";
import { SiteMedia } from "@/pages/SiteMedia.tsx";
import { SitePages } from "@/pages/SitePages.tsx";
import { SiteConnection, SiteEditingSettings, SiteHistorySettings, SiteServicesSettings, SiteSettings } from "@/pages/SiteSettings.tsx";
import { Team } from "@/pages/Team.tsx";
import { VisualEditor } from "@/visual/VisualEditor.tsx";

const router = createBrowserRouter([
  { path: "/signin", element: <SignIn /> },
  { path: "/invite/:token", element: <InviteAccept /> },
  {
    element: <RequireAuth />,
    children: [
      // The password screen sits outside the shell and outside the gate that sends
      // every other signed-in route here until a temporary password is replaced.
      { path: CHOOSE_PASSWORD_PATH, element: <ChoosePassword /> },
      {
        element: <RequirePasswordChosen />,
        children: [
          // The visual editor is a full-screen workspace with its own frame.
          { path: "/sites/:siteId/visual/:pageSlug?", element: <VisualEditor /> },
          {
            element: <AppShell />,
            children: [
              { path: "/", element: <Home /> },
              { path: "/github/setup", element: <GithubSetup /> },
              { path: "/account", element: <Account /> },
              {
                element: <RequireStaff />,
                children: [
                  { path: "/fleet", element: <Fleet /> },
                  { path: "/sites/new", element: <AddSite /> },
                  { path: "/agency/requests", element: <AgencyRequests /> },
                  { path: "/agency/settings", element: <AgencySettings /> },
                  { path: "/agency/team", element: <AgencyTeam /> },
                ],
              },
              {
                path: "/sites/:siteId",
                element: <SiteLayout />,
                children: [
                  { index: true, element: <SiteHome /> },
                  { path: "pages", element: <SitePages /> },
                  { path: "pages/:slug", element: <PageEditor /> },
                  { path: "media", element: <SiteMedia /> },
                  { path: "contact", element: <SiteContact /> },
                  {
                    path: "appearance",
                    element: <SiteAppearance />,
                    children: [
                      { index: true, element: <AppearanceGlobals /> },
                      { path: "header", element: <AppearanceHeader /> },
                      { path: "footer", element: <AppearanceFooter /> },
                      { path: "menus", element: <AppearanceMenus /> },
                    ],
                  },
                  { path: "requests", element: <ChangeRequests /> },
                  { path: "requests/new", element: <NewChangeRequest /> },
                  { path: "requests/:requestId", element: <ChangeRequestDetail /> },
                  { path: "users", element: <Team /> },
                  { path: "team", element: <Navigate to="../users" replace /> },
                  { path: "history", element: <PublishHistory /> },
                  {
                    path: "settings",
                    element: <SiteSettings />,
                    children: [
                      { index: true, element: <SiteConnection /> },
                      { path: "services", element: <SiteServicesSettings /> },
                      { path: "editing", element: <SiteEditingSettings /> },
                      { path: "history", element: <SiteHistorySettings /> },
                    ],
                  },
                  { path: "*", element: <NotFound /> },
                ],
              },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
