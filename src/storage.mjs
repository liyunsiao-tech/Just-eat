import { ACTIONS, cleanText, isKnownAction } from "./decision.mjs";

export const STORAGE_KEYS = Object.freeze({
  interactions: "eat.interactions.v1",
  tasteProfile: "eat.taste-profile.v1",
  settings: "eat.settings.v1",
});

const MAX_INTERACTIONS = 200;
const ACTION_SCORES = Object.freeze({
  shown: 0,
  accepted: 1,
  rerolled: -0.5,
  favorited: 3,
  blacklisted: -4,
});

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readJson(key, storage) {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value, storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function createLocalId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to a non-identifying local event id.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function normalizeInteraction(event = {}) {
  const action = isKnownAction(event.action) ? event.action : "";
  const placeId = cleanText(event.placeId, 200);
  if (!action || !placeId) return null;

  return {
    id: cleanText(event.id, 80) || createLocalId(),
    action,
    placeId,
    placeName: cleanText(event.placeName, 140) || "未命名餐廳",
    categories: [...new Set((Array.isArray(event.categories) ? event.categories : [])
      .map((value) => cleanText(value, 60)).filter(Boolean))].slice(0, 10),
    tags: [...new Set((Array.isArray(event.tags) ? event.tags : [])
      .map((value) => cleanText(value, 60)).filter(Boolean))].slice(0, 16),
    priceLevel: normalizeNumber(event.priceLevel, 0, 4),
    at: cleanText(event.at, 40) || new Date().toISOString(),
  };
}

function sortedWeights(weights, limit = 5) {
  return Object.entries(weights)
    .filter(([, score]) => Number.isFinite(score) && Math.abs(score) >= 0.25)
    .sort(([, left], [, right]) => right - left)
    .slice(0, limit)
    .map(([key, score]) => ({ key, score: Number(score.toFixed(2)) }));
}

export function buildTasteProfile(interactions = []) {
  const tagWeights = {};
  const categoryWeights = {};
  const priceLevelWeights = {};
  const actionCounts = Object.fromEntries(ACTIONS.map((action) => [action, 0]));
  const favoritePlaceIds = new Set();

  for (const rawInteraction of Array.isArray(interactions) ? interactions : []) {
    const interaction = normalizeInteraction(rawInteraction);
    if (!interaction) continue;
    actionCounts[interaction.action] += 1;
    const score = ACTION_SCORES[interaction.action] || 0;
    for (const tag of interaction.tags) tagWeights[tag] = (tagWeights[tag] || 0) + score;
    for (const category of interaction.categories) {
      categoryWeights[category] = (categoryWeights[category] || 0) + score;
    }
    if (interaction.priceLevel !== null) {
      const key = String(interaction.priceLevel);
      priceLevelWeights[key] = (priceLevelWeights[key] || 0) + score;
    }
    if (interaction.action === "favorited") favoritePlaceIds.add(interaction.placeId);
  }

  const topPreferences = sortedWeights(tagWeights).filter(({ score }) => score > 0);
  const avoidPreferences = sortedWeights(tagWeights).filter(({ score }) => score < 0);

  return {
    version: 1,
    interactionCount: (Array.isArray(interactions) ? interactions : []).length,
    actionCounts,
    tagWeights,
    categoryWeights,
    priceLevelWeights,
    favoritePlaceIds: [...favoritePlaceIds].slice(0, 50),
    topPreferences,
    avoidPreferences,
    updatedAt: new Date().toISOString(),
  };
}

export function getInteractions(storage) {
  const value = readJson(STORAGE_KEYS.interactions, storage);
  if (!Array.isArray(value)) return [];
  return value.map(normalizeInteraction).filter(Boolean).slice(-MAX_INTERACTIONS);
}

export function getTasteProfile(storage) {
  const saved = readJson(STORAGE_KEYS.tasteProfile, storage);
  if (saved && saved.version === 1 && typeof saved.tagWeights === "object") return saved;
  return buildTasteProfile(getInteractions(storage));
}

export function saveInteraction(event, storage) {
  const interaction = normalizeInteraction(event);
  if (!interaction) return { interaction: null, interactions: getInteractions(storage), profile: getTasteProfile(storage) };
  const interactions = [...getInteractions(storage), interaction].slice(-MAX_INTERACTIONS);
  const profile = buildTasteProfile(interactions);
  writeJson(STORAGE_KEYS.interactions, interactions, storage);
  writeJson(STORAGE_KEYS.tasteProfile, profile, storage);
  return { interaction, interactions, profile };
}

export function compactProfile(profile = {}) {
  return {
    interactionCount: Number.isFinite(Number(profile.interactionCount)) ? Number(profile.interactionCount) : 0,
    actionCounts: profile.actionCounts && typeof profile.actionCounts === "object" ? profile.actionCounts : {},
    likedTags: Array.isArray(profile.topPreferences) ? profile.topPreferences.slice(0, 5) : [],
    avoidedTags: Array.isArray(profile.avoidPreferences) ? profile.avoidPreferences.slice(0, 5) : [],
    favoritePlaceIds: Array.isArray(profile.favoritePlaceIds) ? profile.favoritePlaceIds.slice(0, 20) : [],
    tagWeights: profile.tagWeights && typeof profile.tagWeights === "object" ? profile.tagWeights : {},
    categoryWeights: profile.categoryWeights && typeof profile.categoryWeights === "object" ? profile.categoryWeights : {},
  };
}

export function compactInteraction(interaction = {}) {
  const normalized = normalizeInteraction(interaction);
  if (!normalized) return null;
  return {
    action: normalized.action,
    placeId: normalized.placeId,
    placeName: normalized.placeName,
    categories: normalized.categories,
    tags: normalized.tags,
    priceLevel: normalized.priceLevel,
  };
}

export function getSettings(storage, defaults = {}) {
  const saved = readJson(STORAGE_KEYS.settings, storage);
  return saved && typeof saved === "object" ? { ...defaults, ...saved } : { ...defaults };
}

export function saveSettings(settings, storage) {
  const safeSettings = {
    meal: cleanText(settings?.meal, 30),
    radiusKm: normalizeNumber(settings?.radiusKm, 1, 20) ?? 3,
    category: cleanText(settings?.category, 30) || "all",
    openNow: Boolean(settings?.openNow),
    minRating: normalizeNumber(settings?.minRating, 0, 5) ?? 4,
    excludeChains: Boolean(settings?.excludeChains),
    price: cleanText(settings?.price, 20) || "all",
  };
  writeJson(STORAGE_KEYS.settings, safeSettings, storage);
  return safeSettings;
}

export function clearLocalTasteData(storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.removeItem(STORAGE_KEYS.interactions);
    target.removeItem(STORAGE_KEYS.tasteProfile);
    return true;
  } catch {
    return false;
  }
}
