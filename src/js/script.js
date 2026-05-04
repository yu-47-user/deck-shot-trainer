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
  { key: "x", label: "左位置 %", min: 0, max: 100, step: 0.1 },
  { key: "y", label: "上位置 %", min: 0, max: 100, step: 0.1 },
  { key: "width", label: "領域幅 %", min: 1, max: 100, step: 0.1 },
  { key: "height", label: "領域高 %", min: 1, max: 100, step: 0.1 },
  { key: "cols", label: "列数", min: 1, max: 20, step: 1, modes: ["grid"] },
  { key: "rows", label: "行数", min: 1, max: 8, step: 1, modes: ["grid"] },
  { key: "maxCols", label: "最大列数", min: 1, max: 10, step: 1, modes: ["wrap"] },
  { key: "count", label: "切り出し枚数", min: { main: 40, extra: 0 }, max: { main: 60, extra: 15 }, step: 1, group: "primary" },
  { key: "gapX", label: "横間隔 %", min: 0, max: 10, step: 0.1 },
  { key: "gapY", label: "縦間隔 %", min: 0, max: 10, step: 0.1 },
  { key: "ratio", label: "カード幅/高さ", min: 0.5, max: 0.9, step: 0.001 },
];

const BOARD_ZONE_GROUPS = {
  extraMonster: ["extra-monster-1", "extra-monster-2"],
  monster: ["monster-1", "monster-2", "monster-3", "monster-4", "monster-5"],
  spell: ["spell-1", "spell-2", "spell-3", "spell-4", "spell-5"],
};

const BOARD_ZONE_LABELS = new Map([
  ...BOARD_ZONE_GROUPS.extraMonster.map((zone, index) => [zone, `EX${index + 1}`]),
  ...BOARD_ZONE_GROUPS.monster.map((zone, index) => [zone, `M${index + 1}`]),
  ...BOARD_ZONE_GROUPS.spell.map((zone, index) => [zone, `S/T${index + 1}`]),
  ["field", "フィールド"],
  ["hand", "手札"],
  ["graveyard", "墓地"],
  ["banished", "除外"],
]);

const FIELD_ZONES = new Set([
  "field",
  ...BOARD_ZONE_GROUPS.extraMonster,
  ...BOARD_ZONE_GROUPS.monster,
  ...BOARD_ZONE_GROUPS.spell,
]);

const DRAG_DATA = {
  boardCard: "application/x-deck-shot-board-card",
  extraCard: "application/x-deck-shot-extra-card",
};

