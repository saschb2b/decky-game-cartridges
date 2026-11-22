import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import {
  ConfirmModal,
  DialogBody,
  DialogButton,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  showModal,
  TextField,
} from "@decky/ui";
import { ReactNode, useEffect, useState } from "react";
import {
  Cartridge,
  copyGame,
  Drive,
  eject,
  formatDrive,
  readImage,
  removeGame,
  renameCartridge,
  setCover,
  setSteamLibrary,
  State,
} from "./api";
import { Cover, GameArt, muted, SpeedWarning, useCover } from "./components";
import { addSteamLibrary, coverFromImage, folderOn, moveSteamGame, overview, SteamFolder, steamFolders } from "./steam";
import { errorText, fmtBytes, refresh, startedJob, useCartridgeState } from "./store";

type ModalProps = { closeModal?: () => void };

function where(cart: Cartridge) {
  return cart.home ? cart.name : `${cart.name} (cartridge)`;
}

function Buttons({ children }: { children: ReactNode }) {
  return (
    <Focusable style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }} flow-children="down">
      {children}
    </Focusable>
  );
}

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
    picked = await openFilePicker(FileSelectionType.FILE, homeOf(state), true, true, undefined, [
      "png",
      "jpg",
      "jpeg",
      "webp",
    ]);
  } catch {
    return null;
  }
  const url = await readImage(picked.realpath || picked.path);
  if (!url) throw new Error("That file can't be used (PNG, JPEG or WebP under 40 MB, in your home folder or on a drive).");
  return coverFromImage(url);
}

// ---- a game on cartridges: copy, move, remove ----------------------------------------------------------

export function GameModal({ closeModal, gameId, from }: ModalProps & { gameId: string; from?: string }) {
  const state = useCartridgeState();
  if (!state) return null;
  const copies = state.cartridges.filter((c) => c.games.some((g) => g.id === gameId));
  const source =
    copies.find((c) => c.mount === from) ??
    copies.find((c) => c.games.find((g) => g.id === gameId)?.active) ??
    copies[0];
  if (!source) {
    return (
      <ModalRoot closeModal={closeModal}>
        <DialogHeader>Game not found</DialogHeader>
        <DialogBody>No plugged-in cartridge has this game any more.</DialogBody>
      </ModalRoot>
    );
  }
  const game = source.games.find((g) => g.id === gameId)!;
  const targets = state.cartridges.filter((c) => !copies.includes(c));
  const job = state.jobs.find((j) => j.game === gameId && (j.state === "queued" || j.state === "running"));
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
        strTitle={`Remove ${game.title}?`}
        strDescription={
          <>
            Deletes games/{game.id} ({fmtBytes(game.size)}) from {where(source)}. Saves and settings on this machine
            stay.
            {copies.length === 1 && <div style={{ color: "#ffb347", marginTop: 8 }}>This is the only copy plugged in.</div>}
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
    <ModalRoot closeModal={closeModal}>
      <DialogHeader>{game.title}</DialogHeader>
      <DialogBody>
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <GameArt mount={source.mount} id={game.id} appid={game.appid} width={64} />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <div>On {copies.map(where).join(", ")}</div>
            <div style={muted}>{fmtBytes(game.size)}</div>
            {copies.length > 1 && <div style={muted}>Steam starts the copy on {where(copies.find((c) => c.games.find((g) => g.id === gameId)?.active) ?? copies[0])}.</div>}
            {job && <div style={{ color: "#1a9fff" }}>{job.title}: {job.message}</div>}
          </div>
        </div>
        <Buttons>
          {targets.map((t) => {
            const fits = game.size === null || game.size + 512e6 < t.free;
            return (
              <Field
                key={t.mount}
                label={t.home ? `${t.name} (internal)` : t.name}
                description={`${fmtBytes(t.free)} free${fits ? "" : " – not enough space"}`}
                childrenContainerWidth="max"
              >
                <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
                  <DialogButton disabled={!!job || !fits} onClick={() => start(t, false)} style={{ minWidth: 0 }}>
                    Copy
                  </DialogButton>
                  <DialogButton disabled={!!job || !fits} onClick={() => start(t, true)} style={{ minWidth: 0 }}>
                    Move
                  </DialogButton>
                </Focusable>
              </Field>
            );
          })}
          {targets.length === 0 && <div style={muted}>Plug in another cartridge to copy or move this game.</div>}
          <DialogButton disabled={!!job} onClick={remove}>
            Remove from {source.name}…
          </DialogButton>
        </Buttons>
      </DialogBody>
    </ModalRoot>
  );
}

