require 'opal'
require "opal-jquery"
require "opal-parser"

class OpalIRB

  def reset_settings
    `localStorage.clear()`
  end

  def save_settings
    `localStorage.settings = JSON.stringify( #{@settings.map})`
  end

  def resize_input(e)
    width = @inputdiv.width() - @inputl.width()
    content = @input.value()
    # content.gsub /\n/, '<br/>'
    @inputcopy.html content

    @inputcopy.width width
    @input.width width
    @input.height @inputcopy.height() + 2
  end

  def scroll_to_bottom
    `window.scrollTo( 0, #@prompt[0].offsetTop)`
  end

  DEFAULT_SETTINGS = {
    # last_variable: '$_',
    max_lines: 500,
    max_depth: 2,
    show_hidden: false,
    colorize: true,
  }

  def escape_html(s)
    s.gsub(/&/,'&amp;').gsub(/</,'&lt;').gsub(/>/,'&gt;');
  end

  attr_reader :settings

  def initialize (output, input, prompt, inputdiv, inputl, inputr, inputcopy, settings={})
    @output, @input, @prompt, @inputdiv, @inputl, @inputr, @inputcopy =
      output, input, prompt, inputdiv, inputl, inputr, inputcopy
    @history = []
    @historyi = -1
    @saved = ''
    @multiline = false
    @settings = DEFAULT_SETTINGS.clone

    @parser = Opal::Parser.new

    # if localStorage and localStorage.settings
    #   for k, v of JSON.parse(localStorage.settings)
    #     @settings[k] = v
    #   end
    #   for k, v of settings
    #     @settings[k] = v
    #   end
    myself = self
    @input.on :keydown do |evt|
      myself.handle_keypress(evt)
    end

    initialize_window
    print_header

  end


  def print(args)
    s = args
    o = @output.html + s + "\n"
    # @output[0].innerHTML = o.split("\n")[-@settings.max_lines...].join("\n")
    # @output.html = o.split("\n")[-@settings[:max_lines]].join("\n")
    @output.html = o

    nil
  end

  def to_s
    {
      history: @history,
      multiline: @multiline,
      settings: @settings
    }.inspect
  end


  def add_to_history(s)
    @history.unshift s
    @historyi = -1
  end

  def add_to_saved(s)
    @saved +=  s[0...-1] == '\\' ? s[0...-1] : s
    @saved += "\n"
    add_to_history s
  end

  def clear
    @output.html = ""
    nil
  end

  def process_saved
    begin
      #compiled = Opal::Parser.new.parse @saved
      compiled = @parser.parse @saved, :irb => true
      # doesn't work w/th opal 0.3.27 compiled = compiled[14..-7] # strip off anonymous function so variables will persist
      # compiled = compiled.split("\n")[2..-2].join("\n")
      # compiled = compiled.gsub("return", "")
      # value = eval.call window, compiled
      log compiled
      value = `eval(compiled)`
      # window[@settings.last_variable] = value
      $_ = value
      output = `nodeutil.inspect( value, #{@settings[:show_hidden]}, #{@settings[:max_depth]}, #{@settings[:colorize]})`
      # output = value
    rescue Exception => e
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
    @saved = ''
    print output
  end

  # help
  def help
    text = [
            " ",
            "<strong>Features</strong>",
            "<strong>========</strong>",
            "+ <strong>Esc</strong> enters multiline mode.",
            "+ <strong>Up/Down arrow and ctrl-p/ctrl-n</strong> flips through line history.",
            # "+ <strong>#{@settings[:last_variable]}</strong> stores the last returned value.",
            "+ Access the internals of this console through <strong>$irb</strong>.",
            "+ <strong>clear</strong> clears this console.",
            "+ <strong>history</strong> shows line history.",
            " ",
            "<strong>@Settings</strong>",
            "<strong>========</strong>",
            "You can modify the behavior of this IRB by altering <strong>$irb.@settings</strong>:",
            " ",
            # "+ <strong>last_variable</strong> (#{@settings[:last_variable]}): variable name in which last returned value is stored",
            "+ <strong>max_lines</strong> (#{@settings[:max_lines]}): max line count of this console",
            "+ <strong>max_depth</strong> (#{@settings[:max_depth]}): max_depth in which to inspect outputted object",
            "+ <strong>show_hidden</strong> (#{@settings[:show_hidden]}): flag to output hidden (not enumerable) properties of objects",
            "+ <strong>colorize</strong> (#{@settings[:colorize]}): flag to colorize output (set to false if IRB is slow)",
            " ",
            # "<strong>$irb.save_settings()</strong> will save settings to localStorage.",
            # "<strong>$irb.reset_settings()</strong> will reset settings to default.",
            " "
           ].join("\n")
    print text
  end

  # only outputs to console log, use for debugging
  def log thing
    `console.orig_log(#{thing})`
  end

  def history
    @history.reverse.each_with_index {|line, i|
      print "#{i}: #{line}"
    }
  end

  def handle_keypress(e)
    # log e.which

    case e.which
    when 13                   # return
      e.prevent_default()
      input = @input.value()
      @input.value = ''

      print @prompt.html + escape_html(input)

      if input
        add_to_saved input
        if input[0...-1] != '\\' and not @multiline
          process_saved()
        end
      end
    when 27                   # escape
      e.prevent_default
      open_multiline_dialog
    when 38               # up arrow
      e.prevent_default
      show_previous_history
    when 40               # down arrow
      e.prevent_default
      show_next_history
    when 80                     # p
      if e.ctrl_key
        e.prevent_default
        show_previous_history
      end
    when 78                     # n
      if e.ctrl_key
        e.prevent_default
        show_next_history
      end

    end

  end

  def show_previous_history
    if @historyi < @history.length-1
      @historyi += 1
      @input.value =  @history[@historyi]
    end

  end

  def show_next_history
    if @historyi > 0
      @historyi += -1
      @input.value =  @history[@historyi]
    end
  end

  def initialize_window
    resize_input()
    @input.focus()
  end

  CMD_LINE_METHOD_DEFINITIONS = [
                                 'def help
                                   $irb.help
                                   nil
                                 end',

                                 'def clear
                                   $irb.clear
                                   nil
                                 end',

                                 'def history
                                   $irb.history
                                   nil
                                 end'
                                ]
  def setup_cmd_line_methods
    CMD_LINE_METHOD_DEFINITIONS.each {|method_defn|
      compiled = @parser.parse method_defn
      `eval(compiled)`
    }


  end

  def print_header
    print [
           "# Opal v#{Opal::VERSION} IRB", #"# Opal v#{OPAL_VERSION} IRB",
           "# <a href=\"https://github.com/fkchang/opal-irb\" target=\"_blank\">https://github.com/fkchang/opal-irb</a>",
           "# inspired by <a href=\"https://github.com/larryng/coffeescript-repl\" target=\"_blank\">https://github.com/larryng/coffeescript-repl</a>",
           "#",
           "# <strong>help</strong> for features and tips.",
           " "
          ].join("\n")
  end

  def self.create_html(parent_container_id)
    parent = Element.find(parent_container_id)
    parent.html =  '      <div id="outputdiv">
        <pre id="output"></pre>
      </div>
      <div id="inputdiv">
        <div id="inputl">
          <pre id="prompt">opal&gt;&nbsp;</pre>
        </div>
        <div id="inputr">
          <textarea id="input" spellcheck="false"></textarea>
          <div id="inputcopy"></div>
        </div>
