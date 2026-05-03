"use strict";

const DB_NAME = "deck-shot-trainer";
const DB_VERSION = 1;
const CARD_RATIO = 0.686;

const DEFAULT_SETTINGS = {
  main: {
    mode: "wrap",
    x: 0.4,
    y: 9,
    width: 99.2,
    height: 58,
    cols: 10,
    rows: 5,
    maxCols: 10,
    count: 41,
    gapX: 0.55,
    gapY: 0.85,
    ratio: CARD_RATIO,
  },
  extra: {
    mode: "wrap",
    x: 0.4,
    y: 70.1,
    width: 99.2,
    height: 23,
    cols: 10,
    rows: 2,
    maxCols: 10,
    count: 15,
    gapX: 0.55,
    gapY: 1.8,
    ratio: CARD_RATIO,
  },
};

const CONTROL_DEFS = [
  ["x", "左位置 %", 0, 100, 0.1],
  ["y", "上位置 %", 0, 100, 0.1],
  ["width", "領域幅 %", 1, 100, 0.1],
  ["height", "領域高 %", 1, 100, 0.1],
  ["cols", "旧列数", 1, 20, 1],
  ["rows", "旧行数", 1, 8, 1],
  ["maxCols", "最大列数", 1, 10, 1],
  ["count", "切り出し枚数", { main: 40, extra: 0 }, { main: 60, extra: 15 }, 1],
  ["gapX", "横間隔 %", 0, 10, 0.1],
  ["gapY", "縦間隔 %", 0, 10, 0.1],
  ["ratio", "カード幅/高さ", 0.5, 0.9, 0.001],
];

const state = {
  db: null,
  sourceImage: null,
  sourceName: "",
  settings: structuredClone(DEFAULT_SETTINGS),
  mainCards: [],
  extraCards: [],
  currentHand: [],
  logs: [],
};

const els = {
  saveStatus: document.querySelector("#saveStatus"),
  imageInput: document.querySelector("#imageInput"),
  sourceCanvas: document.querySelector("#sourceCanvas"),
  presetButton: document.querySelector("#presetButton"),
  previewButton: document.querySelector("#previewButton"),
  saveDeckButton: document.querySelector("#saveDeckButton"),
  clearDataButton: document.querySelector("#clearDataButton"),
  mainCards: document.querySelector("#mainCards"),
  extraCards: document.querySelector("#extraCards"),
  handCards: document.querySelector("#handCards"),
  mainCount: document.querySelector("#mainCount"),
  extraCount: document.querySelector("#extraCount"),
  drawButton: document.querySelector("#drawButton"),
  logForm: document.querySelector("#logForm"),
  resultInput: document.querySelector("#resultInput"),
  tagsInput: document.querySelector("#tagsInput"),
  memoInput: document.querySelector("#memoInput"),
  logList: document.querySelector("#logList"),
  logCount: document.querySelector("#logCount"),
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cards")) {
        db.createObjectStore("cards", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("logs")) {
        db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getAll(storeName) {
  const transaction = state.db.transaction(storeName, "readonly");
  return requestToPromise(transaction.objectStore(storeName).getAll());
}

async function getMeta(key) {
  const transaction = state.db.transaction("meta", "readonly");
  const item = await requestToPromise(transaction.objectStore("meta").get(key));
  return item?.value;
}

function setStatus(message) {
  els.saveStatus.textContent = message;
}

function buildControls() {
  for (const scope of ["main", "extra"]) {
    const container = document.querySelector(`[data-scope="${scope}"]`);
    container.replaceChildren();

    for (const [key, label, min, max, step] of CONTROL_DEFS) {
      const id = `${scope}-${key}`;
      const wrapper = document.createElement("label");
      const input = document.createElement("input");
      input.id = id;
      input.type = "number";
      input.min = String(getScopedControlValue(min, scope));
      input.max = String(getScopedControlValue(max, scope));
      input.step = String(step);
      input.value = String(state.settings[scope][key]);
      input.dataset.scope = scope;
      input.dataset.key = key;
      input.addEventListener("input", handleSettingInput);
      wrapper.textContent = label;
      wrapper.append(input);
      container.append(wrapper);
    }
  }
}

function getScopedControlValue(value, scope) {
  return typeof value === "object" ? value[scope] : value;
}

function handleSettingInput(event) {
  const input = event.currentTarget;
  const scope = input.dataset.scope;
  const key = input.dataset.key;
  const value = Number(input.value);

  if (!Number.isFinite(value)) {
    return;
  }

  const normalizedValue = ["cols", "rows", "maxCols", "count"].includes(key) ? Math.round(value) : value;
  state.settings[scope][key] = clampSettingValue(scope, key, normalizedValue);
  drawSourcePreview();
}

function clampSettingValue(scope, key, value) {
  const controlDef = CONTROL_DEFS.find(([controlKey]) => controlKey === key);
  if (!controlDef) {
    return value;
  }

  const min = getScopedControlValue(controlDef[2], scope);
  const max = getScopedControlValue(controlDef[3], scope);
  return Math.min(max, Math.max(min, value));
}

function applyOfficialPreset() {
  state.settings = structuredClone(DEFAULT_SETTINGS);
  buildControls();
  drawSourcePreview();
  setStatus("公式画像プリセット適用済み");
}

async function handleImageInput(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  try {
    const url = URL.createObjectURL(file);
    const image = await loadImage(url);
    URL.revokeObjectURL(url);
    state.sourceImage = image;
    state.sourceName = file.name;
    drawSourcePreview();
    setStatus("画像読込済み");
  } catch (error) {
    setStatus("画像読込失敗");
    console.error(error);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    image.src = src;
  });
}

function drawSourcePreview() {
  const canvas = els.sourceCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1c211e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state.sourceImage) {
    ctx.fillStyle = "#f8f0dc";
    ctx.font = "24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("画像を選択してください", canvas.width / 2, canvas.height / 2);
    return;
  }

  const fit = fitRect(state.sourceImage.width, state.sourceImage.height, canvas.width, canvas.height);
  ctx.drawImage(state.sourceImage, fit.x, fit.y, fit.width, fit.height);
  drawGridOverlay(ctx, fit, "main", "rgba(255, 255, 255, 0.92)");
  drawGridOverlay(ctx, fit, "extra", "rgba(243, 155, 45, 0.95)");
}

