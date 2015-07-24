require 'opal'
require 'opal/compiler'
require 'object_extensions'
require 'opal-parser'           # so I can have require_remote

# 'require' a javascript filename over the internet, asynchronously,
# so you'll have to delay before using.  Should be fine if typed by hand
# but if scripted add delay
def require_js(url)
  # used to use this, but don't want to depend on opal-jquery
  # Element.find("head").append("<script src='#{js_filename}' type='text/javascript'></script>")
  %x|
    var script = document.createElement( 'script' );
    script.type = 'text/javascript';
    script.src = url;
    document.body.appendChild(script);
  |
end

# 'require' a javascrit filename over the internet, synchronously.
# Chrome complains that this is deprecated, so it might go away
def require_js_sync(url)
  %x|
     var r = new XMLHttpRequest();
     r.open("GET", url, false);
     r.send('');
     window.eval(r.responseText)
  |
  nil
end

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
