import { useEffect, useState } from 'react';
import { formatCode } from '../../lib/meetings';

/**
 * The check-in QR.
 *
 * NOT HAND-ROLLED, and generated on the CLIENT rather than on a server.
 *
 * The brief asked for an existing dependency rather than a hand-written encoder, which is
 * right — QR error correction is a specification, not an afternoon. `qrcode` is that
 * dependency. Generating client-side rather than server-side is the offline-first answer: a
 * coach opening the event on a laptop in a school hall with no signal still gets a QR to put
 * on the projector, where a server-rendered PNG would be a broken image. The whole module is
 * lazily imported so it lands in the meetings chunk rather than the entry bundle, and the
 * service worker precaches it like everything else.
 *
 * WHAT THE CODE ENCODES, AND WHY THERE IS NO IN-APP SCANNER
 *
 * A URL into the app: `…/#/app/checkin/0842`. So a student points their PHONE'S OWN CAMERA at
 * the poster — every phone has one, it needs no permission inside the PWA, and it works from
 * the lock screen. Scanning while signed out lands on the login page and resumes afterwards,
 * which is rule 4 of the brief.
 *
 * An in-app scanner would mean either `BarcodeDetector` (absent on iOS Safari, which is most
 * of an FTC team's phones) or a WebAssembly decoder in the precache. The typed code is the
 * fallback for a device with no camera, and it is the same four digits.
 */
export interface QrCodeProps {
    /** The four-digit occurrence code. */
    code: string;
    /** Rendered pixel size of the square. */
    size?: number;
    /** Black on white — for the printable poster, which must not carry a dark theme. */
    monochrome?: boolean;
    className?: string;
}

/** The URL a scan opens. Exported so the poster and the "copy link" action agree with it. */
export function checkinUrl(code: string): string {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}#/app/checkin/${code}`;
}

export default function QrCode({ code, size = 240, monochrome = false, className = '' }: QrCodeProps) {
    const [dataUrl, setDataUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setDataUrl(null);
        setFailed(false);

        if (!code) return;

        import('qrcode')
            .then((qrcode) =>
                qrcode.toDataURL(checkinUrl(code), {
                    width: size * 2, // 2x so it stays sharp on a retina screen and in print
                    margin: 1,
                    errorCorrectionLevel: 'M',
                    color: monochrome
                        ? { dark: '#000000', light: '#ffffff' }
                        : { dark: '#0f172a', light: '#ffffff' },
                }),
            )
            .then((url) => {
                if (!cancelled) setDataUrl(url);
            })
            .catch((error) => {
                console.warn('[meetings] QR generation failed', error);
                if (!cancelled) setFailed(true);
            });

        return () => {
            cancelled = true;
        };
    }, [code, size, monochrome]);

    if (!code) return null;

    if (failed) {
        // The typed code is not a lesser fallback — it is the same credential. Say so rather
        // than showing a broken square.
        return (
            <div
                className="flex items-center justify-center rounded-xl bg-white p-4 text-center"
                style={{ width: size, height: size }}
            >
                <p className="text-sm font-medium text-slate-700">
                    Could not draw the QR. Members can still enter {formatCode(code)} by hand.
                </p>
            </div>
        );
    }

    return (
        <div
            className={`bg-white rounded-xl flex items-center justify-center ${className}`}
            style={{ width: size, height: size }}
        >
            {dataUrl ? (
                <img
                    src={dataUrl}
                    alt={`QR code for check-in code ${formatCode(code)}`}
                    width={size}
                    height={size}
                    className="w-full h-full"
                />
            ) : (
                <div
                    className="w-6 h-6 border-2 border-slate-300 border-t-transparent rounded-full animate-spin"
                    role="status"
                    aria-label="Generating QR code"
                />
            )}
        </div>
    );
}
