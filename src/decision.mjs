const MAX_TEXT_LENGTH = 240;

export const ACTIONS = Object.freeze([
  "shown",
  "accepted",
  "rerolled",
  "favorited",
  "unfavorited",
  "blacklisted",
  "unblacklisted",
]);

export const CHAIN_NAMES = Object.freeze([
  "麥當勞",
  "肯德基",
  "摩斯",
  "星巴克",
  "路易莎",
  "八方雲集",
  "四海遊龍",
  "爭鮮",
  "藏壽司",
  "すき家",
  "吉野家",
  "三商巧福",
  "鬍鬚張",
  "CoCo",
  "清心",
  "五十嵐",
  "迷客夏",
  "大苑子",
]);

const ACTION_SET = new Set(ACTIONS);

const NEGATION_PATTERN = /不要|不吃|不想吃|避開|排除|別給我|不用|吃膩|吃太多|換別|換點/iu;
const COMPLEX_NEED_PATTERN = /但|但是|不過|除了|除非|可以|如果|假如|沒有別的|再|或|或者|都可以|隨便|看情況|吃膩|吃太多|換別|換點|最近|常吃|探索|試試|沒吃過|新選擇|新的|太辣/iu;

const CATEGORY_RULES = Object.freeze([
  { key: "taiwanese", label: "台式", pattern: /台式|台灣|小吃|便當|熱炒|taiwan/i },
  { key: "japanese", label: "日式", pattern: /日式|日本|拉麵|壽司|居酒屋|japan|ramen|sushi/i },
  { key: "korean", label: "韓式", pattern: /韓式|韓國|部隊鍋|烤肉|korea/i },
  { key: "italian", label: "義式", pattern: /義式|義大利|披薩|pizza|pasta|ital/i },
  { key: "thai", label: "泰式", pattern: /泰式|泰國|thai/i },
  { key: "american", label: "美式", pattern: /美式|漢堡|burger|american/i },
  { key: "mexican", label: "墨西哥", pattern: /墨西哥|塔可|taco|mexic/i },
  { key: "indian", label: "印度", pattern: /印度|咖哩|indian|curry/i },
  { key: "cafe", label: "咖啡甜點", pattern: /咖啡|甜點|蛋糕|茶|cafe|coffee|dessert/i },
]);

const NEED_PATTERNS = Object.freeze([
  {
    tag: "rice",
    pattern:
      /(?:不要|不吃|不想吃|避開|排除|別給我|不用).{0,12}(?:米飯|白飯|飯類|便當|丼飯|丼|rice)/iu,
  },
  {
    tag: "noodles",
    pattern:
      /(?:不要|不吃|不想吃|避開|排除|別給我|不用).{0,12}(?:麵|麵食|拉麵|義大利麵|意麵|米粉|河粉|烏龍|蕎麥|pasta|noodle)/iu,
  },
  {
    tag: "seafood",
    pattern: /(?:不要|不吃|不想吃|避開|排除|別給我).{0,12}(?:海鮮|海產|seafood)/iu,
  },
  {
    tag: "meat",
    pattern: /(?:不要|不吃|不想吃|避開|排除|別給我).{0,12}(?:(?<!牛)(?<!豬)(?<!雞)(?<!羊)(?:肉類|肉食|肉)|漢堡|beef|pork|chicken|meat)/iu,
  },
  {
    tag: "spicy",
    pattern: /(?:不要|不吃|不想吃|避開|排除|別給我).{0,12}(?:辣|麻辣|spicy)/iu,
  },
]);

const UNSUPPORTED_NEED_RULES = Object.freeze([
  { pattern: /排隊|候位|等位|queue/iu, message: "目前沒有可靠候位資料" },
  { pattern: /安靜|聊天|坐很久|久坐|適合聊天/iu, message: "目前沒有可靠座位與環境資料" },
  { pattern: /份量|大份|吃得飽/iu, message: "目前沒有可靠份量資料" },
  { pattern: /太油|油膩|健康|蛋白質|營養/iu, message: "目前沒有可靠營養與油膩程度資料" },
  { pattern: /太辣|辣度|微辣|小辣|中辣|大辣/iu, message: "目前沒有可靠辣度資料" },
  { pattern: /過敏|allerg(?:y|ies)|花生|堅果|乳糖|麩質|gluten|nuts?|peanut/iu, message: "目前無法可靠確認餐廳過敏原，請向餐廳確認。" },
]);

