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

test("當下的不要麵需求會排除麵食候選", () => {
  const constraints = extractNeedConstraints("今天想吃熱的，不要麵");
  assert.equal(constraints.wantsHot, true);
  assert.deepEqual(constraints.blockedTags, ["noodles"]);
  assert.deepEqual(filterCandidatesByNeed(candidates, "今天想吃熱的，不要麵").map((item) => item.placeId), ["p-rice", "p-salad"]);
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
