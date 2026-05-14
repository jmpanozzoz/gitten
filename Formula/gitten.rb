class Gitten < Formula
  desc "Git facilitator CLI — covers the 20% of Git operations that solve 80% of daily friction"
  homepage "https://github.com/jmpanozzoz/gitten"
  version "0.2.1"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-arm64"
      sha256 "184aa4618e0c038f5f0c6145fa7a7e9d94e98cbf82ae1aaff17522e169a20167"

      def install
        bin.install "gitten-darwin-arm64" => "gitten"
      end
    end

    on_intel do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-x64"
      sha256 "6f645599e79908e76e56bc435695af235f7e4ed5d8a2bff54549bc59b681c733"

      def install
        bin.install "gitten-darwin-x64" => "gitten"
      end
    end
  end

  test do
    assert_match "gitten v#{version}", shell_output("#{bin}/gitten --version")
  end
end
