import { useEffect, useState } from "react";
import { Cartridge, getCover } from "./api";
import { ReactNode } from "react";
import { CartGlyph, CartridgeCard, shellOf } from "./kit";
import { wideURL } from "./steam";

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

/** A cartridge (or this machine) as its card: label with the cover art, free space, and children. */
export function CartCard({ cart, children, width, labelHeight, name }: { cart: Cartridge; children?: ReactNode; width?: number | string; labelHeight?: number; name?: string }) {
  const cover = useCover(cart);
  // No label art chosen: the games' hero images stand in, taking turns when there are several.
  const heroes = cart.home ? [] : [...new Set(cart.games.map((g) => wideURL(g.appid)).filter((u): u is string => !!u))];
  const art = cover ?? (heroes.length ? heroes : null);
  return (
    <CartridgeCard
      name={name ?? cart.name}
      shell={shellOf(cart)}
      art={art}
      kind={cart.home ? "home" : "cartridge"}
      tag={cart.home ? "INTERNAL" : speedText(cart.speed)?.split(" · ")[0]}
      free={cart.free}
      total={cart.total}
      width={width}
      labelHeight={labelHeight}
    >
      {children}
    </CartridgeCard>
  );
}

export function CartIcon({ cart, size }: { cart: Cartridge; size?: number }) {
  return <CartGlyph shell={shellOf(cart)} home={cart.home} size={size} />;
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
