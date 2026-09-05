import {
  deriveTags,
  extractNeedConstraints,
  filterCandidatesByNeed,
  filterCandidatesBySettings,
  pickWeighted,
  sanitizeCandidates,
  toAiCandidate,
} from "./src/decision.mjs";
import { buildTextSearchRequest, normalizeNewPlace } from "./src/places.mjs";
import {
  compactInteraction,
  compactProfile,
  clearLocalTasteData,
  getInteractions,
  getActiveBlacklistPlaceIds,
  getSettings,
  getTasteProfile,
  saveInteraction,
  saveSettings,
} from "./src/storage.mjs";

function autoMeal() {
  const hour = new Date().getHours();
  if (hour < 10) return "breakfast";
  if (hour < 14) return "lunch";
  if (hour < 17) return "dessert";
  if (hour < 22) return "dinner";
  return "latenight";
}

const DEFAULT_SETTINGS = Object.freeze({
  meal: autoMeal(),
  radiusKm: 3,
  category: "all",
  openNow: true,
  minRating: 4,
  excludeChains: false,
  price: "all",
});

const DEMO_CANDIDATES = Object.freeze([
  { placeId: "demo-rice", name: "一碗熱飯小館", categories: ["台式"], tags: ["taiwanese", "rice", "hot", "meat"], rating: 4.4, priceLevel: 2, source: "demo" },
  { placeId: "demo-ramen", name: "湯頭研究所", categories: ["日式"], tags: ["japanese", "noodles", "hot"], rating: 4.5, priceLevel: 2, source: "demo" },
  { placeId: "demo-grill", name: "小火慢烤食堂", categories: ["台式"], tags: ["taiwanese", "hot", "meat"], rating: 4.2, priceLevel: 3, source: "demo" },
  { placeId: "demo-cafe", name: "午後留白咖啡室", categories: ["咖啡甜點"], tags: ["cafe", "sweet", "fresh"], rating: 4.6, priceLevel: 2, source: "demo" },
  { placeId: "demo-sushi", name: "日光旬味", categories: ["日式"], tags: ["japanese", "fresh", "seafood"], rating: 4.3, priceLevel: 3, source: "demo" },
  { placeId: "demo-korean", name: "暖桌韓食所", categories: ["韓式"], tags: ["korean", "hot", "spicy", "meat"], rating: 4.1, priceLevel: 2, source: "demo" },
  { placeId: "demo-pizza", name: "日常薄片屋", categories: ["義式"], tags: ["italian", "noodles", "hot"], rating: 4.4, priceLevel: 2, source: "demo" },
  { placeId: "demo-veggie", name: "青日蔬食桌", categories: ["台式"], tags: ["taiwanese", "vegetarian", "fresh", "rice"], rating: 4.5, priceLevel: 2, source: "demo" },
]);

const CATEGORY_KEYWORDS = Object.freeze({
  taiwanese: "台式餐廳",
  japanese: "日式餐廳",
  korean: "韓式餐廳",
  italian: "義式餐廳",
  cafe: "咖啡甜點",
});

const MEAL_KEYWORDS = Object.freeze({
  breakfast: "早餐 早午餐",
  lunch: "午餐 餐廳",
  dinner: "晚餐 餐廳",
  dessert: "甜點 冰品 咖啡",
  latenight: "宵夜 深夜食堂",
});

