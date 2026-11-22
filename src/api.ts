import { callable } from "@decky/api";

export type Game = {
  /** The id from cartridge.json, or "steam:<appid>" for a Steam game. */
  id: string;
  /** "cartridge": games/<id> with its launch.sh. "steam": installed in a Steam library on that drive. */
  kind: "cartridge" | "steam";
  title: string;
  launch: string | null;
  present: boolean;
  size: number | null;
  appid: number | null;
  /** The game's Steam shortcut points at this copy and is shown (always true for Steam games). */
  active: boolean;
  /** The Steam library folder a Steam game is installed in. */
  library: string | null;
};

export type Cartridge = {
  mount: string;
  home: boolean;
  exists: boolean;
  id: string;
  name: string;
  format: number;
  /** Shell colour "#rrggbb" from the manifest, or null. */
  color: string | null;
  free: number;
  total: number;
  /** "cover.jpg?<mtime>" when the cartridge has a cover. */
  cover: string | null;
  /** USB link speed in Mbit/s (480 = USB 2). */
  speed: number | null;
  model: string | null;
  dev: string | null;
  games: Game[];
  steam_library: string | null;
};

export type Partition = {
  name: string;
  size: number;
  fstype: string | null;
  label: string | null;
  mounts: string[];
  used: number | null;
  entries: string[];
};

export type Drive = {
  dev: string;
  name: string;
  model: string;
  serial: string | null;
  size: number;
  speed: number | null;
  partitions: Partition[];
  token: string;
};

export type Job = {
  id: string;
  kind: "copy" | "move" | "remove" | "format";
  title: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  message: string;
  error: string | null;
  done: number;
  total: number;
  /** Bytes per second while copying. */
  rate: number | null;
  /** Progress in percent when bytes are unknown (Steam's own moves). */
  percent?: number;
  /** The game (or new cartridge name), and where from / to. */
  subject?: string;
  src_name?: string;
  dst_name?: string;
  /** Seconds since the job finished (null while it runs). */
  age: number | null;
  game?: string;
  src?: string;
  dst?: string;
  mount?: string;
};

export type Agent = {
  installed: boolean;
  running: boolean;
  pid: number;
  version: number | null;
  bundled: number | null;
};

export type State = {
  cartridges: Cartridge[];
  drives: Drive[];
  agent: Agent;
  jobs: Job[];
  home_path: string;
  deck: boolean;
};

export const getState = callable<[], State>("get_state");
export const getToken = callable<[], string>("get_token");
export const getJobs = callable<[], Job[]>("get_jobs");
export const getCover = callable<[mount: string], string | null>("get_cover");
export const readImage = callable<[path: string], string | null>("read_image");
export const getGameArt = callable<[mount: string, gameId: string], string | null>("get_game_art");
export const setCover = callable<[mount: string, jpegBase64: string | null], boolean>("set_cover");
export const setColor = callable<[mount: string, color: string | null], boolean>("set_color");
export const renameCartridge = callable<[mount: string, name: string], boolean>("rename_cartridge");
export const setSteamLibrary = callable<[mount: string], string>("set_steam_library");
export type Holder = { pid: number; name: string; uid: number; cmd: string; closable: boolean };
export const eject = callable<[mount: string, closePrograms: boolean], { ok: boolean; busy: Holder[] }>("eject");
export const installAgent = callable<[], string>("install_agent");
export const cancelJob = callable<[id: string], boolean>("cancel_job");
export const copyGame = callable<[src: string, gameId: string, dst: string, move: boolean], Job>("copy_game");
export const removeGame = callable<[mount: string, gameId: string], Job>("remove_game");
export const formatDrive = callable<
  [dev: string, token: string, name: string, coverBase64: string | null, color: string | null],
  Job
>(
  "format_drive",
);
