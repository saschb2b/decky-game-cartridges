import { toaster, useQuickAccessVisible } from "@decky/api";
import { ButtonItem, DialogButton, Focusable, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { FaArrowRight, FaCheck, FaCopy, FaExclamationTriangle, FaHdd, FaTrash } from "react-icons/fa";
import { useState } from "react";
import { cancelJob, Cartridge, installAgent, Job, State } from "./api";
import { Cover, GameArt, Meter, muted, SpeedWarning, useCover } from "./components";
import { CartridgeModal, FormatModal, GameModal } from "./modals";
import { errorText, fmtBytes, refresh, useCartridgeState } from "./store";

function AgentRow({ state }: { state: State }) {
  const [busy, setBusy] = useState(false);
  const { agent } = state;
  const outdated = agent.installed && (agent.version ?? 1) < (agent.bundled ?? 1);
  if (agent.installed && agent.running && !outdated) return null;
  const text = !agent.installed
    ? "The cartridge service is not installed: cartridge games won't appear in Steam."
    : outdated
      ? `The cartridge service is version ${agent.version}; this plugin brings version ${agent.bundled}.`
      : "The cartridge service is not running.";
  return (
    <PanelSection title="Cartridge service">
      <PanelSectionRow>
        <div style={{ ...muted, color: "#ffb347" }}>{text}</div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await installAgent();
              toaster.toast({ title: "Game Cartridges", body: "Cartridge service installed" });
            } catch (e) {
              toaster.toast({ title: "Could not install the service", body: errorText(e) });
            }
            setBusy(false);
            refresh();
          }}
        >
          {!agent.installed ? "Install" : outdated ? "Update" : "Start"}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

const VERB: Record<Job["kind"], [string, string]> = {
  copy: ["Copying", "Copied"],
  move: ["Moving", "Moved"],
  remove: ["Removing", "Removed"],
  format: ["Formatting", "Ready"],
};

function duration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

