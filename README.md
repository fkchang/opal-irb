opal-irb
=========

irb (interactive ruby) for Opal (Ruby running on javascript).  This is
interactive console (REPL) on a webpage. Good for testing Opal/ruby
interactively without having to install anything.  Intended to be part
of a browser based interactive development tool for Opal

Try it here: http://fkchang.github.io/opal-irb/index-jq.html

Original https://github.com/larryng/coffeescript-repl based port http://fkchang.github.io/opal-irb/index-homebrew.html

Features
--------

Video: overview http://www.youtube.com/watch?v=6hUwN5BdSHo

* Opal irb in your browser
* Command history - up/down arrows, ctrl-n/ctrl-p
* Multiline support - ctrl-m to enter editor, ctrl-Enter to submit code
* Colorized output
* Access last returned value via $_
* Shareable code links like [this](http://fkchang.github.io/opal-irb/index-jq.html#code:class%20Welcome%0A%20%20def%20announce%0A%20%20%20%20alert%20%22Welcome%20to%20opal-irb%22%0A%20%20end%0Aend%0Aw%20%3D%20Welcome.new%0Aw.announce)
  * create links by hitting ctrl-L and the lines/multilines will be made into a shareable link
  * also can create links using the history number, i.e. irb\_link\_for 2
* Emacs keystrokes like all GNU readline apps (original irb included)
* 100% HTML and JavaScript


Roadmap
-------
* Figure out how to keep variables -- DONE 6/10/2013, thx @adambeynon
* have it automatically know when a complete ruby expression is there instead of multi line mode like irb -- CLOSE ENOUGH 6/21/2013 via jqconsole
* Make a gem - DONE 6/23/2013 1st for use in opal-inspector
* Hook into smalltalk style object browser for opal that I plan to write - STARTED
* Some demos to show how convenient it can be - DONE 7/19/2013 - you tube video overview
* Add more irb/pry functionality
* Make embeddable in any app
* print out inspect in ruby format
* Rails plugin
