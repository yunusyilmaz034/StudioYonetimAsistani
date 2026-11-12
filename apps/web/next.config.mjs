/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // A scale printout arrives as base64 through a Server Action, and base64 costs a third on top of
    // the file. The default 1 MB ceiling clips an ordinary 800 KB PDF; 8 MB covers a scanned one with
    // room to spare, and the action refuses anything larger before it is read.
    serverActions: { bodySizeLimit: '8mb' },
  },
  // The scale-printout reader (pdf.js inside) is loaded by Node as-is, not re-bundled by webpack —
  // its build reads `import.meta` in a way webpack cannot follow.
  serverExternalPackages: ['unpdf'],
}

export default nextConfig
