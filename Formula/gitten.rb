class Gitten < Formula
  desc "Git facilitator CLI — covers the 20% of Git operations that solve 80% of daily friction"
  homepage "https://github.com/jmpanozzoz/gitten"
  version "1.1.2"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-arm64"
      sha256 "4a8127517fc9bacc1ba03095ee8c45278f68559e10a1de1698237cf5fcda5f7d"

      def install
        bin.install "gitten-darwin-arm64" => "gitten"
      end
    end

    on_intel do
      url "https://github.com/jmpanozzoz/gitten/releases/download/v#{version}/gitten-darwin-x64"
      sha256 "29a70cfb9ff96352a3cbffda720293bf057742eb4ea15ba1dfa9f20e42f41d0b"

      def install
        bin.install "gitten-darwin-x64" => "gitten"
      end
    end
  end

  test do
    assert_match "gitten v#{version}", shell_output("#{bin}/gitten --version")
  end
end
