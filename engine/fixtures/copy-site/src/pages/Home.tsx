import { Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { usePageCopy } from "@/hooks/usePageContent";

export default function Home() {
  const copy = usePageCopy("home");
  const weeks = copy.list<{ text: string }>("course", "weeks");
  const heroCta = copy.link("hero", "cta");
  return (
    <main id="top">
      <SiteHeader activePath="/" />
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap hero-inner">
          <h1 id="hero-title">{copy.text("hero", "title")}</h1>
          <img className="credential" src={copy.text("hero", "badge")} alt={copy.text("hero", "badge_alt")} />
          <p>{copy.text("hero", "body")}</p>
          <p>
            <strong>{copy.text("hero", "schedule").split("·")[0]?.trim()}</strong>
          </p>
          <Link className="button hero-button" to={heroCta.href as string}>
            {heroCta.label}
          </Link>
        </div>
      </section>
      <section className="course wrap" id="course">
        <ul className="week-list">
          {weeks.map((week) => (
            <li key={week.text}>{week.text}</li>
          ))}
        </ul>
      </section>
      <SiteFooter />
    </main>
  );
}
