import { Outlet, createRootRoute } from "@tanstack/react-router";
import globalsCss from "../styles/globals.css?url";
export const Route = createRootRoute({ head: () => ({ links: [{ rel: "stylesheet", href: globalsCss }] }), component: () => <Outlet /> });
