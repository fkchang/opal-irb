$LOAD_PATH << File.expand_path('../lib', __FILE__)
require File.expand_path('../lib/opal-irb/version', __FILE__)

Gem::Specification.new do |s|
  s.name         = 'opal-irb'
  s.version      = OpalIrb::VERSION
  s.author       = 'Forrest Chang'
  s.email        = 'fkc_email-ruby@yahoo.com.com'
  s.homepage     = 'https://github.com/fkchang/opal-irb'
  s.summary      = 'Irb and more for Opal'
  s.description  = 'Irb and more for Opal'

  s.files          = `git ls-files`.split("\n")
  s.require_paths  = ['lib']

  s.add_dependency 'opal', '~> 0.10.6'
  s.add_dependency 'opal-jquery', '~> 0.4.2'

  s.add_development_dependency 'rake'
end
