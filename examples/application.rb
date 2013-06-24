require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'opal_irb_homebrew_console'

Document.ready? do
  OpalIRBHomebrewConsole.create("#container")
end
