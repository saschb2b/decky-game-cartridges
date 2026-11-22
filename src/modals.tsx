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
import { CartCard, CartIcon, muted, sectionLabel, speedText } from "./components";
import { CartridgeCard, gb, KIT_CSS, SHELLS, shellName, shellOf, Swatches } from "./kit";
import { addSteamLibrary, coverFromImage, folderOn, moveSteamGame, overview, portraitURL, SteamFolder, steamFolders } from "./steam";
import { errorText, fmtBytes, refresh, startedJob, useCartridgeState } from "./store";

type ModalProps = { closeModal?: () => void };

const AMBER = "#f0b357";
const LEFT = 230;

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

/** Every sheet here: the object on the left at a fixed width, its controls on the right. */
function Sheet({ closeModal, left, children }: ModalProps & { left: ReactNode; children: ReactNode }) {
  return (
    <ModalRoot closeModal={closeModal}>
      <style>{KIT_CSS}</style>
      <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
        <div style={{ width: LEFT, flex: "none" }}>{left}</div>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </ModalRoot>
  );
}

function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15, color: "#fff" }}>{children}</div>
      {sub && <div style={{ ...muted, fontSize: 13, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

const row: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 0" };
const rule: CSSProperties = { height: 1, background: "rgba(255,255,255,.08)" };
const button: CSSProperties = { minWidth: 0, width: "auto", padding: "0 18px", height: 34 };
const panel: CSSProperties = { background: "rgba(255,255,255,.05)", borderRadius: 8, padding: "10px 12px" };

// ---- eject ----------------------------------------------------------------------------------------------

/** Eject with a confirmation; when programs still use the drive, names them and offers to close them. */
export function doEject(cart: Cartridge, after?: () => void) {
  const run = async (close: boolean) => {
    try {
      const result = await eject(cart.mount, close);
      if (result.ok) {
        toaster.toast({ title: "Game Cartridges", body: `${cart.name} can be unplugged now` });
        refresh();
        after?.();
      } else askToClose(result.busy);
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
            <div>These programs have files open on it:</div>
            <div style={{ ...panel, margin: "8px 0 12px" }}>
              {names.map((n) => (
                <div key={n} style={{ fontWeight: 700, color: "#fff" }}>
                  {n}
                </div>
              ))}
            </div>
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
      <Sheet closeModal={closeModal} left={<div className="gc-tile" />}>
        <Title sub="No plugged-in cartridge has this game any more.">Game not found</Title>
      </Sheet>
    );
  }
  const game = source.games.find((g) => g.id === gameId)!;
  const targets = state.cartridges.filter((c) => !copies.includes(c));
  const job = state.jobs.find((j) => j.game === gameId && (j.state === "queued" || j.state === "running"));
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
            Deletes its {fmtBytes(game.size)} of files from {source.home ? "this machine" : "the cartridge"}. Saves and settings on this machine
            stay.
            {copies.length === 1 && <div style={{ color: AMBER, marginTop: 8 }}>This is the only copy plugged in.</div>}
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
        <div className="gc-tile" style={{ width: LEFT, boxShadow: "0 6px 18px rgba(0,0,0,.5)" }}>
          {art ? <img src={art} /> : <div className="gc-tile-name">{game.title}</div>}
        </div>
      }
    >
      <Title sub={`${fmtBytes(game.size)} · ${copies.length > 1 ? `on ${copies.length} cartridges` : `on ${source.name}`}`}>{game.title}</Title>
      {copies.length > 1 && (
        <>
          <div style={sectionLabel}>Copies</div>
          {copies.map((c) => (
            <div key={c.mount} style={row}>
              <CartIcon cart={c} />
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{c.name}</div>
              <div style={muted}>{c === active ? "Steam starts this one" : ""}</div>
            </div>
          ))}
        </>
      )}
      {job && (
        <div style={{ ...panel, marginTop: 14 }}>
          <div style={{ fontWeight: 700 }}>{job.title}</div>
          <div style={muted}>{job.message}</div>
        </div>
      )}
      <div style={sectionLabel}>Copy or move to</div>
      {targets.length === 0 && <div style={muted}>Plug in another cartridge to copy or move this game.</div>}
      <Focusable flow-children="down">
        {targets.map((t, i) => {
          const fits = game.size === null || game.size + 512e6 < t.free;
          return (
            <div key={t.mount}>
              {i > 0 && <div style={rule} />}
              <div style={row}>
                <CartIcon cart={t} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ ...muted, color: fits ? muted.color : AMBER }}>
                    {gb(t.free)} free{fits ? "" : " · not enough space"}
                  </div>
                </div>
                <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
                  <DialogButton style={button} disabled={!!job || !fits} onClick={() => start(t, false)}>
                    Copy
                  </DialogButton>
                  <DialogButton style={button} disabled={!!job || !fits} onClick={() => start(t, true)}>
                    Move
                  </DialogButton>
                </Focusable>
              </div>
            </div>
          );
        })}
      </Focusable>
      <div style={{ ...rule, margin: "12px 0 16px" }} />
      <DialogButton style={{ ...button, width: "100%" }} disabled={!!job} onClick={remove}>
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
    <Sheet closeModal={closeModal} left={<div className="gc-tile" style={{ width: LEFT }}>{art && <img src={art} />}</div>}>
      <Title sub="Moves with Steam's own Move install folder, into a Steam library on the cartridge.">{app?.display_name ?? "Steam game"}</Title>
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
                <CartIcon cart={cart} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{cart.name}</div>
                  <div style={muted}>{here ? "Installed here" : `${gb(cart.free)} free${folder ? "" : " · no Steam library yet"}`}</div>
                </div>
                {folder ? (
                  <DialogButton style={button} disabled={here} onClick={() => move(folder)}>
                    Move here
                  </DialogButton>
                ) : (
                  <DialogButton style={button} onClick={() => addAndMove(cart)}>
                    Add library and move
                  </DialogButton>
                )}
              </div>
            </div>
          );
        })}
        {home && current && current.index !== home.index && (
          <DialogButton style={{ ...button, width: "100%", marginTop: 12 }} onClick={() => move(home)}>
            Move back to this machine
          </DialogButton>
        )}
      </Focusable>
      <div style={{ ...muted, marginTop: 16, lineHeight: 1.45 }}>
        On another machine, add the library once in Steam's storage settings. The game needs your account or Family Sharing there. Proton
        saves of games without Steam Cloud travel with the cartridge.
      </div>
    </Sheet>
  );
}

