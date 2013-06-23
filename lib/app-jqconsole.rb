require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'opal_irb_jqconsole'

Document.ready? do
  OpalIrbJqconsole.create("#console")
end
