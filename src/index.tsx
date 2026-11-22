import { definePlugin } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaSdCard } from "react-icons/fa";
import { patchContextMenu } from "./contextMenu";
import { QuickPanel } from "./quick";
import { startWatching, stopWatching } from "./store";

export default definePlugin(() => {
  const unpatchMenu = patchContextMenu();
  startWatching();
  return {
    name: "Game Cartridges",
    titleView: <div className={staticClasses.Title}>Game Cartridges</div>,
    content: <QuickPanel />,
    icon: <FaSdCard />,
    onDismount() {
      unpatchMenu();
      stopWatching();
    },
  };
});
