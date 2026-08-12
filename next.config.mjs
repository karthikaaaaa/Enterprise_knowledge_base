/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // pdf-parse (via pdfjs-dist) and the local embeddings model load worker/runtime
  // files by path at runtime — bundling them breaks those lookups.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', '@huggingface/transformers'],
}

export default nextConfig
