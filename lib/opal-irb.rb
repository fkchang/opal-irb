require 'opal'
require 'opal-jquery'
require 'opal-irb/version.rb'
Opal.append_path File.expand_path('../../opal', __FILE__)
Opal.append_path File.expand_path('../../js', __FILE__)

module OpalIrbUtils

  # used to include the requirements in a template file ala
  # <%= OpalIrbUtils.include_opal_irb_jqconsole_requirements %>
  def self.include_opal_irb_jqconsole_requirements
    include_web_jquery +
    include_code_mirror
 end

  def self.include_web_jquery
   jquery_requirements = [
                          "http://ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js",
                          "https://ajax.googleapis.com/ajax/libs/jqueryui/1.10.3/jquery-ui.min.js",
                          "http://code.jquery.com/jquery-migrate-1.2.1.js"
                         ]
   require_scripts jquery_requirements
 end

  def self.require_scripts(javascripts)
   javascripts.map { |js|
     "<script src='#{js}'></script>"
   }.join("\n")
  end

  def self.include_code_mirror
   require_scripts [ "http://codemirror.net/lib/codemirror.js",
                     "http://codemirror.net/keymap/emacs.js",
                     "http://codemirror.net/mode/ruby/ruby.js"]
 end

end
