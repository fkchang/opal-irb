$CE_DEBUG = false # override to turn on debugging
require_relative 'completion_results'
class OpalIrb
  # CompletionEngine for tab completes
  class CompletionEngine
    VARIABLE_DOT_COMPLETE = /(\s*([$]*\w+)\.)$/
    METHOD_COMPLETE = /(\s*([$]*\w+)\.(\w+))$/
    CONSTANT = /(\s*([A-Z]\w*))$/
    METHOD_OR_VARIABLE = /(\s*([a-z]\w*))$/
    GLOBAL = /(\s*\$(\w*))$/

    NO_MATCHES_PARAMS = [nil, []]
    # Shows completions for text in opal-irb
    # @param text [String] the text to try to find completions for
    # @returns [CompletionResults]

    def self.complete(text, irb)
      index, matches = get_matches(text, irb)
      CompletionResults.new(text, index, matches)
    end

    # Editor complete, intended to be called from CodeMirror or other
    # javascript editor that does not have the ability to see into
    # Opal objects w/o some work.  To use this, you must first
    # set_irb() the irb you will be using
    # @params text [String] the text to try to find completions for
    # @returns [String[]] the matches
    def self.editor_complete(text)
      debug_puts "Getting matches for #{text}"
      index, matches = get_matches(text, get_irb)
      debug_puts "\tMatches  = #{matches.inspect}"
      matches || []
    end

    # For use with CodeMirror autocompletion, or anything that needs persistent irb
    # of interacts through javascript
    # @param irb [OpalIrb] the irb engine to use, typically that of an OpalIrb condole
    def self.set_irb(irb)
      @irb = irb
    end

    # Called by self.editor_complete to get the irb that is set
    def self.get_irb
      if @irb
        @irb
      else
        fail 'You must set irb to use this funtion'
      end
    end

    def self.get_matches(text, irb)
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
      [index, matches]
    end

    def self.variable_dot_complete(text, irb)
      index = text =~ VARIABLE_DOT_COMPLETE # broken in 0.7, fixed in 0.7
      whole = $1
      target_name = $2
      get_correct_methods_by_type(whole, target_name, index, irb)
    end

    def self.get_correct_methods_by_type(whole, target_name, index, irb)
      case target_name
      when /^[A-Z]/
        get_class_methods(whole, target_name, index)
      when /^\$/
        get_global_methods(whole, target_name, index, irb)
      else
        get_var_methods(whole, target_name, index, irb)
      end
    end

    def self.get_class_methods(whole, target_name, index)
      klass = Kernel.const_get(target_name)
      debug_puts "\t#{klass.inspect} #{klass.methods}"
      [whole.size + index, klass.methods]
    rescue
      puts "\t RESCUE"
      NO_MATCHES_PARAMS
    end

    def self.get_global_methods(whole, target_name, index, irb)
      debug_puts "get_global_methods(#{whole}, #{target_name}, #{index})"
      target_name = target_name[1..-1] # strip off leading $
      name_val_pair = irb.irb_gvars.find {|array| array[0] == target_name }
      if name_val_pair
        methods = name_val_pair[1].methods
        return [whole.size + index, methods]
      end
      NO_MATCHES_PARAMS
    end

    def self.get_var_methods(whole, target_name, index, irb)
      name_val_pair = irb.irb_vars.find {|array| array[0] == target_name }
      if name_val_pair
        methods = name_val_pair[1].methods
        return [whole.size + index, methods]
      end
      NO_MATCHES_PARAMS
    end

    def self.method_complete(text, irb)
      index = text =~ METHOD_COMPLETE # broken in 0.7, fixed in 0.7
      whole = $1
      target_name = $2
      method_fragment = $3
      get_matches_for_correct_type(whole, target_name, method_fragment, index, irb)
    end

    def self.get_matches_for_correct_type(whole, target_name, method_fragment, index, irb)
      debug_puts("get_matches_for_correct_type(#{whole}, #{target_name}, #{method_fragment}, #{index})")
      case target_name
      when /^[A-Z]/
        get_class_methods_by_fragment(whole, target_name, method_fragment, index)
      when /^\$/
        get_global_methods_by_fragment(whole, target_name, method_fragment, index, irb)
      else
        get_var_methods_by_fragment(whole, target_name, method_fragment, index, irb)
      end
    end

    def self.get_class_methods_by_fragment(whole, target_name, method_fragment, index)
      debug_puts "get_class_methods_by_fragment whole: #{whole}, target_name: #{target_name}, method_fragment: #{method_fragment}, index"
      begin
        klass = Kernel.const_get(target_name)
        debug_puts "\t#{klass.inspect} #{klass.methods}"
        [whole.size + index - method_fragment.size, klass.methods.grep(/^#{method_fragment}/)]
      rescue
        puts "\t RESCUE"
        NO_MATCHES_PARAMS
      end
    end

    def self.get_global_methods_by_fragment(whole, target_name, method_fragment, index, irb)
      debug_puts "get_global_methods_by_fragment whole: #{whole}, target_name: #{target_name}, method_fragment: #{method_fragment}, index"
      target_name = target_name[1..-1] # strip off leading $
      name_val_pair = irb.irb_gvars.find {|array| array[0] == target_name }
      if name_val_pair
        methods = name_val_pair[1].methods.grep /^#{method_fragment}/
        return [whole.size + index - method_fragment.size, methods]
      end
      NO_MATCHES_PARAMS
    end

    def self.get_var_methods_by_fragment(whole, target_name, method_fragment, index, irb)
      debug_puts "get_var_methods_by_fragment whole: #{whole}, target_name: #{target_name}, method_fragment: #{method_fragment}, index"
      name_val_pair = irb.irb_vars.find {|array| array[0] == target_name }
      if name_val_pair
        methods = name_val_pair[1].methods.grep /^#{method_fragment}/
        return [whole.size + index - method_fragment.size, methods]
      end
      NO_MATCHES_PARAMS
    end

    def self.constant_complete(text, _irb)
      index = text =~ CONSTANT
      whole = $1
      fragment = $2
      [whole.size + index - fragment.size, Object.constants.grep(/^#{fragment}/)]
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
      [whole.size + index - fragment.size - 1, varnames.map {|name| "$#{name}" }]
    end

    def self.debug_puts(stuff)
      puts(stuff) if $CE_DEBUG # completion_engine debug
    end
  end
end
