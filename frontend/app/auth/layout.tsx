import type { Metadata } from "next";
import Image from "next/image";
import hero from "@/assets/auth.jpg";
import Logo from "@/components/ui/logo";

// Sign in, sign up and verify aren't useful search results, so keep them out of search engines.
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
    },
};

// Shared by every auth page: the form on the left, and the image on the right from lg up.
export default function AuthLayout({ children }: LayoutProps<"/auth">) {
    return (
        <main className="grid min-h-screen w-full grid-cols-1 lg:h-screen lg:grid-cols-2">
            <div className="flex flex-col p-6 sm:p-10">
                <Logo />
                <div className="flex flex-1 items-center justify-center py-12">
                    <div className="w-full max-w-md">{children}</div>
                </div>
            </div>
            <div className="hidden p-3 lg:block">
                <div className="relative h-full overflow-hidden rounded-2xl">
                    <Image
                        src={hero}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 50vw, 0px"
                        placeholder="blur"
                        loading="eager"
                        fetchPriority="high"
                        className="object-cover"
                    />
                    {/* Darkens the top of the image so the text on it stays readable. */}
                    <div className="absolute inset-0 bg-linear-to-b from-black/60 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 top-0 px-12 pt-24 text-center text-white">
                        <h2 className="text-3xl font-semibold tracking-tight text-balance">Your journey across Egypt starts here</h2>
                        <p className="mx-auto mt-3 max-w-md text-base text-white/85 text-balance">
                            Rent a car, book an airport transfer, or ride with a private driver, all in one place.
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
