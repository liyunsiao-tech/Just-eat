import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInteraction } from "../src/storage.mjs";
import {
  NEW_PLACE_SEARCH_FIELDS,
  buildSearchBounds,
  buildTextSearchRequest,
  normalizeNewPlace,
  normalizePlacePriceLevel,
} from "../src/places.mjs";

test("New Places search request 使用指定 fields 並保留實際搜尋範圍", () => {
  const request = buildTextSearchRequest({
    origin: { lat: 25, lng: 121 },
    radiusKm: 1,
    mealKeyword: "晚餐 餐廳",
    categoryKeyword: "日式餐廳",
    openNow: true,
  });
  assert.equal(request.textQuery, "晚餐 餐廳 日式餐廳 餐廳");
  assert.deepEqual(request.fields, [...NEW_PLACE_SEARCH_FIELDS]);
  assert.equal(request.fields.includes("*"), false);
  assert.equal(request.isOpenNow, true);
  assert.equal(request.maxResultCount, 20);
  assert.ok(request.locationRestriction.south < 25);
  assert.ok(request.locationRestriction.north > 25);
  assert.ok(request.locationRestriction.west < 121);
  assert.ok(request.locationRestriction.east > 121);
  assert.ok(buildSearchBounds({ lat: 25, lng: 121 }, 1));
});

test("New Place object 會安全轉成 eat candidate", () => {
  let photoOptions;
  const candidate = normalizeNewPlace({
    id: "new-place-1",
    displayName: "測試日式餐廳",
    formattedAddress: "測試地址",
    location: { lat: () => 25, lng: () => 121 },
    rating: 4.6,
    userRatingCount: 123,
    priceLevel: "MODERATE",
    businessStatus: "OPERATIONAL",
    types: ["restaurant", "japanese_restaurant"],
    googleMapsURI: "https://maps.google.com/?cid=test-place",
    photos: [{
      getURI: (options) => {
        photoOptions = options;
        return "https://lh3.googleusercontent.com/test-photo";
      },
      authorAttributions: [
        { displayName: "測試作者", uri: "https://maps.google.com/contrib/test-author" },
        { displayName: "不安全連結", uri: "javascript:alert(1)" },
      ],
    }],
  }, { origin: { lat: 25, lng: 121 }, openNow: true });

  assert.equal(candidate.placeId, "new-place-1");
  assert.equal(candidate.name, "測試日式餐廳");
  assert.equal(candidate.address, "測試地址");
  assert.equal(candidate.rating, 4.6);
  assert.equal(candidate.userRatingsTotal, 123);
  assert.equal(candidate.priceLevel, 2);
  assert.equal(candidate.businessStatus, "OPERATIONAL");
  assert.equal(candidate.isOpen, true);
  assert.equal(candidate.distanceKm, 0);
  assert.match(candidate.mapsUrl, /destination_place_id=new-place-1/);
  assert.equal(candidate.photoUrl, "https://lh3.googleusercontent.com/test-photo");
  assert.deepEqual(candidate.photoAttributions, [
    { displayName: "測試作者", uri: "https://maps.google.com/contrib/test-author" },
    { displayName: "不安全連結", uri: "" },
  ]);
  assert.deepEqual(photoOptions, { maxWidth: 960, maxHeight: 720 });
});

test("New Places price level 會轉成既有 weighted random 使用的數值", () => {
  assert.equal(normalizePlacePriceLevel("INEXPENSIVE"), 1);
  assert.equal(normalizePlacePriceLevel("PRICE_LEVEL_VERY_EXPENSIVE"), 4);
  assert.equal(normalizePlacePriceLevel("unknown"), null);
});

test("照片 URI 不會進入 localStorage interaction schema", () => {
  const interaction = normalizeInteraction({
    action: "shown",
    placeId: "new-place-1",
    placeName: "測試日式餐廳",
    photoUrl: "https://lh3.googleusercontent.com/test-photo",
  });
  assert.equal(Object.hasOwn(interaction, "photoUrl"), false);
});
