// Steam-side helpers: the collection per cartridge, Steam games and their moves, artwork.
// Shortcuts and the Steam library folders of cartridges are the cartridge agent's job (see FORMAT.md).
import { useEffect, useState } from "react";
// No refresh here: the plugin notices the Steam library change itself (its change token covers steamapps/).
import { Cartridge, Game, Job, setSteamLibrary, State } from "./api";

declare const SteamClient: any;
declare const appStore: any;
declare const collectionStore: any;

const COLLECTIONS_KEY = "game-cartridges:collections";

export const NON_STEAM = 1073741824;
const GAME = 1;
const DEMO = 8;

export function overview(appid: number): any {
  try {
    return appStore.GetAppOverviewByAppID(appid);
  } catch {
    return null;
  }
}

export function portraitURL(appid: number | null): string | null {
  if (!appid) return null;
  const o = overview(appid);
  if (!o) return null;
  try {
    const custom = appStore.GetCustomVerticalCapsuleURLs(o);
    if (custom?.length) return custom[0];
    if (o.app_type !== NON_STEAM) return appStore.GetVerticalCapsuleURLForApp(o);
  } catch {
    /* artwork is optional */
  }
  return null;
}

/** A wide image for a game (hero, else wide capsule, else box art) for a cartridge label without art. */
export function wideURL(appid: number | null): string | null {
  if (!appid) return null;
  const o = overview(appid);
  if (!o) return null;
  try {
    for (const get of ["GetCustomHeroImageURLs", "GetCustomLandcapeImageURLs"]) {
      const urls = appStore[get]?.(o);
      if (urls?.length) return urls[0];
    }
  } catch {
    /* artwork is optional */
  }
  return portraitURL(appid);
}

/** Steam games are listed only when they are games: Proton, runtimes and redistributables stay out. */
export function isListed(game: Game) {
  if (game.kind !== "steam" || !game.appid) return true;
  const type = overview(game.appid)?.app_type;
  return type === undefined || type === GAME || type === DEMO;
}

/** A drive's games for the panel: cartridge games in the manifest's order, then Steam games, last played first. */
export function listedGames(cart: Cartridge): Game[] {
  const played = (g: Game) => (g.appid ? overview(g.appid)?.rt_last_time_played ?? 0 : 0);
  const steam = cart.games.filter((g) => g.kind === "steam" && isListed(g));
  steam.sort((a, b) => played(b) - played(a) || a.title.localeCompare(b.title));
  return [...cart.games.filter((g) => g.kind !== "steam"), ...steam];
}

function savedCollections(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(COLLECTIONS_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Each plugged-in cartridge gets a Steam collection with its name that holds exactly its games. */
export async function syncCollections(state: State) {
  if (typeof collectionStore === "undefined") return;
  const saved = savedCollections();
  let changed = false;
  for (const cart of state.cartridges) {
    if (cart.home || !cart.exists || !cart.id) continue;
    const ids = cart.games
      .filter(isListed)
      .map((g) => g.appid)
      .filter((id): id is number => !!id && !!overview(id));
    let collection = saved[cart.id] ? collectionStore.GetCollection(saved[cart.id]) : null;
    if (!collection && ids.length === 0) continue;
    if (!collection) {
      const taken = collectionStore.userCollections.some((c: any) => c.displayName === cart.name);
      const name = taken ? `${cart.name} (cartridge)` : cart.name;
      collection = collectionStore.NewUnsavedCollection(name, undefined, ids.map(overview));
      await collection.Save();
      saved[cart.id] = collection.m_strId ?? collection.id;
      changed = true;
      continue;
    }
    const have = new Set<number>(collection.allApps.map((o: any) => o.appid));
    const want = new Set<number>(ids);
    const add = ids.filter((id) => !have.has(id)).map(overview);
    const remove = [...have].filter((id) => !want.has(id)).map(overview).filter(Boolean);
    const wantedName = collection.displayName.endsWith(" (cartridge)") ? `${cart.name} (cartridge)` : cart.name;
    if (!add.length && !remove.length && collection.displayName === wantedName) continue;
    const editable = collection.AsDragDropCollection?.() ?? collection;
    if (add.length) editable.AddApps(add);
    if (remove.length) editable.RemoveApps(remove);
    if (collection.displayName !== wantedName) collection.m_strName = wantedName;
    await collection.Save();
  }
  if (changed) localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(saved));
}

export type SteamFolder = { index: number; path: string; free: number; mounted: boolean; isDefault: boolean; apps: number[] };

export async function steamFolders(): Promise<SteamFolder[]> {
  const folders = await SteamClient.InstallFolder.GetInstallFolders();
  return folders.map((f: any) => ({
    index: f.nFolderIndex,
    path: f.strFolderPath,
    free: Number(f.nFreeSpace),
    mounted: f.bIsMounted,
    isDefault: f.bIsDefaultFolder,
    apps: (f.vecApps || []).map((a: any) => a.nAppID),
  }));
}

/** The Steam library folder Steam knows on this cartridge, if any. */
export function folderOn(folders: SteamFolder[], cart: Cartridge) {
  return folders.find((f) => f.path === cart.steam_library || f.path.startsWith(cart.mount + "/")) ?? null;
}

/** Where a Steam game goes when it moves to this machine: Steam's default library, unless that is on a cartridge. */
function machineFolder(folders: SteamFolder[], state: State) {
  const onCartridge = (f: SteamFolder) => state.cartridges.some((c) => !c.home && f.path.startsWith(c.mount + "/"));
  const mine = folders.filter((f) => f.mounted && !onCartridge(f));
  return mine.find((f) => f.isDefault) ?? mine[0] ?? null;
}

/** The cartridge's Steam library, created on the cartridge (the agent adds it to Steam) when it has none yet. */
async function folderFor(target: Cartridge, state: State) {
  const folders = await steamFolders();
  if (target.home) return machineFolder(folders, state);
  const known = folderOn(folders, target);
  if (known) return known;
  await setSteamLibrary(target.mount);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const added = folderOn(await steamFolders(), target);
    if (added) return added;
  }
  throw new Error("The cartridge service did not add the Steam library. Is it running?");
}

