import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // build autocontido (node server.js) para rodar em Docker na VPS
  output: 'standalone',
  experimental: {
    // Checklists enviam apenas metadados (as fotos vão direto ao Storage),
    // então o limite padrão de 1MB das Server Actions é suficiente.
    serverActions: { bodySizeLimit: '1mb' },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Câmera liberada para o próprio site (necessária para o checklist).
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
