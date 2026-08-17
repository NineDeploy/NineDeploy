import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
}

export function QrCode({ value, size = 180, className = '', alt = 'QR Code' }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setDataUrl(null);
      return;
    }

    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2, // Hi-DPI
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a', // slate-900
        light: '#ffffff',
      },
    })
      .then((url) => setDataUrl(url))
      .catch(() => setDataUrl(null));
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className={`grid place-items-center rounded-xl bg-white/5 animate-pulse ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] text-slate-500 font-mono">Generating QR…</span>
      </div>
    );
  }

  return (
    <div className={`inline-flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-black/5 ${className}`}>
      <img
        src={dataUrl}
        alt={alt}
        className="block rounded-lg"
        style={{ width: size, height: size }}
      />
    </div>
  );
}
