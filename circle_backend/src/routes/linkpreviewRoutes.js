const express = require("express");
const cheerio = require("cheerio");

const router = express.Router();

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

router.get("/", async (req, res) => {
  const { url } = req.query;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");

    // X / Twitter — use oEmbed API (no scraping needed)
    if (hostname === "x.com" || hostname === "twitter.com") {
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
      const r = await fetchWithTimeout(oembedUrl);
      if (!r.ok) throw new Error(`oEmbed ${r.status}`);
      const data = await r.json();
      return res.json({
        title: data.author_name ? `${data.author_name} on X` : "Post on X",
        description: data.html
          ? data.html.replace(/<[^>]+>/g, "").trim().slice(0, 200)
          : "",
        image: `https://unavatar.io/twitter/${data.author_url?.split("/").pop() || "x"}`,
      });
    }

    // Everything else — scrape OG tags
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    const getMeta = (...names) => {
      for (const name of names) {
        const val =
          $(`meta[property="${name}"]`).attr("content") ||
          $(`meta[name="${name}"]`).attr("content");
        if (val) return val.trim();
      }
      return "";
    };

    const title =
      getMeta("og:title", "twitter:title") || $("title").text().trim() || "";
    const description = getMeta("og:description", "twitter:description", "description");
    const image = getMeta("og:image", "twitter:image");

    return res.json({ title, description, image });
  } catch (err) {
    console.error("[link-preview] error:", err.message);
    return res.status(502).json({ error: err.message });
  }
});

module.exports = router;