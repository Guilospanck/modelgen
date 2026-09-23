// Cross-compiles standalone modelgen binaries (no Node or Bun needed to run them).
import { $ } from "bun";

const TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"];
const only = process.argv.slice(2);

// No top-level await: the package compiles as CommonJS and tsconfig type-checks scripts/.
async function main() {
  const { version } = await Bun.file("package.json").json();

  await $`rm -rf dist/bin dist/release && mkdir -p dist/bin dist/release`;
  for (const target of TARGETS.filter(t => !only.length || only.includes(t))) {
    const name = `modelgen-${version}-${target}`;
    const exe = target.startsWith("windows") ? "modelgen.exe" : "modelgen";
    await $`bun build src/cli/bin.ts --compile --minify --target=bun-${target} --outfile dist/bin/${name}/${exe}`;
    await $`cp README.md LICENSE dist/bin/${name}/`;
    if (target.startsWith("windows")) await $`zip -qr ../release/${name}.zip ${name}`.cwd("dist/bin");
    else await $`tar -czf ../release/${name}.tar.gz ${name}`.cwd("dist/bin");
    console.log("built", name);
  }
  await $`bun run src/cli/bin.ts schema > dist/release/modelgen-${version}.schema.json`;
  await $`shasum -a 256 * > SHA256SUMS`.cwd("dist/release");
}

main().catch(err => { console.error(err); process.exit(1); });
