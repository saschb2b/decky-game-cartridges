import { toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { getJobs, getState, getToken, Job, State } from "./api";
import { syncCollections } from "./steam";

// One shared copy of the backend's state for the Quick Access panel, the modals and the library's
// context menu (which has to decide synchronously whether a game gets the cartridge entry).
let state: State | null = null;
const listeners = new Set<(s: State | null) => void>();
let refreshing: Promise<State | null> | null = null;
let jobTimer: number | null = null;
const seenFinished = new Set<string>();

function publish(next: State | null) {
  state = next;
  listeners.forEach((fn) => fn(state));
}

export function currentState() {
  return state;
}

export function refresh(): Promise<State | null> {
  if (refreshing) return refreshing;
  refreshing = getState()
    .then((next) => {
      publish(next);
      syncCollections(next).catch((e) => console.warn("game cartridges: collections", e));
      watchJobs(next.jobs);
      return next;
    })
    .catch((e) => {
      console.error("game cartridges: get_state", e);
      return state;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function active(jobs: Job[]) {
  return jobs.some((j) => j.state === "queued" || j.state === "running");
}

function announce(jobs: Job[]) {
  for (const job of jobs) {
    if ((job.state === "done" || job.state === "failed") && !seenFinished.has(job.id)) {
      seenFinished.add(job.id);
      toaster.toast({
        title: job.state === "done" ? "Game Cartridges" : "Game Cartridges: failed",
        body: `${job.title}: ${job.state === "done" ? job.message : job.error}`,
      });
    }
  }
}

/** Polls the jobs every second while one runs, then refreshes the whole state once. */
export function watchJobs(jobs: Job[]) {
  jobs.filter((j) => j.state !== "queued" && j.state !== "running").forEach((j) => seenFinished.add(j.id));
  if (!active(jobs) || jobTimer !== null) return;
  const tick = async () => {
    let current: Job[] = [];
    try {
      current = await getJobs();
    } catch (e) {
      console.error(e);
    }
    if (state) publish({ ...state, jobs: current });
    announce(current);
    if (active(current)) {
      jobTimer = window.setTimeout(tick, 1000);
    } else {
      jobTimer = null;
      refresh();
    }
  };
  jobTimer = window.setTimeout(tick, 1000);
}

export function startedJob(job: Job) {
  if (state) publish({ ...state, jobs: [...state.jobs.filter((j) => j.id !== job.id), job] });
  watchJobs([job]);
}

// Polls a cheap change token so the context menu and panel always know the current cartridges.
let token = "";
let tokenTimer: number | null = null;

export function startWatching() {
  const tick = async () => {
    try {
      const next = await getToken();
      if (next !== token) {
        token = next;
        await refresh();
      }
    } catch (e) {
      console.warn("game cartridges: token", e);
    }
    tokenTimer = window.setTimeout(tick, 3000);
  };
  tick();
}

export function stopWatching() {
  if (tokenTimer !== null) window.clearTimeout(tokenTimer);
  tokenTimer = null;
}

export function useCartridgeState(poll = 0): State | null {
  const [value, setValue] = useState<State | null>(state);
  useEffect(() => {
    listeners.add(setValue);
    refresh();
    const timer = poll ? window.setInterval(refresh, poll) : null;
    return () => {
      listeners.delete(setValue);
      if (timer) window.clearInterval(timer);
    };
  }, [poll]);
  return value;
}

export function fmtBytes(n: number | null | undefined) {
  if (n === null || n === undefined) return "…";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

export function errorText(e: unknown) {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^.*?RuntimeError: /s, "");
}