function fitRect(srcWidth, srcHeight, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return {
    x: (maxWidth - width) / 2,
    y: (maxHeight - height) / 2,
    width,
    height,
  };
}

function drawGridOverlay(ctx, fit, scope, color) {
  const rect = getRegionRect(state.settings[scope], fit.width, fit.height, fit.x, fit.y);
  const cells = getCells(state.settings[scope], rect);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.lineWidth = 1;
  cells.forEach((cell, index) => {
    if (index < state.settings[scope].count) {
      ctx.strokeRect(cell.x, cell.y, cell.width, cell.height);
    }
  });
  ctx.restore();
}

function getRegionRect(settings, width, height, offsetX = 0, offsetY = 0) {
  return {
    x: offsetX + width * (settings.x / 100),
    y: offsetY + height * (settings.y / 100),
    width: width * (settings.width / 100),
    height: height * (settings.height / 100),
  };
}

function getCells(settings, rect) {
  if (settings.mode === "wrap") {
    return getWrappedCells(settings, rect);
  }

  const cols = Math.max(1, settings.cols);
  const rows = Math.max(1, settings.rows);
  const gapX = rect.width * (settings.gapX / 100);
  const gapY = rect.height * (settings.gapY / 100);
  const cellWidth = (rect.width - gapX * (cols - 1)) / cols;
  const idealHeight = cellWidth / settings.ratio;
  const maxHeight = (rect.height - gapY * (rows - 1)) / rows;
  const cellHeight = Math.min(idealHeight, maxHeight);
  const cells = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x: rect.x + col * (cellWidth + gapX),
        y: rect.y + row * (cellHeight + gapY),
        width: cellWidth,
        height: cellHeight,
      });
    }
  }

  return cells.slice(0, settings.count);
}

function getWrappedCells(settings, rect) {
  const maxCols = Math.max(1, settings.maxCols);
  const rowCounts = buildRowCounts(settings.count, maxCols);
  if (!rowCounts.length) {
    return [];
  }

  const gapX = rect.width * (settings.gapX / 100);
  const gapY = rect.height * (settings.gapY / 100);
  const cellWidth = (rect.width - gapX * (maxCols - 1)) / maxCols;
  const idealHeight = cellWidth / settings.ratio;
  const maxHeight = (rect.height - gapY * (rowCounts.length - 1)) / rowCounts.length;
  const cellHeight = Math.min(idealHeight, maxHeight);
  const cells = [];

  rowCounts.forEach((rowCount, row) => {
    for (let col = 0; col < rowCount; col += 1) {
      cells.push({
        x: rect.x + col * (cellWidth + gapX),
        y: rect.y + row * (cellHeight + gapY),
        width: cellWidth,
        height: cellHeight,
      });
    }
  });

  return cells;
}