const dom = {
  form: document.querySelector("#decision-form"),
  mood: document.querySelector("#current-need"),
  needHint: document.querySelector("#need-hint"),
  advancedFilters: document.querySelector("#advanced-filters"),
  meal: document.querySelector("#meal"),
  radius: document.querySelector("#radius"),
  price: document.querySelector("#price"),
  minRating: document.querySelector("#min-rating"),
  excludeChains: document.querySelector("#exclude-chains"),
  openNow: document.querySelector("#open-now"),
  chips: [...document.querySelectorAll("[data-category]")],
  useLocation: document.querySelector("#use-location"),
  locationStatus: document.querySelector("#location-status"),
  serviceStatus: document.querySelector("#service-status"),
  decideButton: document.querySelector("#decide-button"),
  resultPanel: document.querySelector("#result-panel"),
  resultKicker: document.querySelector("#result-kicker"),
  resultMode: document.querySelector("#result-mode"),
  resultOverline: document.querySelector("#result-overline"),
  resultTitle: document.querySelector("#result-title"),
  resultMeta: document.querySelector("#result-meta"),
  resultReason: document.querySelector("#result-reason"),
  resultLimits: document.querySelector("#result-limits"),
  resultFooter: document.querySelector("#result-footer"),
  resultSource: document.querySelector("#result-source"),
  resultLink: document.querySelector("#result-link"),
  resultActions: document.querySelector("#result-actions"),
  candidateDetails: document.querySelector("#candidate-details"),
  candidateList: document.querySelector("#candidate-list"),
  resultOrbit: document.querySelector("#result-orbit"),
  resultPhoto: document.querySelector("#result-photo"),
  resultPhotoImage: document.querySelector("#result-photo-image"),
  photoAttribution: document.querySelector("#photo-attribution"),
  tasteBars: document.querySelector("#taste-bars"),
  interactionCount: document.querySelector("#interaction-count"),
  profileSignal: document.querySelector("#profile-signal"),
  recentList: document.querySelector("#recent-list"),
  historyList: document.querySelector("#history-list"),
  memoryCollections: document.querySelector("#memory-collections"),
  favoriteList: document.querySelector("#favorite-list"),
  blacklistList: document.querySelector("#blacklist-list"),
  clearMemory: document.querySelector("#clear-memory"),
  liveRegion: document.querySelector("#live-region"),
};

const state = {
  settings: getSettings(undefined, DEFAULT_SETTINGS),
  config: { mapsBrowserKey: null, aiAvailable: false },
  location: null,
  candidates: [],
  source: "demo",
  current: null,
  seenIds: new Set(),
  busy: false,
  mapsScriptPromise: null,
  currentNeed: "",
  currentEventActions: new Set(),
};

const actionLabels = Object.freeze({
  shown: "看見",
  accepted: "吃這家",
  rerolled: "換一家",
  favorited: "收藏",
  unfavorited: "取消收藏",
  blacklisted: "封鎖",
  unblacklisted: "恢復封鎖",
});

const tagLabels = Object.freeze({
  taiwanese: "台式",
  japanese: "日式",
  korean: "韓式",
  italian: "義式",
  thai: "泰式",
  american: "美式",
  noodles: "麵食",
  rice: "飯食",
  hot: "熱食",
  fresh: "清爽",
  vegetarian: "蔬食",
  seafood: "海鮮",
  meat: "肉食",
  spicy: "辛香",
  sweet: "甜點",
  cafe: "咖啡甜點",
});

function readSettingsFromForm() {
  return saveSettings({
    meal: dom.meal.value,
    radiusKm: Number(dom.radius.value),
    category: state.settings.category,
    openNow: dom.openNow.checked,
    minRating: Number(dom.minRating.value),
    excludeChains: dom.excludeChains.checked,
    price: dom.price.value,
  });
}

function setText(element, text) {
  if (element) element.textContent = text;
}

function announce(message) {
  setText(dom.liveRegion, message);
  window.setTimeout(() => setText(dom.liveRegion, ""), 1200);
}

function setLocationStatus(message) {
  setText(dom.locationStatus, message);
}

function setBusy(isBusy) {
  state.busy = isBusy;
  dom.decideButton.disabled = isBusy;
  setText(dom.decideButton.querySelector("span"), isBusy ? "正在替你找" : "幫我決定");
}

