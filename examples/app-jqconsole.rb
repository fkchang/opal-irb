require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'browser'               # include opal browser so we have access to it
require 'browser/dom'
require 'opal_irb_jqconsole'
require 'date'
require 'time'

Document.ready? do
  OpalIrbJqconsole.create("#console")
end
