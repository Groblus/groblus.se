const { EleventyRenderPlugin } = require("@11ty/eleventy");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyRenderPlugin);
  eleventyConfig.addPassthroughCopy("downloads");
  eleventyConfig.addPassthroughCopy("_headers");
  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPassthroughCopy("spelhyllan");
  eleventyConfig.ignores.add("spelhyllan/**");
  eleventyConfig.ignores.add("worker/**");
  eleventyConfig.ignores.add(".superdesign/**");
  eleventyConfig.ignores.add("docs/**");
  eleventyConfig.ignores.add("scripts/**");
  eleventyConfig.ignores.add("README.md");
};
