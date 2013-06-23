require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'opal_jqconsole'

Document.ready? do
  OpalIrbJqconsole.create("#console")
end