function updateServiceStatus() {
  if (state.config.mapsBrowserKey) {
    setText(dom.serviceStatus, state.config.aiAvailable ? "Places 與個人化決定已準備" : "Places 已準備，AI 不可用時會自動隨機");
  } else {
    setText(dom.serviceStatus, "示範模式；設定 Places key 後搜尋附近真實餐廳");
  }
  setText(
    dom.needHint,
    state.config.aiAvailable
      ? "有特別想法再說就好；不輸入也可以直接幫你決定。吃膩了、想換口味或有例外條件，也可以直接寫。"
      : "不輸入也可以直接決定；目前一般推薦模式只會保守處理簡單文字需求。",
  );
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("config_unavailable");
    const config = await response.json();
    state.config = {
      mapsBrowserKey: typeof config.mapsBrowserKey === "string" ? config.mapsBrowserKey : null,
      aiAvailable: Boolean(config.aiAvailable),
    };
  } catch {
    state.config = { mapsBrowserKey: null, aiAvailable: false };
  }
  updateServiceStatus();
}

function requestLocation() {
  if (!navigator.geolocation) {
    setLocationStatus("此瀏覽器不支援定位；先用示範候選");
    return Promise.resolve(null);
  }
  setLocationStatus("正在取得你的位置…");
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setLocationStatus("已取得位置，會搜尋附近真實餐廳");
        resolve(state.location);
      },
      () => {
        state.location = null;
        setLocationStatus("定位未開啟；先用示範候選，不影響決定流程");
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
  });
}

async function ensureMapsScript() {
  if (!state.config.mapsBrowserKey) throw new Error("maps_key_missing");
  if (window.google?.maps?.importLibrary) return window.google;
  if (state.mapsScriptPromise) return state.mapsScriptPromise;

  state.mapsScriptPromise = new Promise((resolve, reject) => {
    const callbackName = "eatMapsCallback";
    window[callbackName] = () => resolve(window.google);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.config.mapsBrowserKey)}&libraries=places&callback=${callbackName}&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("maps_script_failed"));
    document.head.appendChild(script);
  });
  return state.mapsScriptPromise;
}

async function queryGooglePlaces() {
  await ensureMapsScript();
  const { Place } = await window.google.maps.importLibrary("places");
  if (typeof Place?.searchByText !== "function") throw new Error("places_new_api_unavailable");
  const radiusKm = Math.min(10, Math.max(1, Number(state.settings.radiusKm) || 3));
  const request = buildTextSearchRequest({
    origin: state.location,
    radiusKm,
    mealKeyword: MEAL_KEYWORDS[state.settings.meal] || MEAL_KEYWORDS.dinner,
    categoryKeyword: CATEGORY_KEYWORDS[state.settings.category],
    openNow: state.settings.openNow,
  });
  const { places = [] } = await Place.searchByText(request);
  return places
    .map((place) => normalizeNewPlace(place, { origin: state.location, openNow: state.settings.openNow }))
    .filter((candidate) => candidate && candidate.distanceKm !== null && candidate.distanceKm <= radiusKm + 0.001);
}

async function loadCandidates() {
  if (state.config.mapsBrowserKey) {
    if (!state.location) await requestLocation();
    if (state.location) {
      setLocationStatus("正在搜尋附近餐廳…");
      try {
        const candidates = sanitizeCandidates(await queryGooglePlaces());
        if (candidates.length) {
          state.candidates = candidates;
          state.source = "google";
          setLocationStatus(`找到 ${candidates.length} 間附近餐廳`);
          return candidates;
        }
        setLocationStatus("附近沒有符合條件的餐廳；先用示範候選");
      } catch {
        setLocationStatus("Places 暫時無法使用；先用加權隨機示範候選");
      }
    }
  }
  state.candidates = sanitizeCandidates(DEMO_CANDIDATES);
  state.source = "demo";
  return state.candidates;
}

function categoryMatches(candidate) {
  if (state.settings.category === "all") return true;
  const tags = new Set([...candidate.tags, ...deriveTags(candidate)]);
  return tags.has(state.settings.category);
}

