Document.ready? do
  SAVED_CONSOLE_LOG = `console.log`

  $output    = Element.find('#output')
  $input     = Element.find('#input')
  $prompt    = Element.find('#prompt')
  $inputdiv  = Element.find('#inputdiv')
  $inputl    = Element.find('#inputl')
  $inputr    = Element.find('#inputr')
  $inputcopy = Element.find('#inputcopy')


    def resetSettings
      `localStorage.clear()`
    end

    def saveSettings
      `localStorage.settings = JSON.stringify( #{@settings.map})`
    end





    def resizeInput(e)
      width = $inputdiv.width() - $inputl.width()
      content = $input.value()
      # content.gsub /\n/, '<br/>'
      $inputcopy.html content

      $inputcopy.width width
      $input.width width
      $input.height $inputcopy.height() + 2
    end

    def scrollToBottom
      `window.scrollTo( 0, #$prompt[0].offsetTop)`
    end


    class OpalREPL
      DEFAULT_SETTINGS = {
        lastVariable: '$_',
        maxLines: 500,
        maxDepth: 2,
        showHidden: false,
        colorize: true,
      }

      def escapeHTML(s)
        s.gsub(/&/,'&amp;').gsub(/</,'&lt;').gsub(/>/,'&gt;');
      end

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
          myself.handleKeypress(evt)
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


      def setPrompt
        s = @multiline ? '------' : 'opal'
        @prompt.html = "#{s}&gt;&nbsp;"
      end

      def addToHistory(s)
        @history.unshift s
        @historyi = -1
      end

      def addToSaved(s)
        @saved +=  s[0...-1] == '\\' ? s[0...-1] : s
        @saved += "\n"
        addToHistory s
      end

      def clear
        `#{@output[0]}.innerHTML = ''`
        nil
      end

      def processSaved
        begin
          compiled = Opal::Parser.new.parse @saved
          # doesn't work w/th opal 0.3.27 compiled = compiled[14..-7] # strip off anonymous function so variables will persist
          # compiled = compiled.split("\n")[2..-2].join("\n")
          # compiled = compiled.gsub("return", "")
          # value = eval.call window, compiled
          log compiled
          value = `eval(compiled)`
          # window[@settings.lastVariable] = value
          # output = nodeutil.inspect value, @settings.showHidden, @settings.maxDepth, @settings.colorize
          output = value
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
          "+ <strong>#{repl.settings.lastVariable}</strong> stores the last returned value.",
          "+ Access the internals of this console through <strong>$$</strong>.",
          "+ <strong>$$.clear()</strong> clears this console.",
          " ",
          "<strong>Settings</strong>",
          "<strong>========</strong>",
          "You can modify the behavior of this REPL by altering <strong>$$.settings</strong>:",
          " ",
          "+ <strong>lastVariable</strong> (#{repl.settings.lastVariable}): variable name in which last returned value is stored",
          "+ <strong>maxLines</strong> (#{repl.settings.maxLines}): max line count of this console",
          "+ <strong>maxDepth</strong> (#{repl.settings.maxDepth}): max depth in which to inspect outputted object",
          "+ <strong>showHidden</strong> (#{repl.settings.showHidden}): flag to output hidden (not enumerable) properties of objects",
          "+ <strong>colorize</strong> (#{repl.settings.colorize}): flag to colorize output (set to false if REPL is slow)",
          " ",
          "<strong>$$.saveSettings()</strong> will save settings to localStorage.",
          "<strong>$$.resetSettings()</strong> will reset settings to default.",
          " "
        ].join("\n")
        print text
      end

      def log thing
        `console.log(#{thing})`
      end

    def handleKeypress(e)
      log e.which
      case e.which
      when 13
        e.prevent_default()
        input = @input.value()
        @input.value = ''

        print `#@prompt.html()` + escapeHTML(input)

        if input
          addToSaved input
          if input[0...-1] != '\\' and not @multiline
            processSaved()
          end
        end
      when 27
        `e.preventDefault()`
        `input = #@input.val()`

        if input and @multiline and @saved
          input = @input.value
          @input.value ''

          print @prompt.html() + escapeHTML(input)
          addToSaved input
          processSaved()
        elsif @multiline and @saved
          processSaved()
        end
        @multiline = ! @multiline
        setPrompt()

      when 38
        `e.preventDefault()`

        if @historyi < @history.length-1
          @historyi += 1
          `#@input.val( #@history[#@historyi])`
        end
      when 40
        `e.preventDefault()`

        if @historyi > 0
          @historyi += -1
          @input.val @history[@historyi]
        end
      end
    end


    end


    def init
      # bind other handlers
      $input.on :keydown do
        scrollToBottom
      end
      Element.find(`window`).on :resize do |e|
        resizeInput e
      end

      $input.on :keyup do |e|
        resizeInput e
      end
      $input.on :change do |e|
        resizeInput e
      end

      Element.find('html').on :click do |e|
        # if e.clientY > $input[0].offsetTop
        #   $input.focus()
        # end
      end

      # instantiate our REPL
      repl =  OpalREPL.new( $output, $input, $prompt)

      # replace console.log

      # def console.log(*args)
      #   SAVED_CONSOLE_LOG.apply console, args
      #   repl.print *args
      # end

      # expose repl as $$
      $repl = repl

      # initialize window
      resizeInput()
      $input.focus()


      # print header
      repl.print [
                  "# Opal v#{OPAL_VERSION} REPL",
                  "# <a href=\"https://github.com/fkchang/opal-repl\" target=\"_blank\">https://github.com/fkchang/opal-repl</a>",
                  "# inspired by <a href=\"https://github.com/larryng/coffeescript-repl\" target=\"_blank\">https://github.com/larryng/coffeescript-repl</a>",
                  "#",
                  "# help() for features and tips.",
                  " "
                 ].join("\n")

    end

  init()
end
