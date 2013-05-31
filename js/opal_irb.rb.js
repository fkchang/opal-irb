// opal_irb.rb
(function() {
  var __opal = Opal, self = __opal.top, __scope = __opal, nil = __opal.nil, __breaker = __opal.breaker, __slice = __opal.slice, __gvars = __opal.gvars, __klass = __opal.klass, __hash = __opal.hash, __range = __opal.range;
  var __a, __b;
  return (__b = __scope.Document, __b['$ready?']._p = (__a = function() {

    var def = (this._isObject ? this : this.prototype);
    
    __scope.SAVED_CONSOLE_LOG = console.log;
    __gvars["output"] = __scope.Element.$find("#output");
    __gvars["input"] = __scope.Element.$find("#input");
    __gvars["prompt"] = __scope.Element.$find("#prompt");
    __gvars["inputdiv"] = __scope.Element.$find("#inputdiv");
    __gvars["inputl"] = __scope.Element.$find("#inputl");
    __gvars["inputr"] = __scope.Element.$find("#inputr");
    __gvars["inputcopy"] = __scope.Element.$find("#inputcopy");
    (function(__base, __super){
      // line 12, opal_irb, class OpalIRB
      function OpalIRB() {};
      OpalIRB = __klass(__base, __super, "OpalIRB", OpalIRB);
      var OpalIRB_prototype = OpalIRB.prototype, __scope = OpalIRB._scope;
      OpalIRB_prototype.settings = OpalIRB_prototype.input = OpalIRB_prototype.output = OpalIRB_prototype.history = OpalIRB_prototype.multiline = OpalIRB_prototype.prompt = OpalIRB_prototype.saved = OpalIRB_prototype.historyi = nil;

      // line 14, opal_irb, OpalIRB.reset_settings
      OpalIRB.$reset_settings = function() {
        
        return localStorage.clear();
      };

      // line 18, opal_irb, OpalIRB.save_settings
      OpalIRB.$save_settings = function() {
        
        if (this.settings == null) this.settings = nil;

        return localStorage.settings = JSON.stringify( this.settings.$map());
      };

      // line 22, opal_irb, OpalIRB.resize_input
      OpalIRB.$resize_input = function(e) {
        var width = nil, content = nil, __a, __b;
        width = (__a = __gvars["inputdiv"].$width(), __b = __gvars["inputl"].$width(), typeof(__a) === 'number' ? __a - __b : __a['$-'](__b));
        content = __gvars["input"].$value();
        __gvars["inputcopy"].$html(content);
        __gvars["inputcopy"].$width(width);
        __gvars["input"].$width(width);
        return __gvars["input"].$height((__a = __gvars["inputcopy"].$height(), __b = 2, typeof(__a) === 'number' ? __a + __b : __a['$+'](__b)));
      };

      // line 33, opal_irb, OpalIRB.scroll_to_bottom
      OpalIRB.$scroll_to_bottom = function() {
        
        return window.scrollTo( 0, __gvars["prompt"][0].offsetTop);
      };

      __scope.DEFAULT_SETTINGS = __hash("max_lines", 500, "max_depth", 2, "show_hidden", false, "colorize", true);

      // line 45, opal_irb, OpalIRB#escape_html
      OpalIRB_prototype.$escape_html = function(s) {
        
        return s.$gsub(/&/, "&amp;").$gsub(/</, "&lt;").$gsub(/>/, "&gt;");
      };

      // line 49, opal_irb, OpalIRB#settings
      OpalIRB_prototype.$settings = function() {
        
        return this.settings
      };

      // line 51, opal_irb, OpalIRB#initialize
      OpalIRB_prototype.$initialize = function(output, input, prompt, settings) {
        var myself = nil, __a, __b;if (settings == null) {
          settings = __hash()
        }
        __a = [output, input, prompt], this.output = __a[0], this.input = __a[1], this.prompt = __a[2];
        this.history = [];
        this.historyi = -1;
        this.saved = "";
        this.multiline = false;
        this.settings = __scope.DEFAULT_SETTINGS.$clone();
        myself = this;
        return (__b = this.input, __b.$on._p = (__a = function(evt) {

          
          if (evt == null) evt = nil;

          return myself.$handle_keypress(evt)
        }, __a._s = this, __a), __b.$on("keydown"));
      };

      // line 75, opal_irb, OpalIRB#print
      OpalIRB_prototype.$print = function(args) {
        var s = nil, o = nil, __a, __b, __c, __d;
        s = args;
        o = (__a = (__c = this.output.$html(), __d = s, typeof(__c) === 'number' ? __c + __d : __c['$+'](__d)), __b = "\n", typeof(__a) === 'number' ? __a + __b : __a['$+'](__b));
        this.output['$html='](o);
        return nil;
      };

      // line 88, opal_irb, OpalIRB#to_s
      OpalIRB_prototype.$to_s = function() {
        
        return __hash("history", this.history, "multiline", this.multiline, "settings", this.settings).$inspect();
      };

      // line 96, opal_irb, OpalIRB#set_prompt
      OpalIRB_prototype.$set_prompt = function() {
        var s = nil, __a;
        s = (function() { if ((__a = this.multiline) !== false && __a !== nil) {
          return "------"
          } else {
          return "opal"
        }; return nil; }).call(this);
        return this.prompt['$html=']("" + (s) + "&gt;&nbsp;");
      };

      // line 101, opal_irb, OpalIRB#add_to_history
      OpalIRB_prototype.$add_to_history = function(s) {
        
        this.history.$unshift(s);
        return this.historyi = -1;
      };

      // line 106, opal_irb, OpalIRB#add_to_saved
      OpalIRB_prototype.$add_to_saved = function(s) {
        
        this.saved = this.saved['$+']((function() { if (s['$[]'](__range(0, -1, true))['$==']("\\")) {
          return s['$[]'](__range(0, -1, true))
          } else {
          return s
        }; return nil; }).call(this));
        this.saved = this.saved['$+']("\n");
        return this.$add_to_history(s);
      };

      // line 113, opal_irb, OpalIRB#clear
      OpalIRB_prototype.$clear = function() {
        
        this.output['$html=']("");
        return nil;
      };

      // line 118, opal_irb, OpalIRB#process_saved
      OpalIRB_prototype.$process_saved = function() {
        var compiled = nil, value = nil, output = nil, e = nil, __a, __b;
        try {
        compiled = (__scope.Opal)._scope.Parser.$new().$parse(this.saved);
        this.$log(compiled);
        value = eval(compiled);
        __gvars["_"] = value;
        output = nodeutil.inspect( value, this.settings['$[]']("showHidden"), this.settings['$[]']("maxDepth"), this.settings['$[]']("colorize"));
        } catch ($err) {
        if (__scope.Exception['$===']($err)) {
        e = $err;if ((__a = e.$backtrace()) !== false && __a !== nil) {
          output = (__a = "FOR:\n" + (compiled) + "\n============\n", __b = e.$backtrace().$join("\n"), typeof(__a) === 'number' ? __a + __b : __a['$+'](__b))
          } else {
          output = e.toString()
        }}
        else { throw $err; }
        };
        this.saved = "";
        return this.$print(output);
      };

      // line 153, opal_irb, OpalIRB#help
      OpalIRB_prototype.$help = function() {
        var text = nil;
        text = [" ", "<strong>Features</strong>", "<strong>========</strong>", "+ <strong>Esc</strong> toggles multiline mode.", "+ <strong>Up/Down arrow</strong> flips through line history.", "+ Access the internals of this console through <strong>$irb</strong>.", "+ <strong>clear</strong> clears this console.", "+ <strong>history</strong> shows line history.", " ", "<strong>@Settings</strong>", "<strong>========</strong>", "You can modify the behavior of this IRB by altering <strong>$irb.@settings</strong>:", " ", "+ <strong>maxLines</strong> (" + (this.settings['$[]']("maxLines")) + "): max line count of this console", "+ <strong>maxDepth</strong> (" + (this.settings['$[]']("maxDepth")) + "): max depth in which to inspect outputted object", "+ <strong>showHidden</strong> (" + (this.settings['$[]']("showHidden")) + "): flag to output hidden (not enumerable) properties of objects", "+ <strong>colorize</strong> (" + (this.settings['$[]']("colorize")) + "): flag to colorize output (set to false if IRB is slow)", " ", " "].$join("\n");
        return this.$print(text);
      };

      // line 183, opal_irb, OpalIRB#log
      OpalIRB_prototype.$log = function(thing) {
        
        return console.log(thing);
      };

      // line 187, opal_irb, OpalIRB#history
      OpalIRB_prototype.$history = function() {
        var __a, __b;
        return (__b = this.history.$reverse(), __b.$each_with_index._p = (__a = function(line, i) {

          
          if (line == null) line = nil;
if (i == null) i = nil;

          return this.$print("" + (i) + ": " + (line))
        }, __a._s = this, __a), __b.$each_with_index());
      };

      // line 193, opal_irb, OpalIRB#handle_keypress
      OpalIRB_prototype.$handle_keypress = function(e) {
        var $case = nil, input = nil, __a, __b;
        this.$log(e.$which());
        return (function() { $case = e.$which();if ((13)['$===']($case)) {
        e.$prevent_default();
        input = this.input.$value();
        this.input['$value=']("");
        this.$print((__a = this.prompt.$html(), __b = this.$escape_html(input), typeof(__a) === 'number' ? __a + __b : __a['$+'](__b)));
        if (input !== false && input !== nil) {
          this.$add_to_saved(input);
          if ((__a = (__b = !input['$[]'](__range(0, -1, true))['$==']("\\"), __b !== false && __b !== nil ? !this.multiline : __b)) !== false && __a !== nil) {
            return this.$process_saved()
            } else {
            return nil
          };
          } else {
          return nil
        };
        }
        else if ((27)['$===']($case)) {
        e.$prevent_default();
        input = this.input.val();
        if ((__a = (__b = ((__b = input !== false && input !== nil) ? this.multiline : __b), __b !== false && __b !== nil ? this.saved : __b)) !== false && __a !== nil) {
          input = this.input.$value();
          this.input.$value("");
          this.$print((__a = this.prompt.$html(), __b = this.$escape_html(input), typeof(__a) === 'number' ? __a + __b : __a['$+'](__b)));
          this.$add_to_saved(input);
          this.$process_saved();
          } else {
          if ((__a = (__b = this.multiline, __b !== false && __b !== nil ? this.saved : __b)) !== false && __a !== nil) {
            this.$process_saved()
          }
        };
        this.multiline = !this.multiline;
        return this.$set_prompt();
        }
        else if ((38)['$===']($case)) {
        e.$prevent_default();
        if (this.historyi['$<']((__a = this.history.$length(), __b = 1, typeof(__a) === 'number' ? __a - __b : __a['$-'](__b)))) {
          this.historyi = this.historyi['$+'](1);
          return this.input['$value='](this.history['$[]'](this.historyi));
          } else {
          return nil
        };
        }
        else if ((40)['$===']($case)) {
        e.$prevent_default();
        if (this.historyi['$>'](0)) {
          this.historyi = this.historyi['$+'](-1);
          return this.input['$value='](this.history['$[]'](this.historyi));
          } else {
          return nil
        };
        }
        else {return nil} }).call(this);
      };

      // line 243, opal_irb, OpalIRB.init
      OpalIRB.$init = function() {
        var irb = nil, __a, __b, __c, __d, __e, __f;
        (__b = __gvars["input"], __b.$on._p = (__a = function() {

          
          
          return this.$scroll_to_bottom()
        }, __a._s = this, __a), __b.$on("keydown"));
        (__c = __scope.Element.$find(window), __c.$on._p = (__a = function(e) {

          
          if (e == null) e = nil;

          return this.$resize_input(e)
        }, __a._s = this, __a), __c.$on("resize"));
        (__d = __gvars["input"], __d.$on._p = (__a = function(e) {

          
          if (e == null) e = nil;

          return this.$resize_input(e)
        }, __a._s = this, __a), __d.$on("keyup"));
        (__e = __gvars["input"], __e.$on._p = (__a = function(e) {

          
          if (e == null) e = nil;

          return this.$resize_input(e)
        }, __a._s = this, __a), __e.$on("change"));
        (__f = __scope.Element.$find("html"), __f.$on._p = (__a = function(e) {

          
          if (e == null) e = nil;

          return __gvars["input"].$focus()
        }, __a._s = this, __a), __f.$on("click"));
        irb = __scope.OpalIRB.$new(__gvars["output"], __gvars["input"], __gvars["prompt"]);
        __gvars["irb"] = irb;
        this.$resize_input();
        __gvars["input"].$focus();
        return irb.$print(["# Opal v" + (__scope.OPAL_VERSION) + " IRB", "# <a href=\"https://github.com/fkchang/opal-irb\" target=\"_blank\">https://github.com/fkchang/opal-irb</a>", "# inspired by <a href=\"https://github.com/larryng/coffeescript-repl\" target=\"_blank\">https://github.com/larryng/coffeescript-repl</a>", "#", "# <strong>help</strong> for features and tips.", " "].$join("\n"));
      };
      ;OpalIRB._sdonate(["$reset_settings", "$save_settings", "$resize_input", "$scroll_to_bottom", "$init"]);
    })(this, null);
    def.$help = function() {
      
      __gvars["irb"].$help();
      return null;
    };
    def.$clear = function() {
      
      __gvars["irb"].$clear();
      return null;
    };
    def.$history = function() {
      
      __gvars["irb"].$history();
      return null;
    };
    return __scope.OpalIRB.$init();
  }, __a._s = self, __a), __b['$ready?']())
})();
