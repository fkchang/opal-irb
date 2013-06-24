# because we want to redirect console.log to stuff
class OpalIrbLogRedirector
  def self.initialize_if_necessary
    unless @redirectors
      @redirectors = []
      %x|
    console.orig_log = console.log
    console.log = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      console.orig_log(args);
      Opal.OpalIrbLogRedirector.$puts(args);
    };
    |

    end


  end
  def self.add_to_redirect redirector
    initialize_if_necessary
    @redirectors << redirector
  end

  def self.puts stuff
    @redirectors.each {|redirector|
      redirector.call(stuff)
    }

  end
end