const ALLERGEN_PATTERN = /過敏|allerg(?:y|ies)|花生|堅果|乳糖|麩質|gluten|nuts?|peanut/iu;

const cleanText = (value, maxLength = 180) =>
  typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength)
    : "";

const uniqueStrings = (values, maxLength = 12) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => cleanText(value, 80))
      .filter(Boolean),
  )].slice(0, maxLength);

const numberOrNull = (value, min, max) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

export function deriveTags(input = {}) {
  const name = cleanText(input.name, 160);
  const types = uniqueStrings(input.types || input.categories, 20);
  const supplied = uniqueStrings(input.tags, 20);
  const haystack = [name, ...types, ...supplied].join(" ").toLowerCase();
  const tags = new Set(supplied);

  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) tags.add(rule.key);
  }

  const tagRules = [
    ["noodles", /麵|拉麵|義大利麵|意麵|米粉|河粉|烏龍|蕎麥|pasta|noodle|ramen|udon|soba|pho/i],
    ["rice", /飯|丼|便當|燴飯|risotto|rice/i],
    ["hot", /熱|湯|鍋|燒烤|火烤|hot|soup|grill|bbq/i],
    ["fresh", /沙拉|生魚|刺身|涼|清爽|salad|sushi|fresh/i],
    ["vegetarian", /素食|蔬食|全素|蛋奶素|vegan|vegetarian/i],
    ["seafood", /海鮮|海產|魚|蝦|蟹|seafood|fish|shrimp|crab/i],
    ["meat", /牛|豬|雞|肉|漢堡|beef|pork|chicken|burger|meat/i],
    ["spicy", /辣|麻辣|酸辣|spicy|sichuan/i],
    ["sweet", /甜點|蛋糕|冰淇淋|甜|dessert|cake|ice cream/i],
    ["cafe", /咖啡|茶|甜點|cafe|coffee|tea|dessert/i],
  ];

  for (const [tag, pattern] of tagRules) {
    if (pattern.test(haystack)) tags.add(tag);
  }

  return [...tags].slice(0, 20);
}

export function deriveCategories(input = {}) {
  const haystack = [
    cleanText(input.name, 160),
    ...uniqueStrings(input.types || input.categories, 20),
    ...uniqueStrings(input.tags, 20),
  ].join(" ");
  const categories = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) categories.push(rule.label);
  }
  return categories.length ? categories : ["餐廳"];
}

