import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNeedConstraints,
  filterCandidatesByNeed,
  filterCandidatesBySettings,
  pickWeighted,
  sanitizeCandidates,
} from "../src/decision.mjs";

const candidates = sanitizeCandidates([
  { placeId: "p-rice", name: "熱飯小館", categories: ["台式"], tags: ["taiwanese", "rice", "hot"], rating: 4.2, priceLevel: 2 },
  { placeId: "p-noodle", name: "拉麵小屋", categories: ["日式"], tags: ["japanese", "noodles", "hot"], rating: 4.8, priceLevel: 2 },
  { placeId: "p-salad", name: "清爽蔬食桌", categories: ["台式"], tags: ["vegetarian", "fresh"], rating: 4.5, priceLevel: 2 },
]);

test("currentNeed 留白時不會產生文字偏好或 hard filter", () => {
  const constraints = extractNeedConstraints("");
  assert.deepEqual(constraints.preferredTags, []);
  assert.deepEqual(constraints.blockedTags, []);
  assert.deepEqual(constraints.unsupportedNeeds, []);
  assert.equal(constraints.fallbackHardFilter, false);
  assert.deepEqual(filterCandidatesByNeed(candidates, "").map((item) => item.placeId), ["p-rice", "p-noodle", "p-salad"]);
});

test("泛用的隨機請求不會被誤判成熱食或清爽", () => {
  for (const need of ["隨便，你決定", "我不知道吃什麼"]) {
    const constraints = extractNeedConstraints(need);
    assert.equal(constraints.preferredTags.includes("hot"), false, need);
    assert.equal(constraints.preferredTags.includes("fresh"), false, need);
  }
});

test("正向需求只加入對應的 soft signal", () => {
  assert.deepEqual(extractNeedConstraints("想吃甜點").preferredTags, ["cafe"]);
  assert.deepEqual(extractNeedConstraints("想吃熱的").preferredTags, ["hot"]);
  assert.deepEqual(extractNeedConstraints("想吃清淡一點").preferredTags, ["fresh"]);
});

test("當下的不要麵需求會排除麵食候選", () => {
  const constraints = extractNeedConstraints("今天想吃熱的，不要麵");
  assert.equal(constraints.wantsHot, true);
  assert.deepEqual(constraints.blockedTags, ["noodles"]);
  assert.deepEqual(filterCandidatesByNeed(candidates, "今天想吃熱的，不要麵").map((item) => item.placeId), ["p-rice", "p-salad"]);
});

test("模糊的吃飯語意不會自動解讀成不要 rice", () => {
  const constraints = extractNeedConstraints("今天想吃熱的，不想吃飯");
  assert.deepEqual(constraints.blockedTags, []);
  assert.deepEqual(filterCandidatesByNeed(candidates, "今天想吃熱的，不想吃飯").map((item) => item.placeId), ["p-rice", "p-noodle", "p-salad"]);
});

test("特定肉類或海鮮不會被 fallback parser 放大成整類排除", () => {
  for (const need of ["不要牛肉", "不要雞肉", "不要魚", "不要蝦", "不要蟹"]) {
    const constraints = extractNeedConstraints(need);
    assert.equal(constraints.blockedTags.includes("meat"), false, need);
    assert.equal(constraints.blockedTags.includes("seafood"), false, need);
    assert.equal(constraints.fallbackHardFilter, false, need);
  }
  assert.equal(extractNeedConstraints("不要肉").blockedTags.includes("meat"), true);
  assert.equal(extractNeedConstraints("不要海鮮").blockedTags.includes("seafood"), true);
});

test("複合語意會保留例外候選，交給 AI 理解完整句子", () => {
  const cases = [
    ["不要麵，但烏龍麵可以", "noodles"],
    ["不想吃飯，但丼飯可以", "rice"],
    ["不要日式，但壽司可以", "japanese"],
    ["不要太油，但炸雞可以", "meat"],
    ["不要辣，但麻辣鍋可以", "spicy"],
    ["最近吃太多拉麵，今天換一點別的", "japanese"],
    ["不要麵，如果沒別的再給我麵", "noodles"],
    ["想吃火鍋或燒肉，不要其他", "meat"],
  ];
  for (const [need, tag] of cases) {
    const constraints = extractNeedConstraints(need);
    assert.equal(constraints.isComplex, true, need);
    assert.equal(constraints.blockedTags.includes(tag), false, need);
    assert.equal(filterCandidatesByNeed(candidates, need).length, candidates.length, need);
  }
  assert.equal(extractNeedConstraints("不要日式，但壽司可以").preferredTags.includes("japanese"), false);
  assert.equal(extractNeedConstraints("最近吃太多拉麵，今天換一點別的").preferredTags.includes("japanese"), false);
});

