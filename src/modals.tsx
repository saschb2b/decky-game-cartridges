import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { ConfirmModal, DialogButton, Focusable, ModalRoot, showModal, TextField } from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useState } from "react";
import {
  Cartridge,
  copyGame,
  Drive,
  eject,
  formatDrive,
  Holder,
  readImage,
  removeGame,
  renameCartridge,
  setColor,
  setCover,
  setSteamLibrary,
  State,
} from "./api";
import { CartArt, muted, sectionLabel, speedText, useCover } from "./components";
import { CartridgeArt, ConsoleArt, KIT_CSS, Legend, Readout, Seg, SHELLS, shellOf, sizeParts, Swatches, VFD } from "./kit";
import { addSteamLibrary, coverFromImage, folderOn, moveSteamGame, overview, portraitURL, SteamFolder, steamFolders } from "./steam";
import { errorText, fmtBytes, refresh, startedJob, useCartridgeState } from "./store";

type ModalProps = { closeModal?: () => void };

function fail(title: string, e: unknown) {
  toaster.toast({ title, body: errorText(e) });
}

function homeOf(state: State | null) {
  return state?.home_path.replace(/\/Games\/HomeCartridge$/, "") ?? "/home";
}

/** Asks for an image file and returns it as a 600x900 JPEG (base64), or null when cancelled. */
async function pickCover(state: State | null): Promise<string | null> {
  let picked;
  try {
    picked = await openFilePicker(FileSelectionType.FILE, homeOf(state), true, true, undefined, ["png", "jpg", "jpeg", "webp"]);
  } catch {
    return null;
  }
  const url = await readImage(picked.realpath || picked.path);
  if (!url) throw new Error("That file can't be used (PNG, JPEG or WebP under 40 MB, in your home folder or on a drive).");
  return coverFromImage(url);
}

/** The two-column sheet every modal here uses: the object on the left, its controls on the right. */
function Sheet({ closeModal, left, children }: ModalProps & { left: ReactNode; children: ReactNode }) {
  return (
    <ModalRoot closeModal={closeModal}>
      <style>{KIT_CSS}</style>
      <div style={{ display: "flex", gap: 28, alignItems: "flex-start", padding: "4px 2px" }}>
        <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: 6 }}>
          {left}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </ModalRoot>
  );
}

