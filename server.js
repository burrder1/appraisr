const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname)));

app.post("/api/appraise", async (req, res) => {
  try {
    const { image, mediaType, hint = "" } = req.body;

    if (!image || !mediaType) {
      return res.status(400).json({
        error: "Image data is required."
      });
    }

    const system = `You are APPRAISR, a no-bullshit expert resale appraiser. Identify items precisely — exact brand, model, variant, year. Give real market values. Be specific. Don't overclaim confidence. If the user provides a hint about what the item is, prioritize that heavily.

JSON only, no markdown, no backticks:
{"identified":true,"itemName":"Exact full name","category":"Category","condition":"Honest condition","conditionScore":85,"confidenceScore":90,"valueRange":{"low":45,"mid":72,"high":110},"recentSale":"Specific comp with platform and price","description":"2-3 sentences on what makes this notable. Be real.","marketTrend":"up|down|stable","trendNote":"Why","hotPlatforms":["eBay","StockX"],"sellingTip":"One specific tip","localMarketNote":"Tulsa/Oklahoma context","redFlags":"Real issues","errorMessage":""}
If unidentifiable set identified:false.`;

    const userMsg = hint
      ? `The user says this item is: "${hint}". Prioritize this. Appraise it. JSON only.`
      : "Appraise this item. JSON only.";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: image
              }
            },
            {
              type: "text",
              text: userMsg
            }
          ]
        }
      ]
    });

    const raw =
      response.content.find(block => block.type === "text")?.text || "";

    const result = JSON.parse(
      raw.replace(/```json|```/g, "").trim()
    );

    res.json(result);

  } catch (error) {
    console.error("APPRAISR ERROR:", error);

    res.status(500).json({
      error: error.message || "Appraisal failed."
    });
  }
});

app.listen(PORT, () => {
  console.log(`APPRAISR running on port ${PORT}`);
});