// ---- a Steam game: Steam's own move into a library folder on a cartridge -------------------------------

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
    <ModalRoot closeModal={closeModal}>
      <DialogHeader>{app?.display_name ?? "Steam game"}</DialogHeader>
      <DialogBody>
        <div style={{ ...muted, marginBottom: 8 }}>
          Steam games move with Steam's own "Move install folder" into a Steam library on the cartridge. On another
          machine, add that library in Steam's storage settings; the game needs that Steam account (or Family
          Sharing). Proton saves of games without Steam Cloud travel with it.
        </div>
        <Buttons>
          {carts.map((cart) => {
            const folder = folderOn(folders, cart);
            const here = folder && current?.index === folder.index;
            return (
              <Field key={cart.mount} label={cart.name} description={here ? "Installed here" : `${fmtBytes(cart.free)} free`}>
                {folder ? (
                  <DialogButton disabled={!!here} onClick={() => move(folder)}>
                    Move here
                  </DialogButton>
                ) : (
                  <DialogButton onClick={() => addAndMove(cart)}>Add Steam library and move</DialogButton>
                )}
              </Field>
            );
          })}
          {carts.length === 0 && <div style={muted}>No cartridge is plugged in.</div>}
          {home && current && current.index !== home.index && (
            <DialogButton onClick={() => move(home)}>Move back to this machine</DialogButton>
          )}
        </Buttons>
      </DialogBody>
    </ModalRoot>
  );
}

// ---- a cartridge: name, cover, Steam library, eject ---------------------------------------------------

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
  const doEject = () =>
    showModal(
      <ConfirmModal
        strTitle={`Eject ${cart.name}?`}
        strDescription="Its games are hidden in Steam until you plug it in again. Close any game running from it first."
        strOKButtonText="Eject"
        onOK={() =>
          act("Could not eject", async () => {
            await eject(cart.mount);
            toaster.toast({ title: "Game Cartridges", body: `${cart.name} can be unplugged now` });
            closeModal?.();
          })
        }
      />,
    );
  return (
    <ModalRoot closeModal={closeModal}>
      <DialogHeader>{cart.home ? `${cart.name} (internal storage)` : cart.name}</DialogHeader>
      <DialogBody>
        <div style={{ display: "flex", gap: 12 }}>
          <Cover cart={cart} url={cover} width={90} />
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div>
              {fmtBytes(cart.free)} free of {fmtBytes(cart.total)}
            </div>
            <div style={muted}>{cart.home ? state.home_path : `${cart.model ?? ""} · ${cart.mount}`}</div>
            <div style={muted}>
              {cart.games.length} game{cart.games.length === 1 ? "" : "s"}
              {folder ? ` · Steam library (${folder.apps.length} Steam game${folder.apps.length === 1 ? "" : "s"})` : ""}
            </div>
            <SpeedWarning cart={cart} />
          </div>
        </div>
        <Buttons>
          {!cart.home && (
            <>
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <DialogButton
                disabled={busy || !name.trim() || name.trim() === cart.name}
                onClick={() => act("Could not rename", () => renameCartridge(cart.mount, name.trim()))}
              >
                Rename to "{name.trim() || "…"}"
              </DialogButton>
            </>
          )}
          <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
            <DialogButton
              disabled={busy}
              onClick={() =>
                act("Could not set the cover", async () => {
                  const jpeg = await pickCover(state);
                  if (jpeg) await setCover(cart.mount, jpeg);
                })
              }
            >
              {cart.cover ? "Change cover…" : "Add cover…"}
            </DialogButton>
            {cart.cover && (
              <DialogButton disabled={busy} onClick={() => act("Could not remove the cover", () => setCover(cart.mount, null))}>
                Remove cover
              </DialogButton>
            )}
          </Focusable>
          {!cart.home && !folder && (
            <DialogButton
              disabled={busy}
              onClick={() =>
                act("Could not add a Steam library", async () => {
                  const path = await setSteamLibrary(cart.mount);
                  await addSteamLibrary(path, cart.name);
                  setFolders(await steamFolders());
                })
              }
            >
              Add a Steam library for Steam games
            </DialogButton>
          )}
          {!cart.home && (
            <DialogButton disabled={busy} onClick={doEject}>
              Eject safely
            </DialogButton>
          )}
        </Buttons>
      </DialogBody>
    </ModalRoot>
  );
}