function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.015em", lineHeight: 1.1, color: "#fff" }}>{children}</div>
      {sub && <div style={{ ...muted, fontSize: 13, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

const row: CSSProperties = { display: "flex", alignItems: "center", gap: 14, padding: "8px 0" };
const rule: CSSProperties = { height: 1, background: "rgba(255,255,255,.07)" };
const smallButton: CSSProperties = { minWidth: 0, width: "auto", padding: "0 18px", height: 34 };

// ---- eject ----------------------------------------------------------------------------------------------

/** Eject with a confirmation; when programs still use the drive, names them and offers to close them. */
export function doEject(cart: Cartridge, after?: () => void) {
  const ejected = () => {
    toaster.toast({ title: "Game Cartridges", body: `${cart.name} can be unplugged now` });
    refresh();
    after?.();
  };
  const run = async (close: boolean) => {
    try {
      const result = await eject(cart.mount, close);
      if (result.ok) ejected();
      else askToClose(result.busy);
    } catch (e) {
      fail("Could not eject", e);
    }
  };
  const askToClose = (busy: Holder[]) => {
    const names = [...new Set(busy.map((p) => p.name))];
    const stuck = [...new Set(busy.filter((p) => !p.closable).map((p) => p.name))];
    showModal(
      <ConfirmModal
        strTitle={`${cart.name} is still in use`}
        strDescription={
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <Readout style={{ margin: "4px 0 12px" }}>
              <Legend color={VFD.amber}>Open files on the cartridge</Legend>
              {names.map((n) => (
                <div key={n} style={{ color: VFD.lit, fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                  {n}
                </div>
              ))}
            </Readout>
            {stuck.length
              ? `${stuck.join(", ")} can't be closed from here. Quit it first, then eject again.`
              : "Close them and eject? A game that is still running loses unsaved progress."}
          </div>
        }
        strOKButtonText={stuck.length ? "OK" : "Close them and eject"}
        onOK={() => {
          if (!stuck.length) run(true);
        }}
      />,
    );
  };
  showModal(
    <ConfirmModal
      strTitle={`Eject ${cart.name}?`}
      strDescription="Its games are hidden in Steam until you plug it in again."
      strOKButtonText="Eject"
      onOK={() => run(false)}
    />,
  );
}

// ---- a game on cartridges: copy, move, remove ------------------------------------------------------------

export function GameModal({ closeModal, gameId, from }: ModalProps & { gameId: string; from?: string }) {
  const state = useCartridgeState();
  if (!state) return null;
  const copies = state.cartridges.filter((c) => c.games.some((g) => g.id === gameId));
  const active = copies.find((c) => c.games.find((g) => g.id === gameId)?.active) ?? copies[0];
  const source = copies.find((c) => c.mount === from) ?? active;
  if (!source) {
    return (
      <Sheet closeModal={closeModal} left={<CartridgeArt name="" shell="#30343b" blank width={110} />}>
        <Title sub="No plugged-in cartridge has this game any more.">Not here</Title>
      </Sheet>
    );
  }
  const game = source.games.find((g) => g.id === gameId)!;
  const targets = state.cartridges.filter((c) => !copies.includes(c));
  const job = state.jobs.find((j) => j.game === gameId && (j.state === "queued" || j.state === "running"));
  const [size, unit] = sizeParts(game.size);
  const art = portraitURL(game.appid);
  const start = async (target: Cartridge, move: boolean) => {
    try {
      startedJob(await copyGame(source.mount, gameId, target.mount, move));
      closeModal?.();
    } catch (e) {
      fail(`Could not ${move ? "move" : "copy"} ${game.title}`, e);
    }
  };
  const remove = () =>
    showModal(
      <ConfirmModal
        strTitle={`Remove ${game.title} from ${source.name}?`}
        strDescription={
          <>
            Deletes its {fmtBytes(game.size)} of files from {source.home ? "this machine" : "the cartridge"}. Saves and
            settings on this machine stay.
            {copies.length === 1 && <div style={{ color: VFD.amber, marginTop: 8 }}>This is the only copy plugged in.</div>}
          </>
        }
        strOKButtonText="Remove"
        bDestructiveWarning
        onOK={async () => {
          try {
            startedJob(await removeGame(source.mount, gameId));
            closeModal?.();
          } catch (e) {
            fail(`Could not remove ${game.title}`, e);
          }
        }}
      />,
    );
  return (
    <Sheet
      closeModal={closeModal}
      left={
        <>
          <div className="gc-tile-art" style={{ width: 150 }}>
            {art ? <img src={art} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div className="gc-tile-fallback">{game.title}</div>}
          </div>
          <Readout style={{ width: 150, boxSizing: "border-box", display: "flex", alignItems: "flex-end", gap: 5 }}>
            <Seg text={size} height={20} />
            <Legend style={{ marginBottom: 1 }}>{unit}</Legend>
          </Readout>
        </>
      }
    >
      <Title>{game.title}</Title>
      <div style={sectionLabel}>{copies.length > 1 ? "Copies" : "Lives on"}</div>
      {copies.map((c) => (
        <div key={c.mount} style={row}>
          <CartArt cart={c} width={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
            <div style={muted}>
              {c.home ? "Internal storage" : speedText(c.speed)}
              {copies.length > 1 && c === active ? " · Steam starts this copy" : ""}
            </div>
          </div>
        </div>
      ))}
      {job && (
        <Readout style={{ marginTop: 8 }}>
          <Legend>{job.title}</Legend>
          <div style={{ color: VFD.lit, fontSize: 13, marginTop: 3 }}>{job.message}</div>
        </Readout>
      )}
      <div style={sectionLabel}>Copy or move to</div>
      {targets.length === 0 && <div style={muted}>Plug in another cartridge to copy or move this game.</div>}
      <Focusable flow-children="down">
        {targets.map((t, i) => {
          const fits = game.size === null || game.size + 512e6 < t.free;
          const [free, freeUnit] = sizeParts(t.free);
          return (
            <div key={t.mount}>
              {i > 0 && <div style={rule} />}
              <div style={row}>
                <CartArt cart={t} width={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ ...muted, color: fits ? muted.color : VFD.amber }}>
                    {free} {freeUnit} free{fits ? "" : " · not enough space"}
                  </div>
                </div>
                <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
                  <DialogButton style={smallButton} disabled={!!job || !fits} onClick={() => start(t, false)}>
                    Copy
                  </DialogButton>
                  <DialogButton style={smallButton} disabled={!!job || !fits} onClick={() => start(t, true)}>
                    Move
                  </DialogButton>
                </Focusable>
              </div>
            </div>
          );
        })}
      </Focusable>
      <div style={{ ...rule, margin: "14px 0" }} />
      <DialogButton style={{ ...smallButton, width: "100%" }} disabled={!!job} onClick={remove}>
        Remove from {source.name}…
      </DialogButton>
    </Sheet>
  );
}

// ---- a Steam game: Steam's own move into a library folder on a cartridge --------------------------------

export function SteamGameModal({ closeModal, appid }: ModalProps & { appid: number }) {
  const state = useCartridgeState();
  const [folders, setFolders] = useState<SteamFolder[] | null>(null);
  useEffect(() => {
    steamFolders().then(setFolders);
  }, []);
  const app = overview(appid);
  if (!state || !folders) return null;
  const current = folders.find((f) => f.apps.includes(appid));
  const home = folders.find((f) => f.index === 0);
  const carts = state.cartridges.filter((c) => !c.home && c.exists);
  const art = portraitURL(appid);
  const move = async (folder: SteamFolder) => {
    try {
      await moveSteamGame(appid, folder.index);
      toaster.toast({ title: "Game Cartridges", body: `Steam is moving ${app?.display_name}` });
      closeModal?.();
    } catch (e) {
      fail("Steam could not move it", e);
    }
  };
  const addAndMove = async (cart: Cartridge) => {
    try {
      const path = await setSteamLibrary(cart.mount);
      const folder = await addSteamLibrary(path, cart.name);
      refresh();
      if (folder) await move(folder);
    } catch (e) {
      fail("Could not add a Steam library", e);
    }
  };
  return (
    <Sheet
      closeModal={closeModal}
      left={
        <div className="gc-tile-art" style={{ width: 150 }}>
          {art && <img src={art} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
      }
    >
      <Title sub="Moves with Steam's own Move install folder, into a Steam library on the cartridge.">
        {app?.display_name ?? "Steam game"}
      </Title>
      <div style={sectionLabel}>Move to</div>
      {carts.length === 0 && <div style={muted}>No cartridge is plugged in.</div>}
      <Focusable flow-children="down">
        {carts.map((cart, i) => {
          const folder = folderOn(folders, cart);
          const here = !!folder && current?.index === folder.index;
          return (
            <div key={cart.mount}>
              {i > 0 && <div style={rule} />}
              <div style={row}>
                <CartArt cart={cart} width={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{cart.name}</div>
                  <div style={muted}>{here ? "Installed here" : `${fmtBytes(cart.free)} free${folder ? "" : " · no Steam library yet"}`}</div>
                </div>
                {folder ? (
                  <DialogButton style={smallButton} disabled={here} onClick={() => move(folder)}>
                    Move here
                  </DialogButton>
                ) : (
                  <DialogButton style={smallButton} onClick={() => addAndMove(cart)}>
                    Add library & move
                  </DialogButton>
                )}
              </div>
            </div>
          );
        })}
        {home && current && current.index !== home.index && (
          <DialogButton style={{ ...smallButton, width: "100%", marginTop: 12 }} onClick={() => move(home)}>
            Move back to this machine
          </DialogButton>
        )}
      </Focusable>
      <div style={{ ...muted, marginTop: 16, lineHeight: 1.45 }}>
        On another machine, add the library once in Steam's storage settings. The game needs your account or Family
        Sharing there. Proton saves of games without Steam Cloud travel with the cartridge.
      </div>
    </Sheet>
  );
}

// ---- a cartridge: name, label art, shell, Steam library, eject ------------------------------------------

export function CartridgeModal({ closeModal, mount }: ModalProps & { mount: string }) {
  const state = useCartridgeState();
  const cart = state?.cartridges.find((c) => c.mount === mount);
  const cover = useCover(cart);
  const [name, setName] = useState(cart?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<SteamFolder[]>([]);
  useEffect(() => {
    steamFolders().then(setFolders);
  }, []);
  if (!state || !cart) return null;
  const folder = folderOn(folders, cart);
  const shell = shellOf(cart);
  const [free, unit] = sizeParts(cart.free);
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      fail(what, e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      closeModal={closeModal}
      left={
        <>
          {cart.home ? <ConsoleArt width={190} /> : <CartridgeArt name={name || cart.name} shell={shell} art={cover} width={170} />}
          <Readout style={{ width: cart.home ? 190 : 170, boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 5 }}>
              <Seg text={free} height={20} />
              <Legend style={{ marginBottom: 1 }}>{unit} free</Legend>
            </div>
            <Legend style={{ display: "block", marginTop: 6 }}>
              of {fmtBytes(cart.total)} · {cart.games.length} {cart.games.length === 1 ? "game" : "games"}
            </Legend>
            {!cart.home && cart.speed && (
              <Legend color={cart.speed <= 480 ? VFD.amber : VFD.dim} style={{ display: "block", marginTop: 4 }}>
                {speedText(cart.speed)}
              </Legend>
            )}
          </Readout>
        </>
      }
    >
      <Title sub={cart.home ? state.home_path : [cart.model, cart.mount].filter(Boolean).join(" · ")}>
        {cart.home ? `${cart.name} · internal` : cart.name}
      </Title>
      {!cart.home && (
        <>
          <div style={sectionLabel}>Label</div>
          <Focusable flow-children="down" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
              <DialogButton
                style={smallButton}
                disabled={busy || !name.trim() || name.trim() === cart.name}
                onClick={() => act("Could not rename", () => renameCartridge(cart.mount, name.trim()))}
              >
                Save name
              </DialogButton>
              <DialogButton
                style={smallButton}
                disabled={busy}
                onClick={() =>
                  act("Could not set the label art", async () => {
                    const jpeg = await pickCover(state);
                    if (jpeg) await setCover(cart.mount, jpeg);
                  })
                }
              >
                {cart.cover ? "Change art…" : "Add art…"}
              </DialogButton>
              {cart.cover && (
                <DialogButton style={smallButton} disabled={busy} onClick={() => act("Could not remove the art", () => setCover(cart.mount, null))}>
                  Remove art
                </DialogButton>
              )}
            </Focusable>
          </Focusable>
          <div style={sectionLabel}>Shell</div>
          <Swatches value={shell} onChange={(hex) => act("Could not change the shell", () => setColor(cart.mount, hex))} />
          <div style={{ height: 14 }} />
        </>
      )}
      <div style={sectionLabel}>Drive</div>
      <Focusable style={{ display: "flex", gap: 8, flexWrap: "wrap" }} flow-children="right">
        {!cart.home && !folder && (
          <DialogButton
            style={smallButton}
            disabled={busy}
            onClick={() =>
              act("Could not add a Steam library", async () => {
                const path = await setSteamLibrary(cart.mount);
                await addSteamLibrary(path, cart.name);
                setFolders(await steamFolders());
              })
            }
          >
            Add Steam library
          </DialogButton>
        )}
        {!cart.home && (
          <DialogButton style={smallButton} disabled={busy} onClick={() => doEject(cart, closeModal)}>
            Eject…
          </DialogButton>
        )}
      </Focusable>
      <div style={{ ...muted, marginTop: 10, lineHeight: 1.45 }}>
        {cart.home
          ? "Games here play without a cartridge plugged in. Move them back onto a cartridge to take them along."
          : folder
            ? `Steam library on this cartridge: ${folder.apps.length} Steam ${folder.apps.length === 1 ? "game" : "games"}.`
            : "A Steam library on the cartridge lets Steam move its own games onto it."}
      </div>
    </Sheet>
  );
}

// ---- a new drive: name, label art, shell, erase ---------------------------------------------------------

function contents(drive: Drive) {
  if (!drive.partitions.length) return ["Empty, no partitions"];
  return drive.partitions.map((p) => {
    const head = `${p.fstype ?? "no file system"}${p.label ? ` "${p.label}"` : ""} · ${fmtBytes(p.size)}`;
    if (!p.mounts.length) return `${head} · not mounted`;
    return `${head} · ${fmtBytes(p.used)} used${p.entries.length ? `: ${p.entries.join(", ")}` : ""}`;
  });
}

function DriveIdentity({ drive }: { drive: Drive }) {
  const [size, unit] = sizeParts(drive.size);
  return (
    <Readout>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
        <Seg text={size} height={22} />
        <Legend style={{ marginBottom: 2 }}>{unit}</Legend>
        <div style={{ flex: 1 }} />
        <Legend color={drive.speed !== null && drive.speed <= 480 ? VFD.amber : VFD.dim} style={{ marginBottom: 2 }}>
          {speedText(drive.speed) ?? ""}
        </Legend>
      </div>
      <div style={{ color: VFD.lit, fontSize: 14, fontWeight: 600, marginTop: 8 }}>{drive.model}</div>
      <Legend style={{ display: "block", marginTop: 2 }}>
        {drive.dev}
        {drive.serial ? ` · serial ${drive.serial}` : ""}
      </Legend>
      {contents(drive).map((line) => (
        <Legend key={line} style={{ display: "block", marginTop: 6, letterSpacing: "0.06em", textTransform: "none", fontSize: 11 }}>
          {line}
        </Legend>
      ))}
    </Readout>
  );
}

export function FormatModal({ closeModal, drive }: ModalProps & { drive: Drive }) {
  const state = useCartridgeState();
  const [name, setName] = useState("");
  const [cover, setCoverJpeg] = useState<string | null>(null);
  const [shell, setShell] = useState(SHELLS[0].hex);
  const [busy, setBusy] = useState(false);
  const label = name.trim();
  const confirm = () =>
    showModal(
      <ConfirmModal
        strTitle="Erase this drive?"
        bDestructiveWarning
        strOKButtonText="Erase and make cartridge"
        strDescription={
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <div style={{ marginBottom: 10 }}>Everything on this drive is deleted:</div>
            <DriveIdentity drive={drive} />
            <div style={{ marginTop: 10 }}>
              It becomes the empty cartridge <b>{label}</b>.
            </div>
          </div>
        }
        onOK={async () => {
          setBusy(true);
          try {
            startedJob(await formatDrive(drive.dev, drive.token, label, cover, shell));
            closeModal?.();
          } catch (e) {
            fail("Could not format", e);
          } finally {
            setBusy(false);
          }
        }}
      />,
    );
  return (
    <Sheet
      closeModal={closeModal}
      left={
        <>
          <CartridgeArt
            name={label || "Untitled"}
            shell={shell}
            art={cover ? `data:image/jpeg;base64,${cover}` : null}
            width={170}
          />
          <Legend color="#8b929a">Preview</Legend>
        </>
      }
    >
      <Title sub="Name it, give it label art and a shell. The drive is erased and becomes an empty cartridge.">
        New cartridge
      </Title>
      <div style={sectionLabel}>Label</div>
      <Focusable flow-children="down" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="Name" description="Shown in Steam and as the drive's label" value={name} onChange={(e) => setName(e.target.value)} />
        <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
          <DialogButton
            style={smallButton}
            disabled={busy}
            onClick={async () => {
              try {
                const jpeg = await pickCover(state);
                if (jpeg) setCoverJpeg(jpeg);
              } catch (e) {
                fail("Could not use that image", e);
              }
            }}
          >
            {cover ? "Change art…" : "Choose art…"}
          </DialogButton>
          {cover && (
            <DialogButton style={smallButton} onClick={() => setCoverJpeg(null)}>
              No art
            </DialogButton>
          )}
        </Focusable>
      </Focusable>
      <div style={sectionLabel}>Shell</div>
      <Swatches value={shell} onChange={setShell} />
      <div style={{ ...sectionLabel, marginTop: 26 }}>Drive</div>
      <DriveIdentity drive={drive} />
      <DialogButton style={{ marginTop: 16 }} disabled={busy || !label} onClick={confirm}>
        Erase drive and make cartridge…
      </DialogButton>
    </Sheet>
  );
}
