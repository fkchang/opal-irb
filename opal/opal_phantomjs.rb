require 'opal'
require 'opal-jquery'
require 'opal_irb'
class OpalPhantomjs
  attr_reader :irb
  def initialize(_parent_element_id)
    @irb = OpalIrb.new
    puts 'yo'
    # @system = `var system = require('system')`
  end

  def exec
    loop do
      line = @system.stdin.readLine
      system.stdout.writeLine(process(line))
    end
  end

  def process(cmd)
    begin
      # log "\n\n|#{cmd}|"
      if cmd
        $irb_last_compiled = @irb.parse cmd
        log $irb_last_compiled
        value = `eval(#{$irb_last_compiled})`
        $_ = value
        $_.inspect
      end
    rescue Exception => e
      if e.backtrace
        output = "FOR:\n#{$irb_last_compiled}\n============\n" + e.backtrace.join("\n")
        # TODO: remove return when bug is fixed in rescue block
        return output
        # FF doesn't have Error.toString() as the first line of Error.stack
        # while Chrome does.
        # if output.split("\n")[0] != `e.toString()`
        #   output = "#{`e.toString()`}\n#{`e.stack`}"
        # end
      else
        output = `e.toString()`
        log "\nReturning NO have backtrace |#{output}|"
        # TODO: remove return when bug is fixed in rescue block
        return output
      end
    end
  end
end
OpalPhantomjs.new
