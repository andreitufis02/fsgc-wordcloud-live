const socket = io();

const elements = {
  qrImage: document.getElementById("qrImage"),
  joinLink: document.getElementById("joinLink"),
  copyJoinBtn: document.getElementById("copyJoinBtn"),
  totalCount: document.getElementById("totalCount"),
  uniqueCount: document.getElementById("uniqueCount"),
  clientCount: document.getElementById("clientCount"),
  visibleCount: document.getElementById("visibleCount"),
  topWords: document.getElementById("topWords"),
  liveStatus: document.getElementById("liveStatus"),
  statusLine: document.getElementById("statusLine"),
  cloudStage: document.getElementById("cloudStage"),
  cloudSvg: document.getElementById("cloudSvg"),
  emptyCloud: document.getElementById("emptyCloud"),
  renderBadge: document.getElementById("renderBadge"),
  overflowDock: document.getElementById("overflowDock"),
  recentList: document.getElementById("recentList"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn")
};

const palette = ["#003399", "#121722", "#0c8f9f", "#248360", "#6651c8", "#bd3d35", "#9a7200", "#2158d8"];
const svg = d3.select(elements.cloudSvg);

let config = null;
let snapshot = null;
let renderTimer = 0;
let renderJob = 0;
let activeLayout = null;

socket.on("connect", () => {
  elements.liveStatus.textContent = "Live";
});

socket.on("disconnect", () => {
  elements.liveStatus.textContent = "Reconectare";
  elements.liveStatus.classList.add("locked");
});

socket.on("config", (nextConfig) => {
  config = nextConfig;
  applyConfig();
});

socket.on("snapshot", (nextSnapshot) => {
  snapshot = nextSnapshot;
  renderSnapshot();
  scheduleCloudRender();
});

socket.on("word-added", (event) => {
  elements.renderBadge.textContent = `"${event.word}" a intrat in cloud`;
});

new ResizeObserver(() => scheduleCloudRender()).observe(elements.cloudStage);

elements.copyJoinBtn.addEventListener("click", async () => {
  if (!config?.joinUrl) return;
  try {
    await navigator.clipboard.writeText(config.joinUrl);
    elements.copyJoinBtn.textContent = "Copiat";
    setTimeout(() => {
      elements.copyJoinBtn.textContent = "Copiază linkul";
    }, 1200);
  } catch {
    elements.copyJoinBtn.textContent = "Nu pot copia";
  }
});

elements.exportCsvBtn.addEventListener("click", () => {
  window.location.href = "/api/export.csv";
});

elements.fullscreenBtn.addEventListener("click", async () => {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
    elements.fullscreenBtn.textContent = "Ieși";
  } else {
    await document.exitFullscreen();
    elements.fullscreenBtn.textContent = "Fullscreen";
  }
});

function applyConfig() {
  if (!config) return;
  elements.qrImage.src = config.qrDataUrl;
  elements.joinLink.href = config.joinUrl;
  const url = new URL(config.joinUrl);
  elements.joinLink.replaceChildren(
    document.createTextNode(url.host),
    document.createElement("br"),
    document.createTextNode(url.pathname)
  );
}

function renderSnapshot() {
  if (!snapshot) return;

  elements.totalCount.textContent = snapshot.total;
  elements.uniqueCount.textContent = snapshot.unique;
  elements.clientCount.textContent = snapshot.clients;
  elements.visibleCount.textContent = Math.min(snapshot.unique, snapshot.visibleLimit);

  elements.liveStatus.textContent = snapshot.locked ? "Pauzat" : "Live";
  elements.liveStatus.classList.toggle("locked", snapshot.locked);
  elements.statusLine.textContent = snapshot.total
    ? `${snapshot.total} răspunsuri colectate, ${snapshot.unique} termeni unici. Ultima actualizare: ${formatTime(snapshot.updatedAt)}.`
    : "Aștept primele răspunsuri.";

  renderTopWords(snapshot.counts.slice(0, 7));
  renderRecent(snapshot.recent.slice(0, 5));
}

function renderTopWords(items) {
  elements.topWords.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.innerHTML = "<span>Nu există încă răspunsuri</span><b>0</b>";
    elements.topWords.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const count = document.createElement("b");
    label.textContent = item.word;
    count.textContent = item.count;
    li.append(label, count);
    elements.topWords.appendChild(li);
  }
}

function renderRecent(items) {
  elements.recentList.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.innerHTML = "<span>Cloud pregătit</span><time>scanare QR</time>";
    elements.recentList.appendChild(li);
    return;
  }

  for (const entry of items) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const time = document.createElement("time");
    label.textContent = entry.word;
    time.textContent = formatTime(entry.createdAt);
    li.append(label, time);
    elements.recentList.appendChild(li);
  }
}

function scheduleCloudRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderCloud(), 120);
}

