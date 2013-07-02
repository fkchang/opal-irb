require 'opal_irb_log_redirector'
require 'opal_irb'

class OpalIrbJqconsole
  def self.console
    @console
  end

  def self.create(parent_element_id)
    @console = OpalIrbJqconsole.new(parent_element_id)
  end

  def initialize(parent_element_id)
    @irb = OpalIrb.new
    setup_cmd_line_methods
    setup_jqconsole(parent_element_id)
    create_multiline_editor
    redirect_console_dot_log
    handler()
  end

  def log thing
    `console.orig_log(#{thing})`
  end


  def redirect_console_dot_log
    OpalIrbLogRedirector.add_to_redirect(lambda {|args| OpalIrbJqconsole.write(args)})

  end

  def create_multiline_editor
    editor = <<EDITOR
    <div id="multiline-editor-dialog" class="dialog" style="display:none" >
      <textarea name="multi_line_input" id="multi_line_input"></textarea>
    </div>
EDITOR
    myself = self               # self is now the div and not self anymore
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
                                #{myself}.$process_multiline();
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
                  extraKeys: {
                        "Ctrl-Enter": function(cm) { $(".ui-dialog-buttonset").find("button:eq(0)").trigger("click"); } // submit on ctrl-enter
                  },
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
    @jqconsole.RegisterShortcut('C', lambda { @jqconsole.AbortPrompt(); handler})

    # These are the ubiquitous emacs commands that I have to implement now, my other
    # solution I got them all for free in OSX
    @jqconsole.RegisterShortcut('A', lambda{ @jqconsole.MoveToStart(); handler})
    @jqconsole.RegisterShortcut('E', lambda{ @jqconsole.MoveToEnd(); handler})
    @jqconsole.RegisterShortcut('B', lambda{ @jqconsole._MoveLeft(); handler})
    @jqconsole.RegisterShortcut('F', lambda{ @jqconsole._MoveRight(); handler})
    @jqconsole.RegisterShortcut('N', lambda{ @jqconsole._HistoryNext(); handler})
    @jqconsole.RegisterShortcut('P', lambda{ @jqconsole._HistoryPrevious(); handler})
    @jqconsole.RegisterShortcut('D', lambda{ @jqconsole._Delete(); handler})
    @jqconsole.RegisterShortcut('K', lambda{ @jqconsole.Kill; handler})
    @jqconsole.RegisterAltShortcut('B', lambda{ @jqconsole._MoveLeft(true); handler})
    @jqconsole.RegisterAltShortcut('F', lambda{ @jqconsole._MoveRight(true); handler})
    @jqconsole.RegisterAltShortcut('D', lambda{ @jqconsole._Delete(true); handler})

    # to implement in jq-console that you also get for free normally
    # in all Cocoa text widgets
    # alt-u upcase
    # alt-l lowercase
    # alt-c capitalize
    # ctrl-t toggle character
    # ctrl-y yanking the kill buffer - can I override the system here?

  end

  CMD_LINE_METHOD_DEFINITIONS = [
                                 'def help
                                   OpalIrbJqconsole.help
                                   nil
                                 end',
                                 'def history
                                   OpalIrbJqconsole.history
                                   nil
                                 end',
                                 # TODO Kernel.alert is now returning undefined in opal, rm when fixed
                                 'def alert stuff
                                    Kernel.alert stuff
                                    nil
                                 end',


                                 ]
  def setup_cmd_line_methods
    CMD_LINE_METHOD_DEFINITIONS.each {|method_definition|
      compiled = @irb.parse method_definition
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
        @jqconsole.Write( " => #{process(cmd)} \n")
      rescue Exception => e
        @jqconsole.Write('Error: ' + e.message + "\n")
      end
    end
    @jqconsole.Prompt(true, lambda {|c| handler(c) }, lambda {|c| check_is_incomplete(c)})

  end

  def check_is_incomplete(cmd)
    begin
      @irb.parse cmd
      false
    rescue Exception => e
      # make this a global so we can inspect this
      $check_error = e.backtrace
      # 1st attempt to return on bad code vs incomplete code
      if $check_error.first =~ /unexpected '"\\/
        # TODO when rescue is fixed to return last evaluated value remove returns
        return false
      else
        # see above todo
        return 0
      end
    end
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

  def self.puts *stuff
    @console.write *stuff
    @console.write "\n"
  end

  def self.unescaped_write *stuff
    @console.unescaped_write *stuff

  end

  def self.help
    help = <<HELP
<b>help</b>:                            This text
<b>history</b>:                         Shows history
<b>ctrl-c</b>:                          Abort prompt
<b>ctrl-m</b>:                          Pop up multi-line editor
<b>ctrl-Enter</b>:                      Submit code in multi-line editor
<hr/>
<b>EDITOR FUNCTIONALITY</b>
<b>Up/Down Arrow and ctrl-p/ctrl-n</b>: Navigate through history
<b>ctrl-a</b>:                          Beginning of line
<b>ctrl-e</b>:                          End of line
<b>ctrl-b</b>:                          Back 1 character
<b>ctrl-f</b>:                          Forward 1 character
<b>ctrl-d</b>:                          Delete 1 character
<b>ctrl-k</b>:                          Kill to the end of the line
<b>alt-b</b>:                           Back 1 word
<b>alt-f</b>:                           Forward 1 word
<b>alt-d</b>:                           Delete 1 word
HELP
    unescaped_write help
  end

  def process(cmd)
    begin
      log "\n\n|#{cmd}|"
      if cmd
        compiled = @irb.parse cmd
        log compiled
        value = `eval(compiled)`
        $_ = value
        $_.inspect
      end
    rescue Exception => e
      # alert e.backtrace.join("\n")
      if e.backtrace
        output = "FOR:\n#{compiled}\n============\n" + e.backtrace.join("\n")
        # TODO remove return when bug is fixed in rescue block
        return output
        # FF doesn't have Error.toString() as the first line of Error.stack
        # while Chrome does.
        # if output.split("\n")[0] != `e.toString()`
        #   output = "#{`e.toString()`}\n#{`e.stack`}"
        # end
      else
        output = `e.toString()`
        log "\nReturning NO have backtrace |#{output}|"
        # TODO remove return when bug is fixed in rescue block
        return output
      end
    end
  end

end
