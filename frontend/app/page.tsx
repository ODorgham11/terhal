import type { Metadata } from "next";
import { openGraph } from "@/lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  openGraph: {
    ...openGraph,
    url: "/",
  },
};

export default function Home() {
  return (
    <div>

    </div>
  );
}
