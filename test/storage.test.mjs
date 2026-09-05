import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTasteProfile,
  clearLocalTasteData,
  getInteractions,
  getTasteProfile,
  saveInteraction,
} from "../src/storage.mjs";

class MemoryStorage {
  #data = new Map();
  getItem(key) { return this.#data.has(key) ? this.#data.get(key) : null; }
  setItem(key, value) { this.#data.set(key, String(value)); }
  removeItem(key) { this.#data.delete(key); }
}

test("interactions 與 Taste Profile 會持續寫入 localStorage 介面", () => {
  const storage = new MemoryStorage();
  saveInteraction({ action: "accepted", placeId: "demo-a", placeName: "熱飯小館", categories: ["台式"], tags: ["taiwanese", "hot"] }, storage);
  saveInteraction({ action: "favorited", placeId: "demo-a", placeName: "熱飯小館", categories: ["台式"], tags: ["taiwanese", "hot"] }, storage);
  saveInteraction({ action: "rerolled", placeId: "demo-b", placeName: "拉麵小屋", categories: ["日式"], tags: ["japanese", "noodles"] }, storage);

  const interactions = getInteractions(storage);
  const profile = getTasteProfile(storage);
  assert.equal(interactions.length, 3);
  assert.equal(profile.actionCounts.favorited, 1);
  assert.ok(profile.tagWeights.taiwanese > 0);
  assert.ok(profile.favoritePlaceIds.includes("demo-a"));
  assert.ok(profile.avoidPreferences.some((item) => item.key === "noodles"));
});

test("profile 可由純事件重建，且會保留封鎖訊號", () => {
  const profile = buildTasteProfile([
    { action: "blacklisted", placeId: "demo-c", placeName: "辣味小館", categories: ["台式"], tags: ["spicy"] },
  ]);
  assert.equal(profile.actionCounts.blacklisted, 1);
  assert.equal(profile.tagWeights.spicy, -4);
});

test("shown 是可追蹤但不會產生偏好分數的事件", () => {
  const storage = new MemoryStorage();
  saveInteraction({ action: "shown", placeId: "demo-a", placeName: "熱飯小館", tags: ["rice"] }, storage);
  const profile = getTasteProfile(storage);
  assert.equal(profile.actionCounts.shown, 1);
  assert.equal(profile.tagWeights.rice, 0);
});

test("清除學習紀錄會同時移除 interactions 與 Taste Profile", () => {
  const storage = new MemoryStorage();
  saveInteraction({ action: "accepted", placeId: "demo-a", placeName: "熱飯小館" }, storage);
  assert.equal(clearLocalTasteData(storage), true);
  assert.deepEqual(getInteractions(storage), []);
  assert.equal(getTasteProfile(storage).interactionCount, 0);
});
