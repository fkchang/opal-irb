class OpalIrb
    # Used to store results and perform the correct actions on the console
    # 3 cases:
    # * No match
    #   * no change to prompt
    #   * insert_tab ==  true
    # * There is a single match
    #   * change prompt to the single match
    #   * insert_tab == false
    # * There are multiple matches
    #   * show the matches
    #   * change prompt to the max common prefix
    #   * insert_tab == false
    class CompletionResults

      attr_reader :matches, :old_prompt, :new_prompt_text
      def initialize(orig_text, match_index, matches)
        @matches = matches || [] # Native#methods is nil, need to figure out how to handle it
        # @insert_tab = matches.size > 0 ? false : true
        @insert_tab = false

        CompletionEngine.debug_puts "orig_text: |#{orig_text}| match_index: #{match_index} matches #{matches.inspect}"
        if matches.size == 1
          @new_prompt_text =  match_index == 0 ? matches.first : "#{orig_text[0..match_index-1]}#{matches.first}"
        elsif matches.size > 1
          @old_prompt = orig_text
          @new_prompt_text = common_prefix_if_exists(orig_text, match_index, matches)
        end
      end

      def common_prefix_if_exists(orig_text, match_index, results)
        working_copy = results.clone
        chars = common_chars_in_prefix(working_copy)
        common = chars.join
        CompletionEngine.debug_puts "\torig_text: |#{orig_text}| common prefix: #{common} match_index: #{match_index}"
        match_index == 0 ? common : orig_text[0..match_index-1] + common
      end

      def common_chars_in_prefix(words)
        first_word = words.shift
        chars = []
        i = 0
        first_word.each_char { |char|
          if words.all? { |str| str[i] == char }
            chars << char
            i += 1
          else
            return chars
          end
        }
        chars
      end

      def old_prompt?
        @old_prompt
      end

      def matches?
        @matches.size > 1
      end

      def new_prompt?
        @new_prompt_text
      end

      # Tells the console whether or not to tab or not
      def insert_tab?
        @insert_tab
      end
      # writes an "old prompt" before showing matchings results, if there are matches
      # @param jqconsole [Native] jq-console used by opal-irb
      # @param jqconsole [String] the old class
      def set_old_prompt(jqconsole, prompt, jqconsole_class)
        jqconsole.Write("#{prompt}#{old_prompt}\n", jqconsole_class) if old_prompt?
      end
      # Displays matches if there are any
      # @param jqconsole [Native] jq-console used by opal-irb
      def display_matches(jqconsole)
        jqconsole.Write(OpalIrb::CompletionFormatter.format(matches)) if matches?
      end

      # Updates the prompt to include the only match or most common prefix if there are any
      # @param jqconsole [Native] jq-console used by opal-irb
      def update_prompt(jqconsole)
        jqconsole.SetPromptText(new_prompt_text) if new_prompt?
      end

    end
end
