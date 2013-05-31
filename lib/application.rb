require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'opal_irb'
Document.ready? do
  SAVED_CONSOLE_LOG = `console.log`

  $output    = Element.find('#output')
  $input     = Element.find('#input')
  $prompt    = Element.find('#prompt')
  $inputdiv  = Element.find('#inputdiv')
  $inputl    = Element.find('#inputl')
  $inputr    = Element.find('#inputr')
  $inputcopy = Element.find('#inputcopy')
  # make this global so you can type help, these all return nil else last thing evaluated is returned - js function
  def help
    $irb.help
    `null`
  end

  def clear
    $irb.clear
    `null`
  end

  def history
    $irb.history
    `null`
  end

  OpalIRB.init()
end
