import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "เช็คของขวัญ",
    short_name: "เช็คของขวัญ",
    description: "เช็คว่าใครส่งของขวัญแล้วหรือยัง",
    start_url: "/",
    display: "standalone",
    background_color: "#F3F5F8",
    theme_color: "#F3F5F8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