function applyFormFilters(candidates, currentNeed) {
  const bySettings = filterCandidatesBySettings(candidates, state.settings).filter(categoryMatches);
  const blockedPlaceIds = new Set(getActiveBlacklistPlaceIds(getInteractions()));
  const structuredCandidates = bySettings.filter((candidate) => !blockedPlaceIds.has(candidate.placeId));
  const shouldUseFallbackHardFilters = state.source === "demo" || !state.config.aiAvailable;
  return shouldUseFallbackHardFilters ? filterCandidatesByNeed(structuredCandidates, currentNeed) : structuredCandidates;
}

function getDisplayedCandidates(currentNeed) {
  return applyFormFilters(state.candidates, currentNeed);
}

function modeLabel(mode) {
  if (mode === "ai") return "AI 個人化";
  if (state.source === "google") return "加權隨機 fallback";
  return "示範加權隨機";
}

function formatPrice(priceLevel) {
  if (priceLevel === null) return "價格未知";
  return "$".repeat(Math.max(1, Math.round(priceLevel)));
}

function formatMeta(candidate) {
  const parts = [];
  if (candidate.rating !== null) parts.push(`★ ${candidate.rating.toFixed(1)}`);
  parts.push(formatPrice(candidate.priceLevel));
  if (candidate.distanceKm !== null) parts.push(`${candidate.distanceKm.toFixed(1)} km`);
  if (candidate.isOpen) parts.push("營業中");
  if (candidate.categories?.length) parts.push(candidate.categories.slice(0, 2).join(" · "));
  return parts.join("　");
}

function resetResultPhoto() {
  if (dom.resultPhoto) dom.resultPhoto.hidden = true;
  if (dom.resultOrbit) dom.resultOrbit.hidden = false;
  if (dom.resultPhotoImage) {
    dom.resultPhotoImage.onerror = null;
    dom.resultPhotoImage.removeAttribute("src");
  }
  if (dom.photoAttribution) {
    dom.photoAttribution.replaceChildren();
    dom.photoAttribution.hidden = true;
  }
}

function renderPhotoAttribution(attributions = []) {
  if (!dom.photoAttribution) return;
  dom.photoAttribution.replaceChildren();
  const safeAttributions = (Array.isArray(attributions) ? attributions : [])
    .filter((item) => item && typeof item === "object")
    .slice(0, 3);
  safeAttributions.forEach((attribution, index) => {
    if (index) dom.photoAttribution.append(document.createTextNode(" · "));
    const displayName = typeof attribution.displayName === "string" ? attribution.displayName : "";
    const uri = typeof attribution.uri === "string" && /^https:\/\//i.test(attribution.uri)
      ? attribution.uri
      : "";
    if (uri) {
      const link = document.createElement("a");
      link.href = uri;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = displayName || "照片作者";
      dom.photoAttribution.append(link);
    } else if (displayName) {
      dom.photoAttribution.append(document.createTextNode(displayName));
    }
  });
  dom.photoAttribution.hidden = !dom.photoAttribution.textContent?.trim();
}

function renderResultPhoto(candidate) {
  resetResultPhoto();
  if (!candidate.photoUrl || !dom.resultPhoto || !dom.resultPhotoImage) return;
  dom.resultPhoto.hidden = false;
  dom.resultOrbit.hidden = true;
  renderPhotoAttribution(candidate.photoAttributions);
  dom.resultPhotoImage.alt = `${candidate.name} 餐廳照片`;
  dom.resultPhotoImage.onerror = () => resetResultPhoto();
  dom.resultPhotoImage.src = candidate.photoUrl;
}

function renderCandidateDetails(candidates) {
  dom.candidateList.replaceChildren();
  const list = sanitizeCandidates(candidates);
  dom.candidateDetails.hidden = !list.length;
  for (const candidate of list) {
    const row = document.createElement("div");
    row.className = "candidate-row";
    const copy = document.createElement("span");
    copy.textContent = `${candidate.name} · ${formatMeta(candidate)}`;
    row.append(copy);
    if (candidate.mapsUrl) {
      const link = document.createElement("a");
      link.href = candidate.mapsUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "地圖 ↗";
      row.append(link);
    }
    dom.candidateList.append(row);
  }
}