const state = {
  db: null,
  sourceImage: null,
  sourceName: "",
  settings: structuredClone(DEFAULT_SETTINGS),
  mainCards: [],
  extraCards: [],
  currentHand: [],
  boardCards: [],
  moveHistory: [],
  nextBoardCardId: 1,
  selectedBoardCardId: null,
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
  extraBoardCards: document.querySelector("#extraBoardCards"),
  selectedCardStatus: document.querySelector("#selectedCardStatus"),
  mainCount: document.querySelector("#mainCount"),
  extraCount: document.querySelector("#extraCount"),
  drawButton: document.querySelector("#drawButton"),
  resetBoardButton: document.querySelector("#resetBoardButton"),
  appendBoardButton: document.querySelector("#appendBoardButton"),
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

function buildPracticeZones() {
  for (const [group, zones] of Object.entries(BOARD_ZONE_GROUPS)) {
    const row = document.querySelector(`[data-zone-group="${group}"]`);
    if (!row) {
      continue;
    }

    row.replaceChildren(
      ...zones.map((zone) => {
        const zoneElement = document.createElement("div");
        zoneElement.className = "board-zone drop-zone";
        zoneElement.dataset.zone = zone;
        registerDropZone(zoneElement);
        return zoneElement;
      }),
    );
  }

  document.querySelectorAll(".drop-zone").forEach(registerDropZone);
}

function registerDropZone(zoneElement) {
  if (zoneElement.dataset.dropReady === "true") {
    return;
  }

  zoneElement.dataset.dropReady = "true";
  zoneElement.tabIndex = 0;
  zoneElement.setAttribute("role", "button");
  zoneElement.addEventListener("dragover", handleBoardDragOver);
  zoneElement.addEventListener("drop", handleBoardDrop);
  zoneElement.addEventListener("click", handleZoneClick);
  zoneElement.addEventListener("keydown", handleZoneKeydown);
}

function buildControls() {
  for (const scope of ["main", "extra"]) {
    const containers = document.querySelectorAll(`[data-scope="${scope}"]`);
    containers.forEach((container) => container.replaceChildren());

    for (const controlDef of CONTROL_DEFS) {
      if (controlDef.modes && !controlDef.modes.includes(state.settings[scope].mode)) {
        continue;
      }

      const { key, label, min, max, step } = controlDef;
      const group = controlDef.group ?? "advanced";
      const container = document.querySelector(`[data-scope="${scope}"][data-control-group="${group}"]`);
      if (!container) {
        continue;
      }

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
  const controlDef = CONTROL_DEFS.find((control) => control.key === key);
  if (!controlDef) {
    return value;
  }

  const min = getScopedControlValue(controlDef.min, scope);
  const max = getScopedControlValue(controlDef.max, scope);
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
  const existingCards = new Map(state[`${scope}Cards`].map((card) => [card.id, card]));
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
    const id = `${scope}-${String(index + 1).padStart(2, "0")}`;
    cards.push({
      id,
      scope,
      index: index + 1,
      blob,
      url: URL.createObjectURL(blob),
      isStarter: Boolean(existingCards.get(id)?.isStarter),
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
      isStarter: Boolean(card.isStarter),
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
  renderCards(els.mainCards, state.mainCards, "メイン", { canMarkStarter: true });
  renderCards(els.extraCards, state.extraCards, "EX");
  renderExtraBoardCards();
  els.mainCount.textContent = `${state.mainCards.length}枚`;
  els.extraCount.textContent = `${state.extraCards.length}枚`;
}

function renderCards(container, cards, label, options = {}) {
  if (!cards.length) {
    container.className = "card-grid empty";
    container.textContent = `${label}カードはまだありません。`;
    return;
  }

  container.className = "card-grid";
  container.replaceChildren(...cards.map((card) => createCardElement(card, label, options)));
}

function createCardElement(card, label, options = {}) {
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  figure.className = "card-thumb";
  if (card.isStarter) {
    figure.classList.add("is-starter");
  }

  image.src = card.url;
  image.alt = `${label} ${card.index}`;
  figure.append(image);

  if (options.canMarkStarter) {
    const starterButton = document.createElement("button");
    starterButton.className = "starter-toggle";
    starterButton.type = "button";
    starterButton.textContent = "初動";
    starterButton.setAttribute("aria-pressed", String(Boolean(card.isStarter)));
    starterButton.setAttribute("aria-label", `${label} ${card.index}を初動カードとして${card.isStarter ? "解除" : "マーキング"}`);
    starterButton.addEventListener("click", () => toggleStarterCard(card));
    figure.append(starterButton);
  } else if (card.isStarter) {
    const starterBadge = document.createElement("span");
    starterBadge.className = "starter-badge";
    starterBadge.textContent = "初動";
    figure.append(starterBadge);
  }

  return figure;
}

function createBoardCardElement(boardCard) {
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  const label = document.createElement("figcaption");
  figure.className = "card-thumb board-card";
  if (boardCard.isStarter) {
    figure.classList.add("is-starter");
  }
  if (boardCard.instanceId === state.selectedBoardCardId) {
    figure.classList.add("is-selected");
  }

  figure.tabIndex = 0;
  figure.draggable = true;
  figure.dataset.instanceId = boardCard.instanceId;
  figure.setAttribute("role", "button");
  figure.setAttribute("aria-pressed", String(boardCard.instanceId === state.selectedBoardCardId));
  figure.setAttribute("aria-label", `${getBoardCardLabel(boardCard)}を選択`);
  figure.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleBoardCardSelection(boardCard.instanceId);
  });
  figure.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleBoardCardSelection(boardCard.instanceId);
    }
  });
  figure.addEventListener("dragstart", handleBoardDragStart);

  image.src = boardCard.url;
  image.alt = getBoardCardLabel(boardCard);
  label.textContent = getBoardCardLabel(boardCard);
  figure.append(image, label);
  return figure;
}

function renderPracticeBoard() {
  syncBoardStarterFlags();

  for (const [zone, label] of BOARD_ZONE_LABELS) {
    const zoneElement = document.querySelector(`[data-zone="${zone}"]`);
    if (!zoneElement) {
      continue;
    }

    const cards = state.boardCards.filter((card) => card.zone === zone);
    const baseClass = getZoneBaseClass(zone);
    zoneElement.className = `${baseClass} drop-zone${cards.length ? "" : " empty-zone"}`;
    zoneElement.dataset.zone = zone;
    zoneElement.dataset.zoneLabel = label;
    zoneElement.setAttribute("aria-label", `${label}へ選択カードを移動`);

    if (!cards.length) {
      zoneElement.textContent = getEmptyZoneText(zone, label);
      continue;
    }

    zoneElement.replaceChildren(...cards.map(createBoardCardElement));
  }

  const selectedCard = getSelectedBoardCard();
  els.selectedCardStatus.textContent = selectedCard ? `${getBoardCardLabel(selectedCard)}を選択中` : "未選択";
}

