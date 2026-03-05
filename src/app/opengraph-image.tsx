import { ImageResponse } from "next/og";

import { SITE_DESCRIPTION, SITE_NAME, SITE_SHORT_NAME } from "@/lib/seo/site";

export const runtime = "edge";
export const contentType = "image/png";
export const size = {
  width: 1200,
  height: 630,
};
export const alt = SITE_NAME;

const BRAND_ACCENT = "#6f8f6b";
const BRAND_BACKGROUND = "#0b1220";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: `linear-gradient(120deg, ${BRAND_BACKGROUND} 0%, #1f2937 100%)`,
          color: "#f8fafc",
          padding: "64px",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-120px",
            right: "-80px",
            width: "420px",
            height: "420px",
            borderRadius: "9999px",
            background: "rgba(111, 143, 107, 0.24)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "9999px",
                background: BRAND_ACCENT,
              }}
            />
            <div style={{ fontSize: "28px", fontWeight: 600 }}>{SITE_SHORT_NAME}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "920px", gap: "16px" }}>
            <div style={{ fontSize: "72px", fontWeight: 700, lineHeight: 1.05 }}>{SITE_NAME}</div>
            <div style={{ fontSize: "34px", lineHeight: 1.25, color: "#e2e8f0" }}>{SITE_DESCRIPTION}</div>
          </div>
          <div style={{ fontSize: "28px", color: "#94a3b8" }}>
            Discover components, preview instantly, download Liquid files.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