function renderEmptyResult(message = "設定條件後按下「幫我決定」") {
  state.currentEventActions.clear();
  dom.resultPanel.classList.add("is-empty");
  dom.resultActions.hidden = true;
  dom.resultFooter.hidden = true;
  dom.candidateDetails.hidden = true;
  resetResultPhoto();
  renderNeedLimits([]);
  const favoriteButton = dom.resultActions.querySelector('[data-action="favorited"]');
  if (favoriteButton) {
    favoriteButton.textContent = "♡";
    favoriteButton.setAttribute("aria-label", "收藏這家餐廳");
    favoriteButton.setAttribute("title", "收藏");
  }
  setText(dom.resultKicker, "READY WHEN YOU ARE");
  setText(dom.resultMode, "等待決定");
  setText(dom.resultOverline, "你的下一站");
  dom.resultTitle.innerHTML = "讓今天的第一口，<br /><em>先不用自己想。</em>";
  setText(dom.resultMeta, message);
  setText(dom.resultReason, "你可以不輸入任何需求；原本的加權隨機流程隨時都能工作。");
}

function renderResult(candidate, mode, reason, unsupportedNeeds = []) {
  dom.resultPanel.classList.remove("is-empty");
  dom.resultActions.hidden = false;
  dom.resultFooter.hidden = false;
  setText(dom.resultKicker, mode === "ai" ? "今天就吃這家" : "LET THE WEIGHTS DECIDE");
  setText(dom.resultMode, modeLabel(mode));
  setText(dom.resultOverline, state.source === "google" ? "你的下一口" : "先用示範候選試轉一圈");
  setText(dom.resultTitle, candidate.name);
  setText(dom.resultMeta, formatMeta(candidate));
  setText(dom.resultReason, reason);
  renderNeedLimits(unsupportedNeeds);
  setText(dom.resultSource, candidate.source === "google" ? "候選來自 Google Places" : "目前是示範候選；設定 key 後會切換至真實附近餐廳");
  renderResultPhoto(candidate);
  renderCandidateDetails(getDisplayedCandidates(dom.mood.value.trim().slice(0, 240)));
  if (candidate.mapsUrl) {
    dom.resultLink.hidden = false;
    dom.resultLink.href = candidate.mapsUrl;
  } else {
    dom.resultLink.hidden = true;
  }
  setResultActionState();
  announce(`已選出 ${candidate.name}`);
}

function renderNeedLimits(unsupportedNeeds = []) {
  if (!dom.resultLimits) return;
  const notes = [...new Set((Array.isArray(unsupportedNeeds) ? unsupportedNeeds : [])
    .map((value) => String(value).trim())
    .filter(Boolean))].slice(0, 3);
  dom.resultLimits.hidden = !notes.length;
  setText(dom.resultLimits, notes.length ? `資料提醒：${notes.join("；")}` : "");
}

function formatTag(key) {
  return tagLabels[key] || key;
}

function isFavoritePlace(placeId) {
  return getTasteProfile().favoritePlaceIds?.includes(placeId) === true;
}

function getPlaceSnapshots(interactions) {
  const snapshots = new Map();
  for (const interaction of interactions) snapshots.set(interaction.placeId, interaction);
  return snapshots;
}

function renderMemoryCollectionList(listElement, snapshots, placeIds, action, buttonLabel, emptyText) {
  if (!listElement) return;
  listElement.replaceChildren();
  if (!placeIds.length) {
    const empty = document.createElement("li");
    empty.className = "recent-empty";
    empty.textContent = emptyText;
    listElement.append(empty);
    return;
  }
  for (const placeId of placeIds) {
    const snapshot = snapshots.get(placeId);
    const item = document.createElement("li");
    item.className = "memory-item";
    const name = document.createElement("span");
    name.textContent = snapshot?.placeName || placeId;
    const button = document.createElement("button");
    button.className = "text-button memory-action";
    button.type = "button";
    button.dataset.memoryAction = action;
    button.dataset.placeId = placeId;
    button.textContent = buttonLabel;
    item.append(name, button);
    listElement.append(item);
  }
}