/** One running (or just finished) job as a compact card: what, from where to where, how far, how long. */
function JobCard({ job }: { job: Job }) {
  const running = job.state === "running" || job.state === "queued";
  const failed = job.state === "failed";
  const finished = job.state === "done";
  const [doing, did] = VERB[job.kind];
  const copying = running && job.total > 0 && job.message === "Copying files";
  const pct = finished ? 100 : copying ? Math.min(100, Math.floor((job.done / job.total) * 100)) : undefined;
  const route =
    job.kind === "remove" ? `from ${job.src_name}` : job.kind === "format" ? job.src_name : `${job.src_name} → ${job.dst_name}`;
  let status: string;
  if (failed) status = job.error ?? "Failed";
  else if (finished) status = job.message;
  else if (job.state === "queued") status = "Waiting for the job before it";
  else if (copying) {
    const left = job.rate ? (job.total - job.done) / job.rate : null;
    status = `${fmtBytes(job.done)} of ${fmtBytes(job.total)}`;
    if (job.rate) status += ` · ${fmtBytes(job.rate)}/s`;
    if (left !== null) status += ` · ${duration(left)} left`;
  } else status = `${job.message}…`;
  const accent = failed ? "#e35d5b" : finished ? "#5ba32b" : "#1a9fff";
  const Icon = failed ? FaExclamationTriangle : finished ? FaCheck : { copy: FaCopy, move: FaArrowRight, remove: FaTrash, format: FaHdd }[job.kind];
  return (
    <PanelSectionRow>
      <Focusable
        style={{
          background: "rgba(255,255,255,.05)",
          borderLeft: `3px solid ${accent}`,
          borderRadius: 4,
          padding: "8px 10px",
          margin: "4px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: accent }}>
          <Icon size={11} />
          <span style={{ flex: 1 }}>{failed ? `${doing} failed` : finished ? did : doing}</span>
          {pct !== undefined && !finished && <span style={{ color: "#dcdedf", fontSize: 12 }}>{pct}%</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, margin: "4px 0 1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {job.subject ?? job.title}
        </div>
        <div style={{ ...muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{route}</div>
        {!failed && (
          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,.12)", margin: "8px 0 6px", overflow: "hidden" }}>
            <div
              className={pct === undefined ? "gc-indeterminate" : undefined}
              style={{
                height: 4,
                borderRadius: 2,
                background: accent,
                width: pct === undefined ? "30%" : `${pct}%`,
                transition: "width .8s linear",
              }}
            />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...muted, flex: 1, color: failed ? "#e88" : muted.color, lineHeight: 1.3, marginTop: failed ? 6 : 0 }}>{status}</div>
          {running && job.kind !== "format" && (
            <DialogButton
              style={{ minWidth: 0, width: "auto", padding: "2px 12px", fontSize: 12, height: 26, lineHeight: "22px" }}
              onClick={() => cancelJob(job.id).then(refresh)}
            >
              Cancel
            </DialogButton>
          )}
        </div>
      </Focusable>
    </PanelSectionRow>
  );
}

const INDETERMINATE_CSS = `@keyframes gc-slide { from { margin-left: -30%; } to { margin-left: 100%; } }
.gc-indeterminate { animation: gc-slide 1.4s ease-in-out infinite; }`;

function CartridgeSection({ cart }: { cart: Cartridge }) {
  const cover = useCover(cart);
  const used = cart.total - cart.free;
  return (
    <PanelSection title={cart.home ? `${cart.name} · internal` : cart.name}>
      <PanelSectionRow>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: 4 }}>
          <Cover cart={cart} url={cover} width={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              {fmtBytes(cart.free)} free of {fmtBytes(cart.total)}
            </div>
            <Meter used={used} total={cart.total} />
            <div style={{ ...muted, marginTop: 4 }}>
              {cart.games.length
                ? `${cart.games.length} game${cart.games.length === 1 ? "" : "s"}`
                : cart.home
                  ? "Move games here from a cartridge to play them without it."
                  : "No games yet: copy some from another cartridge."}
            </div>
            <SpeedWarning cart={cart} />
          </div>
        </div>
      </PanelSectionRow>
      {cart.games.map((game) => (
        <PanelSectionRow key={game.id}>
          <ButtonItem layout="below" onClick={() => showModal(<GameModal gameId={game.id} from={cart.mount} />)}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", textAlign: "left" }}>
              <GameArt mount={cart.mount} id={game.id} appid={game.appid} width={28} />
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div style={{ fontSize: 14 }}>{game.title}</div>
                <div style={{ ...muted, marginTop: 2 }}>
                  {fmtBytes(game.size)}
                  {game.present ? "" : " · files missing"}
                </div>
              </div>
            </div>
          </ButtonItem>
        </PanelSectionRow>
      ))}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => showModal(<CartridgeModal mount={cart.mount} />)}>
          {cart.home ? "Manage internal cartridge…" : "Manage cartridge…"}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export function QuickPanel() {
  const visible = useQuickAccessVisible();
  const state = useCartridgeState(visible ? 4000 : 0);
  if (!state) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <div style={muted}>Loading…</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }
  const usb = state.cartridges.filter((c) => !c.home);
  const home = state.cartridges.find((c) => c.home);
  // Running jobs, plus finished ones for a little while (failures longer, so the reason can be read).
  const jobs = state.jobs.filter(
    (j) => j.age === null || (j.state === "failed" ? j.age < 600 : j.state !== "cancelled" && j.age < 20),
  );
  return (
    <>
      <AgentRow state={state} />
      {jobs.length > 0 && (
        <PanelSection title="In progress">
          <style>{INDETERMINATE_CSS}</style>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </PanelSection>
      )}
      {usb.map((cart) => (
        <CartridgeSection key={cart.mount} cart={cart} />
      ))}
      {usb.length === 0 && (
        <PanelSection title="Cartridges">
          <PanelSectionRow>
            <div style={muted}>No cartridge plugged in.</div>
          </PanelSectionRow>
        </PanelSection>
      )}
      {home && (home.games.length > 0 || usb.length > 0) && <CartridgeSection cart={home} />}
      <PanelSection title="New cartridge">
        {state.drives.map((drive) => (
          <PanelSectionRow key={drive.dev}>
            <ButtonItem
              layout="below"
              onClick={() => showModal(<FormatModal drive={drive} />)}
              description={`${fmtBytes(drive.size)} · ${
                drive.partitions.length
                  ? drive.partitions.map((p) => p.label || p.fstype || p.name).join(", ")
                  : "empty"
              }${drive.speed !== null && drive.speed <= 480 ? " · USB 2 port" : ""}`}
            >
              Make "{drive.model}" a cartridge…
            </ButtonItem>
          </PanelSectionRow>
        ))}
        {state.drives.length === 0 && (
          <PanelSectionRow>
            <div style={muted}>Plug in a USB drive to make it a cartridge. It gets erased.</div>
          </PanelSectionRow>
        )}
      </PanelSection>
    </>
  );
}
