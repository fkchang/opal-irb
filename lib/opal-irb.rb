require 'opal'
require 'opal-jquery'
require 'opal-irb/version.rb'
Opal.append_path File.expand_path('../../opal', __FILE__)
Opal.append_path File.expand_path('../../js', __FILE__)

module OpalIrbUtils

  # used to include the requirements in a template file ala
  # <%= OpalIrbUtils.include_opal_irb_jqconsole_requirements %>
  # params opts[:include_jquery] include a canned version of jquery, jquery-ui, jquery-migrate that is compatibable w/the jqconsole.  Set this to false if you already include these files
  # params opts[:include_codemirror] include the code mirror
  def self.include_opal_irb_jqconsole_requirements(opts = { :include_jquery => true, :include_codemirror => true})
    jquery_scripts = opts[:include_jquery] ? include_web_jquery : ""
    code_mirror_scripts = opts[:include_codemirror] ? include_code_mirror : ""

    jquery_scripts + code_mirror_scripts
 end

  def self.include_web_jquery
   jquery_requirements = [
                          "http://ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js",
                          "https://ajax.googleapis.com/ajax/libs/jqueryui/1.10.3/jquery-ui.min.js",
                          "http://code.jquery.com/jquery-migrate-1.2.1.js"
                         ]
    # style sheet so editor window has styling
   '<link rel="stylesheet" href="http://code.jquery.com/ui/1.10.3/themes/smoothness/jquery-ui.css" />' +
      require_scripts(jquery_requirements)
 end

  def self.require_scripts(javascripts)
   javascripts.map { |js|
     "<script src='#{js}'></script>"
   }.join("\n")
  end

  def self.include_code_mirror(https=nil)
    prefix = https ? 'https:' : ''
    %|<link rel="stylesheet" href="#{prefix}//codemirror.net/lib/codemirror.css"/>| +
   require_scripts( [ "#{prefix}//codemirror.net/lib/codemirror.js",
                      "#{prefix}//codemirror.net/keymap/emacs.js",
                      "#{prefix}//codemirror.net/mode/ruby/ruby.js"])
 end

end
