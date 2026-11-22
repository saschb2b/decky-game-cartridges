// Steam-side helpers: the collection per cartridge, Steam library folders on cartridges, artwork.
// Shortcuts themselves are the cartridge agent's job (see FORMAT.md), never added here.
import type { Cartridge, State } from "./api";

declare const SteamClient: any;
declare const appStore: any;
declare const collectionStore: any;

const COLLECTIONS_KEY = "game-cartridges:collections";

export const NON_STEAM = 1073741824;

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
    const ids = cart.games.map((g) => g.appid).filter((id): id is number => !!id && !!overview(id));
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

export type SteamFolder = { index: number; path: string; free: number; mounted: boolean; apps: number[] };

export async function steamFolders(): Promise<SteamFolder[]> {
  const folders = await SteamClient.InstallFolder.GetInstallFolders();
  return folders.map((f: any) => ({
    index: f.nFolderIndex,
    path: f.strFolderPath,
    free: Number(f.nFreeSpace),
    mounted: f.bIsMounted,
    apps: (f.vecApps || []).map((a: any) => a.nAppID),
  }));
}

/** The Steam library folder Steam knows on this cartridge, if any. */
export function folderOn(folders: SteamFolder[], cart: Cartridge) {
  return folders.find((f) => f.path === cart.steam_library || f.path.startsWith(cart.mount + "/")) ?? null;
}

export async function addSteamLibrary(path: string, label: string) {
  await SteamClient.InstallFolder.AddInstallFolder(path);
  const folder = (await steamFolders()).find((f) => f.path === path);
  if (folder) SteamClient.InstallFolder.SetFolderLabel(folder.index, label);
  return folder;
}

export function moveSteamGame(appid: number, folderIndex: number) {
  return SteamClient.InstallFolder.MoveInstallFolderForApp(appid, folderIndex);
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