function renderExtraBoardCards() {
  if (!els.extraBoardCards) {
    return;
  }

  if (!state.extraCards.length) {
    els.extraBoardCards.className = "card-grid compact-grid extra-return-zone empty";
    els.extraBoardCards.textContent = "保存済みEXカードがここに表示されます。";
    return;
  }

  els.extraBoardCards.className = "card-grid compact-grid extra-return-zone";
  els.extraBoardCards.replaceChildren(...state.extraCards.map(createExtraBoardSourceElement));
}

function createExtraBoardSourceElement(card) {
  const button = document.createElement("button");
  const image = document.createElement("img");
  button.className = "extra-source-card";
  button.type = "button";
  button.draggable = true;
  button.dataset.cardId = card.id;
  button.setAttribute("aria-label", `EX ${card.index}を選択して移動先を選ぶ`);
  button.addEventListener("click", () => addExtraCardToBoard(card));
  button.addEventListener("dragstart", handleExtraSourceDragStart);

  image.src = card.url;
  image.alt = `EX ${card.index}`;
  button.append(image);
  return button;
}

function getZoneBaseClass(zone) {
  if (zone === "hand") {
    return "hand-grid";
  }
  if (zone === "graveyard" || zone === "banished" || zone === "field") {
    return "pile-zone";
  }
  return "board-zone";
}

function getEmptyZoneText(zone, label) {
  if (zone === "hand") {
    return state.currentHand.length ? "移動したカードはここへ戻せます。" : "保存済みメインデッキからドローします。";
  }
  if (zone === "graveyard" || zone === "banished") {
    return "0枚";
  }
  if (zone === "field") {
    return "空き";
  }
  return label;
}

function handleBoardDragStart(event) {
  const instanceId = event.currentTarget.dataset.instanceId;
  event.dataTransfer.setData(DRAG_DATA.boardCard, instanceId);
  event.dataTransfer.setData("text/plain", instanceId);
  event.dataTransfer.effectAllowed = "move";
}

function handleExtraSourceDragStart(event) {
  const cardId = event.currentTarget.dataset.cardId;
  event.dataTransfer.setData(DRAG_DATA.extraCard, cardId);
  event.dataTransfer.setData("text/plain", cardId);
  event.dataTransfer.effectAllowed = "copy";
}

function handleBoardDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = hasDragDataType(event, DRAG_DATA.extraCard) ? "copy" : "move";
}

function handleBoardDrop(event) {
  event.preventDefault();
  const targetZone = event.currentTarget.dataset.zone;
  const extraCardId = event.dataTransfer.getData(DRAG_DATA.extraCard);
  if (extraCardId) {
    const card = state.extraCards.find((item) => item.id === extraCardId);
    if (card) {
      addExtraCardToBoard(card, targetZone);
    }
    return;
  }

  const instanceId = event.dataTransfer.getData(DRAG_DATA.boardCard) || event.dataTransfer.getData("text/plain");
  moveBoardCard(instanceId, targetZone);
}

