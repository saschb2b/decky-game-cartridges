// The plugin's visual language: cartridges drawn as cartridges (grip ridges, a label sticker carrying the
// cover art, an edge connector), the machine's internal storage as a console base, numbers on an inset
// vacuum-fluorescent readout with unlit segments showing, and games as box-art tiles.
import { Focusable } from "@decky/ui";
import { CSSProperties, ReactNode, useMemo } from "react";
import type { Cartridge } from "./api";

// ---- plastics -------------------------------------------------------------------------------------------

export const SHELLS: { name: string; hex: string }[] = [
  { name: "Graphite", hex: "#2e3138" },
  { name: "Bone", hex: "#cfc8b8" },
  { name: "Ice", hex: "#8fb3c9" },
  { name: "Moss", hex: "#4f7a5b" },
  { name: "Grape", hex: "#5d4a8a" },
  { name: "Brick", hex: "#b4473b" },
  { name: "Mustard", hex: "#d1a23a" },
  { name: "Ocean", hex: "#2f5f8f" },
];

export function shellOf(cart: Pick<Cartridge, "id" | "color" | "home">): string {
  if (cart.color) return cart.color;
  if (cart.home) return "#2a2d33";
  const sum = [...(cart.id || "x")].reduce((a, c) => a + c.charCodeAt(0), 0);
  return SHELLS[sum % SHELLS.length].hex;
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---- the cartridge --------------------------------------------------------------------------------------

type CartridgeArtProps = {
  name: string;
  shell: string;
  art?: string | null;
  blank?: boolean;
  width?: number;
  style?: CSSProperties;
};

/** A cartridge, 100 x 128 units. The label sticker is HTML on top so long names and the art crop well. */
export function CartridgeArt({ name, shell, art, blank, width = 80, style }: CartridgeArtProps) {
  const id = useMemo(() => `gc${Math.round(Math.random() * 1e9)}`, []);
  const light = luminance(shell) > 0.55;
  const ink = light ? "rgba(0,0,0,.32)" : "rgba(0,0,0,.45)";
  const shine = light ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.16)";
  const pins = Array.from({ length: 20 }, (_, i) => 15.5 + i * 3.5);
  return (
    <div style={{ position: "relative", width, height: width * 1.28, flex: "none", ...style }}>
      <svg viewBox="0 0 100 128" width={width} height={width * 1.28} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={light ? 0.22 : 0.12} />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.28" />
          </linearGradient>
          <linearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f3d98b" />
            <stop offset="1" stopColor="#a8822f" />
          </linearGradient>
          <filter id={`${id}d`} x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="2.6" floodColor="#000" floodOpacity="0.55" />
          </filter>
        </defs>
        {/* body with the chamfered corner */}
        <path
          d="M5 0 H86 L100 14 V123 Q100 128 95 128 H5 Q0 128 0 123 V5 Q0 0 5 0 Z"
          fill={shell}
          filter={`url(#${id}d)`}
        />
        <path d="M5 0 H86 L100 14 V123 Q100 128 95 128 H5 Q0 128 0 123 V5 Q0 0 5 0 Z" fill={`url(#${id}s)`} />
        <path d="M5 0.7 H85.7 L99.3 14.3" fill="none" stroke={shine} strokeWidth="0.8" />
        {/* grip ridges */}
        {[4.2, 7.4, 10.6, 13.8].map((y) => (
          <g key={y}>
            <rect x="8" y={y} width="62" height="1.5" rx="0.75" fill={ink} />
            <rect x="8" y={y + 1.5} width="62" height="0.6" rx="0.3" fill={shine} />
          </g>
        ))}
        {/* label recess */}
        <rect x="7" y="19" width="86" height="90" rx="3.5" fill="#000" opacity="0.28" />
        <rect x="7.5" y="108" width="85" height="0.8" rx="0.4" fill={shine} />
        {/* insert arrow */}
        <path d="M45 112.5 H55 L50 117 Z" fill={ink} />
        <path d="M45.8 113.1 H54.2" stroke={shine} strokeWidth="0.4" />
        {/* edge connector */}
        <path d="M12 128 V121.5 Q12 120 13.5 120 H86.5 Q88 120 88 121.5 V128 Z" fill="#000" opacity="0.6" />
        {pins.map((x) => (
          <rect key={x} x={x} y="121.6" width="1.9" height="6.4" rx="0.3" fill={`url(#${id}p)`} />
        ))}
      </svg>
      {/* label sticker */}
      <div
        style={{
          position: "absolute",
          left: "9%",
          top: `${(21 / 128) * 100}%`,
          width: "82%",
          height: `${(86 / 128) * 100}%`,
          borderRadius: width * 0.025,
          overflow: "hidden",
          background: blank ? "transparent" : "#f1ece1",
          border: blank ? `${Math.max(1, width / 80)}px dashed rgba(255,255,255,.35)` : "none",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          boxShadow: blank ? "none" : "0 0 0 0.5px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.5)",
        }}
      >
        {blank ? (
          <div
            style={{
              margin: "auto",
              color: "rgba(255,255,255,.55)",
              fontSize: Math.max(8, width * 0.1),
              fontWeight: 800,
              letterSpacing: "0.18em",
            }}
          >
            BLANK
          </div>
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, background: "#1c1f24", position: "relative" }}>
              {art ? (
                <img src={art} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <LabelPattern name={name} shell={shell} size={width} />
              )}
            </div>
            {width >= 48 && <div
              style={{
                height: "21%",
                display: "flex",
                alignItems: "center",
                padding: `0 ${width * 0.05}px`,
                color: "#16171a",
                fontSize: Math.max(7, width * 0.105),
                fontWeight: 800,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1,
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
            </div>}
          </>
        )}
      </div>
    </div>
  );
}

