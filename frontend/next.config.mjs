/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: {
    qualities: [75, 100],
  },
};

export default nextConfig;
