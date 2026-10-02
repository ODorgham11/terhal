import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners of home screen icons itself, so this fills the whole square. Same T as app/icon.svg, scaled up.
export default function AppleIcon() {
    const unit = size.width / 32;

    return new ImageResponse(
        (
            <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#171717" }}>
                <div style={{ position: "absolute", left: 9 * unit, top: 8.5 * unit, width: 14 * unit, height: 3.5 * unit, background: "#ffffff", borderRadius: 0.5 * unit }} />
                <div style={{ position: "absolute", left: 14.25 * unit, top: 8.5 * unit, width: 3.5 * unit, height: 15 * unit, background: "#ffffff", borderRadius: 0.5 * unit }} />
            </div>
        ),
        size,
    );
}
