import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInteraction } from "../src/storage.mjs";
import {
  NEW_PLACE_SEARCH_FIELDS,
  buildSearchBounds,
  buildTextSearchRequest,
  derivePlaceSearchIntent,
  normalizeNewPlace,
  normalizePlacePriceLevel,
} from "../src/places.mjs";

test("空白、泛用、否定與疲勞需求不會變成 Places 正向搜尋意圖", () => {
  for (const currentNeed of ["", "隨便，你決定", "我不知道吃什麼", "都可以", "不要麵", "不要吃冰", "不要海鮮", "最近拉麵吃太多，今天換別的"]) {
    assert.deepEqual(derivePlaceSearchIntent(currentNeed), { hasPositiveFoodIntent: false, query: "" }, currentNeed);
  }
});

test("明確正向飲食需求會產生保守 Places 搜尋意圖", () => {
  const iceIntent = derivePlaceSearchIntent("吃冰的");
  assert.equal(iceIntent.hasPositiveFoodIntent, true);
  assert.match(iceIntent.query, /冰品|冰淇淋|剉冰|甜點/u);
  assert.match(derivePlaceSearchIntent("想吃牛排").query, /牛排/u);
  assert.match(derivePlaceSearchIntent("想吃拉麵").query, /拉麵/u);
  assert.match(derivePlaceSearchIntent("想吃火鍋").query, /火鍋/u);
  assert.match(derivePlaceSearchIntent("想喝咖啡").query, /咖啡/u);
  assert.match(derivePlaceSearchIntent("冰淇淋").query, /冰淇淋/u);
  assert.match(derivePlaceSearchIntent("想找安靜的冰店").query, /冰品/u);
});

test("正向需求與排除條件並存時仍保留正向搜尋意圖", () => {
  const intent = derivePlaceSearchIntent("想吃冰的，但不要太甜");
  assert.equal(intent.hasPositiveFoodIntent, true);
  assert.match(intent.query, /冰品|冰淇淋|剉冰/u);
});

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

test("正向 currentNeed 優先於 meal keyword，否定需求仍沿用一般搜尋", () => {
  const iceRequest = buildTextSearchRequest({
    origin: { lat: 25, lng: 121 },
    radiusKm: 3,
    mealKeyword: "宵夜 深夜食堂",
    currentNeed: "吃冰的",
    openNow: true,
  });
  assert.match(iceRequest.textQuery, /冰品|冰淇淋|剉冰/u);
  assert.doesNotMatch(iceRequest.textQuery, /宵夜|深夜食堂/u);

  const negativeRequest = buildTextSearchRequest({
    origin: { lat: 25, lng: 121 },
    radiusKm: 3,
    mealKeyword: "晚餐 餐廳",
    currentNeed: "不要麵",
    openNow: true,
  });
  assert.match(negativeRequest.textQuery, /晚餐/);
  assert.doesNotMatch(negativeRequest.textQuery, /不要麵/);
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
