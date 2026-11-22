import { toaster, useQuickAccessVisible } from "@decky/api";
import { DialogButton, Focusable, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { ReactNode, useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { cancelJob, Cartridge, Drive, installAgent, Job, State } from "./api";
import { CartCard, muted } from "./components";
import { BLANK_SHELL, CartridgeCard, gb, GameTile, inkFor, KIT_CSS, progressTrack, shellOf } from "./kit";
import { CartridgeModal, FormatModal, GameModal, doEject } from "./modals";
import { portraitURL } from "./steam";
import { errorText, fmtBytes, refresh, useCartridgeState } from "./store";

const AMBER = "#f0b357";

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.4, color: "#dcdedf", marginTop: 8 }}>
      <FaExclamationTriangle style={{ color: AMBER, flex: "none", marginTop: 2 }} size={12} />
      <div>{children}</div>
    </div>
  );
}

// ---- the background service -----------------------------------------------------------------------------

function ServiceNotice({ state }: { state: State }) {
  const [busy, setBusy] = useState(false);
  const { agent } = state;
  const outdated = agent.installed && (agent.version ?? 1) < (agent.bundled ?? 1);
  if (agent.installed && agent.running && !outdated) return null;
  const text = !agent.installed
    ? "The cartridge service isn't installed, so cartridge games won't appear in Steam."
    : outdated
      ? `The cartridge service is version ${agent.version}; this plugin brings version ${agent.bundled}.`
      : "The cartridge service is stopped, so games won't appear or hide.";
  return (
    <PanelSection>
      <PanelSectionRow>
        <Notice>{text}</Notice>
        <DialogButton
          style={{ marginTop: 10, height: 34 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await installAgent();
              toaster.toast({ title: "Game Cartridges", body: "Cartridge service ready" });
            } catch (e) {
              toaster.toast({ title: "Could not install the service", body: errorText(e) });
            }
            setBusy(false);
            refresh();
          }}
        >
          {!agent.installed ? "Install service" : outdated ? "Update service" : "Start service"}
        </DialogButton>
      </PanelSectionRow>
    </PanelSection>
  );
}

// ---- transfers ------------------------------------------------------------------------------------------

const VERBS: Record<Job["kind"], [string, string]> = {
  copy: ["Copying", "Copied"],
  move: ["Moving", "Moved"],
  remove: ["Removing", "Removed"],
  format: ["Making cartridge", "Cartridge ready"],
};

