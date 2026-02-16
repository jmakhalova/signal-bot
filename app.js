const { App } = require("@slack/bolt");
const Anthropic = require("@anthropic-ai/sdk");
const Airtable = require("airtable");
const axios = require("axios");

// ─── Configuration ───────────────────────────────────────────────────────────

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || "Cultural Signals";

// The Slack channel to monitor
const SIGNALS_CHANNEL = process.env.SIGNALS_CHANNEL_ID;

// ─── Analysis Prompt ─────────────────────────────────────────────────────────
// Full prompt lives in ANALYSIS-PROMPT.md — keep that file as source of truth
// and paste updates here.

const ANALYSIS_SYSTEM_PROMPT = `You are a cultural signal analyst. Your job is to take raw cultural signals — links, screenshots, observations — and decompose them into a structured format using a specific analytical framework.

You think in tensions and oppositions. You look for what conflict a signal reveals, what anxiety it soothes, what power structure it challenges. You are precise with language — no jargon, no filler, no vague trend-speak. Every word earns its place.

ANALYSIS PROCESS:

Before writing any fields, complete these internal steps:

STEP 1 — EXTRACT THE CORE TENSION
Identify:
- What's declining (the old behavior/platform/value)
- What's rising (the new behavior/platform/value)
- What's migrating (the shift in location, medium, or meaning)

STEP 2 — WRITE THE TLDR
Use present tense active verbs: "replacing," "moving into," "becoming"
Avoid weak verbs: "emerging," "growing," "rising" (unless paired with strong context)
Name both sides of the tension when possible
The TLDR must contain these elements in order:
1. The behavioral shift (what changed) — 1 sentence
2. The data/evidence (proof it's real) — specific numbers, examples, or mechanics
3. The mechanism (why it's happening) — the structural force underneath
4. The implication (what it means) — the "so what" for culture/systems

Bad: "Video games emerging as new music source"
Good: "VIDEO GAMES ARE REPLACING STREAMING AS THE NEW MUSIC VENUE"

STEP 3 — FILL ALL FIELDS
Use the controlled vocabularies below. Do not invent new terms unless nothing fits.

OUTPUT FORMAT:
Return ONLY a valid JSON object with these fields. No markdown, no explanation, no preamble.

{
  "source": "(max 150 chars) Platform or publication name + URL if available",
  "tldr": "(max 600 chars) Follow the TLDR formula: [BEHAVIOR SHIFT]. [DATA/EVIDENCE with specific numbers or examples]. [MECHANISM — the why underneath]. [IMPLICATION — what this means for culture/power/systems].",
  "what_who": "(max 300 chars) Name actual people, brands, entities, platforms. Name opposing forces if there's a vs. dynamic. Never say 'consumers' or 'brands' generically.",
  "why": "(max 200 chars) What structural force makes this inevitable? Format: [System change] + [resulting behavior] + [why alternatives fail].",
  "where": "(max 100 chars) Geographic only. No conceptual locations. Good: 'United States' or 'Global'. Bad: 'Social media' or 'Online spaces'.",
  "when": "(max 80 chars) Use actual dates/months/years when available. Good: 'May 2024' or 'Post-2022, accelerated 2024'. Bad: 'Recently' or 'Modern era'.",
  "how": "(max 250 chars) Actual mechanics on the ground. Format as chain of actions or simultaneous behaviors.",
  "theme": "(max 100 chars) Pick 2-3 from THEME VOCABULARY, slash-separated, primary first.",
  "category": "(max 80 chars) Pick 2-3 from CATEGORY VOCABULARY, slash-separated, most specific first.",
  "conflict": "(max 250 chars) Pick 2-4 from CONFLICT VOCABULARY. Format: X vs. Y / A vs. B. Flag genuinely new terms with [NEW].",
  "tags": "(max 300 chars) Start with CONTROLLED TAGS, then FLEXIBLE TAGS. Format: tag1,tag2,tag3 — no spaces after commas.",
  "date_added": "Article publication date when known. Format: Month DD, YYYY. If unknown, use today's date."
}

---

CONFLICT VOCABULARY (use these exact terms):

Economic: access vs. exclusivity / affordability vs. margin / speed vs. protection / abundance vs. scarcity / price vs. value / free vs. premium

Cultural: authenticity vs. imitation / human vs. AI / effort vs. ease / curation vs. overload / privacy vs. surveillance / intimacy vs. performance

Structural: creator vs. platform / individual vs. algorithm / linear vs. loop / centralized vs. distributed / ownership vs. access / permanence vs. disposability

Social: community vs. transaction / belonging vs. consumption / identity vs. entertainment / reputation vs. anonymity / local vs. global

Power: brand authority vs. creator authority / institutional vs. grassroots / legacy vs. emerging / gatekeeping vs. democratization

Temporal: nostalgia vs. futurism / patience vs. immediacy / longevity vs. churn

---

THEME VOCABULARY (use these exact terms):

Cultural Dynamics: value erosion / aesthetic churn / fandom as identity / status recalibration / taste collapse / cultural exhaustion

Economic Structures: creator economics / platform dependency / margin compression / pricing transparency / access inequality

Behavioral Patterns: consumption fragmentation / attention collapse / loyalty dissolution / impulse mechanics / research intensification

Identity and Belonging: community infrastructure / generational handoff / identity performance / belonging economics

System Dynamics: algorithmic mediation / speed vs. quality / visibility as vulnerability / legibility crisis

---

CATEGORY VOCABULARY (use these exact terms):

Industries: Fashion business / Beauty industry / Music industry / Gaming / Publishing / Film/TV

Domains: Creator economy / Platform economics / Youth culture / Gen Z behavior / Millennial behavior / Fandom culture

Practice Areas: Brand strategy / Marketing infrastructure / Social commerce / Community building / Content creation / IP protection

Technologies: AI/automation / Algorithm culture / E-commerce / Streaming

---

CONTROLLED TAGS (use when applicable):

Demographics: Gen Z, Gen Alpha, Millennials, Gen X
Platforms: TikTok, Instagram, YouTube, Amazon, Substack
Behaviors: dupe culture, deinfluencing, UGC, algorithmic trust, impulse buying, research behavior
Economics: ultra-fast fashion, pricing skepticism, margin pressure, subscription fatigue

After controlled tags, add flexible tags specific to the signal: brand names (exact spelling), research sources, specific cultural phenomena, product categories.

---

QUALITY RULES:

1. The TLDR should be sharp enough to read aloud in a presentation.
2. The "why" field is the most important. This is where the cultural intelligence lives.
3. Conflicts must name real structural tensions, not vague oppositions like "old vs. new."
4. Never editorialize. No "exciting," "important," "interesting." Let the data speak.
5. Be specific. Not "social platforms" — say "TikTok." Not "young consumers" — say "Gen Z." Not "streaming services" — say "Spotify."
6. If the signal is an image or screenshot without context, analyze what you can see and note what's ambiguous.
7. If a conflict doesn't fit existing vocabulary, check if it's a combination of existing terms first.
8. Output ONLY valid JSON.`;

