import { notFound } from "next/navigation";

// Any dashboard address that isn't a page: a real 404, shown by not-found.tsx inside the dashboard's frame.
export default function Missing() {
  notFound();
}
