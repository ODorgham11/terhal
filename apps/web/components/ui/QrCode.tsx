"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/cn";
import { Skeleton } from "./Skeleton";

type QrCodeProps = {
  // What the code encodes, e.g. TotpSetup.uri (otpauth://...) for an admin's authenticator app.
  value: string;
  // Describes the code for screen readers, e.g. "Scan with your authenticator app".
  label: string;
  size?: number;
  className?: string;
};

// Drawn in the browser, so a secret like an authenticator's never goes to a third-party QR service. Always dark on
// white, even in dark mode: scanners expect it. Show the same value as text next to it for people who can't scan.
export function QrCode({ value, label, size = 192, className }: QrCodeProps) {
  const [rendered, setRendered] = useState<{ value: string; svg: string } | null>(null);

  useEffect(() => {
    let current = true;
    void QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(
      (svg) => {
        if (current) setRendered({ value, svg });
      },
    );
    return () => {
      current = false;
    };
  }, [value]);

  if (rendered?.value !== value) {
    return (
      <Skeleton className={cn("rounded-lg", className)} style={{ width: size, height: size }} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a generated data URL; next/image has nothing to optimize.
    <img
      src={`data:image/svg+xml;utf8,${encodeURIComponent(rendered.svg)}`}
      alt={label}
      width={size}
      height={size}
      className={cn("rounded-lg bg-white p-2", className)}
    />
  );
}
