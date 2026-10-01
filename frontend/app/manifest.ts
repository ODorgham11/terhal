import type { MetadataRoute } from "next";

// Used when the site is installed to a home screen or opened as an app.
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Terhal | Car Rental & Transportation in Egypt",
        short_name: "Terhal",
        description: "Car rental, airport transfers, and private transportation across Egypt.",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
            { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
            { src: "/apple-icon", type: "image/png", sizes: "180x180" },
        ],
    };
}
