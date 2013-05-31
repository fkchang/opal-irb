require 'opal'
require "opal-jquery"
require "opal-parser"


  class OpalIRB

    def self.reset_settings
      `localStorage.clear()`
    end

    def self.save_settings
      `localStorage.settings = JSON.stringify( #{@settings.map})`
    end

    def self.resize_input(e)
      width = $inputdiv.width() - $inputl.width()
      content = $input.value()
      # content.gsub /\n/, '<br/>'
      $inputcopy.html content

      $inputcopy.width width
      $input.width width
      $input.height $inputcopy.height() + 2
    end

    def self.scroll_to_bottom
      `window.scrollTo( 0, #$prompt[0].offsetTop)`
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

    def initialize (output, input, prompt, settings={})
      @output, @input, @prompt = output, input, prompt
      @history = []
      @historyi = -1
      @saved = ''
      @multiline = false
      @settings = DEFAULT_SETTINGS.clone

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


    end


    def print(args)
      # s = args.join(' ') or ' '
      s = args
      o = @output.html + s + "\n"
      # @output[0].innerHTML = o.split("\n")[-@settings.maxLines...].join("\n")
      # `#{@output[0]}.innerHTML = #{o.split("\n")[-@settings.maxLines].join("\n")}`
      # @output.html = o.split("\n")[-@settings[:maxLines]].join("\n")
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

    def set_prompt
      s = @multiline ? '------' : 'opal'
      @prompt.html = "#{s}&gt;&nbsp;"
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
        compiled = Opal::Parser.new.parse @saved
        # doesn't work w/th opal 0.3.27 compiled = compiled[14..-7] # strip off anonymous function so variables will persist
        # compiled = compiled.split("\n")[2..-2].join("\n")
        # compiled = compiled.gsub("return", "")
        # value = eval.call window, compiled
        log compiled
        value = `eval(compiled)`
        # window[@settings.last_variable] = value
        $_ = value
        output = `nodeutil.inspect( value, #{@settings[:showHidden]}, #{@settings[:maxDepth]}, #{@settings[:colorize]})`
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
              "+ <strong>Esc</strong> toggles multiline mode.",
              "+ <strong>Up/Down arrow</strong> flips through line history.",
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
              "+ <strong>maxLines</strong> (#{@settings[:maxLines]}): max line count of this console",
              "+ <strong>maxDepth</strong> (#{@settings[:maxDepth]}): max depth in which to inspect outputted object",
              "+ <strong>showHidden</strong> (#{@settings[:showHidden]}): flag to output hidden (not enumerable) properties of objects",
              "+ <strong>colorize</strong> (#{@settings[:colorize]}): flag to colorize output (set to false if IRB is slow)",
              " ",
              # "<strong>$irb.save_settings()</strong> will save settings to localStorage.",
              # "<strong>$irb.reset_settings()</strong> will reset settings to default.",
              " "
             ].join("\n")
      print text
    end

    def log thing
      `console.log(#{thing})`
    end

    def history
     @history.reverse.each_with_index {|line, i|
        print "#{i}: #{line}"
      }
    end

    def handle_keypress(e)
      log e.which
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
        `input = #@input.val()`

        if input and @multiline and @saved
          input = @input.value
          @input.value ''

          print @prompt.html() + escape_html(input)
          add_to_saved input
          process_saved()
        elsif @multiline and @saved
          process_saved()
        end
        @multiline = ! @multiline
        set_prompt()

      when 38               # up arrow
        e.prevent_default

        if @historyi < @history.length-1
          @historyi += 1
          @input.value =  @history[@historyi]
        end
      when 40               # down arrow
        e.prevent_default

        if @historyi > 0
          @historyi += -1
          @input.value =  @history[@historyi]
        end
      end
    end

    def self.init
      # bind other handlers
      $input.on :keydown do
        scroll_to_bottom
      end
      Element.find(`window`).on :resize do |e|
        resize_input e
      end

      $input.on :keyup do |e|
        resize_input e
      end
      $input.on :change do |e|
        resize_input e
      end

      Element.find('html').on :click do |e|
        # if e.clientY > $input[0].offsetTop
        $input.focus()
        # end
      end

      # instantiate our IRB
      irb =  OpalIRB.new( $output, $input, $prompt)

      # replace console.log

      # def console.log(*args)
      #   SAVED_CONSOLE_LOG.apply console, args
      #   irb.print *args
      # end

      # expose irb as $irb
      $irb = irb

      # initialize window
      resize_input()
      $input.focus()


      # print header
      irb.print [
                 "# Opal IRB", #"# Opal v#{OPAL_VERSION} IRB",
                  "# <a href=\"https://github.com/fkchang/opal-irb\" target=\"_blank\">https://github.com/fkchang/opal-irb</a>",
                  "# inspired by <a href=\"https://github.com/larryng/coffeescript-repl\" target=\"_blank\">https://github.com/larryng/coffeescript-repl</a>",
                  "#",
                  "# <strong>help</strong> for features and tips.",
                  " "
                 ].join("\n")

    end

  end