'
    # puts parent.html

  end

  def self.create(container_id)
    create_html(container_id)
    output    = Element.find('#output')
    input     = Element.find('#input')
    prompt    = Element.find('#prompt')
    inputdiv  = Element.find('#inputdiv')
    inputl    = Element.find('#inputl')
    inputr    = Element.find('#inputr')
    inputcopy = Element.find('#inputcopy')

    # instantiate our IRB and expose irb as $irb
    irb =  OpalIRB.new( output, input, prompt, inputdiv, inputl, inputr,
                        inputcopy)
    irb.setup_cmd_line_methods
    # bind other handlers
    input.on :keydown do
      irb.scroll_to_bottom
    end
    Element.find(`window`).on :resize do |e|
      irb.resize_input e
    end

    input.on :keyup do |e|
      irb.resize_input e
    end
    input.on :change do |e|
      irb.resize_input e
    end

    Element.find('html').on :click do |e|
      # if e.clientY > input[0].offsetTop
      input.focus()
      # end
    end

    %x|
    console.orig_log = console.log
    console.log = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      console.orig_log(args);
      Opal.gvars["irb"].$print(args);
    };
    |
    $irb = irb

    irb.setup_multi_line

  end

  def setup_multi_line
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

    @open_editor_dialog = %x|function() {
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
    @editor.setValue(@input.value)
    # `openOpalIrbMultiLineDialog()`
    @open_editor_dialog.call
  end


  def process_multiline
    multi_line_value = @editor.getValue.sub(/(\n)+$/, "")
    add_to_saved multi_line_value
    print multi_line_value
    process_saved
    @input.value = ""
  end

end