/** Label art for a cartridge without a cover: its initial, large, on a halftone field in its shell colour. */
function LabelPattern({ name, shell, size }: { name: string; shell: string; size: number }) {
  const initial = (name.trim()[0] || "?").toUpperCase();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(rgba(255,255,255,.16) 0.9px, transparent 1.1px) 0 0 / ${Math.max(4, size / 18)}px ${Math.max(4, size / 18)}px, ${shell}`,
        display: "flex",
        alignItems: "flex-end",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: size * 0.62,
          fontWeight: 900,
          lineHeight: 0.78,
          color: "rgba(255,255,255,.9)",
          marginLeft: size * 0.04,
          marginBottom: -size * 0.02,
          letterSpacing: "-0.04em",
        }}
      >
        {initial}
      </div>
    </div>
  );
}

/** The machine's own storage: a console base with a cartridge slot and a power light. */
export function ConsoleArt({ width = 96 }: { width?: number }) {
  const id = useMemo(() => `gcb${Math.round(Math.random() * 1e9)}`, []);
  return (
    <svg viewBox="0 0 120 80" width={width} height={(width * 80) / 120} style={{ flex: "none", overflow: "visible" }}>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4f58" />
          <stop offset="1" stopColor="#33373e" />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3036" />
          <stop offset="1" stopColor="#1d2025" />
        </linearGradient>
        <filter id={`${id}d`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <radialGradient id={`${id}l`}>
          <stop offset="0" stopColor="#bdfff0" />
          <stop offset="0.5" stopColor="#5fe8cc" />
          <stop offset="1" stopColor="#5fe8cc" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g filter={`url(#${id}d)`}>
        <path d="M10 18 H110 L118 30 V72 Q118 78 112 78 H8 Q2 78 2 72 V30 Z" fill={`url(#${id}f)`} />
        <path d="M10 18 H110 L118 30 H2 Z" fill={`url(#${id}t)`} />
      </g>
      <path d="M10.4 18.6 H109.6" stroke="rgba(255,255,255,.18)" strokeWidth="0.8" />
      {/* slot */}
      <path d="M34 21 H86 L88 27 H32 Z" fill="#0b0c0e" />
      <path d="M32.6 27 H87.4" stroke="rgba(255,255,255,.12)" strokeWidth="0.6" />
      {/* vents */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={78 + i * 5.5} y="50" width="2.4" height="18" rx="1.2" fill="#000" opacity="0.45" />
      ))}
      {/* power light */}
      <circle cx="16" cy="44" r="6" fill={`url(#${id}l)`} opacity="0.7" />
      <circle cx="16" cy="44" r="1.8" fill="#c9fff2" />
    </svg>
  );
}

