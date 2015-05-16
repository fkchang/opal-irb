class OpalIrb
  # CompletionEngine for tab completes
  class CompletionEngine
    VARIABLE_DOT_COMPLETE = /(\s*(\w+)\.)$/
    METHOD_COMPLETE = /(\s*(\w+)\.(\w+))$/
    CONSTANT = /(\s*([A-Z]\w*))$/
    METHOD_OR_VARIABLE = /(\s*([a-z]\w*))$/
    GLOBAL = /(\s*\$(\w*))$/

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
        @matches = matches
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
        first_word = working_copy.shift
        chars = []
        i = 0
        first_word.each_char { |char|
          if working_copy.all? { |str| str[i] == char }
            chars << char
            i += 1
          else
            break
          end
        }
        common = chars.join
        CompletionEngine.debug_puts "\torig_text: |#{orig_text}| common prefix: #{common} match_index: #{match_index}"
        match_index == 0 ? common : orig_text[0..match_index-1] + common
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
    NO_MATCHES_PARAMS = [nil, []]
    # Shows completions for text in opal-irb
    # @param text [String] the text to try to find completions for
    # @returns [CompletionResults]

    def self.complete(text, irb)
      index, matches = case text
      when GLOBAL
        debug_puts 'GLOBAL'
        global_complete(text, irb)
      when VARIABLE_DOT_COMPLETE
        debug_puts 'VARIABLE_DOT_COMPLETE'
        variable_dot_complete(text, irb)
      when METHOD_COMPLETE
        debug_puts 'METHOD_COMPLETE'
        method_complete(text, irb)
      when CONSTANT
        debug_puts 'CONSTANT'
        constant_complete(text, irb)
      when METHOD_OR_VARIABLE
        debug_puts 'METHOD_OR_VARIABLE'
        method_or_variable_complete(text, irb)
      else
        NO_MATCHES_PARAMS
      end
      CompletionResults.new(text, index, matches)
    end

    def self.variable_dot_complete(text, irb)
      index = text =~ VARIABLE_DOT_COMPLETE # broken in 0.7, fixed in 0.7
      whole = $1
      target_name = $2
      name_val_pair = irb.irb_vars.find { |array| array[0] == target_name }
      if name_val_pair
        methods = name_val_pair[1].methods
        return [whole.size + index.size, methods]
      end
      NO_MATCHES_PARAMS
    end

    def self.method_complete(text, irb)
      index = text =~ METHOD_COMPLETE # broken in 0.7, fixed in 0.7
      whole = $1
      target_name = $2
      method_fragment = $3
      name_val_pair = irb.irb_vars.find { |array| array[0] == target_name }
      if name_val_pair
        methods = name_val_pair[1].methods.grep /^#{method_fragment}/
        return [whole.size + index - method_fragment.size, methods]
      end
      NO_MATCHES_PARAMS
    end

    def self.constant_complete(text, irb)
      index = text =~ CONSTANT
      whole = $1
      fragment = $2
      [whole.size + index - fragment.size, Object.constants.grep( /^#{fragment}/)]
    end

    def self.method_or_variable_complete(text, irb)
      index = text =~ METHOD_OR_VARIABLE
      whole = $1
      fragment = $2
      varnames = irb.irb_varnames.grep /^#{fragment}/
      matching_methods = methods.grep /^#{fragment}/
      [whole.size + index - fragment.size, varnames + matching_methods]
    end

    def self.global_complete(text, irb)
      index = text =~ GLOBAL
      whole = $1
      fragment = $2
      debug_puts "looking for |#{fragment}| from |#{text}|"
      varnames = irb.irb_gvarnames.grep /^#{fragment}/
      [whole.size + index - fragment.size - 1, varnames.map { |name| "$#{name}" }]
    end

    def self.debug_puts stuff
      # puts stuff
    end
  end

end
