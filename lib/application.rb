require 'opal'
require 'opal-jquery'
require 'opal-parser'
require 'opal_irb'
Document.ready? do
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