function handleExtraDeckDragOver(event) {
  if (!hasDragDataType(event, DRAG_DATA.boardCard)) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function handleExtraDeckDrop(event) {
  event.preventDefault();
  const instanceId = event.dataTransfer.getData(DRAG_DATA.boardCard) || event.dataTransfer.getData("text/plain");
  returnBoardCardToExtraDeck(instanceId);
}

function hasDragDataType(event, type) {
  return Array.from(event.dataTransfer?.types ?? []).includes(type);
}

function handleZoneClick(event) {
  if (event.target.closest(".board-card") || !state.selectedBoardCardId) {
    return;
  }

  moveBoardCard(state.selectedBoardCardId, event.currentTarget.dataset.zone);
}

function handleZoneKeydown(event) {
  if ((event.key !== "Enter" && event.key !== " ") || !state.selectedBoardCardId) {
    return;
  }

  event.preventDefault();
  moveBoardCard(state.selectedBoardCardId, event.currentTarget.dataset.zone);
}

function toggleBoardCardSelection(instanceId) {
  const normalizedId = Number(instanceId);
  state.selectedBoardCardId = state.selectedBoardCardId === normalizedId ? null : normalizedId;
  renderPracticeBoard();
}

function moveBoardCard(instanceId, targetZone) {
  const normalizedId = Number(instanceId);
  const card = state.boardCards.find((item) => item.instanceId === normalizedId);
  if (!card || !BOARD_ZONE_LABELS.has(targetZone)) {
    return;
  }

  const previousZone = card.zone;
  if (previousZone === targetZone) {
    state.selectedBoardCardId = null;
    renderPracticeBoard();
    return;
  }

  if (FIELD_ZONES.has(targetZone)) {
    const occupiedCard = state.boardCards.find((item) => item.zone === targetZone && item.instanceId !== normalizedId);
    if (occupiedCard) {
      occupiedCard.zone = "hand";
      recordMove(occupiedCard, targetZone, "hand");
    }
  }

  card.zone = targetZone;
  state.selectedBoardCardId = null;
  recordMove(card, previousZone, targetZone);
  renderPracticeBoard();
  setStatus(`${getBoardCardLabel(card)}を${BOARD_ZONE_LABELS.get(targetZone)}へ移動しました`);
}

function recordMove(card, fromZone, toZone, fromLabel, toLabel) {
  state.moveHistory.push({
    cardId: card.cardId,
    label: getBoardCardLabel(card),
    from: fromZone,
    fromLabel: fromLabel ?? BOARD_ZONE_LABELS.get(fromZone),
    to: toZone,
    toLabel: toLabel ?? BOARD_ZONE_LABELS.get(toZone),
    movedAt: new Date().toISOString(),
  });
}

function resetPracticeBoard() {
  state.boardCards = state.currentHand.map((card) => createBoardCard(card, "hand"));
  state.moveHistory = [];
  state.selectedBoardCardId = null;
  renderPracticeBoard();
  setStatus(state.currentHand.length ? "盤面を初手に戻しました" : "先に5枚ドローしてください");
}

function addExtraCardToBoard(card, targetZone = "hand") {
  if (!BOARD_ZONE_LABELS.has(targetZone)) {
    return;
  }

  const boardCard = createBoardCard(card, targetZone);
  if (FIELD_ZONES.has(targetZone)) {
    const occupiedCard = state.boardCards.find((item) => item.zone === targetZone);
    if (occupiedCard) {
      occupiedCard.zone = "hand";
      recordMove(occupiedCard, targetZone, "hand");
    }
  }

  state.boardCards.push(boardCard);
  state.selectedBoardCardId = boardCard.instanceId;
  recordMove(boardCard, "extraDeck", targetZone, "EXデッキ");
  renderPracticeBoard();
  setStatus(`EX ${card.index}を${BOARD_ZONE_LABELS.get(targetZone)}へ追加しました`);
}

function returnBoardCardToExtraDeck(instanceId) {
  const normalizedId = Number(instanceId);
  const cardIndex = state.boardCards.findIndex((item) => item.instanceId === normalizedId);
  const card = state.boardCards[cardIndex];
  if (!card || card.scope !== "extra") {
    return;
  }

  const previousZone = card.zone;
  state.boardCards.splice(cardIndex, 1);
  state.selectedBoardCardId = null;
  recordMove(card, previousZone, "extraDeck", undefined, "EXデッキ");
  renderPracticeBoard();
  setStatus(`${getBoardCardLabel(card)}をEXデッキへ戻しました`);
}

function createBoardCard(card, zone) {
  const instanceId = state.nextBoardCardId;
  state.nextBoardCardId += 1;
  return {
    instanceId,
    cardId: card.id,
    scope: card.scope,
    index: card.index,
    url: card.url,
    isStarter: Boolean(card.isStarter),
    zone,
  };
}

function syncBoardStarterFlags() {
  const starterById = new Map(state.mainCards.map((card) => [card.id, Boolean(card.isStarter)]));
  state.boardCards.forEach((boardCard) => {
    if (starterById.has(boardCard.cardId)) {
      boardCard.isStarter = starterById.get(boardCard.cardId);
    }
  });
}

function getSelectedBoardCard() {
  return state.boardCards.find((card) => card.instanceId === state.selectedBoardCardId);
}

function getBoardCardLabel(card) {
  const scopeLabel = card.scope === "extra" ? "EX" : "メイン";
  return `${scopeLabel} ${card.index}${card.isStarter ? " 初動" : ""}`;
}

function buildBoardState() {
  return [...BOARD_ZONE_LABELS.keys()].map((zone) => ({
    zone,
    label: BOARD_ZONE_LABELS.get(zone),
    cards: state.boardCards
      .filter((card) => card.zone === zone)
      .map((card) => ({
        cardId: card.cardId,
        label: getBoardCardLabel(card),
      })),
  }));
}

function buildBoardSummary() {
  const lines = buildBoardState()
    .filter((zone) => zone.cards.length)
    .map((zone) => `${zone.label}: ${zone.cards.map((card) => card.label).join(", ")}`);

  if (!lines.length) {
    return "";
  }

  return ["盤面:", ...lines].join("\n");
}

function appendBoardToMemo() {
  const summary = buildBoardSummary();
  if (!summary) {
    setStatus("盤面にカードがありません");
    return;
  }

  const prefix = els.memoInput.value.trim() ? "\n\n" : "";
  els.memoInput.value = `${els.memoInput.value}${prefix}${summary}`;
  setStatus("盤面をメモへ追記しました");
}

async function toggleStarterCard(card) {
  if (card.scope !== "main") {
    return;
  }

  card.isStarter = !card.isStarter;
  renderAllCards();
  renderCurrentHand();

  const persisted = await persistStarterFlag(card);
  setStatus(persisted ? "初動カードを更新しました" : "カード保存時に初動マークを保持します");
}

async function persistStarterFlag(card) {
  if (!state.db) {
    return false;
  }

  const transaction = state.db.transaction("cards", "readwrite");
  const store = transaction.objectStore("cards");
  const savedCard = await requestToPromise(store.get(card.id));
  if (!savedCard) {
    return false;
  }

  store.put({
    ...savedCard,
    isStarter: Boolean(card.isStarter),
    updatedAt: new Date().toISOString(),
  });
  await transactionComplete(transaction);
  return true;
}

function drawHand() {
  if (state.mainCards.length < 5) {
    setStatus("メインカードが5枚未満です");
    return;
  }

  state.currentHand = shuffle([...state.mainCards]).slice(0, 5);
  resetPracticeBoard();
  setStatus("5枚ドロー済み");
}

function renderCurrentHand() {
  renderPracticeBoard();
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
    boardState: buildBoardState(),
    moveHistory: state.moveHistory,
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
      isStarter: Boolean(card.isStarter),
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
      const boardSummary = document.createElement("p");
      const moveHistory = document.createElement("p");
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
      if (log.boardState?.some((zone) => zone.cards?.length)) {
        boardSummary.className = "log-board";
        boardSummary.textContent = formatSavedBoardState(log.boardState);
        article.append(boardSummary);
      }
      if (log.moveHistory?.length) {
        moveHistory.className = "log-board";
        moveHistory.textContent = formatMoveHistory(log.moveHistory);
        article.append(moveHistory);
      }
      return article;
    }),
  );
}

