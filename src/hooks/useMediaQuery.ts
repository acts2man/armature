/** Whether a CSS media query matches, kept in step as the window changes. */
import { useEffect, useState } from "react";

export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? fallback : window.matchMedia(query).matches));
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Below Tailwind's `sm` breakpoint (640px): a phone, where tables become stacked cards. */
export const usePhone = (): boolean => useMediaQuery("(max-width: 639px)");
