/**
 * Agency staff choose what the site's clients may do in the visual editor: change words
 * and pictures, also restyle what is there, or use the whole page builder. The level is
 * enforced again by the publish function, so this panel is a setting, not the guard.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { siteQueryKey } from "@/components/SiteLayout.tsx";
import { Panel, useToast } from "@/components/ui.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { Site } from "@/lib/types.ts";

type Level = NonNullable<Site["editing_level"]>;

const LEVELS: { value: Level; title: string; detail: string }[] = [
  { value: "content", title: "Words and pictures", detail: "Clients change text, links and pictures. Layout and design stay as they are." },
  { value: "style", title: "Words, pictures and styling", detail: "Also colours, fonts, spacing and site settings. Nothing is added, moved or removed." },
  { value: "builder", title: "The full page builder", detail: "Clients add, move and remove elements and build new pages. Locked elements stay locked." },
];

export function EditingLevelPanel({ site }: { site: Site }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const current: Level = site.editing_level ?? "content";
  const mutation = useMutation({
    mutationFn: async (level: Level) => {
      const { error } = await supabase.from("sites").update({ editing_level: level }).eq("id", site.id);
      if (error) throw new Error(error.message);
      return level;
    },
    onSuccess: async (level) => {
      await queryClient.invalidateQueries({ queryKey: siteQueryKey(site.id) });
      toast.show(`Clients now get: ${LEVELS.find((item) => item.value === level)?.title.toLowerCase()}.`, "success");
    },
    onError: (error) => toast.show(error instanceof Error ? error.message : String(error), "danger"),
  });
  // The choice shows at once; the saved level takes over when the site reloads.
  const shown: Level = mutation.isPending && mutation.variables ? mutation.variables : current;
  return (
    <Panel title="Client editing">
      <fieldset className="flex flex-col gap-2 p-5" data-testid="editing-level" disabled={mutation.isPending}>
        <legend className="sr-only">What clients may do in the visual editor</legend>
        {LEVELS.map((level) => (
          <label key={level.value} className={clsx("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5", shown === level.value ? "border-accent bg-blue-soft" : "border-line hover:bg-ground")}>
            <input type="radio" name="editing-level" aria-label={level.title} value={level.value} checked={shown === level.value} onChange={() => mutation.mutate(level.value)} className="mt-1" />
            <span>
              <span className="block text-[14px] font-semibold text-text">{level.title}</span>
              <span className="block text-[12px] text-muted">{level.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Panel>
  );
}
