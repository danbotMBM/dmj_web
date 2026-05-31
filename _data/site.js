// Sitewide SEO / identity config, available in every template as `site.*`.
// Used by base.njk (canonical, OG/Twitter, author, default description) and by
// sitemap.njk / robots.njk (absolute URLs). Keep `url` with no trailing slash —
// page.url already begins with "/".
module.exports = {
  url: "https://danbotlab.com",
  name: "danbot lab",
  author: "Daniel Mark Jones",
  defaultDescription:
    "danbot lab — free daily games and a maker's blog by Daniel Mark Jones. " +
    "Play daily trivia, a poker word game, and a shareable bingo board generator, " +
    "and read about self-hosting, photography, and technical experiments.",
};
