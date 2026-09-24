import { InnerHero, SiteFooter, SiteHeader } from "../components/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { usePageCopy } from "@/hooks/usePageContent";
import { useQuery } from "@tanstack/react-query";

type InstructorRow = { id: string; name: string; bio: string | null };

export default function Instructors() {
  const copy = usePageCopy("instructors");
  const roleLabel = copy.text("intro", "role_label");
  const { data } = useQuery({
    queryKey: ["public-instructors"],
    queryFn: async () => {
      const { data } = await supabase.from("instructors").select();
      return (data ?? []) as InstructorRow[];
    },
  });
  const instructors = data ?? [];
  return (
    <main>
      <SiteHeader activePath="/meet-your-instructors/" />
      <InnerHero title={copy.text("intro", "heading")} />
      <section className="wrap instructors-section">
        <div className="instructor-list">
          {instructors.map((instructor) => (
            <article className="instructor-card" key={instructor.id}>
              <h2>{instructor.name}</h2>
              <p className="instructor-role">{roleLabel}</p>
            </article>
          ))}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