// ─── URL and Content Extraction ──────────────────────────────────────────────

function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s<>]+)/gi;
  return text ? text.match(urlRegex) || [] : [];
}

async function fetchUrlContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CulturalSignalBot/1.0)",
      },
      maxContentLength: 50000,
    });

    let text = response.data;
    if (typeof text === "string") {
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
      text = text.replace(/<[^>]+>/g, " ");
      text = text.replace(/\s+/g, " ").trim();
      text = text.substring(0, 3000);
    }
    return text;
  } catch (error) {
    console.error(`Failed to fetch URL ${url}:`, error.message);
    return `[Could not fetch content from ${url}]`;
  }
}

async function downloadSlackFile(fileUrl) {
  try {
    const response = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      responseType: "arraybuffer",
      timeout: 15000,
    });
    return Buffer.from(response.data).toString("base64");
  } catch (error) {
    console.error("Failed to download Slack file:", error.message);
    return null;
  }
}

// ─── Claude Analysis ─────────────────────────────────────────────────────────

async function analyzeSignal(content, imageData = null) {
  const userContent = [];

  if (imageData) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageData.mimeType,
        data: imageData.base64,
      },
    });
  }

  userContent.push({
    type: "text",
    text: `Analyze this cultural signal:\n\n${content}`,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const responseText = response.content[0].text;

  try {
    return JSON.parse(responseText);
  } catch (e) {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Failed to parse analysis response as JSON");
  }
}

// ─── Airtable Storage ────────────────────────────────────────────────────────

async function storeInAirtable(analysis, rawInput, slackLink) {
  const record = await base(TABLE_NAME).create(
    {
      Source: (analysis.source || "").substring(0, 150),
      TLDR: (analysis.tldr || "").substring(0, 600),
      "What/Who": (analysis.what_who || "").substring(0, 300),
      Why: (analysis.why || "").substring(0, 200),
      Where: (analysis.where || "").substring(0, 100),
      When: (analysis.when || "").substring(0, 80),
      How: (analysis.how || "").substring(0, 250),
      Theme: (analysis.theme || "").substring(0, 100),
      Category: (analysis.category || "").substring(0, 80),
      Conflict: (analysis.conflict || "").substring(0, 250),
      Tags: (analysis.tags || "").substring(0, 300),
      "Date Added": analysis.date_added || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      "Raw Input": rawInput.substring(0, 100000),
      "Slack Link": slackLink || "",
    },
    { typecast: true }
  );

  return record;
}

// ─── Format Analysis for Slack ───────────────────────────────────────────────

function formatAnalysisForSlack(analysis) {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Signal Captured",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*TLDR:* ${analysis.tldr}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Theme:*\n${analysis.theme}`,
        },
        {
          type: "mrkdwn",
          text: `*Category:*\n${analysis.category}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Conflict:* ${analysis.conflict}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Why:*\n${analysis.why}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What/Who:* ${analysis.what_who}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*How:* ${analysis.how}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Where:*\n${analysis.where}`,
        },
        {
          type: "mrkdwn",
          text: `*When:*\n${analysis.when}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Tags: ${analysis.tags}`,
        },
      ],
    },
    { type: "divider" },
  ];
}

