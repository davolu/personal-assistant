import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal Assistant",
    short_name: "Assistant",
    description: "Chat with an assistant that works across your apps.",
    start_url: "/agentic-chat",
    display: "standalone",
    background_color: "#fdfdfb",
    theme_color: "#f4490c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
