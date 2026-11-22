// Drive Steam's CEF over its remote debugging port (through an SSH tunnel):
//   node tools/deck.mjs eval TARGET 'js expression'
//   node tools/deck.mjs shot TARGET out.png
// TARGET is a page title such as SharedJSContext or QuickAccess_uid2.
const [, , action, target, arg] = process.argv;
const base = process.env.CEF ?? "http://127.0.0.1:18080";
const pages = await (await fetch(`${base}/json`)).json();
const page = pages.find((p) => p.title === target) ?? pages.find((p) => p.title.startsWith(target));
if (!page) throw new Error(`No page ${target}: ${pages.map((p) => p.title).join(", ")}`);
const ws = new WebSocket(page.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, base.replace("http", "ws")));
await new Promise((resolve) => ws.addEventListener("open", resolve));
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mine = ++id;
    ws.addEventListener("message", function on(event) {
      const data = JSON.parse(event.data);
      if (data.id !== mine) return;
      ws.removeEventListener("message", on);
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
    });
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
if (action === "eval") {
  const result = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(result.exceptionDetails ?? result.result.value, null, 1));
} else if (action === "keys") {
  // Steam treats arrow keys, Enter and Escape as the D-pad, A and B.
  const codes = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27 };
  for (const key of arg.split(",")) {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key] });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log("sent", arg);
} else if (action === "shot") {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  (await import("node:fs")).writeFileSync(arg, Buffer.from(data, "base64"));
  console.log(arg);
}
ws.close();