// ---- the readout ----------------------------------------------------------------------------------------

export const VFD = { lit: "#6ef2d6", dim: "rgba(110,242,214,.58)", ghost: "rgba(110,242,214,.075)", amber: "#ffb547" };

const SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
  "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "",
};

function segmentPaths(w: number, h: number, t: number) {
  const g = t * 0.18;
  const x0 = t / 2, x1 = w - t / 2, y0 = t / 2, ym = h / 2, y1 = h - t / 2, s = t / 2;
  const hz = (y: number, a: number, b: number) =>
    `M${a},${y} L${a + s},${y - s} L${b - s},${y - s} L${b},${y} L${b - s},${y + s} L${a + s},${y + s} Z`;
  const vt = (x: number, a: number, b: number) =>
    `M${x},${a} L${x + s},${a + s} L${x + s},${b - s} L${x},${b} L${x - s},${b - s} L${x - s},${a + s} Z`;
  return {
    a: hz(y0, x0 + g, x1 - g), g: hz(ym, x0 + g, x1 - g), d: hz(y1, x0 + g, x1 - g),
    f: vt(x0, y0 + g, ym - g), b: vt(x1, y0 + g, ym - g), e: vt(x0, ym + g, y1 - g), c: vt(x1, ym + g, y1 - g),
  } as Record<string, string>;
}

/** Seven-segment digits with the unlit segments faintly visible, like a real display. */
export function Seg({ text, height = 22, color = VFD.lit }: { text: string; height?: number; color?: string }) {
  const w = height * 0.54, t = height * 0.13, gap = height * 0.14;
  const paths = segmentPaths(w, height, t);
  let x = 0;
  const parts: ReactNode[] = [];
  [...text].forEach((ch, i) => {
    if (ch === ".") {
      parts.push(<rect key={i} x={x - gap * 0.2} y={height - t} width={t} height={t} rx={t * 0.2} fill={color} />);
      x += t + gap * 0.5;
      return;
    }
    if (ch === ":") {
      parts.push(
        <g key={i} fill={color}>
          <rect x={x} y={height * 0.28} width={t} height={t} rx={t * 0.2} />
          <rect x={x} y={height * 0.64} width={t} height={t} rx={t * 0.2} />
        </g>,
      );
      x += t + gap;
      return;
    }
    const lit = SEGMENTS[ch] ?? "";
    parts.push(
      <g key={i} transform={`translate(${x},0)`}>
        {Object.entries(paths).map(([seg, d]) => (
          <path key={seg} d={d} fill={lit.includes(seg) ? color : VFD.ghost} />
        ))}
      </g>,
    );
    x += w + gap;
  });
  const width = Math.max(1, x - gap);
  return (
    <svg
      width={width + height * 0.12}
      height={height}
      viewBox={`0 0 ${width + height * 0.12} ${height}`}
      style={{ overflow: "visible", filter: `drop-shadow(0 0 ${height * 0.12}px ${color}66)`, flex: "none" }}
    >
      <g transform={`skewX(-6) translate(${height * 0.12},0)`}>{parts}</g>
    </svg>
  );
}

