import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone은 Docker 이미지용. Windows에서는 symlink 권한 문제로 실패하므로 Dockerfile에서만 켠다.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  // 모노레포 루트 기준으로 의존성을 추적해야 standalone 결과물에 packages/shared가 포함된다.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@agentorg/shared"],
  experimental: {
    // Tailscale serve(HTTPS 프록시) 주소에서 온 폼 제출을 허용한다. (dev :10000, 운영 :8443)
    serverActions: { allowedOrigins: ["**.ts.net", "**.ts.net:10000", "**.ts.net:8443"] },
  },
};

export default nextConfig;
