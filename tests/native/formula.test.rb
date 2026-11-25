require "coverage"
require "json"
require "open3"
require "rbconfig"

FORMULA_FILE = File.expand_path("../../Formula/gitten.rb", __dir__)

class Formula
  class << self
    attr_reader :download, :checksum, :smoke_test

    def desc(_description); end
    def homepage(_url); end
    def license(_license); end

    def version(value = nil)
      @version = value if value
      @version
    end

    def on_macos
      yield
    end

    def on_arm
      yield if ARGV[0] == "arm64"
    end

    def on_intel
      yield if ARGV[0] == "x64"
    end

    def url(value)
      @download = value
    end

    def sha256(value)
      @checksum = value
    end

    def test(&block)
      @smoke_test = block
    end
  end

  attr_accessor :command_output
  attr_reader :installed

  def bin
    self
  end

  def install(mapping = nil)
    @installed = mapping
  end

  def to_s
    "/fixture/bin"
  end

  def version
    self.class.version
  end

  def shell_output(command)
    raise "Unexpected formula command: #{command}" unless command == "/fixture/bin/gitten --version"
    @command_output
  end

  def assert_equal(expected, actual)
    raise "Formula version check failed" unless actual == expected
  end
end

def exercise_formula(arch)
  Coverage.start(lines: true)
  load FORMULA_FILE
  asset = "gitten-darwin-#{arch}"
  expected_url = "https://github.com/jmpanozzoz/gitten/releases/download/v#{Gitten.version}/#{asset}"
  raise "Unexpected asset URL" unless Gitten.download == expected_url
  raise "Missing SHA-256" unless Gitten.checksum.match?(/\A[0-9a-f]{64}\z/)

  formula = Gitten.new
  # A separate receiver represents Homebrew's bin path.
  receiver = Formula.new
  formula.define_singleton_method(:bin) { receiver }
  formula.install
  raise "Formula selected the wrong binary" unless receiver.installed == { asset => "gitten" }

  formula.command_output = "gitten v#{Gitten.version}\n"
  formula.instance_exec(&Gitten.smoke_test)
  formula.command_output = "gitten v#{Gitten.version}.0\n"
  begin
    formula.instance_exec(&Gitten.smoke_test)
  rescue RuntimeError => error
    raise unless error.message == "Formula version check failed"
  else
    raise "Formula accepted an invalid version"
  end

  puts JSON.generate(Coverage.result.fetch(FORMULA_FILE).fetch(:lines))
end

if ARGV[0]
  exercise_formula(ARGV[0])
else
  measured = %w[arm64 x64].map do |arch|
    stdout, stderr, result = Open3.capture3(RbConfig.ruby, __FILE__, arch)
    raise stderr unless result.success?

    JSON.parse(stdout)
  end
  counters = measured.transpose.map { |hits| hits.compact }
  executable = counters.count { |hits| !hits.empty? }
  covered = counters.count { |hits| hits.any? { |count| count.positive? } }
  puts "Homebrew formula executable lines: #{covered}/#{executable}"
  raise "Every executable formula line must run" unless executable.positive? && covered == executable
end
