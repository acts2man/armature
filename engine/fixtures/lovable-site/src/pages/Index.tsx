import heroImage from "@/assets/hero.png";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { useItems } from "@/hooks/useItems";

const features = [
  { title: "Fast", body: "Loads in a blink." },
  { title: "Simple", body: "Nothing to learn." },
];

const Index = () => {
  const items = useItems();
  const tagline = "Built for small teams";
  return (
    <div className="min-h-screen">
      <Header />
      <section className="hero-title px-6 py-16 md:py-24">
        <h1 className="text-4xl font-bold md:text-6xl">
          Welcome to <strong>Fixture</strong>
        </h1>
        <p className="mt-4 text-lg text-gray-600">{tagline}</p>
        <img src={heroImage} alt="A hero" className="mt-8 w-full" />
        <img src="/images/photo.jpg" alt="A photo" />
        <Button className="mt-6">Get started</Button>
        <a href="/about" className="button mt-2">Learn more</a>
      </section>
      <section className="grid gap-6 px-6">
        {features.map((feature) => (
          <article key={feature.title} className="rounded-lg border p-4">
            <h2 className="text-xl font-semibold">{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>
      <ul className="px-6">
        {items.map((item) => (
          <li key={item.name}>{item.name}</li>
        ))}
      </ul>
      <p className="px-6">{tagline.toUpperCase()}</p>
    </div>
  );
};

export default Index;