async function renderCloud() {
  if (!snapshot) return;
  const words = snapshot.counts.slice(0, snapshot.visibleLimit);
  elements.emptyCloud.style.display = words.length ? "none" : "grid";

  if (!words.length) {
    svg.selectAll("*").remove();
    elements.overflowDock.classList.remove("show");
    elements.overflowDock.innerHTML = "";
    elements.renderBadge.textContent = "Motor: d3-cloud, layout stabil";
    return;
  }

  const rect = elements.cloudStage.getBoundingClientRect();
  const width = Math.max(360, Math.floor(rect.width));
  const height = Math.max(420, Math.floor(rect.height));
  const job = ++renderJob;
  if (activeLayout) activeLayout.stop();

  const prepared = prepareWords(words, width, height);
  const seed = hashString(prepared.map((word) => `${word.normalized}:${word.count}`).join("|") + `${width}x${height}`);
  const attempts = [1, 0.9, 0.8, 0.7, 0.62, 0.54];
  let placed = [];
  let lastFactor = attempts.at(-1);

  for (const factor of attempts) {
    placed = await runCloudLayout(prepared, width, height, factor, seed + Math.round(factor * 1000));
    if (job !== renderJob) return;
    lastFactor = factor;
    const ratio = placed.length / prepared.length;
    if (placed.length === prepared.length || ratio >= 0.985 || factor === attempts.at(-1)) break;
  }

  drawCloud(placed, prepared, width, height);
  const missing = renderOverflow(placed, prepared);
  const percent = Math.round((placed.length / prepared.length) * 100);
  elements.renderBadge.textContent = missing
    ? `${placed.length}/${prepared.length} în cloud, ${missing} afișate compact`
    : `${placed.length}/${prepared.length} termeni așezați, densitate ${percent}%`;

  if (lastFactor < 0.9) {
    elements.renderBadge.textContent += " · scalare automată";
  }
}

function prepareWords(items, width, height) {
  const max = Math.max(...items.map((item) => item.count));
  const minFont = width < 700 ? 15 : 18;
  const maxFont = Math.min(width * 0.16, height * 0.2, width < 700 ? 68 : 118);
  const scale = d3.scaleSqrt().domain([1, max]).range([minFont, maxFont]);

  return items.map((item, rank) => ({
    text: item.word,
    word: item.word,
    normalized: item.normalized,
    count: item.count,
    rank,
    baseSize: scale(item.count)
  }));
}

function runCloudLayout(words, width, height, factor, seed) {
  return new Promise((resolve) => {
    const random = seededRandom(seed);
    const layoutWords = words.map((word) => ({
      ...word,
      size: Math.max(11, Math.round(word.baseSize * factor))
    }));

    activeLayout = d3.layout.cloud()
      .size([width, height])
      .words(layoutWords)
      .padding((word) => Math.max(1, Math.round((word.rank < 20 ? 5 : 3) * factor)))
      .rotate((word) => rotationFor(word))
      .font("Inter")
      .fontWeight((word) => word.rank < 8 ? 900 : 760)
      .fontSize((word) => word.size)
      .random(random)
      .spiral("archimedean")
      .on("end", (placed) => resolve(placed));

    activeLayout.start();
  });
}

function drawCloud(placed, allWords, width, height) {
  svg.attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`);

  const selection = svg
    .selectAll("text.word")
    .data(placed, (word) => word.normalized);

  selection.exit()
    .transition()
    .duration(220)
    .style("opacity", 0)
    .remove();

  const entered = selection.enter()
    .append("text")
    .attr("class", "word")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .style("font-family", "Inter, ui-sans-serif, system-ui, sans-serif")
    .style("opacity", 0)
    .text((word) => word.text);

  entered.merge(selection)
    .text((word) => word.text)
    .style("font-weight", (word) => word.rank < 8 ? 900 : 760)
    .style("fill", (word) => colorFor(word))
    .transition()
    .duration(680)
    .ease(d3.easeCubicOut)
    .attr("transform", (word) => `translate(${word.x},${word.y}) rotate(${word.rotate})`)
    .style("font-size", (word) => `${word.size}px`)
    .style("opacity", (word) => Math.max(0.72, 1 - word.rank * 0.0025));

  svg.attr("aria-label", `Word cloud cu ${allWords.length} termeni unici`);
}

function renderOverflow(placed, prepared) {
  const placedKeys = new Set(placed.map((word) => word.normalized));
  const missing = prepared.filter((word) => !placedKeys.has(word.normalized));
  elements.overflowDock.innerHTML = "";

  if (!missing.length) {
    elements.overflowDock.classList.remove("show");
    return 0;
  }

  for (const item of missing.slice(0, 30)) {
    const chip = document.createElement("span");
    chip.textContent = item.word;
    elements.overflowDock.appendChild(chip);
  }

  if (missing.length > 30) {
    const chip = document.createElement("span");
    chip.textContent = `+${missing.length - 30}`;
    elements.overflowDock.appendChild(chip);
  }

  elements.overflowDock.classList.add("show");
  return missing.length;
}

function rotationFor(word) {
  if (word.rank < 14) return 0;
  const options = [0, 0, 0, -14, 14, -24, 24];
  return options[hashString(word.normalized) % options.length];
}

function colorFor(word) {
  if (word.rank === 0) return "#003399";
  if (word.rank === 1) return "#121722";
  if (word.rank === 2) return "#ffcc00";
  return palette[hashString(word.normalized) % palette.length];
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
