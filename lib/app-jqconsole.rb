require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'opal_irb'
require 'opal_jqconsole'

Document.ready? do
  OpalJqconsole.create("#console")
end