function formatSavedBoardState(boardState) {
  return boardState
    .filter((zone) => zone.cards?.length)
    .map((zone) => `${zone.label}: ${zone.cards.map((card) => card.label).join(", ")}`)
    .join("\n");
}

function formatMoveHistory(moveHistory) {
  return [
    "移動履歴:",
    ...moveHistory.map((move, index) => {
      const fromLabel = move.fromLabel ?? BOARD_ZONE_LABELS.get(move.from) ?? move.from;
      const toLabel = move.toLabel ?? BOARD_ZONE_LABELS.get(move.to) ?? move.to;
      return `${index + 1}. ${move.label}: ${fromLabel} -> ${toLabel}`;
    }),
  ].join("\n");
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
  state.boardCards = [];
  state.moveHistory = [];
  state.nextBoardCardId = 1;
  state.selectedBoardCardId = null;
  state.logs = [];
  state.settings = structuredClone(DEFAULT_SETTINGS);
  buildControls();
  renderAllCards();
  renderLogs();
  renderPracticeBoard();
  setStatus("データ削除済み");
}

async function init() {
  buildPracticeZones();
  buildControls();
  drawSourcePreview();
  els.extraBoardCards.addEventListener("dragover", handleExtraDeckDragOver);
  els.extraBoardCards.addEventListener("drop", handleExtraDeckDrop);

  try {
    state.db = await openDatabase();
    await loadSavedState();
  } catch (error) {
    setStatus("保存機能エラー");
    console.error(error);
  }
  renderPracticeBoard();

  els.imageInput.addEventListener("change", handleImageInput);
  els.previewButton.addEventListener("click", previewSlices);
  els.saveDeckButton.addEventListener("click", saveDeck);
  els.drawButton.addEventListener("click", drawHand);
  els.resetBoardButton.addEventListener("click", resetPracticeBoard);
  els.appendBoardButton.addEventListener("click", appendBoardToMemo);
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
