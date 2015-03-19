require 'opal_irb_jqconsole'
require 'browser'               # include opal browser so we have access to it
require 'browser/dom'

Document.ready? do
  OpalIrbJqconsole.create_bottom_panel
  OpalIrbJqconsole.add_open_panel_behavior("show-irb")
end
