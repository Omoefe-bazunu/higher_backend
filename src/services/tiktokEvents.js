const PIXEL_ID = process.env.TIKTOK_PIXEL_ID; // D9LFNJ3C77U3RB5B4E20
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN; // the token you generate in TikTok

async function sendTikTokEvent({ event, event_id, email, value, contents, url }) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn("[TikTok] Missing PIXEL_ID or ACCESS_TOKEN");
    return;
  }

  const payload = {
    event_source: "web",
    event_source_id: PIXEL_ID,
    data: [
      {
        event,
        event_time: Math.floor(Date.now() / 1000),
        event_id, // important for deduplication
        user: {
          email: email ? hashEmail(email) : undefined,
        },
        properties: {
          contents,
          value,
          currency: "USD",
          content_type: "product",
        },
        page: {
          url: url || "https://www.tailoredfurnitures.com",
        },
      },
    ],
  };

  try {
    const response = await fetch(
      "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      {
        method: "POST",
        headers: {
          "Access-Token": ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();
    console.log(`[TikTok] ${event} response:`, result);
  } catch (err) {
    console.error(`[TikTok] Failed to send ${event}:`, err.message);
  }
}

// Simple SHA-256 hash for email (TikTok requires hashed PII)
function hashEmail(email) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

module.exports = { sendTikTokEvent };