function renderMemoryCollections(interactions, profile) {
  const snapshots = getPlaceSnapshots(interactions);
  renderMemoryCollectionList(
    dom.favoriteList,
    snapshots,
    Array.isArray(profile.favoritePlaceIds) ? profile.favoritePlaceIds : [],
    "unfavorite",
    "取消收藏",
    "目前沒有收藏。",
  );
  renderMemoryCollectionList(
    dom.blacklistList,
    snapshots,
    getActiveBlacklistPlaceIds(interactions),
    "unblacklist",
    "恢復",
    "目前沒有封鎖。",
  );
}

function setResultActionState() {
  if (!state.current) return;
  const favoriteButton = dom.resultActions.querySelector('[data-action="favorited"]');
  if (favoriteButton) {
    const favorite = isFavoritePlace(state.current.placeId);
    favoriteButton.textContent = favorite ? "♥" : "♡";
    favoriteButton.setAttribute("aria-label", favorite ? "取消收藏這家餐廳" : "收藏這家餐廳");
    favoriteButton.setAttribute("title", favorite ? "取消收藏" : "收藏");
  }
  const acceptedButton = dom.resultActions.querySelector('[data-action="accepted"]');
  if (acceptedButton) {
    const accepted = state.currentEventActions.has("accepted");
    acceptedButton.disabled = accepted;
    acceptedButton.setAttribute("aria-label", accepted ? "已決定這家餐廳" : "就吃這家餐廳");
    const label = acceptedButton.querySelector(".accepted-label");
    if (label) label.textContent = accepted ? "已決定" : "就吃這家";
  }
}

function renderTasteProfile() {
  const interactions = getInteractions();
  const profile = getTasteProfile();
  setText(dom.interactionCount, `${profile.interactionCount || 0} 次有效回饋`);
  dom.tasteBars.replaceChildren();

  const preferences = Array.isArray(profile.topPreferences) ? profile.topPreferences.slice(0, 4) : [];
  if (!preferences.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = "多選幾次，這裡會開始認識你。";
    dom.tasteBars.append(empty);
  } else {
    const maxScore = Math.max(...preferences.map(({ score }) => Number(score) || 1), 1);
    for (const preference of preferences) {
      const row = document.createElement("div");
      row.className = "taste-bar-row";
      const label = document.createElement("span");
      label.className = "taste-bar-label";
      label.textContent = formatTag(preference.key);
      const track = document.createElement("span");
      track.className = "taste-bar-track";
      const fill = document.createElement("span");
      fill.className = "taste-bar-fill";
      fill.style.width = `${Math.max(8, Math.round((preference.score / maxScore) * 100))}%`;
      track.append(fill);
      const score = document.createElement("span");
      score.className = "taste-bar-score";
      score.textContent = `+${Math.round(preference.score)}`;
      row.append(label, track, score);
      dom.tasteBars.append(row);
    }
  }

  const avoidCount = Array.isArray(profile.avoidPreferences) ? profile.avoidPreferences.length : 0;
  setText(dom.profileSignal, profile.interactionCount ? (avoidCount ? `${avoidCount} 個避開訊號` : "輪廓正在成形") : "等待第一個訊號");
  const recent = interactions.slice(-4).reverse();
  renderInteractionList(dom.recentList, recent, "看見、接受、換一家、收藏或封鎖，都是訊號。");
  renderInteractionList(dom.historyList, interactions.slice().reverse(), "目前還沒有互動紀錄。");
  renderMemoryCollections(interactions, profile);
}

