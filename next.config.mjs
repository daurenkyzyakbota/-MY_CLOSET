import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const localDevOrigins = [
  ...new Set([
    'localhost',
    '127.0.0.1',
    ...Object.values(networkInterfaces()).flatMap((adapters) =>
      (adapters || [])
        .filter(
          (adapter) =>
            adapter.family === 'IPv4' &&
            !adapter.internal &&
            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(adapter.address),
        )
        .map((adapter) => adapter.address),
    ),
  ]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  allowedDevOrigins: localDevOrigins,
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
};

export default nextConfig;
