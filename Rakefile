require 'bundler/setup'
# require 'opal/rake_task'
require 'opal'
require 'opal-sprockets'

require 'opal-jquery'
require 'opal-irb'

require 'opal/spec/rake_task'
Opal::Spec::RakeTask.new(:default)

desc "build irb with homebrew console"
task :build_homebrew_console do
  File.open("js/application.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "examples"
    env.append_path "opal"
    out << env["application"].to_s
  end
  system "open -a 'Google Chrome' index.html"
end

desc "build jqconsole based irb"
task :build_jqconsole do

  File.open("js/app-jqconsole.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "examples"
    env.append_path "opal"
    out << env["app-jqconsole"].to_s
  end
  # system "terminal-notifier -title 'opal-irb build' -message 'js file built'"
  system "open -a 'Google Chrome' index-jq.html"
end

task :build_all => [:build_homebrew_console, :build_jqconsole]
#task :default => :build_jqconsole