function timeLeft(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h} h ${m} min left`;
  if (m) return `${m} min ${String(r).padStart(2, "0")} s left`;
  return `${r} s left`;
}

function Transfer({ job, art }: { job: Job; art: string | null }) {
  const running = job.state === "running" || job.state === "queued";
  const failed = job.state === "failed";
  const [doing, did] = VERBS[job.kind];
  const copying = running && job.total > 0 && job.message === "Copying files";
  const pct = job.state === "done" ? 100 : copying ? Math.min(99, Math.floor((job.done / job.total) * 100)) : null;
  const route = job.kind === "remove" ? `from ${job.src_name}` : job.kind === "format" ? job.src_name : `${job.src_name} → ${job.dst_name}`;
  let status: string;
  if (failed) status = job.error ?? "Failed";
  else if (job.state === "done") status = job.message;
  else if (job.state === "queued") status = "Waiting for the job before it";
  else if (copying) {
    status = `${fmtBytes(job.done)} of ${fmtBytes(job.total)}`;
    if (job.rate) status += ` · ${fmtBytes(job.rate)}/s · ${timeLeft((job.total - job.done) / job.rate)}`;
  } else status = `${job.message}…`;
  return (
    <PanelSectionRow>
      <div style={{ background: "rgba(255,255,255,.05)", borderRadius: 8, padding: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {art && <img src={art} style={{ width: 34, aspectRatio: "2 / 3", objectFit: "cover", borderRadius: 3, flex: "none" }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...muted, color: failed ? AMBER : muted.color }}>{failed ? `${doing} failed` : job.state === "done" ? did : doing}</div>
            <div
              style={{ fontSize: 14, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}
            >
              {job.subject ?? job.title}
            </div>
            <div style={{ ...muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{route}</div>
          </div>
          {pct !== null && <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{pct}%</div>}
        </div>
        {!failed && (
          <div style={{ ...progressTrack, marginTop: 10 }}>
            <div
              style={{
                height: "100%",
                width: pct === null ? "35%" : `${pct}%`,
                background: job.state === "done" ? "#5ba32b" : "#1a9fff",
                borderRadius: 2,
                transition: "width .8s linear",
                animation: pct === null ? "gc-slide 1.4s ease-in-out infinite" : undefined,
              }}
            />
          </div>
        )}
        <div style={{ ...muted, marginTop: 7, color: failed ? "#e8a6a0" : muted.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.4 }}>
          {status}
        </div>
        {running && job.kind !== "format" && (
          <DialogButton style={{ marginTop: 10, height: 32, padding: 0 }} onClick={() => cancelJob(job.id).then(refresh)}>
            Cancel
          </DialogButton>
        )}
      </div>
    </PanelSectionRow>
  );
}

// ---- a cartridge ----------------------------------------------------------------------------------------

function CartridgeBlock({ cart, jobs }: { cart: Cartridge; jobs: Job[] }) {
  const ink = inkFor(shellOf(cart));
  const slow = !!cart.speed && cart.speed <= 480;
  return (
    <PanelSection>
      <PanelSectionRow>
        <CartCard cart={cart}>
          {cart.games.length ? (
            <Focusable className="gc-games">
              {cart.games.map((game) => {
                const job = jobs.find((j) => j.game === game.id && (j.state === "running" || j.state === "queued"));
                const pct = job && job.total ? `${Math.floor((job.done / job.total) * 100)}%` : job ? "…" : undefined;
                return (
                  <GameTile
                    key={game.id}
                    art={portraitURL(game.appid)}
                    title={game.title}
                    note={pct ?? (!game.present ? "Missing" : undefined)}
                    onActivate={() => showModal(<GameModal gameId={game.id} from={cart.mount} />)}
                  />
                );
              })}
            </Focusable>
          ) : (
            <div style={{ fontSize: 12, color: ink.muted, lineHeight: 1.4 }}>
              {cart.home ? "No games here yet. Games moved here play without a cartridge." : "No games yet. Copy some here from another cartridge or This PC."}
            </div>
          )}
        </CartCard>
        {slow && <Notice>This port runs at USB 2 speed (480 Mb/s), so games load very slowly. Use a blue, teal or USB-C port.</Notice>}
        <Focusable className="gc-actions" flow-children="right">
          <DialogButton onClick={() => showModal(<CartridgeModal mount={cart.mount} />)}>Manage</DialogButton>
          {!cart.home && <DialogButton onClick={() => doEject(cart)}>Eject</DialogButton>}
        </Focusable>
      </PanelSectionRow>
    </PanelSection>
  );
}

function BlankBlock({ drive }: { drive: Drive }) {
  const data = drive.partitions.filter((p) => p.fstype);
  return (
    <PanelSection>
      <PanelSectionRow>
        <CartridgeCard name="" shell={BLANK_SHELL} kind="blank" tag={`${gb(drive.size)} · ${drive.model}`} labelHeight={60} />
        <div style={{ ...muted, marginTop: 8, lineHeight: 1.4 }}>
          {data.length ? `Not a cartridge yet. Holds ${data.map((p) => p.label || p.fstype).join(", ")}.` : "Not a cartridge yet. Empty."}
        </div>
        <Focusable className="gc-actions" flow-children="right">
          <DialogButton onClick={() => showModal(<FormatModal drive={drive} />)}>Make cartridge…</DialogButton>
        </Focusable>
      </PanelSectionRow>
    </PanelSection>
  );
}

// ---- the panel ------------------------------------------------------------------------------------------

export function QuickPanel() {
  const visible = useQuickAccessVisible();
  const state = useCartridgeState(visible ? 4000 : 0);
  if (!state) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <div style={muted}>Reading cartridges…</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }
  const usb = state.cartridges.filter((c) => !c.home);
  const home = state.cartridges.find((c) => c.home);
  // Running jobs, plus finished ones for a little while (failures longer, so the reason can be read).
  const jobs = state.jobs.filter((j) => j.age === null || (j.state === "failed" ? j.age < 600 : j.state !== "cancelled" && j.age < 20));
  const artFor = (job: Job) => {
    const game = state.cartridges.flatMap((c) => c.games).find((g) => g.id === job.game);
    return game ? portraitURL(game.appid) : null;
  };
  return (
    <>
      <style>{KIT_CSS + "@keyframes gc-slide { from { margin-left: -35%; } to { margin-left: 100%; } }"}</style>
      <ServiceNotice state={state} />
      {jobs.length > 0 && (
        <PanelSection>
          {jobs.map((job) => (
            <Transfer key={job.id} job={job} art={artFor(job)} />
          ))}
        </PanelSection>
      )}
      {usb.map((cart) => (
        <CartridgeBlock key={cart.mount} cart={cart} jobs={state.jobs} />
      ))}
      {state.drives.map((drive) => (
        <BlankBlock key={drive.dev} drive={drive} />
      ))}
      {usb.length === 0 && state.drives.length === 0 && (
        <PanelSection>
          <PanelSectionRow>
            <div style={{ ...muted, lineHeight: 1.4 }}>No cartridge plugged in. Plug one in, or a blank USB drive to make one.</div>
          </PanelSectionRow>
        </PanelSection>
      )}
      {home && <CartridgeBlock cart={home} jobs={state.jobs} />}
    </>
  );
}
