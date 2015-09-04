opal-irb
=========
[![Gem Version](https://badge.fury.io/rb/opal-irb.svg)](http://badge.fury.io/rb/opal-irb)

irb (interactive ruby) for Opal (Ruby running on javascript).  This is
interactive console (REPL) on a webpage. Good for testing Opal/ruby
interactively without having to install anything.  Intended to be part
of a browser based interactive development tool for Opal

Try it here: http://fkchang.github.io/opal-irb/index-jq.html

Embedded example http://fkchang.github.io/opal-irb/index-embeddable.html

Original https://github.com/larryng/coffeescript-repl based port http://fkchang.github.io/opal-irb/index-homebrew.html


Instructional Media
-------------------

Videos:
* Overview, no sound http://www.youtube.com/watch?v=6hUwN5BdSHo
* Demo of 1st cut of tab completion  https://youtu.be/mQTulgBm5Nk

Blogposts:
* Thorough overview of features including embedded iframe examples of such http://funkworks.blogspot.com/2015/08/an-overview-of-opal-irbs-features.html

Presentations:
* Overview of features based on above blogpost (reveal.js exported by org-mode doc in doc/presentations directory)
http://fkchang.github.io/opal-irb/doc/presentations/opal_irb_overview.html

Features
--------

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

HOW TOS
-------

## Embedding into opal apps

### Lissio

Embedding into lissio app, as made by lissio new

* add to Gemfile opal-irb
```ruby
# gem 'opal-irb', '0.7.0' for Opal 0.7.*
# gem 'opal-irb', '0.8.*' for Opal 0.8.*
# For latest do below
gem 'opal-irb', github: 'fkchang/opal-irb'
```
* invoke app to require opal-jquery and opal-irb
```bash
lissio start --require opal-irb
```
* add a helper which includes the jquery and codemirror requirements

```html
 <%= OpalIrbUtils.include_opal_irb_jqconsole_requirements %>
```

* change the require in app/app.rb -- order matters, at the moment to have opal-jquery and opal-browser coexist you need to load opal-jquery before loading lissio
```ruby
require 'opal'
require 'jqconsole'                     # add these 3 jqconsole support
require 'opal_irb_jqconsole_css'        # css for opal_irb_jqconsole_css
require 'opal_irb_jqconsole'            # the console code
require 'lissio'

```
* override Application#start() to create a button and hook up opal-irb
```ruby
  def start
    super
    element << DOM do
      button.show_irb! "Show Irb"
    end

    OpalIrbJqconsole.create_bottom_panel
    OpalIrbJqconsole.add_open_panel_behavior("show_irb")
  end

```

* profit!

### Rails
* setup Rails app for opal use via https://github.com/opal/opal-rails
* add to Gemfile opal-irb, jquery-ui-rails (for multi editor)
```ruby
    # gem 'opal-irb', '0.7.0' for Opal 0.7.*
    # gem 'opal-irb', '0.8.*' for Opal 0.8.*
    # For latest do below
    gem 'opal-irb', github: 'fkchang/opal-irb', require: 'opal-irb-rails'
    gem 'jquery-ui-rails'
```
* include stylesheets in application.css.scss
```scss
/*= require_self
 *= require jquery-ui/dialog
 *= require opal-irb/jqconsole
 */
```
* include jquery UI dialog in application.js
  * for Opal 0.7.0 if you have kept application.js vs converting to application.js.rb
```js
//= require jquery-ui/dialog
```
  * for Opal 0.8.0, you must create application.js.rb or else you are forced to load the opal modules by hand
```ruby
require 'jquery-ui/dialog'
```

* include codemirror js/css, you can pull from CDN w/the below in your template (haml example below)
```haml
= OpalIrbUtils.include_code_mirror.html_safe
```

* Set it up in opal code

  * Example that creates a bottom panel, a button to bring it up
```ruby
    require 'opal_irb_jqconsole'

    # opal-browser code to add a button
    $document["#workarea"] << DOM do
      button.show_irb! "Show Irb"
    end
    # opal-jquery code to add a button
    Element.find(".main").append "<button class='btn' id='show_irb'>Show Irb</button>"

    # creates a panel at the bottom
    OpalIrbJqconsole.create_bottom_panel(hidden=true)
    # adds open panel behavior to element w/id show_irb
    OpalIrbJqconsole.add_open_panel_behavior("show_irb")
```

* Example that creates a bottom panel, makes a hot key "shift-command-c" to toggle the panel

```ruby
    OpalIrbJqconsole.create_bottom_panel(hidden=true)
    OpalIrbJqconsole.add_hot_key_panel_behavior(modifiers: %w(meta shift), key: "c")

```

* profit!

Dependencies
------------

* opal -  of course
* opal-jquery (would like to do away with this, don't need it)
  * jquery (cuz of the above)
  * jquery-ui dialog - for the code dial
* code mirror - for code editing
* opal-browser (so you can use it from opal-irb) OPTIONAL, it's used in the examples but it can be deployed without opal-browser, esp. since Rails defaults to using jquery and opal-browser and opal-jquery have a lot of overlap, and some small conflicts

Version Scheme
--------------
While in my mind there are a lot of things that keep opal-irb at not yet suitable to be a gem/ 0.1.0 version number, I frequently have to change code to support the latest minor release for Opal, so I think I need to adopt a scheme that tracks such.  So the 1st gem release will be 0.7.0, to indicate compatibility with 0.7.* versions of opal, followed fairly quickly with a 0.8.0 release to match 0.8.0 the current version (at time of writing) of opal.

Roadmap
-------
* Figure out how to keep variables -- DONE 6/10/2013, thx @adambeynon
* have it automatically know when a complete ruby expression is there instead of multi line mode like irb -- CLOSE ENOUGH 6/21/2013 via jqconsole
* Make a gem - DONE 6/23/2013 1st for use in opal-inspector, made into a bonafide gem 9/1/15
* Hook into smalltalk style object browser for opal that I plan to write - STARTED
* Some demos to show how convenient it can be - DONE 7/19/2013 - you tube video overview
* Add more irb/pry functionality
  * tab completion - DONE
  * cd ls
  * show source via source maps and opal-inspector
* Make embeddable in any app STARTED 7/30/2013, made embeddable into lisso 2/4/2014
* print out inspect in ruby format
* Rails plugin - WORK done on 8/27/14, works w/opal rails and assets, need to document
* navigate stacktrace code via source maps
* remove jquery dependancy -- need to convert jqconsole, and remove the the jquery-ui dialog
* split up dependancy and hierarchy, jquery and jquery free versions, rails vs no rails, etc.
