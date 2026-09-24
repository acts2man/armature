import { useEffect } from "react";
import { Link, Route, Routes, useNavigate } from "react-router";
import { ArmatureChrome, ArmatureRoute, ArmatureSlot } from "../../../kit/index.ts";
import { armature } from "./armature.ts";
import { registerNavigate, usePageCopy } from "./content.ts";
import { SectionParity } from "./parity.tsx";
import { EveryWidget } from "./widgets.tsx";

function Header() {
  const copy = usePageCopy("shared");
  return (
    <header className="site-header" data-armature-chrome="">
      <Link to="/" className="brand">
        {copy.text("header", "brand")}
      </Link>
      <nav>
        {copy.list("header", "nav").map((item, index) => (
          <Link key={index} to={item.href ?? "/"}>
            {item.label}
          </Link>
        ))}
        <a href="https://example.com/book" className="button small">
          Book a consultation
        </a>
      </nav>
    </header>
  );
}

function Footer() {
  const copy = usePageCopy("shared");
  return (
    <footer className="site-footer" data-armature-chrome="">
      <p>{copy.text("footer", "blurb")}</p>
      <small>{copy.text("footer", "copyright")}</small>
    </footer>
  );
}

// --- the hand-coded sections of the home page, registered with the kit ---------------------

function Hero() {
  const copy = usePageCopy("home");
  const cta = copy.link("hero", "cta");
  const video = copy.image("hero", "video");
  return (
    <>
      <section className="hero">
        <div>
          <h1>{copy.text("hero", "title")}</h1>
          <p className="lead">{copy.text("hero", "body")}</p>
          <p className="actions">
            <Link to={cta.href} className="button">
              {cta.label}
            </Link>
            <Link to="/about/" className="button outline">
              Our process
            </Link>
          </p>
        </div>
        <img src={copy.image("hero", "image")} alt={copy.plain("hero", "image_alt")} className="hero-image" width="640" height="420" />
      </section>
      {video && (
        <section className="video">
          <iframe src={video} title="Video" allowFullScreen />
        </section>
      )}
    </>
  );
}

function Services() {
  const copy = usePageCopy("home");
  return (
    <section className="services">
      <h2>{copy.text("services", "heading")}</h2>
      <div className="grid">
        {copy.list("services", "items").map((item, index) => (
          <article key={index}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  const copy = usePageCopy("home");
  return (
    <section className="faq">
      <h2>{copy.text("faq", "heading")}</h2>
      <dl>
        {copy.list("faq", "items").map((item, index) => (
          <div key={index} className="faq-item">
            <dt>{item.question}</dt>
            <dd>{item.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

armature.registerSiteSection("hero", { label: "Hero", component: Hero });
armature.registerSiteSection("services", { label: "Services", component: Services });
armature.registerSiteSection("faq", { label: "FAQ", component: Faq, repeatable: true });

function Home() {
  const copy = usePageCopy("home");
  useEffect(() => {
    document.title = copy.plain("seo", "title");
  });
  // The page's layout (content/layouts/home.json) decides the order and what sits between
  // the sections; without one, the three sections render as they always did.
  return <ArmatureSlot slug="home" defaults={["hero", "services", "faq"]} />;
}

function About() {
  const copy = usePageCopy("about");
  useEffect(() => {
    document.title = copy.plain("seo", "title");
  });
  return (
    <section className="about">
      <img src={copy.image("intro", "photo")} alt={copy.plain("intro", "photo_alt")} width="480" height="320" />
      <div>
        <h1 data-armature-page-title="">{copy.text("intro", "title")}</h1>
        <p className="lead">{copy.text("intro", "body")}</p>
        <p>
          <a href={copy.image("intro", "website")} target="_blank" rel="noreferrer">
            Our partners
          </a>
        </p>
      </div>
    </section>
  );
}

function NotFound() {
  return (
    <section className="about">
      <div>
        <h1>Page not found</h1>
        <p className="lead">There is nothing at this address.</p>
        <p>
          <Link to="/">Back to the front page</Link>
        </p>
      </div>
    </section>
  );
}

export function App() {
  const navigate = useNavigate();
  useEffect(() => registerNavigate((path) => navigate(path)), [navigate]);
  return (
    <>
      <ArmatureChrome part="header" fallback={<Header />} />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          {/* A test-only page proving builder CSS never changes how a site section renders. */}
          <Route path="/section-parity" element={<SectionParity />} />
          {/* A test-only page with one element of every widget, for the production-build test. */}
          <Route path="/every-widget" element={<EveryWidget />} />
          {/* Builder-only pages (content/layouts/*.json with a path of their own) come before the 404. */}
          <Route path="*" element={<ArmatureRoute fallback={<NotFound />} />} />
        </Routes>
      </main>
      <ArmatureChrome part="footer" fallback={<Footer />} />
    </>
  );
}
