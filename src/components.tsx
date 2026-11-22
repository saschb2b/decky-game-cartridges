import { CSSProperties, useEffect, useState } from "react";
import { Cartridge, getCover, getGameArt } from "./api";
import { portraitURL } from "./steam";

const coverCache = new Map<string, string | null>();

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

const artCache = new Map<string, string | null>();

export function useGameArt(mount: string, gameId: string, appid: number | null) {
  const steam = portraitURL(appid);
  const key = `${mount}|${gameId}`;
  const [url, setUrl] = useState<string | null>(steam ?? artCache.get(key) ?? null);
  useEffect(() => {
    if (steam) {
      setUrl(steam);
      return;
    }
    if (artCache.has(key)) {
      setUrl(artCache.get(key)!);
      return;
    }
    let live = true;
    getGameArt(mount, gameId).then((u) => {
      artCache.set(key, u);
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [key, steam]);
  return url;
}

const hues = [210, 25, 145, 280, 350, 190, 50];

/** The cartridge's cover, or a plain generated one with its name. */
export function Cover({ cart, url, width = 60 }: { cart: Cartridge; url: string | null; width?: number }) {
  const height = Math.round(width * 1.5);
  const style: CSSProperties = {
    width,
    height,
    minWidth: width,
    borderRadius: 4,
    objectFit: "cover",
    boxShadow: "0 2px 6px rgba(0,0,0,.5)",
  };
  if (url) return <img src={url} style={style} />;
  const hue = cart.home ? 0 : hues[[...cart.id].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  return (
    <div
      style={{
        ...style,
        background: cart.home
          ? "linear-gradient(160deg, #3d4450, #1b1f26)"
          : `linear-gradient(160deg, hsl(${hue} 55% 42%), hsl(${hue} 60% 18%))`,
        display: "flex",
        alignItems: "flex-end",
        padding: 4,
        boxSizing: "border-box",
        fontSize: Math.max(9, width / 6),
        fontWeight: 700,
        lineHeight: 1.1,
        color: "#fff",
        overflow: "hidden",
        wordBreak: "break-word",
      }}
    >
      {cart.name}
    </div>
  );
}

export function GameArt({ mount, id, appid, width = 40 }: { mount: string; id: string; appid: number | null; width?: number }) {
  const url = useGameArt(mount, id, appid);
  const style: CSSProperties = { width, height: width * 1.5, minWidth: width, borderRadius: 3, objectFit: "cover" };
  return url ? <img src={url} style={style} /> : <div style={{ ...style, background: "#2a2f38" }} />;
}

export function SpeedWarning({ cart }: { cart: Cartridge }) {
  if (!cart.speed || cart.speed > 480) return null;
  return (
    <div style={{ color: "#ffb347", fontSize: 12, lineHeight: 1.3, marginTop: 4 }}>
      ⚠ Connected at USB 2 speed ({cart.speed} Mbit/s). Games load very slowly; use a USB 3 port (blue, teal or
      USB-C).
    </div>
  );
}

export function Meter({ used, total }: { used: number; total: number }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,.15)", marginTop: 4 }}>
      <div style={{ height: 4, borderRadius: 2, width: `${pct}%`, background: pct > 92 ? "#e35d5b" : "#1a9fff" }} />
    </div>
  );
}

export const muted: CSSProperties = { color: "#8b929a", fontSize: 12 };