export function sanitizeCandidate(candidate = {}) {
  const placeId = cleanText(candidate.placeId ?? candidate.id, 200);
  const name = cleanText(candidate.name, 140);
  if (!placeId || !name) return null;

  const rating = numberOrNull(candidate.rating, 0, 5);
  const priceLevel = numberOrNull(candidate.priceLevel, 0, 4);
  const distanceKm = numberOrNull(candidate.distanceKm, 0, 200);
  const source = candidate.source === "google" ? "google" : "demo";
  const isOpen = candidate.isOpen === true;
  const tags = deriveTags(candidate);
  const categories = uniqueStrings(candidate.categories, 10).length
    ? uniqueStrings(candidate.categories, 10)
    : deriveCategories(candidate);
  const mapsUrl = typeof candidate.mapsUrl === "string" && /^https:\/\//i.test(candidate.mapsUrl)
    ? candidate.mapsUrl.slice(0, 500)
    : "";
  const photoUrl = typeof candidate.photoUrl === "string" && /^https:\/\//i.test(candidate.photoUrl)
    ? candidate.photoUrl.slice(0, 1_200)
    : "";
  const photoAttributions = [];
  for (const value of Array.isArray(candidate.photoAttributions) ? candidate.photoAttributions : []) {
    if (!value || typeof value !== "object") continue;
    const displayName = cleanText(value.displayName, 160);
    const uri = typeof value.uri === "string" && /^https:\/\//i.test(value.uri)
      ? value.uri.slice(0, 500)
      : "";
    if (!displayName && !uri) continue;
    const key = `${displayName}\u0000${uri}`;
    if (photoAttributions.some((item) => `${item.displayName}\u0000${item.uri}` === key)) continue;
    photoAttributions.push({ displayName, uri });
    if (photoAttributions.length >= 6) break;
  }
  const allowedBusinessStatuses = new Set([
    "OPERATIONAL",
    "CLOSED_TEMPORARILY",
    "CLOSED_PERMANENTLY",
    "FUTURE_OPENING",
  ]);
  const businessStatus = allowedBusinessStatuses.has(candidate.businessStatus) ? candidate.businessStatus : "";

  return {
    placeId,
    name,
    address: cleanText(candidate.address, 180),
    rating,
    userRatingsTotal: numberOrNull(candidate.userRatingsTotal, 0, 10_000_000),
    priceLevel,
    distanceKm,
    isOpen,
    businessStatus,
    categories,
    tags,
    source,
    mapsUrl,
    photoUrl,
    photoAttributions,
  };
}

export function sanitizeCandidates(candidates) {
  const unique = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = sanitizeCandidate(candidate);
    if (normalized && !unique.has(normalized.placeId)) unique.set(normalized.placeId, normalized);
  }
  return [...unique.values()].slice(0, 40);
}

export function extractNeedConstraints(need = "") {
  const currentNeed = cleanText(need, MAX_TEXT_LENGTH);
  const isComplex = COMPLEX_NEED_PATTERN.test(currentNeed);
  const hasNegation = NEGATION_PATTERN.test(currentNeed);
  const blockedTags = new Set();
  if (!isComplex) {
    for (const rule of NEED_PATTERNS) {
      if (rule.pattern.test(currentNeed)) blockedTags.add(rule.tag);
    }
  }

  const vegetarian = !isComplex && /素食|蔬食|全素|蛋奶素|vegan|vegetarian/i.test(currentNeed);
  if (vegetarian) {
    blockedTags.add("meat");
    blockedTags.add("seafood");
  }

  const preferredTags = new Set();
  if (/(?:想吃|想要|來點|希望).{0,8}(?:熱的|熱食|暖和|湯|鍋|hot|soup)/iu.test(currentNeed)) preferredTags.add("hot");
  if (/(?:想吃|想要|來點|希望).{0,8}(?:清爽|清淡|沙拉|生魚|新鮮|fresh|salad)/iu.test(currentNeed)) preferredTags.add("fresh");
  if (!isComplex && !hasNegation && /甜點|蛋糕|咖啡|下午茶|dessert|coffee/iu.test(currentNeed)) {
    preferredTags.add("cafe");
  }
  if (!isComplex && !hasNegation) {
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(currentNeed)) preferredTags.add(rule.key);
    }
  }

  const unsupportedNeeds = UNSUPPORTED_NEED_RULES
    .filter(({ pattern }) => pattern.test(currentNeed))
    .map(({ message }) => message);

  return {
    currentNeed,
    isComplex,
    fallbackHardFilter: !isComplex && blockedTags.size > 0,
    blockedTags: [...blockedTags],
    preferredTags: [...preferredTags],
    vegetarian,
    allergenConcern: ALLERGEN_PATTERN.test(currentNeed),
    wantsHot: preferredTags.has("hot"),
    wantsFresh: preferredTags.has("fresh"),
    unsupportedNeeds,
  };
}

export function filterCandidatesByNeed(candidates, need = "") {
  const constraints = extractNeedConstraints(need);
  const normalizedCandidates = sanitizeCandidates(candidates);
  return normalizedCandidates.filter((candidate) => {
    const candidateTags = new Set([...candidate.tags, ...deriveTags(candidate)]);
    return !constraints.blockedTags.some((tag) => candidateTags.has(tag));
  });
}

