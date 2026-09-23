import { IconSearch } from "@/components/icons.tsx";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui.tsx";

export function NotFound() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Page not found" />
      <EmptyState
        title="There is nothing at this address"
        icon={<IconSearch size={18} />}
        action={
          <LinkButton to="/" variant="secondary" size="sm">
            Go home
          </LinkButton>
        }
      >
        The link may be out of date, or you may not have access to what it points at.
      </EmptyState>
    </div>
  );
}
