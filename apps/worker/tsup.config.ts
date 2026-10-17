import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/migrate.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // 공용 패키지는 TS 소스 그대로 export하므로 번들에 포함시킨다.
  noExternal: ["@agentorg/shared"],
});
