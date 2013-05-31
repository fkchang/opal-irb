opal-irb
=========

irb (interactive ruby) for Opal (Ruby running on javascript).  This is
interactive console (REPL) on a webpage. Good for testing Opal/ruby
interactively without having to install anything.  Intended to be part
of a browser based interactive development tool for Opal

Try it here: http://fkchang.github.com/opal-repl/

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

Gotchas
-------
* can't remember local variables, have to use globals (coz running opal parser puts everything in anonymous functions)


Roadmap
-------
* Figure out how to keep variables
* have it automatically know when a complete ruby expression is there instead of multi line mode like irb
* Add more irb functionality
* Make embeddable in any app
* print out inspect in ruby format
* Make a gem
* Rails plugin
* Hook into smalltalk style object browser for opal that I plan to write
