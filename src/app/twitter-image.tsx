import { ImageResponse } from "next/og";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/site";

export const runtime = "edge";
export const contentType = "image/png";
export const size = {
  width: 1200,
  height: 600,
};
export const alt = SITE_NAME;

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "linear-gradient(120deg, #0b1220 0%, #1e293b 100%)",
          color: "#f8fafc",
          padding: "64px",
          gap: "18px",
        }}
      >
        <div style={{ fontSize: "56px", fontWeight: 700, lineHeight: 1.08 }}>{SITE_NAME}</div>
        <div style={{ fontSize: "30px", lineHeight: 1.25, color: "#d1d5db", maxWidth: "980px" }}>
          {SITE_DESCRIPTION}
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