function buildRowCounts(count, maxCols) {
  const rowCounts = [];
  let remaining = Math.max(0, count);

  while (remaining > 0) {
    const rowCount = Math.min(remaining, maxCols);
    rowCounts.push(rowCount);
    remaining -= rowCount;
  }

  return rowCounts;
}

async function previewSlices() {
  if (!state.sourceImage) {
    setStatus("先に画像を選択してください");
    return;
  }

  state.mainCards = await createCards("main");
  state.extraCards = await createCards("extra");
  renderAllCards();
  setStatus("プレビュー更新");
}

async function createCards(scope) {
  const rect = getRegionRect(state.settings[scope], state.sourceImage.width, state.sourceImage.height);
  const cells = getCells(state.settings[scope], rect);
  const cards = [];

  for (const [index, cell] of cells.entries()) {
    const canvas = document.createElement("canvas");
    const slice = clampCellToImage(cell, state.sourceImage);
    if (!slice) {
      continue;
    }

    canvas.width = slice.width;
    canvas.height = slice.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      state.sourceImage,
      slice.x,
      slice.y,
      slice.width,
      slice.height,
      0,
      0,
      slice.width,
      slice.height,
    );
    const blob = await canvasToBlob(canvas);
    cards.push({
      id: `${scope}-${String(index + 1).padStart(2, "0")}`,
      scope,
      index: index + 1,
      blob,
      url: URL.createObjectURL(blob),
    });
  }

  return cards;
}

function clampCellToImage(cell, image) {
  const x = Math.max(0, Math.floor(cell.x));
  const y = Math.max(0, Math.floor(cell.y));
  const right = Math.min(image.width, Math.ceil(cell.x + cell.width));
  const bottom = Math.min(image.height, Math.ceil(cell.y + cell.height));
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("カード画像の作成に失敗しました。"));
      }
    }, "image/png");
  });
}

async function saveDeck() {
  if (!state.db) {
    setStatus("保存機能を初期化できていません");
    return;
  }

  if (state.sourceImage) {
    await previewSlices();
  } else if (state.settings.extra.count === 0 && state.extraCards.length) {
    state.extraCards = [];
    renderAllCards();
  }

  if (!state.mainCards.length) {
    setStatus("保存できるカードがありません");
    return;
  }

  const clearTransaction = state.db.transaction("cards", "readwrite");
  clearTransaction.objectStore("cards").clear();
  await transactionComplete(clearTransaction);

  const transaction = state.db.transaction(["cards", "meta"], "readwrite");
  const cardsStore = transaction.objectStore("cards");
  const metaStore = transaction.objectStore("meta");
  for (const card of [...state.mainCards, ...state.extraCards]) {
    cardsStore.put({
      id: card.id,
      scope: card.scope,
      index: card.index,
      blob: card.blob,
      updatedAt: new Date().toISOString(),
    });
  }

  metaStore.put({
    key: "settings",
    value: state.settings,
  });
  metaStore.put({
    key: "sourceName",
    value: state.sourceName,
  });

  await transactionComplete(transaction);
  setStatus("保存済み");
}

function renderAllCards() {
  renderCards(els.mainCards, state.mainCards, "メイン");
  renderCards(els.extraCards, state.extraCards, "EX");
  els.mainCount.textContent = `${state.mainCards.length}枚`;
  els.extraCount.textContent = `${state.extraCards.length}枚`;
}

function renderCards(container, cards, label) {
  if (!cards.length) {
    container.className = "card-grid empty";
    container.textContent = `${label}カードはまだありません。`;
    return;
  }

  container.className = "card-grid";
  container.replaceChildren(...cards.map((card) => createCardElement(card, label)));
}

function createCardElement(card, label) {
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  const caption = document.createElement("span");
  figure.className = "card-thumb";
  image.src = card.url;
  image.alt = `${label} ${card.index}`;
  caption.textContent = `${label} ${card.index}`;
  figure.append(image, caption);
  return figure;
}

function drawHand() {
  if (state.mainCards.length < 5) {
    setStatus("メインカードが5枚未満です");
    return;
  }

  state.currentHand = shuffle([...state.mainCards]).slice(0, 5);
  els.handCards.className = "hand-grid";
  els.handCards.replaceChildren(...state.currentHand.map((card) => createCardElement(card, "初手")));
  setStatus("5枚ドロー済み");
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}