// ---- a new drive: name, cover, erase ------------------------------------------------------------------

function contents(drive: Drive) {
  if (!drive.partitions.length) return "Empty (no partitions)";
  return drive.partitions
    .map((p) => {
      const head = `${p.name}: ${p.fstype ?? "no file system"}${p.label ? ` "${p.label}"` : ""}, ${fmtBytes(p.size)}`;
      if (!p.mounts.length) return `${head}, not mounted`;
      const files = p.entries.length ? p.entries.join(", ") : "no files";
      return `${head}, ${fmtBytes(p.used)} used: ${files}`;
    })
    .join("\n");
}

export function FormatModal({ closeModal, drive }: ModalProps & { drive: Drive }) {
  const state = useCartridgeState();
  const [name, setName] = useState("");
  const [cover, setCoverJpeg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = { mount: "", home: false, exists: true, id: name, name: name || "Cartridge" } as Cartridge;
  const confirm = () =>
    showModal(
      <ConfirmModal
        strTitle="Erase this drive?"
        bDestructiveWarning
        strOKButtonText="Erase and make cartridge"
        strDescription={
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <div>
              <b>{drive.model}</b> · {fmtBytes(drive.size)} · {drive.dev}
              {drive.serial && <div style={{ color: "#8b929a", fontSize: 12 }}>Serial {drive.serial}</div>}
            </div>
            <div style={{ marginTop: 6 }}>Everything on it is deleted:</div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "4px 0", color: "#dcdedf" }}>{contents(drive)}</pre>
            <div>
              It becomes the empty cartridge <b>{name.trim()}</b> (ext4).
            </div>
          </div>
        }
        onOK={async () => {
          setBusy(true);
          try {
            startedJob(await formatDrive(drive.dev, drive.token, name.trim(), cover));
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
    <ModalRoot closeModal={closeModal}>
      <DialogHeader>New cartridge</DialogHeader>
      <DialogBody>
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <Cover cart={preview} url={cover ? `data:image/jpeg;base64,${cover}` : null} width={80} />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <div>
              {drive.model} · {fmtBytes(drive.size)}
            </div>
            {drive.serial && <div style={muted}>Serial {drive.serial}</div>}
            <div style={{ ...muted, whiteSpace: "pre-wrap" }}>{contents(drive)}</div>
            {drive.speed !== null && drive.speed <= 480 && (
              <div style={{ color: "#ffb347", fontSize: 12 }}>⚠ This port runs at USB 2 speed: formatting works, games load slowly.</div>
            )}
          </div>
        </div>
        <Buttons>
          <TextField
            label="Name"
            description="Shown in Steam and as the drive's label"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Focusable style={{ display: "flex", gap: 8 }} flow-children="right">
            <DialogButton
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
              {cover ? "Change cover…" : "Choose cover (optional)…"}
            </DialogButton>
            {cover && <DialogButton onClick={() => setCoverJpeg(null)}>No cover</DialogButton>}
          </Focusable>
          <DialogButton disabled={busy || !name.trim()} onClick={confirm}>
            Erase and make cartridge…
          </DialogButton>
        </Buttons>
      </DialogBody>
    </ModalRoot>
  );
}
