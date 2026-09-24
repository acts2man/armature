import { Link } from "react-router-dom";

const links = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
];

export function Header() {
  return (
    <header className="flex items-center justify-between p-4">
      <Link to="/" className="font-bold">Fixture Co</Link>
      <nav className="flex gap-4">
        {links.map((link) => (
          <Link key={link.href} to={link.href} className="text-sm">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
