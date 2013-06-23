opal-irb
=========

irb (interactive ruby) for Opal (Ruby running on javascript).  This is
interactive console (REPL) on a webpage. Good for testing Opal/ruby
interactively without having to install anything.  Intended to be part
of a browser based interactive development tool for Opal

Try it here: http://fkchang.github.io/opal-irb/

Experimental jq-console port http://fkchang.github.io/opal-irb/index-jq.html

Initially based on https://github.com/larryng/coffeescript-repl


Features
--------
* Opal irb in your browser
* Command history
* Multiline support
* Colorized output
* Access last returned value
* Customizable settings
* 100% HTML and JavaScript


Roadmap
-------
* Figure out how to keep variables -- DONE 6/10/2013, thx @adambeynon
* have it automatically know when a complete ruby expression is there instead of multi line mode like irb -- CLOSE ENOUGH 6/21/2013 via jqconsole
* Make a gem
* Some demos to show how convenient it can be
* Add more irb functionality
* Make embeddable in any app
* print out inspect in ruby format
* Rails plugin
* Hook into smalltalk style object browser for opal that I plan to write
