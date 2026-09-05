import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTasteProfile,
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
