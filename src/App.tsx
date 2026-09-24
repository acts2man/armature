import React, { Suspense } from "react";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router";
import { RequireAuth, RequirePasswordChosen, RequireStaff } from "@/auth/RequireAuth.tsx";
import { CHOOSE_PASSWORD_PATH } from "@/auth/passwordGate.ts";
import { AppShell } from "@/components/AppShell.tsx";
import { SiteLayout } from "@/components/SiteLayout.tsx";
import { Account } from "@/pages/Account.tsx";
import { AddSite } from "@/pages/AddSite.tsx";
import { AgencyClients } from "@/pages/AgencyClients.tsx";
import { AgencyRequests } from "@/pages/AgencyRequests.tsx";
import { AgencySettings } from "@/pages/AgencySettings.tsx";
import { AgencyTeam } from "@/pages/AgencyTeam.tsx";
import { AgencyHelp, ClientHelp } from "@/pages/Help.tsx";
import { ChangeRequestDetail } from "@/pages/ChangeRequestDetail.tsx";
import { ChangeRequests } from "@/pages/ChangeRequests.tsx";
import { ChoosePassword } from "@/pages/ChoosePassword.tsx";
import { Projects } from "@/pages/Projects.tsx";
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
import { SitePosts } from "@/pages/SitePosts.tsx";
import { PostEditor } from "@/pages/PostEditor.tsx";
import { SiteStats } from "@/pages/SiteStats.tsx";
import { SiteConnection, SiteEditingSettings, SiteHistorySettings, SiteServicesSettings, SiteSettings } from "@/pages/SiteSettings.tsx";
import { Team } from "@/pages/Team.tsx";
import { VisualEditor } from "@/visual/VisualEditor.tsx";

// The code engine (proof of concept, behind a flag): loaded only when its route is opened.
const EngineRoute = React.lazy(() => import("../engine/editor/EngineEditor.tsx"));

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
            path: "/sites/:siteId/engine",
            element: (
              <Suspense fallback={null}>
                <EngineRoute />
              </Suspense>
            ),
          },
          {
            element: <AppShell />,
            children: [
              { path: "/", element: <Home /> },
              // The old address of Projects (bookmarks, the invite email's link).
              { path: "/fleet", element: <Navigate to="/projects" replace /> },
              { path: "/github/setup", element: <GithubSetup /> },
              { path: "/account", element: <Account /> },
              { path: "/help", element: <ClientHelp /> },
              {
                element: <RequireStaff />,
                children: [
                  { path: "/projects", element: <Projects /> },
                  { path: "/sites/new", element: <AddSite /> },
                  { path: "/agency/requests", element: <AgencyRequests /> },
                  { path: "/agency/clients", element: <AgencyClients /> },
                  { path: "/agency/settings", element: <AgencySettings /> },
                  { path: "/agency/team", element: <AgencyTeam /> },
                  { path: "/agency/help", element: <AgencyHelp /> },
                ],
              },
              {
                path: "/sites/:siteId",
                element: <SiteLayout />,
                children: [
                  { index: true, element: <SiteHome /> },
                  { path: "pages", element: <SitePages /> },
                  { path: "pages/:slug", element: <PageEditor /> },
                  { path: "posts", element: <SitePosts /> },
                  { path: "posts/new", element: <PostEditor /> },
                  { path: "posts/:slug", element: <PostEditor /> },
                  { path: "stats", element: <SiteStats /> },
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
