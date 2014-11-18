# require 'bundler/setup'
require 'bundler'
Bundler.require

require 'opal'
require 'opal-rspec'
require 'opal/sprockets/environment'

require 'opal/rspec/rake_task'
Opal::RSpec::RakeTask.new(:default)

desc "build irb with homebrew console"
task :build_homebrew_console do
  File.open("compiled/application.js", "w+") do |out|
    Opal::Processor.source_map_enabled = false
    env = Opal::Environment.new
    env.append_path "examples"
    env.append_path "opal"
    out << env["application"].to_s
  end
  system "open -a 'Google Chrome' index-homebrew.html"
end

desc "build jqconsole based irb"
task :build_jqconsole do

  File.open("compiled/app-jqconsole.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "examples"
    env.append_path "opal"
    out << env["app-jqconsole"].to_s
  end
  # system "terminal-notifier -title 'opal-irb build' -message 'js file built'"
  system "open -a 'Google Chrome' index-jq.html"
end

desc "build embeddable irb"
task :build_embeddable do

  File.open("compiled/app-embeddable.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "examples"
    env.append_path "opal"
    out << env["app-embeddable"].to_s
  end
  # system "terminal-notifier -title 'opal-irb build' -message 'js file built'"
  system "open -a 'Google Chrome' index-embeddable.html"
end

desc "build PhantomJS based repl"

task :build_phantomjs do
  File.open("compiled/opal-phantom.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "opal"
    out << env["opal_phantomjs"].to_s
  end
end


desc "build all the example apps and view them"
task :build_all => [:build_homebrew_console, :build_jqconsole, :build_embeddable]
task :build => :build_embeddable
#task :default => :build_jqconsole
