import Link from "next/link";

export default function Logo() {
    return (
        <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-900">
            <span className="grid size-6 place-items-center rounded-md bg-neutral-900 text-xs font-bold text-white" aria-hidden>T</span>
            Terhal
        </Link>
    );
}
