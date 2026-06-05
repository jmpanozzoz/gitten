class Gitten < Formula
  desc "Git facilitator CLI — covers the 20% of Git operations that solve 80% of daily friction"
  homepage "https://github.com/jmpanozzoz/gitten"
  version "1.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-arm64"
      sha256 "8e93ad38b010f5764a8dbf6dd842733735144615bccb22afb171de65913dc88f"

      def install
        bin.install "gitten-darwin-arm64" => "gitten"
      end
    end

    on_intel do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-x64"
      sha256 "13e99464a39f76ce44306779e9255aca2d71c89f2d43febd22e7a3b9c19a2109"

      def install
        bin.install "gitten-darwin-x64" => "gitten"
      end
    end
  end

  test do
    assert_match "gitten v#{version}", shell_output("#{bin}/gitten --version")
  end
end
