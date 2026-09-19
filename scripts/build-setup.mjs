import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("cloudfunctions/developmentSetup", { recursive: true });
await build({
  entryPoints: ["server/development-setup.ts"],
  outfile: "cloudfunctions/developmentSetup/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["wx-server-sdk", "@cloudbase/node-sdk", "@cloudbase/manager-node"],
});
await writeFile(
  "cloudfunctions/developmentSetup/package.json",
  JSON.stringify(
    {
      name: "development-setup",
      version: "1.0.0",
      main: "index.js",
      dependencies: {
        "wx-server-sdk": "4.0.2",
        "@cloudbase/node-sdk": "3.18.3",
        "@cloudbase/manager-node": "5.8.6",
      },
      overrides: { "axios@<1": "0.33.0" },
    },
    null,
    2,
  ),
);
