const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/*
  ================================
  APPRAISR SERVER CONFIG
  ================================
*/

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/*
  ================================
  CORS
  ================================
*/

app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "https://burrder1.github.io"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/*
  ================================
  BODY PARSING
  ================================
*/

app.use(
  express.json({
    limit: "12mb"
  })
);

/*
  ================================
  STATIC FILES
  ================================
*/

app.use(
  express.static(
    path.join(__dirname)
  )
);

/*
  ================================
  HEALTH CHECK
  ================================
*/

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "APPRAISR",
    anthropic: true
  });
});

/*
  ================================
  APPRAISAL
  ================================
*/

app.post("/api/appraise", async (req, res) => {

  console.log("APPRAISR: appraisal request received.");

  try {

    const {
      image,
      mediaType,
      hint = ""
    } = req.body;

    /*
      Validate incoming image.
    */

    if (!image || !mediaType) {

      console.error(
        "APPRAISR: missing image data."
      );

      return res.status(400).json({
        error: "Image data is required."
      });
    }

    console.log(
      "APPRAISR: image received:",
      mediaType
    );

    /*
      ================================
      CLAUDE INSTRUCTIONS
      ================================
    */

    const system = `
You are APPRAISR, a no-bullshit expert resale appraiser.

Identify the photographed item as precisely as possible.

Determine:
- exact brand
- exact model
- variant
- approximate year when possible
- honest physical condition
- realistic resale value
- realistic low/mid/high value range
- recent comparable sale information when you can reasonably infer it
- current market direction
- best selling platforms
- useful selling advice
- potential red flags

Do not invent certainty.

If the image is insufficient to identify the item, say so.

Return ONLY valid JSON.

Do not use markdown.
Do not use code fences.

Use exactly this structure:

{
  "identified": true,
  "itemName": "Exact full name",
  "category": "Category",
  "condition": "Honest condition",
  "conditionScore": 85,
  "confidenceScore": 90,
  "valueRange": {
    "low": 45,
    "mid": 72,
    "high": 110
  },
  "recentSale": "Specific comparable sale information",
  "description": "2-3 sentences describing the item and what affects its value.",
  "marketTrend": "up",
  "trendNote": "Why the market is moving this way.",
  "hotPlatforms": [
    "eBay",
    "Facebook Marketplace"
  ],
  "sellingTip": "One specific useful selling tip.",
  "localMarketNote": "Oklahoma/Tulsa market context.",
  "redFlags": "Important issues to watch for.",
  "errorMessage": ""
}

marketTrend MUST be one of:

"up"
"down"
"stable"

If the item cannot reasonably be identified, return:

{
  "identified": false,
  "itemName": "",
  "category": "",
  "condition": "",
  "conditionScore": 0,
  "confidenceScore": 0,
  "valueRange": {
    "low": 0,
    "mid": 0,
    "high": 0
  },
  "recentSale": "",
  "description": "",
  "marketTrend": "stable",
  "trendNote": "",
  "hotPlatforms": [],
  "sellingTip": "",
  "localMarketNote": "",
  "redFlags": "",
  "errorMessage": "Explain what additional information is needed."
}
`;

    /*
      ================================
      USER MESSAGE
      ================================
    */

    const userMsg = hint
      ? `
The user believes this item is:

"${hint}"

Use that information as a clue, but verify it against the image.

Appraise the photographed item.
Return JSON only.
`
      : `
Appraise the photographed item.

Return JSON only.
`;

    /*
      ================================
      CLAUDE REQUEST
      ================================
    */

    console.log(
      "APPRAISR: sending image to Claude..."
    );

    const response =
      await anthropic.messages.create({

        model: "claude-sonnet-4-6",

        max_tokens: 1200,

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

    console.log(
      "APPRAISR: Claude response received."
    );

    /*
      ================================
      EXTRACT TEXT
      ================================
    */

    const raw =
      response.content
        .filter(
          block =>
            block.type === "text"
        )
        .map(
          block =>
            block.text
        )
        .join("")
        .trim();

    console.log(
      "APPRAISR: Claude response length:",
      raw.length
    );

    if (!raw) {

      throw new Error(
        "Claude returned an empty response."
      );
    }

    /*
      ================================
      CLEAN JSON
      ================================
    */

    let cleaned = raw
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

    /*
      Sometimes a model response can contain
      a little text around the JSON.

      Try to isolate the JSON object.
    */

    const firstBrace =
      cleaned.indexOf("{");

    const lastBrace =
      cleaned.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace !== -1 &&
      lastBrace > firstBrace
    ) {

      cleaned =
        cleaned.slice(
          firstBrace,
          lastBrace + 1
        );

    }

    /*
      ================================
      PARSE JSON
      ================================
    */

    let result;

    try {

      result =
        JSON.parse(cleaned);

    } catch (parseError) {

      console.error(
        "APPRAISR: Claude returned invalid JSON:"
      );

      console.error(raw);

      throw new Error(
        "Claude returned invalid appraisal data."
      );
    }

    /*
      ================================
      NORMALIZE RESPONSE
      ================================
    */

    result = {
      identified:
        Boolean(result.identified),

      itemName:
        result.itemName || "",

      category:
        result.category || "",

      condition:
        result.condition || "",

      conditionScore:
        Number(result.conditionScore) || 0,

      confidenceScore:
        Number(result.confidenceScore) || 0,

      valueRange: {
        low:
          Number(
            result.valueRange?.low
          ) || 0,

        mid:
          Number(
            result.valueRange?.mid
          ) || 0,

        high:
          Number(
            result.valueRange?.high
          ) || 0
      },

      recentSale:
        result.recentSale || "",

      description:
        result.description || "",

      marketTrend:
        ["up", "down", "stable"]
          .includes(
            result.marketTrend
          )
          ? result.marketTrend
          : "stable",

      trendNote:
        result.trendNote || "",

      hotPlatforms:
        Array.isArray(
          result.hotPlatforms
        )
          ? result.hotPlatforms
          : [],

      sellingTip:
        result.sellingTip || "",

      localMarketNote:
        result.localMarketNote || "",

      redFlags:
        result.redFlags || "",

      errorMessage:
        result.errorMessage || ""
    };

    console.log(
      "APPRAISR: appraisal complete:",
      result.itemName
    );

    /*
      ================================
      SEND TO BROWSER
      ================================
    */

    return res.json(result);

  } catch (error) {

    console.error(
      "=============================="
    );

    console.error(
      "APPRAISR ERROR"
    );

    console.error(
      error
    );

    console.error(
      "=============================="
    );

    return res.status(500).json({
      error:
        error.message ||
        "Appraisal failed."
    });
  }
});

/*
  ================================
  START SERVER
  ================================
*/

app.listen(
  PORT,
  () => {

    console.log(
      `APPRAISR running on port ${PORT}`
    );

  }
);