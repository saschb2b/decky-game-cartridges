import { useEffect, useState } from "react";
import { Cartridge, getCover } from "./api";
import { CartridgeArt, ConsoleArt, shellOf } from "./kit";

const coverCache = new Map<string, string | null>();

/** The cartridge's cover image (a data URL), loaded once per cover version. */
export function useCover(cart: Cartridge | null | undefined) {
  const key = cart?.cover ? `${cart.mount}|${cart.cover}` : null;
  const [url, setUrl] = useState<string | null>(key ? coverCache.get(key) ?? null : null);
  useEffect(() => {
    if (!key || !cart) {
      setUrl(null);
      return;
    }
    if (coverCache.has(key)) {
      setUrl(coverCache.get(key)!);
      return;
    }
    let live = true;
    getCover(cart.mount).then((u) => {
      coverCache.set(key, u);
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return url;
}

/** A cartridge drawn as one; the machine's internal storage as a console base. */
export function CartArt({ cart, width }: { cart: Cartridge; width: number }) {
  const cover = useCover(cart);
  if (cart.home) return <ConsoleArt width={width * 1.15} />;
  return <CartridgeArt name={cart.name} shell={shellOf(cart)} art={cover} width={width} />;
}

export function speedText(speed: number | null) {
  if (!speed) return null;
  if (speed <= 480) return "USB 2";
  return `USB 3 · ${speed >= 1000 ? `${speed / 1000} Gb/s` : `${speed} Mb/s`}`;
}

export const muted = { color: "#8b929a", fontSize: 12 };

export const sectionLabel = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "#8b929a",
  margin: "18px 0 8px",
};