function renderInteractionList(listElement, interactions, emptyText) {
  if (!listElement) return;
  listElement.replaceChildren();
  if (!interactions.length) {
    const empty = document.createElement("li");
    empty.className = "recent-empty";
    empty.textContent = emptyText;
    listElement.append(empty);
    return;
  }
  for (const interaction of interactions) {
    const item = document.createElement("li");
    item.textContent = `${actionLabels[interaction.action] || interaction.action} · ${interaction.placeName}`;
    listElement.append(item);
  }
}

function recordCurrentAction(action) {
  if (!state.current || state.currentEventActions.has(action)) return false;
  if (action === "favorited") state.currentEventActions.delete("unfavorited");
  if (action === "unfavorited") state.currentEventActions.delete("favorited");
  state.currentEventActions.add(action);
  saveInteraction({
    action,
    placeId: state.current.placeId,
    placeName: state.current.name,
    categories: state.current.categories,
    tags: state.current.tags,
    priceLevel: state.current.priceLevel,
    currentNeed: state.currentNeed,
    meal: state.settings.meal,
  });
  renderTasteProfile();
  setResultActionState();
  return true;
}

function recordPlaceAction(action, interaction) {
  if (!interaction?.placeId) return;
  saveInteraction({
    action,
    placeId: interaction.placeId,
    placeName: interaction.placeName,
    categories: interaction.categories,
    tags: interaction.tags,
    priceLevel: interaction.priceLevel,
    currentNeed: state.currentNeed,
    meal: state.settings.meal,
  });
  renderTasteProfile();
  setResultActionState();
}

async function requestRecommendation(candidates, currentNeed) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_200);
  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        currentNeed,
        settings: state.settings,
        tasteProfile: compactProfile(getTasteProfile()),
        recentInteractions: getInteractions().slice(-10).map(compactInteraction).filter(Boolean),
        excludePlaceIds: [...state.seenIds],
        candidates: candidates.map(toAiCandidate).filter(Boolean),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result?.placeId) throw new Error("recommendation_unavailable");
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function decide({ reuseCandidates = false } = {}) {
  if (state.busy) return;
  setBusy(true);
  state.settings = readSettingsFromForm();
  const currentNeed = dom.mood.value.trim().slice(0, 240);
  state.currentNeed = currentNeed;
  if (!reuseCandidates) state.seenIds.clear();

  try {
    if (!reuseCandidates || !state.candidates.length) await loadCandidates();
    const filtered = getDisplayedCandidates(currentNeed);
    if (!filtered.length) {
      state.current = null;
      renderEmptyResult("目前沒有同時符合這些條件的候選");
      setText(dom.resultReason, "保留當下需求優先；可以拿掉一個限制，或換個口味方向再試一次。");
      announce("目前沒有符合條件的候選");
      return;
    }

    const unseen = filtered.filter((candidate) => !state.seenIds.has(candidate.placeId));
    const pool = unseen.length ? unseen : filtered;
    let selected = null;
    let mode = "fallback";
    let reason = "依照目前條件與你的本機口味輪廓，用加權隨機幫你決定。";
    let unsupportedNeeds = extractNeedConstraints(currentNeed).unsupportedNeeds;

    if (state.source === "google") {
      try {
        const aiResult = await requestRecommendation(pool, currentNeed);
        selected = pool.find((candidate) => candidate.placeId === aiResult.placeId) || null;
        if (selected) {
          mode = aiResult.mode === "ai" ? "ai" : "fallback";
          reason = aiResult.reason || reason;
          unsupportedNeeds = Array.isArray(aiResult.unsupportedNeeds) ? aiResult.unsupportedNeeds : unsupportedNeeds;
        }
      } catch {
        // A network, timeout, or malformed response never blocks the base flow.
      }
    }

    if (!selected) {
      selected = pickWeighted(pool, {
        currentNeed,
        profile: getTasteProfile(),
        excludeIds: [...state.seenIds],
      });
      mode = "fallback";
    }

    if (!selected) {
      renderEmptyResult("目前沒有可用的候選");
      return;
    }
    state.current = selected;
    state.seenIds.add(selected.placeId);
    state.currentEventActions = new Set();
    recordCurrentAction("shown");
    renderResult(selected, mode, reason, unsupportedNeeds);
  } finally {
    setBusy(false);
  }
}

