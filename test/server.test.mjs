import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { parseModelSelection, recommend, validateSelection } from "../server.mjs";

test("模型輸出可從 JSON code fence 解析，但只保留 placeId 與 reason", () => {
  const selection = parseModelSelection('```json\n{"placeId":"google-place-1","reason":"符合你今天想吃熱食的條件。","extra":"ignore"}\n```');
  assert.deepEqual(selection, { placeId: "google-place-1", reason: "符合你今天想吃熱食的條件。" });
});

test("模型不能選擇候選清單以外的餐廳", () => {
  assert.throws(
    () => validateSelection({ placeId: "invented", reason: "看起來不錯" }, [{ placeId: "real" }]),
    /ai_unknown_candidate/,
  );
});

test("OpenAI-compatible AI 成功時只能選候選清單中的項目，且看到完整 free-text 候選", async () => {
  const previous = {
    baseUrl: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
    apiKey: process.env.AI_API_KEY,
  };
  let capturedPrompt;
  const provider = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const prompt = JSON.parse(body.messages[1].content);
      capturedPrompt = prompt;
      const placeId = prompt.candidates[0].placeId;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ placeId, reason: "符合當下需求的候選。" }) } }] }));
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.AI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.AI_MODEL = "mock-low-cost-model";
  process.env.AI_API_KEY = "";
  try {
    const result = await recommend({
      currentNeed: "不要麵",
      settings: { minRating: 0, price: "all" },
      tasteProfile: { interactionCount: 2, tagWeights: { hot: 3 }, categoryWeights: { 台式: 2 } },
      recentInteractions: [{ action: "accepted", placeId: "p-old", placeName: "之前吃過", tags: ["hot"] }],
      candidates: [
        { placeId: "p-rice", name: "熱飯小館", tags: ["rice", "hot"], rating: 4.2, source: "google" },
        { placeId: "p-noodle", name: "拉麵小屋", tags: ["noodles", "hot"], rating: 4.9, source: "google" },
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "ai");
    assert.equal(result.body.placeId, "p-rice");
    assert.equal(capturedPrompt.currentNeed, "不要麵");
    assert.equal(capturedPrompt.tasteProfile.interactionCount, 2);
    assert.equal(capturedPrompt.recentInteractions[0].action, "accepted");
    assert.equal(capturedPrompt.candidates.some((candidate) => candidate.placeId === "p-noodle"), true);
  } finally {
    await new Promise((resolve) => provider.close(resolve));
    if (previous.baseUrl === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previous.model;
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous.apiKey;
  }
});

async function withProvider(handler, callback) {
  const previous = { baseUrl: process.env.AI_BASE_URL, model: process.env.AI_MODEL, apiKey: process.env.AI_API_KEY, timeout: process.env.AI_TIMEOUT_MS };
  const provider = http.createServer(handler);
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.AI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.AI_MODEL = "mock-fallback-model";
  process.env.AI_API_KEY = "";
  try {
    return await callback();
  } finally {
    await new Promise((resolve) => provider.close(resolve));
    if (previous.baseUrl === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previous.model;
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous.apiKey;
    if (previous.timeout === undefined) delete process.env.AI_TIMEOUT_MS; else process.env.AI_TIMEOUT_MS = previous.timeout;
  }
}

const fallbackPayload = {
  currentNeed: "不要麵",
  settings: { minRating: 0, price: "all" },
  candidates: [
    { placeId: "p-rice", name: "熱飯小館", tags: ["rice"], rating: 4.2, source: "google" },
    { placeId: "p-noodle", name: "拉麵小屋", tags: ["noodles"], rating: 4.9, source: "google" },
  ],
};

const naturalNeeds = [
  "",
  "不要麵",
  "不要麵，但烏龍麵可以",
  "不想吃飯，但丼飯可以",
  "不想吃飯",
  "不要日式，但壽司可以",
  "不要太油，但炸雞可以",
  "不要辣，但麻辣鍋可以",
  "最近吃太多拉麵，今天換一點別的",
  "不要麵，如果沒別的再給我麵",
  "想吃火鍋或燒肉，不要其他",
  "想吃熱的，清淡一點，不要麵",
  "300 元左右，想吃肉，不要太遠",
  "隨便，你決定",
  "我不知道吃什麼",
  "今天想試一點新的",
  "不要我最近常吃的",
  "不要排隊",
  "想找安靜、可以坐久一點的",
];

function recommendationPayload(currentNeed) {
  return {
    currentNeed,
    settings: { minRating: 0, price: "all", meal: "dinner" },
    tasteProfile: { interactionCount: 2, tagWeights: { hot: 3 }, categoryWeights: { 台式: 2 } },
    recentInteractions: [{ action: "accepted", placeId: "p-old", placeName: "之前吃過", tags: ["hot"], currentNeed, meal: "dinner" }],
    candidates: [
      { placeId: "p-rice", name: "熱飯小館", tags: ["rice", "hot"], rating: 4.2, source: "google" },
      { placeId: "p-noodle", name: "拉麵小屋", tags: ["noodles", "hot"], rating: 4.9, source: "google" },
    ],
  };
}

test("19 個自然語言案例在 AI available 時保留完整候選與 context", async () => {
  const prompts = [];
  await withProvider((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const prompt = JSON.parse(body.messages[1].content);
      prompts.push({ prompt, system: body.messages[0].content });
      const placeId = prompt.candidates[0].placeId;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ placeId, reason: "符合目前候選與條件。" }) } }] }));
    });
  }, async () => {
    for (const currentNeed of naturalNeeds) {
      const result = await recommend(recommendationPayload(currentNeed));
      assert.equal(result.status, 200, currentNeed);
      assert.equal(result.body.mode, "ai", currentNeed);
      assert.equal(result.body.placeId, "p-rice", currentNeed);
    }
  });
  assert.equal(prompts.length, naturalNeeds.length);
  assert.deepEqual(prompts.map(({ prompt }) => prompt.currentNeed), naturalNeeds.map((need) => need.normalize("NFKC")));
  assert.ok(prompts.every(({ prompt }) => prompt.candidates.some((candidate) => candidate.placeId === "p-noodle")));
  assert.equal(prompts[0].prompt.recentInteractions[0].currentNeed, naturalNeeds[0]);
  assert.equal(prompts[0].prompt.recentInteractions[0].meal, "dinner");
  assert.match(prompts[0].system, /negation|exceptions|temporary|novelty/i);
  assert.match(prompts[0].system, /currentNeed is optional|empty/i);
  assert.match(prompts[0].system, /allergen|cross-contamination/i);
});

