class Gitten < Formula
  desc "Git facilitator CLI — covers the 20% of Git operations that solve 80% of daily friction"
  homepage "https://github.com/jmpanozzoz/gitten"
  version "1.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-arm64"
      sha256 "bce1f061698acd3e4d751f3bd44b4e36a44207231a973455bf70204dc2d0c90b"

      def install
        bin.install "gitten-darwin-arm64" => "gitten"
      end
    end

    on_intel do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-x64"
      sha256 "7ed86f108c0775caa06cb9a5b547364db85385f9227b02c77a9ced00a4557713"

      def install
        bin.install "gitten-darwin-x64" => "gitten"
      end
    end
  end

  test do
    assert_match "gitten v#{version}", shell_output("#{bin}/gitten --version")
  end
end