async function handleResultAction(action) {
  if (!state.current || state.busy) return;
  if (action === "accepted") {
    if (!recordCurrentAction("accepted")) return;
    announce(`已記下你選擇 ${state.current.name}`);
    setText(dom.resultReason, "記下了。下次決定時，這個訊號會讓類似口味更容易出現。");
    return;
  }
  if (action === "favorited") {
    const wasFavorite = isFavoritePlace(state.current.placeId);
    if (!recordCurrentAction(wasFavorite ? "unfavorited" : "favorited")) return;
    setText(dom.resultReason, wasFavorite ? "已取消收藏；之後仍可再次收藏。" : "收藏訊號已記下；之後遇到相近情境會更偏向你的口袋名單。");
    announce(wasFavorite ? "已取消收藏" : "已收藏這家餐廳");
    return;
  }
  if (action === "blacklisted") {
    if (!recordCurrentAction("blacklisted")) return;
    announce("已避開這家與相近口味，正在換一家");
    await decide({ reuseCandidates: true });
    return;
  }
  if (action === "rerolled") {
    if (!recordCurrentAction("rerolled")) return;
    announce("已記下你想換一家");
    await decide({ reuseCandidates: true });
  }
}

function wireEvents() {
  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    decide();
  });
  dom.useLocation.addEventListener("click", async () => {
    await requestLocation();
    if (state.location && state.config.mapsBrowserKey) setText(dom.serviceStatus, "位置已準備；按「幫我決定」搜尋附近餐廳");
  });
  dom.chips.forEach((chip) => chip.addEventListener("click", () => {
    state.settings.category = chip.dataset.category || "all";
    saveSettings(state.settings);
    dom.chips.forEach((item) => {
      const active = item === chip;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
  }));
  dom.resultActions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) handleResultAction(button.dataset.action);
  });
  dom.memoryCollections.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-memory-action][data-place-id]");
    if (!button) return;
    const interactions = getInteractions();
    const snapshot = interactions.slice().reverse().find((item) => item.placeId === button.dataset.placeId);
    const action = button.dataset.memoryAction === "unfavorite" ? "unfavorited" : "unblacklisted";
    recordPlaceAction(action, snapshot || {
      placeId: button.dataset.placeId,
      placeName: button.dataset.placeId,
      categories: [],
      tags: [],
      priceLevel: null,
    });
    announce(action === "unfavorited" ? "已取消收藏" : "已恢復這家餐廳");
  });
  dom.clearMemory.addEventListener("click", () => {
    if (!clearLocalTasteData()) return;
    state.seenIds.clear();
    state.currentEventActions.clear();
    renderTasteProfile();
    setResultActionState();
    announce("已清除互動與口味輪廓");
  });
  [dom.meal, dom.radius, dom.price, dom.minRating, dom.openNow, dom.excludeChains].forEach((control) => {
    control.addEventListener("change", () => { state.settings = readSettingsFromForm(); });
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // PWA enhancement is optional; it must not affect the decision flow.
    });
  }
}

async function init() {
  dom.meal.value = state.settings.meal;
  dom.radius.value = String(state.settings.radiusKm);
  dom.price.value = state.settings.price;
  dom.openNow.checked = state.settings.openNow;
  dom.minRating.value = String(state.settings.minRating ?? 4);
  dom.excludeChains.checked = Boolean(state.settings.excludeChains);
  if (dom.advancedFilters) dom.advancedFilters.open = false;
  dom.chips.forEach((chip) => {
    const active = (chip.dataset.category || "all") === state.settings.category;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
  renderEmptyResult();
  renderTasteProfile();
  wireEvents();
  registerServiceWorker();
  await loadConfig();
}

init();
