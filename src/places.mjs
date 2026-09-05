import { cleanText, deriveTags, sanitizeCandidate } from "./decision.mjs";

export const NEW_PLACE_SEARCH_FIELDS = Object.freeze([
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "priceLevel",
  "businessStatus",
  "types",
  "googleMapsURI",
  "photos",
]);

const GENERIC_NEED_PATTERN = /^(?:隨便|你決定|都可以|沒想法|我不知道(?:吃什麼)?)(?:[，,、\s]*(?:隨便|你決定|都可以|沒想法|我不知道(?:吃什麼)?))*[。.!！!?？]*$/iu;
const FATIGUE_PATTERN = /吃太多|吃膩|吃腻|不想再吃|不要再吃|最近常吃|換別的|換點別的|换别的|换点别的/iu;
const NEGATION_PATTERN = /不要|不吃|不想吃|不想喝|避開|排除|別給我|不用/iu;
const EXPLICIT_POSITIVE_PATTERN = /(?<!不)(?<!沒)(?<!没)(?:想吃|想喝|今天(?:想)?吃|今天(?:想)?喝|來點|來一份|要吃|要喝|改吃|改喝)/iu;
const BARE_POSITIVE_PATTERN = /(?:^|[，,、；;\s])(?:吃|喝)\s*(?!太多|太飽|太饱|膩|腻|不下)/iu;
const POSITIVE_PHRASE_PATTERN = /(?<!不)(?<!沒)(?<!没)(?:想吃|想喝|今天(?:想)?吃|今天(?:想)?喝|來點|來一份|要吃|要喝|改吃|改喝)\s*([^，,、。；;!?！？]+)/iu;
const NON_FOOD_PHRASE_PATTERN = /^(?:熱的|熱食|暖和|清淡|清爽|新鮮|新鲜|健康|太油|油膩|油腻|太甜|甜一點|甜一些|太辣|辣一點|辣一些|安靜|安静|便宜|貴|贵|吃飽|吃饱|不太遠|不太远|近一點|近一点|能坐久一點|能坐久一点)$/iu;

const PLACE_INTENT_RULES = Object.freeze([
  { pattern: /吃冰|冰品|冰的|冰淇淋|剉冰|刨冰|雪花冰|冰店|聖代|圣代|霜淇淋|冰棒|gelato|ice\s*cream/iu, query: "冰品 冰淇淋 剉冰 甜點" },
  { pattern: /牛排|steak/iu, query: "牛排" },
  { pattern: /拉麵|拉面|ramen/iu, query: "拉麵" },
  { pattern: /火鍋|火锅|鍋物|hot\s*pot/iu, query: "火鍋" },
  { pattern: /燒肉|烧肉|烤肉|barbecue|bbq/iu, query: "燒肉" },
  { pattern: /咖啡|coffee/iu, query: "咖啡" },
  { pattern: /甜點|甜点|甜品|dessert/iu, query: "甜點" },
]);

function emptyPlaceSearchIntent() {
  return { hasPositiveFoodIntent: false, query: "" };
}

export function derivePlaceSearchIntent(value = "") {
  const currentNeed = cleanText(value, 240);
  if (!currentNeed || GENERIC_NEED_PATTERN.test(currentNeed)) return emptyPlaceSearchIntent();

  const hasExplicitPositive = EXPLICIT_POSITIVE_PATTERN.test(currentNeed);
  if (FATIGUE_PATTERN.test(currentNeed) && !hasExplicitPositive) return emptyPlaceSearchIntent();

  const hasPositiveCue = hasExplicitPositive || BARE_POSITIVE_PATTERN.test(currentNeed);
  if (NEGATION_PATTERN.test(currentNeed) && !hasPositiveCue) return emptyPlaceSearchIntent();

  const matchedQueries = PLACE_INTENT_RULES
    .filter(({ pattern }) => pattern.test(currentNeed))
    .map(({ query }) => query);
  if (matchedQueries.length) {
    return {
      hasPositiveFoodIntent: true,
      query: [...new Set(matchedQueries.join(" ").split(/\s+/u).filter(Boolean))].join(" "),
    };
  }

  const phrase = currentNeed.match(POSITIVE_PHRASE_PATTERN)?.[1]
    ?.replace(/(?:的|一點|一些)$/u, "")
    .trim();
  if (!phrase || NON_FOOD_PHRASE_PATTERN.test(phrase)) return emptyPlaceSearchIntent();
  return { hasPositiveFoodIntent: true, query: phrase.slice(0, 80) };
}

const PRICE_LEVELS = Object.freeze({
  FREE: 0,
  INEXPENSIVE: 1,
  MODERATE: 2,
  EXPENSIVE: 3,
  VERY_EXPENSIVE: 4,
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
});

