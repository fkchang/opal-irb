require 'bundler/gem_tasks'
require 'bundler'
Bundler.require

require 'opal'
require 'opal-rspec'
require 'opal/sprockets/environment'

require 'opal/rspec/rake_task'
Opal::RSpec::RakeTask.new(:default)

def build_static(app_basename, index_file)
  # File.open("compiled/#{app_basename}.js", "w+") do |out|
  #   Opal::Processor.source_map_enabled = false
  #   env = Opal::Environment.new
  #   env.append_path "examples"
  #   env.append_path "opal"
  #   out << env[app_basename].to_s
  # end
  Opal.append_path "examples"
  Opal.append_path "opal"
  File.binwrite "compiled/#{app_basename}.js", Opal::Builder.build("#{app_basename}").to_s +
                                      "Opal.require('#{app_basename}.js')"
  system "open -a 'Google Chrome' #{index_file}" if index_file
end

desc "build irb with homebrew console"
task :build_homebrew_console do
  build_static('application', 'index-homebrew.html')
end

desc "build jqconsole based irb"
task :build_jqconsole do
  build_static('app-jqconsole', 'index-jq.html')
end

desc "build jqconsole based irb for chrome panel"
task :build_jqconsole_chrome do
  build_static('app-jqconsole-chrome', nil)
end

desc "build embeddable irb"
task :build_embeddable do
  build_static('app-embeddable', 'index-embeddable.html')
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
desc "shortcut for build embeddable, cuz I'm lazy"
task :build_e => :build_embeddable
#task :default => :build_jqconsole
