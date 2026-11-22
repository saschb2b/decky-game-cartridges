import { toaster, useQuickAccessVisible } from "@decky/api";
import { DialogButton, Focusable, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { useState } from "react";
import { cancelJob, Cartridge, Drive, installAgent, Job, State } from "./api";
import { CartArt, muted, speedText } from "./components";
import { ArtTile, CartridgeArt, Cells, Legend, KIT_CSS, Readout, Seg, sizeParts, VFD } from "./kit";
import { CartridgeModal, FormatModal, GameModal, doEject } from "./modals";
import { portraitURL } from "./steam";
import { errorText, fmtBytes, refresh, useCartridgeState } from "./store";

// ---- the background service -----------------------------------------------------------------------------

function ServiceNotice({ state }: { state: State }) {
  const [busy, setBusy] = useState(false);
  const { agent } = state;
  const outdated = agent.installed && (agent.version ?? 1) < (agent.bundled ?? 1);
  if (agent.installed && agent.running && !outdated) return null;
  const [title, text] = !agent.installed
    ? ["Service not installed", "Cartridge games won't appear in Steam until the cartridge service runs."]
    : outdated
      ? [`Service v${agent.version} → v${agent.bundled}`, "This plugin brings a newer cartridge service."]
      : ["Service stopped", "Cartridge games won't appear or hide until it runs again."];
  return (
    <PanelSection>
      <PanelSectionRow>
        <Readout>
          <Legend color={VFD.amber}>{title}</Legend>
          <div style={{ color: "#e9d9bf", fontSize: 12, lineHeight: 1.4, marginTop: 4 }}>{text}</div>
        </Readout>
      </PanelSectionRow>
      <PanelSectionRow>
        <DialogButton
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

export const VERBS: Record<Job["kind"], [string, string]> = {
  copy: ["Copying", "Copied"],
  move: ["Moving", "Moved"],
  remove: ["Removing", "Removed"],
  format: ["Formatting", "Formatted"],
};

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function TransferReadout({ job }: { job: Job }) {
  const running = job.state === "running" || job.state === "queued";
  const failed = job.state === "failed";
  const [doing, did] = VERBS[job.kind];
  const copying = running && job.total > 0 && job.message === "Copying files";
  const pct = job.state === "done" ? 100 : copying ? Math.min(99, Math.floor((job.done / job.total) * 100)) : 0;
  const color = failed ? VFD.amber : VFD.lit;
  const route =
    job.kind === "remove" ? `from ${job.src_name}` : job.kind === "format" ? `${job.src_name}` : `${job.src_name} → ${job.dst_name}`;
  const left = copying && job.rate ? (job.total - job.done) / job.rate : null;
  const status = failed ? job.error : copying ? `${fmtBytes(job.done)} / ${fmtBytes(job.total)}` : job.message;
  return (
    <PanelSectionRow>
      <Readout>
        <div style={{ display: "flex", alignItems: "center", minHeight: 20 }}>
          <Legend color={color} style={{ flex: 1 }}>
            {failed ? `${doing} failed` : job.state === "done" ? did : job.state === "queued" ? "Queued" : doing}
          </Legend>
          {(copying || job.state === "done") && (
            <>
              <Seg text={String(pct).padStart(2, " ")} height={20} color={color} />
              <Legend color={color} style={{ marginLeft: 3, alignSelf: "flex-end" }}>
                %
              </Legend>
            </>
          )}
        </div>
        <div
          style={{
            color,
            fontSize: 14,
            fontWeight: 600,
            margin: "6px 0 2px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {job.subject ?? job.title}
        </div>
        <Legend>{route}</Legend>
        <div style={{ margin: "8px 0 6px" }}>
          <Cells fraction={pct / 100} cells={28} color={color} height={5} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Legend style={{ flex: 1, letterSpacing: "0.08em", lineHeight: 1.4 }}>{running && !copying ? `${status}…` : status}</Legend>
          {copying && job.rate ? (
            <Legend style={{ letterSpacing: "0.08em" }}>
              {fmtBytes(job.rate)}/s · {left !== null ? clock(left) : "--:--"}
            </Legend>
          ) : null}
        </div>
      </Readout>
      {running && job.kind !== "format" && (
        <div style={{ marginTop: 6 }}>
          <DialogButton style={{ height: 30, padding: 0 }} onClick={() => cancelJob(job.id).then(refresh)}>
            Cancel
          </DialogButton>
        </div>
      )}
    </PanelSectionRow>
  );
}

// ---- a cartridge ----------------------------------------------------------------------------------------

function CartridgeBlock({ cart, jobs, first }: { cart: Cartridge; jobs: Job[]; first?: boolean }) {
  const [free, unit] = sizeParts(cart.free);
  const slow = !!cart.speed && cart.speed <= 480;
  const subtitle = cart.home ? "Internal storage" : [speedText(cart.speed), cart.model].filter(Boolean).join(" · ");
  return (
    <PanelSection>
      <PanelSectionRow>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginTop: first ? 0 : 18 }}>
          <div style={{ paddingTop: cart.home ? 10 : 2 }}>
            <CartArt cart={cart} width={70} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {cart.name}
            </div>
            <div style={{ ...muted, fontSize: 11, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {subtitle}
            </div>
            <Readout style={{ marginTop: 8, padding: "7px 9px" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
                <Seg text={free} height={19} />
                <Legend style={{ marginBottom: 1 }}>{unit} free</Legend>
                <div style={{ flex: 1 }} />
                <Legend style={{ marginBottom: 1 }}>
                  {cart.games.length} {cart.games.length === 1 ? "game" : "games"}
                </Legend>
              </div>
              <div style={{ marginTop: 7 }}>
                <Cells fraction={cart.total ? (cart.total - cart.free) / cart.total : 0} cells={20} height={4} />
              </div>
            </Readout>
          </div>
        </div>
      </PanelSectionRow>
      {slow && (
        <PanelSectionRow>
          <Readout style={{ padding: "6px 9px" }}>
            <Legend color={VFD.amber}>USB 2 port · 480 Mb/s</Legend>
            <div style={{ color: "#e9d9bf", fontSize: 12, marginTop: 3, lineHeight: 1.35 }}>
              Games load very slowly here. Plug the cartridge into a USB 3 port (blue, teal or USB-C).
            </div>
          </Readout>
        </PanelSectionRow>
      )}
      {cart.games.length > 0 ? (
        <PanelSectionRow>
          <Focusable style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px 9px", padding: "4px 0 2px" }}>
            {cart.games.map((game) => {
              const job = jobs.find((j) => j.game === game.id && (j.state === "running" || j.state === "queued"));
              const pct = job && job.total ? Math.floor((job.done / job.total) * 100) : null;
              return (
                <ArtTile
                  key={game.id}
                  art={portraitURL(game.appid)}
                  title={game.title}
                  dim={!game.present}
                  caption={fmtBytes(game.size)}
                  badge={job ? `${VERBS[job.kind][0]}${pct !== null ? ` ${pct}%` : ""}` : !game.present ? "Files missing" : undefined}
                  onActivate={() => showModal(<GameModal gameId={game.id} from={cart.mount} />)}
                />
              );
            })}
          </Focusable>
        </PanelSectionRow>
      ) : (
        <PanelSectionRow>
          <div style={{ ...muted, lineHeight: 1.4, padding: "2px 0" }}>
            {cart.home
              ? "Games moved here play without a cartridge plugged in."
              : "Empty. Copy games here from another cartridge or from This PC."}
          </div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <Focusable className="gc-btn-row" flow-children="right" style={{ marginTop: 4 }}>
          <DialogButton style={{ height: 32 }} onClick={() => showModal(<CartridgeModal mount={cart.mount} />)}>
            Manage
          </DialogButton>
          {!cart.home && (
            <DialogButton style={{ height: 32 }} onClick={() => doEject(cart)}>
              Eject
            </DialogButton>
          )}
        </Focusable>
      </PanelSectionRow>
    </PanelSection>
  );
}

// ---- a drive that is not a cartridge yet ----------------------------------------------------------------

function BlankBlock({ drive }: { drive: Drive }) {
  const [size, unit] = sizeParts(drive.size);
  const used = drive.partitions.filter((p) => p.fstype);
  return (
    <PanelSection>
      <PanelSectionRow>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginTop: 18 }}>
          <CartridgeArt name="" shell="#3b3f47" blank width={62} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.15 }}>Blank drive</div>
            <div style={{ ...muted, fontSize: 11, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[drive.model, speedText(drive.speed)].filter(Boolean).join(" · ")}
            </div>
            <Readout style={{ marginTop: 8, padding: "7px 9px" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
                <Seg text={size} height={19} />
                <Legend style={{ marginBottom: 1 }}>{unit}</Legend>
              </div>
              <Legend style={{ display: "block", marginTop: 6, letterSpacing: "0.08em" }}>
                {used.length ? `Has data: ${used.map((p) => p.label || p.fstype).join(", ")}` : "No partitions"}
              </Legend>
            </Readout>
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <DialogButton style={{ height: 32, marginTop: 4 }} onClick={() => showModal(<FormatModal drive={drive} />)}>
          Make cartridge…
        </DialogButton>
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
          <Readout>
            <Legend>Reading cartridges…</Legend>
          </Readout>
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
      <style>{KIT_CSS}</style>
      <ServiceNotice state={state} />
      {jobs.length > 0 && (
        <PanelSection>
          {jobs.map((job) => (
            <TransferReadout key={job.id} job={job} />
          ))}
        </PanelSection>
      )}
      {usb.map((cart, i) => (
        <CartridgeBlock key={cart.mount} cart={cart} jobs={state.jobs} first={i === 0 && jobs.length === 0} />
      ))}
      {state.drives.map((drive) => (
        <BlankBlock key={drive.dev} drive={drive} />
      ))}
      {usb.length === 0 && state.drives.length === 0 && (
        <PanelSection>
          <PanelSectionRow>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <CartridgeArt name="" shell="#30343b" blank width={44} style={{ opacity: 0.6 }} />
              <div style={{ ...muted, lineHeight: 1.4 }}>Plug in a cartridge, or a blank USB drive to make one.</div>
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}
      {home && <CartridgeBlock cart={home} jobs={state.jobs} />}
    </>
  );
}
