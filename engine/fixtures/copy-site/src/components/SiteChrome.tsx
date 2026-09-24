import { Link } from "@tanstack/react-router";
import { usePageCopy } from "@/hooks/usePageContent";

export type NavItem = { label: string; href: string };

function NavLinks({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item) => (
        <Link to={item.href} key={item.href}>
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function SiteHeader({ activePath }: { activePath: string }) {
  const copy = usePageCopy("shared");
  const logo = copy.text("header", "logo");
  const logoAlt = copy.text("header", "logo_alt");
  const navItems = copy.list<NavItem>("header", "nav");
  return (
    <header data-active={activePath}>
      <img src={logo} alt={logoAlt} />
      <nav className="nav-links">
        <NavLinks items={navItems} />
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const copy = usePageCopy("shared");
  return (
    <footer>
      <p>{copy.text("footer", "copyright")}</p>
    </footer>
  );
}

export function InnerHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <section className="inner-hero">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </section>
  );
}
