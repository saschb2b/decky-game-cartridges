// One visual idea, used everywhere: a cartridge is a card moulded like a cartridge. Its plastic is the
// shell colour, grip ridges sit at the top, the label sticker carries the cover art and the name, the
// games sit on the plastic below it, and the edge connector closes the bottom. Everything else
// (buttons, text, focus) stays Steam's own.
import { Focusable } from "@decky/ui";
import { CSSProperties, ReactNode } from "react";
import type { Cartridge } from "./api";

export const SHELLS: { name: string; hex: string }[] = [
  { name: "Graphite", hex: "#33363d" },
  { name: "Bone", hex: "#cdc6b6" },
  { name: "Ice", hex: "#8eafc4" },
  { name: "Moss", hex: "#4d765a" },
  { name: "Grape", hex: "#5c4a87" },
  { name: "Brick", hex: "#a9453a" },
  { name: "Mustard", hex: "#c99a36" },
  { name: "Ocean", hex: "#2e5a86" },
];

export const HOME_SHELL = "#2b2e34";
export const BLANK_SHELL = "#3a3d44";

export function shellOf(cart: Pick<Cartridge, "id" | "color" | "home">): string {
  if (cart.color) return cart.color;
  if (cart.home) return HOME_SHELL;
  const sum = [...(cart.id || "x")].reduce((a, c) => a + c.charCodeAt(0), 0);
  return SHELLS[sum % SHELLS.length].hex;
}

/** Text and line colours that read on a given plastic. */
export function inkFor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
  return light
    ? { text: "#18191c", muted: "rgba(0,0,0,.58)", track: "rgba(0,0,0,.16)", fill: "rgba(0,0,0,.62)", ridge: "rgba(0,0,0,.22)", light }
    : { text: "#f3f4f6", muted: "rgba(255,255,255,.64)", track: "rgba(255,255,255,.14)", fill: "rgba(255,255,255,.78)", ridge: "rgba(0,0,0,.38)", light };
}

const CHAMFER = 16;
const BEVEL = 4;

// ---- the cartridge card ---------------------------------------------------------------------------------

export type CardProps = {
  name: string;
  shell: string;
  art?: string | null;
  /** Right side of the label strip, e.g. "USB 3". */
  tag?: ReactNode;
  /** A blank drive (no label yet), or the machine's own storage (no connector, power light). */
  kind?: "cartridge" | "blank" | "home";
  /** Free space line and bar; omitted when free is undefined. */
  free?: number;
  total?: number;
  children?: ReactNode;
  width?: number | string;
  labelHeight?: number;
};

export function CartridgeCard({
  name,
  shell,
  art,
  tag,
  kind = "cartridge",
  free,
  total,
  children,
  width = "100%",
  labelHeight = 104,
}: CardProps) {
  const ink = inkFor(shell);
  const removable = kind !== "home";
  const clip = removable
    ? `polygon(${BEVEL}px 0, calc(100% - ${CHAMFER}px) 0, 100% ${CHAMFER}px, 100% calc(100% - ${BEVEL}px), calc(100% - ${BEVEL}px) 100%, ${BEVEL}px 100%, 0 calc(100% - ${BEVEL}px), 0 ${BEVEL}px)`
    : undefined;
  return (
    <div style={{ width, filter: "drop-shadow(0 4px 10px rgba(0,0,0,.45))" }}>
      <div
        style={{
          position: "relative",
          background: `linear-gradient(180deg, rgba(255,255,255,${ink.light ? 0.16 : 0.07}), rgba(255,255,255,0) 40%, rgba(0,0,0,.14)), ${shell}`,
          clipPath: clip,
          borderRadius: removable ? 0 : 8,
          color: ink.text,
          padding: "18px 10px 0",
        }}
      >
        {/* grip ridges */}
        <div
          style={{
            position: "absolute",
            top: 5,
            left: 12,
            width: "34%",
            height: 8,
            background: `repeating-linear-gradient(180deg, ${ink.ridge} 0 1.5px, transparent 1.5px 3.2px)`,
            borderRadius: 1,
          }}
        />
        {kind === "home" && (
          <div
            style={{ position: "absolute", top: 6, right: 12, width: 6, height: 6, borderRadius: 3, background: "#6ee7c8", boxShadow: "0 0 6px #6ee7c8" }}
          />
        )}
        <Label name={name} art={art} tag={tag} kind={kind} height={labelHeight} />
        {free !== undefined && total !== undefined && (
          <div style={{ marginTop: 9 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: ink.muted, fontVariantNumeric: "tabular-nums" }}>
              <span>
                <b style={{ color: ink.text, fontWeight: 700 }}>{gb(free)}</b> free
              </span>
              <span>of {gb(total)}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: ink.track, marginTop: 5, overflow: "hidden" }}>
              <div
                style={{ height: 4, width: `${total ? Math.min(100, ((total - free) / total) * 100) : 0}%`, background: ink.fill, borderRadius: 2 }}
              />
            </div>
          </div>
        )}
        {children && <div style={{ marginTop: 10 }}>{children}</div>}
        {removable ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
            <div
              style={{
                width: "62%",
                height: 7,
                background: "rgba(0,0,0,.55)",
                borderRadius: "2px 2px 0 0",
                padding: "2px 4px 0",
                boxSizing: "border-box",
              }}
            >
              <div style={{ height: "100%", background: "repeating-linear-gradient(90deg, #c9a450 0 2.5px, transparent 2.5px 5px)" }} />
            </div>
          </div>
        ) : (
          <div style={{ height: 10 }} />
        )}
      </div>
    </div>
  );
}

