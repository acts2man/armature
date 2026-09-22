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

/**
 * Vertical parallax: elements with `data-ae-parallax` (-10 to 10) drift against the
 * scroll by up to that many percent of the distance from the middle of the screen. One
 * passive scroll listener, one transform per frame; nothing under reduced motion.
 */
export function installParallax(root: HTMLElement): () => void {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => undefined;
  const elements = () => Array.from(root.querySelectorAll<HTMLElement>("[data-ae-parallax]"));
  if (elements().length === 0) return () => undefined;
  let frame = 0;
  const update = () => {
    frame = 0;
    const middle = window.innerHeight / 2;
    for (const element of elements()) {
      const speed = Number(element.dataset["aeParallax"]) || 0;
      // Measure without the current shift so the movement never feeds back on itself.
      const shift = Number(element.dataset["aeParallaxShift"] ?? 0);
      const box = element.getBoundingClientRect();
      const distance = box.top - shift + box.height / 2 - middle;
      const next = Math.round(distance * speed * -0.02 * 10) / 10;
      element.dataset["aeParallaxShift"] = String(next);
      element.style.translate = `0 ${next}px`;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    for (const element of elements()) {
      element.style.translate = "";
      delete element.dataset["aeParallaxShift"];
    }
  };
}
