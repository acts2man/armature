import { createBrowserRouter, RouterProvider } from "react-router";
import { RequireAuth, RequireStaff } from "@/auth/RequireAuth.tsx";
import { AppShell } from "@/components/AppShell.tsx";
import { SiteLayout } from "@/components/SiteLayout.tsx";
import { AddSite } from "@/pages/AddSite.tsx";
import { AgencyRequests } from "@/pages/AgencyRequests.tsx";
import { AgencySettings } from "@/pages/AgencySettings.tsx";
import { ChangeRequestDetail } from "@/pages/ChangeRequestDetail.tsx";
import { ChangeRequests } from "@/pages/ChangeRequests.tsx";
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
import { SitePages } from "@/pages/SitePages.tsx";
import { Team } from "@/pages/Team.tsx";

const router = createBrowserRouter([
  { path: "/signin", element: <SignIn /> },
  { path: "/invite/:token", element: <InviteAccept /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <Home /> },
          { path: "/github/setup", element: <GithubSetup /> },
          {
            element: <RequireStaff />,
            children: [
              { path: "/fleet", element: <Fleet /> },
              { path: "/sites/new", element: <AddSite /> },
              { path: "/agency/requests", element: <AgencyRequests /> },
              { path: "/agency/settings", element: <AgencySettings /> },
            ],
          },
          {
            path: "/sites/:siteId",
            element: <SiteLayout />,
            children: [
              { index: true, element: <SiteHome /> },
              { path: "pages", element: <SitePages /> },
              { path: "pages/:slug", element: <PageEditor /> },
              { path: "requests", element: <ChangeRequests /> },
              { path: "requests/new", element: <NewChangeRequest /> },
              { path: "requests/:requestId", element: <ChangeRequestDetail /> },
              { path: "team", element: <Team /> },
              { path: "history", element: <PublishHistory /> },
            ],
          },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