function coordinate(value, methodName, propertyName, alternateName) {
  if (typeof value?.[methodName] === "function") return Number(value[methodName]());
  return Number(value?.[propertyName] ?? value?.[alternateName]);
}

export function readPlaceLocation(location) {
  const lat = coordinate(location, "lat", "lat", "latitude");
  const lng = coordinate(location, "lng", "lng", "longitude");
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function distanceInKm(left, right) {
  if (!left || !right) return null;
  if (![left.lat, left.lng, right.lat, right.lng].every((value) => Number.isFinite(Number(value)))) return null;
  const toRadians = (value) => value * Math.PI / 180;
  const earthRadius = 6371;
  const dLat = toRadians(Number(right.lat) - Number(left.lat));
  const dLng = toRadians(Number(right.lng) - Number(left.lng));
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(Number(left.lat))) * Math.cos(toRadians(Number(right.lat))) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function buildSearchBounds(origin, radiusKm) {
  const center = readPlaceLocation(origin);
  const radius = Math.max(0, Number(radiusKm) || 0);
  if (!center) return null;
  const latitudeDelta = radius / 111.32;
  const longitudeDelta = radius / (111.32 * Math.max(0.01, Math.cos(center.lat * Math.PI / 180)));
  return {
    south: Math.max(-90, center.lat - latitudeDelta),
    west: Math.max(-180, center.lng - longitudeDelta),
    north: Math.min(90, center.lat + latitudeDelta),
    east: Math.min(180, center.lng + longitudeDelta),
  };
}

export function buildTextSearchRequest({ origin, radiusKm, mealKeyword, categoryKeyword, currentNeed = "", openNow }) {
  const placeSearchIntent = derivePlaceSearchIntent(currentNeed);
  const primaryQuery = placeSearchIntent.hasPositiveFoodIntent ? placeSearchIntent.query : mealKeyword;
  const textQuery = [primaryQuery, categoryKeyword, placeSearchIntent.hasPositiveFoodIntent ? "" : "餐廳"].filter(Boolean).join(" ") || "附近餐廳";
  return {
    textQuery,
    fields: [...NEW_PLACE_SEARCH_FIELDS],
    locationRestriction: buildSearchBounds(origin, radiusKm),
    isOpenNow: Boolean(openNow),
    language: "zh-Hant",
    maxResultCount: 20,
  };
}

export function normalizePlacePriceLevel(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4) return value;
  if (typeof value !== "string") return null;
  const key = value.trim().toUpperCase().split(".").pop();
  return Object.prototype.hasOwnProperty.call(PRICE_LEVELS, key) ? PRICE_LEVELS[key] : null;
}

function safeHttps(value, maxLength = 500) {
  return typeof value === "string" && /^https:\/\//i.test(value) ? value.slice(0, maxLength) : "";
}

function normalizePhotoAttributions(photo) {
  return (Array.isArray(photo?.authorAttributions) ? photo.authorAttributions : [])
    .map((attribution) => ({
      displayName: cleanText(attribution?.displayName, 160),
      uri: safeHttps(attribution?.uri),
    }))
    .filter(({ displayName, uri }) => displayName || uri)
    .slice(0, 6);
}

function buildMapsUrl(placeId, googleMapsURI, origin, location) {
  const safePlaceId = cleanText(placeId, 200);
  if (origin && location && safePlaceId) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${origin.lat},${origin.lng}`)}&destination=${encodeURIComponent(`${location.lat},${location.lng}`)}&destination_place_id=${encodeURIComponent(safePlaceId)}`;
  }
  return safeHttps(googleMapsURI)
    || `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(safePlaceId)}`;
}

export function normalizeNewPlace(place, { origin = null, openNow = false } = {}) {
  const location = readPlaceLocation(place?.location);
  const placeId = cleanText(place?.id, 200);
  const name = cleanText(place?.displayName, 140);
  if (!placeId || !name) return null;

  const photo = Array.isArray(place?.photos) ? place.photos[0] : null;
  let photoUrl = "";
  try {
    if (typeof photo?.getURI === "function") photoUrl = safeHttps(photo.getURI({ maxWidth: 960, maxHeight: 720 }), 1_200);
  } catch {
    photoUrl = "";
  }

  return sanitizeCandidate({
    placeId,
    name,
    address: place?.formattedAddress,
    rating: place?.rating,
    userRatingsTotal: place?.userRatingCount,
    priceLevel: normalizePlacePriceLevel(place?.priceLevel),
    isOpen: openNow === true,
    businessStatus: place?.businessStatus,
    categories: place?.types,
    tags: deriveTags({ name, types: place?.types }),
    source: "google",
    mapsUrl: buildMapsUrl(placeId, place?.googleMapsURI, origin, location),
    photoUrl,
    photoAttributions: normalizePhotoAttributions(photo),
    distanceKm: distanceInKm(origin, location),
  });
}
