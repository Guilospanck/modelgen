#!/usr/bin/env bash
# Render the Homebrew formula for a given version + SHA256SUMS file to stdout.
#
# Single source of truth for the formula, used by both:
#   - `just lint`       — renders with placeholder checksums and runs `brew style`,
#                         so style problems are caught before a tag is pushed.
#   - Release workflow  — renders with the real SHA256SUMS and publishes to the tap.
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <version> <SHA256SUMS>" >&2
    exit 2
fi

version="$1"
sums="$2"

# sha256 of one release archive, from the SHA256SUMS lines "<hash>  <file>".
sha() {
    local file="modelgen-${version}-$1.tar.gz" hash
    hash="$(awk -v f="$file" '$2 == f { print $1 }' "$sums")"
    if [[ -z "$hash" ]]; then
        echo "no checksum for $file in $sums" >&2
        exit 1
    fi
    printf '%s' "$hash"
}

# Resolve every checksum up front: a failure inside the heredoc's $(...) would
# only exit that subshell, so a missing one must stop the script here.
sha_darwin_arm64="$(sha darwin-arm64)"
sha_darwin_x64="$(sha darwin-x64)"
sha_linux_arm64="$(sha linux-arm64)"
sha_linux_x64="$(sha linux-x64)"

base="https://github.com/Guilospanck/modelgen/releases/download/v${version}"

cat <<RUBY
class Modelgen < Formula
  desc "Generate 3D models (GLB, USDZ) from a CLI or an MCP server"
  homepage "https://github.com/Guilospanck/modelgen"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/modelgen-${version}-darwin-arm64.tar.gz"
      sha256 "${sha_darwin_arm64}"
    end
    on_intel do
      url "${base}/modelgen-${version}-darwin-x64.tar.gz"
      sha256 "${sha_darwin_x64}"
    end
  end

  on_linux do
    on_arm do
      url "${base}/modelgen-${version}-linux-arm64.tar.gz"
      sha256 "${sha_linux_arm64}"
    end
    on_intel do
      url "${base}/modelgen-${version}-linux-x64.tar.gz"
      sha256 "${sha_linux_x64}"
    end
  end

  def install
    bin.install "modelgen"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/modelgen --version")
  end
end
RUBY
