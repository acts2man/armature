/** True at the sidebar's breakpoint and above (900px): room for a list and a detail side by side. */
import { useEffect, useState } from "react";

const QUERY = "(min-width: 900px)";

export function useWide(): boolean {
  const [wide, setWide] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(QUERY).matches));
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
}
