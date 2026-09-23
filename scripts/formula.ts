// Prints the Homebrew formula for a release: bun scripts/formula.ts <version> <SHA256SUMS>
import { readFileSync } from "node:fs";

const [version, sumsFile] = process.argv.slice(2);
if (!version || !sumsFile) { console.error("usage: bun scripts/formula.ts <version> <SHA256SUMS>"); process.exit(2); }
const sums = Object.fromEntries(readFileSync(sumsFile, "utf8").trim().split("\n").map(l => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
const asset = (t: string) => {
  const file = `modelgen-${version}-${t}.tar.gz`;
  if (!sums[file]) throw new Error(`no checksum for ${file}`);
  return `      url "https://github.com/Guilospanck/modelgen/releases/download/v${version}/${file}"\n      sha256 "${sums[file]}"`;
};

console.log(`class Modelgen < Formula
  desc "Generate 3D models (GLB, USDZ) from a CLI or an MCP server"
  homepage "https://github.com/Guilospanck/modelgen"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
${asset("darwin-arm64")}
    end
    on_intel do
${asset("darwin-x64")}
    end
  end

  on_linux do
    on_arm do
${asset("linux-arm64")}
    end
    on_intel do
${asset("linux-x64")}
    end
  end

  def install
    bin.install "modelgen"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/modelgen --version")
  end
end`);