// ─── Message Handler ─────────────────────────────────────────────────────────

app.message(async ({ message, client }) => {
  // Only process messages in the signals channel
  if (message.channel !== SIGNALS_CHANNEL) return;

  // Ignore bot messages and thread replies
  if (message.bot_id || message.subtype === "bot_message") return;
  if (message.thread_ts && message.thread_ts !== message.ts) return;

  try {
    // React with eyes emoji to show processing
    await client.reactions.add({
      channel: message.channel,
      timestamp: message.ts,
      name: "eyes",
    });

    // Build content from message
    let content = message.text || "";
    let imageData = null;

    // Extract and fetch URL content
    const urls = extractUrls(content);
    if (urls.length > 0) {
      for (const url of urls.slice(0, 3)) {
        const pageContent = await fetchUrlContent(url);
        content += `\n\n--- Content from ${url} ---\n${pageContent}`;
      }
    }

    // Handle image/file attachments
    if (message.files && message.files.length > 0) {
      const file = message.files[0];
      if (
        file.mimetype &&
        (file.mimetype.startsWith("image/") ||
          file.mimetype === "application/pdf")
      ) {
        const base64 = await downloadSlackFile(file.url_private);
        if (base64) {
          imageData = {
            base64: base64,
            mimeType: file.mimetype,
          };
          content += `\n\n[Image attached: ${file.name || "unnamed"}]`;
        }
      }
    }

    if (!content.trim() && !imageData) {
      return;
    }

    // Analyze with Claude
    const analysis = await analyzeSignal(content, imageData);

    // Build Slack permalink
    const slackLink = `https://slack.com/archives/${message.channel}/p${message.ts.replace(".", "")}`;

    // Store in Airtable
    await storeInAirtable(analysis, content, slackLink);

    // Reply in thread with analysis
    const blocks = formatAnalysisForSlack(analysis);
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      blocks: blocks,
      text: `Signal captured: ${analysis.tldr}`,
    });

    // Replace eyes with checkmark
    await client.reactions.remove({
      channel: message.channel,
      timestamp: message.ts,
      name: "eyes",
    });
    await client.reactions.add({
      channel: message.channel,
      timestamp: message.ts,
      name: "white_check_mark",
    });
  } catch (error) {
    console.error("Error processing signal:", error);

    try {
      await client.reactions.remove({
        channel: message.channel,
        timestamp: message.ts,
        name: "eyes",
      });
      await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: "warning",
      });
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        text: `Failed to process this signal: ${error.message}`,
      });
    } catch (reactError) {
      console.error("Failed to add error reaction:", reactError);
    }
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

(async () => {
  await app.start();
  console.log("Cultural Signal Bot is running");
  console.log(`Monitoring channel: ${SIGNALS_CHANNEL}`);
})();