test("19 個自然語言案例在 AI unavailable 時仍回到 weighted random", async () => {
  const names = ["AI_BASE_URL", "OPENAI_BASE_URL", "AI_API_KEY", "OPENAI_API_KEY", "AI_MODEL", "AI_TIMEOUT_MS"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  try {
    for (const currentNeed of naturalNeeds) {
      const result = await recommend(recommendationPayload(currentNeed));
      assert.equal(result.status, 200, currentNeed);
      assert.equal(result.body.mode, "fallback", currentNeed);
      assert.ok(["p-rice", "p-noodle"].includes(result.body.placeId), currentNeed);
      if (currentNeed === "不要麵") assert.equal(result.body.placeId, "p-rice");
    }
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("AI 選到違反簡單明確需求的已知 candidate 時仍會 fallback", async () => {
  await withProvider((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ placeId: "p-noodle", reason: "模型錯誤選擇。" }) } }] }));
    });
  }, async () => {
    const result = await recommend(recommendationPayload("不要麵"));
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "fallback");
    assert.equal(result.body.placeId, "p-rice");
  });
});

test("AI 不得把過敏需求說成候選餐廳安全", () => {
  assert.throws(
    () => validateSelection(
      { placeId: "p-rice", reason: "這家沒有花生，可以放心吃。" },
      [{ placeId: "p-rice", tags: ["rice"] }],
      { currentNeed: "我花生過敏" },
    ),
    /ai_unsafe_allergen_claim/,
  );
});

test("server 端也會排除 Taste Profile 中的 active blacklist", async () => {
  const names = ["AI_BASE_URL", "OPENAI_BASE_URL", "AI_API_KEY", "OPENAI_API_KEY", "AI_MODEL"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  try {
    const result = await recommend({
      currentNeed: "",
      settings: { minRating: 0, price: "all" },
      tasteProfile: { blacklistedPlaceIds: ["p-blocked"] },
      candidates: [
        { placeId: "p-blocked", name: "已封鎖餐廳", rating: 4.9, source: "demo" },
        { placeId: "p-allowed", name: "可推薦餐廳", rating: 4.2, source: "demo" },
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.placeId, "p-allowed");
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("AI endpoint error 會回到 weighted random", async () => {
  const result = await withProvider((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "temporarily_unavailable" }));
    });
  }, () => recommend(fallbackPayload));
  assert.equal(result.body.mode, "fallback");
  assert.equal(result.body.placeId, "p-rice");
});

test("AI invalid JSON 與 timeout 都不會阻斷 weighted random", async () => {
  const invalidJson = await withProvider((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }));
    });
  }, () => recommend(fallbackPayload));
  assert.equal(invalidJson.body.mode, "fallback");

  const timeoutResult = await withProvider((request) => {
    request.on("error", () => {});
  }, () => {
    process.env.AI_TIMEOUT_MS = "2500";
    return recommend(fallbackPayload);
  });
  assert.equal(timeoutResult.body.mode, "fallback");
  assert.equal(timeoutResult.body.placeId, "p-rice");
});

test("AI 格式錯誤或未知 placeId 會回到 weighted random", async () => {
  const previous = { baseUrl: process.env.AI_BASE_URL, model: process.env.AI_MODEL, apiKey: process.env.AI_API_KEY };
  const provider = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: '{"placeId":"invented","reason":"不在候選中"}' } }] }));
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.AI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.AI_MODEL = "mock-invalid-model";
  process.env.AI_API_KEY = "";
  try {
    const result = await recommend({
      currentNeed: "不要麵",
      settings: { minRating: 0, price: "all" },
      candidates: [{ placeId: "p-rice", name: "熱飯小館", tags: ["rice"], rating: 4.2, source: "google" }],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "fallback");
    assert.equal(result.body.placeId, "p-rice");
  } finally {
    await new Promise((resolve) => provider.close(resolve));
    if (previous.baseUrl === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previous.model;
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous.apiKey;
  }
});
