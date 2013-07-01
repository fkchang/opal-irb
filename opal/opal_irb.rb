require 'opal'
require 'opal-parser'
require 'object_extensions'

class OpalIrb
  def irb_vars
    %x|irbVars = [];
       for(variable in Opal.irb_vars) {
         if(Opal.irb_vars.hasOwnProperty(variable)) {
            irbVars.push([variable, Opal.irb_vars[variable]])
         }
       };
       irbVars|
  end

  attr_reader :parser
  def initialize
    @parser = Opal::Parser.new
  end

  def parse(cmd)
    @parser.parse cmd, :irb => true
  end

end
