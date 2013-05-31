require 'bundler/setup'
# require 'opal/rake_task'
require 'opal'
require 'opal-jquery'

task :build do
  File.open("js/application.js", "w+") do |out|
    env = Opal::Environment.new
    env.append_path "lib"
    out << env["application"].to_s
  end
end

desc "Copy build js files to js - for development"
task :copy_js do
  Dir["build/*.js"].each {|js_file|
    cp js_file, "js"
  }

end

task :default => :build
