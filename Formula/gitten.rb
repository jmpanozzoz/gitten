class Gitten < Formula
  desc "Git facilitator CLI — covers the 20% of Git operations that solve 80% of daily friction"
  homepage "https://github.com/jmpanozzoz/gitten"
  version "0.6.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-arm64"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

      def install
        bin.install "gitten-darwin-arm64" => "gitten"
      end
    end

    on_intel do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-x64"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

      def install
        bin.install "gitten-darwin-x64" => "gitten"
      end
    end
  end

  test do
    assert_match "gitten v#{version}", shell_output("#{bin}/gitten --version")
  end
end
