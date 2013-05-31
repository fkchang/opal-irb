require 'bundler/setup'
require 'opal/rake_task'

Opal::RakeTask.new do |t|
  t.name = 'opal_irb.rb'
  t.parser = true

  t.files = '.'
  # t.dependencies = ['opal-jquery']
end

desc "Copy build js files to js - for development"
task :copy_js do
  Dir["build/*.js"].each {|js_file|
    cp js_file, "js"
  }

end

task :default => [:opal, :copy_js]
