require 'bundler/setup'
# require 'opal/rake_task'
require 'opal'
require 'opal-sprockets'

require 'opal-jquery'

task :build do
=begin
  File.open("js/application.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "lib"
    out << env["application"].to_s
  end
=end

  File.open("js/app-jqconsole.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "lib"
    out << env["app-jqconsole"].to_s
  end
  # system "terminal-notifier -title 'opal-irb build' -message 'js file built'"
  system "open -a 'Google Chrome' index-jq.html"
end

task :default => :build