// ---- Steam's own move, shown like the plugin's transfers ----------------------------------------------------

let move: (Job & { finishedAt?: number }) | null = null;
const listeners = new Set<() => void>();

function setMove(next: typeof move) {
  move = next;
  listeners.forEach((f) => f());
}

/** The current (or just finished) Steam move as a transfer, or null. */
export function useSteamMove(): Job | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  if (!move) return null;
  return { ...move, age: move.finishedAt ? (Date.now() - move.finishedAt) / 1000 : null };
}

export function steamMoveRunning() {
  return move?.state === "running";
}

/** Moves a Steam game with Steam's own "Move install folder" into the target's Steam library. */
export async function moveSteamGame(game: Game, from: Cartridge, to: Cartridge, state: State) {
  if (!game.appid) throw new Error("not a Steam game");
  if (steamMoveRunning()) throw new Error("Steam is moving another game. Wait until it is done.");
  const base: Job = {
    id: "steam-move", kind: "move", title: `Moving ${game.title} to ${to.name}`, state: "running", message: "Preparing",
    error: null, done: 0, total: 0, rate: null, percent: 0, subject: game.title, src_name: from.name, dst_name: to.name,
    age: null, game: game.id,
  };
  setMove(base);
  let last = { at: Date.now(), done: 0 };
  const finish = (fields: Partial<Job>) => {
    registration?.unregister?.();
    setMove({ ...move!, ...fields, finishedAt: Date.now() });
  };
  let registration: any = null;
  try {
    const folder = await folderFor(to, state);
    if (!folder) throw new Error(`${to.name} has no Steam library`);
    setMove({ ...base, message: "Moving files" });
    registration = SteamClient.InstallFolder.RegisterForMoveContentProgress((p: any) => {
      if (!move || move.state !== "running" || (p.appid && p.appid !== game.appid)) return;
      if (p.eError) return finish({ state: "failed", error: `Steam could not move it (error ${p.eError})` });
      const done = Number(p.strBytesMoved) || 0;
      const total = Number(p.strTotalBytesToMove) || 0;
      const now = Date.now();
      const rate = now - last.at > 900 && done > last.done ? ((done - last.done) * 1000) / (now - last.at) : move.rate;
      if (now - last.at > 900) last = { at: now, done };
      setMove({ ...move, done, total, rate, percent: Math.floor(p.flProgress || 0) });
      if (p.appid === game.appid && p.flProgress >= 100) finish({ state: "done", message: `Moved to ${to.name}`, percent: 100 });
    });
    await SteamClient.InstallFolder.MoveInstallFolderForApp(game.appid, folder.index);
  } catch (e) {
    finish({ state: "failed", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export function cancelSteamMove() {
  SteamClient.InstallFolder.CancelMove();
  if (move?.state === "running") {
    setMove({ ...move, state: "cancelled", message: "Cancelled", finishedAt: Date.now() });
  }
}

/** Steam's own uninstall dialog for a Steam game. */
export function uninstallSteamGame(appid: number) {
  SteamClient.Installs.OpenUninstallWizard([appid], false);
}

/** Crops and scales an image (data URL) to a 600x900 portrait JPEG; returns its base64. */
export function coverFromImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = 600,
        h = 900;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const scale = Math.max(w / img.width, h / img.height);
      const sw = w / scale,
        sh = h / scale;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.88).split(",")[1]);
    };
    img.onerror = () => reject(new Error("could not read that image"));
    img.src = dataUrl;
  });
}
