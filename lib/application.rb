require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'opal_irb'
Document.ready? do
  OpalIRB.create("#container")
end
