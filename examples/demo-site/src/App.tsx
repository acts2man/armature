import { useEffect } from "react";
import { Link, Route, Routes, useNavigate } from "react-router";
import { registerNavigate, usePageCopy } from "./content.ts";

function Header() {
  const copy = usePageCopy("shared");
  return (
    <header className="site-header">
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
    <footer className="site-footer">
      <p>{copy.text("footer", "blurb")}</p>
      <small>{copy.text("footer", "copyright")}</small>
    </footer>
  );
}

function Home() {
  const copy = usePageCopy("home");
  const cta = copy.link("hero", "cta");
  const video = copy.image("hero", "video");
  useEffect(() => {
    document.title = copy.plain("seo", "title");
  });
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
    </>
  );
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
        <h1>{copy.text("intro", "title")}</h1>
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

export function App() {
  const navigate = useNavigate();
  useEffect(() => registerNavigate((path) => navigate(path)), [navigate]);
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
