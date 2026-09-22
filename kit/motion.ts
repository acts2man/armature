/**
 * Entrance animations: elements with `data-ae-anim` start invisible (see the CSS
 * generator) and get the `ae-in` class when they scroll into view, which plays their
 * keyframes once. Under prefers-reduced-motion the CSS shows them at once and this
 * does nothing.
 */
export function installEntranceAnimations(root: HTMLElement): () => void {
  if (typeof window === "undefined" || typeof IntersectionObserver !== "function") {
    for (const element of Array.from(root.querySelectorAll("[data-ae-anim]"))) element.classList.add("ae-in");
    return () => undefined;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    for (const element of Array.from(root.querySelectorAll("[data-ae-anim]"))) element.classList.add("ae-in");
    return () => undefined;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("ae-in");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 },
  );
  const observe = () => {
    for (const element of Array.from(root.querySelectorAll("[data-ae-anim]:not(.ae-in)"))) observer.observe(element);
  };
  observe();
  // Elements added later (the editor pushing a draft) are picked up too.
  const mutations = typeof MutationObserver === "function" ? new MutationObserver(observe) : null;
  mutations?.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    mutations?.disconnect();
  };
}
