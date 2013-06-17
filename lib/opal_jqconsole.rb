require 'opal-parser'

class OpalJqconsole
  def self.create
    @parser = Opal::Parser.new
    setup_cmd_line_methods
    @jqconsole = Element.find('#console').jqconsole('Welcome Opal\n', 'opal> ');
    @jqconsole.RegisterShortcut('Z', lambda { @jqconsole.AbortPrompt(); handler})
    @jqconsole.RegisterShortcut('A', lambda{ @jqconsole.MoveToStart(); handler})
    @jqconsole.RegisterShortcut('E', lambda{ @jqconsole.MoveToEnd(); handler})
    @jqconsole.RegisterShortcut('B', lambda{ @jqconsole._MoveLeft(); handler})
    @jqconsole.RegisterShortcut('F', lambda{ @jqconsole._MoveRight(); handler})
    @jqconsole.RegisterShortcut('N', lambda{ @jqconsole._HistoryNext(); handler})
    @jqconsole.RegisterShortcut('P', lambda{ @jqconsole._HistoryPrevious(); handler})
    @jqconsole.RegisterShortcut('D', lambda{ @jqconsole._Delete(); handler})
    handler()
  end
  CMD_LINE_METHOD_DEFINITIONS = [
                                 'def help
                                   OpalJqconsole.help
                                   nil
                                 end',

                                 ]
  def self.setup_cmd_line_methods
    CMD_LINE_METHOD_DEFINITIONS.each {|method_definition|
      compiled = @parser.parse method_definition
      `eval(compiled)`
    }
  end

  def self.handler(cmd)
    if cmd
      begin
        @jqconsole.Write( " => #{process(cmd).inspect} \n")

      rescue Exception => e
        @jqconsole.Write('Error: ' + e.message + "\n")
      end
    end
    @jqconsole.Prompt(true, lambda {|c| handler(c) })

  end

  def self.help
    alert "help yourself"
  end

  def self.process(cmd)
    begin
      compiled = @parser.parse cmd, :irb => true
      puts compiled
      value = `eval(compiled)`
      $_ = value
    rescue Exception => e
      alert e
      if e.backtrace
        output = "FOR:\n#{compiled}\n============\n" + e.backtrace.join("\n")

        # FF doesn't have Error.toString() as the first line of Error.stack
        # while Chrome does.
        # if output.split("\n")[0] != `e.toString()`
        #   output = "#{`e.toString()`}\n#{`e.stack`}"
        # end
      else
        output = `e.toString()`
      end

    end
  end

end