async function saveLog(event) {
  event.preventDefault();
  if (!state.db) {
    setStatus("保存機能を初期化できていません");
    return;
  }

  if (!state.currentHand.length) {
    setStatus("先に5枚ドローしてください");
    return;
  }

  const log = {
    createdAt: new Date().toISOString(),
    result: els.resultInput.value,
    tags: els.tagsInput.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    memo: els.memoInput.value.trim(),
    hand: state.currentHand.map((card) => card.id),
  };

  const transaction = state.db.transaction("logs", "readwrite");
  transaction.objectStore("logs").add(log);
  await transactionComplete(transaction);
  els.logForm.reset();
  await loadLogs();
  setStatus("ログ保存済み");
}

async function loadSavedState() {
  const [cards, settings, sourceName] = await Promise.all([
    getAll("cards"),
    getMeta("settings"),
    getMeta("sourceName"),
  ]);

  if (settings) {
    state.settings = normalizeSettings(settings);
    buildControls();
  }

  if (sourceName) {
    state.sourceName = sourceName;
  }

  state.mainCards = hydrateCards(cards.filter((card) => card.scope === "main"));
  state.extraCards = hydrateCards(cards.filter((card) => card.scope === "extra"));
  renderAllCards();
  await loadLogs();

  if (cards.length) {
    setStatus("保存データ読込済み");
  }
}

async function loadLogs() {
  state.logs = (await getAll("logs")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  renderLogs();
}

function hydrateCards(cards) {
  return cards
    .sort((a, b) => a.index - b.index)
    .map((card) => ({
      ...card,
      url: URL.createObjectURL(card.blob),
    }));
}

function renderLogs() {
  els.logCount.textContent = `${state.logs.length}件`;

  if (!state.logs.length) {
    els.logList.className = "log-list empty";
    els.logList.textContent = "まだログはありません。";
    return;
  }

  els.logList.className = "log-list";
  els.logList.replaceChildren(
    ...state.logs.map((log) => {
      const article = document.createElement("article");
      const meta = document.createElement("div");
      const memo = document.createElement("p");
      article.className = "log-item";
      meta.className = "log-meta";
      meta.textContent = `${formatDate(log.createdAt)} / ${log.result} / 初手: ${log.hand.join(", ")}`;
      if (log.tags.length) {
        const tags = document.createElement("span");
        tags.textContent = `タグ: ${log.tags.join(", ")}`;
        meta.append(tags);
      }
      memo.textContent = log.memo || "メモなし";
      article.append(meta, memo);
      return article;
    }),
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function clearAllData() {
  if (!state.db) {
    setStatus("保存機能を初期化できていません");
    return;
  }

  const confirmed = window.confirm("ブラウザ内に保存したカードとログを削除します。元に戻せません。");
  if (!confirmed) {
    return;
  }

  const transaction = state.db.transaction(["cards", "logs", "meta"], "readwrite");
  transaction.objectStore("cards").clear();
  transaction.objectStore("logs").clear();
  transaction.objectStore("meta").clear();
  await transactionComplete(transaction);

  state.mainCards = [];
  state.extraCards = [];
  state.currentHand = [];
  state.logs = [];
  state.settings = structuredClone(DEFAULT_SETTINGS);
  buildControls();
  renderAllCards();
  renderLogs();
  els.handCards.className = "hand-grid empty";
  els.handCards.textContent = "保存済みメインデッキからドローします。";
  setStatus("データ削除済み");
}

async function init() {
  buildControls();
  drawSourcePreview();

  try {
    state.db = await openDatabase();
    await loadSavedState();
  } catch (error) {
    setStatus("保存機能エラー");
    console.error(error);
  }

  els.imageInput.addEventListener("change", handleImageInput);
  els.previewButton.addEventListener("click", previewSlices);
  els.saveDeckButton.addEventListener("click", saveDeck);
  els.drawButton.addEventListener("click", drawHand);
  els.logForm.addEventListener("submit", saveLog);
  els.clearDataButton.addEventListener("click", clearAllData);
  els.presetButton.addEventListener("click", applyOfficialPreset);
}

init();

function normalizeSettings(settings) {
  return {
    main: normalizeScopeSettings("main", settings.main),
    extra: normalizeScopeSettings("extra", settings.extra),
  };
}

function normalizeScopeSettings(scope, settings) {
  const fallback = structuredClone(DEFAULT_SETTINGS[scope]);
  if (!settings) {
    return fallback;
  }

  const normalized = {
    ...fallback,
    ...settings,
  };

  if (!Object.hasOwn(settings, "mode")) {
    normalized.mode = "grid";
  }
  if (!Object.hasOwn(settings, "maxCols")) {
    normalized.maxCols = settings.cols ?? fallback.maxCols;
  }

  normalized.count = clampSettingValue(scope, "count", normalized.count);
  normalized.maxCols = clampSettingValue(scope, "maxCols", normalized.maxCols);
  return normalized;
}
