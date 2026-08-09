// Build-time content index for the MCP server (backend/mcp.go).
//
// Emits /content-index.json: a machine-readable snapshot of every content page
// (blogs, about, landing pages) plus the curated project catalog from
// _data/features.js. The Go backend loads this file and serves it over MCP so
// AI assistants can search and read the site. Regenerated on every `eleventy`
// build; the backend hot-reloads it when the mtime changes.

// Pages whose rendered HTML we don't want in the index (feeds, config, auth).
const EXCLUDE_URLS = new Set(["/sitemap.xml", "/robots.txt", "/content-index.json"]);
const EXCLUDE_PREFIXES = ["/login"];

// Strip HTML tags/entities down to readable plaintext for search + retrieval.
function toText(html) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Map a URL to a coarse section label used for filtering in the MCP tools.
function sectionFor(url) {
  if (url === "/") return "home";
  if (url.startsWith("/blogs/")) return "blog";
  if (url.startsWith("/games/")) return "game";
  if (url.startsWith("/photos")) return "photos";
  if (url.startsWith("/about")) return "about";
  if (url.startsWith("/gallery")) return "gallery";
  return "other";
}

module.exports = class {
  data() {
    return {
      permalink: "/content-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    // Pages: every rendered HTML page with real content.
    const pages = [];
    for (const item of data.collections.all) {
      const url = item.url;
      if (!url) continue;
      if (!item.outputPath || !item.outputPath.endsWith(".html")) continue;
      if (EXCLUDE_URLS.has(url)) continue;
      if (EXCLUDE_PREFIXES.some((p) => url.startsWith(p))) continue;

      const title = (item.data && item.data.title) || "";
      const description = (item.data && item.data.description) || "";
      const text = toText(item.templateContent);
      if (!text && !title) continue;

      pages.push({
        url,
        title,
        description,
        section: sectionFor(url),
        text,
      });
    }

    // Projects: the curated feature-card catalog (home/blogs/games groupings),
    // deduped by href, recording which section(s) each card appears in.
    const groups = data.features || {};
    const projMap = new Map();
    for (const [section, cards] of Object.entries(groups)) {
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        if (!card || !card.href) continue;
        if (!projMap.has(card.href)) {
          projMap.set(card.href, {
            title: (card.prefix || "") + (card.title || ""),
            href: card.href,
            blurb: Array.isArray(card.blurb) ? card.blurb.join(" ") : card.blurb || "",
            sections: [],
          });
        }
        projMap.get(card.href).sections.push(section);
      }
    }

    const index = {
      site: (data.site && data.site.name) || "danbot lab",
      generated: new Date().toISOString(),
      pages,
      projects: [...projMap.values()],
    };
    return JSON.stringify(index);
  }
};
