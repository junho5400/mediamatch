/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/.git/**',
          '**/.playwright-mcp/**',
          '**/portfolio/**',
        ],
      }
    }
    return config
  },
  images: {
    // Bypass the Next.js image optimizer in dev — it backs up and 504s
    // when many TMDB posters are in flight at once. In production builds
    // the optimizer is fast and stays enabled.
    unoptimized: process.env.NODE_ENV !== "production",
    remotePatterns: [
      { protocol: 'https', hostname: 'image.tmdb.org' },
      { protocol: 'https', hostname: 'books.google.com' },
      { protocol: 'http', hostname: 'books.google.com' },
      { protocol: 'https', hostname: 'covers.openlibrary.org' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.firebasestorage.app' },
    ],
  },
}

export default nextConfig
