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

test("OpenAI-compatible AI 成功時只能選候選清單中的項目", async () => {
  const previous = {
    baseUrl: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
    apiKey: process.env.AI_API_KEY,
  };
  const provider = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const prompt = JSON.parse(body.messages[1].content);
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
      candidates: [
        { placeId: "p-rice", name: "熱飯小館", tags: ["rice", "hot"], rating: 4.2, source: "google" },
        { placeId: "p-noodle", name: "拉麵小屋", tags: ["noodles", "hot"], rating: 4.9, source: "google" },
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "ai");
    assert.equal(result.body.placeId, "p-rice");
  } finally {
    await new Promise((resolve) => provider.close(resolve));
    if (previous.baseUrl === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previous.model;
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous.apiKey;
  }
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
