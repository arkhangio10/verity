/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source; Next transpiles them directly.
  transpilePackages: [
    '@covenant/core',
    '@covenant/providers',
    '@covenant/agent',
    '@covenant/adapters',
    '@covenant/sample-data',
  ],
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
};

export default nextConfig;