test("保守 parser 支援簡單明確排除，但複合句只保留 soft signal", () => {
  const simple = extractNeedConstraints("不要麵");
  assert.equal(simple.fallbackHardFilter, true);
  assert.deepEqual(simple.blockedTags, ["noodles"]);
  assert.equal(extractNeedConstraints("想吃熱的，清淡一點，不要麵").blockedTags.includes("noodles"), true);

  const softOnly = [
    "300 元左右，想吃肉，不要太遠",
    "隨便，你決定",
    "我不知道吃什麼",
    "今天想試一點新的",
    "不要我最近常吃的",
  ];
  for (const need of softOnly) {
    const constraints = extractNeedConstraints(need);
    assert.equal(constraints.fallbackHardFilter, false, need);
    assert.doesNotThrow(() => filterCandidatesByNeed(candidates, need), need);
  }
});

test("unsupported natural-language attributes are surfaced without invented facts", () => {
  assert.deepEqual(extractNeedConstraints("不要排隊").unsupportedNeeds, ["目前沒有可靠候位資料"]);
  assert.deepEqual(extractNeedConstraints("想找安靜、可以坐久一點的").unsupportedNeeds, ["目前沒有可靠座位與環境資料"]);
  assert.equal(extractNeedConstraints("不要太辣").fallbackHardFilter, false);
  assert.deepEqual(extractNeedConstraints("不要太辣").unsupportedNeeds, ["目前沒有可靠辣度資料"]);
});

test("過敏需求只產生保守提醒，不產生安全判斷", () => {
  const constraints = extractNeedConstraints("我花生過敏");
  assert.equal(constraints.allergenConcern, true);
  assert.deepEqual(constraints.blockedTags, []);
  assert.deepEqual(constraints.unsupportedNeeds, ["目前無法可靠確認餐廳過敏原，請向餐廳確認。"]);
});

test("AI 或其他輸入不能讓 weighted random 選到被明確排除的候選", () => {
  const selected = pickWeighted(candidates, {
    currentNeed: "不要麵",
  }, () => 0.99);
  assert.notEqual(selected?.placeId, "p-noodle");
});

test("weighted random 會尊重 reroll 的未看過候選", () => {
  const selected = pickWeighted(candidates, { excludeIds: ["p-rice", "p-noodle"] }, () => 0);
  assert.equal(selected?.placeId, "p-salad");
});

test("候選會以 placeId 去重，且保留必要的安全欄位", () => {
  const result = sanitizeCandidates([
    { placeId: "same", name: "第一筆", source: "google" },
    { placeId: "same", name: "第二筆", source: "google" },
    { placeId: "other", name: "另一筆", source: "google", address: "測試地址" },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "第一筆");
  assert.equal(result[1].address, "測試地址");
});

test("原有的最低評分、價格區間與避開連鎖設定會在候選池生效", () => {
  const result = filterCandidatesBySettings([
    { placeId: "chain", name: "麥當勞示範店", rating: 4.8, priceLevel: 1, categories: ["美式"] },
    { placeId: "low", name: "普通小館", rating: 3.9, priceLevel: 1, categories: ["台式"] },
    { placeId: "good", name: "高分小館", rating: 4.5, priceLevel: 2, categories: ["台式"] },
  ], { minRating: 4, price: "moderate", excludeChains: true, category: "all" });
  assert.deepEqual(result.map((item) => item.placeId), ["good"]);
});

test("已知距離會受到 radiusKm hard filter 限制，未知距離仍保留候選", () => {
  const result = filterCandidatesBySettings([
    { placeId: "near", name: "近處小館", distanceKm: 1.2 },
    { placeId: "far", name: "遠處小館", distanceKm: 8 },
    { placeId: "unknown", name: "距離未知小館" },
  ], { radiusKm: 3, minRating: 0, price: "all", category: "all" });
  assert.deepEqual(result.map((item) => item.placeId), ["near", "unknown"]);
});
