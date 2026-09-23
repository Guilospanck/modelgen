#!/bin/sh
# Installs the modelgen binary: curl -fsSL https://raw.githubusercontent.com/Guilospanck/modelgen/main/install.sh | sh
# Env: MODELGEN_VERSION (default: latest), INSTALL_DIR (default: ~/.local/bin)
set -eu
REPO="Guilospanck/modelgen"
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "unsupported OS: $(uname -s) (Windows: download the zip from the releases page)" >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;; esac
version="${MODELGEN_VERSION:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')}"
[ -n "$version" ] || { echo "could not determine the latest version" >&2; exit 1; }
name="modelgen-$version-$os-$arch"
base="https://github.com/$REPO/releases/download/v$version"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/$name.tar.gz" -o "$tmp/$name.tar.gz"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"
(cd "$tmp" && grep " $name.tar.gz\$" SHA256SUMS | shasum -a 256 -c -) >/dev/null || { echo "checksum mismatch" >&2; exit 1; }
tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
dir="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
install -m 755 "$tmp/$name/modelgen" "$dir/modelgen"
echo "installed modelgen $version to $dir/modelgen"
case ":$PATH:" in *":$dir:"*) ;; *) echo "add $dir to your PATH" ;; esac
