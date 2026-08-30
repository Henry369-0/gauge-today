import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@gauge/shared'],
  webpack(config, { isServer }) {
    if (isServer) {
      // @gauge/shared 的 db.ts 用 Node 24 内置 node:sqlite；
      // Next 的内置 external 清单尚未收录该模块，这里显式放行
      config.externals.push({ 'node:sqlite': 'commonjs node:sqlite' });
    }
    return config;
  },
};

export default nextConfig;
