// Two build flavours from one codebase:
//   default                         -> `output: standalone` (docker compose, talks to the real API)
//   NEXT_PUBLIC_DEMO_MODE=static    -> `output: export` (GitHub Pages, in-browser simulator)
const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "static";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
export default {
  output: demo ? "export" : "standalone",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  trailingSlash: demo,
  images: { unoptimized: true },
  reactStrictMode: true,
};
