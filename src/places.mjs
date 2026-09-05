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

export function buildTextSearchRequest({ origin, radiusKm, mealKeyword, categoryKeyword, openNow }) {
  const textQuery = [mealKeyword, categoryKeyword, "餐廳"].filter(Boolean).join(" ") || "附近餐廳";
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
