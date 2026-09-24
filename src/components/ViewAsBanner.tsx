/**
 * The strip across the top of every screen while agency staff "view as" a client
 * (src/auth/viewAs.ts): whose view this is, that nothing is saved, and Exit, which ends
 * the view and returns to the Clients screen. Renders nothing otherwise.
 */
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconEye } from "./icons.tsx";
import { Button } from "./ui.tsx";

export function ViewAsBanner() {
  const { viewingAs, stopViewAs } = useAuth();
  const navigate = useNavigate();
  if (!viewingAs) return null;
  return (
    <div role="status" data-testid="view-as-banner" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber/25 bg-amber-soft px-4 py-2 text-[13px] text-amber sm:px-6">
      <span className="flex min-w-0 items-center gap-2">
        <IconEye size={16} />
        <span className="min-w-0">
          <strong className="font-semibold">Viewing as {viewingAs.name}</strong>
          {viewingAs.email ? ` (${viewingAs.email})` : ""}. This is what they see when they sign in; nothing you do here is saved.
        </span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        data-testid="view-as-exit"
        onClick={() => {
          stopViewAs();
          navigate("/agency/clients");
        }}
      >
        Exit
      </Button>
    </div>
  );
}