// ---- a cartridge: name, label art, shell, Steam library, eject ------------------------------------------

export function CartridgeModal({ closeModal, mount }: ModalProps & { mount: string }) {
  const state = useCartridgeState();
  const cart = state?.cartridges.find((c) => c.mount === mount);
  const [name, setName] = useState(cart?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<SteamFolder[]>([]);
  useEffect(() => {
    steamFolders().then(setFolders);
  }, []);
  if (!state || !cart) return null;
  const folder = folderOn(folders, cart);
  const shell = shellOf(cart);
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
  const facts = cart.home
    ? [state.home_path]
    : [cart.model, speedText(cart.speed)?.split(" · ")[0], `${cart.games.length} ${cart.games.length === 1 ? "game" : "games"}`].filter(Boolean);
  return (
    <Sheet closeModal={closeModal} left={<CartCard cart={cart} name={cart.home ? cart.name : name || cart.name} labelHeight={170} />}>
      <Title sub={facts.join(" · ")}>{cart.home ? `${cart.name} (internal storage)` : cart.name}</Title>
      {!cart.home && (
        <>
          <div style={sectionLabel}>Label</div>
          <Focusable flow-children="down" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
              <DialogButton
                style={button}
                disabled={busy || !name.trim() || name.trim() === cart.name}
                onClick={() => act("Could not rename", () => renameCartridge(cart.mount, name.trim()))}
              >
                Save name
              </DialogButton>
              <DialogButton
                style={button}
                disabled={busy}
                onClick={() =>
                  act("Could not set the label art", async () => {
                    const jpeg = await pickCover(state);
                    if (jpeg) await setCover(cart.mount, jpeg);
                  })
                }
              >
                {cart.cover ? "Change label art…" : "Add label art…"}
              </DialogButton>
              {cart.cover && (
                <DialogButton style={button} disabled={busy} onClick={() => act("Could not remove the art", () => setCover(cart.mount, null))}>
                  Remove art
                </DialogButton>
              )}
            </Focusable>
          </Focusable>
          <div style={sectionLabel}>Shell · {shellName(shell)}</div>
          <Swatches value={shell} onChange={(hex) => act("Could not change the shell", () => setColor(cart.mount, hex))} />
        </>
      )}
      <div style={sectionLabel}>Drive</div>
      <Focusable style={{ display: "flex", gap: 8, flexWrap: "wrap" }} flow-children="right">
        {!cart.home && !folder && (
          <DialogButton
            style={button}
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
          <DialogButton style={button} disabled={busy} onClick={() => doEject(cart, closeModal)}>
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
    const head = `${p.fstype ?? "no file system"}${p.label ? ` "${p.label}"` : ""}, ${fmtBytes(p.size)}`;
    if (!p.mounts.length) return `${head}, not mounted`;
    return `${head}, ${fmtBytes(p.used)} used${p.entries.length ? `: ${p.entries.join(", ")}` : ""}`;
  });
}

function DriveIdentity({ drive }: { drive: Drive }) {
  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 700, color: "#fff" }}>{drive.model}</div>
        <div style={{ fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{gb(drive.size)}</div>
      </div>
      <div style={{ ...muted, marginTop: 2 }}>
        {[drive.dev, drive.serial && `serial ${drive.serial}`, speedText(drive.speed)].filter(Boolean).join(" · ")}
      </div>
      {contents(drive).map((line) => (
        <div key={line} style={{ ...muted, marginTop: 6, color: "#c6c9cd" }}>
          {line}
        </div>
      ))}
    </div>
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
        <CartridgeCard
          name={label}
          shell={shell}
          art={cover ? `data:image/jpeg;base64,${cover}` : null}
          tag={speedText(drive.speed)?.split(" · ")[0]}
          free={drive.size}
          total={drive.size}
          labelHeight={170}
        />
      }
    >
      <Title sub="The drive is erased and becomes an empty cartridge with this label.">New cartridge</Title>
      <div style={sectionLabel}>Label</div>
      <Focusable flow-children="down" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="Name" description="Shown in Steam and as the drive's label" value={name} onChange={(e) => setName(e.target.value)} />
        <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
          <DialogButton
            style={button}
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
            {cover ? "Change label art…" : "Choose label art…"}
          </DialogButton>
          {cover && (
            <DialogButton style={button} onClick={() => setCoverJpeg(null)}>
              No art
            </DialogButton>
          )}
        </Focusable>
      </Focusable>
      <div style={sectionLabel}>Shell · {shellName(shell)}</div>
      <Swatches value={shell} onChange={setShell} />
      <div style={sectionLabel}>Drive</div>
      <DriveIdentity drive={drive} />
      <DialogButton style={{ marginTop: 16 }} disabled={busy || !label} onClick={confirm}>
        Erase drive and make cartridge…
      </DialogButton>
    </Sheet>
  );
}