/** The inset display panel everything numeric sits on. */
export function Readout({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #081010, #0b1515)",
        borderRadius: 6,
        padding: "8px 10px",
        boxShadow: "inset 0 1px 4px rgba(0,0,0,.9), inset 0 0 0 1px rgba(255,255,255,.035), 0 1px 0 rgba(255,255,255,.06)",
        color: VFD.lit,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Small-caps legend text in the display's colour. */
export function Legend({ children, color = VFD.dim, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A row of display cells, `filled` of `cells` lit. */
export function Cells({ fraction, cells = 24, color = VFD.lit, height = 6 }: { fraction: number; cells?: number; color?: string; height?: number }) {
  const on = Math.round(Math.max(0, Math.min(1, fraction)) * cells);
  return (
    <div style={{ display: "flex", gap: 2, height }}>
      {Array.from({ length: cells }, (_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            borderRadius: 1,
            background: i < on ? color : VFD.ghost,
            boxShadow: i < on ? `0 0 4px ${color}55` : "none",
          }}
        />
      ))}
    </div>
  );
}

/** "77.1" + "GB" from bytes, sized for the readout. */
export function sizeParts(bytes: number | null | undefined): [string, string] {
  if (bytes === null || bytes === undefined) return ["--", ""];
  if (bytes >= 1e12) return [(bytes / 1e12).toFixed(2), "TB"];
  if (bytes >= 1e11) return [Math.round(bytes / 1e9).toString(), "GB"];
  if (bytes >= 1e9) return [(bytes / 1e9).toFixed(1), "GB"];
  return [Math.round(bytes / 1e6).toString(), "MB"];
}

// ---- box-art tiles --------------------------------------------------------------------------------------

export function ArtTile({
  art,
  title,
  caption,
  onActivate,
  dim,
  badge,
  width,
}: {
  art: string | null;
  title: string;
  caption?: ReactNode;
  onActivate?: () => void;
  dim?: boolean;
  badge?: ReactNode;
  width?: number | string;
}) {
  return (
    <div style={{ width, minWidth: 0 }}>
      <Focusable className="gc-tile" onActivate={onActivate} onClick={onActivate}>
        <div className="gc-tile-art" style={{ opacity: dim ? 0.45 : 1 }}>
          {art ? (
            <img src={art} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div className="gc-tile-fallback">{title}</div>
          )}
          {badge && <div className="gc-tile-badge">{badge}</div>}
        </div>
      </Focusable>
      {caption && <div className="gc-tile-caption">{caption}</div>}
    </div>
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
          <span className="gc-swatch-name">{s.name}</span>
        </Focusable>
      ))}
    </Focusable>
  );
}

export const KIT_CSS = `
.gc-tile { border-radius: 5px; transition: transform .14s ease, box-shadow .14s ease; }
.gc-tile-art { position: relative; aspect-ratio: 2 / 3; border-radius: 5px; overflow: hidden; background: #1a1d22;
  box-shadow: 0 3px 8px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.06); }
.gc-tile.gpfocus { transform: translateY(-3px) scale(1.045); box-shadow: 0 0 0 2px #fff, 0 10px 20px rgba(0,0,0,.6); }
.gc-tile-fallback { position: absolute; inset: 0; display: flex; align-items: flex-end; padding: 6px; font-size: 11px;
  font-weight: 700; line-height: 1.15; color: #dcdedf; background: #23262e; }
.gc-tile-badge { position: absolute; left: 4px; right: 4px; bottom: 4px; padding: 3px 5px; border-radius: 3px;
  background: rgba(8,16,16,.88); color: ${VFD.lit}; font-size: 9px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; text-align: center; }
.gc-tile-caption { margin-top: 5px; font-size: 11px; color: #8b929a; font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gc-swatch { position: relative; width: 30px; height: 30px; border-radius: 50%;
  box-shadow: inset 0 2px 3px rgba(255,255,255,.25), inset 0 -3px 4px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.5); }
.gc-swatch-on { box-shadow: inset 0 2px 3px rgba(255,255,255,.25), inset 0 -3px 4px rgba(0,0,0,.35), 0 0 0 2px #1a1d22, 0 0 0 4px #dcdedf; }
.gc-swatch.gpfocus { box-shadow: 0 0 0 2px #1a1d22, 0 0 0 4px #fff, 0 0 12px rgba(255,255,255,.4); transform: scale(1.08); }
.gc-swatch-name { position: absolute; top: 36px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #dcdedf;
  white-space: nowrap; opacity: 0; pointer-events: none; }
.gc-swatch.gpfocus .gc-swatch-name, .gc-swatch-on .gc-swatch-name { opacity: 1; }
.gc-btn-row { display: flex; gap: 8px; }
.gc-btn-row > .DialogButton { min-width: 0 !important; flex: 1; padding: 0 8px; }
`;
