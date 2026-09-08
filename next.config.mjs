/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { isServer }) {
    // Server routes share the worker's TypeScript modules. Their ESM `.js`
    // specifiers are resolved by tsx in the worker and need the same source
    // fallback when Next bundles those modules. Existing JavaScript wins.
    if (isServer) {
      config.resolve.extensionAlias = {
        ...config.resolve.extensionAlias,
        ".js": [".js", ".ts", ".tsx"],
      };
    }
    return config;
  },
  typescript: {
    // Keep Vercel's web build scoped to deployable application code. The
    // repository-wide CI typechecks root + worker separately and installs the
    // worker dependency tree before doing so.
    tsconfigPath: "./tsconfig.next.json",
  },
};

export default nextConfig;
