require 'opal-parser'

class OpalJqconsole
  def self.console
    @console
  end

  def self.create(parent_element_id)
    @console = OpalJqconsole.new(parent_element_id)
  end

  def initialize(parent_element_id)
    @parser = Opal::Parser.new
    setup_cmd_line_methods
    setup_jqconsole(parent_element_id)
    create_multiline_editor
    handler()
  end

  def create_multiline_editor
    editor = <<EDITOR
    <div id="multiline-editor-dialog" class="dialog" style="display:none" >
      <textarea name="multi_line_input" id="multi_line_input"></textarea>
    </div>
EDITOR
    Element.find("body") << editor
         %x|
    $( ".dialog" ).dialog({
                            autoOpen: false,
                            show: "blind",
                            hide: "explode",
                            modal: true,
                            width: "500px",
                            title: "Multi Line Edit",
                            buttons: {
                              "Run it":  function() {
                                $( this ).dialog( "close" );
                                #{self}.$process_multiline();
                              },
                              "Cancel":  function() {
                                $( this ).dialog( "close" );
                           },
                        }
          });
      |

    @open_editor_dialog_function = %x|function() {
          $( ".dialog" ).dialog( "open" );
          setTimeout(function(){editor.refresh();}, 20);
      }
      |
    @editor = %x|
      editor = CodeMirror.fromTextArea(document.getElementById("multi_line_input"),
              {mode: "ruby",
                  lineNumbers: true,
                  matchBrackets: true,
                  keyMap: "emacs",
                  theme: "default"
              });

   |


  end
  def open_multiline_dialog
    @editor.setValue(@jqconsole.GetPromptText)
    @open_editor_dialog_function.call
  end

  def process_multiline
    multi_line_value = @editor.getValue.sub(/(\n)+$/, "")
    @jqconsole.SetPromptText multi_line_value
    @jqconsole._HandleEnter
  end


  attr_reader :jqconsole
  def setup_jqconsole(parent_element_id)
    @jqconsole = Element.find(parent_element_id).jqconsole("Welcome to Opal #{Opal::VERSION}\ntype help for assistance\n", 'opal> ');
    @jqconsole.RegisterShortcut('M', lambda { open_multiline_dialog; handler})
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
    if cmd && `#{cmd } != undefined`
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

  def unescaped_write str
    `#{@jqconsole}.Write(str, "unescaped", false)`
  end

  def self.write *stuff
    @console.write *stuff

  end
  def self.unescaped_write *stuff
    @console.unescaped_write *stuff

  end

  def self.help
    help = <<HELP
<b><i>help</i></b>:                            this text
<b>history</b>:                         shows history
<b>ctrl-m</b>:                          multi-line edit mode
<b>Up/Down Arrow and ctrl-p/ctrl-n</b>: flips through history
HELP
    unescaped_write help
  end

  def process(cmd)
    begin
      puts "\n\n|#{cmd}|"
      if cmd
        compiled = @parser.parse cmd, :irb => true
        puts compiled
        value = `eval(compiled)`
        $_ = value
      end
    rescue Exception => e
      alert e.backtrace.join("\n")
      puts "\n\n"
      puts `e.toString()`
      puts e.backtrace
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