export function filterCandidatesBySettings(candidates, settings = {}) {
  const normalizedCandidates = sanitizeCandidates(candidates);
  const category = cleanText(settings.category, 30) || "all";
  const price = cleanText(settings.price, 20) || "all";
  const minimumRating = numberOrNull(settings.minRating, 0, 5) ?? 0;
  const radiusKm = numberOrNull(settings.radiusKm, 1, 20) ?? 20;
  return normalizedCandidates.filter((candidate) => {
    const tags = new Set(candidate.tags);
    const matchesCategory = category === "all" || tags.has(category);
    const matchesRating = candidate.rating === null || candidate.rating >= minimumRating;
    const matchesRadius = candidate.distanceKm === null || candidate.distanceKm <= radiusKm;
    const matchesChains = !settings.excludeChains || !CHAIN_NAMES.some((chain) => candidate.name.includes(chain));
    let matchesPrice = true;
    if (price === "cheap") matchesPrice = candidate.priceLevel === null || candidate.priceLevel <= 1;
    if (price === "moderate") matchesPrice = candidate.priceLevel === null || (candidate.priceLevel >= 1 && candidate.priceLevel <= 2);
    if (price === "expensive") matchesPrice = candidate.priceLevel === null || candidate.priceLevel >= 3;
    return matchesCategory && matchesRating && matchesRadius && matchesChains && matchesPrice;
  });
}

function profileWeight(profile, field, key) {
  const weights = profile && typeof profile[field] === "object" ? profile[field] : {};
  const weight = Number(weights[key]);
  return Number.isFinite(weight) ? Math.max(-6, Math.min(6, weight)) : 0;
}

export function scoreCandidate(candidate, context = {}) {
  const constraints = extractNeedConstraints(context.currentNeed);
  const profile = context.profile || {};
  const tags = new Set(candidate.tags || []);
  let score = 1;

  for (const tag of tags) score += profileWeight(profile, "tagWeights", tag) * 0.7;
  for (const category of candidate.categories || []) {
    score += profileWeight(profile, "categoryWeights", category) * 0.45;
  }
  for (const tag of constraints.preferredTags) {
    if (tags.has(tag)) score += 2.2;
  }
  if (candidate.placeId && Array.isArray(profile.favoritePlaceIds) && profile.favoritePlaceIds.includes(candidate.placeId)) {
    score += 4;
  }
  if (candidate.rating !== null) score += candidate.rating * 0.12;
  if (candidate.distanceKm !== null) score += Math.max(0, 0.8 - candidate.distanceKm * 0.12);

  return Math.max(0.05, score);
}

export function pickWeighted(candidates, context = {}, rng = Math.random) {
  const eligible = filterCandidatesByNeed(candidates, context.currentNeed);
  if (!eligible.length) return null;

  const excluded = new Set(Array.isArray(context.excludeIds) ? context.excludeIds : []);
  const unseen = eligible.filter((candidate) => !excluded.has(candidate.placeId));
  const pool = unseen.length ? unseen : eligible;
  const weights = pool.map((candidate) => scoreCandidate(candidate, context));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) return pool[0];

  const randomValue = Math.min(1 - Number.EPSILON, Math.max(0, Number(rng()) || 0));
  let cursor = randomValue * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return pool[index];
  }
  return pool[pool.length - 1];
}

export function toAiCandidate(candidate) {
  const normalized = sanitizeCandidate(candidate);
  if (!normalized) return null;
  return {
    placeId: normalized.placeId,
    name: normalized.name,
    categories: normalized.categories,
    tags: normalized.tags,
    rating: normalized.rating,
    userRatingsTotal: normalized.userRatingsTotal,
    priceLevel: normalized.priceLevel,
    distanceKm: normalized.distanceKm,
    isOpen: normalized.isOpen,
    businessStatus: normalized.businessStatus,
    address: normalized.address,
  };
}

export function isKnownAction(action) {
  return ACTION_SET.has(action);
}

export { cleanText };
