require 'opal-parser'

class OpalJqconsole
  def self.create(parent_element_id)
    @console = OpalJqconsole.new(parent_element_id)
  end

  def initialize(parent_element_id)
    @parser = Opal::Parser.new
    setup_cmd_line_methods
    setup_jqconsole(parent_element_id)
    handler()
  end

  attr_reader :jqconsole
  def setup_jqconsole(parent_element_id)
    @jqconsole = Element.find(parent_element_id).jqconsole("Welcome to Opal #{Opal::VERSION}\n", 'opal> ');
    @jqconsole.RegisterShortcut('Z', lambda { @jqconsole.AbortPrompt(); handler})
    @jqconsole.RegisterShortcut('A', lambda{ @jqconsole.MoveToStart(); handler})
    @jqconsole.RegisterShortcut('E', lambda{ @jqconsole.MoveToEnd(); handler})
    @jqconsole.RegisterShortcut('B', lambda{ @jqconsole._MoveLeft(); handler})
    @jqconsole.RegisterShortcut('F', lambda{ @jqconsole._MoveRight(); handler})
    @jqconsole.RegisterShortcut('N', lambda{ @jqconsole._HistoryNext(); handler})
    @jqconsole.RegisterShortcut('P', lambda{ @jqconsole._HistoryPrevious(); handler})
    @jqconsole.RegisterShortcut('D', lambda{ @jqconsole._Delete(); handler})
    @jqconsole.RegisterShortcut('K', lambda{ @jqconsole.Kill; handler})
  end

  CMD_LINE_METHOD_DEFINITIONS = [
                                 'def help
                                   OpalJqconsole.help
                                   nil
                                 end',
                                 'def history
                                   OpalJqconsole.history
                                   nil
                                 end',



                                 ]
  def setup_cmd_line_methods
    CMD_LINE_METHOD_DEFINITIONS.each {|method_definition|
      compiled = @parser.parse method_definition
      `eval(compiled)`
    }
  end

  def self.history
    history = @console.jqconsole.GetHistory
    lines = []
    history.each_with_index {|history_line, i|
      lines << "#{i+1}: #{history_line}"
    }
    @console.jqconsole.Write("#{lines.join("\n")}\n")

  end


  def handler(cmd)
    if cmd
      begin
        @jqconsole.Write( " => #{process(cmd).inspect} \n")
      rescue Exception => e
        @jqconsole.Write('Error: ' + e.message + "\n")
      end
    end
    @jqconsole.Prompt(true, lambda {|c| handler(c) })

  end
  def write *stuff
    @jqconsole.Write *stuff
  end

  def self.write *stuff
    @console.write *stuff

  end

  def self.help
    help = <<HELP
help: this text
history: shows history
Up/Down Arrow and ctrl-p/ctrl-n: flips through history

HELP
    write help, "", false
  end

  def process(cmd)
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
