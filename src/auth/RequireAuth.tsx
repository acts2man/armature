import { Navigate, Outlet, useLocation } from "react-router";
import { Spinner } from "@/components/ui.tsx";
import { useAuth } from "./AuthProvider.tsx";

/** Gate for signed-in routes. Sends visitors to /signin and back again afterwards. */
export function RequireAuth() {
  const { loading, session } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading your account" />
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/signin" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}

/** Gate for agency-only routes. Clients are sent to their home. */
export function RequireStaff() {
  const { isStaff } = useAuth();
  if (!isStaff) return <Navigate to="/" replace />;
  return <Outlet />;
}
