// "Game cartridge…" in a game's options menu in the Steam library (the ... / Options button).
// Same hooking approach as other Decky plugins that add library menu entries (e.g. SteamGridDB).
import {
  afterPatch,
  Export,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
  MenuItem,
  Patch,
  showModal,
} from "@decky/ui";
import { FC } from "react";
import { GameModal } from "./modals";
import { isListed } from "./steam";
import { currentState } from "./store";

const KEY = "game-cartridges-entry";

/** What the entry does for this app, or null when the app can't go on a cartridge. */
function actionFor(appid: number): (() => void) | null {
  const state = currentState();
  if (!state) return null;
  const cart = state.cartridges.find((c) => c.games.some((g) => g.appid === appid));
  const game = cart?.games.find((g) => g.appid === appid);
  if (!cart || !game || !isListed(game)) return null;
  // A Steam game on this machine has nowhere to go until a cartridge is plugged in.
  if (game.kind === "steam" && cart.home && !state.cartridges.some((c) => !c.home && c.exists)) return null;
  return () => showModal(<GameModal gameId={game.id} from={cart.mount} />);
}

function splice(children: any[], appid: number) {
  const action = actionFor(appid);
  if (!action) return;
  const props = children.findIndex((item) =>
    findInReactTree(item, (x) => x?.onSelected && x.onSelected.toString().includes("AppProperties")),
  );
  children.splice(props >= 0 ? props : children.length, 0, (
    <MenuItem key={KEY} onSelected={action}>
      Game cartridge…
    </MenuItem>
  ));
}

function isAppMenu(items: any[]) {
  return (
    !!items?.length &&
    !!findInReactTree(items, (x) => x?.props?.onSelected && x.props.onSelected.toString().includes("launchSource"))
  );
}

function dropOurs(items: any[]) {
  const i = items.findIndex((x: any) => x?.key === KEY);
  if (i !== -1) items.splice(i, 1);
}

function appidIn(items: any[], fallback: number) {
  const owner = items.find((x: any) => x?._owner?.pendingProps?.overview?.appid && x._owner.pendingProps.overview.appid !== fallback);
  if (owner) return owner._owner.pendingProps.overview.appid as number;
  const found = findInTree(items, (x) => x?.app?.appid, { walkable: ["props", "children"] });
  return (found?.app?.appid as number) ?? fallback;
}

export function patchContextMenu(): () => void {
  let LibraryContextMenu: any;
  try {
    LibraryContextMenu = fakeRenderComponent(
      Object.values(findModuleByExport((e: Export) => e?.toString && e.toString().includes("().LibraryContextMenu"))).find(
        (sibling: any) => sibling?.toString().includes("navigator:"),
      ) as FC,
    ).type;
  } catch (e) {
    console.error("game cartridges: library context menu not found", e);
    return () => {};
  }
  const patches: Patch[] = [];
  const patchedMenus = new WeakSet<object>();
  let inner = false;
  patches.push(
    afterPatch(LibraryContextMenu.prototype, "render", (_: any[], component: any) => {
      let appid: number = component._owner?.pendingProps?.overview?.appid;
      if (!appid) {
        const found = findInTree(component.props.children, (x) => x?.app?.appid, { walkable: ["props", "children"] });
        appid = found?.app?.appid;
      }
      if (!inner) {
        inner = true;
        patches.push(
          afterPatch(component, "type", (_: any, ret: any) => {
            if (patchedMenus.has(ret.type.prototype)) return ret;
            patchedMenus.add(ret.type.prototype);
            patches.push(
              afterPatch(ret.type.prototype, "render", (_: any, ret2: any) => {
                const items = ret2.props.children[0];
                if (!isAppMenu(items)) return ret2;
                try {
                  dropOurs(items);
                  splice(items, appidIn(items, appid));
                } catch (e) {
                  console.warn("game cartridges: menu", e);
                }
                return ret2;
              }),
            );
            patches.push(
              afterPatch(ret.type.prototype, "shouldComponentUpdate", ([next]: any, update: any) => {
                try {
                  dropOurs(next.children);
                  if (update === true && isAppMenu(next.children)) splice(next.children, appidIn(next.children, appid));
                } catch {
                  /* another menu */
                }
                return update;
              }),
            );
            return ret;
          }),
        );
      } else if (appid) {
        try {
          dropOurs(component.props.children);
          splice(component.props.children, appid);
        } catch {
          /* another menu */
        }
      }
      return component;
    }),
  );
  return () => patches.forEach((p) => p.unpatch());
}