function Label({
  name,
  art,
  tag,
  kind,
  height,
}: {
  name: string;
  art?: string | null;
  tag?: ReactNode;
  kind: CardProps["kind"];
  height: number;
}) {
  if (kind === "blank") {
    return (
      <div
        style={{
          height: height + 28,
          borderRadius: 5,
          border: "1.5px dashed rgba(255,255,255,.3)",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          color: "rgba(255,255,255,.7)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.16em" }}>NO LABEL</div>
        {tag && <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>{tag}</div>}
      </div>
    );
  }
  return (
    <div style={{ borderRadius: 5, overflow: "hidden", background: "#efe9dd", boxShadow: "0 0 0 1px rgba(0,0,0,.28), 0 1px 0 rgba(255,255,255,.12)" }}>
      {art && (
        <div style={{ height, background: "#111", overflow: "hidden" }}>
          <img src={art} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
      <div style={{ height: art ? 28 : 36, display: "flex", alignItems: "center", gap: 8, padding: "0 9px", color: "#17181b" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: art ? 14 : 16,
            fontWeight: 800,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name || "Untitled"}
        </div>
        {tag && <div style={{ flex: "none", fontSize: 11, fontWeight: 700, color: "rgba(0,0,0,.5)", letterSpacing: "0.04em" }}>{tag}</div>}
      </div>
    </div>
  );
}

export function gb(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "…";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e11) return `${Math.round(bytes / 1e9)} GB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

// ---- small pieces ---------------------------------------------------------------------------------------

/** A cartridge as a small icon in its shell colour, for lists. */
export function CartGlyph({ shell, home, size = 22 }: { shell: string; home?: boolean; size?: number }) {
  if (home) {
    return (
      <svg width={size} height={size * 1.27} viewBox="0 0 22 28" style={{ flex: "none" }}>
        <rect x="1" y="6" width="20" height="16" rx="2.5" fill={HOME_SHELL} stroke="rgba(255,255,255,.25)" />
        <rect x="6" y="9" width="10" height="2" rx="1" fill="#0c0d0f" />
        <circle cx="5" cy="17" r="1.3" fill="#6ee7c8" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size * 1.27} viewBox="0 0 22 28" style={{ flex: "none" }}>
      <path d="M2 0.5 H17.5 L21.5 4.5 V26.5 Q21.5 27.5 20.5 27.5 H1.5 Q0.5 27.5 0.5 26.5 V2 Q0.5 0.5 2 0.5 Z" fill={shell} stroke="rgba(0,0,0,.35)" />
      <rect x="3" y="5" width="16" height="15" rx="1.5" fill="#efe9dd" />
      <rect x="3" y="5" width="16" height="10" rx="1.5" fill="rgba(0,0,0,.28)" />
      <rect x="5" y="23.5" width="12" height="4" fill="#c9a450" opacity="0.9" />
    </svg>
  );
}

/** A game's box art, focusable. */
export function GameTile({ art, title, onActivate, note }: { art: string | null; title: string; onActivate?: () => void; note?: string }) {
  return (
    <Focusable className="gc-tile" onActivate={onActivate} onClick={onActivate}>
      {art ? <img src={art} /> : <div className="gc-tile-name">{title}</div>}
      {note && <div className="gc-tile-note">{note}</div>}
    </Focusable>
  );
}

export function Swatches({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <Focusable style={{ display: "flex", gap: 10, flexWrap: "wrap" }} flow-children="right">
      {SHELLS.map((s) => (
        <Focusable
          key={s.hex}
          className={`gc-swatch${value === s.hex ? " gc-swatch-on" : ""}`}
          onActivate={() => onChange(s.hex)}
          onClick={() => onChange(s.hex)}
          style={{ background: s.hex }}
        >
          <span />
        </Focusable>
      ))}
    </Focusable>
  );
}

export const shellName = (hex: string) => SHELLS.find((s) => s.hex === hex)?.name ?? "Custom";

export const KIT_CSS = `
.gc-games { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.gc-tile { position: relative; aspect-ratio: 2 / 3; border-radius: 4px; overflow: hidden; background: rgba(0,0,0,.35);
  box-shadow: 0 1px 3px rgba(0,0,0,.45); transition: transform .12s ease, box-shadow .12s ease; }
.gc-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gc-tile.gpfocus { transform: scale(1.06); z-index: 1; box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(0,0,0,.55), 0 8px 16px rgba(0,0,0,.5); }
.gc-tile-name { position: absolute; inset: 0; padding: 5px; display: flex; align-items: flex-end; font-size: 10px;
  font-weight: 700; line-height: 1.15; color: #e8e9eb; background: #2a2d33; }
.gc-tile-note { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 4px; background: rgba(0,0,0,.78); color: #fff;
  font-size: 9px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
.gc-swatch { width: 28px; height: 28px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.35), inset 0 2px 2px rgba(255,255,255,.2); }
.gc-swatch-on { box-shadow: inset 0 0 0 1px rgba(0,0,0,.35), 0 0 0 2px #1b1d22, 0 0 0 4px #c7cbd1; }
.gc-swatch.gpfocus { box-shadow: 0 0 0 2px #1b1d22, 0 0 0 4px #fff; transform: scale(1.1); }
.gc-actions { display: flex; gap: 8px; margin-top: 10px; }
.gc-actions > .DialogButton { flex: 1; min-width: 0 !important; height: 34px; padding: 0 8px; }
`;

export const progressTrack: CSSProperties = { height: 4, borderRadius: 2, background: "rgba(255,255,255,.12)", overflow: "hidden" };
