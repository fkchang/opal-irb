require 'opal'
require 'opal/compiler'
require 'object_extensions'
require 'opal-parser'           # so I can have require_remote

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

  def irb_varnames
    irb_vars.map { |varname, value| varname }
  end

  def irb_gvars
    %x|gvars = [];
       for(variable in Opal.gvars) {
         if(Opal.gvars.hasOwnProperty(variable)) {
            gvars.push([variable, Opal.gvars[variable]])
         }
       };
       return gvars;|
  end

  def irb_gvarnames
    irb_gvars.map { |varname, value| varname }
  end

  def opal_classes
    classes = []
    $opal_js_object = Native(`Opal`)    # have to make this global right now coz not seen in the each closure w/current opal
    $opal_js_object.each {|k|
      attr = $opal_js_object[k]
      classes << attr if attr.is_a?(Class)
    }
    classes.uniq.sort_by { |cls| cls.name } # coz some Opal classes are the same, i.e. module == class, base, Kernel = Object
  end

  def opal_constants
    constants = []
    $opal_js_object = Native(`Opal`)    # have to make this global right now coz not seen in the each closure w/current opal
    $opal_js_object.each {|k|
      attr = $opal_js_object[k]
      constants << attr
    }
    constants.uniq

  end

  attr_reader :parser

  def parse(cmd)
    Opal::Compiler.new(cmd, irb: true).compile
  end

end
