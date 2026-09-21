import { LinkButton, Notice } from "@/components/ui.tsx";

export function NotFound() {
  return (
    <Notice kind="warning" title="There is nothing at this address" action={<LinkButton to="/" variant="secondary">Go home</LinkButton>}>
      The link may be out of date, or you may not have access to what it points at.
    </Notice>
  );
}
