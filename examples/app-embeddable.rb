require 'opal_irb_jqconsole'

Document.ready? do
  OpalIrbJqconsole.create_bottom_panel
  OpalIrbJqconsole.add_open_panel_behavior("show-irb")
end
