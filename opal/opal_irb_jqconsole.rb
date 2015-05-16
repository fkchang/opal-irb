require 'opal'
require 'opal-jquery'
require 'opal_irb_log_redirector'
require 'opal_irb'
require 'opal_irb/completion_engine'
require 'opal_irb/completion_formatter'
require 'jqconsole'

# top level methods for irb cmd line
def irb_link_for history_num=nil
  OpalIrbJqconsole.console.irb_link_for history_num
end

def require_js(js_filename)
  Element.find("head").append("<script src='#{js_filename}' type='text/javascript'></script>")
end

class Timeout
  def initialize(time=0, &block)
    @timeout = `setTimeout(#{block}, time)`
  end

  def clear
    `clearTimeout(#{@timeout})`
  end
end

class OpalIrbJqconsole
  def self.console
    @console
  end

  # create on a pre existing div
  def self.create(parent_element_id)
    @console = OpalIrbJqconsole.new(parent_element_id)
  end

  BOTTOM_PANEL_ID = "opal-irb-console-bottom-panel"
  # create a bottom panel
  def self.create_bottom_panel(hidden = false)
    parent_element_id="opal-irb-console"
    style = hidden ? "style=\"display:none\"" : ""
    # <a href="#" id="collapse-opal-irb-console" class=\"boxclose\"></a>

    html = <<HTML
    <div id="#{BOTTOM_PANEL_ID}" #{style}>
      <div id="opal-irb-console-topbar">
     <span id="collapse-opal-irb-console" class=\"boxclose\"></span>
      </div>
      <div id='#{parent_element_id}'>
      </div>
    </div>
