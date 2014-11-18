require 'opal'
require 'opal/compiler'
require 'object_extensions'

class OpalIrb
  def irb_vars
    %x|irbVars = [];
       for(variable in Opal.irb_vars) {
         if(Opal.irb_vars.hasOwnProperty(variable)) {
            irbVars.push([variable, Opal.irb_vars[variable]])
         }
       };
       return irbVars;|
  end

  def opal_classes
    classes = []
    $opal_js_object = Native(`Opal`)    # have to make this global right now coz not seen in the each closure w/current opal
    $opal_js_object.each {|k|
      attr = $opal_js_object[k]
      classes << attr if attr.is_a?(Class)
    }
    classes.uniq.sort_by &:name                # coz some Opal classes are the same, i.e. module == class, base, Kernel = Object
  end

  attr_reader :parser

  def parse(cmd)
    Opal::Compiler.new(cmd, irb: true).compile
  end

end
