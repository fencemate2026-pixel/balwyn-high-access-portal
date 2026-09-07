import type { NextConfig } from "next";

const isNetlifyStaticExport = process.env.NETLIFY_STATIC === "true";

const nextConfig: NextConfig = {
  output: isNetlifyStaticExport ? "export" : undefined,
  typescript: {
    tsconfigPath: process.env.NETLIFY ? "./tsconfig.netlify.json" : "./tsconfig.json",
  },
};

export default nextConfig;
