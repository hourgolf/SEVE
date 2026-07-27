/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Keep Vercel's web build scoped to deployable application code. The
    // repository-wide CI typechecks root + worker separately and installs the
    // worker dependency tree before doing so.
    tsconfigPath: "./tsconfig.next.json",
  },
};

export default nextConfig;
