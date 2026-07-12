const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9222);
const targetUrl = process.env.APP_BASE_URL
  ? `${process.env.APP_BASE_URL}/purchases/new`
  : "http://127.0.0.1:3000/purchases/new";

const target = await fetch(
  `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`,
  { method: "PUT" },
).then((response) => response.json());

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
const exceptions = [];
const consoleErrors = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map(a => a.value ?? a.description).join(" "));
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function command(method, params = {}) {
  nextId += 1;
  socket.send(JSON.stringify({ id: nextId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(nextId, { resolve, reject });
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

await Promise.all([
  command("Runtime.enable"),
  command("Page.enable"),
]);
await command("Page.reload", { ignoreCache: true });

// Wait for page to load
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const ready = await evaluate(`document.readyState === "complete"`);
  if (ready) break;
}

// Check if React has hydrated - look for React fiber on the root
const reactCheck = await evaluate(`(() => {
  const root = document.getElementById('__next');
  const fiberKeys = root ? Object.keys(root).filter(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternal')) : [];
  const allEls = document.querySelectorAll('*');
  let fiberCount = 0;
  for (const el of allEls) {
    if (Object.keys(el).some(k => k.startsWith('__reactFiber'))) fiberCount++;
  }
  const buttons = [...document.querySelectorAll("button")];
  return {
    rootFiberKeys: fiberKeys.join(','),
    totalElements: allEls.length,
    elementsWithFiber: fiberCount,
    buttons: buttons.map(b => ({
      text: b.textContent?.trim()?.slice(0, 30),
      type: b.type,
      hasFiber: Object.keys(b).some(k => k.startsWith('__reactFiber')),
    })),
  };
})()`);

// Try clicking the "添加商品" button
const beforeProducts = await evaluate(
  `[...document.querySelectorAll("h3")].map(n => n.textContent)`,
);

const buttonPos = await evaluate(`(() => {
  const btn = [...document.querySelectorAll("button")].find(b => b.textContent?.includes("添加商品"));
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
})()`);

if (buttonPos) {
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed", x: buttonPos.x, y: buttonPos.y, button: "left", clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: buttonPos.x, y: buttonPos.y, button: "left", clickCount: 1,
  });
}
await new Promise((resolve) => setTimeout(resolve, 500));

const afterProducts = await evaluate(
  `[...document.querySelectorAll("h3")].map(n => n.textContent)`,
);

console.log(JSON.stringify({
  reactCheck,
  beforeProducts,
  clicked: Boolean(buttonPos),
  afterProducts,
  exceptions: exceptions.slice(0, 5),
  consoleErrors: consoleErrors.slice(0, 5),
}, null, 2));

await command("Page.close");
socket.close();