HTML
    Element.find("body").append(html)
    Element.id("collapse-opal-irb-console").on(:click) {
      Element.id("#{BOTTOM_PANEL_ID}").hide;
    }
    create("##{parent_element_id}")
  end

  def self.add_hot_key_panel_behavior(keys_hash)
    Element.find("body").on(:keydown) { |evt|
      if create_key_filter(keys_hash, evt)
        if panel.visible?
          hide_panel
        else
          show_panel
        end
      end
    }
  end
  # set $DEBUG_KEY_FILTER = true somewhere in your app to see the keys for debugging
  def self.create_key_filter(keys_hash, evt)
    puts "evt.ctrl_key #{evt.ctrl_key} evt.meta_key #{evt.meta_key} evt.shift_key #{evt.shift_key} evt.key_code #{evt.key_code}_" if $DEBUG_KEY_FILTER
    keys_hash[:modifiers].all? { |modifier| evt.send("#{modifier}_key") } && evt.key_code == keys_hash[:key].upcase.ord
  end

  def self.add_open_panel_behavior(link_id)
    Element.id(link_id).on(:click) {
      if panel.visible?
        alert "OpalIRB is already showing"
      else
        show_panel
      end
    }
  end

  def self.panel
    Element.id("#{BOTTOM_PANEL_ID}")
  end

  def self.show_panel
    panel.show
    Timeout.new { console.focus}
  end

  def self.hide_panel
    panel.hide
  end


  def focus
    @jqconsole.Focus
  end

  attr_reader :irb
  def initialize(parent_element_id)
    @irb = OpalIrb.new
    setup_cmd_line_methods
    setup_jqconsole(parent_element_id)
    create_multiline_editor
    redirect_console_dot_log
    handler()
    setup_code_link_handling
  end

  # logs only to js console, not to irb, for things you want only for
  # debug and not public viewing
  def log thing
    `console.orig_log(#{thing})`
  end


  def setup_code_link_handling
    @code_link_handler = CodeLinkHandler.new
    link_code = @code_link_handler.grab_link_code
    if link_code
      # do this after everything initializes
      Timeout.new {
        print_and_process_code link_code
        self.class.show_panel
      }
    end
  end

  def create_and_display_code_link code
    code_link = @code_link_handler.create_link_for_code code
    unescaped_write "<a href=#{code_link}>#{code_link}</a>\n" if code_link
  end

  class CodeLinkHandler

    def initialize(location=`window.location`)
      @location = Native(location)      # inject this so we can test
    end

    def create_link_for_code code
      if code
        @location.origin + @location.pathname + "#code:" + `encodeURIComponent(#{code})`
      else
        nil
      end
    end
    # initialize irb w/link passed in code ala try opal
    def grab_link_code
      link_code = `decodeURIComponent(#{@location.hash})`
      if link_code != ''
        link_code[6..-1]
      else
        nil
      end
    end

  end

  def irb_link_for history_num
    history_num = -1 unless history_num # pick last command before irb_link_for if nil
    history_num -= 1                    # offset off by 1
    code = jqconsole.GetHistory[history_num] #
    create_and_display_code_link code
  end


  def irb_link_for_current_line
    current_code = jqconsole.GetPromptText
    create_and_display_code_link current_code
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
    @editor = Native(@editor)   # seamless bridging removed

  end
  def open_multiline_dialog
    @editor.setValue(@jqconsole.GetPromptText)
    @open_editor_dialog_function.call
  end

  def print_and_process_code code
    @jqconsole.SetPromptText code
    @jqconsole._HandleEnter
  end

  def process_multiline
    multi_line_value = @editor.getValue.sub(/(\n)+$/, "")
    print_and_process_code multi_line_value
  end

  # show completions on hitting tab.  This modeled after irb.
  # * If there are completions it will print the prompt, show the
  # completions and reprint the prompt line.  Same as irb behavior,
  # but these are the steps you need to take w/jq-console
  # * If no completions it acts as jq-console tab
  # @param text [String] text on the opal-irb command line
  # @returns [Boolean] returns true if opal-irb is to actually tab - i.e. no completion found
  # results.prompt_change(@jqconsole, 'jqconsole-old-prompt')
  # results.write_results(@jqconsole)
  # results.change_prompt(@jqconsole)
  def tab_complete(text)
    results = OpalIrb::CompletionEngine.complete(text, @irb)
    # if results
    #   if results.size > 1
    #     @jqconsole.Write("#{CONSOLE_PROMPT}#{text}\n", "jqconsole-old-prompt")
    #     @jqconsole.Write(OpalIrb::CompletionFormatter.format(results))
    #     append_common_prefix_if_exists(text, results)
    #   else
    #     @jqconsole.SetPromptText(results.first)
    #   end
    #   false
    # else
    #   true
    # end
    results.set_old_prompt(@jqconsole, CONSOLE_PROMPT, 'jqconsole-old-prompt')
    results.display_matches(@jqconsole)
    results.update_prompt(@jqconsole)
    results.insert_tab?
  end


  CONSOLE_PROMPT = 'opal> '
  attr_reader :jqconsole
  def setup_jqconsole(parent_element_id)
    Element.expose(:jqconsole)

    @jqconsole = Native(Element.find(parent_element_id).jqconsole("Welcome to Opal #{Opal::VERSION}\ntype help for assistance\n", CONSOLE_PROMPT)) # seamless jquery plugin removed
    @jqconsole.RegisterTabHandler(lambda { |text| tab_complete(text)})
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
    @jqconsole.RegisterShortcut('L', lambda{ irb_link_for_current_line})

    @jqconsole.RegisterAltShortcut('B', lambda{ @jqconsole._MoveLeft(true); handler})
    @jqconsole.RegisterAltShortcut('F', lambda{ @jqconsole._MoveRight(true); handler})
    @jqconsole.RegisterAltShortcut('D', lambda{ @jqconsole._Delete(true); handler})

    # to implement in jq-console emacs key bindings you get for free normally
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
                                 'def js_require(js_file)
                                    s = DOM do
                                      script({ src: js_file})
                                    end
                                    $document.body << s
                                  end', # js_require "http://www.goodboydigital.com/runpixierun/js/pixi.js"
                                 # TODO Kernel.alert is now returning undefined in opal, rm when fixed
                                 # 'def alert stuff
                                 #    Kernel.alert stuff
                                 #    nil
                                 # end',


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
      if $check_error.first =~ /unexpected 'false/
        # TODO when rescue is fixed to return last evaluated value remove returns
        return 0
      else
        # see above to-do
        return false
      end
    end
  end

  def write *stuff
    @jqconsole.Write *stuff
  end

  def unescaped_write str
    # `#{@jqconsole}.Write(str, "unescaped", false)`
    @jqconsole.Write(str, "unescaped", false)
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
<b>$_</b>                               last value returned is stored in this global
<b>history</b>:                         Shows history
<b>irb_link_for history_num</b>:        Create a link for the code in the history
<b>ctrl-c</b>:                          Abort prompt
<b>ctrl-m</b>:                          Pop up multi-line editor
<b>ctrl-Enter</b>:                      Submit code in multi-line editor
<b>ctrl-l</b>:                          Creates a link with the code you have on the current line/lines
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
        $last_cmd = cmd
        $irb_last_compiled = @irb.parse cmd
        log $irb_last_compiled
        value = `eval(#{$irb_last_compiled})`
        $_ = value
        Native($_).inspect      # coz native JS objects don't support inspect
      end
    rescue Exception => e
      $last_exception = e
      # alert e.backtrace.join("\n")
      if e.backtrace
        output = "FOR:\n#{$irb_last_compiled}\n============\n" + e.backtrace.join("\n")
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
