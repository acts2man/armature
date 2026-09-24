import { useEffect, useState } from "react";

export function useItems() {
  const [items, setItems] = useState<{ name: string }[]>([]);
  useEffect(() => {
    fetch("/api/items")
      .then((response) => response.json())
      .then(setItems);
  }, []);
  return items;
}
