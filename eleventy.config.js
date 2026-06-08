// Eleventy build for danbot lab.
//
// The site is a flat tree of hand-authored pages plus a lot of static assets
// (CSS, JS, photos, sim data, videos) living alongside the Go backend. Eleventy
// turns the .njk / .md pages into HTML using a shared layout + header partial,
// and passthrough-copies every static asset into _site/ untouched.
module.exports = function (eleventyConfig) {
  // Some assets we ship are gitignored (e.g. *.mp4 videos), so we can't let
  // Eleventy use .gitignore to decide what to include. We manage ignores
  // ourselves via .eleventyignore instead. (node_modules is always ignored.)
  eleventyConfig.setUseGitIgnore(false);

  // Every static asset extension present in the tree.
  const ASSET_EXT =
    "{jpg,jpeg,JPG,JPEG,png,PNG,gif,svg,webp,ico,mp4,webm,wgsl,txt,json,js,css}";

  // Root-level assets. Non-recursive globs only match the repo root, so the
  // backend/ and utils/ trees are never pulled in.
  eleventyConfig.addPassthroughCopy("*.css");
  eleventyConfig.addPassthroughCopy("*.js");
  eleventyConfig.addPassthroughCopy("favicon.ico");

  // Per-section assets. Scoped to the content directories so passthrough never
  // recurses into backend/, utils/, or node_modules.
  for (const dir of ["blogs", "games", "photos", "gallery", "about", "login", "styles"]) {
    eleventyConfig.addPassthroughCopy(`${dir}/**/*.${ASSET_EXT}`);
  }

  // Standalone pages that intentionally don't use the shared site layout
  // (their own complete HTML documents). Copied verbatim.
  eleventyConfig.addPassthroughCopy("gallery/index.html");
  eleventyConfig.addPassthroughCopy("blogs/webgpu/sandbox.html");
  eleventyConfig.addPassthroughCopy("googleb013b887decc3e89.html");

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
