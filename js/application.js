(function(undefined) {
  // The Opal object that is exposed globally
  var Opal = this.Opal = {};

  // Very root class
  function BasicObject(){}

  // Core Object class
  function Object(){}

  // Class' class
  function Class(){}

  // the class of nil
  function NilClass(){}

  // TopScope is used for inheriting constants from the top scope
  var TopScope = function(){};

  // Opal just acts as the top scope
  TopScope.prototype = Opal;

  // To inherit scopes
  Opal.constructor  = TopScope;

  // This is a useful reference to global object inside ruby files
  Opal.global = this;

  // Minify common function calls
  var __hasOwn = Opal.hasOwnProperty;
  var __slice  = Opal.slice = Array.prototype.slice;

  // Generates unique id for every ruby object
  var unique_id = 0;

  // Return next unique id
  Opal.uid = function() {
    return unique_id++;
  };

  // Table holds all class variables
  Opal.cvars = {};

  // Globals table
  Opal.gvars = {};

  /*
   * Create a new constants scope for the given class with the given
   * base. Constants are looked up through their parents, so the base
   * scope will be the outer scope of the new klass.
   */
  function create_scope(base, klass, id) {
    var const_alloc   = function() {};
    var const_scope   = const_alloc.prototype = new base.constructor();
    klass._scope      = const_scope;
    const_scope.base  = klass;
    const_scope.constructor = const_alloc;

    if (id) {
      base[id] = base.constructor[id] = klass;
    }
  }

  /*
    Define a bridged class. Bridged classes will always be in the top level
    scope, and will always be a subclass of Object.
  */
  Opal.bridge = function(name, constructor) {
    var klass = bridge_class(constructor);

    klass._name = name;

    create_scope(Opal, klass, name);

    return klass;
  };

  Opal.klass = function(base, superklass, id, constructor) {
    var klass;
    if (typeof(base) !== 'function') {
      base = base._klass;
    }

    if (superklass === null) {
      superklass = Object;
    }

    if (__hasOwn.call(base._scope, id)) {
      klass = base._scope[id];
    }
    else {
      if (!superklass._methods) {
        var bridged = superklass;
        superklass  = Object;
        klass       = bridge_class(bridged);
      }
      else {
        klass = boot_class(superklass, constructor);
      }

      klass._name = (base === Object ? id : base._name + '::' + id);

      create_scope(base._scope, klass);

      base[id] = base._scope[id] = klass;

      if (superklass.$inherited) {
        superklass.$inherited(klass);
      }
    }

    return klass;
  };

  // Define new module (or return existing module)
  Opal.module = function(base, id, constructor) {
    var klass;
    if (typeof(base) !== 'function') {
      base = base._klass;
    }

    if (__hasOwn.call(base._scope, id)) {
      klass = base._scope[id];
    }
    else {
      klass = boot_class(Class, constructor);
      klass._name = (base === Object ? id : base._name + '::' + id);

      klass.$included_in = [];

      create_scope(base._scope, klass, id);
    }

    return klass;
  }

  // Utility function to raise a "no block given" error
  var no_block_given = function() {
    throw new Error('no block given');
  };

  // Boot a base class (makes instances).
  var boot_defclass = function(id, constructor, superklass) {
    if (superklass) {
      var ctor           = function() {};
          ctor.prototype = superklass.prototype;

      constructor.prototype = new ctor();
    }

    var prototype = constructor.prototype;

    prototype.constructor = constructor;
    prototype._klass      = constructor;

    constructor._inherited    = [];
    constructor._included_in  = [];
    constructor._name         = id;
    constructor._super        = superklass;
    constructor._methods      = [];
    constructor._smethods     = [];

    constructor['$==='] = module_eqq;
    constructor.$to_s = module_to_s;
    constructor.toString = module_to_s;

    Opal[id] = constructor;

    return constructor;
  };

  // Create generic class with given superclass.
  var boot_class = Opal.boot = function(superklass, constructor) {
    var ctor = function() {};
        ctor.prototype = superklass.prototype;

    constructor.prototype = new ctor();
    var prototype = constructor.prototype;

    prototype._klass      = constructor;
    prototype.constructor = constructor;

    constructor._inherited    = [];
    constructor._included_in  = [];
    constructor._super        = superklass;
    constructor._methods      = [];
    constructor._klass        = Class;

    constructor['$==='] = module_eqq;
    constructor.$to_s = module_to_s;
    constructor.toString = module_to_s;

    constructor['$[]'] = undefined;
    constructor['$call'] = undefined;

    var smethods;

    smethods = superklass._smethods.slice();

    constructor._smethods = smethods;
    for (var i = 0, length = smethods.length; i < length; i++) {
      var m = smethods[i];
      constructor[m] = superklass[m];
    }

    superklass._inherited.push(constructor);

    return constructor;
  };

  var bridge_class = function(constructor) {
    constructor.prototype._klass = constructor;

    constructor._inherited    = [];
    constructor._included_in  = [];
    constructor._super        = Object;
    constructor._klass        = Class;
    constructor._methods      = [];
    constructor._smethods     = [];

    constructor['$==='] = module_eqq;
    constructor.$to_s = module_to_s;
    constructor.toString = module_to_s;

    var smethods = constructor._smethods = Class._methods.slice();
    for (var i = 0, length = smethods.length; i < length; i++) {
      var m = smethods[i];
      constructor[m] = Object[m];
    }

    bridged_classes.push(constructor);

    var table = Object.prototype, methods = Object._methods;

    for (var i = 0, length = methods.length; i < length; i++) {
      var m = methods[i];
      constructor.prototype[m] = table[m];
    }

    constructor._smethods.push('$allocate');

    return constructor;
  };

  Opal.puts = function(a) { console.log(a); };

  // Method missing dispatcher
  Opal.mm = function(mid) {
    var dispatcher = function() {
      var args = __slice.call(arguments);

      if (this.$method_missing) {
        this.$method_missing._p = dispatcher._p;
        return this.$method_missing.apply(this, [mid].concat(args));
      }
      else {
        return native_send(this, mid, args);
      }
    };

    return dispatcher;
  };

  // send a method to a native object
  var native_send = function(obj, mid, args) {
    var prop, block = native_send._p;
    native_send._p = null;

    if (prop = native_methods[mid]) {
      return prop(obj, args, block);
    }

    prop = obj[mid];

    if (typeof(prop) === "function") {
      prop = prop.apply(obj, args.$to_native());
    }
    else if (mid.charAt(mid.length - 1) === "=") {
      prop = mid.slice(0, mid.length - 1);
      return obj[prop] = args[0];
    }

    if (prop != null) {
      return prop;
    }

    return nil;
  };

  var native_methods = {
    "==": function(obj, args) {
      return obj === args[0];
    },

    "[]": function(obj, args) {
      var prop = obj[args[0]];

      if (prop != null) {
        return prop;
      }

      return nil;
    },

    "respond_to?": function(obj, args) {
      return obj[args[0]] != null;
    },

    "each": function(obj, args, block) {
      var prop;

      if (obj.length === +obj.length) {
        for (var i = 0, len = obj.length; i < len; i++) {
          prop = obj[i];

          if (prop == null) {
            prop = nil;
          }

          block(prop);
        }
      }
      else {
        for (var key in obj) {
          prop = obj[key];

          if (prop == null) {
            prop = nil;
          }

          block(key, prop);
        }
      }

      return obj;
    },

    "to_a": function(obj, args) {
      var result = [];

      for (var i = 0, length = obj.length; i < length; i++) {
        result.push(obj[i]);
      }

      return result;
    }
  };

  // Const missing dispatcher
  Opal.cm = function(name) {
    return this.base.$const_missing(name);
  };

  // Arity count error dispatcher
  Opal.ac = function(actual, expected, object, meth) {
    var inspect = ((typeof(object) !== 'function') ? object._klass._name + '#' : object._name + '.') + meth;
    var msg = '[' + inspect + '] wrong number of arguments(' + actual + ' for ' + expected + ')'
    throw Opal.ArgumentError.$new(msg);
  };

  /*
    Call a ruby method on a ruby object with some arguments:

      var my_array = [1, 2, 3, 4]
      Opal.send(my_array, 'length')     # => 4
      Opal.send(my_array, 'reverse!')   # => [4, 3, 2, 1]

    A missing method will be forwarded to the object via
    method_missing.

    The result of either call with be returned.

    @param [Object] recv the ruby object
    @param [String] mid ruby method to call
  */
  Opal.send = function(recv, mid) {
    var args = __slice.call(arguments, 2),
        func = recv['$' + mid];

    if (func) {
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  // Implementation of Class#===
  function module_eqq(object) {
    if (object == null) {
      return false;
    }

    var search = object._klass;

    while (search) {
      if (search === this) {
        return true;
      }

      search = search._super;
    }

    return false;
  }

  // Implementation of Class#to_s
  function module_to_s() {
    return this._name;
  }

  /**
   * Donate methods for a class/module
   */
  Opal.donate = function(klass, defined, indirect) {
    var methods = klass._methods, included_in = klass.$included_in;

    // if (!indirect) {
      klass._methods = methods.concat(defined);
    // }

    if (included_in) {
      for (var i = 0, length = included_in.length; i < length; i++) {
        var includee = included_in[i];
        var dest = includee.prototype;

        for (var j = 0, jj = defined.length; j < jj; j++) {
          var method = defined[j];
          dest[method] = klass.prototype[method];
        }

        if (includee.$included_in) {
          Opal.donate(includee, defined, true);
        }
      }
    }
  };

  /*
    Define a singleton method on the given klass

        Opal.defs(Array, '$foo', function() {})

    @param [Function] klass
    @param [String] mid the method_id
    @param [Function] body function body
  */
  Opal.defs = function(klass, mid, body) {
    klass._smethods.push(mid);
    klass[mid] = body;

    var inherited = klass._inherited;
    if (inherited.length) {
      for (var i = 0, length = inherited.length, subclass; i < length; i++) {
        subclass = inherited[i];
        if (!subclass[mid]) {
          Opal.defs(subclass, mid, body);
        }
      }
    }
  };

  // Defines methods onto Object (which are then donated to bridged classes)
  Object._defn = function (mid, body) {
    this.prototype[mid] = body;
    Opal.donate(this, [mid]);
  };

  // Initialization
  // --------------

  boot_defclass('BasicObject', BasicObject)
  boot_defclass('Object', Object, BasicObject);
  boot_defclass('Class', Class, Object);

  Class.prototype = Function.prototype;

  BasicObject._klass = Object._klass = Class._klass = Class;


  var bridged_classes = Object.$included_in = [];

  Opal.base = Object;
  BasicObject._scope = Object._scope = Opal;
  Opal.Module = Opal.Class;
  Opal.Kernel = Object;

  create_scope(Opal, Class);

  Object.prototype.toString = function() {
    return this.$to_s();
  };

  Opal.top = new Object;

  Opal.klass(Object, Object, 'NilClass', NilClass)
  var nil = Opal.nil = new NilClass;
  nil.call = nil.apply = function() { throw Opal.LocalJumpError.$new('no block given'); };

  Opal.breaker  = new Error('unexpected break');

  Opal.bridge('Array', Array);
  Opal.bridge('Boolean', Boolean);
  Opal.bridge('Numeric', Number);
  Opal.bridge('String', String);
  Opal.bridge('Proc', Function);
  Opal.bridge('Exception', Error);
  Opal.bridge('Regexp', RegExp);
  Opal.bridge('Time', Date);
}).call(this);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Class() {};
    Class = __klass(__base, __super, "Class", Class);

    var def = Class.prototype, __scope = Class._scope, TMP_1, TMP_2, TMP_3, TMP_4;

    __opal.defs(Class, '$new', TMP_1 = function(sup) {
      var $a, block;
      block = TMP_1._p || nil, TMP_1._p = null;
      if (sup == null) {
        sup = (($a = __scope.Object) == null ? __opal.cm("Object") : $a)
      }
      
      function AnonClass(){};
      var klass   = Opal.boot(sup, AnonClass)
      klass._name = nil;
      klass._scope = sup._scope;

      sup.$inherited(klass);

      if (block !== nil) {
        var block_self = block._s;
        block._s = null;
        block.call(klass);
        block._s = block_self;
      }

      return klass;
    
    });

    def.$allocate = function() {
      
      
      var obj = new this;
      obj._id = Opal.uid();
      return obj;
    
    };

    def.$alias_method = function(newname, oldname) {
      
      this.prototype['$' + newname] = this.prototype['$' + oldname];
      return this;
    };

    def.$ancestors = function() {
      
      
      var parent = this,
          result = [];

      while (parent) {
        result.push(parent);
        parent = parent._super;
      }

      return result;
    
    };

    def.$append_features = function(klass) {
      
      
      var module = this;

      if (!klass.$included_modules) {
        klass.$included_modules = [];
      }

      for (var idx = 0, length = klass.$included_modules.length; idx < length; idx++) {
        if (klass.$included_modules[idx] === module) {
          return;
        }
      }

      klass.$included_modules.push(module);

      if (!module.$included_in) {
        module.$included_in = [];
      }

      module.$included_in.push(klass);

      var donator   = module.prototype,
          prototype = klass.prototype,
          methods   = module._methods;

      for (var i = 0, length = methods.length; i < length; i++) {
        var method = methods[i];
        prototype[method] = donator[method];
      }

      if (prototype._smethods) {
        prototype._smethods.push.apply(prototype._smethods, methods);  
      }

      if (klass.$included_in) {
        __opal.donate(klass, methods.slice(), true);
      }
    
      return this;
    };

    def.$attr_accessor = function(names) {
      var $a, $b;names = __slice.call(arguments, 0);
      (($a = this).$attr_reader || $mm('attr_reader')).apply($a, [].concat(names));
      return (($b = this).$attr_writer || $mm('attr_writer')).apply($b, [].concat(names));
    };

    def.$attr_reader = function(names) {
      names = __slice.call(arguments, 0);
      
      var proto = this.prototype, cls = this;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function() { return this[name] };

          if (cls._isSingleton) {
            __opal.defs(proto, '$' + name, func);
          }
          else {
            proto['$' + name] = func;
          }
        })(names[i]);
      }
    
      return nil;
    };

    def.$attr_writer = function(names) {
      names = __slice.call(arguments, 0);
      
      var proto = this.prototype, cls = this;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function(value) { return this[name] = value; };

          if (cls._isSingleton) {
            __opal.defs(proto, '$' + name + '=', func);
          }
          else {
            proto['$' + name + '='] = func;
          }
        })(names[i]);
      }
    
      return nil;
    };

    def.$attr = def.$attr_accessor;

    def.$constants = function() {
      
      
      var result = [];
      var name_re = /^[A-Z][A-Za-z0-9_]+$/;
      var scopes = [this._scope];
      var own_only;
      if (this === Opal.Class) {
        own_only = false;
      }
      else {
        own_only = true;
        var parent = this._super;
        while (parent !== Opal.Object) {
          scopes.push(parent._scope);
          parent = parent._super;
        }
      }
      for (var i = 0, len = scopes.length; i < len; i++) {
        var scope = scopes[i]; 
        for (name in scope) {
          if ((!own_only || scope.hasOwnProperty(name)) && name_re.test(name)) {
            result.push(name);
          }
        }
      }

      return result;
    
    };

    def['$const_defined?'] = function(name, inherit) {
      var $a, $b, $c;if (inherit == null) {
        inherit = true
      }
      if (($a = (($b = name)['$=~'] || $mm('=~')).call($b, /^[A-Z]\w+$/)) === false || $a === nil) {
        (($a = this).$raise || $mm('raise')).call($a, (($c = __scope.NameError) == null ? __opal.cm("NameError") : $c), "wrong constant name " + (name))
      };
      
      scopes = [this._scope];
      if (inherit || this === Opal.Object) {
        var parent = this._super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent._scope);
          parent = parent._super;
        }
      }

      for (var i = 0, len = scopes.length; i < len; i++) {
        if (scopes[i].hasOwnProperty(name)) {
          return true;
        }
      }

      return false;
    
    };

    def.$const_get = function(name, inherit) {
      var $a, $b, $c;if (inherit == null) {
        inherit = true
      }
      if (($a = (($b = name)['$=~'] || $mm('=~')).call($b, /^[A-Z]\w+$/)) === false || $a === nil) {
        (($a = this).$raise || $mm('raise')).call($a, (($c = __scope.NameError) == null ? __opal.cm("NameError") : $c), "wrong constant name " + (name))
      };
      
      var scopes = [this._scope];
      if (inherit || this == Opal.Object) {
        var parent = this._super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent._scope);
          parent = parent._super;
        }
      }

      for (var i = 0, len = scopes.length; i < len; i++) {
        if (scopes[i].hasOwnProperty(name)) {
          return scopes[i][name];
        }
       }
 
      return (($c = this).$const_missing || $mm('const_missing')).call($c, name);
    
    };

    def.$const_missing = function(const$) {
      var name = nil, $a, $b;
      name = this._name;
      return (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.NameError) == null ? __opal.cm("NameError") : $b), "uninitialized constant " + (name) + "::" + (const$));
    };

    def.$const_set = function(name, value) {
      var $a, $b, $c, $d, $e;
      if (($a = (($b = name)['$=~'] || $mm('=~')).call($b, /^[A-Z]\w+$/)) === false || $a === nil) {
        (($a = this).$raise || $mm('raise')).call($a, (($c = __scope.NameError) == null ? __opal.cm("NameError") : $c), "wrong constant name " + (name))
      };
      try {
        name = (($c = name).$to_str || $mm('to_str')).call($c)
      } catch ($err) {
      if (true) {
        (($d = this).$raise || $mm('raise')).call($d, (($e = __scope.TypeError) == null ? __opal.cm("TypeError") : $e), "conversion with #to_str failed")}
      else { throw $err; }
      };
      
      this._scope[name] = value;
      return value
    
    };

    def.$define_method = TMP_2 = function(name, method) {
      var block;
      block = TMP_2._p || nil, TMP_2._p = null;
      
      
      if (method) {
        block = method;
      }

      if (block === nil) {
        no_block_given();
      }

      var jsid    = '$' + name;
      block._jsid = jsid;
      block._sup  = this.prototype[jsid];
      block._s    = null;

      this.prototype[jsid] = block;
      __opal.donate(this, [jsid]);

      return nil;
    
    };

    def.$include = function(mods) {
      var $a, $b;mods = __slice.call(arguments, 0);
      
      var i = mods.length - 1, mod;
      while (i >= 0) {
        mod = mods[i];
        i--;

        if (mod === this) {
          continue;
        }

        (($a = (mod)).$append_features || $mm('append_features')).call($a, this);
        (($b = (mod)).$included || $mm('included')).call($b, this);
      }

      return this;
    
    };

    def.$instance_methods = function(include_super) {
      if (include_super == null) {
        include_super = false
      }
      
      var methods = [], proto = this.prototype;

      for (var prop in this.prototype) {
        if (!include_super && !proto.hasOwnProperty(prop)) {
          continue;
        }

        if (prop.charAt(0) === '$') {
          methods.push(prop.substr(1));
        }
      }

      return methods;
    
    };

    def.$included = function(mod) {
      
      return nil;
    };

    def.$inherited = function(cls) {
      
      return nil;
    };

    def.$module_eval = TMP_3 = function() {
      var block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      
      if (block === nil) {
        no_block_given();
      }

      var block_self = block._s, result;

      block._s = null;
      result = block.call(this);
      block._s = block_self;

      return result;
    
    };

    def.$class_eval = def.$module_eval;

    def['$method_defined?'] = function(method) {
      
      
      if (typeof(this.prototype['$' + method]) === 'function') {
        return true;
      }

      return false;
    
    };

    def.$module_function = function(methods) {
      methods = __slice.call(arguments, 0);
      
      for (var i = 0, length = methods.length; i < length; i++) {
        var meth = methods[i], func = this.prototype['$' + meth];

        this['$' + meth] = func;
      }

      return this;
    
    };

    def.$name = function() {
      
      return this._name;
    };

    def.$new = TMP_4 = function(args) {
      var block;
      block = TMP_4._p || nil, TMP_4._p = null;
      args = __slice.call(arguments, 0);
      
      if (this.prototype.$initialize) {
        var obj = new this;
        obj._id = Opal.uid();

        obj.$initialize._p = block;
        obj.$initialize.apply(obj, args);
        return obj;
      }
      else {
        var cons = function() {};
        cons.prototype = this.prototype;
        var obj = new cons;
        this.apply(obj, args);
        return obj;
      }
    
    };

    def.$public = function() {
      
      return nil;
    };

    def.$private = def.$public;

    def.$protected = def.$public;

    def.$superclass = function() {
      
      return this._super || nil;
    };

    def.$undef_method = function(symbol) {
      
      this.prototype['$' + symbol] = undefined;
      return this;
    };

    return nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function BasicObject() {};
    BasicObject = __klass(__base, __super, "BasicObject", BasicObject);

    var def = BasicObject.prototype, __scope = BasicObject._scope, TMP_1, TMP_2, TMP_3, TMP_4;

    def.$initialize = function() {
      
      return nil;
    };

    def['$=='] = function(other) {
      
      return this === other;
    };

    def.$__send__ = TMP_1 = function(symbol, args) {
      var block;
      block = TMP_1._p || nil, TMP_1._p = null;
      args = __slice.call(arguments, 1);
      
      var func = this['$' + symbol]

      if (func) {
        if (block !== nil) { func._p = block; }
        return func.apply(this, args);
      }

      if (block !== nil) { this.$method_missing._p = block; }
      return this.$method_missing.apply(this, [symbol].concat(args));
    
    };

    def['$eql?'] = def['$=='];

    def['$equal?'] = def['$=='];

    def.$instance_eval = TMP_2 = function() {
      var block;
      block = TMP_2._p || nil, TMP_2._p = null;
      
      
      if (block === nil) {
        no_block_given();
      }

      var block_self = block._s, result;

      block._s = null;
      result = block.call(this, this);
      block._s = block_self;

      return result;
    
    };

    def.$instance_exec = TMP_3 = function(args) {
      var block;
      block = TMP_3._p || nil, TMP_3._p = null;
      args = __slice.call(arguments, 0);
      
      if (block === nil) {
        no_block_given();
      }

      var block_self = block._s, result;

      block._s = null;
      result = block.apply(this, args);
      block._s = block_self;

      return result;
    
    };

    def.$method_missing = TMP_4 = function(symbol, args) {
      var $a, $b, block;
      block = TMP_4._p || nil, TMP_4._p = null;
      args = __slice.call(arguments, 1);
      return (($a = (($b = __scope.Kernel) == null ? __opal.cm("Kernel") : $b)).$raise || $mm('raise')).call($a, (($b = __scope.NoMethodError) == null ? __opal.cm("NoMethodError") : $b), "undefined method `" + (symbol) + "' for BasicObject instance");
    };

    return nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module;
  return (function(__base){
    function Kernel() {};
    Kernel = __module(__base, "Kernel", Kernel);
    var def = Kernel.prototype, __scope = Kernel._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;

    def.$initialize = def.$initialize;

    def['$=='] = def['$=='];

    def.$__send__ = def.$__send__;

    def['$eql?'] = def['$eql?'];

    def['$equal?'] = def['$equal?'];

    def.$instance_eval = def.$instance_eval;

    def.$instance_exec = def.$instance_exec;

    def.$method_missing = TMP_1 = function(symbol, args) {
      var $a, $b, block;
      block = TMP_1._p || nil, TMP_1._p = null;
      args = __slice.call(arguments, 1);
      return (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.NoMethodError) == null ? __opal.cm("NoMethodError") : $b), "undefined method `" + (symbol) + "' for " + ((($b = this).$inspect || $mm('inspect')).call($b)));
    };

    def['$=~'] = function(obj) {
      
      return false;
    };

    def['$==='] = function(other) {
      
      return this == other;
    };

    def.$as_json = function() {
      
      return nil;
    };

    def.$method = function(name) {
      var $a, $b;
      
      var recv = this,
          meth = recv['$' + name],
          func = function() {
            return meth.apply(recv, __slice.call(arguments, 0));
          };

      if (!meth) {
        (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.NameError) == null ? __opal.cm("NameError") : $b));
      }

      func._klass = (($b = __scope.Method) == null ? __opal.cm("Method") : $b);
      return func;
    
    };

    def.$methods = function(all) {
      if (all == null) {
        all = true
      }
      
      var methods = [];
      for(var k in this) {
        if(k[0] == "$" && typeof (this)[k] === "function") {
          if(all === false || all === nil) {
            if(!Object.hasOwnProperty.call(this, k)) {
              continue;
            }
          }
          methods.push(k.substr(1));
        }
      }
      return methods;
    
    };

    def.$Array = function(object) {
      var $a, $b;
      
      if (object.$to_ary) {
        return (($a = object).$to_ary || $mm('to_ary')).call($a);
      }
      else if (object.$to_a) {
        return (($b = object).$to_a || $mm('to_a')).call($b);
      }

      return [object];
    
    };

    def.$class = function() {
      
      return this._klass;
    };

    def.$define_singleton_method = TMP_2 = function(name) {
      var body;
      body = TMP_2._p || nil, TMP_2._p = null;
      
      
      if (body === nil) {
        no_block_given();
      }

      var jsid   = '$' + name;
      body._jsid = jsid;
      body._sup  = this[jsid];
      body._s    = null;

      this[jsid] = body;

      return this;
    
    };

    def.$dup = function() {
      var $a, $b;
      return (($a = (($b = this).$class || $mm('class')).call($b)).$allocate || $mm('allocate')).call($a);
    };

    def.$enum_for = function(method, args) {
      var $a, $b;if (method == null) {
        method = "each"
      }args = __slice.call(arguments, 1);
      return (($a = (($b = __scope.Enumerator) == null ? __opal.cm("Enumerator") : $b)).$new || $mm('new')).apply($a, [this, method].concat(args));
    };

    def['$equal?'] = function(other) {
      
      return this === other;
    };

    def.$extend = function(mods) {
      var $a, $b;mods = __slice.call(arguments, 0);
      
      for (var i = 0, length = mods.length; i < length; i++) {
        (($a = (($b = this).$singleton_class || $mm('singleton_class')).call($b)).$include || $mm('include')).call($a, mods[i]);
      }

      return this;
    
    };

    def.$format = function(format, args) {
      var $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n;args = __slice.call(arguments, 1);
      
      var idx = 0;
      return format.replace(/%(\d+\$)?([-+ 0]*)(\d*|\*(\d+\$)?)(?:\.(\d*|\*(\d+\$)?))?([cspdiubBoxXfgeEG])|(%%)/g, function(str, idx_str, flags, width_str, w_idx_str, prec_str, p_idx_str, spec, escaped) {
        if (escaped) {
          return '%';
        }

        var width,
        prec,
        is_integer_spec = ("diubBoxX".indexOf(spec) != -1),
        is_float_spec = ("eEfgG".indexOf(spec) != -1),
        prefix = '',
        obj;

        if (width_str === undefined) {
          width = undefined;
        } else if (width_str.charAt(0) == '*') {
          var w_idx = idx++;
          if (w_idx_str) {
            w_idx = parseInt(w_idx_str, 10) - 1;
          }
          width = (($a = (args[w_idx])).$to_i || $mm('to_i')).call($a);
        } else {
          width = parseInt(width_str, 10);
        }
        if (!prec_str) {
          prec = is_float_spec ? 6 : undefined;
        } else if (prec_str.charAt(0) == '*') {
          var p_idx = idx++;
          if (p_idx_str) {
            p_idx = parseInt(p_idx_str, 10) - 1;
          }
          prec = (($b = (args[p_idx])).$to_i || $mm('to_i')).call($b);
        } else {
          prec = parseInt(prec_str, 10);
        }
        if (idx_str) {
          idx = parseInt(idx_str, 10) - 1;
        }
        switch (spec) {
        case 'c':
          obj = args[idx];
          if (obj._isString) {
            str = obj.charAt(0);
          } else {
            str = String.fromCharCode((($c = (obj)).$to_i || $mm('to_i')).call($c));
          }
          break;
        case 's':
          str = (($d = (args[idx])).$to_s || $mm('to_s')).call($d);
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'p':
          str = (($e = (args[idx])).$inspect || $mm('inspect')).call($e);
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'd':
        case 'i':
        case 'u':
          str = (($f = (args[idx])).$to_i || $mm('to_i')).call($f).toString();
          break;
        case 'b':
        case 'B':
          str = (($g = (args[idx])).$to_i || $mm('to_i')).call($g).toString(2);
          break;
        case 'o':
          str = (($h = (args[idx])).$to_i || $mm('to_i')).call($h).toString(8);
          break;
        case 'x':
        case 'X':
          str = (($i = (args[idx])).$to_i || $mm('to_i')).call($i).toString(16);
          break;
        case 'e':
        case 'E':
          str = (($j = (args[idx])).$to_f || $mm('to_f')).call($j).toExponential(prec);
          break;
        case 'f':
          str = (($k = (args[idx])).$to_f || $mm('to_f')).call($k).toFixed(prec);
          break;
        case 'g':
        case 'G':
          str = (($l = (args[idx])).$to_f || $mm('to_f')).call($l).toPrecision(prec);
          break;
        }
        idx++;
        if (is_integer_spec || is_float_spec) {
          if (str.charAt(0) == '-') {
            prefix = '-';
            str = str.substr(1);
          } else {
            if (flags.indexOf('+') != -1) {
              prefix = '+';
            } else if (flags.indexOf(' ') != -1) {
              prefix = ' ';
            }
          }
        }
        if (is_integer_spec && prec !== undefined) {
          if (str.length < prec) {
            str = ($m = "0", $n = prec - str.length, typeof($m) === 'number' ? $m * $n : $m['$*']($n)) + str;
          }
        }
        var total_len = prefix.length + str.length;
        if (width !== undefined && total_len < width) {
          if (flags.indexOf('-') != -1) {
            str = str + ($m = " ", $n = width - total_len, typeof($m) === 'number' ? $m * $n : $m['$*']($n));
          } else {
            var pad_char = ' ';
            if (flags.indexOf('0') != -1) {
              str = ($m = "0", $n = width - total_len, typeof($m) === 'number' ? $m * $n : $m['$*']($n)) + str;
            } else {
              prefix = ($m = " ", $n = width - total_len, typeof($m) === 'number' ? $m * $n : $m['$*']($n)) + prefix;
            }
          }
        }
        var result = prefix + str;
        if ('XEG'.indexOf(spec) != -1) {
          result = result.toUpperCase();
        }
        return result;
      });
    
    };

    def.$hash = function() {
      
      return this._id;
    };

    def.$inspect = function() {
      var $a;
      return (($a = this).$to_s || $mm('to_s')).call($a);
    };

    def['$instance_of?'] = function(klass) {
      
      return this._klass === klass;
    };

    def['$instance_variable_defined?'] = function(name) {
      
      return __hasOwn.call(this, name.substr(1));
    };

    def.$instance_variable_get = function(name) {
      
      
      var ivar = this[name.substr(1)];

      return ivar == null ? nil : ivar;
    
    };

    def.$instance_variable_set = function(name, value) {
      
      return this[name.substr(1)] = value;
    };

    def.$instance_variables = function() {
      
      
      var result = [];

      for (var name in this) {
        if (name.charAt(0) !== '$') {
          result.push(name);
        }
      }

      return result;
    
    };

    def['$is_a?'] = function(klass) {
      
      
      var search = this._klass;

      while (search) {
        if (search === klass) {
          return true;
        }

        search = search._super;
      }

      return false;
    
    };

    def['$kind_of?'] = def['$is_a?'];

    def.$lambda = TMP_3 = function() {
      var block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      return block;
    };

    def.$loop = TMP_4 = function() {
      var block;
      block = TMP_4._p || nil, TMP_4._p = null;
      
      while (true) {;
      if (block.call(null) === __breaker) return __breaker.$v;
      };
      return this;
    };

    def['$nil?'] = function() {
      
      return false;
    };

    def.$object_id = function() {
      
      return this._id || (this._id = Opal.uid());
    };

    def.$printf = function(args) {
      var fmt = nil, $a, $b, $c, $d, $e;args = __slice.call(arguments, 0);
      if ((($a = (($b = args).$length || $mm('length')).call($b))['$>'] || $mm('>')).call($a, 0)) {
        fmt = (($c = args).$shift || $mm('shift')).call($c);
        (($d = this).$print || $mm('print')).call($d, (($e = this).$format || $mm('format')).apply($e, [fmt].concat(args)));
      };
      return nil;
    };

    def.$proc = TMP_5 = function() {
      var $a, $b, block;
      block = TMP_5._p || nil, TMP_5._p = null;
      
      
      if (block === nil) {
        (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.ArgumentError) == null ? __opal.cm("ArgumentError") : $b), "no block given");
      }
      block.is_lambda = false;
      return block;
    
    };

    def.$puts = function(strs) {
      var $a, $b;strs = __slice.call(arguments, 0);
      
      for (var i = 0; i < strs.length; i++) {
        if(strs[i] instanceof Array) {
          (($a = this).$puts || $mm('puts')).apply($a, [].concat((strs[i])))
        } else {
          __opal.puts((($b = (strs[i])).$to_s || $mm('to_s')).call($b));
        }
      }
    
      return nil;
    };

    def.$p = function(args) {
      var $a, $b, $c;args = __slice.call(arguments, 0);
      console.log.apply(console, args);
      if ((($a = (($b = args).$length || $mm('length')).call($b))['$<='] || $mm('<=')).call($a, 1)) {
        return (($c = args)['$[]'] || $mm('[]')).call($c, 0)
        } else {
        return args
      };
    };

    def.$print = def.$puts;

    def.$raise = function(exception, string) {
      var $a, $b, $c;if (exception == null) {
        exception = ""
      }
      
      if (typeof(exception) === 'string') {
        exception = (($a = (($b = __scope.RuntimeError) == null ? __opal.cm("RuntimeError") : $b)).$new || $mm('new')).call($a, exception);
      }
      else if (!(($b = exception)['$is_a?'] || $mm('is_a?')).call($b, (($c = __scope.Exception) == null ? __opal.cm("Exception") : $c))) {
        exception = (($c = exception).$new || $mm('new')).call($c, string);
      }

      throw exception;
    
    };

    def.$rand = function(max) {
      
      return max == null ? Math.random() : Math.floor(Math.random() * max);
    };

    def['$respond_to?'] = function(name) {
      
      return !!this['$' + name];
    };

    def.$send = def.$__send__;

    def.$singleton_class = function() {
      
      
      if (typeof(this) === 'function') {
        if (this._singleton) {
          return this._singleton;
        }

        var meta = new __opal.Class;
        meta._klass = __opal.Class;
        this._singleton = meta;
        meta.prototype = this;
        meta._isSingleton = true;

        return meta;
      }

      if (typeof(this) === 'function') {
        return this._klass;
      }

      if (this._singleton) {
        return this._singleton;
      }

      else {
        var orig_class = this._klass,
            class_id   = "#<Class:#<" + orig_class._name + ":" + orig_class._id + ">>";

        var Singleton = function () {};
        var meta = Opal.boot(orig_class, Singleton);
        meta._name = class_id;

        meta.prototype = this;
        this._singleton = meta;
        meta._klass = orig_class._klass;

        return meta;
      }
    
    };

    def.$sprintf = def.$format;

    def.$String = function(str) {
      
      return String(str);
    };

    def.$tap = TMP_6 = function() {
      var block;
      block = TMP_6._p || nil, TMP_6._p = null;
      
      if (block.call(null, this) === __breaker) return __breaker.$v;
      return this;
    };

    def.$to_json = function() {
      var $a, $b;
      return (($a = (($b = this).$to_s || $mm('to_s')).call($b)).$to_json || $mm('to_json')).call($a);
    };

    def.$to_proc = function() {
      
      return this;
    };

    def.$to_s = function() {
      
      return "#<" + this._klass._name + ":" + this._id + ">";
    };
        ;__opal.donate(Kernel, ["$initialize", "$==", "$__send__", "$eql?", "$equal?", "$instance_eval", "$instance_exec", "$method_missing", "$=~", "$===", "$as_json", "$method", "$methods", "$Array", "$class", "$define_singleton_method", "$dup", "$enum_for", "$equal?", "$extend", "$format", "$hash", "$inspect", "$instance_of?", "$instance_variable_defined?", "$instance_variable_get", "$instance_variable_set", "$instance_variables", "$is_a?", "$kind_of?", "$lambda", "$loop", "$nil?", "$object_id", "$printf", "$proc", "$puts", "$p", "$print", "$raise", "$rand", "$respond_to?", "$send", "$singleton_class", "$sprintf", "$String", "$tap", "$to_json", "$to_proc", "$to_s"]);
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function NilClass() {};
    NilClass = __klass(__base, __super, "NilClass", NilClass);

    var def = NilClass.prototype, __scope = NilClass._scope;

    def['$&'] = function(other) {
      
      return false;
    };

    def['$|'] = function(other) {
      
      return other !== false && other !== nil;
    };

    def['$^'] = function(other) {
      
      return other !== false && other !== nil;
    };

    def['$=='] = function(other) {
      
      return other === nil;
    };

    def.$as_json = function() {
      
      return this;
    };

    def.$dup = function() {
      var $a, $b;
      return (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.TypeError) == null ? __opal.cm("TypeError") : $b));
    };

    def.$inspect = function() {
      
      return "nil";
    };

    def['$nil?'] = function() {
      
      return true;
    };

    def.$singleton_class = function() {
      var $a;
      return (($a = __scope.NilClass) == null ? __opal.cm("NilClass") : $a);
    };

    def.$to_a = function() {
      
      return [];
    };

    def.$to_h = function() {
      
      return __opal.hash();
    };

    def.$to_i = function() {
      
      return 0;
    };

    def.$to_f = def.$to_i;

    def.$to_json = function() {
      
      return "null";
    };

    def.$to_native = function() {
      
      return null;
    };

    def.$to_s = function() {
      
      return "";
    };

    return nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var $a, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  (function(__base, __super){
    function Boolean() {};
    Boolean = __klass(__base, __super, "Boolean", Boolean);

    var def = Boolean.prototype, __scope = Boolean._scope;

    def._isBoolean = true;

    def['$&'] = function(other) {
      
      return (this == true) ? (other !== false && other !== nil) : false;
    };

    def['$|'] = function(other) {
      
      return (this == true) ? true : (other !== false && other !== nil);
    };

    def['$^'] = function(other) {
      
      return (this == true) ? (other === false || other === nil) : (other !== false && other !== nil);
    };

    def['$=='] = function(other) {
      
      return (this == true) === other.valueOf();
    };

    def.$as_json = function() {
      
      return this;
    };

    def.$singleton_class = def.$class;

    def.$to_json = function() {
      
      return (this == true) ? 'true' : 'false';
    };

    def.$to_s = function() {
      
      return (this == true) ? 'true' : 'false';
    };

    return nil;
  })(self, null);
  __scope.TrueClass = (($a = __scope.Boolean) == null ? __opal.cm("Boolean") : $a);
  return __scope.FalseClass = (($a = __scope.Boolean) == null ? __opal.cm("Boolean") : $a);
})(Opal);
(function(__opal) {
  var $a, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  (function(__base, __super){
    function Exception() {};
    Exception = __klass(__base, __super, "Exception", Exception);

    var def = Exception.prototype, __scope = Exception._scope;
    def.message = nil;

    def.$message = function() {
      
      return this.message
    }, nil;

    __opal.defs(Exception, '$new', function(message) {
      if (message == null) {
        message = ""
      }
      
      var err = new Error(message);
      err._klass = this;
      err.name = this._name;
      return err;
    
    });

    def.$backtrace = function() {
      
      
      var backtrace = this.stack;

      if (typeof(backtrace) === 'string') {
        return backtrace.split("\n").slice(0, 15);
      }
      else if (backtrace) {
        return backtrace.slice(0, 15);
      }

      return [];
    
    };

    def.$inspect = function() {
      var $a, $b;
      return "#<" + ((($a = (($b = this).$class || $mm('class')).call($b)).$name || $mm('name')).call($a)) + ": '" + (this.message) + "'>";
    };

    return def.$to_s = def.$message;
  })(self, null);
  (function(__base, __super){
    function StandardError() {};
    StandardError = __klass(__base, __super, "StandardError", StandardError);

    var def = StandardError.prototype, __scope = StandardError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function RuntimeError() {};
    RuntimeError = __klass(__base, __super, "RuntimeError", RuntimeError);

    var def = RuntimeError.prototype, __scope = RuntimeError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function LocalJumpError() {};
    LocalJumpError = __klass(__base, __super, "LocalJumpError", LocalJumpError);

    var def = LocalJumpError.prototype, __scope = LocalJumpError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function TypeError() {};
    TypeError = __klass(__base, __super, "TypeError", TypeError);

    var def = TypeError.prototype, __scope = TypeError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function NameError() {};
    NameError = __klass(__base, __super, "NameError", NameError);

    var def = NameError.prototype, __scope = NameError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function NoMethodError() {};
    NoMethodError = __klass(__base, __super, "NoMethodError", NoMethodError);

    var def = NoMethodError.prototype, __scope = NoMethodError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function ArgumentError() {};
    ArgumentError = __klass(__base, __super, "ArgumentError", ArgumentError);

    var def = ArgumentError.prototype, __scope = ArgumentError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function IndexError() {};
    IndexError = __klass(__base, __super, "IndexError", IndexError);

    var def = IndexError.prototype, __scope = IndexError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function KeyError() {};
    KeyError = __klass(__base, __super, "KeyError", KeyError);

    var def = KeyError.prototype, __scope = KeyError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function RangeError() {};
    RangeError = __klass(__base, __super, "RangeError", RangeError);

    var def = RangeError.prototype, __scope = RangeError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function StopIteration() {};
    StopIteration = __klass(__base, __super, "StopIteration", StopIteration);

    var def = StopIteration.prototype, __scope = StopIteration._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  (function(__base, __super){
    function SyntaxError() {};
    SyntaxError = __klass(__base, __super, "SyntaxError", SyntaxError);

    var def = SyntaxError.prototype, __scope = SyntaxError._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
  return (function(__base, __super){
    function SystemExit() {};
    SystemExit = __klass(__base, __super, "SystemExit", SystemExit);

    var def = SystemExit.prototype, __scope = SystemExit._scope;

    return nil
  })(self, (($a = __scope.Exception) == null ? __opal.cm("Exception") : $a));
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass, __gvars = __opal.gvars;
  return (function(__base, __super){
    function Regexp() {};
    Regexp = __klass(__base, __super, "Regexp", Regexp);

    var def = Regexp.prototype, __scope = Regexp._scope;

    __opal.defs(Regexp, '$escape', function(string) {
      
      return string.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\^\$\|]/g, '\\$&');
    });

    __opal.defs(Regexp, '$new', function(regexp, options) {
      
      return new RegExp(regexp, options);
    });

    def['$=='] = function(other) {
      
      return other.constructor == RegExp && this.toString() === other.toString();
    };

    def['$==='] = def.test;

    def['$=~'] = function(string) {
      var $a, $b;
      
      var re = this;
      if (re.global) {
        // should we clear it afterwards too?
        re.lastIndex = 0;
      }
      else {
        // rewrite regular expression to add the global flag to capture pre/post match
        re = new RegExp(re.source, 'g' + (re.multiline ? 'm' : '') + (re.ignoreCase ? 'i' : ''));
      }

      var result = re.exec(string);

      if (result) {
        __gvars["~"] = (($a = (($b = __scope.MatchData) == null ? __opal.cm("MatchData") : $b)).$new || $mm('new')).call($a, re, result);
      }
      else {
        __gvars["~"] = __gvars["`"] = __gvars["'"] = nil;
      }

      return result ? result.index : nil;
    
    };

    def['$eql?'] = def['$=='];

    def.$inspect = def.toString;

    def.$match = function(string, pos) {
      var $a, $b;
      
      var re = this;
      if (re.global) {
        // should we clear it afterwards too?
        re.lastIndex = 0;
      }
      else {
        re = new RegExp(re.source, 'g' + (this.multiline ? 'm' : '') + (this.ignoreCase ? 'i' : ''));
      }

      var result = re.exec(string);

      if (result) {
        return __gvars["~"] = (($a = (($b = __scope.MatchData) == null ? __opal.cm("MatchData") : $b)).$new || $mm('new')).call($a, re, result);
      }
      else {
        return __gvars["~"] = __gvars["`"] = __gvars["'"] = nil;
      }
    
    };

    def.$source = function() {
      
      return this.source;
    };

    return def.$to_s = def.$source;
  })(self, null)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module;
  return (function(__base){
    function Comparable() {};
    Comparable = __module(__base, "Comparable", Comparable);
    var def = Comparable.prototype, __scope = Comparable._scope;

    def['$<'] = function(other) {
      var $a, $b;
      return (($a = (($b = this)['$<=>'] || $mm('<=>')).call($b, other))['$=='] || $mm('==')).call($a, -1);
    };

    def['$<='] = function(other) {
      var $a, $b;
      return (($a = (($b = this)['$<=>'] || $mm('<=>')).call($b, other))['$<='] || $mm('<=')).call($a, 0);
    };

    def['$=='] = function(other) {
      var $a, $b;
      return (($a = (($b = this)['$<=>'] || $mm('<=>')).call($b, other))['$=='] || $mm('==')).call($a, 0);
    };

    def['$>'] = function(other) {
      var $a, $b;
      return (($a = (($b = this)['$<=>'] || $mm('<=>')).call($b, other))['$=='] || $mm('==')).call($a, 1);
    };

    def['$>='] = function(other) {
      var $a, $b;
      return (($a = (($b = this)['$<=>'] || $mm('<=>')).call($b, other))['$>='] || $mm('>=')).call($a, 0);
    };

    def['$between?'] = function(min, max) {
      var $a, $b, $c;
      return (($a = (($b = this)['$>'] || $mm('>')).call($b, min)) ? (($c = this)['$<'] || $mm('<')).call($c, max) : $a);
    };
        ;__opal.donate(Comparable, ["$<", "$<=", "$==", "$>", "$>=", "$between?"]);
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module;
  return (function(__base){
    function Enumerable() {};
    Enumerable = __module(__base, "Enumerable", Enumerable);
    var def = Enumerable.prototype, __scope = Enumerable._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_17, TMP_18;

    def['$all?'] = TMP_1 = function() {
      var block;
      block = TMP_1._p || nil, TMP_1._p = null;
      
      
      var result = true, proc;

      if (block !== nil) {
        proc = function(obj) {
          var value;
          var args = [];
          for(var i = 0; i < arguments.length; i ++) {
            args[i] = arguments[i];
          }
          
          if ((value = block.apply(this, args)) === __breaker) {
            return __breaker.$v;
          }
             
          if (value === false || value === nil) {
            result = false;
            __breaker.$v = nil;

            return __breaker;
          }
        }
      }
      else {
        proc = function(obj) {
          if ((obj === false || obj === nil) && arguments.length < 2) {  
            result = false;
            __breaker.$v = nil;

            return __breaker;
          }
        }
      }

      this.$each._p = proc;
      this.$each();

      return result;
    
    };

    def['$any?'] = TMP_2 = function() {
      var block;
      block = TMP_2._p || nil, TMP_2._p = null;
      
      
      var result = false, proc;

      if (block !== nil) {
        proc = function(obj) {
          var value;
          var args = [];
          for(var i = 0; i < arguments.length; i ++) {
            args[i] = arguments[i];
          }
          
          if ((value = block.apply(this, args)) === __breaker) {
            return __breaker.$v;
          }

          if (value !== false && value !== nil) {
            result       = true;
            __breaker.$v = nil;

            return __breaker;
          }
        }
      }
      else {
        proc = function(obj) {
          if ((obj !== false && obj !== nil) || arguments.length >= 2) {
            result      = true;
            __breaker.$v = nil;
            
            return __breaker;
          }
        }
      }

      this.$each._p = proc;
      this.$each();

      return result;
    
    };

    def.$collect = TMP_3 = function() {
      var block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      
      var result = [];

      var proc = function() {
        var obj = __slice.call(arguments), value;

        if ((value = block.apply(null, obj)) === __breaker) {
          return __breaker.$v;
        }

        result.push(value);
      };

      this.$each._p = proc;
      this.$each();

      return result;
    
    };

    def.$reduce = TMP_4 = function(object) {
      var block;
      block = TMP_4._p || nil, TMP_4._p = null;
      
      
      var result = object == undefined ? 0 : object;

      var proc = function() {
        var obj = __slice.call(arguments), value;

        if ((value = block.apply(null, [result].concat(obj))) === __breaker) {
          result = __breaker.$v;
          __breaker.$v = nil;

          return __breaker;
        }

        result = value;
      };

      this.$each._p = proc;
      this.$each();

      return result;
    
    };

    def.$count = TMP_5 = function(object) {
      var $a, block;
      block = TMP_5._p || nil, TMP_5._p = null;
      
      
      var result = 0;

      if (object != null) {
        block = function(obj) { return (($a = (obj))['$=='] || $mm('==')).call($a, object); };
      }
      else if (block === nil) {
        block = function() { return true; };
      }

      var proc = function(obj) {
        var value;

        if ((value = block(obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value !== false && value !== nil) {
          result++;
        }
      }

      this.$each._p = proc;
      this.$each();

      return result;
    
    };

    def.$detect = TMP_6 = function(ifnone) {
      var $a, block;
      block = TMP_6._p || nil, TMP_6._p = null;
      
      
      var result = nil;

      this.$each._p = function(obj) {
        var value;

        if ((value = block(obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value !== false && value !== nil) {
          result      = obj;
          __breaker.$v = nil;

          return __breaker;
        }
      };

      this.$each();

      if (result !== nil) {
        return result;
      }

      if (typeof(ifnone) === 'function') {
        return (($a = ifnone).$call || $mm('call')).call($a);
      }

      return ifnone == null ? nil : ifnone;
    
    };

    def.$drop = function(number) {
      
      
      var result  = [],
          current = 0;

      this.$each._p = function(obj) {
        if (number < current) {
          result.push(e);
        }

        current++;
      };

      this.$each()

      return result;
    
    };

    def.$drop_while = TMP_7 = function() {
      var block;
      block = TMP_7._p || nil, TMP_7._p = null;
      
      
      var result = [];

      this.$each._p = function(obj) {
        var value;

        if ((value = block(obj)) === __breaker) {
          return __breaker;
        }

        if (value === false || value === nil) {
          result.push(obj);
          return value;
        }

        return __breaker;
      };

      this.$each();

      return result;
    
    };

    def.$each_slice = TMP_8 = function(n) {
      var block;
      block = TMP_8._p || nil, TMP_8._p = null;
      
      
      var all = [];

      this.$each._p = function(obj) {
        all.push(obj);

        if (all.length == n) {
          block(all.slice(0));
          all = [];
        }
      };

      this.$each();

      // our "last" group, if smaller than n then wont have been yielded
      if (all.length > 0) {
        block(all.slice(0));
      }

      return nil;
    
    };

    def.$each_with_index = TMP_9 = function() {
      var block;
      block = TMP_9._p || nil, TMP_9._p = null;
      
      
      var index = 0;

      this.$each._p = function(obj) {
        var value;

        if ((value = block(obj, index)) === __breaker) {
          return __breaker.$v;
        }

        index++;
      };
      this.$each();

      return nil;
    
    };

    def.$each_with_object = TMP_10 = function(object) {
      var block;
      block = TMP_10._p || nil, TMP_10._p = null;
      
      
      this.$each._p = function(obj) {
        var value;

        if ((value = block(obj, object)) === __breaker) {
          return __breaker.$v;
        }
      };

      this.$each();

      return object;
    
    };

    def.$entries = function() {
      
      
      var result = [];

      this.$each._p = function(obj) {
        result.push(obj);
      };

      this.$each();

      return result;
    
    };

    def.$find = def.$detect;

    def.$find_all = TMP_11 = function() {
      var block;
      block = TMP_11._p || nil, TMP_11._p = null;
      
      
      var result = [];

      this.$each._p = function(obj) {
        var value;

        if ((value = block(obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value !== false && value !== nil) {
          result.push(obj);
        }
      };

      this.$each();

      return result;
    
    };

    def.$find_index = TMP_12 = function(object) {
      var $a, block;
      block = TMP_12._p || nil, TMP_12._p = null;
      
      
      var proc, result = nil, index = 0;

      if (object != null) {
        proc = function (obj) {
          if ((($a = (obj))['$=='] || $mm('==')).call($a, object)) {
            result = index;
            return __breaker;
          }
          index += 1;
        };
      }
      else {
        proc = function(obj) {
          var value;

          if ((value = block(obj)) === __breaker) {
            return __breaker.$v;
          }

          if (value !== false && value !== nil) {
            result     = index;
            __breaker.$v = index;

            return __breaker;
          }
          index += 1;
        };
      }

      this.$each._p = proc;
      this.$each();

      return result;
    
    };

    def.$first = function(number) {
      
      
      var result = [],
          current = 0,
          proc;

      if (number == null) {
        result = nil;
        proc = function(obj) {
            result = obj; return __breaker;
          };
      } else {
        proc = function(obj) {
            if (number <= current) {
              return __breaker;
            }

            result.push(obj);

            current++;
          };
      }

      this.$each._p = proc;
      this.$each();

      return result;
    
    };

    def.$grep = TMP_13 = function(pattern) {
      var $a, $b, block;
      block = TMP_13._p || nil, TMP_13._p = null;
      
      
      var result = [];

      this.$each._p = (block !== nil
        ? function(obj) {
            var value = (($a = pattern)['$==='] || $mm('===')).call($a, obj);

            if (value !== false && value !== nil) {
              if ((value = block(obj)) === __breaker) {
                return __breaker.$v;
              }

              result.push(value);
            }
          }
        : function(obj) {
            var value = (($b = pattern)['$==='] || $mm('===')).call($b, obj);

            if (value !== false && value !== nil) {
              result.push(obj);
            }
          });

      this.$each();

      return result;
    
    };

    def.$group_by = TMP_14 = function() {
      var hash = nil, TMP_15, $a, $b, $c, TMP_16, block;
      block = TMP_14._p || nil, TMP_14._p = null;
      
      hash = ($a = (($b = (($c = __scope.Hash) == null ? __opal.cm("Hash") : $c)).$new || $mm('new')), $a._p = (TMP_15 = function(h, k) {

        var self = TMP_15._s || this, $a;
        if (h == null) h = nil;
if (k == null) k = nil;

        return (($a = h)['$[]='] || $mm('[]=')).call($a, k, [])
      }, TMP_15._s = this, TMP_15), $a).call($b);
      ($a = (($c = this).$each || $mm('each')), $a._p = (TMP_16 = function(el) {

        var self = TMP_16._s || this, $a, $b, $c;
        if (el == null) el = nil;

        return (($a = (($b = hash)['$[]'] || $mm('[]')).call($b, (($c = block).$call || $mm('call')).call($c, el)))['$<<'] || $mm('<<')).call($a, el)
      }, TMP_16._s = this, TMP_16), $a).call($c);
      return hash;
    };

    def.$map = def.$collect;

    def.$max = TMP_17 = function() {
      var $a, $b, block;
      block = TMP_17._p || nil, TMP_17._p = null;
      
      
      var proc, result;
      var arg_error = false;
      if (block !== nil) {
        proc = function(obj) {
          if (result == undefined) {
            result = obj;
          }
          else if ((value = block(obj, result)) === __breaker) {
            result = __breaker.$v;
            return __breaker;
          }
          else {
            if (value > 0) {
              result = obj;
            }
            __breaker.$v = nil;
          }
        }
      }
      else {
        proc = function(obj) {
          var modules = obj.$class().$included_modules;
          if (modules == undefined || modules.length == 0 || modules.indexOf(Opal.Comparable) == -1) {
            arg_error = true;
            return __breaker;
          }
          if (result == undefined || obj > result) {
            result = obj;
          }
        }
      }

      this.$each._p = proc;
      this.$each();

      if (arg_error) {
        (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.ArgumentError) == null ? __opal.cm("ArgumentError") : $b), "Array#max");
      }

      return (result == undefined ? nil : result);
    
    };

    def.$min = TMP_18 = function() {
      var $a, $b, block;
      block = TMP_18._p || nil, TMP_18._p = null;
      
      
      var proc, result;
      var arg_error = false;
      if (block !== nil) {
        proc = function(obj) {
          if (result == undefined) {
            result = obj;
          }
          else if ((value = block(obj, result)) === __breaker) {
            result = __breaker.$v;
            return __breaker;
          }
          else {
            if (value < 0) {
              result = obj;
            }
            __breaker.$v = nil;
          }
        }
      }
      else {
        proc = function(obj) {
          var modules = obj.$class().$included_modules;
          if (modules == undefined || modules.length == 0 || modules.indexOf(Opal.Comparable) == -1) {
            arg_error = true;
            return __breaker;
          }
          if (result == undefined || obj < result) {
            result = obj;
          }
        }
      }

      this.$each._p = proc;
      this.$each();

      if (arg_error) {
        (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.ArgumentError) == null ? __opal.cm("ArgumentError") : $b), "Array#min");
      }

      return (result == undefined ? nil : result);
    
    };

    def.$select = def.$find_all;

    def.$take = def.$first;

    def.$to_a = def.$entries;

    def.$inject = def.$reduce;
        ;__opal.donate(Enumerable, ["$all?", "$any?", "$collect", "$reduce", "$count", "$detect", "$drop", "$drop_while", "$each_slice", "$each_with_index", "$each_with_object", "$entries", "$find", "$find_all", "$find_index", "$first", "$grep", "$group_by", "$map", "$max", "$min", "$select", "$take", "$to_a", "$inject"]);
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Enumerator() {};
    Enumerator = __klass(__base, __super, "Enumerator", Enumerator);

    var def = Enumerator.prototype, __scope = Enumerator._scope, $a, $b, TMP_1;
    def.object = def.method = def.args = def.cache = nil;

    (($a = Enumerator).$include || $mm('include')).call($a, (($b = __scope.Enumerable) == null ? __opal.cm("Enumerable") : $b));

    def.$initialize = function(obj, method, args) {
      if (method == null) {
        method = "each"
      }args = __slice.call(arguments, 2);
      this.object = obj;
      this.method = method;
      return this.args = args;
    };

    def.$each = TMP_1 = function() {
      var $a, TMP_2, $b, $c, block;
      block = TMP_1._p || nil, TMP_1._p = null;
      
      if (block === nil) {
        return (($a = this).$enum_for || $mm('enum_for')).call($a, "each")
      };
      return ($b = (($c = this.object).$__send__ || $mm('__send__')), $b._p = (TMP_2 = function(e) {

        var self = TMP_2._s || this, $a;
        if (e == null) e = nil;

        return (($a = block).$call || $mm('call')).call($a, e)
      }, TMP_2._s = this, TMP_2), $b).apply($c, [this.method].concat(this.args));
    };

    def.$next = function() {
      var $a, $b, $c, $d;
      (($a = this.cache), $a !== false && $a !== nil ? $a : this.cache = (($b = this).$to_a || $mm('to_a')).call($b));
      if (($a = (($c = this.cache)['$empty?'] || $mm('empty?')).call($c)) !== false && $a !== nil) {
        (($a = this).$raise || $mm('raise')).call($a, (($d = __scope.StopIteration) == null ? __opal.cm("StopIteration") : $d), "end of enumeration")
      };
      return (($d = this.cache).$shift || $mm('shift')).call($d);
    };

    def.$rewind = function() {
      
      this.cache = nil;
      return this;
    };

    return nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Array() {};
    Array = __klass(__base, __super, "Array", Array);

    var def = Array.prototype, __scope = Array._scope, $a, $b, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_15, TMP_16, TMP_17, TMP_18, TMP_19, TMP_20;

    (($a = Array).$include || $mm('include')).call($a, (($b = __scope.Enumerable) == null ? __opal.cm("Enumerable") : $b));

    def._isArray = true;

    __opal.defs(Array, '$[]', function(objects) {
      objects = __slice.call(arguments, 0);
      return objects
    });

    __opal.defs(Array, '$new', TMP_1 = function(size, obj) {
      var block;
      block = TMP_1._p || nil, TMP_1._p = null;
      if (obj == null) {
        obj = nil
      }
      
      var arr = [];

      if (size && size._isArray) {
        for (var i = 0; i < size.length; i++) {
          arr[i] = size[i];
        }
      }
      else {
        if (block === nil) {
          for (var i = 0; i < size; i++) {
            arr[i] = obj;
          }
        }
        else {
          for (var i = 0; i < size; i++) {
            arr[i] = block(i);
          }
        }
      }

      return arr;
    
    });

    __opal.defs(Array, '$try_convert', function(obj) {
      
      
      if (obj._isArray) {
        return obj;
      }

      return nil;
    
    });

    def['$&'] = function(other) {
      
      
      var result = [],
          seen   = {};

      for (var i = 0, length = this.length; i < length; i++) {
        var item = this[i];
        if (item._isString) {
          item = item.toString();
        }

        if (!seen[item]) {
          for (var j = 0, length2 = other.length; j < length2; j++) {
            var item2 = other[j];
            if (item2._isString) {
              item2 = item2.toString();
            }

            if (item === item2 && !seen[item]) {
              seen[item] = true;

              result.push(item);
            }
          }
        }
      }

      return result;
    
    };

    def['$*'] = function(other) {
      
      
      if (typeof(other) === 'string') {
        return this.join(other);
      }

      var result = [];

      for (var i = 0; i < other; i++) {
        result = result.concat(this);
      }

      return result;
    
    };

    def['$+'] = function(other) {
      
      return this.concat(other);
    };

    def['$-'] = function(other) {
      var $a, $b, $c, $d, $e;
      
      var a = this,
          b = other,
          tmp = [],
          result = [];
      
     if (typeof(b) == "object" && !(b instanceof Array))  {
        if (b['$to_ary'] && typeof(b['$to_ary']) == "function") {
          b = b['$to_ary']();
        } else {
          (($a = this).$raise || $mm('raise')).call($a, (($b = (($c = __scope.TypeError) == null ? __opal.cm("TypeError") : $c)).$new || $mm('new')).call($b, "can't convert to Array. Array#-"));
        }
      }else if ((typeof(b) != "object")) {
        (($c = this).$raise || $mm('raise')).call($c, (($d = (($e = __scope.TypeError) == null ? __opal.cm("TypeError") : $e)).$new || $mm('new')).call($d, "can't convert to Array. Array#-")); 
      }      

      if (a.length == 0)
        return [];
      if (b.length == 0)
        return a;    
          
      for(var i = 0, length = b.length; i < length; i++) { 
        tmp[b[i]] = true;
      }
      for(var i = 0, length = a.length; i < length; i++) {
        if (!tmp[a[i]]) { 
          result.push(a[i]);
        }  
     }
     
      return result; 
    
    };

    def['$<<'] = function(object) {
      
      this.push(object);
      return this;
    };

    def['$<=>'] = function(other) {
      var $a, $b, $c;
      
      if ((($a = this).$hash || $mm('hash')).call($a) === (($b = other).$hash || $mm('hash')).call($b)) {
        return 0;
      }

      if (this.length != other.length) {
        return (this.length > other.length) ? 1 : -1;
      }

      for (var i = 0, length = this.length, tmp; i < length; i++) {
        if ((tmp = (($c = (this[i]))['$<=>'] || $mm('<=>')).call($c, other[i])) !== 0) {
          return tmp;
        }
      }

      return 0;
    
    };

    def['$=='] = function(other) {
      var $a;
      
      if (!other || (this.length !== other.length)) {
        return false;
      }

      for (var i = 0, length = this.length, tmp1, tmp2; i < length; i++) {
        tmp1 = this[i];
        tmp2 = other[i];
        
        //recursive
        if ((typeof(tmp1.indexOf) == "function") &&
            (typeof(tmp2.indexOf) == "function") &&  
            (tmp1.indexOf(tmp2) == tmp2.indexOf(tmp1))) {
          if (tmp1.indexOf(tmp1) == tmp2.indexOf(tmp2)) {
            continue;
          }
        }
        
        if (!(($a = (this[i]))['$=='] || $mm('==')).call($a, other[i])) {
          return false;
        }
        
      }
      

      return true;
    
    };

    def['$[]'] = function(index, length) {
      var $a;
      
      var size = this.length;

      if (typeof index !== 'number' && !index._isNumber) {
        if (index._isRange) {
          var exclude = index.exclude;
          length      = index.end;
          index       = index.begin;

          if (index > size) {
            return nil;
          }

          if (length < 0) {
            length += size;
          }

          if (!exclude) length += 1;
          return this.slice(index, length);
        }
        else {
          (($a = this).$raise || $mm('raise')).call($a, "bad arg for Array#[]");
        }
      }

      if (index < 0) {
        index += size;
      }

      if (length !== undefined) {
        if (length < 0 || index > size || index < 0) {
          return nil;
        }

        return this.slice(index, index + length);
      }
      else {
        if (index >= size || index < 0) {
          return nil;
        }

        return this[index];
      }
    
    };

    def['$[]='] = function(index, value) {
      
      
      var size = this.length;

      if (index < 0) {
        index += size;
      }

      return this[index] = value;
    
    };

    def.$assoc = function(object) {
      var $a;
      
      for (var i = 0, length = this.length, item; i < length; i++) {
        if (item = this[i], item.length && (($a = (item[0]))['$=='] || $mm('==')).call($a, object)) {
          return item;
        }
      }

      return nil;
    
    };

    def.$at = function(index) {
      
      
      if (index < 0) {
        index += this.length;
      }

      if (index < 0 || index >= this.length) {
        return nil;
      }

      return this[index];
    
    };

    def.$clear = function() {
      
      this.splice(0, this.length);
      return this;
    };

    def.$clone = function() {
      
      return this.slice();
    };

    def.$collect = TMP_2 = function() {
      var block;
      block = TMP_2._p || nil, TMP_2._p = null;
      
      
      var result = [];

      for (var i = 0, length = this.length, value; i < length; i++) {
        if ((value = block(this[i])) === __breaker) {
          return __breaker.$v;
        }

        result.push(value);
      }

      return result;
    
    };

    def['$collect!'] = TMP_3 = function() {
      var block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      
      for (var i = 0, length = this.length, val; i < length; i++) {
        if ((val = block(this[i])) === __breaker) {
          return __breaker.$v;
        }

        this[i] = val;
      }
    
      return this;
    };

    def.$compact = function() {
      
      
      var result = [];

      for (var i = 0, length = this.length, item; i < length; i++) {
        if ((item = this[i]) !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$compact!'] = function() {
      
      
      var original = this.length;

      for (var i = 0, length = this.length; i < length; i++) {
        if (this[i] === nil) {
          this.splice(i, 1);

          length--;
          i--;
        }
      }

      return this.length === original ? nil : this;
    
    };

    def.$concat = function(other) {
      
      
      for (var i = 0, length = other.length; i < length; i++) {
        this.push(other[i]);
      }
    
      return this;
    };

    def.$count = function(object) {
      var $a;
      
      if (object == null) {
        return this.length;
      }

      var result = 0;

      for (var i = 0, length = this.length; i < length; i++) {
        if ((($a = (this[i]))['$=='] || $mm('==')).call($a, object)) {
          result++;
        }
      }

      return result;
    
    };

    def.$delete = function(object) {
      var $a;
      
      var original = this.length;

      for (var i = 0, length = original; i < length; i++) {
        if ((($a = (this[i]))['$=='] || $mm('==')).call($a, object)) {
          this.splice(i, 1);

          length--;
          i--;
        }
      }

      return this.length === original ? nil : object;
    
    };

    def.$delete_at = function(index) {
      
      
      if (index < 0) {
        index += this.length;
      }

      if (index < 0 || index >= this.length) {
        return nil;
      }

      var result = this[index];

      this.splice(index, 1);

      return result;
    
    };

    def.$delete_if = TMP_4 = function() {
      var block;
      block = TMP_4._p || nil, TMP_4._p = null;
      
      
      for (var i = 0, length = this.length, value; i < length; i++) {
        if ((value = block(this[i])) === __breaker) {
          return __breaker.$v;
        }

        if (value !== false && value !== nil) {
          this.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return this;
    };

    def.$drop = function(number) {
      
      return this.slice(number);
    };

    def.$dup = def.$clone;

    def.$each = TMP_5 = function() {
      var $a, $b, $c, block;
      block = TMP_5._p || nil, TMP_5._p = null;
      
      if (block === nil) {
        return (($a = this).$enum_for || $mm('enum_for')).call($a, "each")
      };
      if ((($b = (($c = block).$arity || $mm('arity')).call($c))['$>'] || $mm('>')).call($b, 0)) {
        
        for (var i = 0, length = this.length; i < length; i++) {
          if (block.apply(null, this[i]._isArray ? this[i] : [this[i]]) === __breaker) return __breaker.$v;
        }
      
        } else {
        
        for (var i = 0, length = this.length; i < length; i++) {
          if (block.call(null, this[i]) === __breaker) return __breaker.$v;
        }
      
      };
      return this;
    };

    def.$each_index = TMP_6 = function() {
      var block;
      block = TMP_6._p || nil, TMP_6._p = null;
      
      for (var i = 0, length = this.length; i < length; i++) {
      if (block.call(null, i) === __breaker) return __breaker.$v;
      };
      return this;
    };

    def['$empty?'] = function() {
      
      return !this.length;
    };

    def.$fetch = TMP_7 = function(index, defaults) {
      var $a, $b, block;
      block = TMP_7._p || nil, TMP_7._p = null;
      
      
      var original = index;

      if (index < 0) {
        index += this.length;
      }

      if (index >= 0 && index < this.length) {
        return this[index];
      }

      if (defaults != null) {
        return defaults;
      }

      if (block !== nil) {
        return block(original);
      }

      (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.IndexError) == null ? __opal.cm("IndexError") : $b), "Array#fetch");
    
    };

    def.$fill = TMP_8 = function(obj) {
      var block;
      block = TMP_8._p || nil, TMP_8._p = null;
      
      
      if (block !== nil) {
        for (var i = 0, length = this.length; i < length; i++) {
          this[i] = block(i);
        }
      }
      else {
        for (var i = 0, length = this.length; i < length; i++) {
          this[i] = obj;
        }
      }
    
      return this;
    };

    def.$first = function(count) {
      
      
      if (count != null) {
        return this.slice(0, count);
      }

      return this.length === 0 ? nil : this[0];
    
    };

    def.$flatten = function(level) {
      var $a, $b;
      
      var result = [];

      for (var i = 0, length = this.length, item; i < length; i++) {
        item = this[i];

        if (item._isArray) {
          if (level == null) {
            result = result.concat((($a = (item)).$flatten || $mm('flatten')).call($a));
          }
          else if (level === 0) {
            result.push(item);
          }
          else {
            result = result.concat((($b = (item)).$flatten || $mm('flatten')).call($b, level - 1));
          }
        }
        else {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$flatten!'] = function(level) {
      var $a, $b;
      
      var size = this.length;
      (($a = this).$replace || $mm('replace')).call($a, (($b = this).$flatten || $mm('flatten')).call($b, level));

      return size === this.length ? nil : this;
    
    };

    def.$hash = function() {
      
      return this._id || (this._id = Opal.uid());
    };

    def['$include?'] = function(member) {
      var $a;
      
      for (var i = 0, length = this.length; i < length; i++) {
        if ((($a = (this[i]))['$=='] || $mm('==')).call($a, member)) {
          return true;
        }
      }

      return false;
    
    };

    def.$index = TMP_9 = function(object) {
      var $a, block;
      block = TMP_9._p || nil, TMP_9._p = null;
      
      
      if (object != null) {
        for (var i = 0, length = this.length; i < length; i++) {
          if ((($a = (this[i]))['$=='] || $mm('==')).call($a, object)) {
            return i;
          }
        }
      }
      else if (block !== nil) {
        for (var i = 0, length = this.length, value; i < length; i++) {
          if ((value = block(this[i])) === __breaker) {
            return __breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }

      return nil;
    
    };

    def.$insert = function(index, objects) {
      var $a, $b;objects = __slice.call(arguments, 1);
      
      if (objects.length > 0) {
        if (index < 0) {
          index += this.length + 1;

          if (index < 0) {
            (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.IndexError) == null ? __opal.cm("IndexError") : $b), "" + (index) + " is out of bounds");
          }
        }
        if (index > this.length) {
          for (var i = this.length; i < index; i++) {
            this.push(nil);
          }
        }

        this.splice.apply(this, [index, 0].concat(objects));
      }
    
      return this;
    };

    def.$inspect = function() {
      var $a, $b, $c, $d;
      
      var i, inspect, el, el_insp, length, object_id;

      inspect = [];
      object_id = (($a = this).$object_id || $mm('object_id')).call($a);
      length = this.length;

      for (i = 0; i < length; i++) {
        el = (($b = this)['$[]'] || $mm('[]')).call($b, i);

        // Check object_id to ensure it's not the same array get into an infinite loop
        el_insp = (($c = (el)).$object_id || $mm('object_id')).call($c) === object_id ? '[...]' : (($d = (el)).$inspect || $mm('inspect')).call($d);

        inspect.push(el_insp);
      }
      return '[' + inspect.join(', ') + ']';
    
    };

    def.$join = function(sep) {
      var $a;if (sep == null) {
        sep = ""
      }
      
      var result = [];

      for (var i = 0, length = this.length; i < length; i++) {
        result.push((($a = (this[i])).$to_s || $mm('to_s')).call($a));
      }

      return result.join(sep);
    
    };

    def.$keep_if = TMP_10 = function() {
      var block;
      block = TMP_10._p || nil, TMP_10._p = null;
      
      
      for (var i = 0, length = this.length, value; i < length; i++) {
        if ((value = block(this[i])) === __breaker) {
          return __breaker.$v;
        }

        if (value === false || value === nil) {
          this.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return this;
    };

    def.$last = function(count) {
      var $a, $b, $c, $d;
      
      var length = this.length;
      
      if (count === nil || typeof(count) == 'string') { 
        (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.TypeError) == null ? __opal.cm("TypeError") : $b), "no implicit conversion to integer");
      }
        
      if (typeof(count) == 'object') {
        if (typeof(count['$to_int']) == 'function') {
          count = count['$to_int']();
        } 
        else {
          (($b = this).$raise || $mm('raise')).call($b, (($c = __scope.TypeError) == null ? __opal.cm("TypeError") : $c), "no implicit conversion to integer");
        }
      }
      
      if (count == null) {
        return length === 0 ? nil : this[length - 1];
      }
      else if (count < 0) {
        (($c = this).$raise || $mm('raise')).call($c, (($d = __scope.ArgumentError) == null ? __opal.cm("ArgumentError") : $d), "negative count given");
      }

      if (count > length) {
        count = length;
      }

      return this.slice(length - count, length);
    
    };

    def.$length = function() {
      
      return this.length;
    };

    def.$map = def.$collect;

    def['$map!'] = def['$collect!'];

    def.$pop = function(count) {
      var $a;
      
      var length = this.length;

      if (count == null) {
        return length === 0 ? nil : this.pop();
      }

      if (count < 0) {
        (($a = this).$raise || $mm('raise')).call($a, "negative count given");
      }

      return count > length ? this.splice(0, this.length) : this.splice(length - count, length);
    
    };

    def.$push = function(objects) {
      objects = __slice.call(arguments, 0);
      
      for (var i = 0, length = objects.length; i < length; i++) {
        this.push(objects[i]);
      }
    
      return this;
    };

    def.$rassoc = function(object) {
      var $a;
      
      for (var i = 0, length = this.length, item; i < length; i++) {
        item = this[i];

        if (item.length && item[1] !== undefined) {
          if ((($a = (item[1]))['$=='] || $mm('==')).call($a, object)) {
            return item;
          }
        }
      }

      return nil;
    
    };

    def.$reject = TMP_11 = function() {
      var block;
      block = TMP_11._p || nil, TMP_11._p = null;
      
      
      var result = [];

      for (var i = 0, length = this.length, value; i < length; i++) {
        if ((value = block(this[i])) === __breaker) {
          return __breaker.$v;
        }

        if (value === false || value === nil) {
          result.push(this[i]);
        }
      }
      return result;
    
    };

    def['$reject!'] = TMP_12 = function() {
      var $a, $b, $c, block;
      block = TMP_12._p || nil, TMP_12._p = null;
      
      
      var original = this.length;
      ($b = (($c = this).$delete_if || $mm('delete_if')), $b._p = (($a = block).$to_proc || $mm('to_proc')).call($a), $b).call($c);
      return this.length === original ? nil : this;
    
    };

    def.$replace = function(other) {
      
      
      this.splice(0, this.length);
      this.push.apply(this, other);
      return this;
    
    };

    def.$reverse = function() {
      
      return this.slice(0).reverse();
    };

    def['$reverse!'] = def.reverse;

    def.$reverse_each = TMP_13 = function() {
      var $a, $b, $c, $d, block;
      block = TMP_13._p || nil, TMP_13._p = null;
      
      ($b = (($c = (($d = this).$reverse || $mm('reverse')).call($d)).$each || $mm('each')), $b._p = (($a = block).$to_proc || $mm('to_proc')).call($a), $b).call($c);
      return this;
    };

    def.$rindex = TMP_14 = function(object) {
      var $a, block;
      block = TMP_14._p || nil, TMP_14._p = null;
      
      
      if (block !== nil) {
        for (var i = this.length - 1, value; i >= 0; i--) {
          if ((value = block(this[i])) === __breaker) {
            return __breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }
      else {
        for (var i = this.length - 1; i >= 0; i--) {
          if ((($a = (this[i]))['$=='] || $mm('==')).call($a, object)) {
            return i;
          }
        }
      }

      return nil;
    
    };

    def.$select = TMP_15 = function() {
      var block;
      block = TMP_15._p || nil, TMP_15._p = null;
      
      
      var result = [];

      for (var i = 0, length = this.length, item, value; i < length; i++) {
        item = this[i];

        if ((value = block(item)) === __breaker) {
          return __breaker.$v;
        }

        if (value !== false && value !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_16 = function() {
      var $a, $b, $c, block;
      block = TMP_16._p || nil, TMP_16._p = null;
      
      
      var original = this.length;
      ($b = (($c = this).$keep_if || $mm('keep_if')), $b._p = (($a = block).$to_proc || $mm('to_proc')).call($a), $b).call($c);
      return this.length === original ? nil : this;
    
    };

    def.$shift = function(count) {
      
      
      if (this.length === 0) {
        return nil;
      }

      return count == null ? this.shift() : this.splice(0, count)
    
    };

    def.$size = def.$length;

    def.$shuffle = function() {
      
      
        for (var i = this.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = this[i];
          this[i] = this[j];
          this[j] = tmp;
        }

        return this;
    
    };

    def.$slice = def['$[]'];

    def['$slice!'] = function(index, length) {
      
      
      if (index < 0) {
        index += this.length;
      }

      if (length != null) {
        return this.splice(index, length);
      }

      if (index < 0 || index >= this.length) {
        return nil;
      }

      return this.splice(index, 1)[0];
    
    };

    def.$sort = TMP_17 = function() {
      var $a, $b, $c, block;
      block = TMP_17._p || nil, TMP_17._p = null;
      
      
      var copy = this.slice();
      var t_arg_error = false;
      var t_break = [];
        
      if (block !== nil) {
        var result = copy.sort(function(x, y) {
          var result = block(x, y);
          if (result === __breaker) {
            t_break.push(__breaker.$v);
          }
          if (result === nil) {
            t_arg_error = true;  
          }
          if (result['$<=>'] && typeof(result['$<=>']) == "function") {
            result = result['$<=>'](0);
          }
          if ([-1, 0, 1].indexOf(result) == -1) {
            t_arg_error = true;
          }
          return result;
        });

        if (t_break.length > 0)
          return t_break[0];
        if (t_arg_error)
          (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.ArgumentError) == null ? __opal.cm("ArgumentError") : $b), "Array#sort");

        return result;
      }
      
      var result = copy.sort(function(a, b){ 
        if (typeof(a) !== typeof(b)) {
          t_arg_error = true;
        }
        
        if (a['$<=>'] && typeof(a['$<=>']) == "function") {
          var result = a['$<=>'](b);
          if (result === nil) {
            t_arg_error = true;
          } 
          return result; 
        }  
        if (a > b)
          return 1;
        if (a < b)
          return -1;
        return 0;  
      });
      
      if (t_arg_error)
        (($b = this).$raise || $mm('raise')).call($b, (($c = __scope.ArgumentError) == null ? __opal.cm("ArgumentError") : $c), "Array#sort");

      return result;
    
    };

    def['$sort!'] = TMP_18 = function() {
      var block;
      block = TMP_18._p || nil, TMP_18._p = null;
      
      
      var result;
      if (block !== nil) {
        //strangely
        result = this.slice().sort(block);
      } else {
        result = this.slice()['$sort']();
      }
      this.length = 0;
      for(var i = 0; i < result.length; i++) {
        this.push(result[i]);
      }
      return this;
    
    };

    def.$take = function(count) {
      
      return this.slice(0, count);
    };

    def.$take_while = TMP_19 = function() {
      var block;
      block = TMP_19._p || nil, TMP_19._p = null;
      
      
      var result = [];

      for (var i = 0, length = this.length, item, value; i < length; i++) {
        item = this[i];

        if ((value = block(item)) === __breaker) {
          return __breaker.$v;
        }

        if (value === false || value === nil) {
          return result;
        }

        result.push(item);
      }

      return result;
    
    };

    def.$to_a = function() {
      
      return this;
    };

    def.$to_ary = def.$to_a;

    def.$to_json = function() {
      var $a;
      
      var result = [];

      for (var i = 0, length = this.length; i < length; i++) {
        result.push((($a = (this[i])).$to_json || $mm('to_json')).call($a));
      }

      return '[' + result.join(', ') + ']';
    
    };

    def.$to_native = function() {
      var $a;
      
      var result = [], obj

      for (var i = 0, len = this.length; i < len; i++) {
        obj = this[i];

        if (obj.$to_native) {
          result.push((($a = (obj)).$to_native || $mm('to_native')).call($a));
        }
        else {
          result.push(obj);
        }
      }

      return result;
    
    };

    def.$to_s = def.$inspect;

    def.$uniq = function() {
      
      
      var result = [],
          seen   = {};

      for (var i = 0, length = this.length, item, hash; i < length; i++) {
        item = this[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;

          result.push(item);
        }
      }

      return result;
    
    };

    def['$uniq!'] = function() {
      
      
      var original = this.length,
          seen     = {};

      for (var i = 0, length = original, item, hash; i < length; i++) {
        item = this[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;
        }
        else {
          this.splice(i, 1);

          length--;
          i--;
        }
      }

      return this.length === original ? nil : this;
    
    };

    def.$unshift = function(objects) {
      objects = __slice.call(arguments, 0);
      
      for (var i = objects.length - 1; i >= 0; i--) {
        this.unshift(objects[i]);
      }

      return this;
    
    };

    def.$zip = TMP_20 = function(others) {
      var block;
      block = TMP_20._p || nil, TMP_20._p = null;
      others = __slice.call(arguments, 0);
      
      var result = [], size = this.length, part, o;

      for (var i = 0; i < size; i++) {
        part = [this[i]];

        for (var j = 0, jj = others.length; j < jj; j++) {
          o = others[j][i];

          if (o == null) {
            o = nil;
          }

          part[j + 1] = o;
        }

        result[i] = part;
      }

      if (block !== nil) {
        for (var i = 0; i < size; i++) {
          block(result[i]);
        }

        return nil;
      }

      return result;
    
    };

    return nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Hash() {};
    Hash = __klass(__base, __super, "Hash", Hash);

    var def = Hash.prototype, __scope = Hash._scope, $a, $b, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12;
    def.proc = def.none = nil;

    (($a = Hash).$include || $mm('include')).call($a, (($b = __scope.Enumerable) == null ? __opal.cm("Enumerable") : $b));

    
    var __hash = Opal.hash = function() {
      var hash   = new Hash,
          args   = __slice.call(arguments),
          keys   = [],
          assocs = {};

      hash.map   = assocs;
      hash.keys  = keys;

      for (var i = 0, length = args.length, key; i < length; i++) {
        var key = args[i], obj = args[++i];

        if (assocs[key] == null) {
          keys.push(key);
        }

        assocs[key] = obj;
      }

      return hash;
    };
  

    
    var __hash2 = Opal.hash2 = function(keys, map) {
      var hash = new Hash;
      hash.keys = keys;
      hash.map = map;
      return hash;
    };
  

    var __hasOwn = {}.hasOwnProperty;

    __opal.defs(Hash, '$[]', function(objs) {
      objs = __slice.call(arguments, 0);
      return __hash.apply(null, objs);
    });

    __opal.defs(Hash, '$allocate', function() {
      
      return __hash();
    });

    __opal.defs(Hash, '$from_native', function(obj) {
      
      
      var hash = __hash(), map = hash.map, keys = hash.keys;

      for (var key in obj) {
        keys.push(key);
        map[key] = obj[key];
      }

      return hash;
    
    });

    __opal.defs(Hash, '$new', TMP_1 = function(defaults) {
      var block;
      block = TMP_1._p || nil, TMP_1._p = null;
      
      
      var hash = __hash();

      if (defaults != null) {
        hash.none = defaults;
      }
      else if (block !== nil) {
        hash.proc = block;
      }

      return hash;
    
    });

    def['$=='] = function(other) {
      var $a, $b;
      
      if (this === other) {
        return true;
      }

      if (!other.map || !other.keys) {
        return false;
      }

      if (this.keys.length !== other.keys.length) {
        return false;
      }

      var map  = this.map,
          map2 = other.map;

      for (var i = 0, length = this.keys.length; i < length; i++) {
        var key = this.keys[i], obj = map[key], obj2 = map2[key];

        if (($a = (($b = (obj))['$=='] || $mm('==')).call($b, obj2), ($a === nil || $a === false))) {
          return false;
        }
      }

      return true;
    
    };

    def['$[]'] = function(key) {
      var $a;
      
      var bucket = this.map[key];

      if (bucket != null) {
        return bucket;
      }

      var proc = this.proc;

      if (proc !== nil) {
        return (($a = (proc)).$call || $mm('call')).call($a, this, key);
      }

      return this.none;
    
    };

    def['$[]='] = function(key, value) {
      
      
      var map = this.map;

      if (!__hasOwn.call(map, key)) {
        this.keys.push(key);
      }

      map[key] = value;

      return value;
    
    };

    def.$assoc = function(object) {
      var $a;
      
      var keys = this.keys, key;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if ((($a = (key))['$=='] || $mm('==')).call($a, object)) {
          return [key, this.map[key]];
        }
      }

      return nil;
    
    };

    def.$clear = function() {
      
      
      this.map = {};
      this.keys = [];
      return this;
    
    };

    def.$clone = function() {
      
      
      var result = __hash(),
          map    = this.map,
          map2   = result.map,
          keys2  = result.keys;

      for (var i = 0, length = this.keys.length; i < length; i++) {
        keys2.push(this.keys[i]);
        map2[this.keys[i]] = map[this.keys[i]];
      }

      return result;
    
    };

    def.$default = function(val) {
      
      return this.none;
    };

    def['$default='] = function(object) {
      
      return this.none = object;
    };

    def.$default_proc = function() {
      
      return this.proc;
    };

    def['$default_proc='] = function(proc) {
      
      return this.proc = proc;
    };

    def.$delete = function(key) {
      
      
      var map  = this.map, result = map[key];

      if (result != null) {
        delete map[key];
        this.keys.$delete(key);

        return result;
      }

      return nil;
    
    };

    def.$delete_if = TMP_2 = function() {
      var block;
      block = TMP_2._p || nil, TMP_2._p = null;
      
      
      var map = this.map, keys = this.keys, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value !== false && value !== nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
        }
      }

      return this;
    
    };

    def.$dup = def.$clone;

    def.$each = TMP_3 = function() {
      var block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      
      var map = this.map, keys = this.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if (block(key, map[key]) === __breaker) {
          return __breaker.$v;
        }
      }

      return this;
    
    };

    def.$each_key = TMP_4 = function() {
      var block;
      block = TMP_4._p || nil, TMP_4._p = null;
      
      
      var keys = this.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if (block(key) === __breaker) {
          return __breaker.$v;
        }
      }

      return this;
    
    };

    def.$each_pair = def.$each;

    def.$each_value = TMP_5 = function() {
      var block;
      block = TMP_5._p || nil, TMP_5._p = null;
      
      
      var map = this.map, keys = this.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        if (block(map[keys[i]]) === __breaker) {
          return __breaker.$v;
        }
      }

      return this;
    
    };

    def['$empty?'] = function() {
      
      
      return this.keys.length === 0;
    
    };

    def['$eql?'] = def['$=='];

    def.$fetch = TMP_6 = function(key, defaults) {
      var $a, $b, block;
      block = TMP_6._p || nil, TMP_6._p = null;
      
      
      var value = this.map[key];

      if (value != null) {
        return value;
      }

      if (block !== nil) {
        var value;

        if ((value = block(key)) === __breaker) {
          return __breaker.$v;
        }

        return value;
      }

      if (defaults != null) {
        return defaults;
      }

      (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.KeyError) == null ? __opal.cm("KeyError") : $b), "key not found");
    
    };

    def.$flatten = function(level) {
      var $a;
      
      var map = this.map, keys = this.keys, result = [];

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], value = map[key];

        result.push(key);

        if (value._isArray) {
          if (level == null || level === 1) {
            result.push(value);
          }
          else {
            result = result.concat((($a = (value)).$flatten || $mm('flatten')).call($a, level - 1));
          }
        }
        else {
          result.push(value);
        }
      }

      return result;
    
    };

    def['$has_key?'] = function(key) {
      
      return this.map[key] != null;
    };

    def['$has_value?'] = function(value) {
      var $a;
      
      for (var assoc in this.map) {
        if ((($a = (this.map[assoc]))['$=='] || $mm('==')).call($a, value)) {
          return true;
        }
      }

      return false;
    
    };

    def.$hash = function() {
      
      return this._id;
    };

    def['$include?'] = def['$has_key?'];

    def.$index = function(object) {
      var $a;
      
      var map = this.map, keys = this.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if ((($a = object)['$=='] || $mm('==')).call($a, map[key])) {
          return key;
        }
      }

      return nil;
    
    };

    def.$indexes = function(keys) {
      keys = __slice.call(arguments, 0);
      
      var result = [], map = this.map, val;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], val = map[key];

        if (val != null) {
          result.push(val);
        }
        else {
          result.push(this.none);
        }
      }

      return result;
    
    };

    def.$indices = def.$indexes;

    def.$inspect = function() {
      var $a, $b;
      
      var inspect = [], keys = this.keys, map = this.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];
        inspect.push((($a = (key)).$inspect || $mm('inspect')).call($a) + '=>' + (($b = (map[key])).$inspect || $mm('inspect')).call($b));
      }

      return '{' + inspect.join(', ') + '}';
    
    };

    def.$invert = function() {
      
      
      var result = __hash(), keys = this.keys, map = this.map,
          keys2 = result.keys, map2 = result.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        keys2.push(obj);
        map2[obj] = key;
      }

      return result;
    
    };

    def.$keep_if = TMP_7 = function() {
      var block;
      block = TMP_7._p || nil, TMP_7._p = null;
      
      
      var map = this.map, keys = this.keys, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value === false || value === nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
        }
      }

      return this;
    
    };

    def.$key = def.$index;

    def['$key?'] = def['$has_key?'];

    def.$keys = function() {
      
      
      return this.keys.slice(0);
    
    };

    def.$length = function() {
      
      
      return this.keys.length;
    
    };

    def['$member?'] = def['$has_key?'];

    def.$merge = TMP_8 = function(other) {
      var block;
      block = TMP_8._p || nil, TMP_8._p = null;
      
      
      var keys = this.keys, map = this.map,
          result = __hash(), keys2 = result.keys, map2 = result.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        keys2.push(key);
        map2[key] = map[key];
      }

      var keys = other.keys, map = other.map;

      if (block === nil) {
        for (var i = 0, length = keys.length; i < length; i++) {
          var key = keys[i];

          if (map2[key] == null) {
            keys2.push(key);
          }

          map2[key] = map[key];
        }
      }
      else {
        for (var i = 0, length = keys.length; i < length; i++) {
          var key = keys[i];

          if (map2[key] == null) {
            keys2.push(key);
            map2[key] = map[key];
          }
          else {
            map2[key] = block(key, map2[key], map[key]);
          }
        }
      }

      return result;
    
    };

    def['$merge!'] = TMP_9 = function(other) {
      var block;
      block = TMP_9._p || nil, TMP_9._p = null;
      
      
      var keys = this.keys, map = this.map,
          keys2 = other.keys, map2 = other.map;

      if (block === nil) {
        for (var i = 0, length = keys2.length; i < length; i++) {
          var key = keys2[i];

          if (map[key] == null) {
            keys.push(key);
          }

          map[key] = map2[key];
        }
      }
      else {
        for (var i = 0, length = keys2.length; i < length; i++) {
          var key = keys2[i];

          if (map[key] == null) {
            keys.push(key);
            map[key] = map2[key];
          }
          else {
            map[key] = block(key, map[key], map2[key]);
          }
        }
      }

      return this;
    
    };

    def.$rassoc = function(object) {
      var $a;
      
      var keys = this.keys, map = this.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((($a = (obj))['$=='] || $mm('==')).call($a, object)) {
          return [key, obj];
        }
      }

      return nil;
    
    };

    def.$reject = TMP_10 = function() {
      var block;
      block = TMP_10._p || nil, TMP_10._p = null;
      
      
      var keys = this.keys, map = this.map,
          result = __hash(), map2 = result.map, keys2 = result.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key], value;

        if ((value = block(key, obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value === false || value === nil) {
          keys2.push(key);
          map2[key] = obj;
        }
      }

      return result;
    
    };

    def.$replace = function(other) {
      
      
      var map = this.map = {}, keys = this.keys = [];

      for (var i = 0, length = other.keys.length; i < length; i++) {
        var key = other.keys[i];
        keys.push(key);
        map[key] = other.map[key];
      }

      return this;
    
    };

    def.$select = TMP_11 = function() {
      var block;
      block = TMP_11._p || nil, TMP_11._p = null;
      
      
      var keys = this.keys, map = this.map,
          result = __hash(), map2 = result.map, keys2 = result.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key], value;

        if ((value = block(key, obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value !== false && value !== nil) {
          keys2.push(key);
          map2[key] = obj;
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_12 = function() {
      var block;
      block = TMP_12._p || nil, TMP_12._p = null;
      
      
      var map = this.map, keys = this.keys, value, result = nil;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === __breaker) {
          return __breaker.$v;
        }

        if (value === false || value === nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
          result = this
        }
      }

      return result;
    
    };

    def.$shift = function() {
      
      
      var keys = this.keys, map = this.map;

      if (keys.length) {
        var key = keys[0], obj = map[key];

        delete map[key];
        keys.splice(0, 1);

        return [key, obj];
      }

      return nil;
    
    };

    def.$size = def.$length;

    def.$to_a = function() {
      
      
      var keys = this.keys, map = this.map, result = [];

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];
        result.push([key, map[key]]);
      }

      return result;
    
    };

    def.$to_hash = function() {
      
      return this;
    };

    def.$to_json = function() {
      var $a, $b;
      
      var inspect = [], keys = this.keys, map = this.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];
        inspect.push((($a = (key)).$to_json || $mm('to_json')).call($a) + ': ' + (($b = (map[key])).$to_json || $mm('to_json')).call($b));
      }

      return '{' + inspect.join(', ') + '}';
    
    };

    def.$to_native = function() {
      var $a;
      
      var result = {}, keys = this.keys, map = this.map, bucket, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if (obj.$to_native) {
          result[key] = (($a = (obj)).$to_native || $mm('to_native')).call($a);
        }
        else {
          result[key] = obj;
        }
      }

      return result;
    
    };

    def.$to_s = def.$inspect;

    def.$update = def['$merge!'];

    def['$value?'] = function(value) {
      var $a;
      
      var map = this.map;

      for (var assoc in map) {
        var v = map[assoc];
        if ((($a = (v))['$=='] || $mm('==')).call($a, value)) {
          return true;
        }
      }

      return false;
    
    };

    def.$values_at = def.$indexes;

    def.$values = function() {
      
      
      var map    = this.map,
          result = [];

      for (var key in map) {
        result.push(map[key]);
      }

      return result;
    
    };

    return nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var $a, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass, __gvars = __opal.gvars;
  (function(__base, __super){
    function String() {};
    String = __klass(__base, __super, "String", String);

    var def = String.prototype, __scope = String._scope, $a, $b, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;

    (($a = String).$include || $mm('include')).call($a, (($b = __scope.Comparable) == null ? __opal.cm("Comparable") : $b));

    def._isString = true;

    __opal.defs(String, '$try_convert', function(what) {
      var $a;
      try {
        return (($a = what).$to_str || $mm('to_str')).call($a)
      } catch ($err) {
      if (true) {
        nil}
      else { throw $err; }
      }
    });

    __opal.defs(String, '$new', function(str) {
      if (str == null) {
        str = ""
      }
      
      return new String(str)
    ;
    });

    def['$%'] = function(data) {
      var $a, $b, $c;
      if (($a = (($b = data)['$is_a?'] || $mm('is_a?')).call($b, (($c = __scope.Array) == null ? __opal.cm("Array") : $c))) !== false && $a !== nil) {
        return (($a = this).$format || $mm('format')).apply($a, [this].concat(data))
        } else {
        return (($c = this).$format || $mm('format')).call($c, this, data)
      };
    };

    def['$*'] = function(count) {
      
      
      if (count < 1) {
        return '';
      }

      var result  = '',
          pattern = this.valueOf();

      while (count > 0) {
        if (count & 1) {
          result += pattern;
        }

        count >>= 1, pattern += pattern;
      }

      return result;
    
    };

    def['$+'] = function(other) {
      
      return this.toString() + other;
    };

    def['$<=>'] = function(other) {
      
      
      if (typeof other !== 'string') {
        return nil;
      }

      return this > other ? 1 : (this < other ? -1 : 0);
    
    };

    def['$<'] = function(other) {
      
      return this < other;
    };

    def['$<='] = function(other) {
      
      return this <= other;
    };

    def['$>'] = function(other) {
      
      return this > other;
    };

    def['$>='] = function(other) {
      
      return this >= other;
    };

    def['$=='] = function(other) {
      
      return other == String(this);
    };

    def['$==='] = def['$=='];

    def['$=~'] = function(other) {
      var $a, $b;
      
      if (typeof other === 'string') {
        (($a = this).$raise || $mm('raise')).call($a, "string given");
      }

      return (($b = other)['$=~'] || $mm('=~')).call($b, this);
    
    };

    def['$[]'] = function(index, length) {
      
      
      var size = this.length;

      if (index._isRange) {
        var exclude = index.exclude,
            length  = index.end,
            index   = index.begin;

        if (index < 0) {
          index += size;
        }

        if (length < 0) {
          length += size;
        }

        if (!exclude) {
          length += 1;
        }

        if (index > size) {
          return nil;
        }

        length = length - index;

        if (length < 0) {
          length = 0;
        }

        return this.substr(index, length);
      }

      if (index < 0) {
        index += this.length;
      }

      if (length == null) {
        if (index >= this.length || index < 0) {
          return nil;
        }

        return this.substr(index, 1);
      }

      if (index > this.length || index < 0) {
        return nil;
      }

      return this.substr(index, length);
    
    };

    def.$as_json = function() {
      
      return this;
    };

    def.$capitalize = function() {
      
      return this.charAt(0).toUpperCase() + this.substr(1).toLowerCase();
    };

    def.$casecmp = function(other) {
      
      
      if (typeof other !== 'string') {
        return other;
      }

      var a = this.toLowerCase(),
          b = other.toLowerCase();

      return a > b ? 1 : (a < b ? -1 : 0);
    
    };

    def.$center = function(width, padstr) {
      var $a, $b, $c, $d, $e, $f, $g, $h, $i, $j;if (padstr == null) {
        padstr = " "
      }
      
      if (width <= this.length) {
        return this;
      }
      else {
        var ljustified = (($a = this).$ljust || $mm('ljust')).call($a, (($b = ($c = ($e = width, $f = (($g = this).$size || $mm('size')).call($g), typeof($e) === 'number' ? $e + $f : $e['$+']($f)), $d = 2, typeof($c) === 'number' ? $c / $d : $c['$/']($d))).$floor || $mm('floor')).call($b), padstr);
        var rjustified = (($c = this).$rjust || $mm('rjust')).call($c, (($d = ($e = ($h = width, $i = (($j = this).$size || $mm('size')).call($j), typeof($h) === 'number' ? $h + $i : $h['$+']($i)), $f = 2, typeof($e) === 'number' ? $e / $f : $e['$/']($f))).$ceil || $mm('ceil')).call($d), padstr);
        return ljustified + rjustified.slice(this.length);
      }
    
    };

    def.$chars = TMP_1 = function() {
      var __yield;
      __yield = TMP_1._p || nil, TMP_1._p = null;
      
      
      for (var i = 0, length = this.length; i < length; i++) {
        if (__yield.call(null, this.charAt(i)) === __breaker) return __breaker.$v
      }
    
    };

    def.$chomp = function(separator) {
      if (separator == null) {
        separator = __gvars["/"]
      }
      
      var strlen = this.length;
      var seplen = separator.length;
      if (strlen > 0) {
        if (separator === "\n") {
          var last = this.charAt(strlen - 1);
          if (last === "\n" || last == "\r") {
            var result = this.substr(0, strlen - 1);
            if (strlen > 1 && this.charAt(strlen - 2) === "\r") {
              result = this.substr(0, strlen - 2);
            } 
            return result;
          }
        }
        else if (separator === "") {
          return this.replace(/(?:\n|\r\n)+$/, '');
        }
        else if (strlen >= seplen) {
          var tail = this.substr(-1 * seplen);
          if (tail === separator) {
            return this.substr(0, strlen - seplen);
          }
        }
      }
      return this
    
    };

    def.$chop = function() {
      
      return this.substr(0, this.length - 1);
    };

    def.$chr = function() {
      
      return this.charAt(0);
    };

    def.$clone = function() {
      
      return this.slice();
    };

    def.$count = function(str) {
      
      return (this.length - this.replace(new RegExp(str,"g"), '').length) / str.length;
    };

    def.$dup = def.$clone;

    def.$downcase = def.toLowerCase;

    def.$each_char = def.$chars;

    def.$each_line = TMP_2 = function(separator) {
      var $a, $b, $c, $d, __yield;
      __yield = TMP_2._p || nil, TMP_2._p = null;
      if (separator == null) {
        separator = __gvars["/"]
      }
      if (__yield === nil) {
        return (($a = (($b = this).$split || $mm('split')).call($b, separator)).$each || $mm('each')).call($a)
      };
      
      var chomped = (($c = this).$chomp || $mm('chomp')).call($c);
      var trailing_separator = this.length != chomped.length
      var splitted = chomped.split(separator);

      if (!(__yield !== nil)) {
        result = []
        for (var i = 0, length = splitted.length; i < length; i++) {
          if (i < length - 1 || trailing_separator) {
            result.push(splitted[i] + separator);
          }
          else {
            result.push(splitted[i]);
          }
        }

        return (($d = (result)).$each || $mm('each')).call($d);
      }

      for (var i = 0, length = splitted.length; i < length; i++) {
        if (i < length - 1 || trailing_separator) {
          if (__yield.call(null, splitted[i] + separator) === __breaker) return __breaker.$v
        }
        else {
          if (__yield.call(null, splitted[i]) === __breaker) return __breaker.$v
        }
      }
    
    };

    def['$empty?'] = function() {
      
      return this.length === 0;
    };

    def['$end_with?'] = function(suffixes) {
      suffixes = __slice.call(arguments, 0);
      
      for (var i = 0, length = suffixes.length; i < length; i++) {
        var suffix = suffixes[i];

        if (this.length >= suffix.length && this.substr(0 - suffix.length) === suffix) {
          return true;
        }
      }

      return false;
    
    };

    def['$eql?'] = def['$=='];

    def['$equal?'] = function(val) {
      
      return this.toString() === val.toString();
    };

    def.$getbyte = def.charCodeAt;

    def.$gsub = TMP_3 = function(pattern, replace) {
      var $a, $b, $c, block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      if (($a = (($b = pattern)['$is_a?'] || $mm('is_a?')).call($b, (($c = __scope.String) == null ? __opal.cm("String") : $c))) !== false && $a !== nil) {
        pattern = (new RegExp("" + (($a = (($c = __scope.Regexp) == null ? __opal.cm("Regexp") : $c)).$escape || $mm('escape')).call($a, pattern)))
      };
      
      var pattern = pattern.toString(),
          options = pattern.substr(pattern.lastIndexOf('/') + 1) + 'g',
          regexp  = pattern.substr(1, pattern.lastIndexOf('/') - 1);

      this.$sub._p = block;
      return this.$sub(new RegExp(regexp, options), replace);
    
    };

    def.$hash = def.toString;

    def.$hex = function() {
      var $a;
      return (($a = this).$to_i || $mm('to_i')).call($a, 16);
    };

    def['$include?'] = function(other) {
      
      return this.indexOf(other) !== -1;
    };

    def.$index = function(what, offset) {
      var $a, $b, $c, $d, $e;
      
      if (!what._isString && !what._isRegexp) {
        throw new Error('type mismatch');
      }

      var result = -1;

      if (offset != null) {
        if (offset < 0) {
          offset = this.length - offset;
        }

        if ((($a = what)['$is_a?'] || $mm('is_a?')).call($a, (($b = __scope.Regexp) == null ? __opal.cm("Regexp") : $b))) {
          result = (($b = (($c = what)['$=~'] || $mm('=~')).call($c, this.substr(offset))), $b !== false && $b !== nil ? $b : -1)
        }
        else {
          result = this.substr(offset).indexOf(substr);
        }

        if (result !== -1) {
          result += offset;
        }
      }
      else {
        if ((($b = what)['$is_a?'] || $mm('is_a?')).call($b, (($d = __scope.Regexp) == null ? __opal.cm("Regexp") : $d))) {
          result = (($d = (($e = what)['$=~'] || $mm('=~')).call($e, this)), $d !== false && $d !== nil ? $d : -1)
        }
        else {
          result = this.indexOf(substr);
        }
      }

      return result === -1 ? nil : result;
    
    };

    def.$inspect = function() {
      
      
      var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
          meta      = {
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"' : '\\"',
            '\\': '\\\\'
          };

      escapable.lastIndex = 0;

      return escapable.test(this) ? '"' + this.replace(escapable, function(a) {
        var c = meta[a];

        return typeof c === 'string' ? c :
          '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
      }) + '"' : '"' + this + '"';
  
    };

    def.$intern = function() {
      
      return this;
    };

    def.$lines = def.$each_line;

    def.$length = function() {
      
      return this.length;
    };

    def.$ljust = function(width, padstr) {
      if (padstr == null) {
        padstr = " "
      }
      
      if (width <= this.length) {
          return this;
      }
      else {
        var n_chars = Math.floor(width - this.length)
        var n_patterns = Math.floor(n_chars/padstr.length);
        var result = Array(n_patterns + 1).join(padstr);
        var remaining = n_chars - result.length;
        return result + padstr.slice(0, remaining) + this;
      }
    
    };

    def.$lstrip = function() {
      
      return this.replace(/^\s*/, '');
    };

    def.$match = TMP_4 = function(pattern, pos) {
      var $a, $b, $c, $d, $e, $f, block;
      block = TMP_4._p || nil, TMP_4._p = null;
      
      return ($b = (($c = (function() { if (($d = (($e = pattern)['$is_a?'] || $mm('is_a?')).call($e, (($f = __scope.Regexp) == null ? __opal.cm("Regexp") : $f))) !== false && $d !== nil) {
        return pattern
        } else {
        return (new RegExp("" + (($d = (($f = __scope.Regexp) == null ? __opal.cm("Regexp") : $f)).$escape || $mm('escape')).call($d, pattern)))
      }; return nil; }).call(this)).$match || $mm('match')), $b._p = (($a = block).$to_proc || $mm('to_proc')).call($a), $b).call($c, this, pos);
    };

    def.$next = function() {
      
      
      if (this.length === 0) {
        return "";
      }

      var initial = this.substr(0, this.length - 1);
      var last    = String.fromCharCode(this.charCodeAt(this.length - 1) + 1);

      return initial + last;
    
    };

    def.$ord = function() {
      
      return this.charCodeAt(0);
    };

    def.$partition = function(str) {
      
      
      var result = this.split(str);
      var splitter = (result[0].length === this.length ? "" : str);

      return [result[0], splitter, result.slice(1).join(str.toString())];
    
    };

    def.$reverse = function() {
      
      return this.split('').reverse().join('');
    };

    def.$rindex = function(search, offset) {
      var $a, $b, $c;
      
      var search_type = (search == null ? Opal.NilClass : search.$class());
      if (search_type != String && search_type != RegExp) {
        var msg = "type mismatch: " + search_type + " given";
        (($a = this).$raise || $mm('raise')).call($a, (($b = (($c = __scope.TypeError) == null ? __opal.cm("TypeError") : $c)).$new || $mm('new')).call($b, msg));
      }

      if (this.length == 0) {
        return search.length == 0 ? 0 : nil;
      }

      var result = -1;
      if (offset != null) {
        if (offset < 0) {
          offset = this.length + offset;
        }

        if (search_type == String) {
          result = this.lastIndexOf(search, offset);
        }
        else {
          result = this.substr(0, offset + 1).$reverse().search(search);
          if (result !== -1) {
            result = offset - result;
          }
        }
      }
      else {
        if (search_type == String) {
          result = this.lastIndexOf(search);
        }
        else {
          result = this.$reverse().search(search); 
          if (result !== -1) {
            result = this.length - 1 - result;
          }
        }
      }

      return result === -1 ? nil : result;
    
    };

    def.$rjust = function(width, padstr) {
      var $a;if (padstr == null) {
        padstr = " "
      }
      
      if (width <= this.length) {
          return this;
      }
      else {
          var ljustified = (($a = this).$ljust || $mm('ljust')).call($a, width, padstr);
          return this + ljustified.slice(0, -this.length);
      }
    
    };

    def.$rstrip = function() {
      
      return this.replace(/\s*$/, '');
    };

    def.$scan = TMP_5 = function(pattern) {
      var $a, $b, block;
      block = TMP_5._p || nil, TMP_5._p = null;
      
      
      if (pattern.global) {
        // should we clear it afterwards too?
        pattern.lastIndex = 0;
      }
      else {
        // rewrite regular expression to add the global flag to capture pre/post match
        pattern = new RegExp(pattern.source, 'g' + (pattern.multiline ? 'm' : '') + (pattern.ignoreCase ? 'i' : ''));
      }

      var result = [];
      var match;

      while ((match = pattern.exec(this)) != null) {
        var match_data = (($a = (($b = __scope.MatchData) == null ? __opal.cm("MatchData") : $b)).$new || $mm('new')).call($a, pattern, match);
        if (block === nil) {
          match.length == 1 ? result.push(match[0]) : result.push(match.slice(1));
        }
        else {
          match.length == 1 ? block(match[0]) : block.apply(this, match.slice(1));
        }
      }

      return (block !== nil ? this : result);
    
    };

    def.$size = def.$length;

    def.$slice = def['$[]'];

    def.$split = function(pattern, limit) {
      var $a;if (pattern == null) {
        pattern = (($a = __gvars[";"]), $a !== false && $a !== nil ? $a : " ")
      }
      return this.split(pattern, limit);
    };

    def['$start_with?'] = function(prefixes) {
      prefixes = __slice.call(arguments, 0);
      
      for (var i = 0, length = prefixes.length; i < length; i++) {
        if (this.indexOf(prefixes[i]) === 0) {
          return true;
        }
      }

      return false;
    
    };

    def.$strip = function() {
      
      return this.replace(/^\s*/, '').replace(/\s*$/, '');
    };

    def.$sub = TMP_6 = function(pattern, replace) {
      var $a, $b, $c, $d, $e, $f, $g, $h, block;
      block = TMP_6._p || nil, TMP_6._p = null;
      
      
      if (typeof(replace) === 'string') {
        // convert Ruby back reference to JavaScript back reference
        replace = replace.replace(/\\([1-9])/g, '$$$1')
        return this.replace(pattern, replace);
      }
      if (block !== nil) {
        return this.replace(pattern, function() {
          // FIXME: this should be a formal MatchData object with all the goodies
          var match_data = []
          for (var i = 0, len = arguments.length; i < len; i++) {
            var arg = arguments[i];
            if (arg == undefined) {
              match_data.push(nil);
            }
            else {
              match_data.push(arg);
            }
          }

          var str = match_data.pop();
          var offset = match_data.pop();
          var match_len = match_data.length;

          // $1, $2, $3 not being parsed correctly in Ruby code
          //for (var i = 1; i < match_len; i++) {
          //  __gvars[String(i)] = match_data[i];
          //}
          __gvars["&"] = match_data[0];
          __gvars["~"] = match_data;
          return block(match_data[0]);
        });
      }
      else if (replace !== undefined) {
        if ((($a = replace)['$is_a?'] || $mm('is_a?')).call($a, (($b = __scope.Hash) == null ? __opal.cm("Hash") : $b))) {
          return this.replace(pattern, function(str) {
            var value = (($b = replace)['$[]'] || $mm('[]')).call($b, (($c = this).$str || $mm('str')).call($c));

            return (value == null) ? nil : (($d = (($e = this).$value || $mm('value')).call($e)).$to_s || $mm('to_s')).call($d);
          });
        }
        else {
          replace = (($f = (($g = __scope.String) == null ? __opal.cm("String") : $g)).$try_convert || $mm('try_convert')).call($f, replace);

          if (replace == null) {
            (($g = this).$raise || $mm('raise')).call($g, (($h = __scope.TypeError) == null ? __opal.cm("TypeError") : $h), "can't convert " + ((($h = replace).$class || $mm('class')).call($h)) + " into String");
          }

          return this.replace(pattern, replace);
        }
      }
      else {
        // convert Ruby back reference to JavaScript back reference
        replace = replace.toString().replace(/\\([1-9])/g, '$$$1')
        return this.replace(pattern, replace);
      }
    
    };

    def.$succ = def.$next;

    def.$sum = function(n) {
      if (n == null) {
        n = 16
      }
      
      var result = 0;

      for (var i = 0, length = this.length; i < length; i++) {
        result += (this.charCodeAt(i) % ((1 << n) - 1));
      }

      return result;
    
    };

    def.$swapcase = function() {
      var $a, $b;
      
      var str = this.replace(/([a-z]+)|([A-Z]+)/g, function($0,$1,$2) {
        return $1 ? $0.toUpperCase() : $0.toLowerCase();
      });

      if (this._klass === String) {
        return str;
      }

      return (($a = (($b = this).$class || $mm('class')).call($b)).$new || $mm('new')).call($a, str);
    
    };

    def.$to_a = function() {
      
      
      if (this.length === 0) {
        return [];
      }

      return [this];
    
    };

    def.$to_f = function() {
      
      
      var result = parseFloat(this);

      return isNaN(result) ? 0 : result;
    
    };

    def.$to_i = function(base) {
      if (base == null) {
        base = 10
      }
      
      var result = parseInt(this, base);

      if (isNaN(result)) {
        return 0;
      }

      return result;
    
    };

    def.$to_json = def.$inspect;

    def.$to_proc = function() {
      
      
      var name = '$' + this;

      return function(arg) {
        var meth = arg[name];
        return meth ? meth.call(arg) : arg.$method_missing(name);
      };
    
    };

    def.$to_s = def.toString;

    def.$to_str = def.$to_s;

    def.$to_sym = def.$intern;

    def.$tr = function(from, to) {
      
      
      if (from.length == 0 || from === to) {
        return this;
      }

      var subs = {};
      var from_chars = from.split('');
      var from_length = from_chars.length;
      var to_chars = to.split('');
      var to_length = to_chars.length;

      var inverse = false;
      var global_sub = null;
      if (from_chars[0] === '^') {
        inverse = true;
        from_chars.shift();
        global_sub = to_chars[to_length - 1]
        from_length -= 1;
      }

      var from_chars_expanded = [];
      var last_from = null;
      var in_range = false;
      for (var i = 0; i < from_length; i++) {
        var char = from_chars[i];
        if (last_from == null) {
          last_from = char;
          from_chars_expanded.push(char);
        }
        else if (char === '-') {
          if (last_from === '-') {
            from_chars_expanded.push('-');
            from_chars_expanded.push('-');
          }
          else if (i == from_length - 1) {
            from_chars_expanded.push('-');
          }
          else {
            in_range = true;
          }
        }
        else if (in_range) {
          var start = last_from.charCodeAt(0) + 1;
          var end = char.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(char);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(char);
        }
      }

      from_chars = from_chars_expanded;
      from_length = from_chars.length;

      if (inverse) {
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = true;
        }
      }
      else {
        if (to_length > 0) {
          var to_chars_expanded = [];
          var last_to = null;
          var in_range = false;
          for (var i = 0; i < to_length; i++) {
            var char = to_chars[i];
            if (last_from == null) {
              last_from = char;
              to_chars_expanded.push(char);
            }
            else if (char === '-') {
              if (last_to === '-') {
                to_chars_expanded.push('-');
                to_chars_expanded.push('-');
              }
              else if (i == to_length - 1) {
                to_chars_expanded.push('-');
              }
              else {
                in_range = true;
              }
            }
            else if (in_range) {
              var start = last_from.charCodeAt(0) + 1;
              var end = char.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(char);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(char);
            }
          }

          to_chars = to_chars_expanded;
          to_length = to_chars.length;
        }

        var length_diff = from_length - to_length;
        if (length_diff > 0) {
          var pad_char = (to_length > 0 ? to_chars[to_length - 1] : '');
          for (var i = 0; i < length_diff; i++) {
            to_chars.push(pad_char);
          }
        }
        
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = to_chars[i];
        }
      }

      var new_str = ''
      for (var i = 0, length = this.length; i < length; i++) {
        var char = this.charAt(i);
        var sub = subs[char];
        if (inverse) {
          new_str += (sub == null ? global_sub : char);
        }
        else {
          new_str += (sub != null ? sub : char);
        }
      }
      return new_str;
    
    };

    def.$tr_s = function(from, to) {
      
      
      if (from.length == 0) {
        return this;
      }

      var subs = {};
      var from_chars = from.split('');
      var from_length = from_chars.length;
      var to_chars = to.split('');
      var to_length = to_chars.length;

      var inverse = false;
      var global_sub = null;
      if (from_chars[0] === '^') {
        inverse = true;
        from_chars.shift();
        global_sub = to_chars[to_length - 1]
        from_length -= 1;
      }

      var from_chars_expanded = [];
      var last_from = null;
      var in_range = false;
      for (var i = 0; i < from_length; i++) {
        var char = from_chars[i];
        if (last_from == null) {
          last_from = char;
          from_chars_expanded.push(char);
        }
        else if (char === '-') {
          if (last_from === '-') {
            from_chars_expanded.push('-');
            from_chars_expanded.push('-');
          }
          else if (i == from_length - 1) {
            from_chars_expanded.push('-');
          }
          else {
            in_range = true;
          }
        }
        else if (in_range) {
          var start = last_from.charCodeAt(0) + 1;
          var end = char.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(char);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(char);
        }
      }

      from_chars = from_chars_expanded;
      from_length = from_chars.length;

      if (inverse) {
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = true;
        }
      }
      else {
        if (to_length > 0) {
          var to_chars_expanded = [];
          var last_to = null;
          var in_range = false;
          for (var i = 0; i < to_length; i++) {
            var char = to_chars[i];
            if (last_from == null) {
              last_from = char;
              to_chars_expanded.push(char);
            }
            else if (char === '-') {
              if (last_to === '-') {
                to_chars_expanded.push('-');
                to_chars_expanded.push('-');
              }
              else if (i == to_length - 1) {
                to_chars_expanded.push('-');
              }
              else {
                in_range = true;
              }
            }
            else if (in_range) {
              var start = last_from.charCodeAt(0) + 1;
              var end = char.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(char);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(char);
            }
          }

          to_chars = to_chars_expanded;
          to_length = to_chars.length;
        }

        var length_diff = from_length - to_length;
        if (length_diff > 0) {
          var pad_char = (to_length > 0 ? to_chars[to_length - 1] : '');
          for (var i = 0; i < length_diff; i++) {
            to_chars.push(pad_char);
          }
        }
        
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = to_chars[i];
        }
      }
      var new_str = ''
      var last_substitute = null
      for (var i = 0, length = this.length; i < length; i++) {
        var char = this.charAt(i);
        var sub = subs[char]
        if (inverse) {
          if (sub == null) {
            if (last_substitute == null) {
              new_str += global_sub;
              last_substitute = true;
            }
          }
          else {
            new_str += char;
            last_substitute = null;
          }
        }
        else {
          if (sub != null) {
            if (last_substitute == null || last_substitute !== sub) {
              new_str += sub;
              last_substitute = sub;
            }
          }
          else {
            new_str += char;
            last_substitute = null;
          }
        }
      }
      return new_str;
    
    };

    return def.$upcase = def.toUpperCase;
  })(self, null);
  __scope.Symbol = (($a = __scope.String) == null ? __opal.cm("String") : $a);
  return (function(__base, __super){
    function MatchData() {};
    MatchData = __klass(__base, __super, "MatchData", MatchData);

    var def = MatchData.prototype, __scope = MatchData._scope;
    def.post_match = def.pre_match = def.regexp = def.string = nil;

    def.$post_match = function() {
      
      return this.post_match
    }, 
    def.$pre_match = function() {
      
      return this.pre_match
    }, 
    def.$regexp = function() {
      
      return this.regexp
    }, 
    def.$string = function() {
      
      return this.string
    }, nil;

    __opal.defs(MatchData, '$new', function(regexp, match_groups) {
      
      
      var instance = new Opal.MatchData;
      for (var i = 0, len = match_groups.length; i < len; i++) {
        var group = match_groups[i];
        if (group == undefined) {
          instance.push(nil);
        }
        else {
          instance.push(group);
        }
      }
      instance._begin = match_groups.index;
      instance.regexp = regexp;
      instance.string = match_groups.input;
      instance.pre_match = __gvars["`"] = instance.string.substr(0, regexp.lastIndex - instance[0].length);
      instance.post_match = __gvars["'"] = instance.string.substr(regexp.lastIndex);
      return __gvars["~"] = instance;
    
    });

    def.$begin = function(pos) {
      var $a, $b;
      
      if (pos == 0 || pos == 1) {
        return this._begin;
      }
      else {
        (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.ArgumentError) == null ? __opal.cm("ArgumentError") : $b), "MatchData#begin only supports 0th element");
      }
    
    };

    def.$captures = function() {
      
      return this.slice(1);
    };

    def.$inspect = function() {
      
      
      var str = "<#MatchData " + this[0].$inspect()
      for (var i = 1, len = this.length; i < len; i++) {
        str += " " + i + ":" + this[i].$inspect();
      }
      str += ">";
      return str;
    
    };

    def.$to_s = function() {
      
      return this[0];
    };

    def.$values_at = function(indexes) {
      indexes = __slice.call(arguments, 0);
      
      var vals = [];
      var match_length = this.length;
      for (var i = 0, length = indexes.length; i < length; i++) {
        var pos = indexes[i];
        if (pos >= 0) {
          vals.push(this[pos]);
        }
        else {
          pos = match_length + pos;
          if (pos > 0) {
            vals.push(this[pos]);
          }
          else {
            vals.push(nil);
          }
        }
      }

      return vals;
    
    };

    return nil;
  })(self, (($a = __scope.Array) == null ? __opal.cm("Array") : $a));
})(Opal);
(function(__opal) {
  var $a, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  (function(__base, __super){
    function Numeric() {};
    Numeric = __klass(__base, __super, "Numeric", Numeric);

    var def = Numeric.prototype, __scope = Numeric._scope, $a, $b, TMP_1, TMP_2, TMP_3;

    (($a = Numeric).$include || $mm('include')).call($a, (($b = __scope.Comparable) == null ? __opal.cm("Comparable") : $b));

    def._isNumber = true;

    def['$+'] = function(other) {
      
      return this + other;
    };

    def['$-'] = function(other) {
      
      return this - other;
    };

    def['$*'] = function(other) {
      
      return this * other;
    };

    def['$/'] = function(other) {
      
      return this / other;
    };

    def['$%'] = function(other) {
      
      return this % other;
    };

    def['$&'] = function(other) {
      
      return this & other;
    };

    def['$|'] = function(other) {
      
      return this | other;
    };

    def['$^'] = function(other) {
      
      return this ^ other;
    };

    def['$<'] = function(other) {
      
      return this < other;
    };

    def['$<='] = function(other) {
      
      return this <= other;
    };

    def['$>'] = function(other) {
      
      return this > other;
    };

    def['$>='] = function(other) {
      
      return this >= other;
    };

    def['$<<'] = function(count) {
      
      return this << count;
    };

    def['$>>'] = function(count) {
      
      return this >> count;
    };

    def['$+@'] = function() {
      
      return +this;
    };

    def['$-@'] = function() {
      
      return -this;
    };

    def['$~'] = function() {
      
      return ~this;
    };

    def['$**'] = function(other) {
      
      return Math.pow(this, other);
    };

    def['$=='] = function(other) {
      
      return this == other;
    };

    def['$<=>'] = function(other) {
      
      
      if (typeof(other) !== 'number') {
        return nil;
      }

      return this < other ? -1 : (this > other ? 1 : 0);
    
    };

    def.$abs = function() {
      
      return Math.abs(this);
    };

    def.$as_json = function() {
      
      return this;
    };

    def.$ceil = function() {
      
      return Math.ceil(this);
    };

    def.$chr = function() {
      
      return String.fromCharCode(this);
    };

    def.$downto = TMP_1 = function(finish) {
      var block;
      block = TMP_1._p || nil, TMP_1._p = null;
      
      
      for (var i = this; i >= finish; i--) {
        if (block(i) === __breaker) {
          return __breaker.$v;
        }
      }

      return this;
    
    };

    def['$eql?'] = def['$=='];

    def['$even?'] = function() {
      
      return this % 2 === 0;
    };

    def.$floor = function() {
      
      return Math.floor(this);
    };

    def.$hash = function() {
      
      return this.toString();
    };

    def['$integer?'] = function() {
      
      return this % 1 === 0;
    };

    def.$magnitude = def.$abs;

    def.$modulo = def['$%'];

    def.$next = function() {
      
      return this + 1;
    };

    def['$nonzero?'] = function() {
      
      return this === 0 ? nil : this;
    };

    def['$odd?'] = function() {
      
      return this % 2 !== 0;
    };

    def.$ord = function() {
      
      return this;
    };

    def.$pred = function() {
      
      return this - 1;
    };

    def.$succ = def.$next;

    def.$times = TMP_2 = function() {
      var block;
      block = TMP_2._p || nil, TMP_2._p = null;
      
      
      for (var i = 0; i < this; i++) {
        if (block(i) === __breaker) {
          return __breaker.$v;
        }
      }

      return this;
    
    };

    def.$to_f = function() {
      
      return parseFloat(this);
    };

    def.$to_i = function() {
      
      return parseInt(this);
    };

    def.$to_json = function() {
      
      return this.toString();
    };

    def.$to_s = function(base) {
      if (base == null) {
        base = 10
      }
      return this.toString();
    };

    def.$upto = TMP_3 = function(finish) {
      var $a, block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      if (block === nil) {
        return (($a = this).$enum_for || $mm('enum_for')).call($a, "upto", finish)
      };
      
      for (var i = this; i <= finish; i++) {
        if (block(i) === __breaker) {
          return __breaker.$v;
        }
      }

      return this;
    
    };

    def['$zero?'] = function() {
      
      return this == 0;
    };

    return nil;
  })(self, null);
  return __scope.Fixnum = (($a = __scope.Numeric) == null ? __opal.cm("Numeric") : $a);
})(Opal);
(function(__opal) {
  var $a, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  (function(__base, __super){
    function Proc() {};
    Proc = __klass(__base, __super, "Proc", Proc);

    var def = Proc.prototype, __scope = Proc._scope, TMP_1;

    def._isProc = true;

    def.is_lambda = true;

    __opal.defs(Proc, '$new', TMP_1 = function() {
      var block;
      block = TMP_1._p || nil, TMP_1._p = null;
      
      if (block === nil) no_block_given();
      block.is_lambda = false;
      return block;
    });

    def.$call = function(args) {
      args = __slice.call(arguments, 0);
      
      var result = this.apply(null, args);

      if (result === __breaker) {
        return __breaker.$v;
      }

      return result;
    
    };

    def['$[]'] = def.$call;

    def.$to_proc = function() {
      
      return this;
    };

    def['$lambda?'] = function() {
      
      return !!this.is_lambda;
    };

    def.$arity = function() {
      
      return this.length - 1;
    };

    return nil;
  })(self, null);
  return (function(__base, __super){
    function Method() {};
    Method = __klass(__base, __super, "Method", Method);

    var def = Method.prototype, __scope = Method._scope;

    return nil
  })(self, (($a = __scope.Proc) == null ? __opal.cm("Proc") : $a));
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Range() {};
    Range = __klass(__base, __super, "Range", Range);

    var def = Range.prototype, __scope = Range._scope, $a, $b, TMP_1;
    def.begin = def.end = nil;

    (($a = Range).$include || $mm('include')).call($a, (($b = __scope.Enumerable) == null ? __opal.cm("Enumerable") : $b));

    
    Range.prototype._isRange = true;

    Opal.range = function(beg, end, exc) {
      var range         = new Range;
          range.begin   = beg;
          range.end     = end;
          range.exclude = exc;

      return range;
    };
  

    def.$begin = function() {
      
      return this.begin
    }, nil;

    def.$end = function() {
      
      return this.end
    }, nil;

    def.$initialize = function(min, max, exclude) {
      if (exclude == null) {
        exclude = false
      }
      this.begin = min;
      this.end = max;
      return this.exclude = exclude;
    };

    def['$=='] = function(other) {
      
      
      if (!other._isRange) {
        return false;
      }

      return this.exclude === other.exclude && this.begin == other.begin && this.end == other.end;
    
    };

    def['$==='] = function(obj) {
      
      return obj >= this.begin && (this.exclude ? obj < this.end : obj <= this.end);
    };

    def['$cover?'] = function(value) {
      var $a, $b, $c, $d, $e, $f;
      return (($a = (($b = (this.begin))['$<='] || $mm('<=')).call($b, value)) ? (($c = value)['$<='] || $mm('<=')).call($c, (function() { if (($d = (($e = this)['$exclude_end?'] || $mm('exclude_end?')).call($e)) !== false && $d !== nil) {
        return ($d = this.end, $f = 1, typeof($d) === 'number' ? $d - $f : $d['$-']($f))
        } else {
        return this.end;
      }; return nil; }).call(this)) : $a);
    };

    def.$each = TMP_1 = function() {
      var current = nil, $a, $b, $c, $d, $e, $f, block;
      block = TMP_1._p || nil, TMP_1._p = null;
      
      current = (($a = this).$min || $mm('min')).call($a);
      while (($c = ($d = (($e = current)['$=='] || $mm('==')).call($e, (($f = this).$max || $mm('max')).call($f)), ($d === nil || $d === false))) !== false && $c !== nil){if (block.call(null, current) === __breaker) return __breaker.$v;
      current = (($c = current).$succ || $mm('succ')).call($c);};
      if (($b = (($d = this)['$exclude_end?'] || $mm('exclude_end?')).call($d)) === false || $b === nil) {
        if (block.call(null, current) === __breaker) return __breaker.$v
      };
      return this;
    };

    def['$eql?'] = function(other) {
      var $a, $b, $c, $d, $e, $f, $g, $h;
      if (($a = (($b = (($c = __scope.Range) == null ? __opal.cm("Range") : $c))['$==='] || $mm('===')).call($b, other)) === false || $a === nil) {
        return false
      };
      return ($a = (($a = (($c = (($d = this)['$exclude_end?'] || $mm('exclude_end?')).call($d))['$=='] || $mm('==')).call($c, (($e = other)['$exclude_end?'] || $mm('exclude_end?')).call($e))) ? (($f = (this.begin))['$eql?'] || $mm('eql?')).call($f, (($g = other).$begin || $mm('begin')).call($g)) : $a), $a !== false && $a !== nil ? (($a = (this.end))['$eql?'] || $mm('eql?')).call($a, (($h = other).$end || $mm('end')).call($h)) : $a);
    };

    def['$exclude_end?'] = function() {
      
      return this.exclude;
    };

    def['$include?'] = function(val) {
      
      return obj >= this.begin && obj <= this.end;
    };

    def.$max = def.$end;

    def.$min = def.$begin;

    def['$member?'] = def['$include?'];

    def.$step = function(n) {
      var $a, $b;if (n == null) {
        n = 1
      }
      return (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.NotImplementedError) == null ? __opal.cm("NotImplementedError") : $b));
    };

    def.$to_s = function() {
      
      return this.begin + (this.exclude ? '...' : '..') + this.end;
    };

    return def.$inspect = def.$to_s;
  })(self, null)
})(Opal);
(function(__opal) {
  var days_of_week = nil, short_days = nil, short_months = nil, long_months = nil, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  days_of_week = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  short_days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  short_months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  long_months = ["January", "Febuary", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return (function(__base, __super){
    function Time() {};
    Time = __klass(__base, __super, "Time", Time);

    var def = Time.prototype, __scope = Time._scope, $a, $b;

    (($a = Time).$include || $mm('include')).call($a, (($b = __scope.Comparable) == null ? __opal.cm("Comparable") : $b));

    __opal.defs(Time, '$at', function(seconds, frac) {
      if (frac == null) {
        frac = 0
      }
      return new Date(seconds * 1000 + frac);
    });

    __opal.defs(Time, '$new', function(year, month, day, hour, minute, second, millisecond) {
      
      
      switch (arguments.length) {
        case 1:
          return new Date(year);
        case 2:
          return new Date(year, month - 1);
        case 3:
          return new Date(year, month - 1, day);
        case 4:
          return new Date(year, month - 1, day, hour);
        case 5:
          return new Date(year, month - 1, day, hour, minute);
        case 6:
          return new Date(year, month - 1, day, hour, minute, second);
        case 7:
          return new Date(year, month - 1, day, hour, minute, second, millisecond);
        default:
          return new Date();
      }
    
    });

    __opal.defs(Time, '$now', function() {
      
      return new Date();
    });

    __opal.defs(Time, '$parse', function(str) {
      
      return Date.parse(str);
    });

    def['$+'] = function(other) {
      var $a, $b, $c, $d, $e;
      return (($a = (($b = __scope.Time) == null ? __opal.cm("Time") : $b)).$allocate || $mm('allocate')).call($a, ($b = (($d = this).$to_f || $mm('to_f')).call($d), $c = (($e = other).$to_f || $mm('to_f')).call($e), typeof($b) === 'number' ? $b + $c : $b['$+']($c)));
    };

    def['$-'] = function(other) {
      var $a, $b, $c, $d, $e;
      return (($a = (($b = __scope.Time) == null ? __opal.cm("Time") : $b)).$allocate || $mm('allocate')).call($a, ($b = (($d = this).$to_f || $mm('to_f')).call($d), $c = (($e = other).$to_f || $mm('to_f')).call($e), typeof($b) === 'number' ? $b - $c : $b['$-']($c)));
    };

    def['$<=>'] = function(other) {
      var $a, $b, $c;
      return (($a = (($b = this).$to_f || $mm('to_f')).call($b))['$<=>'] || $mm('<=>')).call($a, (($c = other).$to_f || $mm('to_f')).call($c));
    };

    def.$day = def.getDate;

    def['$eql?'] = function(other) {
      var $a, $b, $c;
      return ($a = (($a = other)['$is_a?'] || $mm('is_a?')).call($a, (($b = __scope.Time) == null ? __opal.cm("Time") : $b)), $a !== false && $a !== nil ? (($b = (($c = this)['$<=>'] || $mm('<=>')).call($c, other))['$zero?'] || $mm('zero?')).call($b) : $a);
    };

    def['$friday?'] = function() {
      
      return this.getDay() === 5;
    };

    def.$hour = def.getHours;

    def.$inspect = def.toString;

    def.$mday = def.$day;

    def.$min = def.getMinutes;

    def.$mon = function() {
      
      return this.getMonth() + 1;
    };

    def['$monday?'] = function() {
      
      return this.getDay() === 1;
    };

    def.$month = def.$mon;

    def['$saturday?'] = function() {
      
      return this.getDay() === 6;
    };

    def.$sec = def.getSeconds;

    def.$strftime = function(format) {
      if (format == null) {
        format = ""
      }
      
      var d = this;

      return format.replace(/%(-?.)/g, function(full, m) {
        switch (m) {
          case 'a': return short_days[d.getDay()];
          case 'A': return days_of_week[d.getDay()];
          case 'b': return short_months[d.getMonth()];
          case 'B': return long_months[d.getMonth()];
          case '-d': return d.getDate();
          case 'Y': return d.getFullYear();
          default: return m ;
        }
      });
    
    };

    def['$sunday?'] = function() {
      
      return this.getDay() === 0;
    };

    def['$thursday?'] = function() {
      
      return this.getDay() === 4;
    };

    def.$to_f = function() {
      
      return this.getTime() / 1000;
    };

    def.$to_i = function() {
      
      return parseInt(this.getTime() / 1000);
    };

    def.$to_s = def.$inspect;

    def['$tuesday?'] = function() {
      
      return this.getDay() === 2;
    };

    def.$wday = def.getDay;

    def['$wednesday?'] = function() {
      
      return this.getDay() === 3;
    };

    return def.$year = def.getFullYear;
  })(self, null);
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __hash2 = __opal.hash2;
  var json_parse = JSON.parse, __hasOwn = Object.prototype.hasOwnProperty;
  return (function(__base){
    function JSON() {};
    JSON = __module(__base, "JSON", JSON);
    var def = JSON.prototype, __scope = JSON._scope;

    __opal.defs(JSON, '$parse', function(source) {
      
      return to_opal(json_parse(source));
    });

    __opal.defs(JSON, '$from_object', function(js_object) {
      
      return to_opal(js_object);
    });

    
    function to_opal(value) {
      switch (typeof value) {
        case 'string':
          return value;

        case 'number':
          return value;

        case 'boolean':
          return !!value;

        case 'null':
          return nil;

        case 'object':
          if (!value) return nil;

          if (value._isArray) {
            var arr = [];

            for (var i = 0, ii = value.length; i < ii; i++) {
              arr.push(to_opal(value[i]));
            }

            return arr;
          }
          else {
            var hash = __hash2([], {}), v, map = hash.map, keys = hash.keys;

            for (var k in value) {
              if (__hasOwn.call(value, k)) {
                v = to_opal(value[k]);
                keys.push(k);
                map[k] = v;
              }
            }
          }

          return hash;
      }
    };
  
    
  })(self);
})(Opal);
(function(__opal) {
  var $a, $b, $c, $d, $e, $f, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, def = self._klass.prototype, __breaker = __opal.breaker, __slice = __opal.slice, __gvars = __opal.gvars, __hash2 = __opal.hash2;
  __gvars["&"] = __gvars["~"] = __gvars["`"] = __gvars["'"] = nil;
  __gvars[":"] = [];
  __gvars["/"] = "\n";
  __gvars["global"] = Opal.global;
  __gvars["window"] = __gvars["global"];
  __gvars["document"] = (($a = __gvars["window"]).$document || $mm('document')).call($a);
  __scope.ARGV = [];
  __scope.ARGF = (($b = (($c = __scope.Object) == null ? __opal.cm("Object") : $c)).$new || $mm('new')).call($b);
  __scope.ENV = __hash2([], {});
  __scope.TRUE = true;
  __scope.FALSE = false;
  __scope.NIL = nil;
  __scope.STDERR = __gvars["stderr"] = (($c = (($d = __scope.Object) == null ? __opal.cm("Object") : $d)).$new || $mm('new')).call($c);
  __scope.STDIN = __gvars["stdin"] = (($d = (($e = __scope.Object) == null ? __opal.cm("Object") : $e)).$new || $mm('new')).call($d);
  __scope.STDOUT = __gvars["stdout"] = (($e = (($f = __scope.Object) == null ? __opal.cm("Object") : $f)).$new || $mm('new')).call($e);
  __scope.RUBY_PLATFORM = "opal";
  __scope.RUBY_ENGINE = "opal";
  __scope.RUBY_VERSION = "1.9.3";
  __scope.RUBY_RELEASE_DATE = "2013-05-02";
  self.$to_s = function() {
    
    return "main";
  };
  return self.$include = function(mod) {
    var $a, $b;
    return (($a = (($b = __scope.Object) == null ? __opal.cm("Object") : $b)).$include || $mm('include')).call($a, mod);
  };
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Element() {};
    Element = __klass(__base, __super, "Element", Element);

    var def = Element.prototype, __scope = Element._scope, $a, $b, $c, $d, $e, $f, TMP_1, super_TMP_2, TMP_3, TMP_4, TMP_7, TMP_9, TMP_11;
    def.selector = nil;

    (($a = Element).$include || $mm('include')).call($a, (($b = __scope.Enumerable) == null ? __opal.cm("Enumerable") : $b));

    __opal.defs(Element, '$find', function(selector) {
      
      return $(selector);
    });

    __opal.defs(Element, '$id', function(id) {
      
      
      var el = document.getElementById(id);

      if (!el) {
        return nil;
      }

      return $(el);
    
    });

    __opal.defs(Element, '$new', function(tag) {
      if (tag == null) {
        tag = "div"
      }
      return $(document.createElement(tag));
    });

    __opal.defs(Element, '$parse', function(str) {
      
      return $(str);
    });

    __opal.defs(Element, '$expose', function(methods) {
      methods = __slice.call(arguments, 0);
      
      for (var i = 0, length = methods.length, method; i < length; i++) {
        method = methods[i];
        this.prototype['$' + method] = this.prototype[method];
      }

      return nil;
    
    });

    (($b = Element).$expose || $mm('expose')).call($b, "after", "before", "parent", "parents", "prepend", "prev", "remove");

    (($c = Element).$expose || $mm('expose')).call($c, "hide", "show", "toggle", "children", "blur", "closest", "data");

    (($d = Element).$expose || $mm('expose')).call($d, "focus", "find", "next", "siblings", "text", "trigger", "append");

    (($e = Element).$expose || $mm('expose')).call($e, "height", "width", "serialize", "is", "filter", "last", "first");

    (($f = Element).$expose || $mm('expose')).call($f, "wrap", "stop", "clone");

    def.$selector = function() {
      
      return this.selector
    }, nil;

    def['$[]='] = def.attr;

    def.$add_class = def.addClass;

    def.$append_to = def.appendTo;

    def['$has_class?'] = def.hasClass;

    def['$html='] = def.html;

    def.$remove_attr = def.removeAttr;

    def.$remove_class = def.removeClass;

    def['$text='] = def.text;

    def.$toggle_class = def.toggleClass;

    def['$value='] = def.val;

    def['$scroll_left='] = def.scrollLeft;

    def.$scroll_left = def.scrollLeft;

    def.$remove_attribute = def.removeAttr;

    def.$slide_down = def.slideDown;

    def.$slide_up = def.slideUp;

    def.$slide_toggle = def.slideToggle;

    def.$fade_toggle = def.fadeToggle;

    super_TMP_2 = def.$method_missing;
    def.$method_missing = TMP_1 = function(symbol, args) {
      var block;
      block = TMP_1._p || nil, TMP_1._p = null;
      args = __slice.call(arguments, 1);
      
      if (this[symbol]) {
        return this[symbol].apply(this, args);
      }
    
      return super_TMP_2.apply(this, __slice.call(arguments));
    };

    def['$[]'] = function(name) {
      
      return this.attr(name) || "";
    };

    def.$add_attribute = function(name) {
      var $a;
      return (($a = this)['$[]='] || $mm('[]=')).call($a, name, "");
    };

    def['$has_attribute?'] = function(name) {
      
      return !!this.attr(name);
    };

    def['$<<'] = def.$append;

    def.$append_to_body = function() {
      
      return this.appendTo(document.body);
    };

    def.$append_to_head = function() {
      
      return this.appendTo(document.head);
    };

    def.$at = function(index) {
      
      
      var length = this.length;

      if (index < 0) {
        index += length;
      }

      if (index < 0 || index >= length) {
        return nil;
      }

      return $(this[index]);
    
    };

    def.$class_name = function() {
      
      
      var first = this[0];
      return (first && first.className) || "";
    
    };

    def['$class_name='] = function(name) {
      
      
      for (var i = 0, length = this.length; i < length; i++) {
        this[i].className = name;
      }
    
      return this;
    };

    def.$css = function(name, value) {
      var $a, $b, $c, $d, $e;if (value == null) {
        value = nil
      }
      if (($a = ($b = (($b = value)['$nil?'] || $mm('nil?')).call($b), $b !== false && $b !== nil ? (($c = name)['$is_a?'] || $mm('is_a?')).call($c, (($d = __scope.String) == null ? __opal.cm("String") : $d)) : $b)) !== false && $a !== nil) {
        return this.css(name)
        } else {
        if (($a = (($d = name)['$is_a?'] || $mm('is_a?')).call($d, (($e = __scope.Hash) == null ? __opal.cm("Hash") : $e))) !== false && $a !== nil) {
          this.css((($a = name).$to_native || $mm('to_native')).call($a));
          } else {
          this.css(name, value);
        }
      };
      return this;
    };

    def.$animate = TMP_3 = function(params) {
      var speed = nil, $a, $b, $c, $d, block;
      block = TMP_3._p || nil, TMP_3._p = null;
      
      speed = (function() { if (($a = (($b = params)['$has_key?'] || $mm('has_key?')).call($b, "speed")) !== false && $a !== nil) {
        return (($a = params).$delete || $mm('delete')).call($a, "speed")
        } else {
        return 400
      }; return nil; }).call(this);
      
      this.animate((($c = params).$to_native || $mm('to_native')).call($c), speed, function() {
        if ((block !== nil)) {
        (($d = block).$call || $mm('call')).call($d)
      }
      })
    ;
    };

    def.$effect = TMP_4 = function(name, args) {
      var TMP_5, $a, $b, TMP_6, $c, $d, $e, block;
      block = TMP_4._p || nil, TMP_4._p = null;
      args = __slice.call(arguments, 1);
      name = ($a = (($b = name).$gsub || $mm('gsub')), $a._p = (TMP_5 = function(match) {

        var self = TMP_5._s || this, $a, $b;
        if (match == null) match = nil;

        return (($a = (($b = match)['$[]'] || $mm('[]')).call($b, 1)).$upcase || $mm('upcase')).call($a)
      }, TMP_5._s = this, TMP_5), $a).call($b, /_\w/);
      args = (($a = ($c = (($d = args).$map || $mm('map')), $c._p = (TMP_6 = function(a) {

        var self = TMP_6._s || this, $a, $b;
        if (a == null) a = nil;

        if (($a = (($b = a)['$respond_to?'] || $mm('respond_to?')).call($b, "to_native")) !== false && $a !== nil) {
          return (($a = a).$to_native || $mm('to_native')).call($a)
          } else {
          return nil
        }
      }, TMP_6._s = this, TMP_6), $c).call($d)).$compact || $mm('compact')).call($a);
      (($c = args)['$<<'] || $mm('<<')).call($c, function() { if ((block !== nil)) {
        (($e = block).$call || $mm('call')).call($e)
      } });
      return this[name].apply(this, args);
    };

    def['$visible?'] = function() {
      
      return this.is(':visible');
    };

    def.$offset = function() {
      var $a, $b;
      return (($a = (($b = __scope.Hash) == null ? __opal.cm("Hash") : $b)).$from_native || $mm('from_native')).call($a, this.offset());
    };

    def.$each = TMP_7 = function() {
      var __yield;
      __yield = TMP_7._p || nil, TMP_7._p = null;
      
      for (var i = 0, length = this.length; i < length; i++) {
      if (__yield.call(null, $(this[i])) === __breaker) return __breaker.$v;
      };
      return this;
    };

    def.$map = TMP_9 = function() {
      var list = nil, TMP_8, $a, $b, __yield;
      __yield = TMP_9._p || nil, TMP_9._p = null;
      
      list = [];
      ($a = (($b = this).$each || $mm('each')), $a._p = (TMP_8 = function(el) {

        var self = TMP_8._s || this, $a, $b;
        if (el == null) el = nil;

        return (($a = list)['$<<'] || $mm('<<')).call($a, ((($b = __yield.call(null, el)) === __breaker) ? __breaker.$v : $b))
      }, TMP_8._s = this, TMP_8), $a).call($b);
      return list;
    };

    def.$to_a = function() {
      var TMP_10, $a, $b;
      return ($a = (($b = this).$map || $mm('map')), $a._p = (TMP_10 = function(el) {

        var self = TMP_10._s || this;
        if (el == null) el = nil;

        return el
      }, TMP_10._s = this, TMP_10), $a).call($b);
    };

    def.$first = function() {
      
      return this.length ? this.first() : nil;
    };

    def.$html = function() {
      
      return this.html() || "";
    };

    def.$id = function() {
      
      
      var first = this[0];
      return (first && first.id) || "";
    
    };

    def['$id='] = function(id) {
      
      
      var first = this[0];

      if (first) {
        first.id = id;
      }

      return this;
    
    };

    def.$tag_name = function() {
      
      return this.length > 0 ? this[0].tagName.toLowerCase() : nil;
    };

    def.$inspect = function() {
      
      
      var val, el, str, result = [];

      for (var i = 0, length = this.length; i < length; i++) {
        el  = this[i];
        str = "<" + el.tagName.toLowerCase();

        if (val = el.id) str += (' id="' + val + '"');
        if (val = el.className) str += (' class="' + val + '"');

        result.push(str + '>');
      }

      return '[' + result.join(', ') + ']';
    
    };

    def.$length = function() {
      
      return this.length;
    };

    def['$any?'] = function() {
      
      return this.length > 0;
    };

    def['$empty?'] = function() {
      
      return this.length === 0;
    };

    def['$empty?'] = def['$none?'];

    def.$on = TMP_11 = function(name, sel) {
      var block;
      block = TMP_11._p || nil, TMP_11._p = null;
      if (sel == null) {
        sel = nil
      }
      sel === nil ? this.on(name, block) : this.on(name, sel, block);
      return block;
    };

    def.$off = function(name, sel, block) {
      if (block == null) {
        block = nil
      }
      return block === nil ? this.off(name, sel) : this.off(name, sel, block);
    };

    def.$size = def.$length;

    def.$succ = def.$next;

    def.$value = function() {
      
      return this.val() || "";
    };

    return nil;
  })(self, jQuery)
})(Opal);
(function(__opal) {
  var $a, $b, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __gvars = __opal.gvars;
  __gvars["document"] = (($a = (($b = __scope.Element) == null ? __opal.cm("Element") : $b)).$find || $mm('find')).call($a, document);
  (function(){var __scope = this._scope, def = this.prototype, TMP_1;def['$ready?'] = TMP_1 = function() {
    var block;
    block = TMP_1._p || nil, TMP_1._p = null;
    
    
      if (block === nil) {
        return nil;
      }

      $(block);
      return nil;
    
  };
  def.$title = function() {
    
    return document.title;
  };
  return def['$title='] = function(title) {
    
    return document.title = title;
  };}).call((($b = __gvars["document"]).$singleton_class || $mm('singleton_class')).call($b));
  return __scope.Document = __gvars["document"];
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Event() {};
    Event = __klass(__base, __super, "Event", Event);

    var def = Event.prototype, __scope = Event._scope;

    def['$[]'] = function(name) {
      
      return this[name];
    };

    def.$current_target = function() {
      
      return $(this.currentTarget);
    };

    def['$default_prevented?'] = function() {
      
      return this.isDefaultPrevented();
    };

    def.$kill = function() {
      var $a, $b;
      (($a = this).$stop_propagation || $mm('stop_propagation')).call($a);
      return (($b = this).$prevent_default || $mm('prevent_default')).call($b);
    };

    def.$prevent_default = def.preventDefault;

    def.$page_x = function() {
      
      return this.pageX;
    };

    def.$page_y = function() {
      
      return this.pageY;
    };

    def['$propagation_stopped?'] = def.propagationStopped;

    def.$stop_propagation = def.stopPropagation;

    def.$stop_immediate_propagation = def.stopImmediatePropagation;

    def.$target = function() {
      
      return $(this.target);
    };

    def.$touch_x = function() {
      
      return this.originalEvent.touches[0].pageX;
    };

    def.$touch_y = function() {
      
      return this.originalEvent.touches[0].pageY;
    };

    def.$type = function() {
      
      return this.type;
    };

    def.$which = function() {
      
      return this.which;
    };

    return nil;
  })(self, $.Event)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass, __hash2 = __opal.hash2;
  return (function(__base, __super){
    function HTTP() {};
    HTTP = __klass(__base, __super, "HTTP", HTTP);

    var def = HTTP.prototype, __scope = HTTP._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;
    def.body = def.error_message = def.method = def.status_code = def.url = def.xhr = def.errback = def.json = def.ok = def.settings = def.callback = nil;

    def.$body = function() {
      
      return this.body
    }, 
    def.$error_message = function() {
      
      return this.error_message
    }, 
    def.$method = function() {
      
      return this.method
    }, 
    def.$status_code = function() {
      
      return this.status_code
    }, 
    def.$url = function() {
      
      return this.url
    }, 
    def.$xhr = function() {
      
      return this.xhr
    }, nil;

    __opal.defs(HTTP, '$get', TMP_1 = function(url, opts) {
      var $a, $b, block;
      block = TMP_1._p || nil, TMP_1._p = null;
      if (opts == null) {
        opts = __hash2([], {})
      }
      return (($a = (($b = this).$new || $mm('new')).call($b, url, "GET", opts, block))['$send!'] || $mm('send!')).call($a)
    });

    __opal.defs(HTTP, '$post', TMP_2 = function(url, opts) {
      var $a, $b, block;
      block = TMP_2._p || nil, TMP_2._p = null;
      if (opts == null) {
        opts = __hash2([], {})
      }
      return (($a = (($b = this).$new || $mm('new')).call($b, url, "POST", opts, block))['$send!'] || $mm('send!')).call($a)
    });

    __opal.defs(HTTP, '$put', TMP_3 = function(url, opts) {
      var $a, $b, block;
      block = TMP_3._p || nil, TMP_3._p = null;
      if (opts == null) {
        opts = __hash2([], {})
      }
      return (($a = (($b = this).$new || $mm('new')).call($b, url, "PUT", opts, block))['$send!'] || $mm('send!')).call($a)
    });

    __opal.defs(HTTP, '$delete', TMP_4 = function(url, opts) {
      var $a, $b, block;
      block = TMP_4._p || nil, TMP_4._p = null;
      if (opts == null) {
        opts = __hash2([], {})
      }
      return (($a = (($b = this).$new || $mm('new')).call($b, url, "DELETE", opts, block))['$send!'] || $mm('send!')).call($a)
    });

    def.$initialize = function(url, method, options, handler) {
      var http = nil, payload = nil, settings = nil, $a, $b, $c, $d, $e;if (handler == null) {
        handler = nil
      }
      this.url = url;
      this.method = method;
      this.ok = true;
      this.xhr = nil;
      http = this;
      payload = (($a = options).$delete || $mm('delete')).call($a, "payload");
      settings = (($b = options).$to_native || $mm('to_native')).call($b);
      if (handler !== false && handler !== nil) {
        this.callback = this.errback = handler
      };
      
      if (typeof(payload) === 'string') {
        settings.data = payload;
      }
      else if (payload !== nil) {
        settings.data = payload.$to_json();
        settings.contentType = 'application/json';
      }

      settings.url  = url;
      settings.type = method;

      settings.success = function(data, status, xhr) {
        http.body = data;
        http.xhr = xhr;

        if (typeof(data) === 'object') {
          http.json = (($c = (($d = __scope.JSON) == null ? __opal.cm("JSON") : $d)).$from_object || $mm('from_object')).call($c, data);
        }

        return (($d = http).$succeed || $mm('succeed')).call($d);
      };

      settings.error = function(xhr, status, error) {
        http.body = xhr.responseText;
        http.xhr = xhr;

        return (($e = http).$fail || $mm('fail')).call($e);
      };
    
      return this.settings = settings;
    };

    def.$callback = TMP_5 = function() {
      var block;
      block = TMP_5._p || nil, TMP_5._p = null;
      
      this.callback = block;
      return this;
    };

    def.$errback = TMP_6 = function() {
      var block;
      block = TMP_6._p || nil, TMP_6._p = null;
      
      this.errback = block;
      return this;
    };

    def.$fail = function() {
      var $a;
      this.ok = false;
      if (($a = this.errback) !== false && $a !== nil) {
        return (($a = this.errback).$call || $mm('call')).call($a, this)
        } else {
        return nil
      };
    };

    def.$json = function() {
      var $a, $b, $c;
      return (($a = this.json), $a !== false && $a !== nil ? $a : (($b = (($c = __scope.JSON) == null ? __opal.cm("JSON") : $c)).$parse || $mm('parse')).call($b, this.body));
    };

    def['$ok?'] = function() {
      
      return this.ok;
    };

    def['$send!'] = function() {
      
      $.ajax(this.settings);
      return this;
    };

    def.$succeed = function() {
      var $a;
      if (($a = this.callback) !== false && $a !== nil) {
        return (($a = this.callback).$call || $mm('call')).call($a, this)
        } else {
        return nil
      };
    };

    def.$get_header = function(key) {
      var $a;
      return (($a = this).$xhr || $mm('xhr')).call($a).getResponseHeader(key);
    };

    return nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module;
  return (function(__base){
    function Kernel() {};
    Kernel = __module(__base, "Kernel", Kernel);
    var def = Kernel.prototype, __scope = Kernel._scope;

    def.$alert = function(msg) {
      
      alert(msg);
      return nil;
    }
        ;__opal.donate(Kernel, ["$alert"]);
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice;
  return ;
})(Opal);
(function(__opal) {
  var $a, $b, $c, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass, __gvars = __opal.gvars;
  (function(__base, __super){
    function BrowserScriptLoader() {};
    BrowserScriptLoader = __klass(__base, __super, "BrowserScriptLoader", BrowserScriptLoader);

    var def = BrowserScriptLoader.prototype, __scope = BrowserScriptLoader._scope;

    def.$run = function() {
      var handler = nil, TMP_1, $a, $b, $c, $d;
      handler = ($a = (($b = this).$proc || $mm('proc')), $a._p = (TMP_1 = function() {

        var self = TMP_1._s || this, $a;
        
        return (($a = self).$find_scripts || $mm('find_scripts')).call($a)
      }, TMP_1._s = this, TMP_1), $a).call($b);
      if (($a = (($c = __gvars["window"])['$respond_to?'] || $mm('respond_to?')).call($c, "addEventListener")) !== false && $a !== nil) {
        return (($a = __gvars["window"]).$addEventListener || $mm('addEventListener')).call($a, "DOMContentLoaded", handler, false)
        } else {
        return (($d = __gvars["window"]).$attachEvent || $mm('attachEvent')).call($d, "onload", handler)
      };
    };

    def.$find_scripts = function() {
      var TMP_2, $a, $b, $c;
      return ($a = (($b = (($c = this).$ruby_scripts || $mm('ruby_scripts')).call($c)).$each || $mm('each')), $a._p = (TMP_2 = function(script) {

        var src = nil, self = TMP_2._s || this, $a, $b, $c, $d, $e;
        if (script == null) script = nil;

        if (($a = ($b = src = (($b = script).$src || $mm('src')).call($b), $b !== false && $b !== nil ? ($c = (($d = src)['$=='] || $mm('==')).call($d, ""), ($c === nil || $c === false)) : $b)) !== false && $a !== nil) {
          return (($a = self).$puts || $mm('puts')).call($a, "Cannot currently load remote script: " + (src))
          } else {
          return (($c = self).$run_ruby || $mm('run_ruby')).call($c, (($e = script).$innerHTML || $mm('innerHTML')).call($e))
        }
      }, TMP_2._s = this, TMP_2), $a).call($b);
    };

    def.$ruby_scripts = function() {
      var TMP_3, $a, $b, $c, $d;
      return ($a = (($b = (($c = (($d = __gvars["document"]).$getElementsByTagName || $mm('getElementsByTagName')).call($d, "script")).$to_a || $mm('to_a')).call($c)).$select || $mm('select')), $a._p = (TMP_3 = function(s) {

        var self = TMP_3._s || this, $a, $b;
        if (s == null) s = nil;

        return (($a = (($b = s).$type || $mm('type')).call($b))['$=='] || $mm('==')).call($a, "text/ruby")
      }, TMP_3._s = this, TMP_3), $a).call($b);
    };

    def.$run_ruby = function(str) {
      var $a, $b;
      return (($a = (($b = __gvars["window"]).$Opal || $mm('Opal')).call($b)).$eval || $mm('eval')).call($a, str);
    };

    return nil;
  })(self, null);
  if (($a = ($b = __gvars["window"], $b !== false && $b !== nil ? __gvars["document"] : $b)) !== false && $a !== nil) {
    return (($a = (($b = (($c = __scope.BrowserScriptLoader) == null ? __opal.cm("BrowserScriptLoader") : $c)).$new || $mm('new')).call($b)).$run || $mm('run')).call($a)
    } else {
    return nil
  };
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass;
  return (function(__base){
    function Racc() {};
    Racc = __module(__base, "Racc", Racc);
    var def = Racc.prototype, __scope = Racc._scope;

    (function(__base, __super){
      function Parser() {};
      Parser = __klass(__base, __super, "Parser", Parser);

      var def = Parser.prototype, __scope = Parser._scope;
      def.yydebug = nil;

      def.$_racc_setup = function() {
        var $a, $b;
        return (($a = ((($b = this).$class || $mm('class')).call($b))._scope).Racc_arg == null ? $a.cm("Racc_arg") : $a.Racc_arg);
      };

      def.$do_parse = function() {
        var $a, $b;
        return (($a = this).$_racc_do_parse_rb || $mm('_racc_do_parse_rb')).call($a, (($b = this).$_racc_setup || $mm('_racc_setup')).call($b), false);
      };

      def.$_racc_do_parse_rb = function(arg, in_debug) {
        var action_table = nil, action_check = nil, action_default = nil, action_pointer = nil, goto_table = nil, goto_check = nil, goto_default = nil, goto_pointer = nil, nt_base = nil, reduce_table = nil, token_table = nil, shift_n = nil, reduce_n = nil, use_result = nil, racc_state = nil, racc_tstack = nil, racc_vstack = nil, racc_t = nil, racc_tok = nil, racc_val = nil, racc_read_next = nil, racc_user_yyerror = nil, racc_error_status = nil, token = nil, act = nil, i = nil, nerr = nil, custate = nil, curstate = nil, reduce_i = nil, reduce_len = nil, reduce_to = nil, method_id = nil, tmp_t = nil, tmp_v = nil, reduce_call_result = nil, k1 = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay, $az, $ba, $bb, $bc, $bd, $be, $bf, $bg, $bh, $bi, $bj, $bk, $bl, $bm, $bn, $bo, $bp, $bq, $br, $bs, $bt, $bu, $bv, $bw, $bx, $by, $bz, $ca, $cb, $cc, $cd, $ce, $cf, $cg;
        action_table = (($a = arg)['$[]'] || $mm('[]')).call($a, 0);
        action_check = (($b = arg)['$[]'] || $mm('[]')).call($b, 1);
        action_default = (($c = arg)['$[]'] || $mm('[]')).call($c, 2);
        action_pointer = (($d = arg)['$[]'] || $mm('[]')).call($d, 3);
        goto_table = (($e = arg)['$[]'] || $mm('[]')).call($e, 4);
        goto_check = (($f = arg)['$[]'] || $mm('[]')).call($f, 5);
        goto_default = (($g = arg)['$[]'] || $mm('[]')).call($g, 6);
        goto_pointer = (($h = arg)['$[]'] || $mm('[]')).call($h, 7);
        nt_base = (($i = arg)['$[]'] || $mm('[]')).call($i, 8);
        reduce_table = (($j = arg)['$[]'] || $mm('[]')).call($j, 9);
        token_table = (($k = arg)['$[]'] || $mm('[]')).call($k, 10);
        shift_n = (($l = arg)['$[]'] || $mm('[]')).call($l, 11);
        reduce_n = (($m = arg)['$[]'] || $mm('[]')).call($m, 12);
        use_result = (($n = arg)['$[]'] || $mm('[]')).call($n, 13);
        racc_state = [0];
        racc_tstack = [];
        racc_vstack = [];
        racc_t = nil;
        racc_tok = nil;
        racc_val = nil;
        racc_read_next = true;
        racc_user_yyerror = false;
        racc_error_status = 0;
        token = nil;
        act = nil;
        i = nil;
        nerr = nil;
        custate = nil;
        while (($p = true) !== false && $p !== nil){i = (($p = action_pointer)['$[]'] || $mm('[]')).call($p, (($q = racc_state)['$[]'] || $mm('[]')).call($q, -1));
        if (i !== false && i !== nil) {
          if (racc_read_next !== false && racc_read_next !== nil) {
            if (($r = ($s = (($t = racc_t)['$=='] || $mm('==')).call($t, 0), ($s === nil || $s === false))) !== false && $r !== nil) {
              token = (($r = this).$next_token || $mm('next_token')).call($r);
              racc_tok = (($s = token)['$[]'] || $mm('[]')).call($s, 0);
              racc_val = (($u = token)['$[]'] || $mm('[]')).call($u, 1);
              if ((($v = racc_tok)['$=='] || $mm('==')).call($v, false)) {
                racc_t = 0
                } else {
                racc_t = (($w = token_table)['$[]'] || $mm('[]')).call($w, racc_tok);
                if (($x = racc_t) === false || $x === nil) {
                  racc_t = 1
                };
              };
              if (($x = this.yydebug) !== false && $x !== nil) {
                (($x = this).$racc_read_token || $mm('racc_read_token')).call($x, racc_t, racc_tok, racc_val)
              };
              racc_read_next = false;
            }
          };
          i = (($y = i)['$+'] || $mm('+')).call($y, racc_t);
          if (($z = (($aa = (($ab = (($ac = i)['$<'] || $mm('<')).call($ac, 0)), $ab !== false && $ab !== nil ? $ab : (($ad = (act = (($ae = action_table)['$[]'] || $mm('[]')).call($ae, i)))['$nil?'] || $mm('nil?')).call($ad))), $aa !== false && $aa !== nil ? $aa : ($ab = (($af = (($ag = action_check)['$[]'] || $mm('[]')).call($ag, i))['$=='] || $mm('==')).call($af, (($ah = racc_state)['$[]'] || $mm('[]')).call($ah, -1)), ($ab === nil || $ab === false)))) !== false && $z !== nil) {
            act = (($z = action_default)['$[]'] || $mm('[]')).call($z, (($aa = racc_state)['$[]'] || $mm('[]')).call($aa, -1))
          };
          } else {
          act = (($ab = action_default)['$[]'] || $mm('[]')).call($ab, (($ai = racc_state)['$[]'] || $mm('[]')).call($ai, -1))
        };
        if (($aj = this.yydebug) !== false && $aj !== nil) {
          (($aj = this).$puts || $mm('puts')).call($aj, "(act: " + (act) + ", shift_n: " + (shift_n) + ", reduce_n: " + (reduce_n) + ")")
        };
        if (($ak = (($al = (($am = act)['$>'] || $mm('>')).call($am, 0)) ? (($an = act)['$<'] || $mm('<')).call($an, shift_n) : $al)) !== false && $ak !== nil) {
          if ((($ak = racc_error_status)['$>'] || $mm('>')).call($ak, 0)) {
            if (($al = ($ao = (($ap = racc_t)['$=='] || $mm('==')).call($ap, 1), ($ao === nil || $ao === false))) !== false && $al !== nil) {
              racc_error_status = (($al = racc_error_status)['$-'] || $mm('-')).call($al, 1)
            }
          };
          (($ao = racc_vstack).$push || $mm('push')).call($ao, racc_val);
          curstate = act;
          (($aq = racc_state)['$<<'] || $mm('<<')).call($aq, act);
          racc_read_next = true;
          if (($ar = this.yydebug) !== false && $ar !== nil) {
            (($ar = racc_tstack).$push || $mm('push')).call($ar, racc_t);
            (($as = this).$racc_shift || $mm('racc_shift')).call($as, racc_t, racc_tstack, racc_vstack);
          };
          } else {
          if (($at = (($au = (($av = act)['$<'] || $mm('<')).call($av, 0)) ? (($aw = act)['$>'] || $mm('>')).call($aw, (($ax = reduce_n)['$-@'] || $mm('-@')).call($ax)) : $au)) !== false && $at !== nil) {
            reduce_i = ($at = act, $au = -3, typeof($at) === 'number' ? $at * $au : $at['$*']($au));
            reduce_len = (($at = reduce_table)['$[]'] || $mm('[]')).call($at, reduce_i);
            reduce_to = (($au = reduce_table)['$[]'] || $mm('[]')).call($au, ($ay = reduce_i, $az = 1, typeof($ay) === 'number' ? $ay + $az : $ay['$+']($az)));
            method_id = (($ay = reduce_table)['$[]'] || $mm('[]')).call($ay, ($az = reduce_i, $ba = 2, typeof($az) === 'number' ? $az + $ba : $az['$+']($ba)));
            tmp_t = (($az = racc_tstack).$last || $mm('last')).call($az, reduce_len);
            tmp_v = (($ba = racc_vstack).$last || $mm('last')).call($ba, reduce_len);
            (($bb = racc_state).$pop || $mm('pop')).call($bb, reduce_len);
            (($bc = racc_vstack).$pop || $mm('pop')).call($bc, reduce_len);
            (($bd = racc_tstack).$pop || $mm('pop')).call($bd, reduce_len);
            if (use_result !== false && use_result !== nil) {
              reduce_call_result = (($be = this).$__send__ || $mm('__send__')).call($be, method_id, tmp_v, nil, (($bf = tmp_v)['$[]'] || $mm('[]')).call($bf, 0));
              (($bg = racc_vstack).$push || $mm('push')).call($bg, reduce_call_result);
              } else {
              (($bh = this).$raise || $mm('raise')).call($bh, "not using result??")
            };
            (($bi = racc_tstack).$push || $mm('push')).call($bi, reduce_to);
            if (($bj = this.yydebug) !== false && $bj !== nil) {
              (($bj = this).$racc_reduce || $mm('racc_reduce')).call($bj, tmp_t, reduce_to, racc_tstack, racc_vstack)
            };
            k1 = ($bk = reduce_to, $bl = nt_base, typeof($bk) === 'number' ? $bk - $bl : $bk['$-']($bl));
            if (($bk = ($bl = (($bm = (reduce_i = (($bn = goto_pointer)['$[]'] || $mm('[]')).call($bn, k1)))['$=='] || $mm('==')).call($bm, nil), ($bl === nil || $bl === false))) !== false && $bk !== nil) {
              reduce_i = (($bk = reduce_i)['$+'] || $mm('+')).call($bk, (($bl = racc_state)['$[]'] || $mm('[]')).call($bl, -1));
              if (($bo = ($bp = (($bp = (($bq = reduce_i)['$>='] || $mm('>=')).call($bq, 0)) ? ($br = (($bs = (curstate = (($bt = goto_table)['$[]'] || $mm('[]')).call($bt, reduce_i)))['$=='] || $mm('==')).call($bs, nil), ($br === nil || $br === false)) : $bp), $bp !== false && $bp !== nil ? (($bp = (($br = goto_check)['$[]'] || $mm('[]')).call($br, reduce_i))['$=='] || $mm('==')).call($bp, k1) : $bp)) !== false && $bo !== nil) {
                (($bo = racc_state).$push || $mm('push')).call($bo, curstate)
                } else {
                (($bu = racc_state).$push || $mm('push')).call($bu, (($bv = goto_default)['$[]'] || $mm('[]')).call($bv, k1))
              };
              } else {
              (($bw = racc_state).$push || $mm('push')).call($bw, (($bx = goto_default)['$[]'] || $mm('[]')).call($bx, k1))
            };
            } else {
            if ((($by = act)['$=='] || $mm('==')).call($by, shift_n)) {
              return (($bz = racc_vstack)['$[]'] || $mm('[]')).call($bz, 0)
              } else {
              if ((($ca = act)['$=='] || $mm('==')).call($ca, (($cb = reduce_n)['$-@'] || $mm('-@')).call($cb))) {
                (($cc = this).$raise || $mm('raise')).call($cc, (($cd = __scope.SyntaxError) == null ? __opal.cm("SyntaxError") : $cd), "unexpected '" + ((($cd = racc_tok).$inspect || $mm('inspect')).call($cd)) + "'")
                } else {
                (($ce = this).$raise || $mm('raise')).call($ce, "Rac: unknown action: " + (act))
              }
            }
          }
        };
        if (($cf = this.yydebug) !== false && $cf !== nil) {
          (($cf = this).$racc_next_state || $mm('racc_next_state')).call($cf, (($cg = racc_state)['$[]'] || $mm('[]')).call($cg, -1), racc_state)
        };};
      };

      def.$racc_read_token = function(t, tok, val) {
        var $a, $b, $c, $d;
        (($a = this).$puts || $mm('puts')).call($a, "read    " + (tok) + "(" + ((($b = this).$racc_token2str || $mm('racc_token2str')).call($b, t)) + ") " + ((($c = val).$inspect || $mm('inspect')).call($c)));
        return (($d = this).$puts || $mm('puts')).call($d, "\n");
      };

      def.$racc_shift = function(tok, tstack, vstack) {
        var $a, $b, $c, $d;
        (($a = this).$puts || $mm('puts')).call($a, "shift  " + ((($b = this).$racc_token2str || $mm('racc_token2str')).call($b, tok)));
        (($c = this).$racc_print_stacks || $mm('racc_print_stacks')).call($c, tstack, vstack);
        return (($d = this).$puts || $mm('puts')).call($d, "\n");
      };

      def.$racc_reduce = function(toks, sim, tstack, vstack) {
        var $a, $b, $c, TMP_1, $d, $e, $f;
        (($a = this).$puts || $mm('puts')).call($a, "reduce " + ((function() { if (($b = (($c = toks)['$empty?'] || $mm('empty?')).call($c)) !== false && $b !== nil) {
          return "<none>"
          } else {
          return ($b = (($d = toks).$map || $mm('map')), $b._p = (TMP_1 = function(t) {

            var self = TMP_1._s || this, $a;
            if (t == null) t = nil;

            return (($a = self).$racc_token2str || $mm('racc_token2str')).call($a, t)
          }, TMP_1._s = this, TMP_1), $b).call($d)
        }; return nil; }).call(this)));
        (($b = this).$puts || $mm('puts')).call($b, "  --> " + ((($e = this).$racc_token2str || $mm('racc_token2str')).call($e, sim)));
        return (($f = this).$racc_print_stacks || $mm('racc_print_stacks')).call($f, tstack, vstack);
      };

      def.$racc_next_state = function(curstate, state) {
        var $a, $b, $c;
        (($a = this).$puts || $mm('puts')).call($a, "goto  " + (curstate));
        (($b = this).$racc_print_states || $mm('racc_print_states')).call($b, state);
        return (($c = this).$puts || $mm('puts')).call($c, "\n");
      };

      def.$racc_token2str = function(tok) {
        var $a, $b, $c;
        return (($a = (($b = ((($c = this).$class || $mm('class')).call($c))._scope).Racc_token_to_s_table == null ? $b.cm("Racc_token_to_s_table") : $b.Racc_token_to_s_table))['$[]'] || $mm('[]')).call($a, tok);
      };

      def.$racc_print_stacks = function(t, v) {
        var $a, TMP_2, $b, $c;
        (($a = this).$puts || $mm('puts')).call($a, "  [");
        ($b = (($c = t).$each_index || $mm('each_index')), $b._p = (TMP_2 = function(i) {

          var self = TMP_2._s || this, $a, $b, $c, $d, $e;
          if (i == null) i = nil;

          return (($a = self).$puts || $mm('puts')).call($a, "    (" + ((($b = self).$racc_token2str || $mm('racc_token2str')).call($b, (($c = t)['$[]'] || $mm('[]')).call($c, i))) + " " + ((($d = (($e = v)['$[]'] || $mm('[]')).call($e, i)).$inspect || $mm('inspect')).call($d)) + ")")
        }, TMP_2._s = this, TMP_2), $b).call($c);
        return (($b = this).$puts || $mm('puts')).call($b, "  ]");
      };

      def.$racc_print_states = function(s) {
        var $a, TMP_3, $b, $c;
        (($a = this).$puts || $mm('puts')).call($a, "  [");
        ($b = (($c = s).$each || $mm('each')), $b._p = (TMP_3 = function(st) {

          var self = TMP_3._s || this, $a;
          if (st == null) st = nil;

          return (($a = self).$puts || $mm('puts')).call($a, "   " + (st))
        }, TMP_3._s = this, TMP_3), $b).call($c);
        return (($b = this).$puts || $mm('puts')).call($b, "  ]");
      };

      return nil;
    })(Racc, null)
    
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function StringScanner() {};
    StringScanner = __klass(__base, __super, "StringScanner", StringScanner);

    var def = StringScanner.prototype, __scope = StringScanner._scope;
    def.pos = def.matched = def.working = nil;

    def.$pos = function() {
      
      return this.pos
    }, nil;

    def.$matched = function() {
      
      return this.matched
    }, nil;

    def.$initialize = function(string) {
      
      this.string = string;
      this.pos = 0;
      this.matched = nil;
      return this.working = string;
    };

    def.$scan = function(regex) {
      
      
      var regex  = new RegExp('^' + regex.toString().substring(1, regex.toString().length - 1)),
          result = regex.exec(this.working);

      if (result == null) {
        return this.matched = nil;
      }
      else if (typeof(result) === 'object') {
        this.pos      += result[0].length;
        this.working  = this.working.substring(result[0].length);
        this.matched  = result[0];

        return result[0];
      }
      else if (typeof(result) === 'string') {
        this.pos     += result.length;
        this.working  = this.working.substring(result.length);

        return result;
      }
      else {
        return nil;
      }
    
    };

    def.$check = function(regex) {
      
      
      var regexp = new RegExp('^' + regex.toString().substring(1, regex.toString().length - 1)),
          result = regexp.exec(this.working);

      if (result == null) {
        return this.matched = nil;
      }

      return this.matched = result[0];
    
    };

    def.$peek = function(length) {
      
      return this.working.substring(0, length);
    };

    def['$eos?'] = function() {
      
      return this.working.length === 0;
    };

    def.$skip = function(re) {
      
      
      re = new RegExp('^' + re.source)
      var result = re.exec(this.working);

      if (result == null) {
        return this.matched = nil;
      }
      else {
        var match_str = result[0];
        var match_len = match_str.length;
        this.matched = match_str;
        this.pos += match_len;
        this.working = this.working.substring(match_len);
        return match_len;
      }
    
    };

    def.$get_byte = function() {
      
      
      var result = nil;
      if (this.pos < this.string.length) {
        this.pos += 1;
        result = this.matched = this.working.substring(0, 1);
        this.working = this.working.substring(1);
      }
      else {
        this.matched = nil; 
      }

      return result;
    
    };

    return def.$getch = def.$get_byte;
  })(self, null)
})(Opal);

// We need (some) of the libs from our real ruby parser (not in sprockets load path)
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass, __hash = __opal.hash;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope, $a, $b;

    (function(__base, __super){
      function Grammar() {};
      Grammar = __klass(__base, __super, "Grammar", Grammar);

      var clist = nil, racc_action_table = nil, arr = nil, idx = nil, racc_action_check = nil, racc_action_pointer = nil, racc_action_default = nil, racc_goto_table = nil, racc_goto_check = nil, racc_goto_pointer = nil, racc_goto_default = nil, racc_reduce_table = nil, racc_reduce_n = nil, racc_shift_n = nil, racc_token_table = nil, racc_nt_base = nil, racc_use_result_var = nil, def = Grammar.prototype, __scope = Grammar._scope, $a, $b, TMP_1, $c, $d, TMP_3, $e, $f, TMP_5, $g, $h, TMP_7, $i;
      def.line = def.scope_line = def.string_parse = def.file = def.scope = def.line_number = nil;

      clist = ["63,64,65,7,51,530,566,661,57,58,197,198,264,61,196,59,60,62,23,24,66", "67,374,-474,264,596,22,28,27,89,88,90,91,554,676,17,559,664,197,198", "708,6,41,8,9,93,92,83,50,85,84,86,87,94,95,-77,81,82,595,38,39,37,-85", "197,198,661,537,596,565,197,198,73,100,-419,530,-82,733,99,537,74,-419", "36,530,530,30,-474,259,52,-80,-80,-81,-59,32,556,555,263,40,100,530", "821,595,259,99,100,18,660,-474,263,99,79,73,75,76,77,78,100,730,529", "74,80,99,661,63,64,65,296,51,56,-67,264,57,58,-419,53,54,61,675,59,60", "62,250,251,66,67,325,324,328,327,249,280,284,89,88,90,91,100,296,211", "656,493,99,100,668,660,41,-476,99,93,92,83,50,85,84,86,87,94,95,554", "81,82,-428,38,39,37,100,-82,529,-82,259,99,-82,259,100,100,529,529,709", "99,99,-80,-81,-80,-81,202,-80,-81,206,-84,100,52,529,808,263,99,601", "526,246,100,40,660,197,198,99,-416,786,219,210,554,-78,596,-416,79,73", "75,76,77,78,556,555,219,74,80,596,577,-82,-428,692,219,253,56,63,64", "65,733,51,53,54,-424,57,58,421,525,595,61,-424,59,60,62,250,251,66,67", "-79,592,726,595,249,280,284,89,88,90,91,739,-74,211,-70,556,555,561", "572,-82,41,-78,652,93,92,83,50,85,84,86,87,94,95,554,81,82,-85,38,39", "37,219,223,228,229,230,225,227,235,236,231,232,-252,212,213,-421,100", "233,234,-252,202,99,-421,206,554,740,52,698,325,324,328,327,216,741", "222,40,218,217,214,215,226,224,220,210,221,536,523,537,79,73,75,76,77", "78,556,555,557,74,80,523,237,63,64,65,219,51,56,524,-71,57,58,-252,53", "54,61,-79,59,60,62,250,251,66,67,524,556,555,552,249,280,284,89,88,90", "91,746,216,211,-422,725,218,217,572,576,41,-422,493,93,92,83,50,85,84", "86,87,94,95,554,81,82,733,38,39,37,219,223,228,229,230,225,227,235,236", "231,232,613,212,213,672,753,233,234,614,202,-72,670,206,-76,383,52,754", "-80,385,384,-84,216,246,222,40,218,217,214,215,226,224,220,210,221,749", "733,523,79,73,75,76,77,78,556,555,567,74,80,296,237,520,-212,417,-74", "253,56,63,64,65,418,51,53,54,671,57,58,518,505,376,61,507,59,60,62,23", "24,66,67,505,514,515,507,22,28,27,89,88,90,91,-306,-74,17,538,-425,-476", "-73,-306,-74,41,821,-425,93,92,83,50,85,84,86,87,94,95,419,81,82,720", "38,39,37,219,223,228,229,230,225,227,235,236,231,232,-258,212,213,-73", "100,233,234,-258,202,99,-73,206,-477,619,52,325,324,328,327,-306,216", "246,222,40,218,217,214,215,226,224,220,18,221,328,327,511,79,73,75,76", "77,78,652,491,492,74,80,100,237,63,64,65,99,51,56,719,256,57,58,-258", "53,54,61,257,59,60,62,250,251,66,67,505,197,198,509,249,280,284,89,88", "90,91,289,290,211,-419,-426,325,324,328,327,41,-419,-426,93,92,83,50", "85,84,86,87,94,95,219,81,82,459,38,39,37,219,223,228,229,230,225,227", "235,236,231,232,613,212,213,-427,508,233,234,614,202,-423,-427,206,505", "216,52,507,-423,218,217,248,216,459,222,40,218,217,214,215,226,224,220", "210,221,749,733,852,79,73,75,76,77,78,853,645,100,74,80,296,237,99,-212", "-260,-72,253,56,63,64,65,-260,51,53,54,-427,57,58,457,505,769,61,504", "59,60,62,250,251,66,67,197,198,771,523,249,280,284,89,88,90,91,194,-72", "211,549,774,259,851,195,-72,41,550,776,93,92,83,50,85,84,86,87,94,95", "-260,81,82,711,38,39,37,219,223,228,229,230,225,227,235,236,231,232", "-427,212,213,219,495,233,234,-427,202,-240,494,206,778,779,52,780,94", "95,219,193,216,575,222,40,218,217,214,215,226,224,220,210,221,259,296", "268,79,73,75,76,77,78,489,483,482,74,80,219,237,63,64,65,7,51,56,481", "787,57,58,-427,53,54,61,788,59,60,62,23,24,66,67,789,259,259,219,22", "28,27,89,88,90,91,238,-58,17,102,103,104,105,106,6,41,8,9,93,92,83,50", "85,84,86,87,94,95,792,81,82,793,38,39,37,219,223,228,229,230,225,227", "235,236,231,232,487,212,213,466,795,233,234,488,36,459,-238,30,799,640", "52,457,803,805,454,32,216,207,222,40,218,217,214,215,226,224,220,18", "221,423,422,639,79,73,75,76,77,78,-476,811,420,74,80,-238,237,63,64", "65,815,51,56,816,296,57,58,486,53,54,61,638,59,60,62,250,251,66,67,499", "625,825,-241,249,280,284,89,88,90,91,-252,386,211,560,826,828,729,-252", "365,41,362,523,93,92,83,50,85,84,86,87,94,95,-477,81,82,466,38,39,37", "219,223,228,229,230,225,227,235,236,231,232,-259,212,213,838,839,233", "234,-259,202,341,-67,206,842,624,52,844,623,523,523,-252,216,774,222", "40,218,217,214,215,226,224,220,210,221,238,296,564,79,73,75,76,77,78", "288,615,854,74,80,287,237,63,64,65,466,51,56,574,238,57,58,-259,53,54", "61,860,59,60,62,250,251,66,67,296,570,638,610,249,280,284,89,88,90,91", "-259,192,211,191,190,189,870,-259,523,41,872,873,93,92,83,50,85,84,86", "87,94,95,188,81,82,694,38,39,37,219,223,228,229,230,225,227,235,236", "231,232,496,212,213,571,96,233,234,497,202,-239,845,206,,,52,,,,,-259", "216,,222,40,218,217,214,215,226,224,220,210,221,,,,79,73,75,76,77,78", ",,,74,80,,237,63,64,65,,51,56,,,57,58,419,53,54,61,,59,60,62,23,24,66", "67,,,,,22,28,27,89,88,90,91,-259,,17,,,,,-259,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,219,223,228,229,230,225,227,235,236,231", "232,-258,212,213,,,233,234,-258,202,,,206,-477,,52,,,,,-259,216,,222", "40,218,217,214,215,226,224,220,18,221,,,,79,73,75,76,77,78,,,,74,80", ",237,63,64,65,219,51,56,,,57,58,-258,53,54,61,,59,60,62,250,251,66,67", ",,,,249,280,284,89,88,90,91,,216,211,,,218,217,214,215,41,,,93,92,83", "50,85,84,86,87,94,95,,81,82,,38,39,37,219,223,228,229,230,225,227,235", "236,231,232,,212,213,672,,233,234,,202,,745,206,,,52,,,,,601,216,,222", "40,218,217,214,215,226,224,220,210,221,,,-258,79,73,75,76,77,78,-258", ",,74,80,-477,237,593,,-260,,253,56,63,64,65,-260,51,53,54,671,57,58", ",,,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,-258", ",,41,,,93,92,83,50,85,84,86,87,94,95,-260,81,82,,38,39,37,219,223,228", "229,230,225,227,235,236,231,232,,212,213,,,233,234,,202,,,206,,,52,", ",,,248,216,,222,40,218,217,214,215,226,224,220,210,221,,,,79,73,75,76", "77,78,,,,74,80,318,237,322,320,319,321,253,56,63,64,65,7,51,53,54,,57", "58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,325,324", "328,327,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,219", "223,228,229,230,225,227,235,236,231,232,,212,213,,,233,234,,36,,,30", ",,52,,,,,32,216,,222,40,218,217,214,215,226,224,220,18,221,,,,79,73", "75,76,77,78,,,,74,80,,237,63,64,65,219,51,56,,,57,58,,53,54,61,,59,60", "62,23,24,66,67,,,,,22,28,27,89,88,90,91,,216,17,,,218,217,214,215,41", ",,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,219,223,228,229,230", "225,227,235,236,231,232,,212,213,,,233,234,,202,,,206,207,,52,102,103", "104,105,106,216,,222,40,218,217,214,215,226,224,220,18,221,,,,79,73", "75,76,77,78,,,,74,80,,237,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62", "23,24,66,67,,,,,22,28,27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,219,223,228,229,230,225,227,235,236", "231,232,,212,213,,,233,234,,202,,,206,,,52,,,,,,216,,222,40,218,217", "214,215,226,224,220,210,221,,,,79,73,75,76,77,78,,,,74,80,,237,63,64", "65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284", "89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38", "39,37,219,223,228,229,230,225,227,235,236,231,232,,212,213,,,233,234", ",202,,,206,,,52,,,,,,216,,222,40,218,217,214,215,226,224,220,210,221", ",,,79,73,75,76,77,78,,,,74,80,318,237,322,320,319,321,253,56,63,64,65", "7,51,53,54,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90", "91,,,17,,325,324,328,327,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81", "82,,38,39,37,219,223,228,229,230,225,227,235,236,231,232,,212,213,,", "233,234,,36,,,30,,,52,,,,,32,216,,222,40,218,217,214,215,226,224,220", "18,221,,,,79,73,75,76,77,78,,,,74,80,,237,63,64,65,,51,56,,,57,58,,53", "54,61,,59,60,62,250,251,66,67,,,,,249,28,27,89,88,90,91,,,211,,,,,,", "41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,219,223,228,229", "230,225,227,235,236,231,232,,212,213,,,233,234,,202,,,206,,,52,,,,,248", "216,246,222,40,218,217,214,215,226,224,220,210,221,,,,79,73,75,76,77", "78,,,,74,80,686,237,322,320,319,321,253,56,63,64,65,,51,53,54,,57,58", ",,,61,,59,60,62,250,251,66,67,,,,,249,28,27,89,88,90,91,,,211,,325,324", "328,327,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,", ",,,,,,318,,322,320,319,321,202,,,206,,,52,,,,,248,,246,,40,,,,,,,,210", ",,,,79,73,75,76,77,78,,,,74,80,325,324,328,327,,,253,56,63,64,65,713", "51,53,54,,57,58,,,,61,,59,60,62,250,251,66,67,,,,,249,28,27,89,88,90", "91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,", ",,,,,,,,,,,,686,,322,320,319,321,202,,,206,,,52,,,,,248,,246,,40,,,", ",,,,210,,,,,79,73,75,76,77,78,,,,74,80,325,324,328,327,,,253,56,63,64", "65,,51,53,54,,57,58,,,,61,,59,60,62,250,251,66,67,,,,,249,280,284,89", "88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39", "37,219,-498,-498,-498,-498,225,227,,,-498,-498,,,,,,233,234,,202,,,206", ",,52,,,,,601,216,,222,40,218,217,214,215,226,224,220,210,221,,,,79,73", "75,76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62", "23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50", "85,84,86,87,94,95,,81,82,,38,39,37,219,,,,,,,,,,,,,,,,233,234,,36,,", "30,,,52,,,,,32,216,,222,40,218,217,214,215,,,220,18,221,,,,79,73,75", "76,77,78,,-354,,74,80,,,,-354,-354,-354,,56,-354,-354,-354,,-354,53", "54,,,,,,,-354,-354,-354,,,,,,,,-354,-354,,-354,-354,-354,-354,-354,", "318,,322,320,319,321,,,,,,,,,,,,,,,-354,-354,-354,-354,-354,-354,-354", "-354,-354,-354,-354,-354,-354,-354,,,-354,-354,-354,517,,-354,,259,-354", "325,324,328,327,-354,,-354,,-354,,-354,-354,-354,-354,-354,-354,-354", ",-354,-354,-354,,318,,322,320,319,321,,,,,,-354,-354,-354,-354,,-354", "-266,,,,,,-354,-266,-266,-266,,,-266,-266,-266,686,-266,322,320,319", "321,310,,,,,-266,-266,325,324,328,327,,,,-266,-266,,-266,-266,-266,-266", "-266,,,,,,,,,,,680,,,,,,,325,324,328,327,-266,-266,-266,-266,-266,-266", "-266,-266,-266,-266,-266,-266,-266,-266,,,-266,-266,-266,,,-266,,268", "-266,,,,,-266,,-266,,-266,,-266,-266,-266,-266,-266,-266,-266,,-266", ",-266,,,,,,,,,,,,,-266,-266,-266,-266,,-266,63,64,65,7,51,,-266,,57", "58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6", "41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,219,,,,,,,,,,", ",,,,,233,234,,36,,,270,,,52,,,,,32,216,,222,40,218,217,214,215,,,220", "18,221,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54", "61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,281", ",,93,92,83,50,85,84,86,87,94,95,,81,82,219,,686,285,322,320,319,321", ",,,,,,,,233,234,,,,,,278,,,275,,,52,,216,,222,274,218,217,214,215,,680", "220,,221,,,,325,324,328,327,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51", "56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90", "91,,,211,,,,,,,281,,,93,92,83,50,85,84,86,87,94,95,,81,82,,,,285,219", "223,228,229,230,225,227,,,231,232,,,,,,233,234,,278,,,206,,,52,,,,,", "216,,222,,218,217,214,215,226,224,220,,221,,,,79,73,75,76,77,78,,,,74", "80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22", "28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,", "81,82,,38,39,37,219,-498,-498,-498,-498,225,227,,,-498,-498,,,,,,233", "234,,36,,,30,,,52,,,,,32,216,,222,40,218,217,214,215,226,224,220,18", "221,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61", ",59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,281", ",,93,92,83,50,85,84,86,87,94,95,,81,82,,,,285,219,-498,-498,-498,-498", "225,227,,,-498,-498,,,,,,233,234,,654,,,206,,,52,,,,,,216,,222,,218", "217,214,215,226,224,220,,221,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65", "7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90", "91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37", "219,-498,-498,-498,-498,225,227,,,-498,-498,,,,,,233,234,,36,,,30,,", "52,,,,,32,216,,222,40,218,217,214,215,226,224,220,18,221,,,,79,73,75", "76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23", "24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,219,-498,-498,-498,-498,225,227,,,-498", "-498,,,,,,233,234,,36,,,30,,,52,,,,,32,216,,222,40,218,217,214,215,226", "224,220,18,221,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57", "58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,219,,,,,,", ",,,,,,,,,233,234,,202,,,206,,,52,,,,,,216,,222,40,218,217,214,215,,", "220,210,221,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58", ",53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,219,223,228", "229,230,225,227,235,236,231,232,,-498,-498,,,233,234,,202,,,206,,,52", ",,,,,216,,222,40,218,217,214,215,226,224,220,210,221,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,219,-498,-498,-498,-498,225,227,,,-498", "-498,,,,,,233,234,,202,,,206,,,52,,,,,,216,,222,40,218,217,214,215,226", "224,220,210,221,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57", "58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,219,223,228", "229,230,225,227,235,236,231,232,,-498,-498,,,233,234,,202,,,206,,,52", ",,,,601,216,246,222,40,218,217,214,215,226,224,220,210,221,,,,79,73", "75,76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62", "23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50", "85,84,86,87,94,95,,81,82,,38,39,37,219,223,228,229,230,225,227,235,", "231,232,,,,,,233,234,,36,,,30,,,52,,,,,32,216,,222,40,218,217,214,215", "226,224,220,18,221,,,,79,73,75,76,77,78,,-253,,74,80,,,,-253,-253,-253", ",56,-253,-253,-253,219,-253,53,54,,,,,,-253,,-253,-253,,,,233,234,,", "-253,-253,,-253,-253,-253,-253,-253,,,,216,,,,218,217,214,215,,,,,,", ",,,,-253,-253,-253,-253,-253,-253,-253,-253,-253,-253,-253,-253,-253", "-253,,,-253,-253,-253,,,-253,,,-253,,,-253,,-253,,-253,,-253,,-253,-253", "-253,-253,-253,-253,-253,,-253,,-253,,,,,,,,,,,,,-253,-253,-253,-253", ",-253,,,-253,-253,,,-253,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24", "66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86", "87,94,95,219,81,82,,38,39,37,,,,,,,,,,233,234,,,,,,,,,202,,,206,,216", "52,222,,218,217,214,215,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80", ",,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249", "280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,", "81,82,,38,39,37,219,,,,,,,,,,,,,,,,233,234,,202,,,206,,,52,,,,,248,216", ",222,40,218,217,214,215,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,,,,", "253,56,63,64,65,,51,53,54,,57,58,,,,61,,59,60,62,250,251,66,67,,,,,249", "280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,", "81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,248,,,,40,,,,", ",,,210,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,253,56,63,64,65,7,51,53", "54,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17", ",,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,", ",,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78", ",,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67", ",,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87", "94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40", ",,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,", "53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41", ",,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,", "202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,", ",63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27", "89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38", "39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79", "73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62", "23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,", ",,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,100,,,,,99,,56,63", "64,65,7,51,53,54,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27,89", "88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38", "39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79", "73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62", "250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83", "50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,", ",52,,,,,601,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64", "65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284", "89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38", "39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79", "73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62", "23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,", ",,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56", ",,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,281,,,93,92,83,50,85,84,86,87,94,95,,81,82,,,,285,,,,,,", ",,,,,,,,,,,,,833,,,206,,,52,,,,,,,,,,,,,,,,,,,,,,79,73,75,76,77,78,", ",,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67", ",,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87", "94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40", ",,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58", ",53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78", ",,,74,80,,,-473,-473,-473,,-473,56,,,-473,-473,,53,54,-473,,-473,-473", "-473,-473,-473,-473,-473,,-473,,,-473,-473,-473,-473,-473,-473,-473", ",,-473,,,,,,,-473,,,-473,-473,-473,-473,-473,-473,-473,-473,-473,-473", ",-473,-473,,-473,-473,-473,,,,,,,,,,,,,,,,,,,,-473,,,-473,-473,,-473", ",,,,-473,,-473,,-473,,,,,,,,-473,,-473,,,-473,-473,-473,-473,-473,-473", ",,,-473,-473,,,,,,,-473,-473,-474,-474,-474,,-474,-473,-473,,-474,-474", ",,,-474,,-474,-474,-474,-474,-474,-474,-474,,-474,,,-474,-474,-474,-474", "-474,-474,-474,,,-474,,,,,,,-474,,,-474,-474,-474,-474,-474,-474,-474", "-474,-474,-474,,-474,-474,,-474,-474,-474,,,,,,,,,,,,,,,,,,,,-474,,", "-474,-474,,-474,,,,,-474,,-474,,-474,,,,,,,,-474,,-474,,,-474,-474,-474", "-474,-474,-474,,,,-474,-474,,,,,,,-474,-474,63,64,65,7,51,-474,-474", ",57,58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,", ",,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,", ",,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,", ",,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94", "95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,", ",,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,376,51,56,,,57,58,", "53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41", ",,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,", "202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,", ",63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27", "89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38", "39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79", "73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62", "23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,", ",,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56", ",,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,", ",,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,", ",,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94", "95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,", ",,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53", "54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,", ",,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,", ",,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74", "80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249", "280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,", "81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,248,,,,40,,,,", ",,,210,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,253,56,-479,-479,-479,,-479", "53,54,,-479,-479,,,,-479,,-479,-479,-479,-479,-479,-479,-479,,,,,-479", "-479,-479,-479,-479,-479,-479,,,-479,,,,,,,-479,,,-479,-479,-479,-479", "-479,-479,-479,-479,-479,-479,,-479,-479,,-479,-479,-479,,,,,,,,,,,", ",,,,,,,,-479,,,-479,-479,,-479,,,,,-479,,-479,,-479,,,,,,,,-479,,,,", "-479,-479,-479,-479,-479,-479,,,,-479,-479,,,,,,,-479,-479,63,64,65", "7,51,-479,-479,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88", "90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39", "37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73", "75,76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62", "23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50", "85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,", ",,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51", "56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,393,,,,40,,,,,,,,210,,,,,79,73,75", "76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24", "66,67,,,,,22,28,27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86", "87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,393", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78", ",,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67", ",,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87", "94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,248,,,", "40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,253,56,-478,-478", "-478,,-478,53,54,,-478,-478,,,,-478,,-478,-478,-478,-478,-478,-478,-478", ",,,,-478,-478,-478,-478,-478,-478,-478,,,-478,,,,,,,-478,,,-478,-478", "-478,-478,-478,-478,-478,-478,-478,-478,,-478,-478,,-478,-478,-478,", ",,,,,,,,,,,,,,,,,,-478,,,-478,-478,,-478,,,,,-478,,-478,,-478,,,,,,", ",-478,,,,-258,-478,-478,-478,-478,-478,-478,-258,-258,-258,-478,-478", ",-258,-258,,-258,,-478,-478,,,,,,-478,-478,,,,,,,,,-258,-258,,-258,-258", "-258,-258,-258,,,,,,,,,,,,,,,,,,,,,,-258,-258,-258,-258,-258,-258,-258", "-258,-258,-258,-258,-258,-258,-258,,,-258,-258,-258,,585,,,,-258,,,", ",,,-258,,-258,,-258,-258,-258,-258,-258,-258,-258,,-258,,-258,,,,,,", ",,,,,,-258,-258,,-75,,-258,,63,64,65,-83,51,-258,,,57,58,,,,61,,59,60", "62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50", "85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52", ",,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51", "56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91", ",,17,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,", ",,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77", "78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67", ",,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86,87,94", "95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,", ",,,,18,,,,,79,73,75,76,77,78,-480,,,74,80,,,-480,-480,-480,,,56,-480", "-480,,-480,,53,54,,,,,,-480,,,,,,,,,,-480,-480,,-480,-480,-480,-480", "-480,,,,,,,,,,,,,,,,,,,,,,-480,-480,-480,-480,-480,-480,-480,-480,-480", "-480,-480,-480,-480,-480,,,-480,-480,-480,,582,,,,-480,,,,,,,-480,,-480", ",-480,-480,-480,-480,-480,-480,-480,,-480,-480,-480,,,,,,,,,,,,,-480", "-480,,-73,,-480,,63,64,65,-81,51,-480,,,57,58,,,,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,7,51,56,", ",57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17", ",,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,", ",,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78", ",-496,,74,80,,,,-496,-496,-496,,56,-496,-496,-496,,-496,53,54,,,,,,", "-496,-496,-496,,,,,,,,-496,-496,,-496,-496,-496,-496,-496,,,,,,,,,,", ",,,,,,,,,,,-496,-496,-496,-496,-496,-496,-496,-496,-496,-496,-496,-496", "-496,-496,,,-496,-496,-496,,,-496,,259,-496,,,,,-496,,-496,,-496,,-496", "-496,-496,-496,-496,-496,-496,,-496,-496,-496,,,,,,,,,,,,,-496,-496", "-496,-496,,-496,63,64,65,,51,,-496,,57,58,,,,61,,59,60,62,23,24,66,67", ",,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86,87,94", "95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,", ",,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53", "54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,", ",,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,", ",,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74", "80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22", "28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,", "81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,", "18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61", ",59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92", "83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206", ",425,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64", "65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284", "89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38", "39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79", "73,75,76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60", "62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83", "50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52", ",,,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51", "56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90", "91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,", ",,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75", "76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250", "251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,", ",,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56", ",,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251", "66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76", "77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24", "66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84", "86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32", ",,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57", "58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,202,,,206,,,52,,,,,697,,,,40,,,,,,,,210,,,,,79,73,75,76,77", "78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66", "67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86", "87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,", "40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57", "58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,", ",,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,", ",,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67", ",,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87", "94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40", ",,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58", ",53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78", ",,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,", ",,,22,28,27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94", "95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,", ",,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53", "54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,211,,,,,,,41", ",,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,", "202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80", ",,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28", "27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82", ",38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,", ",,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59", "60,62,250,251,66,67,,,,,249,28,27,89,88,90,91,,,211,,,,,,,41,,,93,92", "83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206", ",,52,,,,,248,,246,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,,", ",,253,56,63,64,65,,51,53,54,,57,58,,,,61,,59,60,62,250,251,66,67,,,", ",249,28,27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95", ",81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,475,,,,,248,,246,,40", ",,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,253,56,63,64,65,,51", "53,54,,57,58,,,,61,,59,60,62,250,251,66,67,,,,,249,28,27,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,479,52,,,,,248,,246,,40,,,,,,,,210,,,,,79", "73,75,76,77,78,,,,74,80,,,,,,,253,56,63,64,65,,51,53,54,,57,58,,,,61", ",59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,", ",93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202", ",,206,,,52,,,,,248,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,", ",63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28", "27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81", "82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,270,,,52,,,,,32,,,,40,,,,,,,,18", ",,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,", "59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,", "93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202", ",,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63", "64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284", "89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38", "39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79", "73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62", "250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83", "50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,", ",52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65", ",51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89", "88,90,91,,,211,,,,,,,281,,,93,92,83,50,85,84,86,87,94,95,,81,82,,,,285", ",,,,,,,,,,,,,,,,,,,278,,,206,,,52,,,,,,,,,,,,,,,,,,,,,,79,73,75,76,77", "78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66", "67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86", "87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,270,,,52,,,,,32,,", ",40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57", "58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,", ",,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,", ",,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,-480", ",74,80,,,,-480,-480,-480,,56,-480,-480,-480,,-480,53,54,,,,,,,-480,-480", "-480,,,,,,,,-480,-480,,-480,-480,-480,-480,-480,,,,,,,,,,,,,,,,,,,,", ",-480,-480,-480,-480,-480,-480,-480,-480,-480,-480,-480,-480,-480,-480", ",,-480,-480,-480,,710,-480,,,-480,,,-480,,-480,,-480,,-480,,-480,-480", "-480,-480,-480,-480,-480,,-480,-480,-480,,,,,,,,,,,,,-480,-480,-480", "-480,,-480,,63,64,65,-81,51,-480,,,57,58,,,,61,,59,60,62,250,251,66", "67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86", "87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,", "40,,,,,,,,210,,,,,79,73,75,76,77,78,,-258,,74,80,,,,-258,-258,-258,", "56,-258,-258,-258,,-258,53,54,,,,,,,,-258,-258,,,,,,,,-258,-258,,-258", "-258,-258,-258,-258,,,,,,,,,,,,,,,,,,,,,,-258,-258,-258,-258,-258,-258", "-258,-258,-258,-258,-258,-258,-258,-258,,,-258,-258,-258,,585,-258,", ",-258,,,-258,,-258,,-258,,-258,,-258,-258,-258,-258,-258,-258,-258,", "-258,,-258,,,,,,,,,,,,,-258,-258,-258,-258,,-258,,63,64,65,-83,51,-258", ",,57,58,,,,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,", "211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,", ",,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77", "78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66", "67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86", "87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,", "40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58", ",53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78", ",,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67", ",,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87", "94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40", ",,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,", "53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,", ",,,,,281,,,93,92,83,50,85,84,539,87,94,95,,81,82,,,,285,,,,,,,,,,,,", ",,,,,,,540,,,206,,,52,,,,,,,,,,,,,,,,,,,,,,79,73,75,76,77,78,,,,74,80", ",,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28", "27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82", ",38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,210,,", ",,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59", "60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93", "92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,", ",206,,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63", "64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284", "89,88,90,91,,,211,,,,,,,281,,,93,92,83,50,85,84,539,87,94,95,,81,82", ",,,285,,,,,,,,,,,,,,,,,,,,540,,,206,,,52,,,,,,,,,,,,,,,,,,,,,,79,73", "75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250", "251,66,67,,,,,249,28,27,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,", ",,601,,246,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,253,56", "63,64,65,7,51,53,54,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,22,28,27", "89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82", ",38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,", ",79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59", "60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93", "92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,", ",206,499,,52,,,,,,,,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,", "63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27", "89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82", ",38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,", ",79,73,75,76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59", "60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92", "83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30", ",,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65", "7,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90", "91,,,17,,,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37", ",,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73,75", "76,77,78,,,,74,80,,,63,64,65,7,51,56,,,57,58,,53,54,61,,59,60,62,23", "24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,6,41,8,9,93,92,83,50,85", "84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,,", "32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,7,51,56", ",,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17", ",,,,,6,41,8,9,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,", ",,,,,,,,,,,,36,,,30,,,52,,,,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78", ",,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,", ",,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95", ",81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,", ",18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54", "61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93", "92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,", ",206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64", "65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24,66,67,,,,,22,28,27,89,88", "90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37", ",,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,,40,,,,,,,,18,,,,,79,73,75", "76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,23,24", "66,67,,,,,22,28,27,89,88,90,91,,,17,,,,,,,41,,,93,92,83,50,85,84,86", "87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,,,,", "40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,,57,58", ",53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91,,,211", ",,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,,,,,,,", ",,,,,,,,,202,,,206,,,52,,,,,393,,,,40,,,,,,,,210,,,,,79,73,75,76,77", "78,,,,74,80,,,63,64,65,,51,56,,,57,58,,53,54,61,,59,60,62,250,251,66", "67,,,,,249,280,284,89,88,90,91,,,211,,,,,,,41,,,93,92,83,50,85,84,86", "87,94,95,,81,82,,38,39,37,,,,,,,,,,,,,,,,,,,,202,,,206,,,52,,,,,248", ",,,40,,,,,,,,210,,,,,79,73,75,76,77,78,,,,74,80,,,63,64,65,,51,56,,", "57,58,,53,54,61,,59,60,62,250,251,66,67,,,,,249,280,284,89,88,90,91", ",,211,,,,,,,41,,,93,92,83,50,85,84,86,87,94,95,,81,82,,38,39,37,,,,", ",,,,,,,,,,,,,,,202,,,206,,,52,,,,,248,,,,40,,,,,,,,210,,,,,79,73,75", "76,77,78,,-496,,74,80,,,,-496,-496,-496,253,56,-496,-496,-496,,-496", "53,54,,,,,,,,-496,,,,,,,,,-496,-496,,-496,-496,-496,-496,-496,,,,,,", ",,,,,-496,,,,,,,-496,-496,-496,,,-496,-496,-496,,-496,,,,,-496,,,,,-496", ",-496,,,,,259,-496,-496,-496,,-496,-496,-496,-496,-496,,,,,,,,,,,,,-496", ",,,,,,,,,,,,-496,,-496,,,-496,,-496,,,,,,,-496,,,,,259,-496,,,,,,,,", ",,,,,,,,,,,,-496,,,,,,,,,,,,,-496,,-496,,,-496,153,164,154,177,150,170", "160,159,,,175,158,157,152,178,,,162,151,165,169,171,163,156,,,172,179", "174,173,166,176,161,149,168,167,180,181,182,183,184,148,155,146,147", "144,145,109,111,,,110,,,,,,,,137,138,,135,119,120,121,143,124,126,,", "122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130", "125,123,116,142,117,,,141,185,153,164,154,177,150,170,160,159,,80,175", "158,157,152,178,,,162,151,165,169,171,163,156,,,172,179,174,173,166", "176,161,149,168,167,180,181,182,183,184,148,155,146,147,144,145,109", "111,,,110,,,,,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139", "140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130,125,123,116", "142,117,,,141,185,153,164,154,177,150,170,160,159,,80,175,158,157,152", "178,,,162,151,165,169,171,163,156,,,172,179,174,173,166,176,161,149", "168,167,180,181,182,183,184,148,155,146,147,144,145,109,111,108,,110", ",,,,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140,127,128", ",,,,,,,,,,,,132,131,,118,136,134,133,129,130,125,123,116,142,117,,,141", "185,153,164,154,177,150,170,160,159,,80,175,158,157,152,178,,,162,151", "165,169,171,163,156,,,172,179,174,173,166,176,161,149,168,167,180,181", "182,183,184,148,155,146,147,144,145,109,111,,,110,,,,,,,,137,138,,135", "119,120,121,143,124,126,,,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131", ",118,136,134,133,129,130,125,123,116,142,117,,,141,185,153,164,154,177", "150,170,160,159,,80,175,158,157,152,178,,,162,151,165,169,171,163,156", ",,172,179,174,173,166,176,161,149,168,167,180,181,182,183,184,148,155", "146,147,144,145,109,111,372,371,110,373,,,,,,,137,138,,135,119,120,121", "143,124,126,,,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134", "133,129,130,125,123,116,142,117,,,141,153,164,154,177,150,170,160,159", ",,175,158,157,152,178,,,162,151,165,169,171,163,156,,,172,179,174,349", "348,350,347,149,168,167,180,181,182,183,184,148,155,146,147,345,346", "343,111,85,84,344,87,,,,,,,137,138,,135,119,120,121,143,124,126,,,122", ",,,,139,140,127,128,,,,,,355,,,,,,,132,131,,118,136,134,133,129,130", "125,123,116,142,117,,,141,153,164,154,177,150,170,160,159,,,175,158", "157,152,178,,,162,151,165,169,171,163,156,,,172,179,174,173,166,176", "161,149,168,167,180,181,182,183,184,148,155,146,147,144,145,109,111", ",,110,,,,,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140", "127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130,125,123,116,142", "117,,,141,153,164,154,177,150,170,160,159,,,175,158,157,152,178,,,162", "151,165,169,171,163,156,,,172,179,174,173,166,176,161,149,168,167,180", "181,182,183,184,148,155,146,147,144,145,109,111,372,371,110,373,,,,", ",,137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140,127,128,,,", ",,,,,,,,,132,131,,118,136,134,133,129,130,125,123,116,142,117,865,405", "141,,866,,,,,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140", "127,128,,,,,,259,,,,,,,132,131,,118,136,134,133,129,130,125,123,116", "142,117,463,405,141,,464,,,,,,,,137,138,,135,119,120,121,143,124,126", ",,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130", "125,123,116,142,117,463,405,141,,464,,,,,,,,137,138,,135,119,120,121", "143,124,126,,,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134", "133,129,130,125,123,116,142,117,759,411,141,,802,,,,,,,,137,138,,135", "119,120,121,143,124,126,,,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131", ",118,136,134,133,129,130,125,123,116,142,117,588,411,141,,589,,,,,,", ",137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140,127,128,,,,", ",,,,,,,,132,131,,118,136,134,133,129,130,125,123,116,142,117,586,405", "141,,587,,,,,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140", "127,128,,,,,,259,,,,,,,132,131,,118,136,134,133,129,130,125,123,116", "142,117,867,411,141,,868,,,,,,,,137,138,,135,119,120,121,143,124,126", ",,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130", "125,123,116,142,117,630,411,141,,631,,,,,,,,137,138,,135,119,120,121", "143,124,126,,,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134", "133,129,130,125,123,116,142,117,627,405,141,,628,,,,,,,,137,138,,135", "119,120,121,143,124,126,,,122,,,,,139,140,127,128,,,,,,259,,,,,,,132", "131,,118,136,134,133,129,130,125,123,116,142,117,759,411,141,,757,,", ",,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140,127,128", ",,,,,,,,,,,,132,131,,118,136,134,133,129,130,125,123,116,142,117,463", "405,141,,464,,,,,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139", "140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130,125,123,116", "142,117,407,411,141,,409,,,,,,,,137,138,,135,119,120,121,143,124,126", ",,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130", "125,123,116,142,117,401,405,141,,402,,,,,,,,137,138,,135,119,120,121", "143,124,126,,,122,,,,,139,140,127,128,,,,,,259,,,,,,,132,131,,118,136", "134,133,129,130,125,123,116,142,117,463,405,141,,464,,,,,,,,137,138", ",135,119,120,121,143,124,126,,,122,,,,,139,140,127,128,,,,,,259,,,,", ",,132,131,,118,136,134,133,129,130,125,123,116,142,117,586,405,141,", "587,,,,,,,,137,138,,135,119,120,121,143,124,126,,,122,,,,,139,140,127", "128,,,,,,259,,,,,,,132,131,,118,136,134,133,129,130,125,123,116,142", "117,588,411,141,,589,,,,,,,,137,138,,135,119,120,121,143,124,126,,,122", ",,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133,129,130,125", "123,116,142,117,463,405,141,,464,,,,,,,,137,138,,135,119,120,121,143", "124,126,,,122,,,,,139,140,127,128,,,,,,,,,,,,,132,131,,118,136,134,133", "129,130,125,123,116,142,117,,,141"];

      racc_action_table = arr = (($a = (($b = __opal.Object._scope.Array) == null ? __opal.cm("Array") : $b)).$new || $mm('new')).call($a, 21587, nil);

      idx = 0;

      ($b = (($c = clist).$each || $mm('each')), $b._p = (TMP_1 = function(str) {

        var self = TMP_1._s || this, TMP_2, $a, $b, $c;
        if (str == null) str = nil;

        return ($a = (($b = (($c = str).$split || $mm('split')).call($c, ",", -1)).$each || $mm('each')), $a._p = (TMP_2 = function(i) {

          var self = TMP_2._s || this, $a, $b, $c, $d;
          if (i == null) i = nil;

          if (($a = (($b = i)['$empty?'] || $mm('empty?')).call($b)) === false || $a === nil) {
            (($a = arr)['$[]='] || $mm('[]=')).call($a, idx, (($c = i).$to_i || $mm('to_i')).call($c))
          };
          return idx = (($d = idx)['$+'] || $mm('+')).call($d, 1);
        }, TMP_2._s = self, TMP_2), $a).call($b)
      }, TMP_1._s = Grammar, TMP_1), $b).call($c);

      clist = ["0,0,0,0,0,332,366,533,0,0,677,677,55,0,14,0,0,0,0,0,0,0,96,539,282,466", "0,0,0,0,0,0,0,361,544,0,361,535,551,551,586,0,0,0,0,0,0,0,0,0,0,0,0", "0,0,14,0,0,466,0,0,0,14,636,636,532,534,476,366,298,298,71,676,539,331", "866,840,676,840,71,539,0,837,798,0,539,282,0,586,865,867,624,0,361,361", "55,0,677,755,845,476,629,677,533,0,533,539,282,533,0,0,0,0,0,0,332,636", "332,0,0,332,756,454,454,454,551,454,0,624,26,454,454,539,0,0,454,544", "454,454,454,454,454,454,454,845,845,845,845,454,454,454,454,454,454", "454,544,298,454,528,420,544,532,540,532,454,867,532,454,454,454,454", "454,454,454,454,454,454,562,454,454,201,454,454,454,331,866,331,866", "632,331,866,26,837,798,837,798,587,837,798,865,867,865,867,454,865,867", "454,420,755,454,755,755,26,755,454,329,454,756,454,756,424,424,756,343", "711,634,454,363,201,477,343,454,454,454,454,454,454,562,562,635,454", "454,452,402,587,35,562,430,454,454,459,459,459,637,459,454,454,347,459", "459,203,326,477,459,347,459,459,459,459,459,459,459,711,424,620,452", "459,459,459,459,459,459,459,643,402,459,35,363,363,363,591,402,459,35", "520,459,459,459,459,459,459,459,459,459,459,359,459,459,203,459,459", "459,591,591,591,591,591,591,591,591,591,591,591,834,591,591,348,762", "591,591,834,459,762,348,459,357,644,459,575,520,520,520,520,591,646", "591,459,591,591,591,591,591,591,591,459,591,336,647,336,459,459,459", "459,459,459,359,359,359,459,459,650,591,457,457,457,429,457,459,652", "575,457,457,834,459,459,457,575,457,457,457,457,457,457,457,318,357", "357,357,457,457,457,457,457,457,457,654,429,457,349,617,429,429,391", "401,457,349,288,457,457,457,457,457,457,457,457,457,457,368,457,457", "657,457,457,457,391,391,391,391,391,391,391,391,391,391,391,470,391", "391,542,663,391,391,470,457,401,542,457,288,108,457,665,401,108,108", "288,391,457,391,457,391,391,391,391,391,391,391,457,391,655,655,315", "457,457,457,457,457,457,368,368,368,457,457,470,391,314,391,200,628", "457,457,475,475,475,200,475,457,457,542,475,475,313,301,337,475,301", "475,475,475,475,475,475,475,641,309,309,641,475,475,475,475,475,475", "475,42,628,475,338,346,630,630,42,628,475,771,346,475,475,475,475,475", "475,475,475,475,475,200,475,475,612,475,475,475,785,785,785,785,785", "785,785,785,785,785,785,757,785,785,630,681,785,785,757,475,681,630", "475,757,475,475,771,771,771,771,42,785,475,785,475,785,785,785,785,785", "785,785,475,785,523,523,304,475,475,475,475,475,475,741,285,285,475", "475,3,785,486,486,486,3,486,475,611,25,486,486,757,475,475,486,25,486", "486,486,486,486,486,486,303,15,15,303,486,486,486,486,486,486,486,37", "37,486,344,345,741,741,741,741,486,344,345,486,486,486,486,486,486,486", "486,486,486,428,486,486,603,486,486,486,616,616,616,616,616,616,616", "616,616,616,616,723,616,616,831,302,616,616,723,486,350,831,486,306", "428,486,306,350,428,428,486,616,600,616,486,616,616,616,616,616,616", "616,486,616,869,869,832,486,486,486,486,486,486,832,516,335,486,486", "723,616,335,616,729,627,486,486,493,493,493,729,493,486,486,831,493", "493,598,300,682,493,300,493,493,493,493,493,493,493,330,330,683,684", "493,493,493,493,493,493,493,13,627,493,352,686,408,832,13,627,493,352", "689,493,493,493,493,493,493,493,493,493,493,729,493,493,590,493,493", "493,399,399,399,399,399,399,399,399,399,399,399,276,399,399,293,290", "399,399,276,493,696,289,493,690,690,493,690,690,690,431,13,399,400,399", "493,399,399,399,399,399,399,399,493,399,284,281,280,493,493,493,493", "493,493,278,273,272,493,493,432,399,855,855,855,855,855,493,271,714", "855,855,276,493,493,855,715,855,855,855,855,855,855,855,718,721,722", "433,855,855,855,855,855,855,855,724,269,855,5,5,5,5,5,855,855,855,855", "855,855,855,855,855,855,855,855,855,855,727,855,855,728,855,855,855", "414,414,414,414,414,414,414,414,414,414,414,277,414,414,258,731,414", "414,277,855,247,734,855,735,502,855,244,747,750,243,855,414,211,414", "855,414,414,414,414,414,414,414,855,414,205,204,501,855,855,855,855", "855,855,759,760,202,855,855,396,414,494,494,494,765,494,855,766,767", "494,494,277,855,855,494,500,494,494,494,494,494,494,494,490,485,782", "783,494,494,494,494,494,494,494,279,186,494,362,790,791,626,279,78,494", "77,801,494,494,494,494,494,494,494,494,494,494,802,494,494,583,494,494", "494,241,241,241,241,241,241,241,241,241,241,241,854,241,241,806,807", "241,241,854,494,63,481,494,812,480,494,817,478,819,820,279,241,821,241", "494,241,241,241,241,241,241,241,494,241,472,41,365,494,494,494,494,494", "494,36,471,833,494,494,34,241,495,495,495,578,495,494,394,20,495,495", "854,494,494,495,843,495,495,495,495,495,495,495,469,387,850,468,495", "495,495,495,495,495,495,489,12,495,11,10,9,859,489,861,495,862,864,495", "495,495,495,495,495,495,495,495,495,8,495,495,566,495,495,495,19,19", "19,19,19,19,19,19,19,19,19,291,19,19,388,1,19,19,291,495,573,818,495", ",,495,,,,,489,19,,19,495,19,19,19,19,19,19,19,495,19,,,,495,495,495", "495,495,495,,,,495,495,,19,499,499,499,,499,495,,,499,499,291,495,495", "499,,499,499,499,499,499,499,499,,,,,499,499,499,499,499,499,499,668", ",499,,,,,668,,499,,,499,499,499,499,499,499,499,499,499,499,,499,499", ",499,499,499,712,712,712,712,712,712,712,712,712,712,712,631,712,712", ",,712,712,631,499,,,499,631,,499,,,,,668,712,,712,499,712,712,712,712", "712,712,712,499,712,,,,499,499,499,499,499,499,,,,499,499,,712,504,504", "504,448,504,499,,,504,504,631,499,499,504,,504,504,504,504,504,504,504", ",,,,504,504,504,504,504,504,504,,448,504,,,448,448,448,448,504,,,504", "504,504,504,504,504,504,504,504,504,,504,504,,504,504,504,451,451,451", "451,451,451,451,451,451,451,451,,451,451,653,,451,451,,504,,653,504", ",,504,,,,,504,451,,451,504,451,451,451,451,451,451,451,504,451,,,868", "504,504,504,504,504,504,868,,,504,504,868,451,451,,873,,504,504,851", "851,851,873,851,504,504,653,851,851,,,,851,,851,851,851,851,851,851", "851,,,,,851,851,851,851,851,851,851,,,851,,,,868,,,851,,,851,851,851", "851,851,851,851,851,851,851,873,851,851,,851,851,851,498,498,498,498", "498,498,498,498,498,498,498,,498,498,,,498,498,,851,,,851,,,851,,,,", "851,498,,498,851,498,498,498,498,498,498,498,851,498,,,,851,851,851", "851,851,851,,,,851,851,62,498,62,62,62,62,851,851,849,849,849,849,849", "851,851,,849,849,,,,849,,849,849,849,849,849,849,849,,,,,849,849,849", "849,849,849,849,,,849,,62,62,62,62,849,849,849,849,849,849,849,849,849", "849,849,849,849,849,,849,849,,849,849,849,707,707,707,707,707,707,707", "707,707,707,707,,707,707,,,707,707,,849,,,849,,,849,,,,,849,707,,707", "849,707,707,707,707,707,707,707,849,707,,,,849,849,849,849,849,849,", ",,849,849,,707,17,17,17,447,17,849,,,17,17,,849,849,17,,17,17,17,17", "17,17,17,,,,,17,17,17,17,17,17,17,,447,17,,,447,447,447,447,17,,,17", "17,17,17,17,17,17,17,17,17,,17,17,,17,17,17,705,705,705,705,705,705", "705,705,705,705,705,,705,705,,,705,705,,17,,,17,17,,17,375,375,375,375", "375,705,,705,17,705,705,705,705,705,705,705,17,705,,,,17,17,17,17,17", "17,,,,17,17,,705,18,18,18,,18,17,,,18,18,,17,17,18,,18,18,18,18,18,18", "18,,,,,18,18,18,18,18,18,18,,,18,,,,,,,18,,,18,18,18,18,18,18,18,18", "18,18,,18,18,,18,18,18,702,702,702,702,702,702,702,702,702,702,702,", "702,702,,,702,702,,18,,,18,,,18,,,,,,702,,702,18,702,702,702,702,702", "702,702,18,702,,,,18,18,18,18,18,18,,,,18,18,,702,507,507,507,,507,18", ",,507,507,,18,18,507,,507,507,507,507,507,507,507,,,,,507,507,507,507", "507,507,507,,,507,,,,,,,507,,,507,507,507,507,507,507,507,507,507,507", ",507,507,,507,507,507,700,700,700,700,700,700,700,700,700,700,700,,700", "700,,,700,700,,507,,,507,,,507,,,,,,700,,700,507,700,700,700,700,700", "700,700,507,700,,,,507,507,507,507,507,507,,,,507,507,518,700,518,518", "518,518,507,507,841,841,841,841,841,507,507,,841,841,,,,841,,841,841", "841,841,841,841,841,,,,,841,841,841,841,841,841,841,,,841,,518,518,518", "518,841,841,841,841,841,841,841,841,841,841,841,841,841,841,,841,841", ",841,841,841,695,695,695,695,695,695,695,695,695,695,695,,695,695,,", "695,695,,841,,,841,,,841,,,,,841,695,,695,841,695,695,695,695,695,695", "695,841,695,,,,841,841,841,841,841,841,,,,841,841,,695,22,22,22,,22", "841,,,22,22,,841,841,22,,22,22,22,22,22,22,22,,,,,22,22,22,22,22,22", "22,,,22,,,,,,,22,,,22,22,22,22,22,22,22,22,22,22,,22,22,,22,22,22,633", "633,633,633,633,633,633,633,633,633,633,,633,633,,,633,633,,22,,,22", ",,22,,,,,22,633,22,633,22,633,633,633,633,633,633,633,22,633,,,,22,22", "22,22,22,22,,,,22,22,680,633,680,680,680,680,22,22,23,23,23,,23,22,22", ",23,23,,,,23,,23,23,23,23,23,23,23,,,,,23,23,23,23,23,23,23,,,23,,680", "680,680,680,,23,,,23,23,23,23,23,23,23,23,23,23,,23,23,,23,23,23,,,", ",,,,,,,,,,595,,595,595,595,595,23,,,23,,,23,,,,,23,,23,,23,,,,,,,,23", ",,,,23,23,23,23,23,23,,,,23,23,595,595,595,595,,,23,23,24,24,24,595", "24,23,23,,24,24,,,,24,,24,24,24,24,24,24,24,,,,,24,24,24,24,24,24,24", ",,24,,,,,,,24,,,24,24,24,24,24,24,24,24,24,24,,24,24,,24,24,24,,,,,", ",,,,,,,,769,,769,769,769,769,24,,,24,,,24,,,,,24,,24,,24,,,,,,,,24,", ",,,24,24,24,24,24,24,,,,24,24,769,769,769,769,,,24,24,509,509,509,,509", "24,24,,509,509,,,,509,,509,509,509,509,509,509,509,,,,,509,509,509,509", "509,509,509,,,509,,,,,,,509,,,509,509,509,509,509,509,509,509,509,509", ",509,509,,509,509,509,442,442,442,442,442,442,442,,,442,442,,,,,,442", "442,,509,,,509,,,509,,,,,509,442,,442,509,442,442,442,442,442,442,442", "509,442,,,,509,509,509,509,509,509,,,,509,509,,,514,514,514,514,514", "509,,,514,514,,509,509,514,,514,514,514,514,514,514,514,,,,,514,514", "514,514,514,514,514,,,514,,,,,,514,514,514,514,514,514,514,514,514,514", "514,514,514,514,,514,514,,514,514,514,439,,,,,,,,,,,,,,,,439,439,,514", ",,514,,,514,,,,,514,439,,439,514,439,439,439,439,,,439,514,439,,,,514", "514,514,514,514,514,,27,,514,514,,,,27,27,27,,514,27,27,27,,27,514,514", ",,,,,,27,27,27,,,,,,,,27,27,,27,27,27,27,27,,310,,310,310,310,310,,", ",,,,,,,,,,,,27,27,27,27,27,27,27,27,27,27,27,27,27,27,,,27,27,27,310", ",27,,27,27,310,310,310,310,27,,27,,27,,27,27,27,27,27,27,27,,27,27,27", ",56,,56,56,56,56,,,,,,27,27,27,27,,27,28,,,,,,27,28,28,28,,,28,28,28", "824,28,824,824,824,824,56,,,,,28,28,56,56,56,56,,,,28,28,,28,28,28,28", "28,,,,,,,,,,,824,,,,,,,824,824,824,824,28,28,28,28,28,28,28,28,28,28", "28,28,28,28,,,28,28,28,,,28,,28,28,,,,,28,,28,,28,,28,28,28,28,28,28", "28,,28,,28,,,,,,,,,,,,,28,28,28,28,,28,30,30,30,30,30,,28,,30,30,,,", "30,,30,30,30,30,30,30,30,,,,,30,30,30,30,30,30,30,,,30,,,,,,30,30,30", "30,30,30,30,30,30,30,30,30,30,30,,30,30,,30,30,30,440,,,,,,,,,,,,,,", ",440,440,,30,,,30,,,30,,,,,30,440,,440,30,440,440,440,440,,,440,30,440", ",,,30,30,30,30,30,30,,,,30,30,,,31,31,31,,31,30,,,31,31,,30,30,31,,31", "31,31,31,31,31,31,,,,,31,31,31,31,31,31,31,,,31,,,,,,,31,,,31,31,31", "31,31,31,31,31,31,31,,31,31,441,,547,31,547,547,547,547,,,,,,,,,441", "441,,,,,,31,,,31,,,31,,441,,441,31,441,441,441,441,,547,441,,441,,,", "547,547,547,547,31,31,31,31,31,31,,,,31,31,,,32,32,32,,32,31,,,32,32", ",31,31,32,,32,32,32,32,32,32,32,,,,,32,32,32,32,32,32,32,,,32,,,,,,", "32,,,32,32,32,32,32,32,32,32,32,32,,32,32,,,,32,449,449,449,449,449", "449,449,,,449,449,,,,,,449,449,,32,,,32,,,32,,,,,,449,,449,,449,449", "449,449,449,449,449,,449,,,,32,32,32,32,32,32,,,,32,32,,,515,515,515", "515,515,32,,,515,515,,32,32,515,,515,515,515,515,515,515,515,,,,,515", "515,515,515,515,515,515,,,515,,,,,,515,515,515,515,515,515,515,515,515", "515,515,515,515,515,,515,515,,515,515,515,443,443,443,443,443,443,443", ",,443,443,,,,,,443,443,,515,,,515,,,515,,,,,515,443,,443,515,443,443", "443,443,443,443,443,515,443,,,,515,515,515,515,515,515,,,,515,515,,", "524,524,524,,524,515,,,524,524,,515,515,524,,524,524,524,524,524,524", "524,,,,,524,524,524,524,524,524,524,,,524,,,,,,,524,,,524,524,524,524", "524,524,524,524,524,524,,524,524,,,,524,444,444,444,444,444,444,444", ",,444,444,,,,,,444,444,,524,,,524,,,524,,,,,,444,,444,,444,444,444,444", "444,444,444,,444,,,,524,524,524,524,524,524,,,,524,524,,,527,527,527", "527,527,524,,,527,527,,524,524,527,,527,527,527,527,527,527,527,,,,", "527,527,527,527,527,527,527,,,527,,,,,,527,527,527,527,527,527,527,527", "527,527,527,527,527,527,,527,527,,527,527,527,445,445,445,445,445,445", "445,,,445,445,,,,,,445,445,,527,,,527,,,527,,,,,527,445,,445,527,445", "445,445,445,445,445,445,527,445,,,,527,527,527,527,527,527,,,,527,527", ",,830,830,830,830,830,527,,,830,830,,527,527,830,,830,830,830,830,830", "830,830,,,,,830,830,830,830,830,830,830,,,830,,,,,,830,830,830,830,830", "830,830,830,830,830,830,830,830,830,,830,830,,830,830,830,446,446,446", "446,446,446,446,,,446,446,,,,,,446,446,,830,,,830,,,830,,,,,830,446", ",446,830,446,446,446,446,446,446,446,830,446,,,,830,830,830,830,830", "830,,,,830,830,,,38,38,38,,38,830,,,38,38,,830,830,38,,38,38,38,38,38", "38,38,,,,,38,38,38,38,38,38,38,,,38,,,,,,,38,,,38,38,38,38,38,38,38", "38,38,38,,38,38,,38,38,38,438,,,,,,,,,,,,,,,,438,438,,38,,,38,,,38,", ",,,,438,,438,38,438,438,438,438,,,438,38,438,,,,38,38,38,38,38,38,,", ",38,38,,,39,39,39,,39,38,,,39,39,,38,38,39,,39,39,39,39,39,39,39,,,", ",39,39,39,39,39,39,39,,,39,,,,,,,39,,,39,39,39,39,39,39,39,39,39,39", ",39,39,,39,39,39,426,426,426,426,426,426,426,426,426,426,426,,426,426", ",,426,426,,39,,,39,,,39,,,,,,426,,426,39,426,426,426,426,426,426,426", "39,426,,,,39,39,39,39,39,39,,,,39,39,,,40,40,40,,40,39,,,40,40,,39,39", "40,,40,40,40,40,40,40,40,,,,,40,40,40,40,40,40,40,,,40,,,,,,,40,,,40", "40,40,40,40,40,40,40,40,40,,40,40,,40,40,40,437,437,437,437,437,437", "437,,,437,437,,,,,,437,437,,40,,,40,,,40,,,,,,437,,437,40,437,437,437", "437,437,437,437,40,437,,,,40,40,40,40,40,40,,,,40,40,,,828,828,828,", "828,40,,,828,828,,40,40,828,,828,828,828,828,828,828,828,,,,,828,828", "828,828,828,828,828,,,828,,,,,,,828,,,828,828,828,828,828,828,828,828", "828,828,,828,828,,828,828,828,427,427,427,427,427,427,427,427,427,427", "427,,427,427,,,427,427,,828,,,828,,,828,,,,,828,427,828,427,828,427", "427,427,427,427,427,427,828,427,,,,828,828,828,828,828,828,,,,828,828", ",,531,531,531,531,531,828,,,531,531,,828,828,531,,531,531,531,531,531", "531,531,,,,,531,531,531,531,531,531,531,,,531,,,,,,531,531,531,531,531", "531,531,531,531,531,531,531,531,531,,531,531,,531,531,531,450,450,450", "450,450,450,450,450,,450,450,,,,,,450,450,,531,,,531,,,531,,,,,531,450", ",450,531,450,450,450,450,450,450,450,531,450,,,,531,531,531,531,531", "531,,50,,531,531,,,,50,50,50,,531,50,50,50,436,50,531,531,,,,,,50,,50", "50,,,,436,436,,,50,50,,50,50,50,50,50,,,,436,,,,436,436,436,436,,,,", ",,,,,,50,50,50,50,50,50,50,50,50,50,50,50,50,50,,,50,50,50,,,50,,,50", ",,50,,50,,50,,50,,50,50,50,50,50,50,50,,50,,50,,,,,,,,,,,,,50,50,50", "50,,50,,,50,50,,,50,52,52,52,,52,,,,52,52,,,,52,,52,52,52,52,52,52,52", ",,,,52,52,52,52,52,52,52,,,52,,,,,,,52,,,52,52,52,52,52,52,52,52,52", "52,435,52,52,,52,52,52,,,,,,,,,,435,435,,,,,,,,,52,,,52,,435,52,435", ",435,435,435,435,,,52,,,,,,,,52,,,,,52,52,52,52,52,52,,,,52,52,,,53", "53,53,,53,52,,,53,53,,52,52,53,,53,53,53,53,53,53,53,,,,,53,53,53,53", "53,53,53,,,53,,,,,,,53,,,53,53,53,53,53,53,53,53,53,53,,53,53,,53,53", "53,434,,,,,,,,,,,,,,,,434,434,,53,,,53,,,53,,,,,53,434,,434,53,434,434", "434,434,,,,53,,,,,53,53,53,53,53,53,,,,53,53,,,,,,,53,53,54,54,54,,54", "53,53,,54,54,,,,54,,54,54,54,54,54,54,54,,,,,54,54,54,54,54,54,54,,", "54,,,,,,,54,,,54,54,54,54,54,54,54,54,54,54,,54,54,,54,54,54,,,,,,,", ",,,,,,,,,,,,54,,,54,,,54,,,,,54,,,,54,,,,,,,,54,,,,,54,54,54,54,54,54", ",,,54,54,,,,,,,54,54,536,536,536,536,536,54,54,,536,536,,,,536,,536", "536,536,536,536,536,536,,,,,536,536,536,536,536,536,536,,,536,,,,,,536", "536,536,536,536,536,536,536,536,536,536,536,536,536,,536,536,,536,536", "536,,,,,,,,,,,,,,,,,,,,536,,,536,,,536,,,,,536,,,,536,,,,,,,,536,,,", ",536,536,536,536,536,536,,,,536,536,,,814,814,814,814,814,536,,,814", "814,,536,536,814,,814,814,814,814,814,814,814,,,,,814,814,814,814,814", "814,814,,,814,,,,,,814,814,814,814,814,814,814,814,814,814,814,814,814", "814,,814,814,,814,814,814,,,,,,,,,,,,,,,,,,,,814,,,814,,,814,,,,,814", ",,,814,,,,,,,,814,,,,,814,814,814,814,814,814,,,,814,814,,,57,57,57", ",57,814,,,57,57,,814,814,57,,57,57,57,57,57,57,57,,,,,57,57,57,57,57", "57,57,,,57,,,,,,,57,,,57,57,57,57,57,57,57,57,57,57,,57,57,,57,57,57", ",,,,,,,,,,,,,,,,,,,57,,,57,,,57,,,,,,,,,57,,,,,,,,57,,,,,57,57,57,57", "57,57,,,,57,57,,,58,58,58,,58,57,,,58,58,,57,57,58,,58,58,58,58,58,58", "58,,,,,58,58,58,58,58,58,58,,,58,,,,,,,58,,,58,58,58,58,58,58,58,58", "58,58,,58,58,,58,58,58,,,,,,,,,,,,,,,,,,,,58,,,58,,,58,,,,,,,,,58,,", ",,,,,58,,,,,58,58,58,58,58,58,,,,58,58,,,61,61,61,,61,58,,,61,61,,58", "58,61,,61,61,61,61,61,61,61,,,,,61,61,61,61,61,61,61,,,61,,,,,,,61,", ",61,61,61,61,61,61,61,61,61,61,,61,61,,61,61,61,,,,,,,,,,,,,,,,,,,,61", ",,61,,,61,,,,,,,,,61,,,,,,,,61,,,,,61,61,61,61,61,61,,,,61,61,61,,,", ",61,,61,809,809,809,809,809,61,61,,809,809,,,,809,,809,809,809,809,809", "809,809,,,,,809,809,809,809,809,809,809,,,809,,,,,,809,809,809,809,809", "809,809,809,809,809,809,809,809,809,,809,809,,809,809,809,,,,,,,,,,", ",,,,,,,,,809,,,809,,,809,,,,,809,,,,809,,,,,,,,809,,,,,809,809,809,809", "809,809,,,,809,809,,,808,808,808,,808,809,,,808,808,,809,809,808,,808", "808,808,808,808,808,808,,,,,808,808,808,808,808,808,808,,,808,,,,,,", "808,,,808,808,808,808,808,808,808,808,808,808,,808,808,,808,808,808", ",,,,,,,,,,,,,,,,,,,808,,,808,,,808,,,,,808,,,,808,,,,,,,,808,,,,,808", "808,808,808,808,808,,,,808,808,,,423,423,423,,423,808,,,423,423,,808", "808,423,,423,423,423,423,423,423,423,,,,,423,423,423,423,423,423,423", ",,423,,,,,,,423,,,423,423,423,423,423,423,423,423,423,423,,423,423,", "423,423,423,,,,,,,,,,,,,,,,,,,,423,,,423,,,423,,,,,,,,,423,,,,,,,,423", ",,,,423,423,423,423,423,423,,,,423,423,,,804,804,804,,804,423,,,804", "804,,423,423,804,,804,804,804,804,804,804,804,,,,,804,804,804,804,804", "804,804,,,804,,,,,,,804,,,804,804,804,804,804,804,804,804,804,804,,804", "804,,804,804,804,,,,,,,,,,,,,,,,,,,,804,,,804,,,804,,,,,,,,,804,,,,", ",,,804,,,,,804,804,804,804,804,804,,,,804,804,,,799,799,799,,799,804", ",,799,799,,804,804,799,,799,799,799,799,799,799,799,,,,,799,799,799", "799,799,799,799,,,799,,,,,,,799,,,799,799,799,799,799,799,799,799,799", "799,,799,799,,,,799,,,,,,,,,,,,,,,,,,,,799,,,799,,,799,,,,,,,,,,,,,", ",,,,,,,,799,799,799,799,799,799,,,,799,799,,,422,422,422,,422,799,,", "422,422,,799,799,422,,422,422,422,422,422,422,422,,,,,422,422,422,422", "422,422,422,,,422,,,,,,,422,,,422,422,422,422,422,422,422,422,422,422", ",422,422,,422,422,422,,,,,,,,,,,,,,,,,,,,422,,,422,,,422,,,,,,,,,422", ",,,,,,,422,,,,,422,422,422,422,422,422,,,,422,422,,,421,421,421,,421", "422,,,421,421,,422,422,421,,421,421,421,421,421,421,421,,,,,421,421", "421,421,421,421,421,,,421,,,,,,,421,,,421,421,421,421,421,421,421,421", "421,421,,421,421,,421,421,421,,,,,,,,,,,,,,,,,,,,421,,,421,,,421,,,", ",,,,,421,,,,,,,,421,,,,,421,421,421,421,421,421,,,,421,421,,,83,83,83", ",83,421,,,83,83,,421,421,83,,83,83,83,83,83,83,83,,83,,,83,83,83,83", "83,83,83,,,83,,,,,,,83,,,83,83,83,83,83,83,83,83,83,83,,83,83,,83,83", "83,,,,,,,,,,,,,,,,,,,,83,,,83,83,,83,,,,,83,,83,,83,,,,,,,,83,,83,,", "83,83,83,83,83,83,,,,83,83,,,,,,,83,83,86,86,86,,86,83,83,,86,86,,,", "86,,86,86,86,86,86,86,86,,86,,,86,86,86,86,86,86,86,,,86,,,,,,,86,,", "86,86,86,86,86,86,86,86,86,86,,86,86,,86,86,86,,,,,,,,,,,,,,,,,,,,86", ",,86,86,,86,,,,,86,,86,,86,,,,,,,,86,,86,,,86,86,86,86,86,86,,,,86,86", ",,,,,,86,86,795,795,795,795,795,86,86,,795,795,,,,795,,795,795,795,795", "795,795,795,,,,,795,795,795,795,795,795,795,,,795,,,,,,795,795,795,795", "795,795,795,795,795,795,795,795,795,795,,795,795,,795,795,795,,,,,,", ",,,,,,,,,,,,,795,,,795,,,795,,,,,795,,,,795,,,,,,,,795,,,,,795,795,795", "795,795,795,,,,795,795,,,98,98,98,98,98,795,,,98,98,,795,795,98,,98", "98,98,98,98,98,98,,,,,98,98,98,98,98,98,98,,,98,,,,,,98,98,98,98,98", "98,98,98,98,98,98,98,98,98,,98,98,,98,98,98,,,,,,,,,,,,,,,,,,,,98,,", "98,,,98,,,,,98,,,,98,,,,,,,,98,,,,,98,98,98,98,98,98,,,,98,98,,,102", "102,102,98,102,98,,,102,102,,98,98,102,,102,102,102,102,102,102,102", ",,,,102,102,102,102,102,102,102,,,102,,,,,,,102,,,102,102,102,102,102", "102,102,102,102,102,,102,102,,102,102,102,,,,,,,,,,,,,,,,,,,,102,,,102", ",,102,,,,,,,,,102,,,,,,,,102,,,,,102,102,102,102,102,102,,,,102,102", ",,103,103,103,,103,102,,,103,103,,102,102,103,,103,103,103,103,103,103", "103,,,,,103,103,103,103,103,103,103,,,103,,,,,,,103,,,103,103,103,103", "103,103,103,103,103,103,,103,103,,103,103,103,,,,,,,,,,,,,,,,,,,,103", ",,103,,,103,,,,,,,,,103,,,,,,,,103,,,,,103,103,103,103,103,103,,,,103", "103,,,104,104,104,,104,103,,,104,104,,103,103,104,,104,104,104,104,104", "104,104,,,,,104,104,104,104,104,104,104,,,104,,,,,,,104,,,104,104,104", "104,104,104,104,104,104,104,,104,104,,104,104,104,,,,,,,,,,,,,,,,,,", ",104,,,104,,,104,,,,,,,,,104,,,,,,,,104,,,,,104,104,104,104,104,104", ",,,104,104,,,105,105,105,,105,104,,,105,105,,104,104,105,,105,105,105", "105,105,105,105,,,,,105,105,105,105,105,105,105,,,105,,,,,,,105,,,105", "105,105,105,105,105,105,105,105,105,,105,105,,105,105,105,,,,,,,,,,", ",,,,,,,,,105,,,105,,,105,,,,,,,,,105,,,,,,,,105,,,,,105,105,105,105", "105,105,,,,105,105,,,106,106,106,106,106,105,,,106,106,,105,105,106", ",106,106,106,106,106,106,106,,,,,106,106,106,106,106,106,106,,,106,", ",,,,106,106,106,106,106,106,106,106,106,106,106,106,106,106,,106,106", ",106,106,106,,,,,,,,,,,,,,,,,,,,106,,,106,,,106,,,,,106,,,,106,,,,,", ",,106,,,,,106,106,106,106,106,106,,,,106,106,,,786,786,786,,786,106", ",,786,786,,106,106,786,,786,786,786,786,786,786,786,,,,,786,786,786", "786,786,786,786,,,786,,,,,,,786,,,786,786,786,786,786,786,786,786,786", "786,,786,786,,786,786,786,,,,,,,,,,,,,,,,,,,,786,,,786,,,786,,,,,,,", ",786,,,,,,,,786,,,,,786,786,786,786,786,786,,,,786,786,,,419,419,419", ",419,786,,,419,419,,786,786,419,,419,419,419,419,419,419,419,,,,,419", "419,419,419,419,419,419,,,419,,,,,,,419,,,419,419,419,419,419,419,419", "419,419,419,,419,419,,419,419,419,,,,,,,,,,,,,,,,,,,,419,,,419,,,419", ",,,,419,,,,419,,,,,,,,419,,,,,419,419,419,419,419,419,,,,419,419,,,", ",,,419,419,412,412,412,,412,419,419,,412,412,,,,412,,412,412,412,412", "412,412,412,,,,,412,412,412,412,412,412,412,,,412,,,,,,,412,,,412,412", "412,412,412,412,412,412,412,412,,412,412,,412,412,412,,,,,,,,,,,,,,", ",,,,,412,,,412,412,,412,,,,,412,,412,,412,,,,,,,,412,,,,,412,412,412", "412,412,412,,,,412,412,,,,,,,412,412,188,188,188,188,188,412,412,,188", "188,,,,188,,188,188,188,188,188,188,188,,,,,188,188,188,188,188,188", "188,,,188,,,,,,188,188,188,188,188,188,188,188,188,188,188,188,188,188", ",188,188,,188,188,188,,,,,,,,,,,,,,,,,,,,188,,,188,,,188,,,,,188,,,", "188,,,,,,,,188,,,,,188,188,188,188,188,188,,,,188,188,,,189,189,189", "189,189,188,,,189,189,,188,188,189,,189,189,189,189,189,189,189,,,,", "189,189,189,189,189,189,189,,,189,,,,,,189,189,189,189,189,189,189,189", "189,189,189,189,189,189,,189,189,,189,189,189,,,,,,,,,,,,,,,,,,,,189", ",,189,,,189,,,,,189,,,,189,,,,,,,,189,,,,,189,189,189,189,189,189,,", ",189,189,,,190,190,190,,190,189,,,190,190,,189,189,190,,190,190,190", "190,190,190,190,,,,,190,190,190,190,190,190,190,,,190,,,,,,,190,,,190", "190,190,190,190,190,190,190,190,190,,190,190,,190,190,190,,,,,,,,,,", ",,,,,,,,,190,,,190,,,190,,,,,190,,,,190,,,,,,,,190,,,,,190,190,190,190", "190,190,,,,190,190,,,191,191,191,,191,190,,,191,191,,190,190,191,,191", "191,191,191,191,191,191,,,,,191,191,191,191,191,191,191,,,191,,,,,,", "191,,,191,191,191,191,191,191,191,191,191,191,,191,191,,191,191,191", ",,,,,,,,,,,,,,,,,,,191,,,191,,,191,,,,,191,,,,191,,,,,,,,191,,,,,191", "191,191,191,191,191,,,,191,191,,,192,192,192,,192,191,,,192,192,,191", "191,192,,192,192,192,192,192,192,192,,,,,192,192,192,192,192,192,192", ",,192,,,,,,,192,,,192,192,192,192,192,192,192,192,192,192,,192,192,", "192,192,192,,,,,,,,,,,,,,,,,,,,192,,,192,,,192,,,,,,,,,192,,,,,,,,192", ",,,,192,192,192,192,192,192,,,,192,192,,,193,193,193,,193,192,,,193", "193,,192,192,193,,193,193,193,193,193,193,193,,,,,193,193,193,193,193", "193,193,,,193,,,,,,,193,,,193,193,193,193,193,193,193,193,193,193,,193", "193,,193,193,193,,,,,,,,,,,,,,,,,,,,193,,,193,,,193,,,,,193,,,,193,", ",,,,,,193,,,,,193,193,193,193,193,193,,,,193,193,,,,,,,193,193,411,411", "411,,411,193,193,,411,411,,,,411,,411,411,411,411,411,411,411,,,,,411", "411,411,411,411,411,411,,,411,,,,,,,411,,,411,411,411,411,411,411,411", "411,411,411,,411,411,,411,411,411,,,,,,,,,,,,,,,,,,,,411,,,411,411,", "411,,,,,411,,411,,411,,,,,,,,411,,,,409,411,411,411,411,411,411,409", "409,409,411,411,,409,409,,409,,411,411,,,,,,411,411,,,,,,,,,409,409", ",409,409,409,409,409,,,,,,,,,,,,,,,,,,,,,,409,409,409,409,409,409,409", "409,409,409,409,409,409,409,,,409,409,409,,409,,,,409,,,,,,,409,,409", ",409,409,409,409,409,409,409,,409,,409,,,,,,,,,,,,,409,409,,409,,409", ",196,196,196,409,196,409,,,196,196,,,,196,,196,196,196,196,196,196,196", ",,,,196,196,196,196,196,196,196,,,196,,,,,,,196,,,196,196,196,196,196", "196,196,196,196,196,,196,196,,196,196,196,,,,,,,,,,,,,,,,,,,,196,,,196", ",,196,,,,,,,,,196,,,,,,,,196,,,,,196,196,196,196,196,196,,,,196,196", ",,197,197,197,,197,196,,,197,197,,196,196,197,,197,197,197,197,197,197", "197,,,,,197,197,197,197,197,197,197,,,197,,,,,,,197,,,197,197,197,197", "197,197,197,197,197,197,,197,197,,197,197,197,,,,,,,,,,,,,,,,,,,,197", ",,197,,,197,,,,,,,,,197,,,,,,,,197,,,,,197,197,197,197,197,197,,,,197", "197,,,198,198,198,,198,197,,,198,198,,197,197,198,,198,198,198,198,198", "198,198,,,,,198,198,198,198,198,198,198,,,198,,,,,,,198,,,198,198,198", "198,198,198,198,198,198,198,,198,198,,198,198,198,,,,,,,,,,,,,,,,,,", ",198,,,198,,,198,,,,,,,,,198,,,,,,,,198,,,,,198,198,198,198,198,198", "407,,,198,198,,,407,407,407,,,198,407,407,,407,,198,198,,,,,,407,,,", ",,,,,,407,407,,407,407,407,407,407,,,,,,,,,,,,,,,,,,,,,,407,407,407", "407,407,407,407,407,407,407,407,407,407,407,,,407,407,407,,407,,,,407", ",,,,,,407,,407,,407,407,407,407,407,407,407,,407,407,407,,,,,,,,,,,", ",407,407,,407,,407,,774,774,774,407,774,407,,,774,774,,,,774,,774,774", "774,774,774,774,774,,,,,774,774,774,774,774,774,774,,,774,,,,,,,774", ",,774,774,774,774,774,774,774,774,774,774,,774,774,,774,774,774,,,,", ",,,,,,,,,,,,,,,774,,,774,,,774,,,,,,,,,774,,,,,,,,774,,,,,774,774,774", "774,774,774,,,,774,774,,,761,761,761,761,761,774,,,761,761,,774,774", "761,,761,761,761,761,761,761,761,,,,,761,761,761,761,761,761,761,,,761", ",,,,,761,761,761,761,761,761,761,761,761,761,761,761,761,761,,761,761", ",761,761,761,,,,,,,,,,,,,,,,,,,,761,,,761,,,761,,,,,761,,,,761,,,,,", ",,761,,,,,761,761,761,761,761,761,,403,,761,761,,,,403,403,403,,761", "403,403,403,,403,761,761,,,,,,,403,403,403,,,,,,,,403,403,,403,403,403", "403,403,,,,,,,,,,,,,,,,,,,,,,403,403,403,403,403,403,403,403,403,403", "403,403,403,403,,,403,403,403,,,403,,403,403,,,,,403,,403,,403,,403", "403,403,403,403,403,403,,403,403,403,,,,,,,,,,,,,403,403,403,403,,403", "545,545,545,,545,,403,,545,545,,,,545,,545,545,545,545,545,545,545,", ",,,545,545,545,545,545,545,545,,,545,,,,,,,545,,,545,545,545,545,545", "545,545,545,545,545,,545,545,,545,545,545,,,,,,,,,,,,,,,,,,,,545,,,545", ",,545,,,,,,,,,545,,,,,,,,545,,,,,545,545,545,545,545,545,,,,545,545", ",,572,572,572,,572,545,,,572,572,,545,545,572,,572,572,572,572,572,572", "572,,,,,572,572,572,572,572,572,572,,,572,,,,,,,572,,,572,572,572,572", "572,572,572,572,572,572,,572,572,,572,572,572,,,,,,,,,,,,,,,,,,,,572", ",,572,,,572,,,,,,,,,572,,,,,,,,572,,,,,572,572,572,572,572,572,,,,572", "572,,,206,206,206,206,206,572,,,206,206,,572,572,206,,206,206,206,206", "206,206,206,,,,,206,206,206,206,206,206,206,,,206,,,,,,206,206,206,206", "206,206,206,206,206,206,206,206,206,206,,206,206,,206,206,206,,,,,,", ",,,,,,,,,,,,,206,,,206,,,206,,,,,206,,,,206,,,,,,,,206,,,,,206,206,206", "206,206,206,,,,206,206,,,207,207,207,,207,206,,,207,207,,206,206,207", ",207,207,207,207,207,207,207,,,,,207,207,207,207,207,207,207,,,207,", ",,,,,207,,,207,207,207,207,207,207,207,207,207,207,,207,207,,207,207", "207,,,,,,,,,,,,,,,,,,,,207,,,207,,207,207,,,,,,,,,207,,,,,,,,207,,,", ",207,207,207,207,207,207,,,,207,207,,,210,210,210,,210,207,,,210,210", ",207,207,210,,210,210,210,210,210,210,210,,,,,210,210,210,210,210,210", "210,,,210,,,,,,,210,,,210,210,210,210,210,210,210,210,210,210,,210,210", ",210,210,210,,,,,,,,,,,,,,,,,,,,210,,,210,,,210,,,,,,,,,210,,,,,,,,210", ",,,,210,210,210,210,210,210,,,,210,210,,,752,752,752,752,752,210,,,752", "752,,210,210,752,,752,752,752,752,752,752,752,,,,,752,752,752,752,752", "752,752,,,752,,,,,,752,752,752,752,752,752,752,752,752,752,752,752,752", "752,,752,752,,752,752,752,,,,,,,,,,,,,,,,,,,,752,,,752,,,752,,,,,752", ",,,752,,,,,,,,752,,,,,752,752,752,752,752,752,,,,752,752,,,212,212,212", ",212,752,,,212,212,,752,752,212,,212,212,212,212,212,212,212,,,,,212", "212,212,212,212,212,212,,,212,,,,,,,212,,,212,212,212,212,212,212,212", "212,212,212,,212,212,,212,212,212,,,,,,,,,,,,,,,,,,,,212,,,212,,,212", ",,,,,,,,212,,,,,,,,212,,,,,212,212,212,212,212,212,,,,212,212,,,213", "213,213,,213,212,,,213,213,,212,212,213,,213,213,213,213,213,213,213", ",,,,213,213,213,213,213,213,213,,,213,,,,,,,213,,,213,213,213,213,213", "213,213,213,213,213,,213,213,,213,213,213,,,,,,,,,,,,,,,,,,,,213,,,213", ",,213,,,,,,,,,213,,,,,,,,213,,,,,213,213,213,213,213,213,,,,213,213", ",,214,214,214,,214,213,,,214,214,,213,213,214,,214,214,214,214,214,214", "214,,,,,214,214,214,214,214,214,214,,,214,,,,,,,214,,,214,214,214,214", "214,214,214,214,214,214,,214,214,,214,214,214,,,,,,,,,,,,,,,,,,,,214", ",,214,,,214,,,,,,,,,214,,,,,,,,214,,,,,214,214,214,214,214,214,,,,214", "214,,,215,215,215,,215,214,,,215,215,,214,214,215,,215,215,215,215,215", "215,215,,,,,215,215,215,215,215,215,215,,,215,,,,,,,215,,,215,215,215", "215,215,215,215,215,215,215,,215,215,,215,215,215,,,,,,,,,,,,,,,,,,", ",215,,,215,,,215,,,,,,,,,215,,,,,,,,215,,,,,215,215,215,215,215,215", ",,,215,215,,,216,216,216,,216,215,,,216,216,,215,215,216,,216,216,216", "216,216,216,216,,,,,216,216,216,216,216,216,216,,,216,,,,,,,216,,,216", "216,216,216,216,216,216,216,216,216,,216,216,,216,216,216,,,,,,,,,,", ",,,,,,,,,216,,,216,,,216,,,,,,,,,216,,,,,,,,216,,,,,216,216,216,216", "216,216,,,,216,216,,,217,217,217,,217,216,,,217,217,,216,216,217,,217", "217,217,217,217,217,217,,,,,217,217,217,217,217,217,217,,,217,,,,,,", "217,,,217,217,217,217,217,217,217,217,217,217,,217,217,,217,217,217", ",,,,,,,,,,,,,,,,,,,217,,,217,,,217,,,,,,,,,217,,,,,,,,217,,,,,217,217", "217,217,217,217,,,,217,217,,,218,218,218,,218,217,,,218,218,,217,217", "218,,218,218,218,218,218,218,218,,,,,218,218,218,218,218,218,218,,,218", ",,,,,,218,,,218,218,218,218,218,218,218,218,218,218,,218,218,,218,218", "218,,,,,,,,,,,,,,,,,,,,218,,,218,,,218,,,,,,,,,218,,,,,,,,218,,,,,218", "218,218,218,218,218,,,,218,218,,,219,219,219,,219,218,,,219,219,,218", "218,219,,219,219,219,219,219,219,219,,,,,219,219,219,219,219,219,219", ",,219,,,,,,,219,,,219,219,219,219,219,219,219,219,219,219,,219,219,", "219,219,219,,,,,,,,,,,,,,,,,,,,219,,,219,,,219,,,,,,,,,219,,,,,,,,219", ",,,,219,219,219,219,219,219,,,,219,219,,,220,220,220,,220,219,,,220", "220,,219,219,220,,220,220,220,220,220,220,220,,,,,220,220,220,220,220", "220,220,,,220,,,,,,,220,,,220,220,220,220,220,220,220,220,220,220,,220", "220,,220,220,220,,,,,,,,,,,,,,,,,,,,220,,,220,,,220,,,,,,,,,220,,,,", ",,,220,,,,,220,220,220,220,220,220,,,,220,220,,,221,221,221,,221,220", ",,221,221,,220,220,221,,221,221,221,221,221,221,221,,,,,221,221,221", "221,221,221,221,,,221,,,,,,,221,,,221,221,221,221,221,221,221,221,221", "221,,221,221,,221,221,221,,,,,,,,,,,,,,,,,,,,221,,,221,,,221,,,,,,,", ",221,,,,,,,,221,,,,,221,221,221,221,221,221,,,,221,221,,,222,222,222", ",222,221,,,222,222,,221,221,222,,222,222,222,222,222,222,222,,,,,222", "222,222,222,222,222,222,,,222,,,,,,,222,,,222,222,222,222,222,222,222", "222,222,222,,222,222,,222,222,222,,,,,,,,,,,,,,,,,,,,222,,,222,,,222", ",,,,,,,,222,,,,,,,,222,,,,,222,222,222,222,222,222,,,,222,222,,,223", "223,223,,223,222,,,223,223,,222,222,223,,223,223,223,223,223,223,223", ",,,,223,223,223,223,223,223,223,,,223,,,,,,,223,,,223,223,223,223,223", "223,223,223,223,223,,223,223,,223,223,223,,,,,,,,,,,,,,,,,,,,223,,,223", ",,223,,,,,,,,,223,,,,,,,,223,,,,,223,223,223,223,223,223,,,,223,223", ",,224,224,224,,224,223,,,224,224,,223,223,224,,224,224,224,224,224,224", "224,,,,,224,224,224,224,224,224,224,,,224,,,,,,,224,,,224,224,224,224", "224,224,224,224,224,224,,224,224,,224,224,224,,,,,,,,,,,,,,,,,,,,224", ",,224,,,224,,,,,,,,,224,,,,,,,,224,,,,,224,224,224,224,224,224,,,,224", "224,,,225,225,225,,225,224,,,225,225,,224,224,225,,225,225,225,225,225", "225,225,,,,,225,225,225,225,225,225,225,,,225,,,,,,,225,,,225,225,225", "225,225,225,225,225,225,225,,225,225,,225,225,225,,,,,,,,,,,,,,,,,,", ",225,,,225,,,225,,,,,,,,,225,,,,,,,,225,,,,,225,225,225,225,225,225", ",,,225,225,,,226,226,226,,226,225,,,226,226,,225,225,226,,226,226,226", "226,226,226,226,,,,,226,226,226,226,226,226,226,,,226,,,,,,,226,,,226", "226,226,226,226,226,226,226,226,226,,226,226,,226,226,226,,,,,,,,,,", ",,,,,,,,,226,,,226,,,226,,,,,,,,,226,,,,,,,,226,,,,,226,226,226,226", "226,226,,,,226,226,,,227,227,227,,227,226,,,227,227,,226,226,227,,227", "227,227,227,227,227,227,,,,,227,227,227,227,227,227,227,,,227,,,,,,", "227,,,227,227,227,227,227,227,227,227,227,227,,227,227,,227,227,227", ",,,,,,,,,,,,,,,,,,,227,,,227,,,227,,,,,,,,,227,,,,,,,,227,,,,,227,227", "227,227,227,227,,,,227,227,,,228,228,228,,228,227,,,228,228,,227,227", "228,,228,228,228,228,228,228,228,,,,,228,228,228,228,228,228,228,,,228", ",,,,,,228,,,228,228,228,228,228,228,228,228,228,228,,228,228,,228,228", "228,,,,,,,,,,,,,,,,,,,,228,,,228,,,228,,,,,,,,,228,,,,,,,,228,,,,,228", "228,228,228,228,228,,,,228,228,,,229,229,229,,229,228,,,229,229,,228", "228,229,,229,229,229,229,229,229,229,,,,,229,229,229,229,229,229,229", ",,229,,,,,,,229,,,229,229,229,229,229,229,229,229,229,229,,229,229,", "229,229,229,,,,,,,,,,,,,,,,,,,,229,,,229,,,229,,,,,,,,,229,,,,,,,,229", ",,,,229,229,229,229,229,229,,,,229,229,,,230,230,230,,230,229,,,230", "230,,229,229,230,,230,230,230,230,230,230,230,,,,,230,230,230,230,230", "230,230,,,230,,,,,,,230,,,230,230,230,230,230,230,230,230,230,230,,230", "230,,230,230,230,,,,,,,,,,,,,,,,,,,,230,,,230,,,230,,,,,,,,,230,,,,", ",,,230,,,,,230,230,230,230,230,230,,,,230,230,,,231,231,231,,231,230", ",,231,231,,230,230,231,,231,231,231,231,231,231,231,,,,,231,231,231", "231,231,231,231,,,231,,,,,,,231,,,231,231,231,231,231,231,231,231,231", "231,,231,231,,231,231,231,,,,,,,,,,,,,,,,,,,,231,,,231,,,231,,,,,,,", ",231,,,,,,,,231,,,,,231,231,231,231,231,231,,,,231,231,,,232,232,232", ",232,231,,,232,232,,231,231,232,,232,232,232,232,232,232,232,,,,,232", "232,232,232,232,232,232,,,232,,,,,,,232,,,232,232,232,232,232,232,232", "232,232,232,,232,232,,232,232,232,,,,,,,,,,,,,,,,,,,,232,,,232,,,232", ",,,,,,,,232,,,,,,,,232,,,,,232,232,232,232,232,232,,,,232,232,,,233", "233,233,,233,232,,,233,233,,232,232,233,,233,233,233,233,233,233,233", ",,,,233,233,233,233,233,233,233,,,233,,,,,,,233,,,233,233,233,233,233", "233,233,233,233,233,,233,233,,233,233,233,,,,,,,,,,,,,,,,,,,,233,,,233", ",,233,,,,,,,,,233,,,,,,,,233,,,,,233,233,233,233,233,233,,,,233,233", ",,234,234,234,,234,233,,,234,234,,233,233,234,,234,234,234,234,234,234", "234,,,,,234,234,234,234,234,234,234,,,234,,,,,,,234,,,234,234,234,234", "234,234,234,234,234,234,,234,234,,234,234,234,,,,,,,,,,,,,,,,,,,,234", ",,234,,,234,,,,,,,,,234,,,,,,,,234,,,,,234,234,234,234,234,234,,,,234", "234,,,235,235,235,,235,234,,,235,235,,234,234,235,,235,235,235,235,235", "235,235,,,,,235,235,235,235,235,235,235,,,235,,,,,,,235,,,235,235,235", "235,235,235,235,235,235,235,,235,235,,235,235,235,,,,,,,,,,,,,,,,,,", ",235,,,235,,,235,,,,,,,,,235,,,,,,,,235,,,,,235,235,235,235,235,235", ",,,235,235,,,236,236,236,,236,235,,,236,236,,235,235,236,,236,236,236", "236,236,236,236,,,,,236,236,236,236,236,236,236,,,236,,,,,,,236,,,236", "236,236,236,236,236,236,236,236,236,,236,236,,236,236,236,,,,,,,,,,", ",,,,,,,,,236,,,236,,,236,,,,,,,,,236,,,,,,,,236,,,,,236,236,236,236", "236,236,,,,236,236,,,237,237,237,,237,236,,,237,237,,236,236,237,,237", "237,237,237,237,237,237,,,,,237,237,237,237,237,237,237,,,237,,,,,,", "237,,,237,237,237,237,237,237,237,237,237,237,,237,237,,237,237,237", ",,,,,,,,,,,,,,,,,,,237,,,237,,,237,,,,,,,,,237,,,,,,,,237,,,,,237,237", "237,237,237,237,,,,237,237,,,393,393,393,,393,237,,,393,393,,237,237", "393,,393,393,393,393,393,393,393,,,,,393,393,393,393,393,393,393,,,393", ",,,,,,393,,,393,393,393,393,393,393,393,393,393,393,,393,393,,393,393", "393,,,,,,,,,,,,,,,,,,,,393,,,393,,,393,,,,,,,,,393,,,,,,,,393,,,,,393", "393,393,393,393,393,,,,393,393,,,751,751,751,751,751,393,,,751,751,", "393,393,751,,751,751,751,751,751,751,751,,,,,751,751,751,751,751,751", "751,,,751,,,,,,751,751,751,751,751,751,751,751,751,751,751,751,751,751", ",751,751,,751,751,751,,,,,,,,,,,,,,,,,,,,751,,,751,,,751,,,,,751,,,", "751,,,,,,,,751,,,,,751,751,751,751,751,751,,,,751,751,,,574,574,574", ",574,751,,,574,574,,751,751,574,,574,574,574,574,574,574,574,,,,,574", "574,574,574,574,574,574,,,574,,,,,,,574,,,574,574,574,574,574,574,574", "574,574,574,,574,574,,574,574,574,,,,,,,,,,,,,,,,,,,,574,,,574,,,574", ",,,,574,,,,574,,,,,,,,574,,,,,574,574,574,574,574,574,,,,574,574,,,246", "246,246,,246,574,,,246,246,,574,574,246,,246,246,246,246,246,246,246", ",,,,246,246,246,246,246,246,246,,,246,,,,,,,246,,,246,246,246,246,246", "246,246,246,246,246,,246,246,,246,246,246,,,,,,,,,,,,,,,,,,,,246,,,246", ",,246,,,,,,,,,246,,,,,,,,246,,,,,246,246,246,246,246,246,,,,246,246", ",,733,733,733,733,733,246,,,733,733,,246,246,733,,733,733,733,733,733", "733,733,,,,,733,733,733,733,733,733,733,,,733,,,,,,733,733,733,733,733", "733,733,733,733,733,733,733,733,733,,733,733,,733,733,733,,,,,,,,,,", ",,,,,,,,,733,,,733,,,733,,,,,733,,,,733,,,,,,,,733,,,,,733,733,733,733", "733,733,,,,733,733,,,248,248,248,,248,733,,,248,248,,733,733,248,,248", "248,248,248,248,248,248,,,,,248,248,248,248,248,248,248,,,248,,,,,,", "248,,,248,248,248,248,248,248,248,248,248,248,,248,248,,248,248,248", ",,,,,,,,,,,,,,,,,,,248,,,248,,,248,,,,,,,,,248,,,,,,,,248,,,,,248,248", "248,248,248,248,,,,248,248,,,253,253,253,,253,248,,,253,253,,248,248", "253,,253,253,253,253,253,253,253,,,,,253,253,253,253,253,253,253,,,253", ",,,,,,253,,,253,253,253,253,253,253,253,253,253,253,,253,253,,253,253", "253,,,,,,,,,,,,,,,,,,,,253,,,253,,,253,,,,,,,,,253,,,,,,,,253,,,,,253", "253,253,253,253,253,,,,253,253,,,576,576,576,,576,253,,,576,576,,253", "253,576,,576,576,576,576,576,576,576,,,,,576,576,576,576,576,576,576", ",,576,,,,,,,576,,,576,576,576,576,576,576,576,576,576,576,,576,576,", "576,576,576,,,,,,,,,,,,,,,,,,,,576,,,576,,,576,,,,,,,,,576,,,,,,,,576", ",,,,576,576,576,576,576,576,,,,576,576,,,577,577,577,,577,576,,,577", "577,,576,576,577,,577,577,577,577,577,577,577,,,,,577,577,577,577,577", "577,577,,,577,,,,,,,577,,,577,577,577,577,577,577,577,577,577,577,,577", "577,,577,577,577,,,,,,,,,,,,,,,,,,,,577,,,577,,,577,,,,,,,,,577,,,,", ",,,577,,,,,577,577,577,577,577,577,,,,577,577,,,582,582,582,,582,577", ",,582,582,,577,577,582,,582,582,582,582,582,582,582,,,,,582,582,582", "582,582,582,582,,,582,,,,,,,582,,,582,582,582,582,582,582,582,582,582", "582,,582,582,,582,582,582,,,,,,,,,,,,,,,,,,,,582,,,582,,,582,,,,,,,", ",582,,,,,,,,582,,,,,582,582,582,582,582,582,,,,582,582,,,259,259,259", ",259,582,,,259,259,,582,582,259,,259,259,259,259,259,259,259,,,,,259", "259,259,259,259,259,259,,,259,,,,,,,259,,,259,259,259,259,259,259,259", "259,259,259,,259,259,,259,259,259,,,,,,,,,,,,,,,,,,,,259,,,259,,,259", ",,,,259,,259,,259,,,,,,,,259,,,,,259,259,259,259,259,259,,,,259,259", ",,,,,,259,259,260,260,260,,260,259,259,,260,260,,,,260,,260,260,260", "260,260,260,260,,,,,260,260,260,260,260,260,260,,,260,,,,,,,260,,,260", "260,260,260,260,260,260,260,260,260,,260,260,,260,260,260,,,,,,,,,,", ",,,,,,,,,260,,,260,,,260,,,,,260,,260,,260,,,,,,,,260,,,,,260,260,260", "260,260,260,,,,260,260,,,,,,,260,260,268,268,268,,268,260,260,,268,268", ",,,268,,268,268,268,268,268,268,268,,,,,268,268,268,268,268,268,268", ",,268,,,,,,,268,,,268,268,268,268,268,268,268,268,268,268,,268,268,", "268,268,268,,,,,,,,,,,,,,,,,,,,268,,,268,,268,268,,,,,268,,268,,268", ",,,,,,,268,,,,,268,268,268,268,268,268,,,,268,268,,,,,,,268,268,725", "725,725,,725,268,268,,725,725,,,,725,,725,725,725,725,725,725,725,,", ",,725,725,725,725,725,725,725,,,725,,,,,,,725,,,725,725,725,725,725", "725,725,725,725,725,,725,725,,725,725,725,,,,,,,,,,,,,,,,,,,,725,,,725", ",,725,,,,,725,,,,725,,,,,,,,725,,,,,725,725,725,725,725,725,,,,725,725", ",,270,270,270,270,270,725,,,270,270,,725,725,270,,270,270,270,270,270", "270,270,,,,,270,270,270,270,270,270,270,,,270,,,,,,270,270,270,270,270", "270,270,270,270,270,270,270,270,270,,270,270,,270,270,270,,,,,,,,,,", ",,,,,,,,,270,,,270,,,270,,,,,270,,,,270,,,,,,,,270,,,,,270,270,270,270", "270,270,,,,270,270,,,585,585,585,,585,270,,,585,585,,270,270,585,,585", "585,585,585,585,585,585,,,,,585,585,585,585,585,585,585,,,585,,,,,,", "585,,,585,585,585,585,585,585,585,585,585,585,,585,585,,585,585,585", ",,,,,,,,,,,,,,,,,,,585,,,585,,,585,,,,,,,,,585,,,,,,,,585,,,,,585,585", "585,585,585,585,,,,585,585,,,710,710,710,,710,585,,,710,710,,585,585", "710,,710,710,710,710,710,710,710,,,,,710,710,710,710,710,710,710,,,710", ",,,,,,710,,,710,710,710,710,710,710,710,710,710,710,,710,710,,710,710", "710,,,,,,,,,,,,,,,,,,,,710,,,710,,,710,,,,,,,,,710,,,,,,,,710,,,,,710", "710,710,710,710,710,,,,710,710,,,709,709,709,,709,710,,,709,709,,710", "710,709,,709,709,709,709,709,709,709,,,,,709,709,709,709,709,709,709", ",,709,,,,,,,709,,,709,709,709,709,709,709,709,709,709,709,,709,709,", "709,709,709,,,,,,,,,,,,,,,,,,,,709,,,709,,,709,,,,,,,,,709,,,,,,,,709", ",,,,709,709,709,709,709,709,,,,709,709,,,274,274,274,,274,709,,,274", "274,,709,709,274,,274,274,274,274,274,274,274,,,,,274,274,274,274,274", "274,274,,,274,,,,,,,274,,,274,274,274,274,274,274,274,274,274,274,,274", "274,,,,274,,,,,,,,,,,,,,,,,,,,274,,,274,,,274,,,,,,,,,,,,,,,,,,,,,,274", "274,274,274,274,274,,,,274,274,,,275,275,275,275,275,274,,,275,275,", "274,274,275,,275,275,275,275,275,275,275,,,,,275,275,275,275,275,275", "275,,,275,,,,,,275,275,275,275,275,275,275,275,275,275,275,275,275,275", ",275,275,,275,275,275,,,,,,,,,,,,,,,,,,,,275,,,275,,,275,,,,,275,,,", "275,,,,,,,,275,,,,,275,275,275,275,275,275,,,,275,275,,,355,355,355", ",355,275,,,355,355,,275,275,355,,355,355,355,355,355,355,355,,,,,355", "355,355,355,355,355,355,,,355,,,,,,,355,,,355,355,355,355,355,355,355", "355,355,355,,355,355,,355,355,355,,,,,,,,,,,,,,,,,,,,355,,,355,,,355", ",,,,,,,,355,,,,,,,,355,,,,,355,355,355,355,355,355,,588,,355,355,,,", "588,588,588,,355,588,588,588,,588,355,355,,,,,,,588,588,588,,,,,,,,588", "588,,588,588,588,588,588,,,,,,,,,,,,,,,,,,,,,,588,588,588,588,588,588", "588,588,588,588,588,588,588,588,,,588,588,588,,588,588,,,588,,,588,", "588,,588,,588,,588,588,588,588,588,588,588,,588,588,588,,,,,,,,,,,,", "588,588,588,588,,588,,708,708,708,588,708,588,,,708,708,,,,708,,708", "708,708,708,708,708,708,,,,,708,708,708,708,708,708,708,,,708,,,,,,", "708,,,708,708,708,708,708,708,708,708,708,708,,708,708,,708,708,708", ",,,,,,,,,,,,,,,,,,,708,,,708,,,708,,,,,,,,,708,,,,,,,,708,,,,,708,708", "708,708,708,708,,589,,708,708,,,,589,589,589,,708,589,589,589,,589,708", "708,,,,,,,,589,589,,,,,,,,589,589,,589,589,589,589,589,,,,,,,,,,,,,", ",,,,,,,,589,589,589,589,589,589,589,589,589,589,589,589,589,589,,,589", "589,589,,589,589,,,589,,,589,,589,,589,,589,,589,589,589,589,589,589", "589,,589,,589,,,,,,,,,,,,,589,589,589,589,,589,,593,593,593,589,593", "589,,,593,593,,,,593,,593,593,593,593,593,593,593,,,,,593,593,593,593", "593,593,593,,,593,,,,,,,593,,,593,593,593,593,593,593,593,593,593,593", ",593,593,,593,593,593,,,,,,,,,,,,,,,,,,,,593,,,593,,,593,,,,,,,,,593", ",,,,,,,593,,,,,593,593,593,593,593,593,,,,593,593,,,597,597,597,597", "597,593,,,597,597,,593,593,597,,597,597,597,597,597,597,597,,,,,597", "597,597,597,597,597,597,,,597,,,,,,597,597,597,597,597,597,597,597,597", "597,597,597,597,597,,597,597,,597,597,597,,,,,,,,,,,,,,,,,,,,597,,,597", ",,597,,,,,597,,,,597,,,,,,,,597,,,,,597,597,597,597,597,597,,,,597,597", ",,601,601,601,,601,597,,,601,601,,597,597,601,,601,601,601,601,601,601", "601,,,,,601,601,601,601,601,601,601,,,601,,,,,,,601,,,601,601,601,601", "601,601,601,601,601,601,,601,601,,601,601,601,,,,,,,,,,,,,,,,,,,,601", ",,601,,,601,,,,,,,,,601,,,,,,,,601,,,,,601,601,601,601,601,601,,,,601", "601,,,609,609,609,609,609,601,,,609,609,,601,601,609,,609,609,609,609", "609,609,609,,,,,609,609,609,609,609,609,609,,,609,,,,,,609,609,609,609", "609,609,609,609,609,609,609,609,609,609,,609,609,,609,609,609,,,,,,", ",,,,,,,,,,,,,609,,,609,,,609,,,,,609,,,,609,,,,,,,,609,,,,,609,609,609", "609,609,609,,,,609,609,,,342,342,342,,342,609,,,342,342,,609,609,342", ",342,342,342,342,342,342,342,,,,,342,342,342,342,342,342,342,,,342,", ",,,,,342,,,342,342,342,342,342,342,342,342,342,342,,342,342,,,,342,", ",,,,,,,,,,,,,,,,,,342,,,342,,,342,,,,,,,,,,,,,,,,,,,,,,342,342,342,342", "342,342,,,,342,342,,,698,698,698,,698,342,,,698,698,,342,342,698,,698", "698,698,698,698,698,698,,,,,698,698,698,698,698,698,698,,,698,,,,,,", "698,,,698,698,698,698,698,698,698,698,698,698,,698,698,,698,698,698", ",,,,,,,,,,,,,,,,,,,698,,,698,,,698,,,,,,,,,698,,,,,,,,698,,,,,698,698", "698,698,698,698,,,,698,698,,,697,697,697,,697,698,,,697,697,,698,698", "697,,697,697,697,697,697,697,697,,,,,697,697,697,697,697,697,697,,,697", ",,,,,,697,,,697,697,697,697,697,697,697,697,697,697,,697,697,,697,697", "697,,,,,,,,,,,,,,,,,,,,697,,,697,,,697,,,,,,,,,697,,,,,,,,697,,,,,697", "697,697,697,697,697,,,,697,697,,,340,340,340,,340,697,,,340,340,,697", "697,340,,340,340,340,340,340,340,340,,,,,340,340,340,340,340,340,340", ",,340,,,,,,,340,,,340,340,340,340,340,340,340,340,340,340,,340,340,", ",,340,,,,,,,,,,,,,,,,,,,,340,,,340,,,340,,,,,,,,,,,,,,,,,,,,,,340,340", "340,340,340,340,,,,340,340,,,615,615,615,,615,340,,,615,615,,340,340", "615,,615,615,615,615,615,615,615,,,,,615,615,615,615,615,615,615,,,615", ",,,,,,615,,,615,615,615,615,615,615,615,615,615,615,,615,615,,615,615", "615,,,,,,,,,,,,,,,,,,,,615,,,615,,,615,,,,,615,,615,,615,,,,,,,,615", ",,,,615,615,615,615,615,615,,,,615,615,,,,,,,615,615,691,691,691,691", "691,615,615,,691,691,,,,691,,691,691,691,691,691,691,691,,,,,691,691", "691,691,691,691,691,,,691,,,,,,691,691,691,691,691,691,691,691,691,691", "691,691,691,691,,691,691,,691,691,691,,,,,,,,,,,,,,,,,,,,691,,,691,", ",691,,,,,691,,,,691,,,,,,,,691,,,,,691,691,691,691,691,691,,,,691,691", ",,295,295,295,,295,691,,,295,295,,691,691,295,,295,295,295,295,295,295", "295,,,,,295,295,295,295,295,295,295,,,295,,,,,,,295,,,295,295,295,295", "295,295,295,295,295,295,,295,295,,295,295,295,,,,,,,,,,,,,,,,,,,,295", ",,295,295,,295,,,,,,,,,295,,,,,,,,295,,,,,295,295,295,295,295,295,,", ",295,295,,,297,297,297,297,297,295,,,297,297,,295,295,297,,297,297,297", "297,297,297,297,,,,,297,297,297,297,297,297,297,,,297,,,,,,297,297,297", "297,297,297,297,297,297,297,297,297,297,297,,297,297,,297,297,297,,", ",,,,,,,,,,,,,,,,,297,,,297,,,297,,,,,297,,,,297,,,,,,,,297,,,,,297,297", "297,297,297,297,,,,297,297,,,621,621,621,621,621,297,,,621,621,,297", "297,621,,621,621,621,621,621,621,621,,,,,621,621,621,621,621,621,621", ",,621,,,,,,621,621,621,621,621,621,621,621,621,621,621,621,621,621,", "621,621,,621,621,621,,,,,,,,,,,,,,,,,,,,621,,,621,,,621,,,,,621,,,,621", ",,,,,,,621,,,,,621,621,621,621,621,621,,,,621,621,,,622,622,622,622", "622,621,,,622,622,,621,621,622,,622,622,622,622,622,622,622,,,,,622", "622,622,622,622,622,622,,,622,,,,,,622,622,622,622,622,622,622,622,622", "622,622,622,622,622,,622,622,,622,622,622,,,,,,,,,,,,,,,,,,,,622,,,622", ",,622,,,,,622,,,,622,,,,,,,,622,,,,,622,622,622,622,622,622,,,,622,622", ",,679,679,679,679,679,622,,,679,679,,622,622,679,,679,679,679,679,679", "679,679,,,,,679,679,679,679,679,679,679,,,679,,,,,,679,679,679,679,679", "679,679,679,679,679,679,679,679,679,,679,679,,679,679,679,,,,,,,,,,", ",,,,,,,,,679,,,679,,,679,,,,,679,,,,679,,,,,,,,679,,,,,679,679,679,679", "679,679,,,,679,679,,,678,678,678,678,678,679,,,678,678,,679,679,678", ",678,678,678,678,678,678,678,,,,,678,678,678,678,678,678,678,,,678,", ",,,,678,678,678,678,678,678,678,678,678,678,678,678,678,678,,678,678", ",678,678,678,,,,,,,,,,,,,,,,,,,,678,,,678,,,678,,,,,678,,,,678,,,,,", ",,678,,,,,678,678,678,678,678,678,,,,678,678,,,334,334,334,,334,678", ",,334,334,,678,678,334,,334,334,334,334,334,334,334,,,,,334,334,334", "334,334,334,334,,,334,,,,,,,334,,,334,334,334,334,334,334,334,334,334", "334,,334,334,,334,334,334,,,,,,,,,,,,,,,,,,,,334,,,334,,,334,,,,,,,", ",334,,,,,,,,334,,,,,334,334,334,334,334,334,,,,334,334,,,675,675,675", ",675,334,,,675,675,,334,334,675,,675,675,675,675,675,675,675,,,,,675", "675,675,675,675,675,675,,,675,,,,,,,675,,,675,675,675,675,675,675,675", "675,675,675,,675,675,,675,675,675,,,,,,,,,,,,,,,,,,,,675,,,675,,,675", ",,,,,,,,675,,,,,,,,675,,,,,675,675,675,675,675,675,,,,675,675,,,333", "333,333,,333,675,,,333,333,,675,675,333,,333,333,333,333,333,333,333", ",,,,333,333,333,333,333,333,333,,,333,,,,,,,333,,,333,333,333,333,333", "333,333,333,333,333,,333,333,,333,333,333,,,,,,,,,,,,,,,,,,,,333,,,333", ",,333,,,,,,,,,333,,,,,,,,333,,,,,333,333,333,333,333,333,,,,333,333", ",,667,667,667,,667,333,,,667,667,,333,333,667,,667,667,667,667,667,667", "667,,,,,667,667,667,667,667,667,667,,,667,,,,,,,667,,,667,667,667,667", "667,667,667,667,667,667,,667,667,,667,667,667,,,,,,,,,,,,,,,,,,,,667", ",,667,,,667,,,,,,,,,667,,,,,,,,667,,,,,667,667,667,667,667,667,,,,667", "667,,,638,638,638,,638,667,,,638,638,,667,667,638,,638,638,638,638,638", "638,638,,,,,638,638,638,638,638,638,638,,,638,,,,,,,638,,,638,638,638", "638,638,638,638,638,638,638,,638,638,,638,638,638,,,,,,,,,,,,,,,,,,", ",638,,,638,,,638,,,,,638,,,,638,,,,,,,,638,,,,,638,638,638,638,638,638", ",,,638,638,,,666,666,666,,666,638,,,666,666,,638,638,666,,666,666,666", "666,666,666,666,,,,,666,666,666,666,666,666,666,,,666,,,,,,,666,,,666", "666,666,666,666,666,666,666,666,666,,666,666,,666,666,666,,,,,,,,,,", ",,,,,,,,,666,,,666,,,666,,,,,666,,,,666,,,,,,,,666,,,,,666,666,666,666", "666,666,,,,666,666,,,671,671,671,,671,666,,,671,671,,666,666,671,,671", "671,671,671,671,671,671,,,,,671,671,671,671,671,671,671,,,671,,,,,,", "671,,,671,671,671,671,671,671,671,671,671,671,,671,671,,671,671,671", ",,,,,,,,,,,,,,,,,,,671,,,671,,,671,,,,,671,,,,671,,,,,,,,671,,,,,671", "671,671,671,671,671,,462,,671,671,,,,462,462,462,671,671,462,462,462", ",462,671,671,,,,,,,,462,,,,,,,,,462,462,,462,462,462,462,462,,,,,,,", ",,,,465,,,,,,,465,465,465,,,465,465,465,,465,,,,,462,,,,,465,,462,,", ",,462,462,465,465,,465,465,465,465,465,,,,,,,,,,,,,462,,,,,,,,,,,,,462", ",462,,,462,,465,,,,,,,465,,,,,465,465,,,,,,,,,,,,,,,,,,,,,465,,,,,,", ",,,,,,465,,465,,,465,382,382,382,382,382,382,382,382,,,382,382,382,382", "382,,,382,382,382,382,382,382,382,,,382,382,382,382,382,382,382,382", "382,382,382,382,382,382,382,382,382,382,382,382,382,382,382,,,382,,", ",,,,,382,382,,382,382,382,382,382,382,382,,,382,,,,,382,382,382,382", ",,,,,,,,,,,,382,382,,382,382,382,382,382,382,382,382,382,382,382,,,382", "382,386,386,386,386,386,386,386,386,,382,386,386,386,386,386,,,386,386", "386,386,386,386,386,,,386,386,386,386,386,386,386,386,386,386,386,386", "386,386,386,386,386,386,386,386,386,386,386,,,386,,,,,,,,386,386,,386", "386,386,386,386,386,386,,,386,,,,,386,386,386,386,,,,,,,,,,,,,386,386", ",386,386,386,386,386,386,386,386,386,386,386,,,386,386,6,6,6,6,6,6,6", "6,,386,6,6,6,6,6,,,6,6,6,6,6,6,6,,,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6", "6,6,6,6,6,6,6,,6,,,,,,,,6,6,,6,6,6,6,6,6,6,,,6,,,,,6,6,6,6,,,,,,,,,", ",,,6,6,,6,6,6,6,6,6,6,6,6,6,6,,,6,6,7,7,7,7,7,7,7,7,,6,7,7,7,7,7,,,7", "7,7,7,7,7,7,,,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,,,7,,,,", ",,,7,7,,7,7,7,7,7,7,7,,,7,,,,,7,7,7,7,,,,,,,,,,,,,7,7,,7,7,7,7,7,7,7", "7,7,7,7,,,7,7,79,79,79,79,79,79,79,79,,7,79,79,79,79,79,,,79,79,79,79", "79,79,79,,,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79", "79,79,79,79,79,79,79,79,,,,,,,79,79,,79,79,79,79,79,79,79,,,79,,,,,79", "79,79,79,,,,,,,,,,,,,79,79,,79,79,79,79,79,79,79,79,79,79,79,,,79,65", "65,65,65,65,65,65,65,,,65,65,65,65,65,,,65,65,65,65,65,65,65,,,65,65", "65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65", "65,65,,,,,,,65,65,,65,65,65,65,65,65,65,,,65,,,,,65,65,65,65,,,,,,65", ",,,,,,65,65,,65,65,65,65,65,65,65,65,65,65,65,,,65,688,688,688,688,688", "688,688,688,,,688,688,688,688,688,,,688,688,688,688,688,688,688,,,688", "688,688,688,688,688,688,688,688,688,688,688,688,688,688,688,688,688", "688,688,688,688,688,,,688,,,,,,,,688,688,,688,688,688,688,688,688,688", ",,688,,,,,688,688,688,688,,,,,,,,,,,,,688,688,,688,688,688,688,688,688", "688,688,688,688,688,,,688,185,185,185,185,185,185,185,185,,,185,185", "185,185,185,,,185,185,185,185,185,185,185,,,185,185,185,185,185,185", "185,185,185,185,185,185,185,185,185,185,185,185,185,185,185,185,185", "185,185,185,185,,,,,,,185,185,,185,185,185,185,185,185,185,,,185,,,", ",185,185,185,185,,,,,,,,,,,,,185,185,,185,185,185,185,185,185,185,185", "185,185,185,852,852,185,,852,,,,,,,,852,852,,852,852,852,852,852,852", "852,,,852,,,,,852,852,852,852,,,,,,852,,,,,,,852,852,,852,852,852,852", "852,852,852,852,852,852,852,256,256,852,,256,,,,,,,,256,256,,256,256", "256,256,256,256,256,,,256,,,,,256,256,256,256,,,,,,,,,,,,,256,256,,256", "256,256,256,256,256,256,256,256,256,256,257,257,256,,257,,,,,,,,257", "257,,257,257,257,257,257,257,257,,,257,,,,,257,257,257,257,,,,,,,,,", ",,,257,257,,257,257,257,257,257,257,257,257,257,257,257,745,745,257", ",745,,,,,,,,745,745,,745,745,745,745,745,745,745,,,745,,,,,745,745,745", "745,,,,,,,,,,,,,745,745,,745,745,745,745,745,745,745,745,745,745,745", "497,497,745,,497,,,,,,,,497,497,,497,497,497,497,497,497,497,,,497,", ",,,497,497,497,497,,,,,,,,,,,,,497,497,,497,497,497,497,497,497,497", "497,497,497,497,496,496,497,,496,,,,,,,,496,496,,496,496,496,496,496", "496,496,,,496,,,,,496,496,496,496,,,,,,496,,,,,,,496,496,,496,496,496", "496,496,496,496,496,496,496,496,853,853,496,,853,,,,,,,,853,853,,853", "853,853,853,853,853,853,,,853,,,,,853,853,853,853,,,,,,,,,,,,,853,853", ",853,853,853,853,853,853,853,853,853,853,853,488,488,853,,488,,,,,,", ",488,488,,488,488,488,488,488,488,488,,,488,,,,,488,488,488,488,,,,", ",,,,,,,,488,488,,488,488,488,488,488,488,488,488,488,488,488,487,487", "488,,487,,,,,,,,487,487,,487,487,487,487,487,487,487,,,487,,,,,487,487", "487,487,,,,,,487,,,,,,,487,487,,487,487,487,487,487,487,487,487,487", "487,487,670,670,487,,670,,,,,,,,670,670,,670,670,670,670,670,670,670", ",,670,,,,,670,670,670,670,,,,,,,,,,,,,670,670,,670,670,670,670,670,670", "670,670,670,670,670,614,614,670,,614,,,,,,,,614,614,,614,614,614,614", "614,614,614,,,614,,,,,614,614,614,614,,,,,,,,,,,,,614,614,,614,614,614", "614,614,614,614,614,614,614,614,195,195,614,,195,,,,,,,,195,195,,195", "195,195,195,195,195,195,,,195,,,,,195,195,195,195,,,,,,,,,,,,,195,195", ",195,195,195,195,195,195,195,195,195,195,195,194,194,195,,194,,,,,,", ",194,194,,194,194,194,194,194,194,194,,,194,,,,,194,194,194,194,,,,", ",194,,,,,,,194,194,,194,194,194,194,194,194,194,194,194,194,194,672", "672,194,,672,,,,,,,,672,672,,672,672,672,672,672,672,672,,,672,,,,,672", "672,672,672,,,,,,672,,,,,,,672,672,,672,672,672,672,672,672,672,672", "672,672,672,417,417,672,,417,,,,,,,,417,417,,417,417,417,417,417,417", "417,,,417,,,,,417,417,417,417,,,,,,417,,,,,,,417,417,,417,417,417,417", "417,417,417,417,417,417,417,418,418,417,,418,,,,,,,,418,418,,418,418", "418,418,418,418,418,,,418,,,,,418,418,418,418,,,,,,,,,,,,,418,418,,418", "418,418,418,418,418,418,418,418,418,418,613,613,418,,613,,,,,,,,613", "613,,613,613,613,613,613,613,613,,,613,,,,,613,613,613,613,,,,,,,,,", ",,,613,613,,613,613,613,613,613,613,613,613,613,613,613,,,613"];

      racc_action_check = arr = (($b = (($d = __opal.Object._scope.Array) == null ? __opal.cm("Array") : $d)).$new || $mm('new')).call($b, 21587, nil);

      idx = 0;

      ($d = (($e = clist).$each || $mm('each')), $d._p = (TMP_3 = function(str) {

        var self = TMP_3._s || this, TMP_4, $a, $b, $c;
        if (str == null) str = nil;

        return ($a = (($b = (($c = str).$split || $mm('split')).call($c, ",", -1)).$each || $mm('each')), $a._p = (TMP_4 = function(i) {

          var self = TMP_4._s || this, $a, $b, $c, $d;
          if (i == null) i = nil;

          if (($a = (($b = i)['$empty?'] || $mm('empty?')).call($b)) === false || $a === nil) {
            (($a = arr)['$[]='] || $mm('[]=')).call($a, idx, (($c = i).$to_i || $mm('to_i')).call($c))
          };
          return idx = (($d = idx)['$+'] || $mm('+')).call($d, 1);
        }, TMP_4._s = self, TMP_4), $a).call($b)
      }, TMP_3._s = Grammar, TMP_3), $d).call($e);

      racc_action_pointer = [-2, 1193, nil, 498, nil, 870, 19926, 20036, 1063, 1046, 1021, 1020, 1066, 708, -70, 610, nil, 1736, 1858, 1114, 1096, nil, 2230, 2358, 2486, 554, 104, 2854, 2982, nil, 3108, 3230, 3352, nil, 989, 161, 1056, 597, 3962, 4084, 4206, 979, 458, nil, nil, nil, nil, nil, nil, nil, 4568, nil, 4701, 4823, 4951, -13, 2916, 5323, 5445, nil, nil, 5567, 1559, 996, nil, 20255, nil, nil, nil, nil, nil, -41, nil, nil, nil, nil, nil, 911, 909, 20146, nil, nil, nil, 6549, nil, nil, 6677, nil, nil, nil, nil, nil, nil, nil, nil, nil, 22, nil, 6927, nil, nil, nil, 7049, 7171, 7293, 7415, 7537, nil, 407, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, 20473, 903, nil, 8037, 8159, 8281, 8403, 8525, 8647, 21240, 21181, 9012, 9134, 9256, nil, 421, 96, 936, 176, 847, 894, 10110, 10232, nil, nil, 10354, 879, 10598, 10720, 10842, 10964, 11086, 11208, 11330, 11452, 11574, 11696, 11818, 11940, 12062, 12184, 12306, 12428, 12550, 12672, 12794, 12916, 13038, 13160, 13282, 13404, 13526, 13648, nil, nil, nil, 992, nil, 838, 835, nil, 14136, 869, 14380, nil, nil, nil, nil, 14502, nil, nil, 20591, 20650, 855, 14990, 15118, nil, nil, nil, nil, nil, nil, nil, 15246, 818, 15496, 790, 779, 741, 15984, 16106, 748, 870, 812, 952, 771, 735, -1, nil, 769, 558, nil, nil, 332, 769, 763, 1114, nil, 762, nil, 17944, nil, 18066, 34, nil, 639, 389, 608, 522, 499, nil, 585, nil, nil, 393, 2849, nil, nil, 385, 369, 355, nil, nil, 262, nil, nil, nil, nil, nil, nil, nil, 212, nil, nil, 166, 737, 62, -7, 18920, 18676, 617, 342, 385, 512, nil, 17572, nil, 17206, 148, 583, 584, 462, 182, 251, 333, 629, nil, 711, nil, nil, 16228, nil, 278, nil, 248, nil, -24, 911, 170, nil, 983, -51, nil, 370, nil, nil, nil, nil, nil, nil, 1788, nil, nil, nil, nil, nil, nil, 19706, nil, nil, nil, 19816, 1030, 1083, nil, nil, 370, nil, 13770, 997, nil, 867, nil, nil, 748, 753, 329, 159, 9740, nil, nil, nil, 9373, 701, 8885, nil, 8775, 7909, nil, 870, nil, nil, 21358, 21417, 7781, 75, 6427, 6305, 5939, 185, nil, 4084, 4328, 613, 311, 183, 777, 806, 833, 4823, 4694, 4519, 4206, 3962, 2736, 3108, 3226, 2614, 3474, 3596, 3718, 3840, 1677, 1299, 3352, 4450, 1358, 170, nil, 120, nil, nil, 370, nil, 248, nil, nil, 19526, nil, nil, 19580, -47, nil, 1053, 1016, 370, 985, 1073, nil, nil, 498, -5, 157, 995, nil, 992, 952, nil, nil, nil, 929, 620, 21004, 20945, 1074, 929, nil, nil, 748, 992, 1114, 20827, 20768, 1486, 1236, 1001, 971, 870, nil, 1358, nil, nil, 1980, nil, 2614, nil, nil, nil, nil, 2736, 3474, 650, nil, 2053, nil, 245, nil, nil, 510, 3596, nil, nil, 3718, 146, nil, nil, 4450, 39, -19, 50, 28, 5079, nil, nil, -2, 109, nil, 373, nil, 33, 9866, nil, 3243, nil, nil, nil, 3, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, 120, nil, nil, nil, 1048, nil, nil, nil, nil, nil, 9988, 1073, 14014, 254, 14624, 14746, 1026, nil, nil, nil, 14868, 959, nil, 15618, -44, 112, 16346, 16591, 717, 248, nil, 16718, nil, 2386, nil, 16840, 635, nil, 631, 16962, nil, 595, nil, nil, nil, nil, nil, 17084, nil, 540, 470, 21476, 21122, 17694, 620, 284, nil, nil, 186, 18188, 18310, nil, 3, nil, 942, 659, 409, 14, 451, 1236, 101, 2230, 161, 175, 28, 239, 19164, nil, nil, 400, nil, 174, 327, nil, 219, 232, nil, nil, 245, nil, 246, 1361, 352, 465, nil, 416, nil, nil, nil, nil, nil, 440, nil, 451, 19286, 19042, 1196, nil, 21063, 19408, 21299, nil, nil, 18798, -50, -25, 18554, 18432, 2303, 455, 637, 649, 650, nil, 655, nil, 20364, 706, 784, 17822, nil, nil, nil, 2108, 707, 17450, 17328, nil, 1980, nil, 1858, nil, nil, 1736, nil, 1614, 16473, 15862, 15740, 140, 1236, nil, 774, 877, nil, nil, 785, nil, nil, 808, 809, 620, 878, 15374, nil, 818, 921, 671, nil, 941, nil, 14258, 830, 872, nil, nil, nil, nil, nil, 566, nil, nil, nil, 20709, nil, 952, nil, nil, 953, 13892, 10476, nil, nil, 86, 95, 498, nil, 900, 897, 9622, 205, nil, nil, 988, 991, 879, nil, 2514, nil, 494, nil, nil, 9500, nil, nil, nil, nil, nil, nil, nil, 909, 894, nil, 498, 7659, nil, nil, nil, 943, 907, nil, nil, nil, 6805, nil, nil, 71, 6183, nil, 913, 962, nil, 6061, nil, 1061, 1062, 5817, 5695, nil, nil, 1070, nil, 5201, nil, nil, 994, 1074, 959, 960, 956, nil, nil, 2948, nil, nil, nil, 4328, nil, 3840, 623, 655, 1058, 248, nil, nil, 70, nil, nil, 62, 2108, nil, 1121, nil, 50, nil, nil, nil, 1614, 1133, 1486, 20532, 20886, 992, 870, nil, nil, nil, 1146, nil, 1032, 1150, nil, 1069, 77, 63, 78, 1393, 715, nil, nil, nil, 1409, nil];

      racc_action_default = [-496, -498, -1, -485, -4, -5, -498, -498, -498, -498, -498, -498, -498, -498, -252, -31, -32, -498, -498, -37, -39, -40, -263, -302, -303, -44, -230, -230, -230, -56, -496, -60, -65, -66, -498, -427, -498, -498, -498, -498, -498, -487, -211, -245, -246, -247, -248, -249, -250, -251, -475, -254, -498, -496, -496, -271, -496, -498, -498, -276, -279, -485, -498, -288, -294, -498, -304, -305, -372, -373, -374, -375, -376, -496, -379, -496, -496, -496, -496, -496, -406, -412, -413, -416, -417, -418, -419, -420, -421, -422, -423, -424, -425, -426, -429, -430, -498, -3, -486, -492, -493, -494, -498, -498, -498, -498, -498, -7, -498, -90, -91, -92, -93, -94, -95, -96, -99, -100, -101, -102, -103, -104, -105, -106, -107, -108, -109, -110, -111, -112, -113, -114, -115, -116, -117, -118, -119, -120, -121, -122, -123, -124, -125, -126, -127, -128, -129, -130, -131, -132, -133, -134, -135, -136, -137, -138, -139, -140, -141, -142, -143, -144, -145, -146, -147, -148, -149, -150, -151, -152, -153, -154, -155, -156, -157, -158, -159, -160, -161, -162, -163, -164, -165, -166, -167, -498, -12, -97, -496, -496, -498, -498, -498, -496, -498, -498, -498, -498, -498, -35, -498, -427, -498, -252, -498, -498, -496, -498, -36, -203, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -498, -343, -345, -41, -212, -223, -497, -497, -227, -498, -238, -498, -263, -302, -303, -469, -498, -42, -43, -498, -498, -48, -496, -498, -270, -348, -355, -357, -54, -353, -55, -498, -56, -496, -498, -498, -61, -63, -496, -70, -498, -498, -77, -266, -487, -498, -306, -354, -498, -64, -68, -259, -414, -415, -498, -188, -189, -204, -498, -488, -496, -487, -213, -489, -489, -498, -489, -498, -466, -489, -272, -273, -498, -498, -317, -318, -463, -463, -463, -335, -336, -449, -445, -446, -447, -448, -450, -455, -456, -458, -459, -460, -498, -38, -498, -498, -498, -498, -485, -498, -486, -498, -326, -498, -291, -498, -90, -91, -127, -128, -144, -149, -156, -159, -297, -498, -427, -464, -498, -377, -498, -392, -498, -394, -498, -498, -498, -384, -498, -498, -390, -498, -405, -407, -408, -409, -410, 875, -6, -495, -13, -14, -15, -16, -17, -498, -9, -10, -11, -498, -498, -498, -20, -28, -168, -238, -498, -498, -21, -29, -30, -22, -170, -498, -476, -477, -230, -350, -478, -479, -476, -230, -477, -352, -481, -482, -27, -177, -33, -34, -498, -498, -496, -259, -498, -498, -498, -498, -269, -178, -179, -180, -181, -182, -183, -184, -185, -190, -191, -192, -193, -194, -195, -196, -197, -198, -199, -200, -201, -202, -205, -206, -207, -208, -498, -496, -224, -498, -237, -225, -498, -235, -498, -239, -472, -230, -476, -477, -230, -496, -49, -498, -487, -487, -497, -223, -231, -232, -498, -496, -496, -498, -265, -498, -57, -257, -69, -62, -498, -496, -498, -498, -76, -498, -414, -415, -498, -498, -498, -498, -498, -209, -498, -364, -498, -498, -214, -491, -490, -216, -491, -261, -491, -468, -262, -467, -314, -496, -496, -498, -316, -330, -331, -498, -333, -334, -498, -498, -457, -461, -496, -307, -308, -309, -496, -498, -498, -498, -498, -496, -359, -285, -86, -498, -88, -498, -252, -498, -498, -295, -444, -299, -483, -484, -487, -378, -393, -396, -397, -399, -380, -395, -381, -382, -383, -498, -386, -388, -389, -498, -411, -8, -98, -18, -19, -498, -244, -498, -260, -498, -498, -50, -221, -222, -349, -498, -52, -351, -498, -476, -477, -476, -477, -498, -168, -268, -498, -339, -498, -341, -496, -497, -236, -240, -498, -470, -498, -471, -45, -346, -46, -347, -496, -217, -498, -498, -498, -498, -498, -37, -498, -229, -233, -498, -496, -496, -264, -57, -67, -498, -476, -477, -496, -480, -75, -498, -176, -186, -187, -498, -496, -496, -255, -256, -489, -240, -498, -498, -315, -463, -463, -451, -462, -463, -337, -498, -338, -498, -496, -310, -496, -277, -311, -312, -313, -280, -498, -283, -498, -498, -498, -86, -87, -498, -496, -498, -289, -431, -498, -498, -498, -496, -496, -444, -498, -463, -463, -463, -443, -449, -453, -498, -498, -498, -496, -385, -387, -391, -169, -242, -498, -498, -24, -172, -25, -173, -51, -26, -174, -53, -175, -498, -498, -498, -260, -210, -340, -498, -498, -226, -241, -498, -218, -219, -496, -496, -487, -498, -498, -234, -498, -498, -71, -267, -496, -324, -496, -365, -496, -366, -367, -215, -319, -320, -498, -328, -329, -332, -498, -259, -498, -321, -322, -498, -496, -496, -282, -284, -498, -498, -86, -89, -480, -498, -496, -498, -433, -292, -498, -498, -487, -435, -498, -439, -498, -441, -442, -498, -300, -465, -398, -401, -402, -403, -404, -498, -243, -23, -171, -498, -342, -344, -47, -498, -497, -356, -358, -2, -496, -371, -325, -498, -498, -369, -463, -258, -274, -498, -275, -498, -498, -498, -496, -286, -260, -498, -432, -496, -296, -298, -498, -463, -463, -463, -498, -454, -452, -444, -400, -220, -228, -498, -370, -496, -78, -498, -498, -85, -368, -327, -498, -278, -281, -496, -496, -290, -498, -434, -498, -437, -438, -440, -496, -364, -496, -498, -498, -84, -496, -360, -361, -362, -498, -293, -463, -498, -363, -498, -476, -477, -480, -83, -496, -287, -436, -301, -79, -323];

      clist = ["26,302,301,306,283,283,456,338,208,501,316,637,295,535,470,2,316,26", "26,351,112,112,26,26,26,97,467,101,331,332,26,648,335,370,390,397,269", "527,531,311,242,242,242,115,115,272,286,258,265,267,403,408,26,503,506", "679,510,26,26,512,682,26,107,187,669,35,271,262,266,599,651,822,599", "377,378,379,380,658,662,112,240,254,255,336,747,101,602,308,606,731", "618,608,473,112,553,35,276,276,26,544,563,546,26,26,26,26,26,597,375", "750,352,548,462,465,10,297,381,333,359,361,751,609,368,334,752,667,243", "243,243,199,353,621,622,841,340,761,602,545,814,370,342,400,301,678", "10,822,547,688,824,309,513,620,804,354,646,273,673,382,303,186,452,476", "477,35,298,856,666,735,798,330,330,35,356,330,357,304,363,562,98,366", "389,395,398,777,690,691,413,767,26,26,26,26,26,682,758,818,26,26,26", "112,307,794,1,387,388,,26,26,,412,14,663,10,,330,330,330,330,,,10,272", ",,,,,,,,599,,,,,,,,,,14,279,279,,,,,283,,,,,490,35,35,,,,,26,26,,,,316", ",,,26,502,26,35,,403,408,26,269,472,242,,,269,648,,,272,242,,484,,272", "651,857,516,394,394,,26,874,693,,810,10,10,532,533,480,,14,415,416,485", ",283,,283,14,469,474,424,10,,,262,,266,478,,,,,,849,26,26,35,,682,,276", "35,,,629,,,703,606,608,,,706,629,,,26,,534,,101,716,863,35,471,243,", ",590,301,,723,,243,,,,,,,,,,,,10,,,,,10,765,766,,,738,,112,,14,14,112", ",,598,,353,,353,,,,10,,,,,14,,,115,,,,115,578,,,,,583,,,412,,626,301", ",,568,,611,612,569,599,580,330,330,,,584,,,,641,,,,,,,,809,,,,,,551", ",721,722,,,812,,26,,,,,14,,736,605,279,14,607,,519,521,522,,,,,,647", "283,650,26,,685,412,580,830,,580,14,,,,412,,,26,26,,858,,,,,689,,,684", "843,26,629,643,644,26,,,,,26,,,,714,,655,855,,26,657,,,316,543,665,543", "827,,,659,659,,,,862,,,598,12,699,701,674,,,,704,,,,26,26,,35,35,,26", ",,,,298,,353,,,35,,,12,35,26,,,,35,,,,,,,,26,,636,715,,,26,,,,760,301", "26,26,,718,,,,10,10,,,,724,685,,727,728,756,,,10,775,,,10,762,,,,10", ",,,,,,677,684,,,,35,12,,,,26,,,580,12,,584,35,26,,,26,26,,,,,412,,35", "35,784,,,26,,,790,,,,26,,763,764,112,,,768,782,,629,,,10,,,,,,,,801", ",,,10,14,14,,,,,,,,26,543,10,10,14,817,,,14,394,35,35,,14,819,797,820", ",26,26,12,12,,35,,,412,,26,580,580,,,806,807,,,755,12,283,,,837,,,685", "330,659,,,,,,813,330,,,,,10,10,,26,,,35,864,301,,684,,26,10,,14,,26", "829,,,,26,,35,35,,14,,742,743,861,840,744,35,,,791,26,14,14,,,12,,,", ",12,26,,,,850,,10,,26,,,,,,26,859,770,772,773,35,,12,,831,10,10,412", ",,869,,,,35,10,,,,35,,,,,,,,,14,14,,,,,,35,,,,,781,14,,,,,35,,,10,,", ",835,35,,330,,,,35,,,10,,,,,10,,,,,,,,,,,,,,,14,10,,,,,,13,,,,,10,,", ",,,14,14,10,,,,200,200,10,,14,200,200,200,,836,,,,13,277,277,,,,,,,", ",,,846,847,848,,,,,,,200,,,14,,200,200,834,,200,,,,,,,,14,,,,,14,,,", ",,,,,,,,871,,,,14,,,,,,,,13,,,14,200,200,200,200,13,,,14,,,,,,14,,,", ",,,,,,,,,,12,12,,,,,,,,,,,,12,,,,12,,,,,12,,,,,,,,,,,,,,,,,,,,,,,,,", ",,,,,,,,,,,13,13,200,200,200,,,,200,200,200,,,,,,,,13,200,,,,,12,,,", ",,,,,,,,12,,,,,,,,,,,,12,12,,,,299,305,,312,,,,,,,,,,,,,,,200,200,358", ",360,360,364,367,360,200,,13,,,,277,13,,,,,,,,,,,,,,,,,,12,12,,,13,", ",,,,,,,12,,,,,,,,,,,,,,,,,,,,,,,,,,,200,200,,,,,,542,,542,,,,,,12,,", ",,,,200,,,,,,,,,,,12,12,,,,,,,,,12,,,,,299,,,,,,,,,,,,,,,,,,,,,,,,,", ",,,12,,,,,,,,,,,,,,12,,,,,12,,,,,,,,,,,,,,,,12,,468,,,,,,,,,12,,,,,", ",,12,,,,,,12,,,,,200,,,,392,396,,,,,,,,,,,,,,,,,,,200,,,,,,,,,,,,,209", ",13,13,241,241,241,,,,,,653,,,13,,,,13,292,293,294,458,13,460,,,,,461", ",,200,,241,241,,,,,,,,,,,,,,,,,,,,,,,,,,,,200,200,,,,,200,,,,,,,,,579", ",,,,,13,,,,,,,,,,299,,13,,,,,,200,,,,,,13,13,,,,,,,,,,,,,,,,,,594,,", ",,,,,,,579,,,579,594,,,,,,,,,,594,594,,200,,,,,,,299,200,,,13,13,,,573", ",391,241,399,241,,,414,13,,,,,,,200,,,,,,209,,426,427,428,429,430,431", "432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447,448", "449,450,451,,13,,,,,,,241,,241,600,,,603,241,604,,,13,13,241,241,,,", ",,,13,241,,617,,,,,,,,,,,,,,,,,,,,,,,,,498,,,,600,,13,603,,642,832,", ",,,200,,,,,13,,,,,13,,,579,,,,,,,,732,737,,,,13,,,,,,,,,,,13,,732,,732", ",,,13,,,,,,13,,,,299,,,,696,,,,,,,,,,,,,,,,,,,,,,,,241,,,717,,,,,,,", ",,,,,,600,,,,,579,579,,,241,,414,591,399,,796,,,,800,,,,734,,,,,,,,", ",,,,,,,,,,,,241,,,241,,241,,392,,,,,,,,,,,,,,616,,,,,,,,,,,241,,,,,", "783,633,634,635,,,,,,,,,241,,,241,,241,,,,,,,,,,,392,,,,,,,,,,,,,,732", ",,,,,,,,,,299,,,,,,,,,,,,,,,,,,732,,,,,,823,,,695,,241,,700,702,,,,", "705,,,707,,,,,,,,712,,,,,,,,241,,642,,,,,,,,,,,,241,,,,,,,,642,,,,,", ",,,,,,,,,241,,,,,,,,,,,,,,,,,,,,,,,,,,,,241,,,,,241,,,,,,,,,,,,,,,,", ",,,,,,,,,241,785,,,,,,,,,,700,702,705,,,,,,,,,,,,,,,241,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,241,,,,,,,,,,,,785,,,,,,,,,,,,,", ",,,,,,,,241,,,,,,,,,,,,,,,,,,,,241,,,,,,,,,,,,,,,,,,,,,,,241"];

      racc_goto_table = arr = (($d = (($f = __opal.Object._scope.Array) == null ? __opal.cm("Array") : $f)).$new || $mm('new')).call($d, 2296, nil);

      idx = 0;

      ($f = (($g = clist).$each || $mm('each')), $f._p = (TMP_5 = function(str) {

        var self = TMP_5._s || this, TMP_6, $a, $b, $c;
        if (str == null) str = nil;

        return ($a = (($b = (($c = str).$split || $mm('split')).call($c, ",", -1)).$each || $mm('each')), $a._p = (TMP_6 = function(i) {

          var self = TMP_6._s || this, $a, $b, $c, $d;
          if (i == null) i = nil;

          if (($a = (($b = i)['$empty?'] || $mm('empty?')).call($b)) === false || $a === nil) {
            (($a = arr)['$[]='] || $mm('[]=')).call($a, idx, (($c = i).$to_i || $mm('to_i')).call($c))
          };
          return idx = (($d = idx)['$+'] || $mm('+')).call($d, 1);
        }, TMP_6._s = self, TMP_6), $a).call($b)
      }, TMP_5._s = Grammar, TMP_5), $f).call($g);

      clist = ["35,20,52,52,49,49,55,76,16,3,106,4,48,75,30,2,106,35,35,44,45,45,35", "35,35,8,33,78,14,14,35,133,14,44,22,22,36,72,72,100,27,27,27,47,47,2", "40,32,32,32,31,31,35,51,51,79,51,35,35,51,102,35,12,12,42,41,37,53,53", "56,107,134,56,14,14,14,14,74,74,45,29,29,29,8,73,78,137,71,54,5,56,54", "58,45,125,41,41,41,35,43,125,43,35,35,35,35,35,34,10,5,80,81,31,31,15", "82,10,83,122,122,84,34,122,85,86,87,50,50,50,24,41,34,34,88,89,90,137", "91,92,44,93,20,52,94,15,134,95,96,97,98,99,57,101,67,103,39,77,25,50", "13,109,111,112,41,24,113,114,115,116,24,24,41,120,24,121,68,123,124", "11,126,16,16,16,127,128,129,16,131,35,35,35,35,35,102,42,132,35,35,35", "45,69,6,1,2,2,,35,35,,45,21,75,15,,24,24,24,24,,,15,2,,,,,,,,,56,,,", ",,,,,,21,21,21,,,,,49,,,,,48,41,41,,,,,35,35,,,,106,,,,35,48,35,41,", "31,31,35,36,27,27,,,36,133,,,2,27,,40,,2,107,5,100,50,50,,35,73,125", ",74,15,15,14,14,37,,21,24,24,37,,49,,49,21,29,29,24,15,,,53,,53,29,", ",,,,79,35,35,41,,102,,41,41,,,31,,,33,54,54,,,33,31,,,35,,8,,78,55,4", "41,50,50,,,20,52,,30,,50,,,,,,,,,,,,15,,,,,15,3,3,,,51,,45,,21,21,45", ",,52,,41,,41,,,,15,,,,,21,,,47,,,,47,32,,,,,32,,,45,,20,52,,,12,,48", "48,12,56,53,24,24,,,53,,,,52,,,,,,,,72,,,,,,24,,31,31,,,3,,35,,,,,21", ",22,32,21,21,32,,105,105,105,,,,,,104,49,104,35,,106,45,53,72,,53,21", ",,,45,,,35,35,,75,,,,,48,,,104,3,35,31,2,2,35,,,,,35,,,,76,,2,72,,35", "2,,,106,21,2,21,55,,,78,78,,,,3,,,52,18,16,16,78,,,,16,,,,35,35,,41", "41,,35,,,,,24,,41,,,41,,,18,41,35,,,,41,,,,,,,,35,,24,2,,,35,,,,20,52", "35,35,,2,,,,15,15,,,,27,106,,2,2,14,,,15,44,,,15,14,,,,15,,,,,,,24,104", ",,,41,18,,,,35,,,53,18,,53,41,35,,,35,35,,,,,45,,41,41,16,,,35,,,48", ",,,35,,78,78,45,,,78,2,,31,,,15,,,,,,,,104,,,,15,21,21,,,,,,,,35,21", "15,15,21,48,,,21,50,41,41,,21,104,2,104,,35,35,18,18,,41,,,45,,35,53", "53,,,2,2,,,50,18,49,,,14,,,106,24,78,,,,,,78,24,,,,,15,15,,35,,,41,20", "52,,104,,35,15,,21,,35,2,,,,35,,41,41,,21,,105,105,104,2,105,41,,,50", "35,21,21,,,18,,,,,18,35,,,,2,,15,,35,,,,,,35,2,105,105,105,41,,18,,41", "15,15,45,,,2,,,,41,15,,,,41,,,,,,,,,21,21,,,,,,41,,,,,21,21,,,,,41,", ",15,,,,15,41,,24,,,,41,,,15,,,,,15,,,,,,,,,,,,,,,21,15,,,,,,19,,,,,15", ",,,,,21,21,15,,,,19,19,15,,21,19,19,19,,105,,,,19,19,19,,,,,,,,,,,105", "105,105,,,,,,,19,,,21,,19,19,21,,19,,,,,,,,21,,,,,21,,,,,,,,,,,,105", ",,,21,,,,,,,,19,,,21,19,19,19,19,19,,,21,,,,,,21,,,,,,,,,,,,,,18,18", ",,,,,,,,,,,18,,,,18,,,,,18,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,19,19", "19,19,19,,,,19,19,19,,,,,,,,19,19,,,,,18,,,,,,,,,,,,18,,,,,,,,,,,,18", "18,,,,9,9,,9,,,,,,,,,,,,,,,19,19,9,,9,9,9,9,9,19,,19,,,,19,19,,,,,,", ",,,,,,,,,,,18,18,,,19,,,,,,,,,18,,,,,,,,,,,,,,,,,,,,,,,,,,,19,19,,,", ",,19,,19,,,,,,18,,,,,,,19,,,,,,,,,,,18,18,,,,,,,,,18,,,,,9,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,18,,,,,,,,,,,,,,18,,,,,18,,,,,,,,,,,,,,,,18,,9,,", ",,,,,,18,,,,,,,,18,,,,,,18,,,,,19,,,,23,23,,,,,,,,,,,,,,,,,,,19,,,,", ",,,,,,,,26,,19,19,26,26,26,,,,,,19,,,19,,,,19,26,26,26,23,19,23,,,,", "23,,,19,,26,26,,,,,,,,,,,,,,,,,,,,,,,,,,,,19,19,,,,,19,,,,,,,,,9,,,", ",,19,,,,,,,,,,9,,19,,,,,,19,,,,,,19,19,,,,,,,,,,,,,,,,,,9,,,,,,,,,,9", ",,9,9,,,,,,,,,,9,9,,19,,,,,,,9,19,,,19,19,,,23,,26,26,26,26,,,26,19", ",,,,,,19,,,,,,26,,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26", "26,26,26,26,26,26,26,26,26,,19,,,,,,,26,,26,23,,,23,26,23,,,19,19,26", "26,,,,,,,19,26,,23,,,,,,,,,,,,,,,,,,,,,,,,,26,,,,23,,19,23,,23,19,,", ",,19,,,,,19,,,,,19,,,9,,,,,,,,9,9,,,,19,,,,,,,,,,,19,,9,,9,,,,19,,,", ",,19,,,,9,,,,23,,,,,,,,,,,,,,,,,,,,,,,,26,,,23,,,,,,,,,,,,,,23,,,,,9", "9,,,26,,26,26,26,,9,,,,9,,,,23,,,,,,,,,,,,,,,,,,,,,26,,,26,,26,,23,", ",,,,,,,,,,,,26,,,,,,,,,,,26,,,,,,23,26,26,26,,,,,,,,,26,,,26,,26,,,", ",,,,,,,23,,,,,,,,,,,,,,9,,,,,,,,,,,9,,,,,,,,,,,,,,,,,,9,,,,,,23,,,26", ",26,,26,26,,,,,26,,,26,,,,,,,,26,,,,,,,,26,,23,,,,,,,,,,,,26,,,,,,,", "23,,,,,,,,,,,,,,,26,,,,,,,,,,,,,,,,,,,,,,,,,,,,26,,,,,26,,,,,,,,,,,", ",,,,,,,,,,,,,,26,26,,,,,,,,,,26,26,26,,,,,,,,,,,,,,,26,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,26,,,,,,,,,,,,26,,,,,,,,,,,,,,,,", ",,,,,26,,,,,,,,,,,,,,,,,,,,26,,,,,,,,,,,,,,,,,,,,,,,26"];

      racc_goto_check = arr = (($f = (($h = __opal.Object._scope.Array) == null ? __opal.cm("Array") : $h)).$new || $mm('new')).call($f, 2296, nil);

      idx = 0;

      ($h = (($i = clist).$each || $mm('each')), $h._p = (TMP_7 = function(str) {

        var self = TMP_7._s || this, TMP_8, $a, $b, $c;
        if (str == null) str = nil;

        return ($a = (($b = (($c = str).$split || $mm('split')).call($c, ",", -1)).$each || $mm('each')), $a._p = (TMP_8 = function(i) {

          var self = TMP_8._s || this, $a, $b, $c, $d;
          if (i == null) i = nil;

          if (($a = (($b = i)['$empty?'] || $mm('empty?')).call($b)) === false || $a === nil) {
            (($a = arr)['$[]='] || $mm('[]=')).call($a, idx, (($c = i).$to_i || $mm('to_i')).call($c))
          };
          return idx = (($d = idx)['$+'] || $mm('+')).call($d, 1);
        }, TMP_8._s = self, TMP_8), $a).call($b)
      }, TMP_7._s = Grammar, TMP_7), $h).call($i);

      racc_goto_pointer = [nil, 202, 15, -288, -489, -548, -530, nil, 22, 1138, 10, 175, 56, 152, -29, 114, -10, nil, 565, 950, -52, 210, -156, 1239, 112, 50, 1444, 18, nil, 58, -245, -144, 21, -232, -345, 0, 6, 36, nil, 124, 14, 65, -476, -241, -46, 14, nil, 37, -29, -27, 104, -247, -51, 41, -374, -238, -385, -324, -168, nil, nil, nil, nil, nil, nil, nil, nil, 88, 121, 145, nil, 31, -294, -571, -455, -323, -55, -388, 24, -492, 45, -241, 64, 58, -538, 63, -538, -413, -677, 71, -538, -204, -626, 76, -403, -205, -401, -627, 93, -159, -17, -597, -487, -364, -22, 175, -46, -450, nil, -78, nil, -102, -102, -675, -371, -471, -567, nil, nil, nil, 101, 101, 43, 99, -186, -263, 101, -507, -371, -371, nil, -493, -574, -487, -700, nil, nil, -371];

      racc_goto_default = [nil, nil, 500, nil, nil, 748, nil, 3, nil, 4, 5, 337, nil, nil, nil, 204, 16, 11, 205, 291, nil, 203, nil, 247, 15, nil, 19, 20, 21, nil, 25, 632, nil, nil, nil, 282, 29, nil, 31, 34, 33, 201, 541, nil, 114, 406, 113, 69, nil, 42, 300, nil, 244, 404, 581, 453, 245, nil, nil, 260, 455, 43, 44, 45, 46, 47, 48, 49, nil, 261, 55, nil, nil, nil, nil, nil, nil, nil, 528, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, 339, nil, 313, 314, 315, nil, 649, 317, 239, nil, 410, nil, nil, nil, nil, nil, nil, 68, 70, 71, 72, nil, nil, nil, nil, 558, nil, nil, nil, nil, 369, 681, 683, 323, 687, 326, 329, 252];

      racc_reduce_table = [0, 0, "racc_error", 1, 138, "_reduce_1", 4, 140, "_reduce_2", 2, 139, "_reduce_3", 1, 144, "_reduce_4", 1, 144, "_reduce_5", 3, 144, "_reduce_6", 0, 162, "_reduce_7", 4, 147, "_reduce_8", 3, 147, "_reduce_9", 3, 147, "_reduce_none", 3, 147, "_reduce_11", 2, 147, "_reduce_12", 3, 147, "_reduce_13", 3, 147, "_reduce_14", 3, 147, "_reduce_15", 3, 147, "_reduce_16", 3, 147, "_reduce_none", 4, 147, "_reduce_none", 4, 147, "_reduce_none", 3, 147, "_reduce_20", 3, 147, "_reduce_21", 3, 147, "_reduce_22", 6, 147, "_reduce_none", 5, 147, "_reduce_24", 5, 147, "_reduce_none", 5, 147, "_reduce_none", 3, 147, "_reduce_none", 3, 147, "_reduce_28", 3, 147, "_reduce_29", 3, 147, "_reduce_30", 1, 147, "_reduce_none", 1, 161, "_reduce_none", 3, 161, "_reduce_33", 3, 161, "_reduce_34", 2, 161, "_reduce_35", 2, 161, "_reduce_36", 1, 161, "_reduce_none", 1, 151, "_reduce_none", 1, 153, "_reduce_none", 1, 153, "_reduce_none", 2, 153, "_reduce_41", 2, 153, "_reduce_42", 2, 153, "_reduce_43", 1, 165, "_reduce_none", 4, 165, "_reduce_none", 4, 165, "_reduce_none", 4, 170, "_reduce_none", 2, 164, "_reduce_48", 3, 164, "_reduce_none", 4, 164, "_reduce_50", 5, 164, "_reduce_none", 4, 164, "_reduce_52", 5, 164, "_reduce_none", 2, 164, "_reduce_54", 2, 164, "_reduce_55", 1, 154, "_reduce_56", 3, 154, "_reduce_57", 1, 174, "_reduce_58", 3, 174, "_reduce_59", 1, 173, "_reduce_60", 2, 173, "_reduce_61", 3, 173, "_reduce_62", 2, 173, "_reduce_63", 2, 173, "_reduce_64", 1, 173, "_reduce_65", 1, 176, "_reduce_66", 3, 176, "_reduce_67", 2, 175, "_reduce_68", 3, 175, "_reduce_69", 1, 177, "_reduce_70", 4, 177, "_reduce_none", 3, 177, "_reduce_none", 3, 177, "_reduce_none", 3, 177, "_reduce_none", 3, 177, "_reduce_none", 2, 177, "_reduce_none", 1, 177, "_reduce_none", 1, 152, "_reduce_78", 4, 152, "_reduce_79", 3, 152, "_reduce_80", 3, 152, "_reduce_81", 3, 152, "_reduce_82", 3, 152, "_reduce_none", 2, 152, "_reduce_none", 1, 152, "_reduce_none", 1, 179, "_reduce_none", 2, 180, "_reduce_87", 1, 180, "_reduce_88", 3, 180, "_reduce_89", 1, 181, "_reduce_none", 1, 181, "_reduce_none", 1, 181, "_reduce_none", 1, 181, "_reduce_93", 1, 181, "_reduce_94", 1, 149, "_reduce_95", 1, 149, "_reduce_96", 1, 150, "_reduce_97", 3, 150, "_reduce_98", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 182, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 1, 183, "_reduce_none", 3, 163, "_reduce_168", 5, 163, "_reduce_none", 3, 163, "_reduce_170", 6, 163, "_reduce_171", 5, 163, "_reduce_172", 5, 163, "_reduce_none", 5, 163, "_reduce_none", 5, 163, "_reduce_none", 4, 163, "_reduce_none", 3, 163, "_reduce_none", 3, 163, "_reduce_178", 3, 163, "_reduce_179", 3, 163, "_reduce_180", 3, 163, "_reduce_181", 3, 163, "_reduce_182", 3, 163, "_reduce_183", 3, 163, "_reduce_184", 3, 163, "_reduce_185", 4, 163, "_reduce_none", 4, 163, "_reduce_none", 2, 163, "_reduce_188", 2, 163, "_reduce_189", 3, 163, "_reduce_190", 3, 163, "_reduce_191", 3, 163, "_reduce_192", 3, 163, "_reduce_193", 3, 163, "_reduce_194", 3, 163, "_reduce_195", 3, 163, "_reduce_196", 3, 163, "_reduce_197", 3, 163, "_reduce_198", 3, 163, "_reduce_199", 3, 163, "_reduce_200", 3, 163, "_reduce_201", 3, 163, "_reduce_202", 2, 163, "_reduce_203", 2, 163, "_reduce_204", 3, 163, "_reduce_205", 3, 163, "_reduce_206", 3, 163, "_reduce_207", 3, 163, "_reduce_208", 3, 163, "_reduce_209", 5, 163, "_reduce_210", 1, 163, "_reduce_none", 1, 160, "_reduce_none", 1, 157, "_reduce_213", 2, 157, "_reduce_214", 4, 157, "_reduce_215", 2, 157, "_reduce_216", 3, 190, "_reduce_217", 4, 190, "_reduce_218", 4, 190, "_reduce_none", 6, 190, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 166, "_reduce_223", 2, 166, "_reduce_224", 2, 166, "_reduce_225", 4, 166, "_reduce_226", 1, 166, "_reduce_227", 4, 194, "_reduce_none", 1, 194, "_reduce_none", 0, 196, "_reduce_230", 2, 169, "_reduce_231", 1, 195, "_reduce_none", 2, 195, "_reduce_233", 3, 195, "_reduce_234", 2, 193, "_reduce_235", 2, 192, "_reduce_236", 1, 192, "_reduce_237", 1, 187, "_reduce_238", 2, 187, "_reduce_239", 3, 187, "_reduce_240", 4, 187, "_reduce_241", 3, 159, "_reduce_242", 4, 159, "_reduce_none", 2, 159, "_reduce_244", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 0, 219, "_reduce_254", 4, 186, "_reduce_255", 4, 186, "_reduce_256", 3, 186, "_reduce_257", 3, 186, "_reduce_258", 2, 186, "_reduce_259", 4, 186, "_reduce_260", 3, 186, "_reduce_261", 3, 186, "_reduce_262", 1, 186, "_reduce_263", 4, 186, "_reduce_264", 3, 186, "_reduce_265", 1, 186, "_reduce_266", 5, 186, "_reduce_267", 4, 186, "_reduce_268", 3, 186, "_reduce_269", 2, 186, "_reduce_270", 1, 186, "_reduce_none", 2, 186, "_reduce_272", 2, 186, "_reduce_273", 6, 186, "_reduce_274", 6, 186, "_reduce_275", 0, 220, "_reduce_276", 0, 221, "_reduce_277", 7, 186, "_reduce_278", 0, 222, "_reduce_279", 0, 223, "_reduce_280", 7, 186, "_reduce_281", 5, 186, "_reduce_282", 4, 186, "_reduce_283", 5, 186, "_reduce_284", 0, 224, "_reduce_285", 0, 225, "_reduce_286", 9, 186, "_reduce_none", 0, 226, "_reduce_288", 0, 227, "_reduce_289", 7, 186, "_reduce_290", 0, 228, "_reduce_291", 0, 229, "_reduce_292", 8, 186, "_reduce_293", 0, 230, "_reduce_294", 0, 231, "_reduce_295", 6, 186, "_reduce_296", 0, 232, "_reduce_297", 6, 186, "_reduce_298", 0, 233, "_reduce_299", 0, 234, "_reduce_300", 9, 186, "_reduce_301", 1, 186, "_reduce_302", 1, 186, "_reduce_303", 1, 186, "_reduce_304", 1, 186, "_reduce_none", 1, 156, "_reduce_none", 1, 209, "_reduce_none", 1, 209, "_reduce_none", 1, 209, "_reduce_none", 2, 209, "_reduce_none", 1, 211, "_reduce_none", 1, 211, "_reduce_none", 1, 211, "_reduce_none", 2, 208, "_reduce_314", 3, 235, "_reduce_315", 2, 235, "_reduce_316", 1, 235, "_reduce_none", 1, 235, "_reduce_none", 3, 236, "_reduce_319", 3, 236, "_reduce_320", 1, 210, "_reduce_321", 0, 238, "_reduce_322", 6, 210, "_reduce_323", 1, 142, "_reduce_none", 2, 142, "_reduce_325", 1, 213, "_reduce_326", 6, 237, "_reduce_327", 4, 237, "_reduce_328", 4, 237, "_reduce_329", 2, 237, "_reduce_330", 2, 237, "_reduce_331", 4, 237, "_reduce_332", 2, 237, "_reduce_333", 2, 237, "_reduce_334", 1, 237, "_reduce_335", 1, 240, "_reduce_336", 3, 240, "_reduce_337", 3, 244, "_reduce_338", 1, 171, "_reduce_none", 2, 171, "_reduce_340", 1, 171, "_reduce_341", 3, 171, "_reduce_342", 0, 246, "_reduce_343", 5, 245, "_reduce_344", 2, 167, "_reduce_345", 4, 167, "_reduce_none", 4, 167, "_reduce_none", 2, 207, "_reduce_348", 4, 207, "_reduce_349", 3, 207, "_reduce_350", 4, 207, "_reduce_351", 3, 207, "_reduce_352", 2, 207, "_reduce_353", 1, 207, "_reduce_354", 0, 248, "_reduce_355", 5, 206, "_reduce_356", 0, 249, "_reduce_357", 5, 206, "_reduce_358", 0, 251, "_reduce_359", 6, 212, "_reduce_360", 1, 250, "_reduce_361", 1, 250, "_reduce_none", 6, 141, "_reduce_363", 0, 141, "_reduce_364", 1, 252, "_reduce_365", 1, 252, "_reduce_none", 1, 252, "_reduce_none", 2, 253, "_reduce_368", 1, 253, "_reduce_369", 2, 143, "_reduce_370", 1, 143, "_reduce_none", 1, 198, "_reduce_372", 1, 198, "_reduce_373", 1, 198, "_reduce_none", 1, 199, "_reduce_375", 1, 256, "_reduce_none", 2, 256, "_reduce_none", 3, 257, "_reduce_378", 1, 257, "_reduce_379", 3, 200, "_reduce_380", 3, 201, "_reduce_381", 3, 202, "_reduce_382", 3, 202, "_reduce_383", 1, 260, "_reduce_384", 3, 260, "_reduce_385", 1, 261, "_reduce_386", 2, 261, "_reduce_387", 3, 203, "_reduce_388", 3, 203, "_reduce_389", 1, 263, "_reduce_390", 3, 263, "_reduce_391", 1, 258, "_reduce_392", 2, 258, "_reduce_393", 1, 259, "_reduce_394", 2, 259, "_reduce_395", 1, 262, "_reduce_396", 0, 265, "_reduce_397", 3, 262, "_reduce_398", 0, 266, "_reduce_399", 4, 262, "_reduce_400", 1, 264, "_reduce_401", 1, 264, "_reduce_402", 1, 264, "_reduce_403", 1, 264, "_reduce_none", 2, 184, "_reduce_405", 1, 184, "_reduce_none", 1, 267, "_reduce_none", 1, 267, "_reduce_none", 1, 267, "_reduce_none", 1, 267, "_reduce_none", 3, 255, "_reduce_411", 1, 254, "_reduce_none", 1, 254, "_reduce_none", 2, 254, "_reduce_none", 2, 254, "_reduce_none", 1, 178, "_reduce_416", 1, 178, "_reduce_417", 1, 178, "_reduce_418", 1, 178, "_reduce_419", 1, 178, "_reduce_420", 1, 178, "_reduce_421", 1, 178, "_reduce_422", 1, 178, "_reduce_423", 1, 178, "_reduce_424", 1, 178, "_reduce_425", 1, 178, "_reduce_426", 1, 204, "_reduce_427", 1, 155, "_reduce_428", 1, 158, "_reduce_429", 1, 158, "_reduce_none", 1, 214, "_reduce_431", 3, 214, "_reduce_432", 2, 214, "_reduce_433", 4, 216, "_reduce_434", 2, 216, "_reduce_435", 6, 268, "_reduce_436", 4, 268, "_reduce_437", 4, 268, "_reduce_438", 2, 268, "_reduce_439", 4, 268, "_reduce_440", 2, 268, "_reduce_441", 2, 268, "_reduce_442", 1, 268, "_reduce_443", 0, 268, "_reduce_444", 1, 270, "_reduce_445", 1, 270, "_reduce_446", 1, 270, "_reduce_447", 1, 270, "_reduce_448", 1, 270, "_reduce_449", 1, 239, "_reduce_450", 3, 239, "_reduce_451", 3, 271, "_reduce_452", 1, 269, "_reduce_453", 3, 269, "_reduce_454", 1, 272, "_reduce_none", 1, 272, "_reduce_none", 2, 241, "_reduce_457", 1, 241, "_reduce_458", 1, 273, "_reduce_none", 1, 273, "_reduce_none", 2, 243, "_reduce_461", 2, 242, "_reduce_462", 0, 242, "_reduce_463", 1, 217, "_reduce_464", 4, 217, "_reduce_465", 1, 205, "_reduce_466", 2, 205, "_reduce_467", 2, 205, "_reduce_468", 1, 189, "_reduce_469", 3, 189, "_reduce_470", 3, 274, "_reduce_471", 2, 274, "_reduce_472", 1, 172, "_reduce_none", 1, 172, "_reduce_none", 1, 172, "_reduce_none", 1, 168, "_reduce_none", 1, 168, "_reduce_none", 1, 168, "_reduce_none", 1, 168, "_reduce_none", 1, 247, "_reduce_none", 1, 247, "_reduce_none", 1, 247, "_reduce_none", 1, 218, "_reduce_none", 1, 218, "_reduce_none", 0, 145, "_reduce_none", 1, 145, "_reduce_none", 0, 185, "_reduce_none", 1, 185, "_reduce_none", 0, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 215, "_reduce_none", 1, 215, "_reduce_none", 1, 148, "_reduce_none", 2, 148, "_reduce_none", 0, 146, "_reduce_none", 0, 197, "_reduce_none"];

      racc_reduce_n = 498;

      racc_shift_n = 875;

      racc_token_table = __hash(false, 0, "error", 1, "CLASS", 2, "MODULE", 3, "DEF", 4, "UNDEF", 5, "BEGIN", 6, "RESCUE", 7, "ENSURE", 8, "END", 9, "IF", 10, "UNLESS", 11, "THEN", 12, "ELSIF", 13, "ELSE", 14, "CASE", 15, "WHEN", 16, "WHILE", 17, "UNTIL", 18, "FOR", 19, "BREAK", 20, "NEXT", 21, "REDO", 22, "RETRY", 23, "IN", 24, "DO", 25, "DO_COND", 26, "DO_BLOCK", 27, "RETURN", 28, "YIELD", 29, "SUPER", 30, "SELF", 31, "NIL", 32, "TRUE", 33, "FALSE", 34, "AND", 35, "OR", 36, "NOT", 37, "IF_MOD", 38, "UNLESS_MOD", 39, "WHILE_MOD", 40, "UNTIL_MOD", 41, "RESCUE_MOD", 42, "ALIAS", 43, "DEFINED", 44, "klBEGIN", 45, "klEND", 46, "LINE", 47, "FILE", 48, "IDENTIFIER", 49, "FID", 50, "GVAR", 51, "IVAR", 52, "CONSTANT", 53, "CVAR", 54, "NTH_REF", 55, "BACK_REF", 56, "STRING_CONTENT", 57, "INTEGER", 58, "FLOAT", 59, "REGEXP_END", 60, "+@", 61, "-@", 62, "-@NUM", 63, "**", 64, "<=>", 65, "==", 66, "===", 67, "!=", 68, ">=", 69, "<=", 70, "&&", 71, "||", 72, "=~", 73, "!~", 74, ".", 75, "..", 76, "...", 77, "[]", 78, "[]=", 79, "<<", 80, ">>", 81, "::", 82, "::@", 83, "OP_ASGN", 84, "=>", 85, "PAREN_BEG", 86, "(", 87, ")", 88, "tLPAREN_ARG", 89, "ARRAY_BEG", 90, "]", 91, "tLBRACE", 92, "tLBRACE_ARG", 93, "SPLAT", 94, "*", 95, "&@", 96, "&", 97, "~", 98, "%", 99, "/", 100, "+", 101, "-", 102, "<", 103, ">", 104, "|", 105, "!", 106, "^", 107, "LCURLY", 108, "}", 109, "BACK_REF2", 110, "SYMBOL_BEG", 111, "STRING_BEG", 112, "XSTRING_BEG", 113, "REGEXP_BEG", 114, "WORDS_BEG", 115, "AWORDS_BEG", 116, "STRING_DBEG", 117, "STRING_DVAR", 118, "STRING_END", 119, "STRING", 120, "SYMBOL", 121, "\\n", 122, "?", 123, ":", 124, ",", 125, "SPACE", 126, ";", 127, "LABEL", 128, "LAMBDA", 129, "LAMBEG", 130, "DO_LAMBDA", 131, "=", 132, "LOWEST", 133, "[@", 134, "[", 135, "{", 136);

      racc_nt_base = 137;

      racc_use_result_var = true;

      __scope.Racc_arg = [racc_action_table, racc_action_check, racc_action_default, racc_action_pointer, racc_goto_table, racc_goto_check, racc_goto_default, racc_goto_pointer, racc_nt_base, racc_reduce_table, racc_token_table, racc_shift_n, racc_reduce_n, racc_use_result_var];

      __scope.Racc_token_to_s_table = ["$end", "error", "CLASS", "MODULE", "DEF", "UNDEF", "BEGIN", "RESCUE", "ENSURE", "END", "IF", "UNLESS", "THEN", "ELSIF", "ELSE", "CASE", "WHEN", "WHILE", "UNTIL", "FOR", "BREAK", "NEXT", "REDO", "RETRY", "IN", "DO", "DO_COND", "DO_BLOCK", "RETURN", "YIELD", "SUPER", "SELF", "NIL", "TRUE", "FALSE", "AND", "OR", "NOT", "IF_MOD", "UNLESS_MOD", "WHILE_MOD", "UNTIL_MOD", "RESCUE_MOD", "ALIAS", "DEFINED", "klBEGIN", "klEND", "LINE", "FILE", "IDENTIFIER", "FID", "GVAR", "IVAR", "CONSTANT", "CVAR", "NTH_REF", "BACK_REF", "STRING_CONTENT", "INTEGER", "FLOAT", "REGEXP_END", "\"+@\"", "\"-@\"", "\"-@NUM\"", "\"**\"", "\"<=>\"", "\"==\"", "\"===\"", "\"!=\"", "\">=\"", "\"<=\"", "\"&&\"", "\"||\"", "\"=~\"", "\"!~\"", "\".\"", "\"..\"", "\"...\"", "\"[]\"", "\"[]=\"", "\"<<\"", "\">>\"", "\"::\"", "\"::@\"", "OP_ASGN", "\"=>\"", "PAREN_BEG", "\"(\"", "\")\"", "tLPAREN_ARG", "ARRAY_BEG", "\"]\"", "tLBRACE", "tLBRACE_ARG", "SPLAT", "\"*\"", "\"&@\"", "\"&\"", "\"~\"", "\"%\"", "\"/\"", "\"+\"", "\"-\"", "\"<\"", "\">\"", "\"|\"", "\"!\"", "\"^\"", "LCURLY", "\"}\"", "BACK_REF2", "SYMBOL_BEG", "STRING_BEG", "XSTRING_BEG", "REGEXP_BEG", "WORDS_BEG", "AWORDS_BEG", "STRING_DBEG", "STRING_DVAR", "STRING_END", "STRING", "SYMBOL", "\"\\\\n\"", "\"?\"", "\":\"", "\",\"", "SPACE", "\";\"", "LABEL", "LAMBDA", "LAMBEG", "DO_LAMBDA", "\"=\"", "LOWEST", "\"[@\"", "\"[\"", "\"{\"", "$start", "target", "compstmt", "bodystmt", "opt_rescue", "opt_else", "opt_ensure", "stmts", "opt_terms", "none", "stmt", "terms", "fitem", "undef_list", "expr_value", "lhs", "command_call", "mlhs", "var_lhs", "primary_value", "aref_args", "backref", "mrhs", "arg_value", "expr", "@1", "arg", "command", "block_command", "call_args", "block_call", "operation2", "command_args", "cmd_brace_block", "opt_block_var", "operation", "mlhs_basic", "mlhs_entry", "mlhs_head", "mlhs_item", "mlhs_node", "variable", "cname", "cpath", "fname", "op", "reswords", "symbol", "opt_nl", "primary", "args", "trailer", "assocs", "paren_args", "opt_paren_args", "opt_block_arg", "block_arg", "call_args2", "open_args", "@2", "none_block_pass", "literal", "strings", "xstring", "regexp", "words", "awords", "var_ref", "assoc_list", "brace_block", "method_call", "lambda", "then", "if_tail", "do", "case_body", "block_var", "superclass", "term", "f_arglist", "singleton", "dot_or_colon", "@3", "@4", "@5", "@6", "@7", "@8", "@9", "@10", "@11", "@12", "@13", "@14", "@15", "@16", "@17", "@18", "f_larglist", "lambda_body", "block_var_args", "@19", "f_arg", "f_block_optarg", "f_rest_arg", "opt_f_block_arg", "f_block_arg", "f_block_opt", "do_block", "@20", "operation3", "@21", "@22", "cases", "@23", "exc_list", "exc_var", "numeric", "dsym", "string", "string1", "string_contents", "xstring_contents", "word_list", "word", "string_content", "qword_list", "string_dvar", "@24", "@25", "sym", "f_args", "f_optarg", "f_norm_arg", "f_opt", "restarg_mark", "blkarg_mark", "assoc"];

      __scope.Racc_debug_parser = false;

      def.$_reduce_1 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_2 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_body || $mm('new_body')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 1), (($d = val)['$[]'] || $mm('[]')).call($d, 2), (($e = val)['$[]'] || $mm('[]')).call($e, 3));
        return result;
      };

      def.$_reduce_3 = function(val, _values, result) {
        var comp = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i;
        comp = (($a = this).$new_compstmt || $mm('new_compstmt')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        if (($c = ($d = (($d = comp !== false && comp !== nil) ? (($e = (($f = comp)['$[]'] || $mm('[]')).call($f, 0))['$=='] || $mm('==')).call($e, "begin") : $d), $d !== false && $d !== nil ? (($d = (($g = comp).$size || $mm('size')).call($g))['$=='] || $mm('==')).call($d, 2) : $d)) !== false && $c !== nil) {
          result = (($c = comp)['$[]'] || $mm('[]')).call($c, 1);
          (($h = result)['$line='] || $mm('line=')).call($h, (($i = comp).$line || $mm('line')).call($i));
          } else {
          result = comp
        };
        return result;
      };

      def.$_reduce_4 = function(val, _values, result) {
        var $a;
        result = (($a = this).$new_block || $mm('new_block')).call($a);
        return result;
      };

      def.$_reduce_5 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_block || $mm('new_block')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_6 = function(val, _values, result) {
        var $a, $b, $c, $d;
        (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        result = (($d = val)['$[]'] || $mm('[]')).call($d, 0);
        return result;
      };

      def.$_reduce_7 = function(val, _values, result) {
        
        this.lex_state = "expr_fname";
        return result;
      };

      def.$_reduce_8 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "alias", (($b = val)['$[]'] || $mm('[]')).call($b, 1), (($c = val)['$[]'] || $mm('[]')).call($c, 3));
        return result;
      };

      def.$_reduce_9 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "valias", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 1)).$intern || $mm('intern')).call($b), (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 2)).$intern || $mm('intern')).call($d));
        return result;
      };

      def.$_reduce_11 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "valias", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 1)).$intern || $mm('intern')).call($b), (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 2)).$intern || $mm('intern')).call($d));
        return result;
      };

      def.$_reduce_12 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_13 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_if || $mm('new_if')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 0), nil);
        return result;
      };

      def.$_reduce_14 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_if || $mm('new_if')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 2), nil, (($c = val)['$[]'] || $mm('[]')).call($c, 0));
        return result;
      };

      def.$_reduce_15 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "while", (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 0), true);
        return result;
      };

      def.$_reduce_16 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "until", (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 0), true);
        return result;
      };

      def.$_reduce_20 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_assign || $mm('new_assign')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_21 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$s || $mm('s')).call($a, "masgn", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = this).$s || $mm('s')).call($c, "to_ary", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_22 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_op_asgn || $mm('new_op_asgn')).call($a, (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 1)).$intern || $mm('intern')).call($b), (($d = val)['$[]'] || $mm('[]')).call($d, 0), (($e = val)['$[]'] || $mm('[]')).call($e, 2));
        return result;
      };

      def.$_reduce_24 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f, $g;
        result = (($a = this).$s || $mm('s')).call($a, "op_asgn2", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = ("" + ((($d = val)['$[]'] || $mm('[]')).call($d, 2)) + "=")).$intern || $mm('intern')).call($c), (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 3)).$intern || $mm('intern')).call($e), (($g = val)['$[]'] || $mm('[]')).call($g, 4));
        return result;
      };

      def.$_reduce_28 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_assign || $mm('new_assign')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = this).$s || $mm('s')).call($c, "svalue", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_29 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$s || $mm('s')).call($a, "masgn", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = this).$s || $mm('s')).call($c, "to_ary", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_30 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "masgn", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_33 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).call($a, "and", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 0)).$line || $mm('line')).call($e));
        return result;
      };

      def.$_reduce_34 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).call($a, "or", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 0)).$line || $mm('line')).call($e));
        return result;
      };

      def.$_reduce_35 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "not", (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        (($c = result)['$line='] || $mm('line=')).call($c, (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 1)).$line || $mm('line')).call($d));
        return result;
      };

      def.$_reduce_36 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "not", (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_41 = function(val, _values, result) {
        var args = nil, $a, $b, $c, $d, $e;
        args = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        if ((($b = (($c = args).$size || $mm('size')).call($c))['$=='] || $mm('==')).call($b, 2)) {
          args = (($d = args)['$[]'] || $mm('[]')).call($d, 1)
        };
        result = (($e = this).$s || $mm('s')).call($e, "return", args);
        return result;
      };

      def.$_reduce_42 = function(val, _values, result) {
        var args = nil, $a, $b, $c, $d, $e;
        args = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        if ((($b = (($c = args).$size || $mm('size')).call($c))['$=='] || $mm('==')).call($b, 2)) {
          args = (($d = args)['$[]'] || $mm('[]')).call($d, 1)
        };
        result = (($e = this).$s || $mm('s')).call($e, "break", args);
        return result;
      };

      def.$_reduce_43 = function(val, _values, result) {
        var args = nil, $a, $b, $c, $d, $e;
        args = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        if ((($b = (($c = args).$size || $mm('size')).call($c))['$=='] || $mm('==')).call($b, 2)) {
          args = (($d = args)['$[]'] || $mm('[]')).call($d, 1)
        };
        result = (($e = this).$s || $mm('s')).call($e, "next", args);
        return result;
      };

      def.$_reduce_48 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, nil, (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b), (($d = val)['$[]'] || $mm('[]')).call($d, 1));
        return result;
      };

      def.$_reduce_50 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = (($d = val)['$[]'] || $mm('[]')).call($d, 2)).$intern || $mm('intern')).call($c), (($e = val)['$[]'] || $mm('[]')).call($e, 3));
        return result;
      };

      def.$_reduce_52 = function(val, _values, result) {
        
        result = "result = ['call', val[0], val[2], val[3]];";
        return result;
      };

      def.$_reduce_54 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_super || $mm('new_super')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_55 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_yield || $mm('new_yield')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_56 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_57 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_58 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_59 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_60 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_61 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_62 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = this).$s || $mm('s')).call($c, "splat", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_63 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = this).$s || $mm('s')).call($c, "splat"));
        return result;
      };

      def.$_reduce_64 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = this).$s || $mm('s')).call($b, "splat", (($c = val)['$[]'] || $mm('[]')).call($c, 1)));
        return result;
      };

      def.$_reduce_65 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = this).$s || $mm('s')).call($b, "splat"));
        return result;
      };

      def.$_reduce_66 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_67 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_68 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_69 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_70 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_assignable || $mm('new_assignable')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_78 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_assignable || $mm('new_assignable')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_79 = function(val, _values, result) {
        var args = nil, $a, $b, $c, $d, $e, $f;
        args = (($a = val)['$[]'] || $mm('[]')).call($a, 2);
        if ((($b = (($c = args)['$[]'] || $mm('[]')).call($c, 0))['$=='] || $mm('==')).call($b, "array")) {
          (($d = args)['$[]='] || $mm('[]=')).call($d, 0, "arglist")
        };
        result = (($e = this).$s || $mm('s')).call($e, "attrasgn", (($f = val)['$[]'] || $mm('[]')).call($f, 0), "[]=", args);
        return result;
      };

      def.$_reduce_80 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "attrasgn", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = ("" + ((($d = val)['$[]'] || $mm('[]')).call($d, 2)) + "=")).$intern || $mm('intern')).call($c), (($e = this).$s || $mm('s')).call($e, "arglist"));
        return result;
      };

      def.$_reduce_81 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "attrasgn", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = ("" + ((($d = val)['$[]'] || $mm('[]')).call($d, 2)) + "=")).$intern || $mm('intern')).call($c), (($e = this).$s || $mm('s')).call($e, "arglist"));
        return result;
      };

      def.$_reduce_82 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "attrasgn", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = ("" + ((($d = val)['$[]'] || $mm('[]')).call($d, 2)) + "=")).$intern || $mm('intern')).call($c), (($e = this).$s || $mm('s')).call($e, "arglist"));
        return result;
      };

      def.$_reduce_87 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "colon3", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 1)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_88 = function(val, _values, result) {
        var $a, $b;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0)).$intern || $mm('intern')).call($a);
        return result;
      };

      def.$_reduce_89 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$s || $mm('s')).call($a, "colon2", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = (($d = val)['$[]'] || $mm('[]')).call($d, 2)).$intern || $mm('intern')).call($c));
        return result;
      };

      def.$_reduce_93 = function(val, _values, result) {
        var $a;
        this.lex_state = "expr_end";
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_94 = function(val, _values, result) {
        var $a;
        this.lex_state = "expr_end";
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_95 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "lit", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_96 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "lit", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_97 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "undef", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_98 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_168 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_assign || $mm('new_assign')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_170 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_op_asgn || $mm('new_op_asgn')).call($a, (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 1)).$intern || $mm('intern')).call($b), (($d = val)['$[]'] || $mm('[]')).call($d, 0), (($e = val)['$[]'] || $mm('[]')).call($e, 2));
        return result;
      };

      def.$_reduce_171 = function(val, _values, result) {
        var args = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
        args = (($a = val)['$[]'] || $mm('[]')).call($a, 2);
        if ((($b = (($c = args)['$[]'] || $mm('[]')).call($c, 0))['$=='] || $mm('==')).call($b, "array")) {
          (($d = args)['$[]='] || $mm('[]=')).call($d, 0, "arglist")
        };
        result = (($e = this).$s || $mm('s')).call($e, "op_asgn1", (($f = val)['$[]'] || $mm('[]')).call($f, 0), (($g = val)['$[]'] || $mm('[]')).call($g, 2), (($h = (($i = val)['$[]'] || $mm('[]')).call($i, 4)).$intern || $mm('intern')).call($h), (($j = val)['$[]'] || $mm('[]')).call($j, 5));
        (($k = result)['$line='] || $mm('line=')).call($k, (($l = (($m = val)['$[]'] || $mm('[]')).call($m, 0)).$line || $mm('line')).call($l));
        return result;
      };

      def.$_reduce_172 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f, $g;
        result = (($a = this).$s || $mm('s')).call($a, "op_asgn2", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = ("" + ((($d = val)['$[]'] || $mm('[]')).call($d, 2)) + "=")).$intern || $mm('intern')).call($c), (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 3)).$intern || $mm('intern')).call($e), (($g = val)['$[]'] || $mm('[]')).call($g, 4));
        return result;
      };

      def.$_reduce_178 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).call($a, "dot2", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 0)).$line || $mm('line')).call($e));
        return result;
      };

      def.$_reduce_179 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).call($a, "dot3", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 0)).$line || $mm('line')).call($e));
        return result;
      };

      def.$_reduce_180 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "operator", "+", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_181 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "operator", "-", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_182 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "operator", "*", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_183 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "operator", "/", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_184 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "%", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_185 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "**", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_188 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1), "+@", (($c = this).$s || $mm('s')).call($c, "arglist"));
        if (($d = (($e = (($f = (($g = (($h = val)['$[]'] || $mm('[]')).call($h, 1))['$[]'] || $mm('[]')).call($g, 0))['$=='] || $mm('==')).call($f, "lit")) ? (($i = (($j = __scope.Numeric) == null ? __opal.cm("Numeric") : $j))['$==='] || $mm('===')).call($i, (($j = (($k = val)['$[]'] || $mm('[]')).call($k, 1))['$[]'] || $mm('[]')).call($j, 1)) : $e)) !== false && $d !== nil) {
          result = (($d = val)['$[]'] || $mm('[]')).call($d, 1)
        };
        return result;
      };

      def.$_reduce_189 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1), "-@", (($c = this).$s || $mm('s')).call($c, "arglist"));
        if (($d = (($e = (($f = (($g = (($h = val)['$[]'] || $mm('[]')).call($h, 1))['$[]'] || $mm('[]')).call($g, 0))['$=='] || $mm('==')).call($f, "lit")) ? (($i = (($j = __scope.Numeric) == null ? __opal.cm("Numeric") : $j))['$==='] || $mm('===')).call($i, (($j = (($k = val)['$[]'] || $mm('[]')).call($k, 1))['$[]'] || $mm('[]')).call($j, 1)) : $e)) !== false && $d !== nil) {
          (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 1))['$[]='] || $mm('[]=')).call($d, 1, (($l = (($m = (($n = val)['$[]'] || $mm('[]')).call($n, 1))['$[]'] || $mm('[]')).call($m, 1))['$-@'] || $mm('-@')).call($l));
          result = (($o = val)['$[]'] || $mm('[]')).call($o, 1);
        };
        return result;
      };

      def.$_reduce_190 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "|", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_191 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "^", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_192 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "&", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_193 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "<=>", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_194 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), ">", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_195 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), ">=", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_196 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "<", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_197 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "<=", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_198 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "==", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_199 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "===", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_200 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "not", (($b = this).$new_call || $mm('new_call')).call($b, (($c = val)['$[]'] || $mm('[]')).call($c, 0), "==", (($d = this).$s || $mm('s')).call($d, "arglist", (($e = val)['$[]'] || $mm('[]')).call($e, 2))));
        return result;
      };

      def.$_reduce_201 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "=~", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_202 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "not", (($b = this).$new_call || $mm('new_call')).call($b, (($c = val)['$[]'] || $mm('[]')).call($c, 0), "=~", (($d = this).$s || $mm('s')).call($d, "arglist", (($e = val)['$[]'] || $mm('[]')).call($e, 2))));
        return result;
      };

      def.$_reduce_203 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "not", (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_204 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1), "~", (($c = this).$s || $mm('s')).call($c, "arglist"));
        return result;
      };

      def.$_reduce_205 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "<<", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_206 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), ">>", (($c = this).$s || $mm('s')).call($c, "arglist", (($d = val)['$[]'] || $mm('[]')).call($d, 2)));
        return result;
      };

      def.$_reduce_207 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).call($a, "and", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 0)).$line || $mm('line')).call($e));
        return result;
      };

      def.$_reduce_208 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).call($a, "or", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 0)).$line || $mm('line')).call($e));
        return result;
      };

      def.$_reduce_209 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "defined", (($b = val)['$[]'] || $mm('[]')).call($b, 2));
        return result;
      };

      def.$_reduce_210 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f, $g;
        result = (($a = this).$s || $mm('s')).call($a, "if", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2), (($d = val)['$[]'] || $mm('[]')).call($d, 4));
        (($e = result)['$line='] || $mm('line=')).call($e, (($f = (($g = val)['$[]'] || $mm('[]')).call($g, 0)).$line || $mm('line')).call($f));
        return result;
      };

      def.$_reduce_213 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_214 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_215 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = this).$s || $mm('s')).apply($c, ["hash"].concat((($d = val)['$[]'] || $mm('[]')).call($d, 2))));
        result = (($e = val)['$[]'] || $mm('[]')).call($e, 0);
        return result;
      };

      def.$_reduce_216 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = this).$s || $mm('s')).apply($b, ["hash"].concat((($c = val)['$[]'] || $mm('[]')).call($c, 0))));
        return result;
      };

      def.$_reduce_217 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_218 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_223 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_224 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        (($b = this).$add_block_pass || $mm('add_block_pass')).call($b, (($c = val)['$[]'] || $mm('[]')).call($c, 0), (($d = val)['$[]'] || $mm('[]')).call($d, 1));
        return result;
      };

      def.$_reduce_225 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "arglist", (($b = this).$s || $mm('s')).apply($b, ["hash"].concat((($c = val)['$[]'] || $mm('[]')).call($c, 0))));
        (($d = this).$add_block_pass || $mm('add_block_pass')).call($d, result, (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        return result;
      };

      def.$_reduce_226 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        (($b = result)['$<<'] || $mm('<<')).call($b, (($c = this).$s || $mm('s')).apply($c, ["hash"].concat((($d = val)['$[]'] || $mm('[]')).call($d, 2))));
        return result;
      };

      def.$_reduce_227 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "arglist");
        (($b = this).$add_block_pass || $mm('add_block_pass')).call($b, result, (($c = val)['$[]'] || $mm('[]')).call($c, 0));
        return result;
      };

      def.$_reduce_230 = function(val, _values, result) {
        var $a;
        (($a = this).$cmdarg_push || $mm('cmdarg_push')).call($a, 1);
        return result;
      };

      def.$_reduce_231 = function(val, _values, result) {
        var $a, $b;
        (($a = this).$cmdarg_pop || $mm('cmdarg_pop')).call($a);
        result = (($b = val)['$[]'] || $mm('[]')).call($b, 1);
        return result;
      };

      def.$_reduce_233 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_234 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_235 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "block_pass", (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_236 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_237 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_238 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_239 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = this).$s || $mm('s')).call($b, "splat", (($c = val)['$[]'] || $mm('[]')).call($c, 1)));
        return result;
      };

      def.$_reduce_240 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_241 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = this).$s || $mm('s')).call($c, "splat", (($d = val)['$[]'] || $mm('[]')).call($d, 3)));
        return result;
      };

      def.$_reduce_242 = function(val, _values, result) {
        var $a, $b, $c, $d;
        (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        result = (($d = val)['$[]'] || $mm('[]')).call($d, 0);
        return result;
      };

      def.$_reduce_244 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "splat", (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_254 = function(val, _values, result) {
        
        result = this.line;
        return result;
      };

      def.$_reduce_255 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$s || $mm('s')).call($a, "begin", (($b = val)['$[]'] || $mm('[]')).call($b, 2));
        (($c = result)['$line='] || $mm('line=')).call($c, (($d = val)['$[]'] || $mm('[]')).call($d, 1));
        return result;
      };

      def.$_reduce_256 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_257 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 1)), $a !== false && $a !== nil ? $a : (($c = this).$s || $mm('s')).call($c, "nil"));
        return result;
      };

      def.$_reduce_258 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$s || $mm('s')).call($a, "colon2", (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = (($d = val)['$[]'] || $mm('[]')).call($d, 2)).$intern || $mm('intern')).call($c));
        return result;
      };

      def.$_reduce_259 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "colon3", (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_260 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "[]", (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_261 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 1)), $a !== false && $a !== nil ? $a : (($c = this).$s || $mm('s')).call($c, "array"));
        return result;
      };

      def.$_reduce_262 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).apply($a, ["hash"].concat((($b = val)['$[]'] || $mm('[]')).call($b, 1)));
        return result;
      };

      def.$_reduce_263 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "return");
        return result;
      };

      def.$_reduce_264 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_yield || $mm('new_yield')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 2));
        return result;
      };

      def.$_reduce_265 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "yield");
        return result;
      };

      def.$_reduce_266 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "yield");
        return result;
      };

      def.$_reduce_267 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "defined", (($b = val)['$[]'] || $mm('[]')).call($b, 3));
        return result;
      };

      def.$_reduce_268 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "not", (($b = val)['$[]'] || $mm('[]')).call($b, 2));
        (($c = result)['$line='] || $mm('line=')).call($c, (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 2)).$line || $mm('line')).call($d));
        return result;
      };

      def.$_reduce_269 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "not", (($b = this).$s || $mm('s')).call($b, "nil"));
        return result;
      };

      def.$_reduce_270 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        (($b = result)['$[]='] || $mm('[]=')).call($b, 1, (($c = this).$new_call || $mm('new_call')).call($c, nil, (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 0)).$intern || $mm('intern')).call($d), (($f = this).$s || $mm('s')).call($f, "arglist")));
        return result;
      };

      def.$_reduce_272 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        (($b = result)['$[]='] || $mm('[]=')).call($b, 1, (($c = val)['$[]'] || $mm('[]')).call($c, 0));
        return result;
      };

      def.$_reduce_273 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_274 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_if || $mm('new_if')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1), (($c = val)['$[]'] || $mm('[]')).call($c, 3), (($d = val)['$[]'] || $mm('[]')).call($d, 4));
        return result;
      };

      def.$_reduce_275 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_if || $mm('new_if')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1), (($c = val)['$[]'] || $mm('[]')).call($c, 4), (($d = val)['$[]'] || $mm('[]')).call($d, 3));
        return result;
      };

      def.$_reduce_276 = function(val, _values, result) {
        var $a;
        (($a = this).$cond_push || $mm('cond_push')).call($a, 1);
        result = this.line;
        return result;
      };

      def.$_reduce_277 = function(val, _values, result) {
        var $a;
        (($a = this).$cond_pop || $mm('cond_pop')).call($a);
        return result;
      };

      def.$_reduce_278 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "while", (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 5), true);
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        return result;
      };

      def.$_reduce_279 = function(val, _values, result) {
        var $a;
        (($a = this).$cond_push || $mm('cond_push')).call($a, 1);
        result = this.line;
        return result;
      };

      def.$_reduce_280 = function(val, _values, result) {
        var $a;
        (($a = this).$cond_pop || $mm('cond_pop')).call($a);
        return result;
      };

      def.$_reduce_281 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "until", (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 5), true);
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        return result;
      };

      def.$_reduce_282 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).apply($a, ["case", (($b = val)['$[]'] || $mm('[]')).call($b, 1)].concat((($c = val)['$[]'] || $mm('[]')).call($c, 3)));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 1)).$line || $mm('line')).call($e));
        return result;
      };

      def.$_reduce_283 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).apply($a, ["case", nil].concat((($b = val)['$[]'] || $mm('[]')).call($b, 2)));
        (($c = result)['$line='] || $mm('line=')).call($c, (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 2)).$line || $mm('line')).call($d));
        return result;
      };

      def.$_reduce_284 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$s || $mm('s')).call($a, "case", nil, (($b = val)['$[]'] || $mm('[]')).call($b, 3));
        (($c = result)['$line='] || $mm('line=')).call($c, (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 3)).$line || $mm('line')).call($d));
        return result;
      };

      def.$_reduce_285 = function(val, _values, result) {
        
        result = "this.cond_push(1);";
        return result;
      };

      def.$_reduce_286 = function(val, _values, result) {
        
        result = "this.cond_pop();";
        return result;
      };

      def.$_reduce_288 = function(val, _values, result) {
        
        result = this.line;
        return result;
      };

      def.$_reduce_289 = function(val, _values, result) {
        
        return result;
      };

      def.$_reduce_290 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f, $g;
        result = (($a = this).$new_class || $mm('new_class')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 3), (($d = val)['$[]'] || $mm('[]')).call($d, 5));
        (($e = result)['$line='] || $mm('line=')).call($e, (($f = val)['$[]'] || $mm('[]')).call($f, 1));
        (($g = result)['$end_line='] || $mm('end_line=')).call($g, this.line);
        return result;
      };

      def.$_reduce_291 = function(val, _values, result) {
        
        result = this.line;
        return result;
      };

      def.$_reduce_292 = function(val, _values, result) {
        
        return result;
      };

      def.$_reduce_293 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_sclass || $mm('new_sclass')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 3), (($c = val)['$[]'] || $mm('[]')).call($c, 6));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = val)['$[]'] || $mm('[]')).call($e, 2));
        return result;
      };

      def.$_reduce_294 = function(val, _values, result) {
        
        result = this.line;
        return result;
      };

      def.$_reduce_295 = function(val, _values, result) {
        
        return result;
      };

      def.$_reduce_296 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$new_module || $mm('new_module')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 4));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        (($f = result)['$end_line='] || $mm('end_line=')).call($f, this.line);
        return result;
      };

      def.$_reduce_297 = function(val, _values, result) {
        var $a;
        result = this.scope_line;
        (($a = this).$push_scope || $mm('push_scope')).call($a);
        return result;
      };

      def.$_reduce_298 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$new_defn || $mm('new_defn')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 1), (($d = val)['$[]'] || $mm('[]')).call($d, 3), (($e = val)['$[]'] || $mm('[]')).call($e, 4));
        (($f = this).$pop_scope || $mm('pop_scope')).call($f);
        return result;
      };

      def.$_reduce_299 = function(val, _values, result) {
        
        return result;
      };

      def.$_reduce_300 = function(val, _values, result) {
        var $a;
        result = this.scope_line;
        (($a = this).$push_scope || $mm('push_scope')).call($a);
        return result;
      };

      def.$_reduce_301 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f, $g;
        result = (($a = this).$new_defs || $mm('new_defs')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 5), (($c = val)['$[]'] || $mm('[]')).call($c, 1), (($d = val)['$[]'] || $mm('[]')).call($d, 4), (($e = val)['$[]'] || $mm('[]')).call($e, 6), (($f = val)['$[]'] || $mm('[]')).call($f, 7));
        (($g = this).$pop_scope || $mm('pop_scope')).call($g);
        return result;
      };

      def.$_reduce_302 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "break");
        return result;
      };

      def.$_reduce_303 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "next");
        return result;
      };

      def.$_reduce_304 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "redo");
        return result;
      };

      def.$_reduce_314 = function(val, _values, result) {
        var call = nil, $a, $b, $c, $d, $e;
        call = (($a = this).$new_call || $mm('new_call')).call($a, nil, "lambda", (($b = this).$s || $mm('s')).call($b, "arglist"));
        result = (($c = this).$new_iter || $mm('new_iter')).call($c, call, (($d = val)['$[]'] || $mm('[]')).call($d, 0), (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        return result;
      };

      def.$_reduce_315 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_316 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_319 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_320 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_321 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_322 = function(val, _values, result) {
        
        result = this.line;
        return result;
      };

      def.$_reduce_323 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$s || $mm('s')).call($a, "if", (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 4), (($d = val)['$[]'] || $mm('[]')).call($d, 5));
        (($e = result)['$line='] || $mm('line=')).call($e, (($f = val)['$[]'] || $mm('[]')).call($f, 1));
        return result;
      };

      def.$_reduce_325 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_326 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_327 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2), (($d = val)['$[]'] || $mm('[]')).call($d, 4), (($e = val)['$[]'] || $mm('[]')).call($e, 5));
        return result;
      };

      def.$_reduce_328 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2), nil, (($d = val)['$[]'] || $mm('[]')).call($d, 3));
        return result;
      };

      def.$_reduce_329 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), nil, (($c = val)['$[]'] || $mm('[]')).call($c, 2), (($d = val)['$[]'] || $mm('[]')).call($d, 3));
        return result;
      };

      def.$_reduce_330 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), nil, nil, nil);
        return result;
      };

      def.$_reduce_331 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), nil, nil, (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_332 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2), (($d = val)['$[]'] || $mm('[]')).call($d, 3));
        return result;
      };

      def.$_reduce_333 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0), nil, (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_334 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, nil, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_335 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_block_args || $mm('new_block_args')).call($a, nil, nil, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_336 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "block", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_337 = function(val, _values, result) {
        var $a, $b, $c, $d;
        (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        result = (($d = val)['$[]'] || $mm('[]')).call($d, 0);
        return result;
      };

      def.$_reduce_338 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$new_assign || $mm('new_assign')).call($a, (($b = this).$new_assignable || $mm('new_assignable')).call($b, (($c = this).$s || $mm('s')).call($c, "identifier", (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 0)).$intern || $mm('intern')).call($d))), (($f = val)['$[]'] || $mm('[]')).call($f, 2));
        return result;
      };

      def.$_reduce_340 = function(val, _values, result) {
        
        result = 0;
        return result;
      };

      def.$_reduce_341 = function(val, _values, result) {
        
        result = 0;
        return result;
      };

      def.$_reduce_342 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_343 = function(val, _values, result) {
        var $a;
        (($a = this).$push_scope || $mm('push_scope')).call($a, "block");
        result = this.line;
        return result;
      };

      def.$_reduce_344 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$new_iter || $mm('new_iter')).call($a, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 3));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        (($f = this).$pop_scope || $mm('pop_scope')).call($f);
        return result;
      };

      def.$_reduce_345 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        (($b = result)['$[]='] || $mm('[]=')).call($b, 1, (($c = val)['$[]'] || $mm('[]')).call($c, 0));
        return result;
      };

      def.$_reduce_348 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_call || $mm('new_call')).call($a, nil, (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b), (($d = val)['$[]'] || $mm('[]')).call($d, 1));
        return result;
      };

      def.$_reduce_349 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = (($d = val)['$[]'] || $mm('[]')).call($d, 2)).$intern || $mm('intern')).call($c), (($e = val)['$[]'] || $mm('[]')).call($e, 3));
        return result;
      };

      def.$_reduce_350 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), "call", (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_351 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = (($d = val)['$[]'] || $mm('[]')).call($d, 2)).$intern || $mm('intern')).call($c), (($e = val)['$[]'] || $mm('[]')).call($e, 3));
        return result;
      };

      def.$_reduce_352 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_call || $mm('new_call')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = (($d = val)['$[]'] || $mm('[]')).call($d, 2)).$intern || $mm('intern')).call($c), (($e = this).$s || $mm('s')).call($e, "arglist"));
        return result;
      };

      def.$_reduce_353 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_super || $mm('new_super')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_354 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "zsuper");
        return result;
      };

      def.$_reduce_355 = function(val, _values, result) {
        var $a;
        (($a = this).$push_scope || $mm('push_scope')).call($a, "block");
        result = this.line;
        return result;
      };

      def.$_reduce_356 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$new_iter || $mm('new_iter')).call($a, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 3));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        (($f = this).$pop_scope || $mm('pop_scope')).call($f);
        return result;
      };

      def.$_reduce_357 = function(val, _values, result) {
        var $a;
        (($a = this).$push_scope || $mm('push_scope')).call($a, "block");
        result = this.line;
        return result;
      };

      def.$_reduce_358 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$new_iter || $mm('new_iter')).call($a, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 3));
        (($d = result)['$line='] || $mm('line=')).call($d, (($e = val)['$[]'] || $mm('[]')).call($e, 1));
        (($f = this).$pop_scope || $mm('pop_scope')).call($f);
        return result;
      };

      def.$_reduce_359 = function(val, _values, result) {
        
        result = this.line;
        return result;
      };

      def.$_reduce_360 = function(val, _values, result) {
        var part = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i;
        part = (($a = this).$s || $mm('s')).call($a, "when", (($b = val)['$[]'] || $mm('[]')).call($b, 2), (($c = val)['$[]'] || $mm('[]')).call($c, 4));
        (($d = part)['$line='] || $mm('line=')).call($d, (($e = (($f = val)['$[]'] || $mm('[]')).call($f, 2)).$line || $mm('line')).call($e));
        result = [part];
        if (($g = (($h = val)['$[]'] || $mm('[]')).call($h, 5)) !== false && $g !== nil) {
          (($g = result).$push || $mm('push')).apply($g, [].concat((($i = val)['$[]'] || $mm('[]')).call($i, 5)))
        };
        return result;
      };

      def.$_reduce_361 = function(val, _values, result) {
        var $a;
        result = [(($a = val)['$[]'] || $mm('[]')).call($a, 0)];
        return result;
      };

      def.$_reduce_363 = function(val, _values, result) {
        var exc = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n;
        exc = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 1)), $a !== false && $a !== nil ? $a : (($c = this).$s || $mm('s')).call($c, "array"));
        if (($a = (($d = val)['$[]'] || $mm('[]')).call($d, 2)) !== false && $a !== nil) {
          (($a = exc)['$<<'] || $mm('<<')).call($a, (($e = this).$new_assign || $mm('new_assign')).call($e, (($f = val)['$[]'] || $mm('[]')).call($f, 2), (($g = this).$s || $mm('s')).call($g, "gvar", (($h = "$!").$intern || $mm('intern')).call($h))))
        };
        result = [(($i = this).$s || $mm('s')).call($i, "resbody", exc, (($j = val)['$[]'] || $mm('[]')).call($j, 4))];
        if (($k = (($l = val)['$[]'] || $mm('[]')).call($l, 5)) !== false && $k !== nil) {
          (($k = result).$push || $mm('push')).call($k, (($m = (($n = val)['$[]'] || $mm('[]')).call($n, 5)).$first || $mm('first')).call($m))
        };
        return result;
      };

      def.$_reduce_364 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_365 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "array", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_368 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_369 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_370 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (function() { if (($a = (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 1))['$nil?'] || $mm('nil?')).call($b)) !== false && $a !== nil) {
          return (($a = this).$s || $mm('s')).call($a, "nil")
          } else {
          return (($d = val)['$[]'] || $mm('[]')).call($d, 1)
        }; return nil; }).call(this);
        return result;
      };

      def.$_reduce_372 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "lit", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_373 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "lit", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_375 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_str || $mm('new_str')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_378 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_379 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "str", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_380 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_xstr || $mm('new_xstr')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_381 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_regexp || $mm('new_regexp')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1), (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_382 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "array");
        return result;
      };

      def.$_reduce_383 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_384 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "array");
        return result;
      };

      def.$_reduce_385 = function(val, _values, result) {
        var part = nil, $a, $b, $c, $d, $e, $f, $g;
        part = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        if ((($b = (($c = part)['$[]'] || $mm('[]')).call($c, 0))['$=='] || $mm('==')).call($b, "evstr")) {
          part = (($d = this).$s || $mm('s')).call($d, "dstr", "", (($e = val)['$[]'] || $mm('[]')).call($e, 1))
        };
        result = (($f = (($g = val)['$[]'] || $mm('[]')).call($g, 0))['$<<'] || $mm('<<')).call($f, part);
        return result;
      };

      def.$_reduce_386 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_387 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0)).$concat || $mm('concat')).call($a, [(($c = val)['$[]'] || $mm('[]')).call($c, 1)]);
        return result;
      };

      def.$_reduce_388 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "array");
        return result;
      };

      def.$_reduce_389 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_390 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "array");
        return result;
      };

      def.$_reduce_391 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = this).$s || $mm('s')).call($c, "str", (($d = val)['$[]'] || $mm('[]')).call($d, 1)));
        return result;
      };

      def.$_reduce_392 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_393 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$str_append || $mm('str_append')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_394 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_395 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$str_append || $mm('str_append')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_396 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "str", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_397 = function(val, _values, result) {
        
        result = this.string_parse;
        this.string_parse = nil;
        return result;
      };

      def.$_reduce_398 = function(val, _values, result) {
        var $a, $b, $c;
        this.string_parse = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        result = (($b = this).$s || $mm('s')).call($b, "evstr", (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        return result;
      };

      def.$_reduce_399 = function(val, _values, result) {
        var $a, $b;
        (($a = this).$cond_push || $mm('cond_push')).call($a, 0);
        (($b = this).$cmdarg_push || $mm('cmdarg_push')).call($b, 0);
        result = this.string_parse;
        this.string_parse = nil;
        this.lex_state = "expr_beg";
        return result;
      };

      def.$_reduce_400 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        this.string_parse = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        (($b = this).$cond_lexpop || $mm('cond_lexpop')).call($b);
        (($c = this).$cmdarg_lexpop || $mm('cmdarg_lexpop')).call($c);
        result = (($d = this).$s || $mm('s')).call($d, "evstr", (($e = val)['$[]'] || $mm('[]')).call($e, 2));
        return result;
      };

      def.$_reduce_401 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "gvar", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_402 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "ivar", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_403 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "cvar", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_405 = function(val, _values, result) {
        var $a, $b;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 1)).$intern || $mm('intern')).call($a);
        this.lex_state = "expr_end";
        return result;
      };

      def.$_reduce_411 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_dsym || $mm('new_dsym')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 1));
        return result;
      };

      def.$_reduce_416 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "identifier", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_417 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "ivar", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_418 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "gvar", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_419 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "const", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_420 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$s || $mm('s')).call($a, "cvar", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b));
        return result;
      };

      def.$_reduce_421 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "nil");
        return result;
      };

      def.$_reduce_422 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "self");
        return result;
      };

      def.$_reduce_423 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "true");
        return result;
      };

      def.$_reduce_424 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "false");
        return result;
      };

      def.$_reduce_425 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "str", this.file);
        return result;
      };

      def.$_reduce_426 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "lit", this.line);
        return result;
      };

      def.$_reduce_427 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_var_ref || $mm('new_var_ref')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_428 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_assignable || $mm('new_assignable')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_429 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "nth_ref", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_431 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_432 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_433 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_434 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_435 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_436 = function(val, _values, result) {
        var $a, $b, $c, $d, $e;
        result = (($a = this).$new_args || $mm('new_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2), (($d = val)['$[]'] || $mm('[]')).call($d, 4), (($e = val)['$[]'] || $mm('[]')).call($e, 5));
        return result;
      };

      def.$_reduce_437 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_args || $mm('new_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2), nil, (($d = val)['$[]'] || $mm('[]')).call($d, 3));
        return result;
      };

      def.$_reduce_438 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_args || $mm('new_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), nil, (($c = val)['$[]'] || $mm('[]')).call($c, 2), (($d = val)['$[]'] || $mm('[]')).call($d, 3));
        return result;
      };

      def.$_reduce_439 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_args || $mm('new_args')).call($a, (($b = val)['$[]'] || $mm('[]')).call($b, 0), nil, nil, (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_440 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = this).$new_args || $mm('new_args')).call($a, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 2), (($d = val)['$[]'] || $mm('[]')).call($d, 3));
        return result;
      };

      def.$_reduce_441 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_args || $mm('new_args')).call($a, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0), nil, (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_442 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = this).$new_args || $mm('new_args')).call($a, nil, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0), (($c = val)['$[]'] || $mm('[]')).call($c, 1));
        return result;
      };

      def.$_reduce_443 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$new_args || $mm('new_args')).call($a, nil, nil, nil, (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_444 = function(val, _values, result) {
        var $a;
        result = (($a = this).$s || $mm('s')).call($a, "args");
        return result;
      };

      def.$_reduce_445 = function(val, _values, result) {
        var $a;
        (($a = this).$raise || $mm('raise')).call($a, "formal argument cannot be a constant");
        return result;
      };

      def.$_reduce_446 = function(val, _values, result) {
        var $a;
        (($a = this).$raise || $mm('raise')).call($a, "formal argument cannot be an instance variable");
        return result;
      };

      def.$_reduce_447 = function(val, _values, result) {
        var $a;
        (($a = this).$raise || $mm('raise')).call($a, "formal argument cannot be a class variable");
        return result;
      };

      def.$_reduce_448 = function(val, _values, result) {
        var $a;
        (($a = this).$raise || $mm('raise')).call($a, "formal argument cannot be a global variable");
        return result;
      };

      def.$_reduce_449 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0)).$intern || $mm('intern')).call($a);
        (($c = this.scope).$add_local || $mm('add_local')).call($c, result);
        return result;
      };

      def.$_reduce_450 = function(val, _values, result) {
        var $a;
        result = [(($a = val)['$[]'] || $mm('[]')).call($a, 0)];
        return result;
      };

      def.$_reduce_451 = function(val, _values, result) {
        var $a, $b, $c, $d;
        (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0))['$<<'] || $mm('<<')).call($a, (($c = val)['$[]'] || $mm('[]')).call($c, 2));
        result = (($d = val)['$[]'] || $mm('[]')).call($d, 0);
        return result;
      };

      def.$_reduce_452 = function(val, _values, result) {
        var $a, $b, $c, $d, $e, $f;
        result = (($a = this).$new_assign || $mm('new_assign')).call($a, (($b = this).$new_assignable || $mm('new_assignable')).call($b, (($c = this).$s || $mm('s')).call($c, "identifier", (($d = (($e = val)['$[]'] || $mm('[]')).call($e, 0)).$intern || $mm('intern')).call($d))), (($f = val)['$[]'] || $mm('[]')).call($f, 2));
        return result;
      };

      def.$_reduce_453 = function(val, _values, result) {
        var $a, $b;
        result = (($a = this).$s || $mm('s')).call($a, "block", (($b = val)['$[]'] || $mm('[]')).call($b, 0));
        return result;
      };

      def.$_reduce_454 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0))['$<<'] || $mm('<<')).call($b, (($d = val)['$[]'] || $mm('[]')).call($d, 2));
        return result;
      };

      def.$_reduce_457 = function(val, _values, result) {
        var $a, $b;
        result = (($a = ("*" + ((($b = val)['$[]'] || $mm('[]')).call($b, 1)))).$intern || $mm('intern')).call($a);
        return result;
      };

      def.$_reduce_458 = function(val, _values, result) {
        
        result = "*";
        return result;
      };

      def.$_reduce_461 = function(val, _values, result) {
        var $a, $b;
        result = (($a = ("&" + ((($b = val)['$[]'] || $mm('[]')).call($b, 1)))).$intern || $mm('intern')).call($a);
        return result;
      };

      def.$_reduce_462 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_463 = function(val, _values, result) {
        
        result = nil;
        return result;
      };

      def.$_reduce_464 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_465 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 1);
        return result;
      };

      def.$_reduce_466 = function(val, _values, result) {
        
        result = [];
        return result;
      };

      def.$_reduce_467 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_468 = function(val, _values, result) {
        var $a;
        (($a = this).$raise || $mm('raise')).call($a, "unsupported assoc list type (" + (this.line_number) + ")");
        return result;
      };

      def.$_reduce_469 = function(val, _values, result) {
        var $a;
        result = (($a = val)['$[]'] || $mm('[]')).call($a, 0);
        return result;
      };

      def.$_reduce_470 = function(val, _values, result) {
        var $a, $b, $c;
        result = (($a = (($b = val)['$[]'] || $mm('[]')).call($b, 0)).$push || $mm('push')).apply($a, [].concat((($c = val)['$[]'] || $mm('[]')).call($c, 2)));
        return result;
      };

      def.$_reduce_471 = function(val, _values, result) {
        var $a, $b;
        result = [(($a = val)['$[]'] || $mm('[]')).call($a, 0), (($b = val)['$[]'] || $mm('[]')).call($b, 2)];
        return result;
      };

      def.$_reduce_472 = function(val, _values, result) {
        var $a, $b, $c, $d;
        result = [(($a = this).$s || $mm('s')).call($a, "lit", (($b = (($c = val)['$[]'] || $mm('[]')).call($c, 0)).$intern || $mm('intern')).call($b)), (($d = val)['$[]'] || $mm('[]')).call($d, 1)];
        return result;
      };

      def.$_reduce_none = function(val, _values, result) {
        var $a;
        return (($a = val)['$[]'] || $mm('[]')).call($a, 0);
      };

      return nil;
    })(Opal, (($a = ((($b = __scope.Racc) == null ? __opal.cm("Racc") : $b))._scope).Parser == null ? $a.cm("Parser") : $a.Parser))
    
  })(self);
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass, __hash2 = __opal.hash2;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope, $a, $b;

    (function(__base, __super){
      function Grammar() {};
      Grammar = __klass(__base, __super, "Grammar", Grammar);

      var def = Grammar.prototype, __scope = Grammar._scope;
      def.line = def.file = def.scopes = def.cond = def.cmdarg = def.string_parse = def.scanner = def.lex_state = def.start_of_lambda = nil;

      def.$line = function() {
        
        return this.line
      }, nil;

      def.$initialize = function() {
        
        this.lex_state = "expr_beg";
        this.cond = 0;
        this.cmdarg = 0;
        this.line = 1;
        this.scopes = [];
        return this.string_parse_stack = [];
      };

      def.$s = function(parts) {
        var sexp = nil, $a, $b;parts = __slice.call(arguments, 0);
        sexp = (($a = (($b = __scope.Array) == null ? __opal.cm("Array") : $b)).$new || $mm('new')).call($a, parts);
        (($b = sexp)['$line='] || $mm('line=')).call($b, this.line);
        return sexp;
      };

      def.$parse = function(source, file) {
        var result = nil, $a, $b, $c, $d;if (file == null) {
          file = "(string)"
        }
        this.file = file;
        this.scanner = (($a = (($b = __scope.StringScanner) == null ? __opal.cm("StringScanner") : $b)).$new || $mm('new')).call($a, source);
        (($b = this).$push_scope || $mm('push_scope')).call($b);
        result = (($c = this).$do_parse || $mm('do_parse')).call($c);
        (($d = this).$pop_scope || $mm('pop_scope')).call($d);
        return result;
      };

      def.$on_error = function(t, val, vstack) {
        var $a, $b, $c, $d;
        return (($a = this).$raise || $mm('raise')).call($a, "parse error on value " + ((($b = val).$inspect || $mm('inspect')).call($b)) + " (" + ((($c = (($d = this).$token_to_str || $mm('token_to_str')).call($d, t)), $c !== false && $c !== nil ? $c : "?")) + ") :" + (this.file) + ":" + (this.line));
      };

      def.$push_scope = function(type) {
        var top = nil, scope = nil, $a, $b, $c, $d;if (type == null) {
          type = nil
        }
        top = (($a = this.scopes).$last || $mm('last')).call($a);
        scope = (($b = (($c = __scope.LexerScope) == null ? __opal.cm("LexerScope") : $c)).$new || $mm('new')).call($b, type);
        (($c = scope)['$parent='] || $mm('parent=')).call($c, top);
        (($d = this.scopes)['$<<'] || $mm('<<')).call($d, scope);
        return this.scope = scope;
      };

      def.$pop_scope = function() {
        var $a, $b;
        (($a = this.scopes).$pop || $mm('pop')).call($a);
        return this.scope = (($b = this.scopes).$last || $mm('last')).call($b);
      };

      def.$cond_push = function(n) {
        var $a, $b, $c;
        return this.cond = (($a = (($b = this.cond)['$<<'] || $mm('<<')).call($b, 1))['$|'] || $mm('|')).call($a, (($c = n)['$&'] || $mm('&')).call($c, 1));
      };

      def.$cond_pop = function() {
        var $a;
        return this.cond = (($a = this.cond)['$>>'] || $mm('>>')).call($a, 1);
      };

      def.$cond_lexpop = function() {
        var $a, $b, $c;
        return this.cond = (($a = (($b = this.cond)['$>>'] || $mm('>>')).call($b, 1))['$|'] || $mm('|')).call($a, (($c = this.cond)['$&'] || $mm('&')).call($c, 1));
      };

      def['$cond?'] = function() {
        var $a, $b, $c;
        return ($a = (($b = (($c = this.cond)['$&'] || $mm('&')).call($c, 1))['$=='] || $mm('==')).call($b, 0), ($a === nil || $a === false));
      };

      def.$cmdarg_push = function(n) {
        var $a, $b, $c;
        return this.cmdarg = (($a = (($b = this.cmdarg)['$<<'] || $mm('<<')).call($b, 1))['$|'] || $mm('|')).call($a, (($c = n)['$&'] || $mm('&')).call($c, 1));
      };

      def.$cmdarg_pop = function() {
        var $a;
        return this.cmdarg = (($a = this.cmdarg)['$>>'] || $mm('>>')).call($a, 1);
      };

      def.$cmdarg_lexpop = function() {
        var $a, $b, $c;
        return this.cmdarg = (($a = (($b = this.cmdarg)['$>>'] || $mm('>>')).call($b, 1))['$|'] || $mm('|')).call($a, (($c = this.cmdarg)['$&'] || $mm('&')).call($c, 1));
      };

      def['$cmdarg?'] = function() {
        var $a, $b, $c;
        return ($a = (($b = (($c = this.cmdarg)['$&'] || $mm('&')).call($c, 1))['$=='] || $mm('==')).call($b, 0), ($a === nil || $a === false));
      };

      def.$next_string_token = function() {
        var str_parse = nil, scanner = nil, space = nil, interpolate = nil, words = nil, str_buffer = nil, result = nil, complete_str = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay, $az, $ba, $bb, $bc, $bd, $be, $bf, $bg, $bh;
        str_parse = this.string_parse;
        scanner = this.scanner;
        space = false;
        interpolate = (($a = str_parse)['$[]'] || $mm('[]')).call($a, "interpolate");
        words = (($b = ["w", "W"])['$include?'] || $mm('include?')).call($b, (($c = str_parse)['$[]'] || $mm('[]')).call($c, "beg"));
        if (($d = ($e = (($e = ["w", "W"])['$include?'] || $mm('include?')).call($e, (($f = str_parse)['$[]'] || $mm('[]')).call($f, "beg")), $e !== false && $e !== nil ? (($g = scanner).$scan || $mm('scan')).call($g, /\s+/) : $e)) !== false && $d !== nil) {
          space = true
        };
        str_buffer = [];
        if (($d = (($h = scanner).$scan || $mm('scan')).call($h, (($i = (($j = __scope.Regexp) == null ? __opal.cm("Regexp") : $j)).$new || $mm('new')).call($i, (($j = (($k = __scope.Regexp) == null ? __opal.cm("Regexp") : $k)).$escape || $mm('escape')).call($j, (($k = str_parse)['$[]'] || $mm('[]')).call($k, "end"))))) !== false && $d !== nil) {
          if (($d = (($l = words !== false && words !== nil) ? ($m = (($n = str_parse)['$[]'] || $mm('[]')).call($n, "done_last_space"), ($m === nil || $m === false)) : $l)) !== false && $d !== nil) {
            (($d = str_parse)['$[]='] || $mm('[]=')).call($d, "done_last_space", true);
            ($l = scanner, (($m = $l)['$pos='] || $mm('pos=')).call($m, (($o = (($p = $l).$pos || $mm('pos')).call($p))['$-'] || $mm('-')).call($o, 1)));
            return ["SPACE", " "];
          };
          this.string_parse = nil;
          if (($l = (($q = str_parse)['$[]'] || $mm('[]')).call($q, "balance")) !== false && $l !== nil) {
            if ((($l = (($r = str_parse)['$[]'] || $mm('[]')).call($r, "nesting"))['$=='] || $mm('==')).call($l, 0)) {
              this.lex_state = "expr_end";
              if (($s = (($t = str_parse)['$[]'] || $mm('[]')).call($t, "regexp")) !== false && $s !== nil) {
                return ["REGEXP_END", (($s = scanner).$matched || $mm('matched')).call($s)]
              };
              return ["STRING_END", (($u = scanner).$matched || $mm('matched')).call($u)];
              } else {
              (($v = str_buffer)['$<<'] || $mm('<<')).call($v, (($w = scanner).$matched || $mm('matched')).call($w));
              ($x = "nesting", $y = str_parse, (($z = (($aa = $y)['$[]'] || $mm('[]')).call($aa, $x)), $z !== false && $z !== nil ? $z : (($ab = $y)['$[]='] || $mm('[]=')).call($ab, $x, 1)));
              this.string_parse = str_parse;
            }
            } else {
            if (($x = (($y = ["\"", "'"])['$include?'] || $mm('include?')).call($y, (($z = str_parse)['$[]'] || $mm('[]')).call($z, "beg"))) !== false && $x !== nil) {
              this.lex_state = "expr_end";
              return ["STRING_END", (($x = scanner).$matched || $mm('matched')).call($x)];
              } else {
              if ((($ac = (($ad = str_parse)['$[]'] || $mm('[]')).call($ad, "beg"))['$=='] || $mm('==')).call($ac, "`")) {
                this.lex_state = "expr_end";
                return ["STRING_END", (($ae = scanner).$matched || $mm('matched')).call($ae)];
                } else {
                if (($af = (($ag = (($ah = (($ai = str_parse)['$[]'] || $mm('[]')).call($ai, "beg"))['$=='] || $mm('==')).call($ah, "/")), $ag !== false && $ag !== nil ? $ag : (($aj = str_parse)['$[]'] || $mm('[]')).call($aj, "regexp"))) !== false && $af !== nil) {
                  result = (($af = scanner).$scan || $mm('scan')).call($af, /\w+/);
                  this.lex_state = "expr_end";
                  return ["REGEXP_END", result];
                  } else {
                  this.lex_state = "expr_end";
                  return ["STRING_END", (($ag = scanner).$matched || $mm('matched')).call($ag)];
                }
              }
            }
          };
        };
        if (space !== false && space !== nil) {
          return ["SPACE", " "]
        };
        if (($ak = ($al = (($al = str_parse)['$[]'] || $mm('[]')).call($al, "balance"), $al !== false && $al !== nil ? (($am = scanner).$scan || $mm('scan')).call($am, (($an = (($ao = __scope.Regexp) == null ? __opal.cm("Regexp") : $ao)).$new || $mm('new')).call($an, (($ao = (($ap = __scope.Regexp) == null ? __opal.cm("Regexp") : $ap)).$escape || $mm('escape')).call($ao, (($ap = str_parse)['$[]'] || $mm('[]')).call($ap, "beg")))) : $al)) !== false && $ak !== nil) {
          (($ak = str_buffer)['$<<'] || $mm('<<')).call($ak, (($aq = scanner).$matched || $mm('matched')).call($aq));
          ($ar = "nesting", $as = str_parse, (($at = (($au = $as)['$[]'] || $mm('[]')).call($au, $ar)), $at !== false && $at !== nil ? $at : (($av = $as)['$[]='] || $mm('[]=')).call($av, $ar, 1)));
          } else {
          if (($ar = (($as = scanner).$check || $mm('check')).call($as, /#[@$]/)) !== false && $ar !== nil) {
            (($ar = scanner).$scan || $mm('scan')).call($ar, /#/);
            if (interpolate !== false && interpolate !== nil) {
              return ["STRING_DVAR", (($at = scanner).$matched || $mm('matched')).call($at)]
              } else {
              (($aw = str_buffer)['$<<'] || $mm('<<')).call($aw, (($ax = scanner).$matched || $mm('matched')).call($ax))
            };
            } else {
            if (($ay = (($az = scanner).$scan || $mm('scan')).call($az, /#\{/)) !== false && $ay !== nil) {
              if (interpolate !== false && interpolate !== nil) {
                return ["STRING_DBEG", (($ay = scanner).$matched || $mm('matched')).call($ay)]
                } else {
                (($ba = str_buffer)['$<<'] || $mm('<<')).call($ba, (($bb = scanner).$matched || $mm('matched')).call($bb))
              }
              } else {
              if (($bc = (($bd = scanner).$scan || $mm('scan')).call($bd, /\#/)) !== false && $bc !== nil) {
                (($bc = str_buffer)['$<<'] || $mm('<<')).call($bc, "#")
              }
            }
          }
        };
        (($be = this).$add_string_content || $mm('add_string_content')).call($be, str_buffer, str_parse);
        complete_str = (($bf = str_buffer).$join || $mm('join')).call($bf, "");
        this.line = (($bg = this.line)['$+'] || $mm('+')).call($bg, (($bh = complete_str).$count || $mm('count')).call($bh, "\n"));
        return ["STRING_CONTENT", complete_str];
      };

      def.$add_string_content = function(str_buffer, str_parse) {
        var scanner = nil, end_str_re = nil, interpolate = nil, words = nil, c = nil, handled = nil, reg = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay, $az, $ba, $bb, $bc, $bd;
        scanner = this.scanner;
        end_str_re = (($a = (($b = __scope.Regexp) == null ? __opal.cm("Regexp") : $b)).$new || $mm('new')).call($a, (($b = (($c = __scope.Regexp) == null ? __opal.cm("Regexp") : $c)).$escape || $mm('escape')).call($b, (($c = str_parse)['$[]'] || $mm('[]')).call($c, "end")));
        interpolate = (($d = str_parse)['$[]'] || $mm('[]')).call($d, "interpolate");
        words = (($e = ["W", "w"])['$include?'] || $mm('include?')).call($e, (($f = str_parse)['$[]'] || $mm('[]')).call($f, "beg"));
        while (!(($h = (($i = scanner)['$eos?'] || $mm('eos?')).call($i)) !== false && $h !== nil)) {c = nil;
        handled = true;
        if (($h = (($j = scanner).$check || $mm('check')).call($j, end_str_re)) !== false && $h !== nil) {
          if (($h = ($k = (($k = str_parse)['$[]'] || $mm('[]')).call($k, "balance"), $k !== false && $k !== nil ? ($l = (($m = (($n = str_parse)['$[]'] || $mm('[]')).call($n, "nesting"))['$=='] || $mm('==')).call($m, 0), ($l === nil || $l === false)) : $k)) !== false && $h !== nil) {
            (($h = scanner).$scan || $mm('scan')).call($h, end_str_re);
            c = (($l = scanner).$matched || $mm('matched')).call($l);
            ($o = "nesting", $p = str_parse, (($q = (($r = $p)['$[]'] || $mm('[]')).call($r, $o)), $q !== false && $q !== nil ? $q : (($s = $p)['$[]='] || $mm('[]=')).call($s, $o, 1)));
            } else {
            break;
          }
          } else {
          if (($o = ($p = (($p = str_parse)['$[]'] || $mm('[]')).call($p, "balance"), $p !== false && $p !== nil ? (($q = scanner).$scan || $mm('scan')).call($q, (($t = (($u = __scope.Regexp) == null ? __opal.cm("Regexp") : $u)).$new || $mm('new')).call($t, (($u = (($v = __scope.Regexp) == null ? __opal.cm("Regexp") : $v)).$escape || $mm('escape')).call($u, (($v = str_parse)['$[]'] || $mm('[]')).call($v, "beg")))) : $p)) !== false && $o !== nil) {
            ($o = "nesting", $w = str_parse, (($x = (($y = $w)['$[]'] || $mm('[]')).call($y, $o)), $x !== false && $x !== nil ? $x : (($z = $w)['$[]='] || $mm('[]=')).call($z, $o, 1)));
            c = (($o = scanner).$matched || $mm('matched')).call($o);
            } else {
            if (($w = (($x = words !== false && words !== nil) ? (($aa = scanner).$scan || $mm('scan')).call($aa, /\s/) : $x)) !== false && $w !== nil) {
              ($w = scanner, (($x = $w)['$pos='] || $mm('pos=')).call($x, (($ab = (($ac = $w).$pos || $mm('pos')).call($ac))['$-'] || $mm('-')).call($ab, 1)));
              break;;
              } else {
              if (($w = (($ad = interpolate !== false && interpolate !== nil) ? (($ae = scanner).$check || $mm('check')).call($ae, /#(?=[\$\@\{])/) : $ad)) !== false && $w !== nil) {
                break;
                } else {
                if (($w = (($ad = scanner).$scan || $mm('scan')).call($ad, /\\/)) !== false && $w !== nil) {
                  if (($w = (($af = str_parse)['$[]'] || $mm('[]')).call($af, "regexp")) !== false && $w !== nil) {
                    if (($w = (($ag = scanner).$scan || $mm('scan')).call($ag, /(.)/)) !== false && $w !== nil) {
                      c = ($w = "\\", $ah = (($ai = scanner).$matched || $mm('matched')).call($ai), typeof($w) === 'number' ? $w + $ah : $w['$+']($ah))
                    }
                    } else {
                    c = (function() { if (($w = (($ah = scanner).$scan || $mm('scan')).call($ah, /n/)) !== false && $w !== nil) {
                      return "\n"
                      } else {
                      if (($w = (($aj = scanner).$scan || $mm('scan')).call($aj, /r/)) !== false && $w !== nil) {
                        return "\r"
                        } else {
                        if (($w = (($ak = scanner).$scan || $mm('scan')).call($ak, /\n/)) !== false && $w !== nil) {
                          return "\n"
                          } else {
                          if (($w = (($al = scanner).$scan || $mm('scan')).call($al, /t/)) !== false && $w !== nil) {
                            return "\t"
                            } else {
                            (($w = scanner).$scan || $mm('scan')).call($w, /./);
                            return (($am = scanner).$matched || $mm('matched')).call($am);
                          }
                        }
                      }
                    }; return nil; }).call(this)
                  }
                  } else {
                  handled = false
                }
              }
            }
          }
        };
        if (($an = handled) === false || $an === nil) {
          reg = (function() { if (words !== false && words !== nil) {
            return (($an = (($ao = __scope.Regexp) == null ? __opal.cm("Regexp") : $ao)).$new || $mm('new')).call($an, "[^" + ((($ao = (($ap = __scope.Regexp) == null ? __opal.cm("Regexp") : $ap)).$escape || $mm('escape')).call($ao, (($ap = str_parse)['$[]'] || $mm('[]')).call($ap, "end"))) + "#0\n \\\\]+|.")
            } else {
            if (($aq = (($ar = str_parse)['$[]'] || $mm('[]')).call($ar, "balance")) !== false && $aq !== nil) {
              return (($aq = (($as = __scope.Regexp) == null ? __opal.cm("Regexp") : $as)).$new || $mm('new')).call($aq, "[^" + ((($as = (($at = __scope.Regexp) == null ? __opal.cm("Regexp") : $at)).$escape || $mm('escape')).call($as, (($at = str_parse)['$[]'] || $mm('[]')).call($at, "end"))) + ((($au = (($av = __scope.Regexp) == null ? __opal.cm("Regexp") : $av)).$escape || $mm('escape')).call($au, (($av = str_parse)['$[]'] || $mm('[]')).call($av, "beg"))) + "#0\\\\]+|.")
              } else {
              return (($aw = (($ax = __scope.Regexp) == null ? __opal.cm("Regexp") : $ax)).$new || $mm('new')).call($aw, "[^" + ((($ax = (($ay = __scope.Regexp) == null ? __opal.cm("Regexp") : $ay)).$escape || $mm('escape')).call($ax, (($ay = str_parse)['$[]'] || $mm('[]')).call($ay, "end"))) + "#0\\\\]+|.")
            }
          }; return nil; }).call(this);
          (($az = scanner).$scan || $mm('scan')).call($az, reg);
          c = (($ba = scanner).$matched || $mm('matched')).call($ba);
        };
        (($bb = c), $bb !== false && $bb !== nil ? $bb : c = (($bc = scanner).$matched || $mm('matched')).call($bc));
        (($bb = str_buffer)['$<<'] || $mm('<<')).call($bb, c);};
        if (($g = (($bd = scanner)['$eos?'] || $mm('eos?')).call($bd)) !== false && $g !== nil) {
          return (($g = this).$raise || $mm('raise')).call($g, "reached EOF while in string")
          } else {
          return nil
        };
      };

      def.$next_token = function() {
        var scanner = nil, space_seen = nil, cmd_start = nil, c = nil, start_word = nil, end_word = nil, interpolate = nil, result = nil, heredoc = nil, sign = nil, matched = nil, $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay, $az, $ba, $bb, $bc, $bd, $be, $bf, $bg, $bh, $bi, $bj, $bk, $bl, $bm, $bn, $bo, $bp, $bq, $br, $bs, $bt, $bu, $bv, $bw, $bx, $by, $bz, $ca, $cb, $cc, $cd, $ce, $cf, $cg, $ch, $ci, $cj, $ck, $cl, $cm, $cn, $co, $cp, $cq, $cr, $cs, $ct, $cu, $cv, $cw, $cx, $cy, $cz, $da, $db, $dc, $dd, $de, $df, $dg, $dh, $di, $dj, $dk, $dl, $dm, $dn, $do, $dp, $dq, $dr, $ds, $dt, $du, $dv, $dw, $dx, $dy, $dz, $ea, $eb, $ec, $ed, $ee, $ef, $eg, $eh, $ei, $ej, $ek, $el, $em, $en, $eo, $ep, $eq, $er, $es, $et, $eu, $ev, $ew, $ex, $ey, $ez, $fa, $fb, $fc, $fd, $fe, $ff, $fg, $fh, $fi, $fj, $fk, $fl, $fm, $fn, $fo, $fp, $fq, $fr, $fs, $ft, $fu, $fv, $fw, $fx, $fy, $fz, $ga, $gb, $gc, $gd, $ge, $gf, $gg, $gh, $gi, $gj, $gk, $gl, $gm, $gn, $go, $gp, $gq, $gr, $gs, $gt, $gu, $gv, $gw, $gx, $gy, $gz, $ha, $hb, $hc, $hd, $he, $hf, $hg, $hh, $hi, $hj, $hk, $hl, $hm, $hn, $ho, $hp, $hq, $hr, $hs, $ht, $hu, $hv, $hw, $hx, $hy, $hz, $ia, $ib, $ic, $id, $ie, $if, $ig, $ih, $ii, $ij, $ik, $il, $im, $in, $io, $ip, $iq, $ir, $is, $it, $iu, $iv, $iw, $ix, $iy, $iz, $ja, $jb, $jc, $jd, $je, $jf, $jg, $jh, $ji, $jj, $jk, $jl, $jm, $jn, $jo, $jp, $jq, $jr, $js, $jt, $ju, $jv, $jw, $jx, $jy, $jz, $ka, $kb, $kc, $kd, $ke, $kf, $kg, $kh, $ki, $kj, $kk, $kl, $km, $kn, $ko, $kp, $kq, $kr, $ks, $kt, $ku, $kv, $kw, $kx, $ky, $kz, $la, $lb, $lc, $ld, $le, $lf, $lg, $lh, $li, $lj, $lk, $ll;
        if (($a = this.string_parse) !== false && $a !== nil) {
          return (($a = this).$next_string_token || $mm('next_string_token')).call($a)
        };
        scanner = this.scanner;
        space_seen = false;
        cmd_start = false;
        c = "";
        while (($c = true) !== false && $c !== nil){if (($c = (($d = scanner).$scan || $mm('scan')).call($d, /\ |\t|\r/)) !== false && $c !== nil) {
          space_seen = true;
          continue;;
          } else {
          if (($c = (($e = scanner).$scan || $mm('scan')).call($e, /(\n|#)/)) !== false && $c !== nil) {
            c = (($c = scanner).$matched || $mm('matched')).call($c);
            if ((($f = c)['$=='] || $mm('==')).call($f, "#")) {
              (($g = scanner).$scan || $mm('scan')).call($g, /(.*)/)
              } else {
              this.line = (($h = this.line)['$+'] || $mm('+')).call($h, 1)
            };
            (($i = scanner).$scan || $mm('scan')).call($i, /(\n+)/);
            if (($j = (($k = scanner).$matched || $mm('matched')).call($k)) !== false && $j !== nil) {
              this.line = (($j = this.line)['$+'] || $mm('+')).call($j, (($l = (($m = scanner).$matched || $mm('matched')).call($m)).$length || $mm('length')).call($l))
            };
            if (($n = (($o = ["expr_beg", "expr_dot"])['$include?'] || $mm('include?')).call($o, this.lex_state)) !== false && $n !== nil) {
              continue;
            };
            cmd_start = true;
            this.lex_state = "expr_beg";
            return ["\\n", "\\n"];
            } else {
            if (($n = (($p = scanner).$scan || $mm('scan')).call($p, /\;/)) !== false && $n !== nil) {
              this.lex_state = "expr_beg";
              return [";", ";"];
              } else {
              if (($n = (($q = scanner).$scan || $mm('scan')).call($q, /\"/)) !== false && $n !== nil) {
                this.string_parse = __hash2(["beg", "end", "interpolate"], {"beg": "\"", "end": "\"", "interpolate": true});
                return ["STRING_BEG", (($n = scanner).$matched || $mm('matched')).call($n)];
                } else {
                if (($r = (($s = scanner).$scan || $mm('scan')).call($s, /\'/)) !== false && $r !== nil) {
                  this.string_parse = __hash2(["beg", "end"], {"beg": "'", "end": "'"});
                  return ["STRING_BEG", (($r = scanner).$matched || $mm('matched')).call($r)];
                  } else {
                  if (($t = (($u = scanner).$scan || $mm('scan')).call($u, /\`/)) !== false && $t !== nil) {
                    this.string_parse = __hash2(["beg", "end", "interpolate"], {"beg": "`", "end": "`", "interpolate": true});
                    return ["XSTRING_BEG", (($t = scanner).$matched || $mm('matched')).call($t)];
                    } else {
                    if (($v = (($w = scanner).$scan || $mm('scan')).call($w, /\%W/)) !== false && $v !== nil) {
                      start_word = (($v = scanner).$scan || $mm('scan')).call($v, /./);
                      end_word = (($x = (($y = __hash2(["(", "[", "{"], {"(": ")", "[": "]", "{": "}"}))['$[]'] || $mm('[]')).call($y, start_word)), $x !== false && $x !== nil ? $x : start_word);
                      this.string_parse = __hash2(["beg", "end", "interpolate"], {"beg": "W", "end": end_word, "interpolate": true});
                      (($x = scanner).$scan || $mm('scan')).call($x, /\s*/);
                      return ["WORDS_BEG", (($z = scanner).$matched || $mm('matched')).call($z)];
                      } else {
                      if (($aa = (($ab = scanner).$scan || $mm('scan')).call($ab, /\%w/)) !== false && $aa !== nil) {
                        start_word = (($aa = scanner).$scan || $mm('scan')).call($aa, /./);
                        end_word = (($ac = (($ad = __hash2(["(", "[", "{"], {"(": ")", "[": "]", "{": "}"}))['$[]'] || $mm('[]')).call($ad, start_word)), $ac !== false && $ac !== nil ? $ac : start_word);
                        this.string_parse = __hash2(["beg", "end"], {"beg": "w", "end": end_word});
                        (($ac = scanner).$scan || $mm('scan')).call($ac, /\s*/);
                        return ["AWORDS_BEG", (($ae = scanner).$matched || $mm('matched')).call($ae)];
                        } else {
                        if (($af = (($ag = scanner).$scan || $mm('scan')).call($ag, /\%[Qq]/)) !== false && $af !== nil) {
                          interpolate = (($af = (($ah = scanner).$matched || $mm('matched')).call($ah))['$end_with?'] || $mm('end_with?')).call($af, "Q");
                          start_word = (($ai = scanner).$scan || $mm('scan')).call($ai, /./);
                          end_word = (($aj = (($ak = __hash2(["(", "[", "{"], {"(": ")", "[": "]", "{": "}"}))['$[]'] || $mm('[]')).call($ak, start_word)), $aj !== false && $aj !== nil ? $aj : start_word);
                          this.string_parse = __hash2(["beg", "end", "balance", "nesting", "interpolate"], {"beg": start_word, "end": end_word, "balance": true, "nesting": 0, "interpolate": interpolate});
                          return ["STRING_BEG", (($aj = scanner).$matched || $mm('matched')).call($aj)];
                          } else {
                          if (($al = (($am = scanner).$scan || $mm('scan')).call($am, /\%x/)) !== false && $al !== nil) {
                            start_word = (($al = scanner).$scan || $mm('scan')).call($al, /./);
                            end_word = (($an = (($ao = __hash2(["(", "[", "{"], {"(": ")", "[": "]", "{": "}"}))['$[]'] || $mm('[]')).call($ao, start_word)), $an !== false && $an !== nil ? $an : start_word);
                            this.string_parse = __hash2(["beg", "end", "balance", "nesting", "interpolate"], {"beg": start_word, "end": end_word, "balance": true, "nesting": 0, "interpolate": true});
                            return ["XSTRING_BEG", (($an = scanner).$matched || $mm('matched')).call($an)];
                            } else {
                            if (($ap = (($aq = scanner).$scan || $mm('scan')).call($aq, /\%r/)) !== false && $ap !== nil) {
                              start_word = (($ap = scanner).$scan || $mm('scan')).call($ap, /./);
                              end_word = (($ar = (($as = __hash2(["(", "[", "{"], {"(": ")", "[": "]", "{": "}"}))['$[]'] || $mm('[]')).call($as, start_word)), $ar !== false && $ar !== nil ? $ar : start_word);
                              this.string_parse = __hash2(["beg", "end", "regexp", "balance", "nesting", "interpolate"], {"beg": start_word, "end": end_word, "regexp": true, "balance": true, "nesting": 0, "interpolate": true});
                              return ["REGEXP_BEG", (($ar = scanner).$matched || $mm('matched')).call($ar)];
                              } else {
                              if (($at = (($au = scanner).$scan || $mm('scan')).call($au, /\//)) !== false && $at !== nil) {
                                if (($at = (($av = ["expr_beg", "expr_mid"])['$include?'] || $mm('include?')).call($av, this.lex_state)) !== false && $at !== nil) {
                                  this.string_parse = __hash2(["beg", "end", "interpolate", "regexp"], {"beg": "/", "end": "/", "interpolate": true, "regexp": true});
                                  return ["REGEXP_BEG", (($at = scanner).$matched || $mm('matched')).call($at)];
                                  } else {
                                  if (($aw = (($ax = scanner).$scan || $mm('scan')).call($ax, /\=/)) !== false && $aw !== nil) {
                                    this.lex_state = "expr_beg";
                                    return ["OP_ASGN", "/"];
                                    } else {
                                    if ((($aw = this.lex_state)['$=='] || $mm('==')).call($aw, "expr_fname")) {
                                      this.lex_state = "expr_end"
                                      } else {
                                      if (($ay = (($az = (($ba = this.lex_state)['$=='] || $mm('==')).call($ba, "expr_cmdarg")), $az !== false && $az !== nil ? $az : (($bb = this.lex_state)['$=='] || $mm('==')).call($bb, "expr_arg"))) !== false && $ay !== nil) {
                                        if (($ay = ($az = ($az = (($bc = scanner).$check || $mm('check')).call($bc, /\s/), ($az === nil || $az === false)), $az !== false && $az !== nil ? space_seen : $az)) !== false && $ay !== nil) {
                                          this.string_parse = __hash2(["beg", "end", "interpolate", "regexp"], {"beg": "/", "end": "/", "interpolate": true, "regexp": true});
                                          return ["REGEXP_BEG", (($ay = scanner).$matched || $mm('matched')).call($ay)];
                                        }
                                        } else {
                                        this.lex_state = "expr_beg"
                                      }
                                    }
                                  }
                                };
                                return ["/", "/"];
                                } else {
                                if (($az = (($bd = scanner).$scan || $mm('scan')).call($bd, /\%/)) !== false && $az !== nil) {
                                  if (($az = (($be = scanner).$scan || $mm('scan')).call($be, /\=/)) !== false && $az !== nil) {
                                    this.lex_state = "expr_beg";
                                    return ["OP_ASGN", "%"];
                                    } else {
                                    if (($az = (($bf = scanner).$check || $mm('check')).call($bf, /[^\s]/)) !== false && $az !== nil) {
                                      if (($az = (($bg = (($bh = this.lex_state)['$=='] || $mm('==')).call($bh, "expr_beg")), $bg !== false && $bg !== nil ? $bg : (($bi = (($bj = this.lex_state)['$=='] || $mm('==')).call($bj, "expr_arg")) ? space_seen : $bi))) !== false && $az !== nil) {
                                        interpolate = true;
                                        start_word = (($az = scanner).$scan || $mm('scan')).call($az, /./);
                                        end_word = (($bg = (($bi = __hash2(["(", "[", "{"], {"(": ")", "[": "]", "{": "}"}))['$[]'] || $mm('[]')).call($bi, start_word)), $bg !== false && $bg !== nil ? $bg : start_word);
                                        this.string_parse = __hash2(["beg", "end", "balance", "nesting", "interpolate"], {"beg": start_word, "end": end_word, "balance": true, "nesting": 0, "interpolate": interpolate});
                                        return ["STRING_BEG", (($bg = scanner).$matched || $mm('matched')).call($bg)];
                                      }
                                    }
                                  };
                                  this.lex_state = (function() { if ((($bk = this.lex_state)['$=='] || $mm('==')).call($bk, "expr_fname")) {
                                    return "expr_end"
                                    } else {
                                    return "expr_beg"
                                  }; return nil; }).call(this);
                                  return ["%", "%"];
                                  } else {
                                  if (($bl = (($bm = scanner).$scan || $mm('scan')).call($bm, /\\/)) !== false && $bl !== nil) {
                                    if (($bl = (($bn = scanner).$scan || $mm('scan')).call($bn, /\r?\n/)) !== false && $bl !== nil) {
                                      space_seen = true;
                                      continue;;
                                    };
                                    (($bl = this).$raise || $mm('raise')).call($bl, (($bo = __scope.SyntaxError) == null ? __opal.cm("SyntaxError") : $bo), "backslash must appear before newline :" + (this.file) + ":" + (this.line));
                                    } else {
                                    if (($bo = (($bp = scanner).$scan || $mm('scan')).call($bp, /\(/)) !== false && $bo !== nil) {
                                      result = (($bo = scanner).$matched || $mm('matched')).call($bo);
                                      if (($bq = (($br = ["expr_beg", "expr_mid"])['$include?'] || $mm('include?')).call($br, this.lex_state)) !== false && $bq !== nil) {
                                        result = "PAREN_BEG"
                                        } else {
                                        if (($bq = (($bs = space_seen !== false && space_seen !== nil) ? (($bt = ["expr_arg", "expr_cmdarg"])['$include?'] || $mm('include?')).call($bt, this.lex_state) : $bs)) !== false && $bq !== nil) {
                                          result = "tLPAREN_ARG"
                                          } else {
                                          result = "("
                                        }
                                      };
                                      this.lex_state = "expr_beg";
                                      (($bq = this).$cond_push || $mm('cond_push')).call($bq, 0);
                                      (($bs = this).$cmdarg_push || $mm('cmdarg_push')).call($bs, 0);
                                      return [result, (($bu = scanner).$matched || $mm('matched')).call($bu)];
                                      } else {
                                      if (($bv = (($bw = scanner).$scan || $mm('scan')).call($bw, /\)/)) !== false && $bv !== nil) {
                                        (($bv = this).$cond_lexpop || $mm('cond_lexpop')).call($bv);
                                        (($bx = this).$cmdarg_lexpop || $mm('cmdarg_lexpop')).call($bx);
                                        this.lex_state = "expr_end";
                                        return [")", (($by = scanner).$matched || $mm('matched')).call($by)];
                                        } else {
                                        if (($bz = (($ca = scanner).$scan || $mm('scan')).call($ca, /\[/)) !== false && $bz !== nil) {
                                          result = (($bz = scanner).$matched || $mm('matched')).call($bz);
                                          if (($cb = (($cc = ["expr_fname", "expr_dot"])['$include?'] || $mm('include?')).call($cc, this.lex_state)) !== false && $cb !== nil) {
                                            this.lex_state = "expr_arg";
                                            if (($cb = (($cd = scanner).$scan || $mm('scan')).call($cd, /\]=/)) !== false && $cb !== nil) {
                                              return ["[]=", "[]="]
                                              } else {
                                              if (($cb = (($ce = scanner).$scan || $mm('scan')).call($ce, /\]/)) !== false && $cb !== nil) {
                                                return ["[]", "[]"]
                                                } else {
                                                (($cb = this).$raise || $mm('raise')).call($cb, "Unexpected '[' token")
                                              }
                                            };
                                            } else {
                                            if (($cf = (($cg = (($ch = ["expr_beg", "expr_mid"])['$include?'] || $mm('include?')).call($ch, this.lex_state)), $cg !== false && $cg !== nil ? $cg : space_seen)) !== false && $cf !== nil) {
                                              this.lex_state = "expr_beg";
                                              (($cf = this).$cond_push || $mm('cond_push')).call($cf, 0);
                                              (($cg = this).$cmdarg_push || $mm('cmdarg_push')).call($cg, 0);
                                              return ["[", (($ci = scanner).$matched || $mm('matched')).call($ci)];
                                              } else {
                                              this.lex_state = "expr_beg";
                                              (($cj = this).$cond_push || $mm('cond_push')).call($cj, 0);
                                              (($ck = this).$cmdarg_push || $mm('cmdarg_push')).call($ck, 0);
                                              return ["[@", (($cl = scanner).$matched || $mm('matched')).call($cl)];
                                            }
                                          };
                                          } else {
                                          if (($cm = (($cn = scanner).$scan || $mm('scan')).call($cn, /\]/)) !== false && $cm !== nil) {
                                            (($cm = this).$cond_lexpop || $mm('cond_lexpop')).call($cm);
                                            (($co = this).$cmdarg_lexpop || $mm('cmdarg_lexpop')).call($co);
                                            this.lex_state = "expr_end";
                                            return ["]", (($cp = scanner).$matched || $mm('matched')).call($cp)];
                                            } else {
                                            if (($cq = (($cr = scanner).$scan || $mm('scan')).call($cr, /\}/)) !== false && $cq !== nil) {
                                              (($cq = this).$cond_lexpop || $mm('cond_lexpop')).call($cq);
                                              (($cs = this).$cmdarg_lexpop || $mm('cmdarg_lexpop')).call($cs);
                                              this.lex_state = "expr_end";
                                              return ["}", (($ct = scanner).$matched || $mm('matched')).call($ct)];
                                              } else {
                                              if (($cu = (($cv = scanner).$scan || $mm('scan')).call($cv, /\.\.\./)) !== false && $cu !== nil) {
                                                this.lex_state = "expr_beg";
                                                return ["...", (($cu = scanner).$matched || $mm('matched')).call($cu)];
                                                } else {
                                                if (($cw = (($cx = scanner).$scan || $mm('scan')).call($cx, /\.\./)) !== false && $cw !== nil) {
                                                  this.lex_state = "expr_beg";
                                                  return ["..", (($cw = scanner).$matched || $mm('matched')).call($cw)];
                                                  } else {
                                                  if (($cy = (($cz = scanner).$scan || $mm('scan')).call($cz, /\./)) !== false && $cy !== nil) {
                                                    if (($cy = (($da = this.lex_state)['$=='] || $mm('==')).call($da, "expr_fname")) === false || $cy === nil) {
                                                      this.lex_state = "expr_dot"
                                                    };
                                                    return [".", (($cy = scanner).$matched || $mm('matched')).call($cy)];
                                                    } else {
                                                    if (($db = (($dc = scanner).$scan || $mm('scan')).call($dc, /\*\*\=/)) !== false && $db !== nil) {
                                                      this.lex_state = "expr_beg";
                                                      return ["OP_ASGN", "**"];
                                                      } else {
                                                      if (($db = (($dd = scanner).$scan || $mm('scan')).call($dd, /\*\*/)) !== false && $db !== nil) {
                                                        return ["**", "**"]
                                                        } else {
                                                        if (($db = (($de = scanner).$scan || $mm('scan')).call($de, /\*\=/)) !== false && $db !== nil) {
                                                          this.lex_state = "expr_beg";
                                                          return ["OP_ASGN", "*"];
                                                          } else {
                                                          if (($db = (($df = scanner).$scan || $mm('scan')).call($df, /\*/)) !== false && $db !== nil) {
                                                            result = (($db = scanner).$matched || $mm('matched')).call($db);
                                                            if ((($dg = this.lex_state)['$=='] || $mm('==')).call($dg, "expr_fname")) {
                                                              this.lex_state = "expr_end";
                                                              return ["*", result];
                                                              } else {
                                                              if (($dh = (($di = space_seen !== false && space_seen !== nil) ? (($dj = scanner).$check || $mm('check')).call($dj, /\S/) : $di)) !== false && $dh !== nil) {
                                                                this.lex_state = "expr_beg";
                                                                return ["SPLAT", result];
                                                                } else {
                                                                if (($dh = (($di = ["expr_beg", "expr_mid"])['$include?'] || $mm('include?')).call($di, this.lex_state)) !== false && $dh !== nil) {
                                                                  this.lex_state = "expr_beg";
                                                                  return ["SPLAT", result];
                                                                  } else {
                                                                  this.lex_state = "expr_beg";
                                                                  return ["*", result];
                                                                }
                                                              }
                                                            };
                                                            } else {
                                                            if (($dh = (($dk = scanner).$scan || $mm('scan')).call($dk, /\:\:/)) !== false && $dh !== nil) {
                                                              if (($dh = (($dl = ["expr_beg", "expr_mid", "expr_class"])['$include?'] || $mm('include?')).call($dl, this.lex_state)) !== false && $dh !== nil) {
                                                                this.lex_state = "expr_beg";
                                                                return ["::@", (($dh = scanner).$matched || $mm('matched')).call($dh)];
                                                              };
                                                              this.lex_state = "expr_dot";
                                                              return ["::", (($dm = scanner).$matched || $mm('matched')).call($dm)];
                                                              } else {
                                                              if (($dn = (($do = scanner).$scan || $mm('scan')).call($do, /\:/)) !== false && $dn !== nil) {
                                                                if (($dn = (($dp = (($dq = ["expr_end", "expr_endarg"])['$include?'] || $mm('include?')).call($dq, this.lex_state)), $dp !== false && $dp !== nil ? $dp : (($dr = scanner).$check || $mm('check')).call($dr, /\s/))) !== false && $dn !== nil) {
                                                                  if (($dn = (($dp = scanner).$check || $mm('check')).call($dp, /\w/)) === false || $dn === nil) {
                                                                    this.lex_state = "expr_beg";
                                                                    return [":", ":"];
                                                                  };
                                                                  this.lex_state = "expr_fname";
                                                                  return ["SYMBOL_BEG", ":"];
                                                                };
                                                                if (($dn = (($ds = scanner).$scan || $mm('scan')).call($ds, /\'/)) !== false && $dn !== nil) {
                                                                  this.string_parse = __hash2(["beg", "end"], {"beg": "'", "end": "'"})
                                                                  } else {
                                                                  if (($dn = (($dt = scanner).$scan || $mm('scan')).call($dt, /\"/)) !== false && $dn !== nil) {
                                                                    this.string_parse = __hash2(["beg", "end", "interpolate"], {"beg": "\"", "end": "\"", "interpolate": true})
                                                                  }
                                                                };
                                                                this.lex_state = "expr_fname";
                                                                return ["SYMBOL_BEG", ":"];
                                                                } else {
                                                                if (($dn = (($du = scanner).$check || $mm('check')).call($du, /\|/)) !== false && $dn !== nil) {
                                                                  if (($dn = (($dv = scanner).$scan || $mm('scan')).call($dv, /\|\|\=/)) !== false && $dn !== nil) {
                                                                    this.lex_state = "expr_beg";
                                                                    return ["OP_ASGN", "||"];
                                                                    } else {
                                                                    if (($dn = (($dw = scanner).$scan || $mm('scan')).call($dw, /\|\|/)) !== false && $dn !== nil) {
                                                                      this.lex_state = "expr_beg";
                                                                      return ["||", "||"];
                                                                      } else {
                                                                      if (($dn = (($dx = scanner).$scan || $mm('scan')).call($dx, /\|\=/)) !== false && $dn !== nil) {
                                                                        this.lex_state = "expr_beg";
                                                                        return ["OP_ASGN", "|"];
                                                                        } else {
                                                                        if (($dn = (($dy = scanner).$scan || $mm('scan')).call($dy, /\|/)) !== false && $dn !== nil) {
                                                                          if ((($dn = this.lex_state)['$=='] || $mm('==')).call($dn, "expr_fname")) {
                                                                            this.lex_state = "expr_end";
                                                                            return ["|", (($dz = scanner).$matched || $mm('matched')).call($dz)];
                                                                            } else {
                                                                            this.lex_state = "expr_beg";
                                                                            return ["|", (($ea = scanner).$matched || $mm('matched')).call($ea)];
                                                                          }
                                                                        }
                                                                      }
                                                                    }
                                                                  }
                                                                  } else {
                                                                  if (($eb = (($ec = scanner).$scan || $mm('scan')).call($ec, /\^\=/)) !== false && $eb !== nil) {
                                                                    this.lex_state = "expr_beg";
                                                                    return ["OP_ASGN", "^"];
                                                                    } else {
                                                                    if (($eb = (($ed = scanner).$scan || $mm('scan')).call($ed, /\^/)) !== false && $eb !== nil) {
                                                                      if ((($eb = this.lex_state)['$=='] || $mm('==')).call($eb, "expr_fname")) {
                                                                        this.lex_state = "expr_end";
                                                                        return ["^", (($ee = scanner).$matched || $mm('matched')).call($ee)];
                                                                      };
                                                                      this.lex_state = "expr_beg";
                                                                      return ["^", (($ef = scanner).$matched || $mm('matched')).call($ef)];
                                                                      } else {
                                                                      if (($eg = (($eh = scanner).$check || $mm('check')).call($eh, /\&/)) !== false && $eg !== nil) {
                                                                        if (($eg = (($ei = scanner).$scan || $mm('scan')).call($ei, /\&\&\=/)) !== false && $eg !== nil) {
                                                                          this.lex_state = "expr_beg";
                                                                          return ["OP_ASGN", "&&"];
                                                                          } else {
                                                                          if (($eg = (($ej = scanner).$scan || $mm('scan')).call($ej, /\&\&/)) !== false && $eg !== nil) {
                                                                            this.lex_state = "expr_beg";
                                                                            return ["&&", (($eg = scanner).$matched || $mm('matched')).call($eg)];
                                                                            } else {
                                                                            if (($ek = (($el = scanner).$scan || $mm('scan')).call($el, /\&\=/)) !== false && $ek !== nil) {
                                                                              this.lex_state = "expr_beg";
                                                                              return ["OP_ASGN", "&"];
                                                                              } else {
                                                                              if (($ek = (($em = scanner).$scan || $mm('scan')).call($em, /\&/)) !== false && $ek !== nil) {
                                                                                if (($ek = ($en = (($en = space_seen !== false && space_seen !== nil) ? ($eo = (($ep = scanner).$check || $mm('check')).call($ep, /\s/), ($eo === nil || $eo === false)) : $en), $en !== false && $en !== nil ? (($en = (($eo = this.lex_state)['$=='] || $mm('==')).call($eo, "expr_cmdarg")), $en !== false && $en !== nil ? $en : (($eq = this.lex_state)['$=='] || $mm('==')).call($eq, "expr_arg")) : $en)) !== false && $ek !== nil) {
                                                                                  return ["&@", "&"]
                                                                                  } else {
                                                                                  if (($ek = (($en = ["expr_beg", "expr_mid"])['$include?'] || $mm('include?')).call($en, this.lex_state)) !== false && $ek !== nil) {
                                                                                    return ["&@", "&"]
                                                                                    } else {
                                                                                    return ["&", "&"]
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                        } else {
                                                                        if (($ek = (($er = scanner).$check || $mm('check')).call($er, /\</)) !== false && $ek !== nil) {
                                                                          if (($ek = (($es = scanner).$scan || $mm('scan')).call($es, /\<\<\=/)) !== false && $ek !== nil) {
                                                                            this.lex_state = "expr_beg";
                                                                            return ["OP_ASGN", "<<"];
                                                                            } else {
                                                                            if (($ek = (($et = scanner).$scan || $mm('scan')).call($et, /\<\</)) !== false && $ek !== nil) {
                                                                              if ((($ek = this.lex_state)['$=='] || $mm('==')).call($ek, "expr_fname")) {
                                                                                this.lex_state = "expr_end";
                                                                                return ["<<", "<<"];
                                                                                } else {
                                                                                if (($eu = ($ev = ($ev = (($ew = ["expr_end", "expr_dot", "expr_endarg", "expr_class"])['$include?'] || $mm('include?')).call($ew, this.lex_state), ($ev === nil || $ev === false)), $ev !== false && $ev !== nil ? space_seen : $ev)) !== false && $eu !== nil) {
                                                                                  if (($eu = (($ev = scanner).$scan || $mm('scan')).call($ev, /(-?)(\w+)/)) !== false && $eu !== nil) {
                                                                                    heredoc = (($eu = scanner)['$[]'] || $mm('[]')).call($eu, 2);
                                                                                    (($ex = scanner).$scan || $mm('scan')).call($ex, /.*\n/);
                                                                                    this.string_parse = __hash2(["beg", "end", "interpolate"], {"beg": heredoc, "end": heredoc, "interpolate": true});
                                                                                    return ["STRING_BEG", heredoc];
                                                                                  };
                                                                                  this.lex_state = "expr_beg";
                                                                                  return ["<<", "<<"];
                                                                                }
                                                                              };
                                                                              this.lex_state = "expr_beg";
                                                                              return ["<<", "<<"];
                                                                              } else {
                                                                              if (($ey = (($ez = scanner).$scan || $mm('scan')).call($ez, /\<\=\>/)) !== false && $ey !== nil) {
                                                                                if ((($ey = this.lex_state)['$=='] || $mm('==')).call($ey, "expr_fname")) {
                                                                                  this.lex_state = "expr_end"
                                                                                  } else {
                                                                                  this.lex_state = "expr_beg"
                                                                                };
                                                                                return ["<=>", "<=>"];
                                                                                } else {
                                                                                if (($fa = (($fb = scanner).$scan || $mm('scan')).call($fb, /\<\=/)) !== false && $fa !== nil) {
                                                                                  if ((($fa = this.lex_state)['$=='] || $mm('==')).call($fa, "expr_fname")) {
                                                                                    this.lex_state = "expr_end"
                                                                                    } else {
                                                                                    this.lex_state = "expr_beg"
                                                                                  };
                                                                                  return ["<=", "<="];
                                                                                  } else {
                                                                                  if (($fc = (($fd = scanner).$scan || $mm('scan')).call($fd, /\</)) !== false && $fc !== nil) {
                                                                                    if ((($fc = this.lex_state)['$=='] || $mm('==')).call($fc, "expr_fname")) {
                                                                                      this.lex_state = "expr_end"
                                                                                      } else {
                                                                                      this.lex_state = "expr_beg"
                                                                                    };
                                                                                    return ["<", "<"];
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                          } else {
                                                                          if (($fe = (($ff = scanner).$check || $mm('check')).call($ff, /\>/)) !== false && $fe !== nil) {
                                                                            if (($fe = (($fg = scanner).$scan || $mm('scan')).call($fg, /\>\>\=/)) !== false && $fe !== nil) {
                                                                              return ["OP_ASGN", ">>"]
                                                                              } else {
                                                                              if (($fe = (($fh = scanner).$scan || $mm('scan')).call($fh, /\>\>/)) !== false && $fe !== nil) {
                                                                                return [">>", ">>"]
                                                                                } else {
                                                                                if (($fe = (($fi = scanner).$scan || $mm('scan')).call($fi, /\>\=/)) !== false && $fe !== nil) {
                                                                                  if ((($fe = this.lex_state)['$=='] || $mm('==')).call($fe, "expr_fname")) {
                                                                                    this.lex_state = "expr_end"
                                                                                    } else {
                                                                                    this.lex_state = "expr_beg"
                                                                                  };
                                                                                  return [">=", (($fj = scanner).$matched || $mm('matched')).call($fj)];
                                                                                  } else {
                                                                                  if (($fk = (($fl = scanner).$scan || $mm('scan')).call($fl, /\>/)) !== false && $fk !== nil) {
                                                                                    if ((($fk = this.lex_state)['$=='] || $mm('==')).call($fk, "expr_fname")) {
                                                                                      this.lex_state = "expr_arg"
                                                                                      } else {
                                                                                      this.lex_state = "expr_beg"
                                                                                    };
                                                                                    return [">", ">"];
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                            } else {
                                                                            if (($fm = (($fn = scanner).$scan || $mm('scan')).call($fn, /->/)) !== false && $fm !== nil) {
                                                                              this.lex_state = "expr_end";
                                                                              this.start_of_lambda = true;
                                                                              return ["LAMBDA", (($fm = scanner).$matched || $mm('matched')).call($fm)];
                                                                              } else {
                                                                              if (($fo = (($fp = scanner).$scan || $mm('scan')).call($fp, /[+-]/)) !== false && $fo !== nil) {
                                                                                result = (($fo = scanner).$matched || $mm('matched')).call($fo);
                                                                                sign = ($fq = result, $fr = "@", typeof($fq) === 'number' ? $fq + $fr : $fq['$+']($fr));
                                                                                if (($fq = (($fr = (($fs = this.lex_state)['$=='] || $mm('==')).call($fs, "expr_beg")), $fr !== false && $fr !== nil ? $fr : (($ft = this.lex_state)['$=='] || $mm('==')).call($ft, "expr_mid"))) !== false && $fq !== nil) {
                                                                                  this.lex_state = "expr_mid";
                                                                                  return [sign, sign];
                                                                                  } else {
                                                                                  if ((($fq = this.lex_state)['$=='] || $mm('==')).call($fq, "expr_fname")) {
                                                                                    this.lex_state = "expr_end";
                                                                                    if (($fr = (($fu = scanner).$scan || $mm('scan')).call($fu, /@/)) !== false && $fr !== nil) {
                                                                                      return ["IDENTIFIER", ($fr = result, $fv = (($fw = scanner).$matched || $mm('matched')).call($fw), typeof($fr) === 'number' ? $fr + $fv : $fr['$+']($fv))]
                                                                                    };
                                                                                    return [result, result];
                                                                                  }
                                                                                };
                                                                                if (($fr = (($fv = scanner).$scan || $mm('scan')).call($fv, /\=/)) !== false && $fr !== nil) {
                                                                                  this.lex_state = "expr_beg";
                                                                                  return ["OP_ASGN", result];
                                                                                };
                                                                                if (($fr = (($fx = (($fy = this.lex_state)['$=='] || $mm('==')).call($fy, "expr_cmdarg")), $fx !== false && $fx !== nil ? $fx : (($fz = this.lex_state)['$=='] || $mm('==')).call($fz, "expr_arg"))) !== false && $fr !== nil) {
                                                                                  if (($fr = ($fx = ($fx = (($ga = scanner).$check || $mm('check')).call($ga, /\s/), ($fx === nil || $fx === false)), $fx !== false && $fx !== nil ? space_seen : $fx)) !== false && $fr !== nil) {
                                                                                    this.lex_state = "expr_mid";
                                                                                    return [sign, sign];
                                                                                  }
                                                                                };
                                                                                this.lex_state = "expr_beg";
                                                                                return [result, result];
                                                                                } else {
                                                                                if (($fr = (($fx = scanner).$scan || $mm('scan')).call($fx, /\?/)) !== false && $fr !== nil) {
                                                                                  if (($fr = (($gb = ["expr_end", "expr_endarg", "expr_arg"])['$include?'] || $mm('include?')).call($gb, this.lex_state)) !== false && $fr !== nil) {
                                                                                    this.lex_state = "expr_beg";
                                                                                    return ["?", (($fr = scanner).$matched || $mm('matched')).call($fr)];
                                                                                  };
                                                                                  if (($gc = (($gd = scanner).$check || $mm('check')).call($gd, /\ |\t|\r/)) === false || $gc === nil) {
                                                                                    this.lex_state = "expr_end";
                                                                                    return ["STRING", (($gc = scanner).$scan || $mm('scan')).call($gc, /./)];
                                                                                  };
                                                                                  this.lex_state = "expr_beg";
                                                                                  return ["?", (($ge = scanner).$matched || $mm('matched')).call($ge)];
                                                                                  } else {
                                                                                  if (($gf = (($gg = scanner).$scan || $mm('scan')).call($gg, /\=\=\=/)) !== false && $gf !== nil) {
                                                                                    if ((($gf = this.lex_state)['$=='] || $mm('==')).call($gf, "expr_fname")) {
                                                                                      this.lex_state = "expr_end";
                                                                                      return ["===", "==="];
                                                                                    };
                                                                                    this.lex_state = "expr_beg";
                                                                                    return ["===", "==="];
                                                                                    } else {
                                                                                    if (($gh = (($gi = scanner).$scan || $mm('scan')).call($gi, /\=\=/)) !== false && $gh !== nil) {
                                                                                      if ((($gh = this.lex_state)['$=='] || $mm('==')).call($gh, "expr_fname")) {
                                                                                        this.lex_state = "expr_end";
                                                                                        return ["==", "=="];
                                                                                      };
                                                                                      this.lex_state = "expr_beg";
                                                                                      return ["==", "=="];
                                                                                      } else {
                                                                                      if (($gj = (($gk = scanner).$scan || $mm('scan')).call($gk, /\=\~/)) !== false && $gj !== nil) {
                                                                                        if ((($gj = this.lex_state)['$=='] || $mm('==')).call($gj, "expr_fname")) {
                                                                                          this.lex_state = "expr_end";
                                                                                          return ["=~", "=~"];
                                                                                        };
                                                                                        this.lex_state = "expr_beg";
                                                                                        return ["=~", "=~"];
                                                                                        } else {
                                                                                        if (($gl = (($gm = scanner).$scan || $mm('scan')).call($gm, /\=\>/)) !== false && $gl !== nil) {
                                                                                          this.lex_state = "expr_beg";
                                                                                          return ["=>", "=>"];
                                                                                          } else {
                                                                                          if (($gl = (($gn = scanner).$scan || $mm('scan')).call($gn, /\=/)) !== false && $gl !== nil) {
                                                                                            this.lex_state = "expr_beg";
                                                                                            return ["=", "="];
                                                                                            } else {
                                                                                            if (($gl = (($go = scanner).$scan || $mm('scan')).call($go, /\!\=/)) !== false && $gl !== nil) {
                                                                                              if ((($gl = this.lex_state)['$=='] || $mm('==')).call($gl, "expr_fname")) {
                                                                                                (($gp = this.lex_state)['$=='] || $mm('==')).call($gp, "expr_end");
                                                                                                return ["!=", "!="];
                                                                                              };
                                                                                              this.lex_state = "expr_beg";
                                                                                              return ["!=", "!="];
                                                                                              } else {
                                                                                              if (($gq = (($gr = scanner).$scan || $mm('scan')).call($gr, /\!\~/)) !== false && $gq !== nil) {
                                                                                                this.lex_state = "expr_beg";
                                                                                                return ["!~", "!~"];
                                                                                                } else {
                                                                                                if (($gq = (($gs = scanner).$scan || $mm('scan')).call($gs, /\!/)) !== false && $gq !== nil) {
                                                                                                  if ((($gq = this.lex_state)['$=='] || $mm('==')).call($gq, "expr_fname")) {
                                                                                                    this.lex_state = "expr_end";
                                                                                                    return ["!", "!"];
                                                                                                  };
                                                                                                  this.lex_state = "expr_beg";
                                                                                                  return ["!", "!"];
                                                                                                  } else {
                                                                                                  if (($gt = (($gu = scanner).$scan || $mm('scan')).call($gu, /\~/)) !== false && $gt !== nil) {
                                                                                                    if ((($gt = this.lex_state)['$=='] || $mm('==')).call($gt, "expr_fname")) {
                                                                                                      this.lex_state = "expr_end";
                                                                                                      return ["~", "~"];
                                                                                                    };
                                                                                                    this.lex_state = "expr_beg";
                                                                                                    return ["~", "~"];
                                                                                                    } else {
                                                                                                    if (($gv = (($gw = scanner).$check || $mm('check')).call($gw, /\$/)) !== false && $gv !== nil) {
                                                                                                      if (($gv = (($gx = scanner).$scan || $mm('scan')).call($gx, /\$([1-9]\d*)/)) !== false && $gv !== nil) {
                                                                                                        this.lex_state = "expr_end";
                                                                                                        return ["NTH_REF", (($gv = (($gy = scanner).$matched || $mm('matched')).call($gy)).$sub || $mm('sub')).call($gv, "$", "")];
                                                                                                        } else {
                                                                                                        if (($gz = (($ha = scanner).$scan || $mm('scan')).call($ha, /(\$_)(\w+)/)) !== false && $gz !== nil) {
                                                                                                          this.lex_state = "expr_end";
                                                                                                          return ["GVAR", (($gz = scanner).$matched || $mm('matched')).call($gz)];
                                                                                                          } else {
                                                                                                          if (($hb = (($hc = scanner).$scan || $mm('scan')).call($hc, /\$[\+\'\`\&!@\"~*$?\/\\:;=.,<>_]/)) !== false && $hb !== nil) {
                                                                                                            this.lex_state = "expr_end";
                                                                                                            return ["GVAR", (($hb = scanner).$matched || $mm('matched')).call($hb)];
                                                                                                            } else {
                                                                                                            if (($hd = (($he = scanner).$scan || $mm('scan')).call($he, /\$\w+/)) !== false && $hd !== nil) {
                                                                                                              this.lex_state = "expr_end";
                                                                                                              return ["GVAR", (($hd = scanner).$matched || $mm('matched')).call($hd)];
                                                                                                              } else {
                                                                                                              (($hf = this).$raise || $mm('raise')).call($hf, "Bad gvar name: " + ((($hg = (($hh = scanner).$peek || $mm('peek')).call($hh, 5)).$inspect || $mm('inspect')).call($hg)))
                                                                                                            }
                                                                                                          }
                                                                                                        }
                                                                                                      }
                                                                                                      } else {
                                                                                                      if (($hi = (($hj = scanner).$scan || $mm('scan')).call($hj, /\$\w+/)) !== false && $hi !== nil) {
                                                                                                        this.lex_state = "expr_end";
                                                                                                        return ["GVAR", (($hi = scanner).$matched || $mm('matched')).call($hi)];
                                                                                                        } else {
                                                                                                        if (($hk = (($hl = scanner).$scan || $mm('scan')).call($hl, /\@\@\w*/)) !== false && $hk !== nil) {
                                                                                                          this.lex_state = "expr_end";
                                                                                                          return ["CVAR", (($hk = scanner).$matched || $mm('matched')).call($hk)];
                                                                                                          } else {
                                                                                                          if (($hm = (($hn = scanner).$scan || $mm('scan')).call($hn, /\@\w*/)) !== false && $hm !== nil) {
                                                                                                            this.lex_state = "expr_end";
                                                                                                            return ["IVAR", (($hm = scanner).$matched || $mm('matched')).call($hm)];
                                                                                                            } else {
                                                                                                            if (($ho = (($hp = scanner).$scan || $mm('scan')).call($hp, /\,/)) !== false && $ho !== nil) {
                                                                                                              this.lex_state = "expr_beg";
                                                                                                              return [",", (($ho = scanner).$matched || $mm('matched')).call($ho)];
                                                                                                              } else {
                                                                                                              if (($hq = (($hr = scanner).$scan || $mm('scan')).call($hr, /\{/)) !== false && $hq !== nil) {
                                                                                                                if (($hq = this.start_of_lambda) !== false && $hq !== nil) {
                                                                                                                  this.start_of_lambda = false;
                                                                                                                  this.lex_state = "expr_beg";
                                                                                                                  return ["LAMBEG", (($hq = scanner).$matched || $mm('matched')).call($hq)];
                                                                                                                  } else {
                                                                                                                  if (($hs = (($ht = ["expr_end", "expr_arg", "expr_cmdarg"])['$include?'] || $mm('include?')).call($ht, this.lex_state)) !== false && $hs !== nil) {
                                                                                                                    result = "LCURLY"
                                                                                                                    } else {
                                                                                                                    if ((($hs = this.lex_state)['$=='] || $mm('==')).call($hs, "expr_endarg")) {
                                                                                                                      result = "LBRACE_ARG"
                                                                                                                      } else {
                                                                                                                      result = "{"
                                                                                                                    }
                                                                                                                  }
                                                                                                                };
                                                                                                                this.lex_state = "expr_beg";
                                                                                                                (($hu = this).$cond_push || $mm('cond_push')).call($hu, 0);
                                                                                                                (($hv = this).$cmdarg_push || $mm('cmdarg_push')).call($hv, 0);
                                                                                                                return [result, (($hw = scanner).$matched || $mm('matched')).call($hw)];
                                                                                                                } else {
                                                                                                                if (($hx = (($hy = scanner).$check || $mm('check')).call($hy, /[0-9]/)) !== false && $hx !== nil) {
                                                                                                                  this.lex_state = "expr_end";
                                                                                                                  if (($hx = (($hz = scanner).$scan || $mm('scan')).call($hz, /0b?(0|1|_)+/)) !== false && $hx !== nil) {
                                                                                                                    return ["INTEGER", (($hx = (($ia = scanner).$matched || $mm('matched')).call($ia)).$to_i || $mm('to_i')).call($hx, 2)]
                                                                                                                    } else {
                                                                                                                    if (($ib = (($ic = scanner).$scan || $mm('scan')).call($ic, /0o?([0-7]|_)+/)) !== false && $ib !== nil) {
                                                                                                                      return ["INTEGER", (($ib = (($id = scanner).$matched || $mm('matched')).call($id)).$to_i || $mm('to_i')).call($ib, 8)]
                                                                                                                      } else {
                                                                                                                      if (($ie = (($if = scanner).$scan || $mm('scan')).call($if, /[\d_]+\.[\d_]+\b|[\d_]+(\.[\d_]+)?[eE][-+]?[\d_]+\b/)) !== false && $ie !== nil) {
                                                                                                                        return ["FLOAT", (($ie = (($ig = (($ih = scanner).$matched || $mm('matched')).call($ih)).$gsub || $mm('gsub')).call($ig, /_/, "")).$to_f || $mm('to_f')).call($ie)]
                                                                                                                        } else {
                                                                                                                        if (($ii = (($ij = scanner).$scan || $mm('scan')).call($ij, /[\d_]+\b/)) !== false && $ii !== nil) {
                                                                                                                          return ["INTEGER", (($ii = (($ik = (($il = scanner).$matched || $mm('matched')).call($il)).$gsub || $mm('gsub')).call($ik, /_/, "")).$to_i || $mm('to_i')).call($ii)]
                                                                                                                          } else {
                                                                                                                          if (($im = (($in = scanner).$scan || $mm('scan')).call($in, /0(x|X)(\d|[a-f]|[A-F]|_)+/)) !== false && $im !== nil) {
                                                                                                                            return ["INTEGER", (($im = (($io = scanner).$matched || $mm('matched')).call($io)).$to_i || $mm('to_i')).call($im, 16)]
                                                                                                                            } else {
                                                                                                                            (($ip = this).$raise || $mm('raise')).call($ip, "Lexing error on numeric type: `" + ((($iq = scanner).$peek || $mm('peek')).call($iq, 5)) + "`")
                                                                                                                          }
                                                                                                                        }
                                                                                                                      }
                                                                                                                    }
                                                                                                                  };
                                                                                                                  } else {
                                                                                                                  if (($ir = (($is = scanner).$scan || $mm('scan')).call($is, /(\w)+[\?\!]?/)) !== false && $ir !== nil) {
                                                                                                                    matched = (($ir = scanner).$matched || $mm('matched')).call($ir);
                                                                                                                    if (($it = ($iu = ($iu = (($iv = (($iw = scanner).$peek || $mm('peek')).call($iw, 2))['$=='] || $mm('==')).call($iv, "::"), ($iu === nil || $iu === false)), $iu !== false && $iu !== nil ? (($iu = scanner).$scan || $mm('scan')).call($iu, /:/) : $iu)) !== false && $it !== nil) {
                                                                                                                      this.lex_state = "expr_beg";
                                                                                                                      return ["LABEL", "" + (matched)];
                                                                                                                    };
                                                                                                                    $case = matched;if ((($ix = "class")['$==='] || $mm('===')).call($ix, $case)) {
                                                                                                                    if ((($it = this.lex_state)['$=='] || $mm('==')).call($it, "expr_dot")) {
                                                                                                                      this.lex_state = "expr_end";
                                                                                                                      return ["IDENTIFIER", matched];
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_class";
                                                                                                                    return ["CLASS", matched];
                                                                                                                    }
                                                                                                                    else if ((($iz = "module")['$==='] || $mm('===')).call($iz, $case)) {
                                                                                                                    if ((($iy = this.lex_state)['$=='] || $mm('==')).call($iy, "expr_dot")) {
                                                                                                                      return ["IDENTIFIER", matched]
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_class";
                                                                                                                    return ["MODULE", matched];
                                                                                                                    }
                                                                                                                    else if ((($jb = "defined?")['$==='] || $mm('===')).call($jb, $case)) {
                                                                                                                    if ((($ja = this.lex_state)['$=='] || $mm('==')).call($ja, "expr_dot")) {
                                                                                                                      return ["IDENTIFIER", matched]
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_arg";
                                                                                                                    return ["DEFINED", "defined?"];
                                                                                                                    }
                                                                                                                    else if ((($jc = "def")['$==='] || $mm('===')).call($jc, $case)) {
                                                                                                                    this.lex_state = "expr_fname";
                                                                                                                    this.scope_line = this.line;
                                                                                                                    return ["DEF", matched];
                                                                                                                    }
                                                                                                                    else if ((($jd = "undef")['$==='] || $mm('===')).call($jd, $case)) {
                                                                                                                    this.lex_state = "expr_fname";
                                                                                                                    return ["UNDEF", matched];
                                                                                                                    }
                                                                                                                    else if ((($je = "end")['$==='] || $mm('===')).call($je, $case)) {
                                                                                                                    if (($je = (($jf = ["expr_dot", "expr_fname"])['$include?'] || $mm('include?')).call($jf, this.lex_state)) !== false && $je !== nil) {
                                                                                                                      this.lex_state = "expr_end";
                                                                                                                      return ["IDENTIFIER", matched];
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_end";
                                                                                                                    return ["END", matched];
                                                                                                                    }
                                                                                                                    else if ((($jk = "do")['$==='] || $mm('===')).call($jk, $case)) {
                                                                                                                    if (($jg = this.start_of_lambda) !== false && $jg !== nil) {
                                                                                                                      this.start_of_lambda = false;
                                                                                                                      this.lex_state = "expr_beg";
                                                                                                                      return ["DO_LAMBDA", (($jg = scanner).$matched || $mm('matched')).call($jg)];
                                                                                                                      } else {
                                                                                                                      if (($jh = (($ji = this)['$cond?'] || $mm('cond?')).call($ji)) !== false && $jh !== nil) {
                                                                                                                        this.lex_state = "expr_beg";
                                                                                                                        return ["DO_COND", matched];
                                                                                                                        } else {
                                                                                                                        if (($jh = ($jj = (($jj = this)['$cmdarg?'] || $mm('cmdarg?')).call($jj), $jj !== false && $jj !== nil ? ($jk = (($jl = this.lex_state)['$=='] || $mm('==')).call($jl, "expr_cmdarg"), ($jk === nil || $jk === false)) : $jj)) !== false && $jh !== nil) {
                                                                                                                          this.lex_state = "expr_beg";
                                                                                                                          return ["DO_BLOCK", matched];
                                                                                                                          } else {
                                                                                                                          if ((($jh = this.lex_state)['$=='] || $mm('==')).call($jh, "expr_endarg")) {
                                                                                                                            return ["DO_BLOCK", matched]
                                                                                                                            } else {
                                                                                                                            this.lex_state = "expr_beg";
                                                                                                                            return ["DO", matched];
                                                                                                                          }
                                                                                                                        }
                                                                                                                      }
                                                                                                                    }
                                                                                                                    }
                                                                                                                    else if ((($jn = "if")['$==='] || $mm('===')).call($jn, $case)) {
                                                                                                                    if ((($jm = this.lex_state)['$=='] || $mm('==')).call($jm, "expr_beg")) {
                                                                                                                      return ["IF", matched]
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["IF_MOD", matched];
                                                                                                                    }
                                                                                                                    else if ((($jp = "unless")['$==='] || $mm('===')).call($jp, $case)) {
                                                                                                                    if ((($jo = this.lex_state)['$=='] || $mm('==')).call($jo, "expr_beg")) {
                                                                                                                      return ["UNLESS", matched]
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["UNLESS_MOD", matched];
                                                                                                                    }
                                                                                                                    else if ((($jq = "else")['$==='] || $mm('===')).call($jq, $case)) {
                                                                                                                    return ["ELSE", matched]
                                                                                                                    }
                                                                                                                    else if ((($jr = "elsif")['$==='] || $mm('===')).call($jr, $case)) {
                                                                                                                    return ["ELSIF", matched]
                                                                                                                    }
                                                                                                                    else if ((($js = "self")['$==='] || $mm('===')).call($js, $case)) {
                                                                                                                    if (($js = (($jt = this.lex_state)['$=='] || $mm('==')).call($jt, "expr_fname")) === false || $js === nil) {
                                                                                                                      this.lex_state = "expr_end"
                                                                                                                    };
                                                                                                                    return ["SELF", matched];
                                                                                                                    }
                                                                                                                    else if ((($ju = "true")['$==='] || $mm('===')).call($ju, $case)) {
                                                                                                                    this.lex_state = "expr_end";
                                                                                                                    return ["TRUE", matched];
                                                                                                                    }
                                                                                                                    else if ((($jv = "false")['$==='] || $mm('===')).call($jv, $case)) {
                                                                                                                    this.lex_state = "expr_end";
                                                                                                                    return ["FALSE", matched];
                                                                                                                    }
                                                                                                                    else if ((($jw = "nil")['$==='] || $mm('===')).call($jw, $case)) {
                                                                                                                    this.lex_state = "expr_end";
                                                                                                                    return ["NIL", matched];
                                                                                                                    }
                                                                                                                    else if ((($jy = "__LINE__")['$==='] || $mm('===')).call($jy, $case)) {
                                                                                                                    this.lex_state = "expr_end";
                                                                                                                    return ["LINE", (($jx = this.line).$to_s || $mm('to_s')).call($jx)];
                                                                                                                    }
                                                                                                                    else if ((($jz = "__FILE__")['$==='] || $mm('===')).call($jz, $case)) {
                                                                                                                    this.lex_state = "expr_end";
                                                                                                                    return ["FILE", matched];
                                                                                                                    }
                                                                                                                    else if ((($ka = "begin")['$==='] || $mm('===')).call($ka, $case)) {
                                                                                                                    if (($ka = (($kb = ["expr_dot", "expr_fname"])['$include?'] || $mm('include?')).call($kb, this.lex_state)) !== false && $ka !== nil) {
                                                                                                                      this.lex_state = "expr_end";
                                                                                                                      return ["IDENTIFIER", matched];
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["BEGIN", matched];
                                                                                                                    }
                                                                                                                    else if ((($ke = "rescue")['$==='] || $mm('===')).call($ke, $case)) {
                                                                                                                    if (($kc = (($kd = ["expr_dot", "expr_fname"])['$include?'] || $mm('include?')).call($kd, this.lex_state)) !== false && $kc !== nil) {
                                                                                                                      return ["IDENTIFIER", matched]
                                                                                                                    };
                                                                                                                    if ((($kc = this.lex_state)['$=='] || $mm('==')).call($kc, "expr_beg")) {
                                                                                                                      this.lex_state = "expr_mid";
                                                                                                                      return ["RESCUE", matched];
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["RESCUE_MOD", matched];
                                                                                                                    }
                                                                                                                    else if ((($kf = "ensure")['$==='] || $mm('===')).call($kf, $case)) {
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["ENSURE", matched];
                                                                                                                    }
                                                                                                                    else if ((($kg = "case")['$==='] || $mm('===')).call($kg, $case)) {
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["CASE", matched];
                                                                                                                    }
                                                                                                                    else if ((($kh = "when")['$==='] || $mm('===')).call($kh, $case)) {
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["WHEN", matched];
                                                                                                                    }
                                                                                                                    else if ((($ki = "or")['$==='] || $mm('===')).call($ki, $case)) {
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["OR", matched];
                                                                                                                    }
                                                                                                                    else if ((($kj = "and")['$==='] || $mm('===')).call($kj, $case)) {
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["AND", matched];
                                                                                                                    }
                                                                                                                    else if ((($kk = "not")['$==='] || $mm('===')).call($kk, $case)) {
                                                                                                                    this.lex_state = "expr_arg";
                                                                                                                    return ["NOT", matched];
                                                                                                                    }
                                                                                                                    else if ((($kl = "return")['$==='] || $mm('===')).call($kl, $case)) {
                                                                                                                    this.lex_state = "expr_mid";
                                                                                                                    return ["RETURN", matched];
                                                                                                                    }
                                                                                                                    else if ((($km = "next")['$==='] || $mm('===')).call($km, $case)) {
                                                                                                                    if (($km = (($kn = (($ko = this.lex_state)['$=='] || $mm('==')).call($ko, "expr_dot")), $kn !== false && $kn !== nil ? $kn : (($kp = this.lex_state)['$=='] || $mm('==')).call($kp, "expr_fname"))) !== false && $km !== nil) {
                                                                                                                      this.lex_state = "expr_end";
                                                                                                                      return ["IDENTIFIER", matched];
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_mid";
                                                                                                                    return ["NEXT", matched];
                                                                                                                    }
                                                                                                                    else if ((($kn = "redo")['$==='] || $mm('===')).call($kn, $case)) {
                                                                                                                    if (($kn = (($kq = (($kr = this.lex_state)['$=='] || $mm('==')).call($kr, "expr_dot")), $kq !== false && $kq !== nil ? $kq : (($ks = this.lex_state)['$=='] || $mm('==')).call($ks, "expr_fname"))) !== false && $kn !== nil) {
                                                                                                                      this.lex_state = "expr_end";
                                                                                                                      return ["IDENTIFIER", matched];
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_mid";
                                                                                                                    return ["REDO", matched];
                                                                                                                    }
                                                                                                                    else if ((($kq = "break")['$==='] || $mm('===')).call($kq, $case)) {
                                                                                                                    this.lex_state = "expr_mid";
                                                                                                                    return ["BREAK", matched];
                                                                                                                    }
                                                                                                                    else if ((($kt = "super")['$==='] || $mm('===')).call($kt, $case)) {
                                                                                                                    this.lex_state = "expr_arg";
                                                                                                                    return ["SUPER", matched];
                                                                                                                    }
                                                                                                                    else if ((($ku = "then")['$==='] || $mm('===')).call($ku, $case)) {
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["THEN", matched];
                                                                                                                    }
                                                                                                                    else if ((($kw = "while")['$==='] || $mm('===')).call($kw, $case)) {
                                                                                                                    if ((($kv = this.lex_state)['$=='] || $mm('==')).call($kv, "expr_beg")) {
                                                                                                                      return ["WHILE", matched]
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["WHILE_MOD", matched];
                                                                                                                    }
                                                                                                                    else if ((($ky = "until")['$==='] || $mm('===')).call($ky, $case)) {
                                                                                                                    if ((($kx = this.lex_state)['$=='] || $mm('==')).call($kx, "expr_beg")) {
                                                                                                                      return ["UNTIL", matched]
                                                                                                                    };
                                                                                                                    this.lex_state = "expr_beg";
                                                                                                                    return ["UNTIL_MOD", matched];
                                                                                                                    }
                                                                                                                    else if ((($kz = "yield")['$==='] || $mm('===')).call($kz, $case)) {
                                                                                                                    this.lex_state = "expr_arg";
                                                                                                                    return ["YIELD", matched];
                                                                                                                    }
                                                                                                                    else if ((($la = "alias")['$==='] || $mm('===')).call($la, $case)) {
                                                                                                                    this.lex_state = "expr_fname";
                                                                                                                    return ["ALIAS", matched];
                                                                                                                    };
                                                                                                                    matched = matched;
                                                                                                                    if (($lb = ($lc = ($lc = (($ld = (($le = scanner).$peek || $mm('peek')).call($le, 2))['$=='] || $mm('==')).call($ld, "::"), ($lc === nil || $lc === false)), $lc !== false && $lc !== nil ? (($lc = scanner).$scan || $mm('scan')).call($lc, /\:/) : $lc)) !== false && $lb !== nil) {
                                                                                                                      return ["LABEL", matched]
                                                                                                                    };
                                                                                                                    if ((($lb = this.lex_state)['$=='] || $mm('==')).call($lb, "expr_fname")) {
                                                                                                                      if (($lf = (($lg = scanner).$scan || $mm('scan')).call($lg, /\=/)) !== false && $lf !== nil) {
                                                                                                                        this.lex_state = "expr_end";
                                                                                                                        return ["IDENTIFIER", ($lf = matched, $lh = (($li = scanner).$matched || $mm('matched')).call($li), typeof($lf) === 'number' ? $lf + $lh : $lf['$+']($lh))];
                                                                                                                      }
                                                                                                                    };
                                                                                                                    if (($lf = (($lh = ["expr_beg", "expr_dot", "expr_mid", "expr_arg", "expr_cmdarg"])['$include?'] || $mm('include?')).call($lh, this.lex_state)) !== false && $lf !== nil) {
                                                                                                                      this.lex_state = (function() { if (cmd_start !== false && cmd_start !== nil) {
                                                                                                                        return "expr_cmdarg"
                                                                                                                        } else {
                                                                                                                        return "expr_arg"
                                                                                                                      }; return nil; }).call(this)
                                                                                                                      } else {
                                                                                                                      this.lex_state = "expr_end"
                                                                                                                    };
                                                                                                                    return [(function() { if (($lf = (($lj = matched)['$=~'] || $mm('=~')).call($lj, /^[A-Z]/)) !== false && $lf !== nil) {
                                                                                                                      return "CONSTANT"
                                                                                                                      } else {
                                                                                                                      return "IDENTIFIER"
                                                                                                                    }; return nil; }).call(this), matched];
                                                                                                                  }
                                                                                                                }
                                                                                                              }
                                                                                                            }
                                                                                                          }
                                                                                                        }
                                                                                                      }
                                                                                                    }
                                                                                                  }
                                                                                                }
                                                                                              }
                                                                                            }
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                    }
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        };
        if (($lf = (($lk = scanner)['$eos?'] || $mm('eos?')).call($lk)) !== false && $lf !== nil) {
          return [false, false]
        };
        (($lf = this).$raise || $mm('raise')).call($lf, "Unexpected content in parsing stream `" + ((($ll = scanner).$peek || $mm('peek')).call($ll, 5)) + "` :" + (this.file) + ":" + (this.line));};
      };

      return nil;
    })(Opal, (($a = ((($b = __scope.Racc) == null ? __opal.cm("Racc") : $b))._scope).Parser == null ? $a.cm("Parser") : $a.Parser))
    
  })(self);
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass, __hash2 = __opal.hash2, __range = __opal.range;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope;

    (function(__base, __super){
      function Parser() {};
      Parser = __klass(__base, __super, "Parser", Parser);

      var def = Parser.prototype, __scope = Parser._scope, TMP_4, TMP_6, TMP_7, TMP_8, TMP_33, $a, $b;
      def.requires = def.result = def.sexp = def.file = def.line = def.indent = def.unique = def.scope = def.optimized_operators = def.helpers = def.method_missing = def.dynamic_require_severity = def.arity_check = def.const_missing = def.while_loop = def.space = nil;

      __scope.INDENT = "  ";

      __scope.LEVEL = ["stmt", "stmt_closure", "list", "expr", "recv"];

      __scope.COMPARE = ["<", ">", "<=", ">="];

      __scope.RESERVED = ["break", "case", "catch", "continue", "debugger", "default", "delete", "do", "else", "finally", "for", "function", "if", "in", "instanceof", "new", "return", "switch", "this", "throw", "try", "typeof", "var", "let", "void", "while", "with", "class", "enum", "export", "extends", "import", "super", "true", "false", "native", "const", "static"];

      __scope.STATEMENTS = ["xstr", "dxstr"];

      def.$requires = function() {
        
        return this.requires
      }, nil;

      def.$result = function() {
        
        return this.result
      }, nil;

      def.$parse = function(source, options) {
        var $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;if (options == null) {
          options = __hash2([], {})
        }
        this.sexp = (($a = (($b = (($c = __scope.Grammar) == null ? __opal.cm("Grammar") : $c)).$new || $mm('new')).call($b)).$parse || $mm('parse')).call($a, source, (($c = options)['$[]'] || $mm('[]')).call($c, "file"));
        this.requires = [];
        this.line = 1;
        this.indent = "";
        this.unique = 0;
        this.helpers = __hash2(["breaker", "slice"], {"breaker": true, "slice": true});
        this.file = (($d = (($e = options)['$[]'] || $mm('[]')).call($e, "file")), $d !== false && $d !== nil ? $d : "(file)");
        this.method_missing = ($d = (($f = (($g = options)['$[]'] || $mm('[]')).call($g, "method_missing"))['$=='] || $mm('==')).call($f, false), ($d === nil || $d === false));
        this.optimized_operators = ($d = (($h = (($i = options)['$[]'] || $mm('[]')).call($i, "optimized_operators"))['$=='] || $mm('==')).call($h, false), ($d === nil || $d === false));
        this.arity_check = (($d = options)['$[]'] || $mm('[]')).call($d, "arity_check");
        this.const_missing = ($j = (($k = (($l = options)['$[]'] || $mm('[]')).call($l, "const_missing"))['$=='] || $mm('==')).call($k, false), ($j === nil || $j === false));
        this.dynamic_require_severity = (($j = (($m = options)['$[]'] || $mm('[]')).call($m, "dynamic_require_severity")), $j !== false && $j !== nil ? $j : "error");
        return this.result = (($j = this).$top || $mm('top')).call($j, this.sexp);
      };

      def.$error = function(msg) {
        var $a, $b;
        return (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.SyntaxError) == null ? __opal.cm("SyntaxError") : $b), "" + (msg) + " :" + (this.file) + ":" + (this.line));
      };

      def.$warning = function(msg) {
        var $a;
        return (($a = this).$warn || $mm('warn')).call($a, "" + (msg) + " :" + (this.file) + ":" + (this.line));
      };

      def.$parser_indent = function() {
        
        return this.indent;
      };

      def.$s = function(parts) {
        var sexp = nil, $a, $b;parts = __slice.call(arguments, 0);
        sexp = (($a = (($b = __scope.Array) == null ? __opal.cm("Array") : $b)).$new || $mm('new')).call($a, parts);
        (($b = sexp)['$line='] || $mm('line=')).call($b, this.line);
        return sexp;
      };

      def.$mid_to_jsid = function(mid) {
        var $a, $b, $c, $d;
        if (($a = (($b = /\=|\+|\-|\*|\/|\!|\?|\<|\>|\&|\||\^|\%|\~|\[/)['$=~'] || $mm('=~')).call($b, (($c = mid).$to_s || $mm('to_s')).call($c))) !== false && $a !== nil) {
          return "['$" + (mid) + "']"
          } else {
          return ($a = ".$", $d = mid, typeof($a) === 'number' ? $a + $d : $a['$+']($d))
        };
      };

      def.$unique_temp = function() {
        var $a;
        return "TMP_" + (this.unique = (($a = this.unique)['$+'] || $mm('+')).call($a, 1));
      };

      def.$top = function(sexp, options) {
        var code = nil, TMP_1, $a, $b;if (options == null) {
          options = __hash2([], {})
        }
        code = nil;
        ($a = (($b = this).$in_scope || $mm('in_scope')), $a._p = (TMP_1 = function() {

          var self = TMP_1._s || this, TMP_2, $a, $b, $c, $d, $e, $f, $g, $h, TMP_3, $i, $j, $k, $l, $m, $n, $o, $p, $q;
          if (self.scope == null) self.scope = nil;
          if (self.helpers == null) self.helpers = nil;

          
          ($a = (($b = self).$indent || $mm('indent')), $a._p = (TMP_2 = function() {

            var self = TMP_2._s || this, $a, $b, $c, $d;
            if (self.indent == null) self.indent = nil;

            
            return code = ($a = self.indent, $b = (($c = self).$process || $mm('process')).call($c, (($d = self).$s || $mm('s')).call($d, "scope", sexp), "stmt"), typeof($a) === 'number' ? $a + $b : $a['$+']($b))
          }, TMP_2._s = self, TMP_2), $a).call($b);
          (($a = self.scope).$add_temp || $mm('add_temp')).call($a, "self = __opal.top");
          (($c = self.scope).$add_temp || $mm('add_temp')).call($c, "__scope = __opal");
          (($d = self.scope).$add_temp || $mm('add_temp')).call($d, "nil = __opal.nil");
          (($e = self.scope).$add_temp || $mm('add_temp')).call($e, "$mm = __opal.mm");
          if (($f = (($g = self.scope).$defines_defn || $mm('defines_defn')).call($g)) !== false && $f !== nil) {
            (($f = self.scope).$add_temp || $mm('add_temp')).call($f, "def = " + ((($h = self).$current_self || $mm('current_self')).call($h)) + "._klass.prototype")
          };
          ($i = (($j = (($k = self.helpers).$keys || $mm('keys')).call($k)).$each || $mm('each')), $i._p = (TMP_3 = function(h) {

            var self = TMP_3._s || this, $a;
            if (self.scope == null) self.scope = nil;

            if (h == null) h = nil;

            return (($a = self.scope).$add_temp || $mm('add_temp')).call($a, "__" + (h) + " = __opal." + (h))
          }, TMP_3._s = self, TMP_3), $i).call($j);
          return code = ($i = ($m = ($o = (($q = __scope.INDENT) == null ? __opal.cm("INDENT") : $q), $p = (($q = self.scope).$to_vars || $mm('to_vars')).call($q), typeof($o) === 'number' ? $o + $p : $o['$+']($p)), $n = "\n", typeof($m) === 'number' ? $m + $n : $m['$+']($n)), $l = code, typeof($i) === 'number' ? $i + $l : $i['$+']($l));
        }, TMP_1._s = this, TMP_1), $a).call($b, "top");
        return "(function(__opal) {\n" + (code) + "\n})(Opal);\n";
      };

      def.$in_scope = TMP_4 = function(type) {
        var parent = nil, TMP_5, $a, $b, $c, $d, __yield;
        __yield = TMP_4._p || nil, TMP_4._p = null;
        
        if (__yield === nil) {
          return nil
        };
        parent = this.scope;
        this.scope = ($a = (($b = (($c = (($d = __scope.TargetScope) == null ? __opal.cm("TargetScope") : $d)).$new || $mm('new')).call($c, type, this)).$tap || $mm('tap')), $a._p = (TMP_5 = function(s) {

          var self = TMP_5._s || this, $a;
          if (s == null) s = nil;

          return (($a = s)['$parent='] || $mm('parent=')).call($a, parent)
        }, TMP_5._s = this, TMP_5), $a).call($b);
        if (__yield.call(null, this.scope) === __breaker) return __breaker.$v;
        return this.scope = parent;
      };

      def.$indent = TMP_6 = function() {
        var indent = nil, res = nil, $a, $b, block;
        block = TMP_6._p || nil, TMP_6._p = null;
        
        indent = this.indent;
        this.indent = (($a = this.indent)['$+'] || $mm('+')).call($a, (($b = __scope.INDENT) == null ? __opal.cm("INDENT") : $b));
        this.space = "\n" + (this.indent);
        res = ((($b = block.call(null)) === __breaker) ? __breaker.$v : $b);
        this.indent = indent;
        this.space = "\n" + (this.indent);
        return res;
      };

      def.$with_temp = TMP_7 = function() {
        var tmp = nil, res = nil, $a, $b, block;
        block = TMP_7._p || nil, TMP_7._p = null;
        
        tmp = (($a = this.scope).$new_temp || $mm('new_temp')).call($a);
        res = ((($b = block.call(null, tmp)) === __breaker) ? __breaker.$v : $b);
        (($b = this.scope).$queue_temp || $mm('queue_temp')).call($b, tmp);
        return res;
      };

      def.$in_while = TMP_8 = function() {
        var result = nil, $a, $b, __yield;
        __yield = TMP_8._p || nil, TMP_8._p = null;
        
        if (__yield === nil) {
          return nil
        };
        this.while_loop = (($a = this.scope).$push_while || $mm('push_while')).call($a);
        result = ((($b = __yield.call(null)) === __breaker) ? __breaker.$v : $b);
        (($b = this.scope).$pop_while || $mm('pop_while')).call($b);
        return result;
      };

      def['$in_while?'] = function() {
        var $a;
        return (($a = this.scope)['$in_while?'] || $mm('in_while?')).call($a);
      };

      def.$process = function(sexp, level) {
        var type = nil, meth = nil, $a, $b, $c, $d, $e;
        type = (($a = sexp).$shift || $mm('shift')).call($a);
        meth = "process_" + (type);
        if (($b = (($c = this)['$respond_to?'] || $mm('respond_to?')).call($c, meth)) === false || $b === nil) {
          (($b = this).$raise || $mm('raise')).call($b, "Unsupported sexp: " + (type))
        };
        this.line = (($d = sexp).$line || $mm('line')).call($d);
        return (($e = this).$__send__ || $mm('__send__')).call($e, meth, sexp, level);
      };

      def.$returns = function(sexp) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay, $az, $ba, TMP_9, $bb, $bc, $bd;
        if (($a = sexp) === false || $a === nil) {
          return (($a = this).$returns || $mm('returns')).call($a, (($b = this).$s || $mm('s')).call($b, "nil"))
        };
        return (function() { $case = (($c = sexp).$first || $mm('first')).call($c);if ((($d = "break")['$==='] || $mm('===')).call($d, $case) || (($e = "next")['$==='] || $mm('===')).call($e, $case)) {
        return sexp
        }
        else if ((($g = "yield")['$==='] || $mm('===')).call($g, $case)) {
        (($f = sexp)['$[]='] || $mm('[]=')).call($f, 0, "returnable_yield");
        return sexp;
        }
        else if ((($k = "scope")['$==='] || $mm('===')).call($k, $case)) {
        (($h = sexp)['$[]='] || $mm('[]=')).call($h, 1, (($i = this).$returns || $mm('returns')).call($i, (($j = sexp)['$[]'] || $mm('[]')).call($j, 1)));
        return sexp;
        }
        else if ((($t = "block")['$==='] || $mm('===')).call($t, $case)) {
        if ((($l = (($m = sexp).$length || $mm('length')).call($m))['$>'] || $mm('>')).call($l, 1)) {
          (($n = sexp)['$[]='] || $mm('[]=')).call($n, -1, (($o = this).$returns || $mm('returns')).call($o, (($p = sexp)['$[]'] || $mm('[]')).call($p, -1)))
          } else {
          (($q = sexp)['$<<'] || $mm('<<')).call($q, (($r = this).$returns || $mm('returns')).call($r, (($s = this).$s || $mm('s')).call($s, "nil")))
        };
        return sexp;
        }
        else if ((($x = "when")['$==='] || $mm('===')).call($x, $case)) {
        (($u = sexp)['$[]='] || $mm('[]=')).call($u, 2, (($v = this).$returns || $mm('returns')).call($v, (($w = sexp)['$[]'] || $mm('[]')).call($w, 2)));
        return sexp;
        }
        else if ((($ab = "rescue")['$==='] || $mm('===')).call($ab, $case)) {
        (($y = sexp)['$[]='] || $mm('[]=')).call($y, 1, (($z = this).$returns || $mm('returns')).call($z, (($aa = sexp)['$[]'] || $mm('[]')).call($aa, 1)));
        return sexp;
        }
        else if ((($af = "ensure")['$==='] || $mm('===')).call($af, $case)) {
        (($ac = sexp)['$[]='] || $mm('[]=')).call($ac, 1, (($ad = this).$returns || $mm('returns')).call($ad, (($ae = sexp)['$[]'] || $mm('[]')).call($ae, 1)));
        return sexp;
        }
        else if ((($ag = "while")['$==='] || $mm('===')).call($ag, $case)) {
        return sexp
        }
        else if ((($ah = "return")['$==='] || $mm('===')).call($ah, $case)) {
        return sexp
        }
        else if ((($am = "xstr")['$==='] || $mm('===')).call($am, $case)) {
        if (($ai = (($aj = /return|;/)['$=~'] || $mm('=~')).call($aj, (($ak = sexp)['$[]'] || $mm('[]')).call($ak, 1))) === false || $ai === nil) {
          (($ai = sexp)['$[]='] || $mm('[]=')).call($ai, 1, "return " + ((($al = sexp)['$[]'] || $mm('[]')).call($al, 1)) + ";")
        };
        return sexp;
        }
        else if ((($ar = "dxstr")['$==='] || $mm('===')).call($ar, $case)) {
        if (($an = (($ao = /return|;|\n/)['$=~'] || $mm('=~')).call($ao, (($ap = sexp)['$[]'] || $mm('[]')).call($ap, 1))) === false || $an === nil) {
          (($an = sexp)['$[]='] || $mm('[]=')).call($an, 1, "return " + ((($aq = sexp)['$[]'] || $mm('[]')).call($aq, 1)))
        };
        return sexp;
        }
        else if ((($ay = "if")['$==='] || $mm('===')).call($ay, $case)) {
        (($as = sexp)['$[]='] || $mm('[]=')).call($as, 2, (($at = this).$returns || $mm('returns')).call($at, (($au = (($av = sexp)['$[]'] || $mm('[]')).call($av, 2)), $au !== false && $au !== nil ? $au : (($aw = this).$s || $mm('s')).call($aw, "nil"))));
        (($au = sexp)['$[]='] || $mm('[]=')).call($au, 3, (($ax = this).$returns || $mm('returns')).call($ax, (($ay = (($az = sexp)['$[]'] || $mm('[]')).call($az, 3)), $ay !== false && $ay !== nil ? $ay : (($ba = this).$s || $mm('s')).call($ba, "nil"))));
        return sexp;
        }
        else {return ($bb = (($bc = (($bd = this).$s || $mm('s')).call($bd, "js_return", sexp)).$tap || $mm('tap')), $bb._p = (TMP_9 = function(s) {

          var self = TMP_9._s || this, $a, $b;
          if (s == null) s = nil;

          return (($a = s)['$line='] || $mm('line=')).call($a, (($b = sexp).$line || $mm('line')).call($b))
        }, TMP_9._s = this, TMP_9), $bb).call($bc)} }).call(this);
      };

      def['$expression?'] = function(sexp) {
        var $a, $b, $c;
        return ($a = (($b = (($c = __scope.STATEMENTS) == null ? __opal.cm("STATEMENTS") : $c))['$include?'] || $mm('include?')).call($b, (($c = sexp).$first || $mm('first')).call($c)), ($a === nil || $a === false));
      };

      def.$process_block = function(sexp, level) {
        var result = nil, stmt = nil, type = nil, yasgn = nil, expr = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s;
        result = [];
        if (($a = (($b = sexp)['$empty?'] || $mm('empty?')).call($b)) !== false && $a !== nil) {
          (($a = sexp)['$<<'] || $mm('<<')).call($a, (($c = this).$s || $mm('s')).call($c, "nil"))
        };
        while (!(($e = (($f = sexp)['$empty?'] || $mm('empty?')).call($f)) !== false && $e !== nil)) {stmt = (($e = sexp).$shift || $mm('shift')).call($e);
        type = (($g = stmt).$first || $mm('first')).call($g);
        if (($h = yasgn = (($i = this).$find_inline_yield || $mm('find_inline_yield')).call($i, stmt)) !== false && $h !== nil) {
          (($h = result)['$<<'] || $mm('<<')).call($h, "" + ((($j = this).$process || $mm('process')).call($j, yasgn, level)) + ";")
        };
        ($k = expr = (($k = this)['$expression?'] || $mm('expression?')).call($k, stmt), $k !== false && $k !== nil ? (($l = (($m = (($n = __scope.LEVEL) == null ? __opal.cm("LEVEL") : $n)).$index || $mm('index')).call($m, level))['$<'] || $mm('<')).call($l, (($n = (($o = __scope.LEVEL) == null ? __opal.cm("LEVEL") : $o)).$index || $mm('index')).call($n, "list")) : $k);
        code = (($o = this).$process || $mm('process')).call($o, stmt, level);
        if (($p = (($q = code)['$=='] || $mm('==')).call($q, "")) === false || $p === nil) {
          (($p = result)['$<<'] || $mm('<<')).call($p, (function() { if (expr !== false && expr !== nil) {
            return "" + (code) + ";"
            } else {
            return code
          }; return nil; }).call(this))
        };};
        return (($d = result).$join || $mm('join')).call($d, (function() { if (($r = (($s = this.scope)['$class_scope?'] || $mm('class_scope?')).call($s)) !== false && $r !== nil) {
          return "\n\n" + (this.indent)
          } else {
          return "\n" + (this.indent)
        }; return nil; }).call(this));
      };

      def.$find_inline_yield = function(stmt) {
        var found = nil, $case = nil, arglist = nil, $a, $b, $c, $d, TMP_10, $e, $f, $g, $h, TMP_11, $i, $j, $k, $l, $m, $n;
        found = nil;
        $case = (($a = stmt).$first || $mm('first')).call($a);if ((($d = "js_return")['$==='] || $mm('===')).call($d, $case)) {
        found = (($b = this).$find_inline_yield || $mm('find_inline_yield')).call($b, (($c = stmt)['$[]'] || $mm('[]')).call($c, 1))
        }
        else if ((($e = "array")['$==='] || $mm('===')).call($e, $case)) {
        ($e = (($f = (($g = stmt)['$[]'] || $mm('[]')).call($g, __range(1, -1, false))).$each_with_index || $mm('each_with_index')), $e._p = (TMP_10 = function(el, idx) {

          var self = TMP_10._s || this, $a, $b, $c, $d, $e;
          if (el == null) el = nil;
if (idx == null) idx = nil;

          if ((($a = (($b = el).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "yield")) {
            found = el;
            return (($c = stmt)['$[]='] || $mm('[]=')).call($c, ($d = idx, $e = 1, typeof($d) === 'number' ? $d + $e : $d['$+']($e)), (($d = self).$s || $mm('s')).call($d, "js_tmp", "__yielded"));
            } else {
            return nil
          }
        }, TMP_10._s = this, TMP_10), $e).call($f)
        }
        else if ((($i = "call")['$==='] || $mm('===')).call($i, $case)) {
        arglist = (($h = stmt)['$[]'] || $mm('[]')).call($h, 3);
        ($i = (($j = (($k = arglist)['$[]'] || $mm('[]')).call($k, __range(1, -1, false))).$each_with_index || $mm('each_with_index')), $i._p = (TMP_11 = function(el, idx) {

          var self = TMP_11._s || this, $a, $b, $c, $d, $e;
          if (el == null) el = nil;
if (idx == null) idx = nil;

          if ((($a = (($b = el).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "yield")) {
            found = el;
            return (($c = arglist)['$[]='] || $mm('[]=')).call($c, ($d = idx, $e = 1, typeof($d) === 'number' ? $d + $e : $d['$+']($e)), (($d = self).$s || $mm('s')).call($d, "js_tmp", "__yielded"));
            } else {
            return nil
          }
        }, TMP_11._s = this, TMP_11), $i).call($j);
        };
        if (found !== false && found !== nil) {
          if (($l = (($m = this.scope)['$has_temp?'] || $mm('has_temp?')).call($m, "__yielded")) === false || $l === nil) {
            (($l = this.scope).$add_temp || $mm('add_temp')).call($l, "__yielded")
          };
          return (($n = this).$s || $mm('s')).call($n, "yasgn", "__yielded", found);
          } else {
          return nil
        };
      };

      def.$process_scope = function(sexp, level) {
        var stmt = nil, code = nil, $a, $b, $c, $d;
        stmt = (($a = sexp).$shift || $mm('shift')).call($a);
        if (stmt !== false && stmt !== nil) {
          if (($b = (($c = this.scope)['$class_scope?'] || $mm('class_scope?')).call($c)) === false || $b === nil) {
            stmt = (($b = this).$returns || $mm('returns')).call($b, stmt)
          };
          code = (($d = this).$process || $mm('process')).call($d, stmt, "stmt");
          } else {
          code = "nil"
        };
        return code;
      };

      def.$process_js_return = function(sexp, level) {
        var $a, $b;
        return "return " + ((($a = this).$process || $mm('process')).call($a, (($b = sexp).$shift || $mm('shift')).call($b), "expr"));
      };

      def.$process_js_tmp = function(sexp, level) {
        var $a, $b;
        return (($a = (($b = sexp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
      };

      def.$process_operator = function(sexp, level) {
        var meth = nil, recv = nil, arg = nil, mid = nil, $a, $b, $c, TMP_12, $d, $e;
        (($a = sexp)._isArray ? $a : ($a = [$a])), meth = ($a[0] == null ? nil : $a[0]), recv = ($a[1] == null ? nil : $a[1]), arg = ($a[2] == null ? nil : $a[2]);
        mid = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = meth).$to_s || $mm('to_s')).call($b));
        if (($c = this.optimized_operators) !== false && $c !== nil) {
          return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_12 = function(a) {

            var self = TMP_12._s || this, TMP_13, $a, $b;
            if (a == null) a = nil;

            return ($a = (($b = self).$with_temp || $mm('with_temp')), $a._p = (TMP_13 = function(b) {

              var l = nil, r = nil, self = TMP_13._s || this, $a, $b, $c, $d;
              if (b == null) b = nil;

              l = (($a = self).$process || $mm('process')).call($a, recv, "expr");
              r = (($b = self).$process || $mm('process')).call($b, arg, "expr");
              return (($c = "(%s = %s, %s = %s, typeof(%s) === 'number' ? %s %s %s : %s%s(%s))")['$%'] || $mm('%')).call($c, [a, l, b, r, a, a, (($d = meth).$to_s || $mm('to_s')).call($d), b, a, mid, b]);
            }, TMP_13._s = self, TMP_13), $a).call($b)
          }, TMP_12._s = this, TMP_12), $c).call($d)
          } else {
          return "" + ((($c = this).$process || $mm('process')).call($c, recv, "recv")) + (mid) + "(" + ((($e = this).$process || $mm('process')).call($e, arg, "expr")) + ")"
        };
      };

      def.$js_block_given = function(sexp, level) {
        var $a, $b, $c;
        (($a = this.scope)['$uses_block!'] || $mm('uses_block!')).call($a);
        if (($b = (($c = this.scope).$block_name || $mm('block_name')).call($c)) !== false && $b !== nil) {
          return "(" + ((($b = this.scope).$block_name || $mm('block_name')).call($b)) + " !== nil)"
          } else {
          return "false"
        };
      };

      def.$handle_block_given = function(sexp, reverse) {
        var name = nil, $a, $b;if (reverse == null) {
          reverse = false
        }
        (($a = this.scope)['$uses_block!'] || $mm('uses_block!')).call($a);
        name = (($b = this.scope).$block_name || $mm('block_name')).call($b);
        if (reverse !== false && reverse !== nil) {
          return "" + (name) + " === nil"
          } else {
          return "" + (name) + " !== nil"
        };
      };

      def.$process_lit = function(sexp, level) {
        var val = nil, $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s;
        val = (($a = sexp).$shift || $mm('shift')).call($a);
        return (function() { $case = val;if ((($e = (($f = __scope.Numeric) == null ? __opal.cm("Numeric") : $f))['$==='] || $mm('===')).call($e, $case)) {
        if ((($b = level)['$=='] || $mm('==')).call($b, "recv")) {
          return "(" + ((($c = val).$inspect || $mm('inspect')).call($c)) + ")"
          } else {
          return (($d = val).$inspect || $mm('inspect')).call($d)
        }
        }
        else if ((($h = (($i = __scope.Symbol) == null ? __opal.cm("Symbol") : $i))['$==='] || $mm('===')).call($h, $case)) {
        return (($f = (($g = val).$to_s || $mm('to_s')).call($g)).$inspect || $mm('inspect')).call($f)
        }
        else if ((($l = (($m = __scope.Regexp) == null ? __opal.cm("Regexp") : $m))['$==='] || $mm('===')).call($l, $case)) {
        if ((($i = val)['$=='] || $mm('==')).call($i, /^/)) {
          return (($j = /^/).$inspect || $mm('inspect')).call($j)
          } else {
          return (($k = val).$inspect || $mm('inspect')).call($k)
        }
        }
        else if ((($q = (($r = __scope.Range) == null ? __opal.cm("Range") : $r))['$==='] || $mm('===')).call($q, $case)) {
        (($m = this.helpers)['$[]='] || $mm('[]=')).call($m, "range", true);
        return "__range(" + ((($n = val).$begin || $mm('begin')).call($n)) + ", " + ((($o = val).$end || $mm('end')).call($o)) + ", " + ((($p = val)['$exclude_end?'] || $mm('exclude_end?')).call($p)) + ")";
        }
        else {return (($r = this).$raise || $mm('raise')).call($r, "Bad lit: " + ((($s = val).$inspect || $mm('inspect')).call($s)))} }).call(this);
      };

      def.$process_dregx = function(sexp, level) {
        var parts = nil, TMP_14, $a, $b;
        parts = ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_14 = function(part) {

          var self = TMP_14._s || this, $a, $b, $c, $d, $e, $f, $g;
          if (part == null) part = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, part)) !== false && $a !== nil) {
            return (($a = part).$inspect || $mm('inspect')).call($a)
            } else {
            if ((($c = (($d = part)['$[]'] || $mm('[]')).call($d, 0))['$=='] || $mm('==')).call($c, "str")) {
              return (($e = self).$process || $mm('process')).call($e, part, "expr")
              } else {
              return (($f = self).$process || $mm('process')).call($f, (($g = part)['$[]'] || $mm('[]')).call($g, 1), "expr")
            }
          }
        }, TMP_14._s = this, TMP_14), $a).call($b);
        return "(new RegExp(" + ((($a = parts).$join || $mm('join')).call($a, " + ")) + "))";
      };

      def.$process_dot2 = function(sexp, level) {
        var lhs = nil, rhs = nil, $a, $b, $c, $d, $e, $f;
        lhs = (($a = this).$process || $mm('process')).call($a, (($b = sexp)['$[]'] || $mm('[]')).call($b, 0), "expr");
        rhs = (($c = this).$process || $mm('process')).call($c, (($d = sexp)['$[]'] || $mm('[]')).call($d, 1), "expr");
        (($e = this.helpers)['$[]='] || $mm('[]=')).call($e, "range", true);
        return (($f = "__range(%s, %s, false)")['$%'] || $mm('%')).call($f, [lhs, rhs]);
      };

      def.$process_dot3 = function(sexp, level) {
        var lhs = nil, rhs = nil, $a, $b, $c, $d, $e, $f;
        lhs = (($a = this).$process || $mm('process')).call($a, (($b = sexp)['$[]'] || $mm('[]')).call($b, 0), "expr");
        rhs = (($c = this).$process || $mm('process')).call($c, (($d = sexp)['$[]'] || $mm('[]')).call($d, 1), "expr");
        (($e = this.helpers)['$[]='] || $mm('[]=')).call($e, "range", true);
        return (($f = "__range(%s, %s, true)")['$%'] || $mm('%')).call($f, [lhs, rhs]);
      };

      def.$process_str = function(sexp, level) {
        var str = nil, $a, $b, $c, $d;
        str = (($a = sexp).$shift || $mm('shift')).call($a);
        if ((($b = str)['$=='] || $mm('==')).call($b, this.file)) {
          this.uses_file = true;
          return (($c = this.file).$inspect || $mm('inspect')).call($c);
          } else {
          return (($d = str).$inspect || $mm('inspect')).call($d)
        };
      };

      def.$process_defined = function(sexp, level) {
        var part = nil, $case = nil, mid = nil, recv = nil, ivar_name = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, TMP_15, $ab, $ac, $ad, $ae;
        part = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        return (function() { $case = (($b = part)['$[]'] || $mm('[]')).call($b, 0);if ((($d = "self")['$==='] || $mm('===')).call($d, $case)) {
        return (($c = "self").$inspect || $mm('inspect')).call($c)
        }
        else if ((($f = "nil")['$==='] || $mm('===')).call($f, $case)) {
        return (($e = "nil").$inspect || $mm('inspect')).call($e)
        }
        else if ((($h = "true")['$==='] || $mm('===')).call($h, $case)) {
        return (($g = "true").$inspect || $mm('inspect')).call($g)
        }
        else if ((($j = "false")['$==='] || $mm('===')).call($j, $case)) {
        return (($i = "false").$inspect || $mm('inspect')).call($i)
        }
        else if ((($r = "call")['$==='] || $mm('===')).call($r, $case)) {
        mid = (($k = this).$mid_to_jsid || $mm('mid_to_jsid')).call($k, (($l = (($m = part)['$[]'] || $mm('[]')).call($m, 2)).$to_s || $mm('to_s')).call($l));
        recv = (function() { if (($n = (($o = part)['$[]'] || $mm('[]')).call($o, 1)) !== false && $n !== nil) {
          return (($n = this).$process || $mm('process')).call($n, (($p = part)['$[]'] || $mm('[]')).call($p, 1), "expr")
          } else {
          return (($q = this).$current_self || $mm('current_self')).call($q)
        }; return nil; }).call(this);
        return "(" + (recv) + (mid) + " ? 'method' : nil)";
        }
        else if ((($t = "xstr")['$==='] || $mm('===')).call($t, $case)) {
        return "(typeof(" + ((($s = this).$process || $mm('process')).call($s, part, "expression")) + ") !== 'undefined')"
        }
        else if ((($w = "const")['$==='] || $mm('===')).call($w, $case)) {
        return "(__scope." + ((($u = (($v = part)['$[]'] || $mm('[]')).call($v, 1)).$to_s || $mm('to_s')).call($u)) + " != null)"
        }
        else if ((($x = "colon2")['$==='] || $mm('===')).call($x, $case)) {
        return "false"
        }
        else if ((($ab = "ivar")['$==='] || $mm('===')).call($ab, $case)) {
        ivar_name = (($y = (($z = (($aa = part)['$[]'] || $mm('[]')).call($aa, 1)).$to_s || $mm('to_s')).call($z))['$[]'] || $mm('[]')).call($y, __range(1, -1, false));
        return ($ab = (($ac = this).$with_temp || $mm('with_temp')), $ab._p = (TMP_15 = function(t) {

          var self = TMP_15._s || this, $a, $b;
          if (t == null) t = nil;

          return "((" + (t) + " = " + ((($a = self).$current_self || $mm('current_self')).call($a)) + "[" + ((($b = ivar_name).$inspect || $mm('inspect')).call($b)) + "], " + (t) + " != null && " + (t) + " !== nil) ? 'instance-variable' : nil)"
        }, TMP_15._s = this, TMP_15), $ab).call($ac);
        }
        else {return (($ad = this).$raise || $mm('raise')).call($ad, "bad defined? part: " + ((($ae = part)['$[]'] || $mm('[]')).call($ae, 0)))} }).call(this);
      };

      def.$process_not = function(sexp, level) {
        var TMP_16, $a, $b;
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_16 = function(tmp) {

          var self = TMP_16._s || this, $a, $b;
          if (tmp == null) tmp = nil;

          return "(" + (tmp) + " = " + ((($a = self).$process || $mm('process')).call($a, (($b = sexp).$shift || $mm('shift')).call($b), "expr")) + ", (" + (tmp) + " === nil || " + (tmp) + " === false))"
        }, TMP_16._s = this, TMP_16), $a).call($b);
      };

      def.$process_block_pass = function(exp, level) {
        var $a, $b, $c, $d;
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "call", (($c = exp).$shift || $mm('shift')).call($c), "to_proc", (($d = this).$s || $mm('s')).call($d, "arglist")), "expr");
      };

      def.$process_iter = function(sexp, level) {
        var call = nil, args = nil, body = nil, code = nil, params = nil, scope_name = nil, identity = nil, block_arg = nil, splat = nil, len = nil, itercode = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, TMP_17, $ac, $ad, $ae, $af, $ag, $ah;
        (($a = sexp)._isArray ? $a : ($a = [$a])), call = ($a[0] == null ? nil : $a[0]), args = ($a[1] == null ? nil : $a[1]), body = ($a[2] == null ? nil : $a[2]);
        (($a = body), $a !== false && $a !== nil ? $a : body = (($b = this).$s || $mm('s')).call($b, "nil"));
        body = (($a = this).$returns || $mm('returns')).call($a, body);
        code = "";
        params = nil;
        scope_name = nil;
        identity = nil;
        if (($c = (($d = (($e = __scope.Fixnum) == null ? __opal.cm("Fixnum") : $e))['$==='] || $mm('===')).call($d, args)) !== false && $c !== nil) {
          args = nil
        };
        (($c = args), $c !== false && $c !== nil ? $c : args = (($e = this).$s || $mm('s')).call($e, "masgn", (($f = this).$s || $mm('s')).call($f, "array")));
        args = (function() { if ((($c = (($g = args).$first || $mm('first')).call($g))['$=='] || $mm('==')).call($c, "lasgn")) {
          return (($h = this).$s || $mm('s')).call($h, "array", args)
          } else {
          return (($i = args)['$[]'] || $mm('[]')).call($i, 1)
        }; return nil; }).call(this);
        if (($j = ($k = (($k = (($l = args).$last || $mm('last')).call($l))['$is_a?'] || $mm('is_a?')).call($k, (($m = __scope.Array) == null ? __opal.cm("Array") : $m)), $k !== false && $k !== nil ? (($m = (($n = (($o = args).$last || $mm('last')).call($o))['$[]'] || $mm('[]')).call($n, 0))['$=='] || $mm('==')).call($m, "block_pass") : $k)) !== false && $j !== nil) {
          block_arg = (($j = args).$pop || $mm('pop')).call($j);
          block_arg = (($p = (($q = (($r = block_arg)['$[]'] || $mm('[]')).call($r, 1))['$[]'] || $mm('[]')).call($q, 1)).$to_sym || $mm('to_sym')).call($p);
        };
        if (($s = ($t = (($t = (($u = args).$last || $mm('last')).call($u))['$is_a?'] || $mm('is_a?')).call($t, (($v = __scope.Array) == null ? __opal.cm("Array") : $v)), $t !== false && $t !== nil ? (($v = (($w = (($x = args).$last || $mm('last')).call($x))['$[]'] || $mm('[]')).call($w, 0))['$=='] || $mm('==')).call($v, "splat") : $t)) !== false && $s !== nil) {
          splat = (($s = (($y = (($z = args).$last || $mm('last')).call($z))['$[]'] || $mm('[]')).call($y, 1))['$[]'] || $mm('[]')).call($s, 1);
          (($aa = args).$pop || $mm('pop')).call($aa);
          len = (($ab = args).$length || $mm('length')).call($ab);
        };
        ($ac = (($ad = this).$indent || $mm('indent')), $ac._p = (TMP_17 = function() {

          var self = TMP_17._s || this, TMP_18, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_18 = function() {

            var blk = nil, self = TMP_18._s || this, $a, $b, TMP_19, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            identity = (($a = self.scope)['$identify!'] || $mm('identify!')).call($a);
            (($b = self.scope).$add_temp || $mm('add_temp')).call($b, "self = " + (identity) + "._s || this");
            ($c = (($d = (($e = args)['$[]'] || $mm('[]')).call($e, __range(1, -1, false))).$each || $mm('each')), $c._p = (TMP_19 = function(arg) {

              var self = TMP_19._s || this, $a, $b, $c, $d;
              if (arg == null) arg = nil;

              arg = (($a = arg)['$[]'] || $mm('[]')).call($a, 1);
              if (($b = (($c = (($d = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $d))['$include?'] || $mm('include?')).call($c, (($d = arg).$to_s || $mm('to_s')).call($d))) !== false && $b !== nil) {
                arg = "" + (arg) + "$"
              };
              return code = (($b = code)['$+'] || $mm('+')).call($b, "if (" + (arg) + " == null) " + (arg) + " = nil;\n");
            }, TMP_19._s = self, TMP_19), $c).call($d);
            params = (($c = self).$js_block_args || $mm('js_block_args')).call($c, (($f = args)['$[]'] || $mm('[]')).call($f, __range(1, -1, false)));
            if (splat !== false && splat !== nil) {
              (($g = params)['$<<'] || $mm('<<')).call($g, splat);
              code = (($h = code)['$+'] || $mm('+')).call($h, "" + (splat) + " = __slice.call(arguments, " + (($i = len, $j = 1, typeof($i) === 'number' ? $i - $j : $i['$-']($j))) + ");");
            };
            if (block_arg !== false && block_arg !== nil) {
              (($i = self.scope)['$block_name='] || $mm('block_name=')).call($i, block_arg);
              (($j = self.scope).$add_temp || $mm('add_temp')).call($j, block_arg);
              (($k = self.scope).$add_temp || $mm('add_temp')).call($k, "__context");
              scope_name = (($l = self.scope)['$identify!'] || $mm('identify!')).call($l);
              blk = (($m = "\n%s%s = %s._p || nil, __context = %s._s, %s.p = null;\n%s")['$%'] || $mm('%')).call($m, [self.indent, block_arg, scope_name, block_arg, scope_name, self.indent]);
              code = ($n = blk, $o = code, typeof($n) === 'number' ? $n + $o : $n['$+']($o));
            };
            code = (($n = code)['$+'] || $mm('+')).call($n, ($o = "\n" + (self.indent), $p = (($q = self).$process || $mm('process')).call($q, body, "stmt"), typeof($o) === 'number' ? $o + $p : $o['$+']($p)));
            if (($o = (($p = self.scope).$defines_defn || $mm('defines_defn')).call($p)) !== false && $o !== nil) {
              (($o = self.scope).$add_temp || $mm('add_temp')).call($o, "def = ((typeof(" + ((($r = self).$current_self || $mm('current_self')).call($r)) + ") === 'function') ? " + ((($s = self).$current_self || $mm('current_self')).call($s)) + ".prototype : " + ((($t = self).$current_self || $mm('current_self')).call($t)) + ")")
            };
            return code = "\n" + (self.indent) + ((($u = self.scope).$to_vars || $mm('to_vars')).call($u)) + "\n" + (self.indent) + (code);
          }, TMP_18._s = self, TMP_18), $a).call($b, "iter")
        }, TMP_17._s = this, TMP_17), $ac).call($ad);
        itercode = "function(" + ((($ac = params).$join || $mm('join')).call($ac, ", ")) + ") {\n" + (code) + "\n" + (this.indent) + "}";
        (($ae = call)['$<<'] || $mm('<<')).call($ae, (($af = "(%s = %s, %s._s = %s, %s)")['$%'] || $mm('%')).call($af, [identity, itercode, identity, (($ag = this).$current_self || $mm('current_self')).call($ag), identity]));
        return (($ah = this).$process || $mm('process')).call($ah, call, level);
      };

      def.$js_block_args = function(sexp) {
        var TMP_20, $a, $b;
        return ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_20 = function(arg) {

          var a = nil, self = TMP_20._s || this, $a, $b, $c, $d, $e, $f;
          if (self.scope == null) self.scope = nil;

          if (arg == null) arg = nil;

          a = (($a = (($b = arg)['$[]'] || $mm('[]')).call($b, 1)).$to_sym || $mm('to_sym')).call($a);
          if (($c = (($d = (($e = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $e))['$include?'] || $mm('include?')).call($d, (($e = a).$to_s || $mm('to_s')).call($e))) !== false && $c !== nil) {
            a = (($c = ("" + (a) + "$")).$to_sym || $mm('to_sym')).call($c)
          };
          (($f = self.scope).$add_arg || $mm('add_arg')).call($f, a);
          return a;
        }, TMP_20._s = this, TMP_20), $a).call($b);
      };

      def.$process_attrasgn = function(exp, level) {
        var recv = nil, mid = nil, arglist = nil, $a, $b;
        (($a = exp)._isArray ? $a : ($a = [$a])), recv = ($a[0] == null ? nil : $a[0]), mid = ($a[1] == null ? nil : $a[1]), arglist = ($a[2] == null ? nil : $a[2]);
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "call", recv, mid, arglist), level);
      };

      def.$handle_attr_optimize = function(meth, attrs) {
        var out = nil, TMP_21, $a, $b, $c, $d;
        out = [];
        ($a = (($b = attrs).$each || $mm('each')), $a._p = (TMP_21 = function(attr) {

          var mid = nil, ivar = nil, pre = nil, self = TMP_21._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s;
          if (self.scope == null) self.scope = nil;

          if (attr == null) attr = nil;

          mid = (($a = attr)['$[]'] || $mm('[]')).call($a, 1);
          ivar = (($b = ("@" + (mid))).$to_sym || $mm('to_sym')).call($b);
          pre = (($c = self.scope).$proto || $mm('proto')).call($c);
          if (($d = (($e = meth)['$=='] || $mm('==')).call($e, "attr_writer")) === false || $d === nil) {
            (($d = out)['$<<'] || $mm('<<')).call($d, (($f = self).$process || $mm('process')).call($f, (($g = self).$s || $mm('s')).call($g, "defn", mid, (($h = self).$s || $mm('s')).call($h, "args"), (($i = self).$s || $mm('s')).call($i, "scope", (($j = self).$s || $mm('s')).call($j, "ivar", ivar))), "stmt"))
          };
          if ((($k = meth)['$=='] || $mm('==')).call($k, "attr_reader")) {
            return nil
            } else {
            mid = (($l = ("" + (mid) + "=")).$to_sym || $mm('to_sym')).call($l);
            return (($m = out)['$<<'] || $mm('<<')).call($m, (($n = self).$process || $mm('process')).call($n, (($o = self).$s || $mm('s')).call($o, "defn", mid, (($p = self).$s || $mm('s')).call($p, "args", "val"), (($q = self).$s || $mm('s')).call($q, "scope", (($r = self).$s || $mm('s')).call($r, "iasgn", ivar, (($s = self).$s || $mm('s')).call($s, "lvar", "val")))), "stmt"));
          };
        }, TMP_21._s = this, TMP_21), $a).call($b);
        return ($a = (($d = out).$join || $mm('join')).call($d, ", \n" + (this.indent)), $c = ", nil", typeof($a) === 'number' ? $a + $c : $a['$+']($c));
      };

      def.$handle_alias_native = function(sexp) {
        var args = nil, meth = nil, func = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l;
        args = (($a = sexp)['$[]'] || $mm('[]')).call($a, 2);
        meth = (($b = this).$mid_to_jsid || $mm('mid_to_jsid')).call($b, (($c = (($d = (($e = args)['$[]'] || $mm('[]')).call($e, 1))['$[]'] || $mm('[]')).call($d, 1)).$to_s || $mm('to_s')).call($c));
        func = (($f = (($g = args)['$[]'] || $mm('[]')).call($g, 2))['$[]'] || $mm('[]')).call($f, 1);
        (($h = (($i = this.scope).$methods || $mm('methods')).call($i))['$<<'] || $mm('<<')).call($h, meth);
        return (($j = "%s%s = %s.%s")['$%'] || $mm('%')).call($j, [(($k = this.scope).$proto || $mm('proto')).call($k), meth, (($l = this.scope).$proto || $mm('proto')).call($l), func]);
      };

      def.$process_call = function(sexp, level) {
        var recv = nil, meth = nil, arglist = nil, iter = nil, mid = nil, $case = nil, splat = nil, block = nil, tmpfunc = nil, tmprecv = nil, args = nil, recv_code = nil, call_recv = nil, dispatch = nil, result = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, TMP_22, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al;
        (($a = sexp)._isArray ? $a : ($a = [$a])), recv = ($a[0] == null ? nil : $a[0]), meth = ($a[1] == null ? nil : $a[1]), arglist = ($a[2] == null ? nil : $a[2]), iter = ($a[3] == null ? nil : $a[3]);
        mid = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = meth).$to_s || $mm('to_s')).call($b));
        $case = meth;if ((($f = "attr_reader")['$==='] || $mm('===')).call($f, $case) || (($g = "attr_writer")['$==='] || $mm('===')).call($g, $case) || (($h = "attr_accessor")['$==='] || $mm('===')).call($h, $case)) {
        if (($c = (($d = this.scope)['$class_scope?'] || $mm('class_scope?')).call($d)) !== false && $c !== nil) {
          return (($c = this).$handle_attr_optimize || $mm('handle_attr_optimize')).call($c, meth, (($e = arglist)['$[]'] || $mm('[]')).call($e, __range(1, -1, false)))
        }
        }
        else if ((($j = "block_given?")['$==='] || $mm('===')).call($j, $case)) {
        return (($i = this).$js_block_given || $mm('js_block_given')).call($i, sexp, level)
        }
        else if ((($m = "alias_native")['$==='] || $mm('===')).call($m, $case)) {
        if (($k = (($l = this.scope)['$class_scope?'] || $mm('class_scope?')).call($l)) !== false && $k !== nil) {
          return (($k = this).$handle_alias_native || $mm('handle_alias_native')).call($k, sexp)
        }
        }
        else if ((($p = "require")['$==='] || $mm('===')).call($p, $case)) {
        return (($n = this).$handle_require || $mm('handle_require')).call($n, (($o = arglist)['$[]'] || $mm('[]')).call($o, 1))
        };
        splat = ($q = (($r = (($s = arglist)['$[]'] || $mm('[]')).call($s, __range(1, -1, false)))['$any?'] || $mm('any?')), $q._p = (TMP_22 = function(a) {

          var self = TMP_22._s || this, $a, $b;
          if (a == null) a = nil;

          return (($a = (($b = a).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "splat")
        }, TMP_22._s = this, TMP_22), $q).call($r);
        if (($q = ($t = (($t = (($u = __scope.Array) == null ? __opal.cm("Array") : $u))['$==='] || $mm('===')).call($t, (($u = arglist).$last || $mm('last')).call($u)), $t !== false && $t !== nil ? (($v = (($w = (($x = arglist).$last || $mm('last')).call($x)).$first || $mm('first')).call($w))['$=='] || $mm('==')).call($v, "block_pass") : $t)) !== false && $q !== nil) {
          block = (($q = this).$process || $mm('process')).call($q, (($y = this).$s || $mm('s')).call($y, "js_tmp", (($z = this).$process || $mm('process')).call($z, (($aa = arglist).$pop || $mm('pop')).call($aa), "expr")), "expr")
          } else {
          if (iter !== false && iter !== nil) {
            block = iter
          }
        };
        (($ab = recv), $ab !== false && $ab !== nil ? $ab : recv = (($ac = this).$s || $mm('s')).call($ac, "self"));
        if (block !== false && block !== nil) {
          tmpfunc = (($ab = this.scope).$new_temp || $mm('new_temp')).call($ab)
        };
        tmprecv = (($ad = this.scope).$new_temp || $mm('new_temp')).call($ad);
        args = "";
        recv_code = (($ae = this).$process || $mm('process')).call($ae, recv, "recv");
        if (($af = this.method_missing) !== false && $af !== nil) {
          call_recv = (($af = this).$s || $mm('s')).call($af, "js_tmp", (($ag = tmprecv), $ag !== false && $ag !== nil ? $ag : recv_code));
          if (($ag = splat) === false || $ag === nil) {
            (($ag = arglist).$insert || $mm('insert')).call($ag, 1, call_recv)
          };
          args = (($ah = this).$process || $mm('process')).call($ah, arglist, "expr");
          dispatch = "((" + (tmprecv) + " = " + (recv_code) + ")" + (mid) + " || $mm('" + ((($ai = meth).$to_s || $mm('to_s')).call($ai)) + "'))";
          if (tmpfunc !== false && tmpfunc !== nil) {
            dispatch = "(" + (tmpfunc) + " = " + (dispatch) + ", " + (tmpfunc) + "._p = " + (block) + ", " + (tmpfunc) + ")"
          };
          result = (function() { if (splat !== false && splat !== nil) {
            return "" + (dispatch) + ".apply(" + ((($aj = this).$process || $mm('process')).call($aj, call_recv, "expr")) + ", " + (args) + ")"
            } else {
            return "" + (dispatch) + ".call(" + (args) + ")"
          }; return nil; }).call(this);
          } else {
          args = (($ak = this).$process || $mm('process')).call($ak, arglist, "expr");
          dispatch = (function() { if (tmprecv !== false && tmprecv !== nil) {
            return "(" + (tmprecv) + " = " + (recv_code) + ")" + (mid)
            } else {
            return "" + (recv_code) + (mid)
          }; return nil; }).call(this);
          result = (function() { if (splat !== false && splat !== nil) {
            return "" + (dispatch) + ".apply(" + ((($al = tmprecv), $al !== false && $al !== nil ? $al : recv_code)) + ", " + (args) + ")"
            } else {
            return "" + (dispatch) + "(" + (args) + ")"
          }; return nil; }).call(this);
        };
        if (tmpfunc !== false && tmpfunc !== nil) {
          (($al = this.scope).$queue_temp || $mm('queue_temp')).call($al, tmpfunc)
        };
        return result;
      };

      def.$handle_require = function(sexp) {
        var str = nil, $a, $b, $c;
        str = (($a = this).$handle_require_sexp || $mm('handle_require_sexp')).call($a, sexp);
        if (($b = (($c = str)['$nil?'] || $mm('nil?')).call($c)) === false || $b === nil) {
          (($b = this.requires)['$<<'] || $mm('<<')).call($b, str)
        };
        return "";
      };

      def.$handle_require_sexp = function(sexp) {
        var type = nil, recv = nil, meth = nil, args = nil, parts = nil, $case = nil, $a, $b, $c, $d, $e, TMP_23, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v;
        type = (($a = sexp).$shift || $mm('shift')).call($a);
        if ((($b = type)['$=='] || $mm('==')).call($b, "str")) {
          return (($c = sexp)['$[]'] || $mm('[]')).call($c, 0)
          } else {
          if ((($d = type)['$=='] || $mm('==')).call($d, "call")) {
            (($e = sexp)._isArray ? $e : ($e = [$e])), recv = ($e[0] == null ? nil : $e[0]), meth = ($e[1] == null ? nil : $e[1]), args = ($e[2] == null ? nil : $e[2]);
            parts = ($e = (($f = (($g = args)['$[]'] || $mm('[]')).call($g, __range(1, -1, false))).$map || $mm('map')), $e._p = (TMP_23 = function(s) {

              var self = TMP_23._s || this, $a;
              if (s == null) s = nil;

              return (($a = self).$handle_require_sexp || $mm('handle_require_sexp')).call($a, s)
            }, TMP_23._s = this, TMP_23), $e).call($f);
            if ((($e = recv)['$=='] || $mm('==')).call($e, ["const", "File"])) {
              if ((($h = meth)['$=='] || $mm('==')).call($h, "expand_path")) {
                return (($i = this).$handle_expand_path || $mm('handle_expand_path')).apply($i, [].concat(parts))
                } else {
                if ((($j = meth)['$=='] || $mm('==')).call($j, "join")) {
                  return (($k = this).$handle_expand_path || $mm('handle_expand_path')).call($k, (($l = parts).$join || $mm('join')).call($l, "/"))
                  } else {
                  if ((($m = meth)['$=='] || $mm('==')).call($m, "dirname")) {
                    return (($n = this).$handle_expand_path || $mm('handle_expand_path')).call($n, (($o = (($p = (($q = (($r = parts)['$[]'] || $mm('[]')).call($r, 0)).$split || $mm('split')).call($q, "/"))['$[]'] || $mm('[]')).call($p, __range(0, -1, true))).$join || $mm('join')).call($o, "/"))
                  }
                }
              }
            };
          }
        };
        return (function() { $case = this.dynamic_require_severity;if ((($t = "error")['$==='] || $mm('===')).call($t, $case)) {
        return (($s = this).$error || $mm('error')).call($s, "Cannot handle dynamic require")
        }
        else if ((($v = "warning")['$==='] || $mm('===')).call($v, $case)) {
        return (($u = this).$warning || $mm('warning')).call($u, "Cannot handle dynamic require")
        }
        else {return nil} }).call(this);
      };

      def.$handle_expand_path = function(path, base) {
        var $a, TMP_24, $b, $c, $d;if (base == null) {
          base = ""
        }
        return (($a = ($b = (($c = (($d = ("" + (base) + "/" + (path))).$split || $mm('split')).call($d, "/")).$inject || $mm('inject')), $b._p = (TMP_24 = function(path, part) {

          var self = TMP_24._s || this, $a, $b, $c, $d;
          if (path == null) path = nil;
if (part == null) part = nil;

          if (($a = (($b = part)['$=='] || $mm('==')).call($b, "")) === false || $a === nil) {
            if ((($a = part)['$=='] || $mm('==')).call($a, "..")) {
              (($c = path).$pop || $mm('pop')).call($c)
              } else {
              (($d = path)['$<<'] || $mm('<<')).call($d, part)
            }
          };
          return path;
        }, TMP_24._s = this, TMP_24), $b).call($c, [])).$join || $mm('join')).call($a, "/");
      };

      def.$process_arglist = function(sexp, level) {
        var code = nil, work = nil, splat = nil, arg = nil, join = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t;
        code = "";
        work = [];
        while (!(($b = (($c = sexp)['$empty?'] || $mm('empty?')).call($c)) !== false && $b !== nil)) {splat = (($b = (($d = (($e = sexp).$first || $mm('first')).call($e)).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($b, "splat");
        arg = (($f = this).$process || $mm('process')).call($f, (($g = sexp).$shift || $mm('shift')).call($g), "expr");
        if (splat !== false && splat !== nil) {
          if (($h = (($i = work)['$empty?'] || $mm('empty?')).call($i)) !== false && $h !== nil) {
            if (($h = (($j = code)['$empty?'] || $mm('empty?')).call($j)) !== false && $h !== nil) {
              code = (($h = code)['$+'] || $mm('+')).call($h, "[].concat(" + (arg) + ")")
              } else {
              code = (($k = code)['$+'] || $mm('+')).call($k, ".concat(" + (arg) + ")")
            }
            } else {
            join = "[" + ((($l = work).$join || $mm('join')).call($l, ", ")) + "]";
            code = (($m = code)['$+'] || $mm('+')).call($m, (function() { if (($n = (($o = code)['$empty?'] || $mm('empty?')).call($o)) !== false && $n !== nil) {
              return join
              } else {
              return ".concat(" + (join) + ")"
            }; return nil; }).call(this));
            code = (($n = code)['$+'] || $mm('+')).call($n, ".concat(" + (arg) + ")");
          };
          work = [];
          } else {
          (($p = work).$push || $mm('push')).call($p, arg)
        };};
        if (($a = (($q = work)['$empty?'] || $mm('empty?')).call($q)) === false || $a === nil) {
          join = (($a = work).$join || $mm('join')).call($a, ", ");
          code = (($r = code)['$+'] || $mm('+')).call($r, (function() { if (($s = (($t = code)['$empty?'] || $mm('empty?')).call($t)) !== false && $s !== nil) {
            return join
            } else {
            return ".concat([" + (join) + "])"
          }; return nil; }).call(this));
        };
        return code;
      };

      def.$process_splat = function(sexp, level) {
        var $a, $b, $c, $d, $e, $f, $g, $h, $i;
        if ((($a = (($b = sexp).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, ["nil"])) {
          return "[]"
        };
        if ((($c = (($d = (($e = sexp).$first || $mm('first')).call($e)).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "lit")) {
          return "[" + ((($f = this).$process || $mm('process')).call($f, (($g = sexp).$first || $mm('first')).call($g), "expr")) + "]"
        };
        return (($h = this).$process || $mm('process')).call($h, (($i = sexp).$first || $mm('first')).call($i), "recv");
      };

      def.$process_class = function(sexp, level) {
        var cid = nil, sup = nil, body = nil, code = nil, base = nil, name = nil, spacer = nil, cls = nil, boot = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, TMP_25, $u, $v;
        (($a = sexp)._isArray ? $a : ($a = [$a])), cid = ($a[0] == null ? nil : $a[0]), sup = ($a[1] == null ? nil : $a[1]), body = ($a[2] == null ? nil : $a[2]);
        if (($a = (($b = body)['$[]'] || $mm('[]')).call($b, 1)) === false || $a === nil) {
          (($a = body)['$[]='] || $mm('[]=')).call($a, 1, (($c = this).$s || $mm('s')).call($c, "nil"))
        };
        code = nil;
        (($d = this.helpers)['$[]='] || $mm('[]=')).call($d, "klass", true);
        if (($e = (($f = (($g = (($h = __scope.Symbol) == null ? __opal.cm("Symbol") : $h))['$==='] || $mm('===')).call($g, cid)), $f !== false && $f !== nil ? $f : (($h = (($i = __scope.String) == null ? __opal.cm("String") : $i))['$==='] || $mm('===')).call($h, cid))) !== false && $e !== nil) {
          base = (($e = this).$current_self || $mm('current_self')).call($e);
          name = (($f = cid).$to_s || $mm('to_s')).call($f);
          } else {
          if ((($i = (($j = cid)['$[]'] || $mm('[]')).call($j, 0))['$=='] || $mm('==')).call($i, "colon2")) {
            base = (($k = this).$process || $mm('process')).call($k, (($l = cid)['$[]'] || $mm('[]')).call($l, 1), "expr");
            name = (($m = (($n = cid)['$[]'] || $mm('[]')).call($n, 2)).$to_s || $mm('to_s')).call($m);
            } else {
            if ((($o = (($p = cid)['$[]'] || $mm('[]')).call($p, 0))['$=='] || $mm('==')).call($o, "colon3")) {
              base = "Opal.Object";
              name = (($q = (($r = cid)['$[]'] || $mm('[]')).call($r, 1)).$to_s || $mm('to_s')).call($q);
              } else {
              (($s = this).$raise || $mm('raise')).call($s, "Bad receiver in class")
            }
          }
        };
        sup = (function() { if (sup !== false && sup !== nil) {
          return (($t = this).$process || $mm('process')).call($t, sup, "expr")
          } else {
          return "null"
        }; return nil; }).call(this);
        ($u = (($v = this).$indent || $mm('indent')), $u._p = (TMP_25 = function() {

          var self = TMP_25._s || this, TMP_26, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_26 = function() {

            var needs_block = nil, last_body_statement = nil, self = TMP_26._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            (($a = self.scope)['$name='] || $mm('name=')).call($a, name);
            (($b = self.scope).$add_temp || $mm('add_temp')).call($b, "" + ((($c = self.scope).$proto || $mm('proto')).call($c)) + " = " + (name) + ".prototype", "__scope = " + (name) + "._scope");
            if (($d = (($e = (($f = __scope.Array) == null ? __opal.cm("Array") : $f))['$==='] || $mm('===')).call($e, (($f = body).$last || $mm('last')).call($f))) !== false && $d !== nil) {
              needs_block = ($d = (($g = (($h = (($i = body).$last || $mm('last')).call($i)).$first || $mm('first')).call($h))['$=='] || $mm('==')).call($g, "block"), ($d === nil || $d === false));
              (($d = (($j = (($k = body).$last || $mm('last')).call($k)).$first || $mm('first')).call($j))['$=='] || $mm('==')).call($d, "block");
              last_body_statement = (function() { if (needs_block !== false && needs_block !== nil) {
                return (($l = body).$last || $mm('last')).call($l)
                } else {
                return (($m = (($n = body).$last || $mm('last')).call($n)).$last || $mm('last')).call($m)
              }; return nil; }).call(self);
              if (($o = (($p = last_body_statement !== false && last_body_statement !== nil) ? (($q = (($r = __scope.Array) == null ? __opal.cm("Array") : $r))['$==='] || $mm('===')).call($q, last_body_statement) : $p)) !== false && $o !== nil) {
                if (($o = (($p = ["defn", "defs"])['$include?'] || $mm('include?')).call($p, (($r = last_body_statement).$first || $mm('first')).call($r))) !== false && $o !== nil) {
                  if (needs_block !== false && needs_block !== nil) {
                    (($o = body)['$[]='] || $mm('[]=')).call($o, -1, (($s = self).$s || $mm('s')).call($s, "block", (($t = body)['$[]'] || $mm('[]')).call($t, -1)))
                  };
                  (($u = (($v = body).$last || $mm('last')).call($v))['$<<'] || $mm('<<')).call($u, (($w = self).$s || $mm('s')).call($w, "nil"));
                }
              };
            };
            body = (($x = self).$returns || $mm('returns')).call($x, body);
            body = (($y = self).$process || $mm('process')).call($y, body, "stmt");
            code = "\n" + ((($z = self.scope).$to_donate_methods || $mm('to_donate_methods')).call($z));
            return code = (($aa = code)['$+'] || $mm('+')).call($aa, ($ab = ($ad = ($af = self.indent, $ag = (($ah = self.scope).$to_vars || $mm('to_vars')).call($ah), typeof($af) === 'number' ? $af + $ag : $af['$+']($ag)), $ae = "\n\n" + (self.indent), typeof($ad) === 'number' ? $ad + $ae : $ad['$+']($ae)), $ac = body, typeof($ab) === 'number' ? $ab + $ac : $ab['$+']($ac)));
          }, TMP_26._s = self, TMP_26), $a).call($b, "class")
        }, TMP_25._s = this, TMP_25), $u).call($v);
        spacer = "\n" + (this.indent) + ((($u = __scope.INDENT) == null ? __opal.cm("INDENT") : $u));
        cls = "function " + (name) + "() {};";
        boot = "" + (name) + " = __klass(__base, __super, " + ((($u = name).$inspect || $mm('inspect')).call($u)) + ", " + (name) + ");";
        return "(function(__base, __super){" + (spacer) + (cls) + (spacer) + (boot) + "\n" + (code) + "\n" + (this.indent) + "})(" + (base) + ", " + (sup) + ")";
      };

      def.$process_sclass = function(sexp, level) {
        var recv = nil, body = nil, code = nil, call = nil, $a, $b, TMP_27, $c, $d, $e, $f;
        recv = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        body = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        code = nil;
        ($c = (($d = this).$in_scope || $mm('in_scope')), $c._p = (TMP_27 = function() {

          var self = TMP_27._s || this, $a, $b, $c, $d, $e, $f, $g, $h;
          if (self.scope == null) self.scope = nil;

          
          (($a = self.scope).$add_temp || $mm('add_temp')).call($a, "__scope = " + ((($b = self).$current_self || $mm('current_self')).call($b)) + "._scope");
          (($c = self.scope).$add_temp || $mm('add_temp')).call($c, "def = " + ((($d = self).$current_self || $mm('current_self')).call($d)) + ".prototype");
          body = (($e = self).$process || $mm('process')).call($e, body, "stmt");
          return code = ($f = (($h = self.scope).$to_vars || $mm('to_vars')).call($h), $g = body, typeof($f) === 'number' ? $f + $g : $f['$+']($g));
        }, TMP_27._s = this, TMP_27), $c).call($d, "sclass");
        call = (($c = this).$s || $mm('s')).call($c, "call", recv, "singleton_class", (($e = this).$s || $mm('s')).call($e, "arglist"));
        return "(function(){" + (code) + "}).call(" + ((($f = this).$process || $mm('process')).call($f, call, "expr")) + ")";
      };

      def.$process_module = function(sexp, level) {
        var cid = nil, body = nil, code = nil, base = nil, name = nil, spacer = nil, cls = nil, boot = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, TMP_28, $s, $t;
        cid = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        body = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        code = nil;
        (($c = this.helpers)['$[]='] || $mm('[]=')).call($c, "module", true);
        if (($d = (($e = (($f = (($g = __scope.Symbol) == null ? __opal.cm("Symbol") : $g))['$==='] || $mm('===')).call($f, cid)), $e !== false && $e !== nil ? $e : (($g = (($h = __scope.String) == null ? __opal.cm("String") : $h))['$==='] || $mm('===')).call($g, cid))) !== false && $d !== nil) {
          base = (($d = this).$current_self || $mm('current_self')).call($d);
          name = (($e = cid).$to_s || $mm('to_s')).call($e);
          } else {
          if ((($h = (($i = cid)['$[]'] || $mm('[]')).call($i, 0))['$=='] || $mm('==')).call($h, "colon2")) {
            base = (($j = this).$process || $mm('process')).call($j, (($k = cid)['$[]'] || $mm('[]')).call($k, 1), "expr");
            name = (($l = (($m = cid)['$[]'] || $mm('[]')).call($m, 2)).$to_s || $mm('to_s')).call($l);
            } else {
            if ((($n = (($o = cid)['$[]'] || $mm('[]')).call($o, 0))['$=='] || $mm('==')).call($n, "colon3")) {
              base = "Opal.Object";
              name = (($p = (($q = cid)['$[]'] || $mm('[]')).call($q, 1)).$to_s || $mm('to_s')).call($p);
              } else {
              (($r = this).$raise || $mm('raise')).call($r, "Bad receiver in class")
            }
          }
        };
        ($s = (($t = this).$indent || $mm('indent')), $s._p = (TMP_28 = function() {

          var self = TMP_28._s || this, TMP_29, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_29 = function() {

            var self = TMP_29._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            (($a = self.scope)['$name='] || $mm('name=')).call($a, name);
            (($b = self.scope).$add_temp || $mm('add_temp')).call($b, "" + ((($c = self.scope).$proto || $mm('proto')).call($c)) + " = " + (name) + ".prototype", "__scope = " + (name) + "._scope");
            body = (($d = self).$process || $mm('process')).call($d, body, "stmt");
            return code = ($e = ($g = ($i = ($k = ($m = self.indent, $n = (($o = self.scope).$to_vars || $mm('to_vars')).call($o), typeof($m) === 'number' ? $m + $n : $m['$+']($n)), $l = "\n\n" + (self.indent), typeof($k) === 'number' ? $k + $l : $k['$+']($l)), $j = body, typeof($i) === 'number' ? $i + $j : $i['$+']($j)), $h = "\n" + (self.indent), typeof($g) === 'number' ? $g + $h : $g['$+']($h)), $f = (($g = self.scope).$to_donate_methods || $mm('to_donate_methods')).call($g), typeof($e) === 'number' ? $e + $f : $e['$+']($f));
          }, TMP_29._s = self, TMP_29), $a).call($b, "module")
        }, TMP_28._s = this, TMP_28), $s).call($t);
        spacer = "\n" + (this.indent) + ((($s = __scope.INDENT) == null ? __opal.cm("INDENT") : $s));
        cls = "function " + (name) + "() {};";
        boot = "" + (name) + " = __module(__base, " + ((($s = name).$inspect || $mm('inspect')).call($s)) + ", " + (name) + ");";
        return "(function(__base){" + (spacer) + (cls) + (spacer) + (boot) + "\n" + (code) + "\n" + (this.indent) + "})(" + (base) + ")";
      };

      def.$process_undef = function(sexp, level) {
        var $a, $b, $c, $d, $e;
        return "delete " + ((($a = this.scope).$proto || $mm('proto')).call($a)) + ((($b = this).$mid_to_jsid || $mm('mid_to_jsid')).call($b, (($c = (($d = (($e = sexp)['$[]'] || $mm('[]')).call($e, 0))['$[]'] || $mm('[]')).call($d, 1)).$to_s || $mm('to_s')).call($c)));
      };

      def.$process_defn = function(sexp, level) {
        var mid = nil, args = nil, stmts = nil, $a, $b, $c;
        (($a = sexp)._isArray ? $a : ($a = [$a])), mid = ($a[0] == null ? nil : $a[0]), args = ($a[1] == null ? nil : $a[1]), stmts = ($a[2] == null ? nil : $a[2]);
        return (($a = this).$js_def || $mm('js_def')).call($a, nil, mid, args, stmts, (($b = sexp).$line || $mm('line')).call($b), (($c = sexp).$end_line || $mm('end_line')).call($c));
      };

      def.$process_defs = function(sexp, level) {
        var recv = nil, mid = nil, args = nil, stmts = nil, $a, $b, $c;
        (($a = sexp)._isArray ? $a : ($a = [$a])), recv = ($a[0] == null ? nil : $a[0]), mid = ($a[1] == null ? nil : $a[1]), args = ($a[2] == null ? nil : $a[2]), stmts = ($a[3] == null ? nil : $a[3]);
        return (($a = this).$js_def || $mm('js_def')).call($a, recv, mid, args, stmts, (($b = sexp).$line || $mm('line')).call($b), (($c = sexp).$end_line || $mm('end_line')).call($c));
      };

      def.$js_def = function(recvr, mid, args, stmts, line, end_line) {
        var jsid = nil, smethod = nil, recv = nil, code = nil, params = nil, scope_name = nil, uses_super = nil, uses_splat = nil, opt = nil, argc = nil, block_name = nil, splat = nil, arity_code = nil, defcode = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, TMP_30, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay;
        jsid = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = mid).$to_s || $mm('to_s')).call($b));
        if (recvr !== false && recvr !== nil) {
          (($c = this.scope)['$defines_defs='] || $mm('defines_defs=')).call($c, true);
          if (($d = ($e = (($e = this.scope)['$class_scope?'] || $mm('class_scope?')).call($e), $e !== false && $e !== nil ? (($f = (($g = recvr).$first || $mm('first')).call($g))['$=='] || $mm('==')).call($f, "self") : $e)) !== false && $d !== nil) {
            smethod = true
          };
          recv = (($d = this).$process || $mm('process')).call($d, recvr, "expr");
          } else {
          (($h = this.scope)['$defines_defn='] || $mm('defines_defn=')).call($h, true);
          recv = (($i = this).$current_self || $mm('current_self')).call($i);
        };
        code = "";
        params = nil;
        scope_name = nil;
        uses_super = nil;
        uses_splat = nil;
        if (($j = (($k = (($l = __scope.Array) == null ? __opal.cm("Array") : $l))['$==='] || $mm('===')).call($k, (($l = args).$last || $mm('last')).call($l))) !== false && $j !== nil) {
          opt = (($j = args).$pop || $mm('pop')).call($j)
        };
        argc = ($m = (($o = args).$length || $mm('length')).call($o), $n = 1, typeof($m) === 'number' ? $m - $n : $m['$-']($n));
        if (($m = (($n = (($p = (($q = args).$last || $mm('last')).call($q)).$to_s || $mm('to_s')).call($p))['$start_with?'] || $mm('start_with?')).call($n, "&")) !== false && $m !== nil) {
          block_name = (($m = (($r = (($s = (($t = args).$pop || $mm('pop')).call($t)).$to_s || $mm('to_s')).call($s))['$[]'] || $mm('[]')).call($r, __range(1, -1, false))).$to_sym || $mm('to_sym')).call($m);
          argc = (($u = argc)['$-'] || $mm('-')).call($u, 1);
        };
        if (($v = (($w = (($x = (($y = args).$last || $mm('last')).call($y)).$to_s || $mm('to_s')).call($x))['$start_with?'] || $mm('start_with?')).call($w, "*")) !== false && $v !== nil) {
          uses_splat = true;
          if ((($v = (($z = args).$last || $mm('last')).call($z))['$=='] || $mm('==')).call($v, "*")) {
            argc = (($aa = argc)['$-'] || $mm('-')).call($aa, 1)
            } else {
            splat = (($ab = (($ac = (($ad = (($ae = args)['$[]'] || $mm('[]')).call($ae, -1)).$to_s || $mm('to_s')).call($ad))['$[]'] || $mm('[]')).call($ac, __range(1, -1, false))).$to_sym || $mm('to_sym')).call($ab);
            (($af = args)['$[]='] || $mm('[]=')).call($af, -1, splat);
            argc = (($ag = argc)['$-'] || $mm('-')).call($ag, 1);
          };
        };
        if (($ah = this.arity_check) !== false && $ah !== nil) {
          arity_code = ($ah = (($aj = this).$arity_check || $mm('arity_check')).call($aj, args, opt, uses_splat, block_name, mid), $ai = "\n" + ((($ak = __scope.INDENT) == null ? __opal.cm("INDENT") : $ak)), typeof($ah) === 'number' ? $ah + $ai : $ah['$+']($ai))
        };
        ($ah = (($ai = this).$indent || $mm('indent')), $ah._p = (TMP_30 = function() {

          var self = TMP_30._s || this, TMP_31, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_31 = function() {

            var yielder = nil, stmt_code = nil, blk = nil, self = TMP_31._s || this, $a, $b, $c, $d, $e, $f, $g, $h, TMP_32, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            (($a = self.scope)['$mid='] || $mm('mid=')).call($a, mid);
            if (recvr !== false && recvr !== nil) {
              (($b = self.scope)['$defs='] || $mm('defs=')).call($b, true)
            };
            if (block_name !== false && block_name !== nil) {
              (($c = self.scope)['$uses_block!'] || $mm('uses_block!')).call($c)
            };
            yielder = (($d = block_name), $d !== false && $d !== nil ? $d : "__yield");
            (($d = self.scope)['$block_name='] || $mm('block_name=')).call($d, yielder);
            params = (($e = self).$process || $mm('process')).call($e, args, "expr");
            stmt_code = ($f = "\n" + (self.indent), $g = (($h = self).$process || $mm('process')).call($h, stmts, "stmt"), typeof($f) === 'number' ? $f + $g : $f['$+']($g));
            if (opt !== false && opt !== nil) {
              ($f = (($g = (($i = opt)['$[]'] || $mm('[]')).call($i, __range(1, -1, false))).$each || $mm('each')), $f._p = (TMP_32 = function(o) {

                var id = nil, self = TMP_32._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
                if (self.indent == null) self.indent = nil;

                if (o == null) o = nil;

                if ((($a = (($b = (($c = o)['$[]'] || $mm('[]')).call($c, 2))['$[]'] || $mm('[]')).call($b, 2))['$=='] || $mm('==')).call($a, "undefined")) {
                  return nil;
                };
                id = (($d = self).$process || $mm('process')).call($d, (($e = self).$s || $mm('s')).call($e, "lvar", (($f = o)['$[]'] || $mm('[]')).call($f, 1)), "expr");
                return code = (($g = code)['$+'] || $mm('+')).call($g, (($h = "if (%s == null) {\n%s%s\n%s}")['$%'] || $mm('%')).call($h, [id, ($i = self.indent, $j = (($k = __scope.INDENT) == null ? __opal.cm("INDENT") : $k), typeof($i) === 'number' ? $i + $j : $i['$+']($j)), (($i = self).$process || $mm('process')).call($i, o, "expre"), self.indent]));
              }, TMP_32._s = self, TMP_32), $f).call($g)
            };
            if (splat !== false && splat !== nil) {
              code = (($f = code)['$+'] || $mm('+')).call($f, "" + (splat) + " = __slice.call(arguments, " + (argc) + ");")
            };
            scope_name = (($j = self.scope).$identity || $mm('identity')).call($j);
            if (($k = (($l = self.scope)['$uses_block?'] || $mm('uses_block?')).call($l)) !== false && $k !== nil) {
              (($k = self.scope).$add_temp || $mm('add_temp')).call($k, yielder);
              blk = (($m = "\n%s%s = %s._p || nil, %s._p = null;\n%s")['$%'] || $mm('%')).call($m, [self.indent, yielder, scope_name, scope_name, self.indent]);
            };
            code = (($n = code)['$+'] || $mm('+')).call($n, stmt_code);
            code = "" + (blk) + (code);
            uses_super = (($o = self.scope).$uses_super || $mm('uses_super')).call($o);
            return code = ($p = "" + (arity_code) + (self.indent) + ((($r = self.scope).$to_vars || $mm('to_vars')).call($r)), $q = code, typeof($p) === 'number' ? $p + $q : $p['$+']($q));
          }, TMP_31._s = self, TMP_31), $a).call($b, "def")
        }, TMP_30._s = this, TMP_30), $ah).call($ai);
        defcode = "" + ((function() { if (scope_name !== false && scope_name !== nil) {
          return "" + (scope_name) + " = "
          } else {
          return nil
        }; return nil; }).call(this)) + "function(" + (params) + ") {\n" + (code) + "\n" + (this.indent) + "}";
        if (recvr !== false && recvr !== nil) {
          if (smethod !== false && smethod !== nil) {
            return "__opal.defs(" + ((($ah = this.scope).$name || $mm('name')).call($ah)) + ", '$" + (mid) + "', " + (defcode) + ")"
            } else {
            return "" + (recv) + (jsid) + " = " + (defcode)
          }
          } else {
          if (($ak = ($al = (($al = this.scope)['$class?'] || $mm('class?')).call($al), $al !== false && $al !== nil ? (($am = (($an = this.scope).$name || $mm('name')).call($an))['$=='] || $mm('==')).call($am, "Object") : $al)) !== false && $ak !== nil) {
            return "" + ((($ak = this).$current_self || $mm('current_self')).call($ak)) + "._defn('$" + (mid) + "', " + (defcode) + ")"
            } else {
            if (($ao = (($ap = this.scope)['$class_scope?'] || $mm('class_scope?')).call($ap)) !== false && $ao !== nil) {
              (($ao = (($aq = this.scope).$methods || $mm('methods')).call($aq))['$<<'] || $mm('<<')).call($ao, "$" + (mid));
              if (uses_super !== false && uses_super !== nil) {
                (($ar = this.scope).$add_temp || $mm('add_temp')).call($ar, uses_super);
                uses_super = "" + (uses_super) + " = " + ((($as = this.scope).$proto || $mm('proto')).call($as)) + (jsid) + ";\n" + (this.indent);
              };
              return "" + (uses_super) + ((($at = this.scope).$proto || $mm('proto')).call($at)) + (jsid) + " = " + (defcode);
              } else {
              if ((($au = (($av = this.scope).$type || $mm('type')).call($av))['$=='] || $mm('==')).call($au, "iter")) {
                return "def" + (jsid) + " = " + (defcode)
                } else {
                if ((($aw = (($ax = this.scope).$type || $mm('type')).call($ax))['$=='] || $mm('==')).call($aw, "top")) {
                  return "" + ((($ay = this).$current_self || $mm('current_self')).call($ay)) + (jsid) + " = " + (defcode)
                  } else {
                  return "def" + (jsid) + " = " + (defcode)
                }
              }
            }
          }
        };
      };

      def.$arity_check = function(args, opt, splat, block_name, mid) {
        var meth = nil, arity = nil, aritycode = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
        meth = (($a = (($b = mid).$to_s || $mm('to_s')).call($b)).$inspect || $mm('inspect')).call($a);
        arity = ($c = (($e = args).$size || $mm('size')).call($e), $d = 1, typeof($c) === 'number' ? $c - $d : $c['$-']($d));
        if (opt !== false && opt !== nil) {
          arity = (($c = arity)['$-'] || $mm('-')).call($c, ($d = (($g = opt).$size || $mm('size')).call($g), $f = 1, typeof($d) === 'number' ? $d - $f : $d['$-']($f)))
        };
        if (splat !== false && splat !== nil) {
          arity = (($d = arity)['$-'] || $mm('-')).call($d, 1)
        };
        if (($f = (($h = opt), $h !== false && $h !== nil ? $h : splat)) !== false && $f !== nil) {
          arity = ($f = (($i = arity)['$-@'] || $mm('-@')).call($i), $h = 1, typeof($f) === 'number' ? $f - $h : $f['$-']($h))
        };
        aritycode = "var $arity = arguments.length;";
        if ((($f = arity)['$<'] || $mm('<')).call($f, 0)) {
          return ($h = aritycode, $j = "if ($arity < " + ((($k = ($l = arity, $m = 1, typeof($l) === 'number' ? $l + $m : $l['$+']($m)))['$-@'] || $mm('-@')).call($k)) + ") { __opal.ac($arity, " + (arity) + ", this, " + (meth) + "); }", typeof($h) === 'number' ? $h + $j : $h['$+']($j))
          } else {
          return ($h = aritycode, $j = "if ($arity !== " + (arity) + ") { __opal.ac($arity, " + (arity) + ", this, " + (meth) + "); }", typeof($h) === 'number' ? $h + $j : $h['$+']($j))
        };
      };

      def.$process_args = function(exp, level) {
        var args = nil, a = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
        args = [];
        while (!(($b = (($c = exp)['$empty?'] || $mm('empty?')).call($c)) !== false && $b !== nil)) {a = (($b = (($d = exp).$shift || $mm('shift')).call($d)).$to_sym || $mm('to_sym')).call($b);
        if ((($e = (($f = a).$to_s || $mm('to_s')).call($f))['$=='] || $mm('==')).call($e, "*")) {
          continue;
        };
        if (($g = (($h = (($i = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $i))['$include?'] || $mm('include?')).call($h, (($i = a).$to_s || $mm('to_s')).call($i))) !== false && $g !== nil) {
          a = (($g = ("" + (a) + "$")).$to_sym || $mm('to_sym')).call($g)
        };
        (($j = this.scope).$add_arg || $mm('add_arg')).call($j, a);
        (($k = args)['$<<'] || $mm('<<')).call($k, a);};
        return (($a = args).$join || $mm('join')).call($a, ", ");
      };

      def.$process_self = function(sexp, level) {
        var $a;
        return (($a = this).$current_self || $mm('current_self')).call($a);
      };

      def.$current_self = function() {
        var $a, $b, $c, $d, $e, $f;
        if (($a = (($b = this.scope)['$class_scope?'] || $mm('class_scope?')).call($b)) !== false && $a !== nil) {
          return (($a = this.scope).$name || $mm('name')).call($a)
          } else {
          if (($c = (($d = (($e = this.scope)['$top?'] || $mm('top?')).call($e)), $d !== false && $d !== nil ? $d : (($f = this.scope)['$iter?'] || $mm('iter?')).call($f))) !== false && $c !== nil) {
            return "self"
            } else {
            return "this"
          }
        };
      };

      ($a = (($b = ["true", "false", "nil"]).$each || $mm('each')), $a._p = (TMP_33 = function(name) {

        var self = TMP_33._s || this, TMP_34, $a, $b;
        if (name == null) name = nil;

        return ($a = (($b = self).$define_method || $mm('define_method')), $a._p = (TMP_34 = function(exp, level) {

          var self = TMP_34._s || this;
          if (exp == null) exp = nil;
if (level == null) level = nil;

          return name
        }, TMP_34._s = self, TMP_34), $a).call($b, "process_" + (name))
      }, TMP_33._s = Parser, TMP_33), $a).call($b);

      def.$process_array = function(sexp, level) {
        var code = nil, work = nil, splat = nil, part = nil, join = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t;
        if (($a = (($b = sexp)['$empty?'] || $mm('empty?')).call($b)) !== false && $a !== nil) {
          return "[]"
        };
        code = "";
        work = [];
        while (!(($c = (($d = sexp)['$empty?'] || $mm('empty?')).call($d)) !== false && $c !== nil)) {splat = (($c = (($e = (($f = sexp).$first || $mm('first')).call($f)).$first || $mm('first')).call($e))['$=='] || $mm('==')).call($c, "splat");
        part = (($g = this).$process || $mm('process')).call($g, (($h = sexp).$shift || $mm('shift')).call($h), "expr");
        if (splat !== false && splat !== nil) {
          if (($i = (($j = work)['$empty?'] || $mm('empty?')).call($j)) !== false && $i !== nil) {
            code = (($i = code)['$+'] || $mm('+')).call($i, (function() { if (($k = (($l = code)['$empty?'] || $mm('empty?')).call($l)) !== false && $k !== nil) {
              return part
              } else {
              return ".concat(" + (part) + ")"
            }; return nil; }).call(this))
            } else {
            join = "[" + ((($k = work).$join || $mm('join')).call($k, ", ")) + "]";
            code = (($m = code)['$+'] || $mm('+')).call($m, (function() { if (($n = (($o = code)['$empty?'] || $mm('empty?')).call($o)) !== false && $n !== nil) {
              return join
              } else {
              return ".concat(" + (join) + ")"
            }; return nil; }).call(this));
            code = (($n = code)['$+'] || $mm('+')).call($n, ".concat(" + (part) + ")");
          };
          work = [];
          } else {
          (($p = work)['$<<'] || $mm('<<')).call($p, part)
        };};
        if (($a = (($q = work)['$empty?'] || $mm('empty?')).call($q)) === false || $a === nil) {
          join = "[" + ((($a = work).$join || $mm('join')).call($a, ", ")) + "]";
          code = (($r = code)['$+'] || $mm('+')).call($r, (function() { if (($s = (($t = code)['$empty?'] || $mm('empty?')).call($t)) !== false && $s !== nil) {
            return join
            } else {
            return ".concat(" + (join) + ")"
          }; return nil; }).call(this));
        };
        return code;
      };

      def.$process_hash = function(sexp, level) {
        var keys = nil, vals = nil, hash_obj = nil, hash_keys = nil, map = nil, TMP_35, $a, $b, TMP_36, $c, $d, TMP_37, $e, TMP_38, $f, $g, $h, $i, $j, TMP_39, $k, $l;
        keys = [];
        vals = [];
        ($a = (($b = sexp).$each_with_index || $mm('each_with_index')), $a._p = (TMP_35 = function(obj, idx) {

          var self = TMP_35._s || this, $a, $b, $c;
          if (obj == null) obj = nil;
if (idx == null) idx = nil;

          if (($a = (($b = idx)['$even?'] || $mm('even?')).call($b)) !== false && $a !== nil) {
            return (($a = keys)['$<<'] || $mm('<<')).call($a, obj)
            } else {
            return (($c = vals)['$<<'] || $mm('<<')).call($c, obj)
          }
        }, TMP_35._s = this, TMP_35), $a).call($b);
        if (($a = ($c = (($d = keys)['$all?'] || $mm('all?')), $c._p = (TMP_36 = function(k) {

          var self = TMP_36._s || this, $a, $b;
          if (k == null) k = nil;

          return (($a = ["lit", "str"])['$include?'] || $mm('include?')).call($a, (($b = k)['$[]'] || $mm('[]')).call($b, 0))
        }, TMP_36._s = this, TMP_36), $c).call($d)) !== false && $a !== nil) {
          hash_obj = __hash2([], {});
          hash_keys = [];
          ($a = (($c = (($e = keys).$size || $mm('size')).call($e)).$times || $mm('times')), $a._p = (TMP_37 = function(i) {

            var k = nil, self = TMP_37._s || this, $a, $b, $c, $d, $e, $f, $g;
            if (i == null) i = nil;

            k = (($a = self).$process || $mm('process')).call($a, (($b = keys)['$[]'] || $mm('[]')).call($b, i), "expr");
            if (($c = (($d = hash_obj)['$include?'] || $mm('include?')).call($d, k)) === false || $c === nil) {
              (($c = hash_keys)['$<<'] || $mm('<<')).call($c, k)
            };
            return (($e = hash_obj)['$[]='] || $mm('[]=')).call($e, k, (($f = self).$process || $mm('process')).call($f, (($g = vals)['$[]'] || $mm('[]')).call($g, i), "expr"));
          }, TMP_37._s = this, TMP_37), $a).call($c);
          map = ($a = (($f = hash_keys).$map || $mm('map')), $a._p = (TMP_38 = function(k) {

            var self = TMP_38._s || this, $a;
            if (k == null) k = nil;

            return "" + (k) + ": " + ((($a = hash_obj)['$[]'] || $mm('[]')).call($a, k))
          }, TMP_38._s = this, TMP_38), $a).call($f);
          (($a = this.helpers)['$[]='] || $mm('[]=')).call($a, "hash2", true);
          return "__hash2([" + ((($g = hash_keys).$join || $mm('join')).call($g, ", ")) + "], {" + ((($h = map).$join || $mm('join')).call($h, ", ")) + "})";
          } else {
          (($i = this.helpers)['$[]='] || $mm('[]=')).call($i, "hash", true);
          return "__hash(" + ((($j = ($k = (($l = sexp).$map || $mm('map')), $k._p = (TMP_39 = function(p) {

            var self = TMP_39._s || this, $a;
            if (p == null) p = nil;

            return (($a = self).$process || $mm('process')).call($a, p, "expr")
          }, TMP_39._s = this, TMP_39), $k).call($l)).$join || $mm('join')).call($j, ", ")) + ")";
        };
      };

      def.$process_while = function(sexp, level) {
        var expr = nil, stmt = nil, redo_var = nil, stmt_level = nil, pre = nil, code = nil, $a, $b, $c, $d, $e, TMP_40, $f, $g, $h, $i;
        (($a = sexp)._isArray ? $a : ($a = [$a])), expr = ($a[0] == null ? nil : $a[0]), stmt = ($a[1] == null ? nil : $a[1]);
        redo_var = (($a = this.scope).$new_temp || $mm('new_temp')).call($a);
        stmt_level = (function() { if (($b = (($c = (($d = level)['$=='] || $mm('==')).call($d, "expr")), $c !== false && $c !== nil ? $c : (($e = level)['$=='] || $mm('==')).call($e, "recv"))) !== false && $b !== nil) {
          return "stmt_closure"
          } else {
          return "stmt"
        }; return nil; }).call(this);
        pre = "while (";
        code = "" + ((($b = this).$js_truthy || $mm('js_truthy')).call($b, expr)) + "){";
        ($c = (($f = this).$in_while || $mm('in_while')), $c._p = (TMP_40 = function() {

          var body = nil, self = TMP_40._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i;
          if (self.while_loop == null) self.while_loop = nil;

          
          if ((($a = stmt_level)['$=='] || $mm('==')).call($a, "stmt_closure")) {
            (($b = self.while_loop)['$[]='] || $mm('[]=')).call($b, "closure", true)
          };
          (($c = self.while_loop)['$[]='] || $mm('[]=')).call($c, "redo_var", redo_var);
          body = (($d = self).$process || $mm('process')).call($d, stmt, "stmt");
          if (($e = (($f = self.while_loop)['$[]'] || $mm('[]')).call($f, "use_redo")) !== false && $e !== nil) {
            pre = ($e = ($h = "" + (redo_var) + "=false;", $i = pre, typeof($h) === 'number' ? $h + $i : $h['$+']($i)), $g = "" + (redo_var) + " || ", typeof($e) === 'number' ? $e + $g : $e['$+']($g));
            code = (($e = code)['$+'] || $mm('+')).call($e, "" + (redo_var) + "=false;");
          };
          return code = (($g = code)['$+'] || $mm('+')).call($g, body);
        }, TMP_40._s = this, TMP_40), $c).call($f);
        code = (($c = code)['$+'] || $mm('+')).call($c, "}");
        code = ($g = pre, $h = code, typeof($g) === 'number' ? $g + $h : $g['$+']($h));
        (($g = this.scope).$queue_temp || $mm('queue_temp')).call($g, redo_var);
        if ((($h = stmt_level)['$=='] || $mm('==')).call($h, "stmt_closure")) {
          code = "(function() {" + (code) + "; return nil;}).call(" + ((($i = this).$current_self || $mm('current_self')).call($i)) + ")"
        };
        return code;
      };

      def.$process_until = function(exp, level) {
        var expr = nil, stmt = nil, redo_var = nil, stmt_level = nil, pre = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, TMP_41, $h, $i, $j, $k;
        expr = (($a = exp)['$[]'] || $mm('[]')).call($a, 0);
        stmt = (($b = exp)['$[]'] || $mm('[]')).call($b, 1);
        redo_var = (($c = this.scope).$new_temp || $mm('new_temp')).call($c);
        stmt_level = (function() { if (($d = (($e = (($f = level)['$=='] || $mm('==')).call($f, "expr")), $e !== false && $e !== nil ? $e : (($g = level)['$=='] || $mm('==')).call($g, "recv"))) !== false && $d !== nil) {
          return "stmt_closure"
          } else {
          return "stmt"
        }; return nil; }).call(this);
        pre = "while (!(";
        code = "" + ((($d = this).$js_truthy || $mm('js_truthy')).call($d, expr)) + ")) {";
        ($e = (($h = this).$in_while || $mm('in_while')), $e._p = (TMP_41 = function() {

          var body = nil, self = TMP_41._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i;
          if (self.while_loop == null) self.while_loop = nil;

          
          if ((($a = stmt_level)['$=='] || $mm('==')).call($a, "stmt_closure")) {
            (($b = self.while_loop)['$[]='] || $mm('[]=')).call($b, "closure", true)
          };
          (($c = self.while_loop)['$[]='] || $mm('[]=')).call($c, "redo_var", redo_var);
          body = (($d = self).$process || $mm('process')).call($d, stmt, "stmt");
          if (($e = (($f = self.while_loop)['$[]'] || $mm('[]')).call($f, "use_redo")) !== false && $e !== nil) {
            pre = ($e = ($h = "" + (redo_var) + "=false;", $i = pre, typeof($h) === 'number' ? $h + $i : $h['$+']($i)), $g = "" + (redo_var) + " || ", typeof($e) === 'number' ? $e + $g : $e['$+']($g));
            code = (($e = code)['$+'] || $mm('+')).call($e, "" + (redo_var) + "=false;");
          };
          return code = (($g = code)['$+'] || $mm('+')).call($g, body);
        }, TMP_41._s = this, TMP_41), $e).call($h);
        code = (($e = code)['$+'] || $mm('+')).call($e, "}");
        code = ($i = pre, $j = code, typeof($i) === 'number' ? $i + $j : $i['$+']($j));
        (($i = this.scope).$queue_temp || $mm('queue_temp')).call($i, redo_var);
        if ((($j = stmt_level)['$=='] || $mm('==')).call($j, "stmt_closure")) {
          code = "(function() {" + (code) + "; return nil;}).call(" + ((($k = this).$current_self || $mm('current_self')).call($k)) + ")"
        };
        return code;
      };

      def.$process_alias = function(exp, level) {
        var new$ = nil, old = nil, current = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t;
        new$ = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = (($c = (($d = exp)['$[]'] || $mm('[]')).call($d, 0))['$[]'] || $mm('[]')).call($c, 1)).$to_s || $mm('to_s')).call($b));
        old = (($e = this).$mid_to_jsid || $mm('mid_to_jsid')).call($e, (($f = (($g = (($h = exp)['$[]'] || $mm('[]')).call($h, 1))['$[]'] || $mm('[]')).call($g, 1)).$to_s || $mm('to_s')).call($f));
        if (($i = (($j = ["class", "module"])['$include?'] || $mm('include?')).call($j, (($k = this.scope).$type || $mm('type')).call($k))) !== false && $i !== nil) {
          (($i = (($l = this.scope).$methods || $mm('methods')).call($l))['$<<'] || $mm('<<')).call($i, "$" + ((($m = (($n = (($o = exp)['$[]'] || $mm('[]')).call($o, 0))['$[]'] || $mm('[]')).call($n, 1)).$to_s || $mm('to_s')).call($m)));
          return (($p = "%s%s = %s%s")['$%'] || $mm('%')).call($p, [(($q = this.scope).$proto || $mm('proto')).call($q), new$, (($r = this.scope).$proto || $mm('proto')).call($r), old]);
          } else {
          current = (($s = this).$current_self || $mm('current_self')).call($s);
          return (($t = "%s.prototype%s = %s.prototype%s")['$%'] || $mm('%')).call($t, [current, new$, current, old]);
        };
      };

      def.$process_masgn = function(sexp, level) {
        var lhs = nil, rhs = nil, tmp = nil, len = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, TMP_42, $r, $s, $t;
        lhs = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        tmp = (($c = this.scope).$new_temp || $mm('new_temp')).call($c);
        len = 0;
        (($d = lhs).$shift || $mm('shift')).call($d);
        if ((($e = (($f = rhs)['$[]'] || $mm('[]')).call($f, 0))['$=='] || $mm('==')).call($e, "array")) {
          len = ($g = (($i = rhs).$length || $mm('length')).call($i), $h = 1, typeof($g) === 'number' ? $g - $h : $g['$-']($h));
          code = ["" + (tmp) + " = " + ((($g = this).$process || $mm('process')).call($g, rhs, "expr"))];
          } else {
          if ((($h = (($j = rhs)['$[]'] || $mm('[]')).call($j, 0))['$=='] || $mm('==')).call($h, "to_ary")) {
            code = ["((" + (tmp) + " = " + ((($k = this).$process || $mm('process')).call($k, (($l = rhs)['$[]'] || $mm('[]')).call($l, 1), "expr")) + ")._isArray ? " + (tmp) + " : (" + (tmp) + " = [" + (tmp) + "]))"]
            } else {
            if ((($m = (($n = rhs)['$[]'] || $mm('[]')).call($n, 0))['$=='] || $mm('==')).call($m, "splat")) {
              code = ["(" + (tmp) + " = " + ((($o = this).$process || $mm('process')).call($o, (($p = rhs)['$[]'] || $mm('[]')).call($p, 1), "expr")) + ")['$to_a'] ? (" + (tmp) + " = " + (tmp) + "['$to_a']()) : (" + (tmp) + ")._isArray ? " + (tmp) + " : (" + (tmp) + " = [" + (tmp) + "])"]
              } else {
              (($q = this).$raise || $mm('raise')).call($q, "Unsupported mlhs type")
            }
          }
        };
        ($r = (($s = lhs).$each_with_index || $mm('each_with_index')), $r._p = (TMP_42 = function(l, idx) {

          var s = nil, self = TMP_42._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n;
          if (l == null) l = nil;
if (idx == null) idx = nil;

          if ((($a = (($b = l).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "splat")) {
            s = (($c = l)['$[]'] || $mm('[]')).call($c, 1);
            (($d = s)['$<<'] || $mm('<<')).call($d, (($e = self).$s || $mm('s')).call($e, "js_tmp", "__slice.call(" + (tmp) + ", " + (idx) + ")"));
            return (($f = code)['$<<'] || $mm('<<')).call($f, (($g = self).$process || $mm('process')).call($g, s, "expr"));
            } else {
            if ((($h = idx)['$>='] || $mm('>=')).call($h, len)) {
              (($i = l)['$<<'] || $mm('<<')).call($i, (($j = self).$s || $mm('s')).call($j, "js_tmp", "(" + (tmp) + "[" + (idx) + "] == null ? nil : " + (tmp) + "[" + (idx) + "])"))
              } else {
              (($k = l)['$<<'] || $mm('<<')).call($k, (($l = self).$s || $mm('s')).call($l, "js_tmp", "" + (tmp) + "[" + (idx) + "]"))
            };
            return (($m = code)['$<<'] || $mm('<<')).call($m, (($n = self).$process || $mm('process')).call($n, l, "expr"));
          }
        }, TMP_42._s = this, TMP_42), $r).call($s);
        (($r = this.scope).$queue_temp || $mm('queue_temp')).call($r, tmp);
        return (($t = code).$join || $mm('join')).call($t, ", ");
      };

      def.$process_svalue = function(sexp, level) {
        var $a, $b;
        return (($a = this).$process || $mm('process')).call($a, (($b = sexp).$shift || $mm('shift')).call($b), level);
      };

      def.$process_lasgn = function(sexp, level) {
        var lvar = nil, rhs = nil, res = nil, $a, $b, $c, $d, $e, $f, $g, $h;
        lvar = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        if (($c = (($d = (($e = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $e))['$include?'] || $mm('include?')).call($d, (($e = lvar).$to_s || $mm('to_s')).call($e))) !== false && $c !== nil) {
          lvar = (($c = ("" + (lvar) + "$")).$to_sym || $mm('to_sym')).call($c)
        };
        (($f = this.scope).$add_local || $mm('add_local')).call($f, lvar);
        res = "" + (lvar) + " = " + ((($g = this).$process || $mm('process')).call($g, rhs, "expr"));
        if ((($h = level)['$=='] || $mm('==')).call($h, "recv")) {
          return "(" + (res) + ")"
          } else {
          return res
        };
      };

      def.$process_lvar = function(exp, level) {
        var lvar = nil, $a, $b, $c, $d, $e;
        lvar = (($a = (($b = exp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
        if (($c = (($d = (($e = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $e))['$include?'] || $mm('include?')).call($d, lvar)) !== false && $c !== nil) {
          lvar = "" + (lvar) + "$"
        };
        return lvar;
      };

      def.$process_iasgn = function(exp, level) {
        var ivar = nil, rhs = nil, lhs = nil, $a, $b, $c, $d, $e, $f, $g, $h;
        ivar = (($a = exp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = exp)['$[]'] || $mm('[]')).call($b, 1);
        ivar = (($c = (($d = ivar).$to_s || $mm('to_s')).call($d))['$[]'] || $mm('[]')).call($c, __range(1, -1, false));
        lhs = (function() { if (($e = (($f = (($g = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $g))['$include?'] || $mm('include?')).call($f, ivar)) !== false && $e !== nil) {
          return "" + ((($e = this).$current_self || $mm('current_self')).call($e)) + "['" + (ivar) + "']"
          } else {
          return "" + ((($g = this).$current_self || $mm('current_self')).call($g)) + "." + (ivar)
        }; return nil; }).call(this);
        return "" + (lhs) + " = " + ((($h = this).$process || $mm('process')).call($h, rhs, "expr"));
      };

      def.$process_ivar = function(exp, level) {
        var ivar = nil, part = nil, $a, $b, $c, $d, $e, $f;
        ivar = (($a = (($b = (($c = exp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        part = (function() { if (($d = (($e = (($f = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $f))['$include?'] || $mm('include?')).call($e, ivar)) !== false && $d !== nil) {
          return "['" + (ivar) + "']"
          } else {
          return "." + (ivar)
        }; return nil; }).call(this);
        (($d = this.scope).$add_ivar || $mm('add_ivar')).call($d, part);
        return "" + ((($f = this).$current_self || $mm('current_self')).call($f)) + (part);
      };

      def.$process_gvar = function(sexp, level) {
        var gvar = nil, $a, $b, $c, $d, $e;
        gvar = (($a = (($b = (($c = sexp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        (($d = this.helpers)['$[]='] || $mm('[]=')).call($d, "gvars", true);
        return "__gvars[" + ((($e = gvar).$inspect || $mm('inspect')).call($e)) + "]";
      };

      def.$process_nth_ref = function(sexp, level) {
        
        return "nil";
      };

      def.$process_gasgn = function(sexp, level) {
        var gvar = nil, rhs = nil, $a, $b, $c, $d, $e, $f, $g, $h;
        gvar = (($a = (($b = (($c = sexp)['$[]'] || $mm('[]')).call($c, 0)).$to_s || $mm('to_s')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        rhs = (($d = sexp)['$[]'] || $mm('[]')).call($d, 1);
        (($e = this.helpers)['$[]='] || $mm('[]=')).call($e, "gvars", true);
        return "__gvars[" + ((($f = (($g = gvar).$to_s || $mm('to_s')).call($g)).$inspect || $mm('inspect')).call($f)) + "] = " + ((($h = this).$process || $mm('process')).call($h, rhs, "expr"));
      };

      def.$process_const = function(sexp, level) {
        var cname = nil, $a, $b, $c, TMP_43, $d;
        cname = (($a = (($b = sexp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
        if (($c = this.const_missing) !== false && $c !== nil) {
          return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_43 = function(t) {

            var self = TMP_43._s || this, $a;
            if (t == null) t = nil;

            return "((" + (t) + " = __scope." + (cname) + ") == null ? __opal.cm(" + ((($a = cname).$inspect || $mm('inspect')).call($a)) + ") : " + (t) + ")"
          }, TMP_43._s = this, TMP_43), $c).call($d)
          } else {
          return "__scope." + (cname)
        };
      };

      def.$process_cdecl = function(sexp, level) {
        var const$ = nil, rhs = nil, $a;
        (($a = sexp)._isArray ? $a : ($a = [$a])), const$ = ($a[0] == null ? nil : $a[0]), rhs = ($a[1] == null ? nil : $a[1]);
        return "__scope." + (const$) + " = " + ((($a = this).$process || $mm('process')).call($a, rhs, "expr"));
      };

      def.$process_return = function(sexp, level) {
        var val = nil, $a, $b, $c, $d, $e, $f;
        val = (($a = this).$process || $mm('process')).call($a, (($b = (($c = sexp).$shift || $mm('shift')).call($c)), $b !== false && $b !== nil ? $b : (($d = this).$s || $mm('s')).call($d, "nil")), "expr");
        if (($b = (($e = level)['$=='] || $mm('==')).call($e, "stmt")) === false || $b === nil) {
          (($b = this).$raise || $mm('raise')).call($b, (($f = __scope.SyntaxError) == null ? __opal.cm("SyntaxError") : $f), "void value expression: cannot return as an expression")
        };
        return "return " + (val);
      };

      def.$process_xstr = function(sexp, level) {
        var code = nil, $a, $b, $c, $d, $e, $f, $g;
        code = (($a = (($b = sexp).$first || $mm('first')).call($b)).$to_s || $mm('to_s')).call($a);
        if (($c = (($d = (($e = level)['$=='] || $mm('==')).call($e, "stmt")) ? ($f = (($g = code)['$include?'] || $mm('include?')).call($g, ";"), ($f === nil || $f === false)) : $d)) !== false && $c !== nil) {
          code = (($c = code)['$+'] || $mm('+')).call($c, ";")
        };
        if ((($d = level)['$=='] || $mm('==')).call($d, "recv")) {
          return "(" + (code) + ")"
          } else {
          return code
        };
      };

      def.$process_dxstr = function(sexp, level) {
        var code = nil, $a, TMP_44, $b, $c, $d, $e, $f, $g;
        code = (($a = ($b = (($c = sexp).$map || $mm('map')), $b._p = (TMP_44 = function(p) {

          var self = TMP_44._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
          if (p == null) p = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, p)) !== false && $a !== nil) {
            return (($a = p).$to_s || $mm('to_s')).call($a)
            } else {
            if ((($c = (($d = p).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "evstr")) {
              return (($e = self).$process || $mm('process')).call($e, (($f = p).$last || $mm('last')).call($f), "stmt")
              } else {
              if ((($g = (($h = p).$first || $mm('first')).call($h))['$=='] || $mm('==')).call($g, "str")) {
                return (($i = (($j = p).$last || $mm('last')).call($j)).$to_s || $mm('to_s')).call($i)
                } else {
                return (($k = self).$raise || $mm('raise')).call($k, "Bad dxstr part")
              }
            }
          }
        }, TMP_44._s = this, TMP_44), $b).call($c)).$join || $mm('join')).call($a);
        if (($b = (($d = (($e = level)['$=='] || $mm('==')).call($e, "stmt")) ? ($f = (($g = code)['$include?'] || $mm('include?')).call($g, ";"), ($f === nil || $f === false)) : $d)) !== false && $b !== nil) {
          code = (($b = code)['$+'] || $mm('+')).call($b, ";")
        };
        if ((($d = level)['$=='] || $mm('==')).call($d, "recv")) {
          code = "(" + (code) + ")"
        };
        return code;
      };

      def.$process_dstr = function(sexp, level) {
        var parts = nil, res = nil, TMP_45, $a, $b, $c;
        parts = ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_45 = function(p) {

          var self = TMP_45._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
          if (p == null) p = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, p)) !== false && $a !== nil) {
            return (($a = p).$inspect || $mm('inspect')).call($a)
            } else {
            if ((($c = (($d = p).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "evstr")) {
              return ($e = ($g = "(", $h = (($i = self).$process || $mm('process')).call($i, (($j = p).$last || $mm('last')).call($j), "expr"), typeof($g) === 'number' ? $g + $h : $g['$+']($h)), $f = ")", typeof($e) === 'number' ? $e + $f : $e['$+']($f))
              } else {
              if ((($e = (($f = p).$first || $mm('first')).call($f))['$=='] || $mm('==')).call($e, "str")) {
                return (($g = (($h = p).$last || $mm('last')).call($h)).$inspect || $mm('inspect')).call($g)
                } else {
                return (($k = self).$raise || $mm('raise')).call($k, "Bad dstr part")
              }
            }
          }
        }, TMP_45._s = this, TMP_45), $a).call($b);
        res = (($a = parts).$join || $mm('join')).call($a, " + ");
        if ((($c = level)['$=='] || $mm('==')).call($c, "recv")) {
          return "(" + (res) + ")"
          } else {
          return res
        };
      };

      def.$process_dsym = function(sexp, level) {
        var parts = nil, TMP_46, $a, $b;
        parts = ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_46 = function(p) {

          var self = TMP_46._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
          if (p == null) p = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, p)) !== false && $a !== nil) {
            return (($a = p).$inspect || $mm('inspect')).call($a)
            } else {
            if ((($c = (($d = p).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "evstr")) {
              return (($e = self).$process || $mm('process')).call($e, (($f = self).$s || $mm('s')).call($f, "call", (($g = p).$last || $mm('last')).call($g), "to_s", (($h = self).$s || $mm('s')).call($h, "arglist")), "expr")
              } else {
              if ((($i = (($j = p).$first || $mm('first')).call($j))['$=='] || $mm('==')).call($i, "str")) {
                return (($k = (($l = p).$last || $mm('last')).call($l)).$inspect || $mm('inspect')).call($k)
                } else {
                return (($m = self).$raise || $mm('raise')).call($m, "Bad dsym part")
              }
            }
          }
        }, TMP_46._s = this, TMP_46), $a).call($b);
        return "(" + ((($a = parts).$join || $mm('join')).call($a, "+")) + ")";
      };

      def.$process_if = function(sexp, level) {
        var test = nil, truthy = nil, falsy = nil, returnable = nil, check = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, TMP_47, $j, TMP_48, $k, $l;
        (($a = sexp)._isArray ? $a : ($a = [$a])), test = ($a[0] == null ? nil : $a[0]), truthy = ($a[1] == null ? nil : $a[1]), falsy = ($a[2] == null ? nil : $a[2]);
        returnable = (($a = (($b = level)['$=='] || $mm('==')).call($b, "expr")), $a !== false && $a !== nil ? $a : (($c = level)['$=='] || $mm('==')).call($c, "recv"));
        if (returnable !== false && returnable !== nil) {
          truthy = (($a = this).$returns || $mm('returns')).call($a, (($d = truthy), $d !== false && $d !== nil ? $d : (($e = this).$s || $mm('s')).call($e, "nil")));
          falsy = (($d = this).$returns || $mm('returns')).call($d, (($f = falsy), $f !== false && $f !== nil ? $f : (($g = this).$s || $mm('s')).call($g, "nil")));
        };
        if (($f = (($h = falsy !== false && falsy !== nil) ? ($i = truthy, ($i === nil || $i === false)) : $h)) !== false && $f !== nil) {
          truthy = falsy;
          falsy = nil;
          check = (($f = this).$js_falsy || $mm('js_falsy')).call($f, test);
          } else {
          check = (($h = this).$js_truthy || $mm('js_truthy')).call($h, test)
        };
        code = "if (" + (check) + ") {\n";
        if (truthy !== false && truthy !== nil) {
          ($i = (($j = this).$indent || $mm('indent')), $i._p = (TMP_47 = function() {

            var self = TMP_47._s || this, $a, $b, $c, $d;
            if (self.indent == null) self.indent = nil;

            
            return code = (($a = code)['$+'] || $mm('+')).call($a, ($b = self.indent, $c = (($d = self).$process || $mm('process')).call($d, truthy, "stmt"), typeof($b) === 'number' ? $b + $c : $b['$+']($c)))
          }, TMP_47._s = this, TMP_47), $i).call($j)
        };
        if (falsy !== false && falsy !== nil) {
          ($i = (($k = this).$indent || $mm('indent')), $i._p = (TMP_48 = function() {

            var self = TMP_48._s || this, $a, $b;
            if (self.indent == null) self.indent = nil;

            
            return code = (($a = code)['$+'] || $mm('+')).call($a, "\n" + (self.indent) + "} else {\n" + (self.indent) + ((($b = self).$process || $mm('process')).call($b, falsy, "stmt")))
          }, TMP_48._s = this, TMP_48), $i).call($k)
        };
        code = (($i = code)['$+'] || $mm('+')).call($i, "\n" + (this.indent) + "}");
        if (returnable !== false && returnable !== nil) {
          code = "(function() { " + (code) + "; return nil; }).call(" + ((($l = this).$current_self || $mm('current_self')).call($l)) + ")"
        };
        return code;
      };

      def.$js_truthy_optimize = function(sexp) {
        var mid = nil, name = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
        if ((($a = (($b = sexp).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "call")) {
          mid = (($c = sexp)['$[]'] || $mm('[]')).call($c, 2);
          if ((($d = mid)['$=='] || $mm('==')).call($d, "block_given?")) {
            return (($e = this).$process || $mm('process')).call($e, sexp, "expr")
            } else {
            if (($f = (($g = (($h = __scope.COMPARE) == null ? __opal.cm("COMPARE") : $h))['$include?'] || $mm('include?')).call($g, (($h = mid).$to_s || $mm('to_s')).call($h))) !== false && $f !== nil) {
              return (($f = this).$process || $mm('process')).call($f, sexp, "expr")
              } else {
              if ((($i = mid)['$=='] || $mm('==')).call($i, "==")) {
                return (($j = this).$process || $mm('process')).call($j, sexp, "expr")
                } else {
                return nil
              }
            }
          };
          } else {
          if (($k = (($l = ["lvar", "self"])['$include?'] || $mm('include?')).call($l, (($m = sexp).$first || $mm('first')).call($m))) !== false && $k !== nil) {
            name = (($k = this).$process || $mm('process')).call($k, sexp, "expr");
            return "" + (name) + " !== false && " + (name) + " !== nil";
            } else {
            return nil
          }
        };
      };

      def.$js_truthy = function(sexp) {
        var optimized = nil, $a, $b, TMP_49, $c;
        if (($a = optimized = (($b = this).$js_truthy_optimize || $mm('js_truthy_optimize')).call($b, sexp)) !== false && $a !== nil) {
          return optimized
        };
        return ($a = (($c = this).$with_temp || $mm('with_temp')), $a._p = (TMP_49 = function(tmp) {

          var self = TMP_49._s || this, $a, $b;
          if (tmp == null) tmp = nil;

          return (($a = "(%s = %s) !== false && %s !== nil")['$%'] || $mm('%')).call($a, [tmp, (($b = self).$process || $mm('process')).call($b, sexp, "expr"), tmp])
        }, TMP_49._s = this, TMP_49), $a).call($c);
      };

      def.$js_falsy = function(sexp) {
        var mid = nil, $a, $b, $c, $d, $e, TMP_50, $f, $g;
        if ((($a = (($b = sexp).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "call")) {
          mid = (($c = sexp)['$[]'] || $mm('[]')).call($c, 2);
          if ((($d = mid)['$=='] || $mm('==')).call($d, "block_given?")) {
            return (($e = this).$handle_block_given || $mm('handle_block_given')).call($e, sexp, true)
          };
        };
        return ($f = (($g = this).$with_temp || $mm('with_temp')), $f._p = (TMP_50 = function(tmp) {

          var self = TMP_50._s || this, $a, $b;
          if (tmp == null) tmp = nil;

          return (($a = "(%s = %s) === false || %s === nil")['$%'] || $mm('%')).call($a, [tmp, (($b = self).$process || $mm('process')).call($b, sexp, "expr"), tmp])
        }, TMP_50._s = this, TMP_50), $f).call($g);
      };

      def.$process_and = function(sexp, level) {
        var lhs = nil, rhs = nil, t = nil, tmp = nil, $a, $b, $c, TMP_51, $d, $e, $f, $g, $h;
        (($a = sexp)._isArray ? $a : ($a = [$a])), lhs = ($a[0] == null ? nil : $a[0]), rhs = ($a[1] == null ? nil : $a[1]);
        t = nil;
        tmp = (($a = this.scope).$new_temp || $mm('new_temp')).call($a);
        if (($b = t = (($c = this).$js_truthy_optimize || $mm('js_truthy_optimize')).call($c, lhs)) !== false && $b !== nil) {
          return ($b = (($d = ("((" + (tmp) + " = " + (t) + ") ? " + ((($e = this).$process || $mm('process')).call($e, rhs, "expr")) + " : " + (tmp) + ")")).$tap || $mm('tap')), $b._p = (TMP_51 = function() {

            var self = TMP_51._s || this, $a;
            if (self.scope == null) self.scope = nil;

            
            return (($a = self.scope).$queue_temp || $mm('queue_temp')).call($a, tmp)
          }, TMP_51._s = this, TMP_51), $b).call($d)
        };
        (($b = this.scope).$queue_temp || $mm('queue_temp')).call($b, tmp);
        return (($f = "(%s = %s, %s !== false && %s !== nil ? %s : %s)")['$%'] || $mm('%')).call($f, [tmp, (($g = this).$process || $mm('process')).call($g, lhs, "expr"), tmp, tmp, (($h = this).$process || $mm('process')).call($h, rhs, "expr"), tmp]);
      };

      def.$process_or = function(sexp, level) {
        var lhs = nil, rhs = nil, t = nil, $a, $b, TMP_52, $c, $d;
        lhs = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        t = nil;
        return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_52 = function(tmp) {

          var self = TMP_52._s || this, $a, $b, $c;
          if (tmp == null) tmp = nil;

          return (($a = "((%s = %s), %s !== false && %s !== nil ? %s : %s)")['$%'] || $mm('%')).call($a, [tmp, (($b = self).$process || $mm('process')).call($b, lhs, "expr"), tmp, tmp, tmp, (($c = self).$process || $mm('process')).call($c, rhs, "expr")])
        }, TMP_52._s = this, TMP_52), $c).call($d);
      };

      def.$process_yield = function(sexp, level) {
        var call = nil, $a, $b, TMP_53, $c, $d;
        call = (($a = this).$handle_yield_call || $mm('handle_yield_call')).call($a, sexp, level);
        if ((($b = level)['$=='] || $mm('==')).call($b, "stmt")) {
          return "if (" + (call) + " === __breaker) return __breaker.$v"
          } else {
          return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_53 = function(tmp) {

            var self = TMP_53._s || this;
            if (tmp == null) tmp = nil;

            return "(((" + (tmp) + " = " + (call) + ") === __breaker) ? __breaker.$v : " + (tmp) + ")"
          }, TMP_53._s = this, TMP_53), $c).call($d)
        };
      };

      def.$process_yasgn = function(sexp, level) {
        var call = nil, $a, $b, $c, $d, $e, $f;
        call = (($a = this).$handle_yield_call || $mm('handle_yield_call')).call($a, (($b = this).$s || $mm('s')).apply($b, [].concat((($c = (($d = sexp)['$[]'] || $mm('[]')).call($d, 1))['$[]'] || $mm('[]')).call($c, __range(1, -1, false)))), "stmt");
        return (($e = "if ((%s = %s) === __breaker) return __breaker.$v")['$%'] || $mm('%')).call($e, [(($f = sexp)['$[]'] || $mm('[]')).call($f, 0), call]);
      };

      def.$process_returnable_yield = function(sexp, level) {
        var call = nil, $a, TMP_54, $b, $c;
        call = (($a = this).$handle_yield_call || $mm('handle_yield_call')).call($a, sexp, level);
        return ($b = (($c = this).$with_temp || $mm('with_temp')), $b._p = (TMP_54 = function(tmp) {

          var self = TMP_54._s || this, $a;
          if (tmp == null) tmp = nil;

          return (($a = "return %s = %s, %s === __breaker ? %s : %s")['$%'] || $mm('%')).call($a, [tmp, call, tmp, tmp, tmp])
        }, TMP_54._s = this, TMP_54), $b).call($c);
      };

      def.$handle_yield_call = function(sexp, level) {
        var splat = nil, args = nil, y = nil, $a, TMP_55, $b, $c, $d, $e, $f, $g;
        (($a = this.scope)['$uses_block!'] || $mm('uses_block!')).call($a);
        splat = ($b = (($c = sexp)['$any?'] || $mm('any?')), $b._p = (TMP_55 = function(s) {

          var self = TMP_55._s || this, $a, $b;
          if (s == null) s = nil;

          return (($a = (($b = s).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "splat")
        }, TMP_55._s = this, TMP_55), $b).call($c);
        if (($b = splat) === false || $b === nil) {
          (($b = sexp).$unshift || $mm('unshift')).call($b, (($d = this).$s || $mm('s')).call($d, "js_tmp", "null"))
        };
        args = (($e = this).$process_arglist || $mm('process_arglist')).call($e, sexp, level);
        y = (($f = (($g = this.scope).$block_name || $mm('block_name')).call($g)), $f !== false && $f !== nil ? $f : "__yield");
        if (splat !== false && splat !== nil) {
          return "" + (y) + ".apply(null, " + (args) + ")"
          } else {
          return "" + (y) + ".call(" + (args) + ")"
        };
      };

      def.$process_break = function(exp, level) {
        var val = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i;
        val = (function() { if (($a = (($b = exp)['$empty?'] || $mm('empty?')).call($b)) !== false && $a !== nil) {
          return "nil"
          } else {
          return (($a = this).$process || $mm('process')).call($a, (($c = exp).$shift || $mm('shift')).call($c), "expr")
        }; return nil; }).call(this);
        if (($d = (($e = this)['$in_while?'] || $mm('in_while?')).call($e)) !== false && $d !== nil) {
          if (($d = (($f = this.while_loop)['$[]'] || $mm('[]')).call($f, "closure")) !== false && $d !== nil) {
            return "return " + (val) + ";"
            } else {
            return "break;"
          }
          } else {
          if (($d = (($g = this.scope)['$iter?'] || $mm('iter?')).call($g)) !== false && $d !== nil) {
            if (($d = (($h = level)['$=='] || $mm('==')).call($h, "stmt")) === false || $d === nil) {
              (($d = this).$error || $mm('error')).call($d, "break must be used as a statement")
            };
            return "return (__breaker.$v = " + (val) + ", __breaker)";
            } else {
            return (($i = this).$error || $mm('error')).call($i, "void value expression: cannot use break outside of iter/while")
          }
        };
      };

      def.$process_case = function(exp, level) {
        var code = nil, expr = nil, returnable = nil, done_else = nil, wen = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r;
        code = [];
        (($a = this.scope).$add_local || $mm('add_local')).call($a, "$case");
        expr = (($b = this).$process || $mm('process')).call($b, (($c = exp).$shift || $mm('shift')).call($c), "expr");
        returnable = ($d = (($e = level)['$=='] || $mm('==')).call($e, "stmt"), ($d === nil || $d === false));
        done_else = false;
        while (!(($f = (($g = exp)['$empty?'] || $mm('empty?')).call($g)) !== false && $f !== nil)) {wen = (($f = exp).$shift || $mm('shift')).call($f);
        if (($h = (($i = wen !== false && wen !== nil) ? (($j = (($k = wen).$first || $mm('first')).call($k))['$=='] || $mm('==')).call($j, "when") : $i)) !== false && $h !== nil) {
          if (returnable !== false && returnable !== nil) {
            (($h = this).$returns || $mm('returns')).call($h, wen)
          };
          wen = (($i = this).$process || $mm('process')).call($i, wen, "stmt");
          if (($l = (($m = code)['$empty?'] || $mm('empty?')).call($m)) === false || $l === nil) {
            wen = "else " + (wen)
          };
          (($l = code)['$<<'] || $mm('<<')).call($l, wen);
          } else {
          if (wen !== false && wen !== nil) {
            done_else = true;
            if (returnable !== false && returnable !== nil) {
              wen = (($n = this).$returns || $mm('returns')).call($n, wen)
            };
            (($o = code)['$<<'] || $mm('<<')).call($o, "else {" + ((($p = this).$process || $mm('process')).call($p, wen, "stmt")) + "}");
          }
        };};
        if (($d = (($q = returnable !== false && returnable !== nil) ? ($r = done_else, ($r === nil || $r === false)) : $q)) !== false && $d !== nil) {
          (($d = code)['$<<'] || $mm('<<')).call($d, "else {return nil}")
        };
        code = "$case = " + (expr) + ";" + ((($q = code).$join || $mm('join')).call($q, this.space));
        if (returnable !== false && returnable !== nil) {
          code = "(function() { " + (code) + " }).call(" + ((($r = this).$current_self || $mm('current_self')).call($r)) + ")"
        };
        return code;
      };

      def.$process_when = function(exp, level) {
        var arg = nil, body = nil, test = nil, a = nil, call = nil, splt = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z;
        arg = (($a = (($b = exp).$shift || $mm('shift')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        body = (($c = exp).$shift || $mm('shift')).call($c);
        if (body !== false && body !== nil) {
          body = (($d = this).$process || $mm('process')).call($d, body, level)
        };
        test = [];
        while (!(($f = (($g = arg)['$empty?'] || $mm('empty?')).call($g)) !== false && $f !== nil)) {a = (($f = arg).$shift || $mm('shift')).call($f);
        if ((($h = (($i = a).$first || $mm('first')).call($i))['$=='] || $mm('==')).call($h, "splat")) {
          call = (($j = this).$s || $mm('s')).call($j, "call", (($k = this).$s || $mm('s')).call($k, "js_tmp", "$splt[i]"), "===", (($l = this).$s || $mm('s')).call($l, "arglist", (($m = this).$s || $mm('s')).call($m, "js_tmp", "$case")));
          splt = "(function($splt) {for(var i = 0; i < $splt.length; i++) {";
          splt = (($n = splt)['$+'] || $mm('+')).call($n, "if (" + ((($o = this).$process || $mm('process')).call($o, call, "expr")) + ") { return true; }");
          splt = (($p = splt)['$+'] || $mm('+')).call($p, "} return false; }).call(" + ((($q = this).$current_self || $mm('current_self')).call($q)) + ", " + ((($r = this).$process || $mm('process')).call($r, (($s = a)['$[]'] || $mm('[]')).call($s, 1), "expr")) + ")");
          (($t = test)['$<<'] || $mm('<<')).call($t, splt);
          } else {
          call = (($u = this).$s || $mm('s')).call($u, "call", a, "===", (($v = this).$s || $mm('s')).call($v, "arglist", (($w = this).$s || $mm('s')).call($w, "js_tmp", "$case")));
          call = (($x = this).$process || $mm('process')).call($x, call, "expr");
          (($y = test)['$<<'] || $mm('<<')).call($y, call);
        };};
        return (($e = "if (%s) {%s%s%s}")['$%'] || $mm('%')).call($e, [(($z = test).$join || $mm('join')).call($z, " || "), this.space, body, this.space]);
      };

      def.$process_match3 = function(sexp, level) {
        var lhs = nil, rhs = nil, call = nil, $a, $b, $c, $d, $e;
        lhs = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        call = (($c = this).$s || $mm('s')).call($c, "call", lhs, "=~", (($d = this).$s || $mm('s')).call($d, "arglist", rhs));
        return (($e = this).$process || $mm('process')).call($e, call, level);
      };

      def.$process_cvar = function(exp, level) {
        var TMP_56, $a, $b;
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_56 = function(tmp) {

          var self = TMP_56._s || this, $a, $b, $c, $d;
          if (tmp == null) tmp = nil;

          return (($a = "((%s = Opal.cvars[%s]) == null ? nil : %s)")['$%'] || $mm('%')).call($a, [tmp, (($b = (($c = (($d = exp).$shift || $mm('shift')).call($d)).$to_s || $mm('to_s')).call($c)).$inspect || $mm('inspect')).call($b), tmp])
        }, TMP_56._s = this, TMP_56), $a).call($b);
      };

      def.$process_cvasgn = function(exp, level) {
        var $a, $b, $c, $d, $e;
        return "(Opal.cvars[" + ((($a = (($b = (($c = exp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b)).$inspect || $mm('inspect')).call($a)) + "] = " + ((($d = this).$process || $mm('process')).call($d, (($e = exp).$shift || $mm('shift')).call($e), "expr")) + ")";
      };

      def.$process_cvdecl = function(exp, level) {
        var $a, $b, $c, $d, $e;
        return "(Opal.cvars[" + ((($a = (($b = (($c = exp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b)).$inspect || $mm('inspect')).call($a)) + "] = " + ((($d = this).$process || $mm('process')).call($d, (($e = exp).$shift || $mm('shift')).call($e), "expr")) + ")";
      };

      def.$process_colon2 = function(sexp, level) {
        var base = nil, cname = nil, $a, $b, $c, $d, TMP_57, $e;
        base = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        cname = (($b = (($c = sexp)['$[]'] || $mm('[]')).call($c, 1)).$to_s || $mm('to_s')).call($b);
        if (($d = this.const_missing) !== false && $d !== nil) {
          return ($d = (($e = this).$with_temp || $mm('with_temp')), $d._p = (TMP_57 = function(t) {

            var self = TMP_57._s || this, $a, $b;
            if (t == null) t = nil;

            base = (($a = self).$process || $mm('process')).call($a, base, "expr");
            return "((" + (t) + " = (" + (base) + ")._scope)." + (cname) + " == null ? " + (t) + ".cm(" + ((($b = cname).$inspect || $mm('inspect')).call($b)) + ") : " + (t) + "." + (cname) + ")";
          }, TMP_57._s = this, TMP_57), $d).call($e)
          } else {
          base = (($d = this).$process || $mm('process')).call($d, base, "expr");
          return "(" + (base) + ")._scope." + (cname);
        };
      };

      def.$process_colon3 = function(exp, level) {
        var TMP_58, $a, $b;
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_58 = function(t) {

          var cname = nil, self = TMP_58._s || this, $a, $b, $c;
          if (t == null) t = nil;

          cname = (($a = (($b = exp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
          return "((" + (t) + " = __opal.Object._scope." + (cname) + ") == null ? __opal.cm(" + ((($c = cname).$inspect || $mm('inspect')).call($c)) + ") : " + (t) + ")";
        }, TMP_58._s = this, TMP_58), $a).call($b);
      };

      def.$process_super = function(sexp, level) {
        var args = nil, $a, $b, $c, $d, $e, $f;
        args = [];
        while (!(($b = (($c = sexp)['$empty?'] || $mm('empty?')).call($c)) !== false && $b !== nil)) {(($b = args)['$<<'] || $mm('<<')).call($b, (($d = this).$process || $mm('process')).call($d, (($e = sexp).$shift || $mm('shift')).call($e), "expr"))};
        return (($a = this).$js_super || $mm('js_super')).call($a, "[" + ((($f = args).$join || $mm('join')).call($f, ", ")) + "]");
      };

      def.$process_zsuper = function(exp, level) {
        var $a;
        return (($a = this).$js_super || $mm('js_super')).call($a, "__slice.call(arguments)");
      };

      def.$js_super = function(args) {
        var mid = nil, sid = nil, identity = nil, cls_name = nil, jsid = nil, chain = nil, defn = nil, trys = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, TMP_59, $y, $z, $aa, $ab;
        if (($a = (($b = this.scope)['$def_in_class?'] || $mm('def_in_class?')).call($b)) !== false && $a !== nil) {
          mid = (($a = (($c = this.scope).$mid || $mm('mid')).call($c)).$to_s || $mm('to_s')).call($a);
          sid = "super_" + ((($d = this).$unique_temp || $mm('unique_temp')).call($d));
          (($e = this.scope)['$uses_super='] || $mm('uses_super=')).call($e, sid);
          return "" + (sid) + ".apply(" + ((($f = this).$current_self || $mm('current_self')).call($f)) + ", " + (args) + ")";
          } else {
          if ((($g = (($h = this.scope).$type || $mm('type')).call($h))['$=='] || $mm('==')).call($g, "def")) {
            identity = (($i = this.scope)['$identify!'] || $mm('identify!')).call($i);
            cls_name = (($j = (($k = (($l = this.scope).$parent || $mm('parent')).call($l)).$name || $mm('name')).call($k)), $j !== false && $j !== nil ? $j : "" + ((($m = this).$current_self || $mm('current_self')).call($m)) + "._klass.prototype");
            jsid = (($j = this).$mid_to_jsid || $mm('mid_to_jsid')).call($j, (($n = (($o = this.scope).$mid || $mm('mid')).call($o)).$to_s || $mm('to_s')).call($n));
            if (($p = (($q = this.scope).$defs || $mm('defs')).call($q)) !== false && $p !== nil) {
              return (($p = "%s._super%s.apply(this, %s)")['$%'] || $mm('%')).call($p, [cls_name, jsid, args])
              } else {
              return (($r = ("" + ((($s = this).$current_self || $mm('current_self')).call($s)) + "._klass._super.prototype%s.apply(" + ((($t = this).$current_self || $mm('current_self')).call($t)) + ", %s)"))['$%'] || $mm('%')).call($r, [jsid, args])
            };
            } else {
            if ((($u = (($v = this.scope).$type || $mm('type')).call($v))['$=='] || $mm('==')).call($u, "iter")) {
              (($w = (($x = this.scope).$get_super_chain || $mm('get_super_chain')).call($x))._isArray ? $w : ($w = [$w])), chain = ($w[0] == null ? nil : $w[0]), defn = ($w[1] == null ? nil : $w[1]), mid = ($w[2] == null ? nil : $w[2]);
              trys = (($w = ($y = (($z = chain).$map || $mm('map')), $y._p = (TMP_59 = function(c) {

                var self = TMP_59._s || this;
                if (c == null) c = nil;

                return "" + (c) + "._sup"
              }, TMP_59._s = this, TMP_59), $y).call($z)).$join || $mm('join')).call($w, " || ");
              return "(" + (trys) + " || " + ((($y = this).$current_self || $mm('current_self')).call($y)) + "._klass._super.prototype[" + (mid) + "]).apply(" + ((($aa = this).$current_self || $mm('current_self')).call($aa)) + ", " + (args) + ")";
              } else {
              return (($ab = this).$raise || $mm('raise')).call($ab, "Cannot call super() from outside a method block")
            }
          }
        };
      };

      def.$process_op_asgn_or = function(exp, level) {
        var $a, $b, $c, $d;
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "or", (($c = exp).$shift || $mm('shift')).call($c), (($d = exp).$shift || $mm('shift')).call($d)), "expr");
      };

      def.$process_op_asgn_and = function(sexp, level) {
        var $a, $b, $c, $d;
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "and", (($c = sexp).$shift || $mm('shift')).call($c), (($d = sexp).$shift || $mm('shift')).call($d)), "expr");
      };

      def.$process_op_asgn1 = function(sexp, level) {
        var lhs = nil, arglist = nil, op = nil, rhs = nil, $a, TMP_60, $b;
        (($a = sexp)._isArray ? $a : ($a = [$a])), lhs = ($a[0] == null ? nil : $a[0]), arglist = ($a[1] == null ? nil : $a[1]), op = ($a[2] == null ? nil : $a[2]), rhs = ($a[3] == null ? nil : $a[3]);
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_60 = function(a) {

          var self = TMP_60._s || this, TMP_61, $a, $b;
          if (a == null) a = nil;

          return ($a = (($b = self).$with_temp || $mm('with_temp')), $a._p = (TMP_61 = function(r) {

            var args = nil, recv = nil, aref = nil, aset = nil, orop = nil, self = TMP_61._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
            if (r == null) r = nil;

            args = (($a = self).$process || $mm('process')).call($a, (($b = arglist)['$[]'] || $mm('[]')).call($b, 1), "expr");
            recv = (($c = self).$process || $mm('process')).call($c, lhs, "expr");
            aref = (($d = self).$s || $mm('s')).call($d, "call", (($e = self).$s || $mm('s')).call($e, "js_tmp", r), "[]", (($f = self).$s || $mm('s')).call($f, "arglist", (($g = self).$s || $mm('s')).call($g, "js_tmp", a)));
            aset = (($h = self).$s || $mm('s')).call($h, "call", (($i = self).$s || $mm('s')).call($i, "js_tmp", r), "[]=", (($j = self).$s || $mm('s')).call($j, "arglist", (($k = self).$s || $mm('s')).call($k, "js_tmp", a), rhs));
            orop = (($l = self).$s || $mm('s')).call($l, "or", aref, aset);
            return "(" + (a) + " = " + (args) + ", " + (r) + " = " + (recv) + ", " + ((($m = self).$process || $mm('process')).call($m, orop, "expr")) + ")";
          }, TMP_61._s = self, TMP_61), $a).call($b)
        }, TMP_60._s = this, TMP_60), $a).call($b);
      };

      def.$process_op_asgn2 = function(exp, level) {
        var lhs = nil, mid = nil, op = nil, rhs = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, TMP_62, $j, $k, $l, TMP_63, $m, $n, TMP_64, $o;
        lhs = (($a = this).$process || $mm('process')).call($a, (($b = exp).$shift || $mm('shift')).call($b), "expr");
        mid = (($c = (($d = (($e = exp).$shift || $mm('shift')).call($e)).$to_s || $mm('to_s')).call($d))['$[]'] || $mm('[]')).call($c, __range(0, -2, false));
        op = (($f = exp).$shift || $mm('shift')).call($f);
        rhs = (($g = exp).$shift || $mm('shift')).call($g);
        if ((($h = (($i = op).$to_s || $mm('to_s')).call($i))['$=='] || $mm('==')).call($h, "||")) {
          return ($j = (($k = this).$with_temp || $mm('with_temp')), $j._p = (TMP_62 = function(temp) {

            var getr = nil, asgn = nil, orop = nil, self = TMP_62._s || this, $a, $b, $c, $d, $e, $f, $g, $h;
            if (temp == null) temp = nil;

            getr = (($a = self).$s || $mm('s')).call($a, "call", (($b = self).$s || $mm('s')).call($b, "js_tmp", temp), mid, (($c = self).$s || $mm('s')).call($c, "arglist"));
            asgn = (($d = self).$s || $mm('s')).call($d, "call", (($e = self).$s || $mm('s')).call($e, "js_tmp", temp), "" + (mid) + "=", (($f = self).$s || $mm('s')).call($f, "arglist", rhs));
            orop = (($g = self).$s || $mm('s')).call($g, "or", getr, asgn);
            return "(" + (temp) + " = " + (lhs) + ", " + ((($h = self).$process || $mm('process')).call($h, orop, "expr")) + ")";
          }, TMP_62._s = this, TMP_62), $j).call($k)
          } else {
          if ((($j = (($l = op).$to_s || $mm('to_s')).call($l))['$=='] || $mm('==')).call($j, "&&")) {
            return ($m = (($n = this).$with_temp || $mm('with_temp')), $m._p = (TMP_63 = function(temp) {

              var getr = nil, asgn = nil, andop = nil, self = TMP_63._s || this, $a, $b, $c, $d, $e, $f, $g, $h;
              if (temp == null) temp = nil;

              getr = (($a = self).$s || $mm('s')).call($a, "call", (($b = self).$s || $mm('s')).call($b, "js_tmp", temp), mid, (($c = self).$s || $mm('s')).call($c, "arglist"));
              asgn = (($d = self).$s || $mm('s')).call($d, "call", (($e = self).$s || $mm('s')).call($e, "js_tmp", temp), "" + (mid) + "=", (($f = self).$s || $mm('s')).call($f, "arglist", rhs));
              andop = (($g = self).$s || $mm('s')).call($g, "and", getr, asgn);
              return "(" + (temp) + " = " + (lhs) + ", " + ((($h = self).$process || $mm('process')).call($h, andop, "expr")) + ")";
            }, TMP_63._s = this, TMP_63), $m).call($n)
            } else {
            return ($m = (($o = this).$with_temp || $mm('with_temp')), $m._p = (TMP_64 = function(temp) {

              var getr = nil, oper = nil, asgn = nil, self = TMP_64._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i;
              if (temp == null) temp = nil;

              getr = (($a = self).$s || $mm('s')).call($a, "call", (($b = self).$s || $mm('s')).call($b, "js_tmp", temp), mid, (($c = self).$s || $mm('s')).call($c, "arglist"));
              oper = (($d = self).$s || $mm('s')).call($d, "call", getr, op, (($e = self).$s || $mm('s')).call($e, "arglist", rhs));
              asgn = (($f = self).$s || $mm('s')).call($f, "call", (($g = self).$s || $mm('s')).call($g, "js_tmp", temp), "" + (mid) + "=", (($h = self).$s || $mm('s')).call($h, "arglist", oper));
              return "(" + (temp) + " = " + (lhs) + ", " + ((($i = self).$process || $mm('process')).call($i, asgn, "expr")) + ")";
            }, TMP_64._s = this, TMP_64), $m).call($o)
          }
        };
      };

      def.$process_ensure = function(exp, level) {
        var begn = nil, retn = nil, body = nil, ensr = nil, res = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j;
        begn = (($a = exp).$shift || $mm('shift')).call($a);
        if (($b = (($c = (($d = level)['$=='] || $mm('==')).call($d, "recv")), $c !== false && $c !== nil ? $c : (($e = level)['$=='] || $mm('==')).call($e, "expr"))) !== false && $b !== nil) {
          retn = true;
          begn = (($b = this).$returns || $mm('returns')).call($b, begn);
        };
        body = (($c = this).$process || $mm('process')).call($c, begn, level);
        ensr = (($f = (($g = exp).$shift || $mm('shift')).call($g)), $f !== false && $f !== nil ? $f : (($h = this).$s || $mm('s')).call($h, "nil"));
        ensr = (($f = this).$process || $mm('process')).call($f, ensr, level);
        if (($i = (($j = body)['$=~'] || $mm('=~')).call($j, /^try \{/)) === false || $i === nil) {
          body = "try {\n" + (body) + "}"
        };
        res = "" + (body) + (this.space) + "finally {" + (this.space) + (ensr) + "}";
        if (retn !== false && retn !== nil) {
          res = "(function() { " + (res) + "; }).call(" + ((($i = this).$current_self || $mm('current_self')).call($i)) + ")"
        };
        return res;
      };

      def.$process_rescue = function(exp, level) {
        var body = nil, handled_else = nil, parts = nil, part = nil, code = nil, $a, $b, $c, $d, $e, TMP_65, $f, $g, $h, $i, $j, $k, $l, TMP_66, $m, $n, $o, TMP_67, $p, $q, $r;
        body = (function() { if ((($a = (($b = (($c = exp).$first || $mm('first')).call($c)).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "resbody")) {
          return (($d = this).$s || $mm('s')).call($d, "nil")
          } else {
          return (($e = exp).$shift || $mm('shift')).call($e)
        }; return nil; }).call(this);
        body = ($f = (($g = this).$indent || $mm('indent')), $f._p = (TMP_65 = function() {

          var self = TMP_65._s || this, $a;
          
          return (($a = self).$process || $mm('process')).call($a, body, level)
        }, TMP_65._s = this, TMP_65), $f).call($g);
        handled_else = false;
        parts = [];
        while (!(($h = (($i = exp)['$empty?'] || $mm('empty?')).call($i)) !== false && $h !== nil)) {if (($h = (($j = (($k = (($l = exp).$first || $mm('first')).call($l)).$first || $mm('first')).call($k))['$=='] || $mm('==')).call($j, "resbody")) === false || $h === nil) {
          handled_else = true
        };
        part = ($h = (($m = this).$indent || $mm('indent')), $h._p = (TMP_66 = function() {

          var self = TMP_66._s || this, $a, $b;
          
          return (($a = self).$process || $mm('process')).call($a, (($b = exp).$shift || $mm('shift')).call($b), level)
        }, TMP_66._s = this, TMP_66), $h).call($m);
        if (($h = (($n = parts)['$empty?'] || $mm('empty?')).call($n)) === false || $h === nil) {
          part = ($h = "else ", $o = part, typeof($h) === 'number' ? $h + $o : $h['$+']($o))
        };
        (($h = parts)['$<<'] || $mm('<<')).call($h, part);};
        if (($f = handled_else) === false || $f === nil) {
          (($f = parts)['$<<'] || $mm('<<')).call($f, ($o = (($p = this).$indent || $mm('indent')), $o._p = (TMP_67 = function() {

            var self = TMP_67._s || this;
            
            return "else { throw $err; }"
          }, TMP_67._s = this, TMP_67), $o).call($p))
        };
        code = "try {" + (this.space) + ((($o = __scope.INDENT) == null ? __opal.cm("INDENT") : $o)) + (body) + (this.space) + "} catch ($err) {" + (this.space) + ((($o = parts).$join || $mm('join')).call($o, this.space)) + (this.space) + "}";
        if ((($q = level)['$=='] || $mm('==')).call($q, "expr")) {
          code = "(function() { " + (code) + " }).call(" + ((($r = this).$current_self || $mm('current_self')).call($r)) + ")"
        };
        return code;
      };

      def.$process_resbody = function(exp, level) {
        var args = nil, body = nil, types = nil, err = nil, val = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, TMP_68, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x;
        args = (($a = exp)['$[]'] || $mm('[]')).call($a, 0);
        body = (($b = exp)['$[]'] || $mm('[]')).call($b, 1);
        body = (($c = this).$process || $mm('process')).call($c, (($d = body), $d !== false && $d !== nil ? $d : (($e = this).$s || $mm('s')).call($e, "nil")), level);
        types = (($d = args)['$[]'] || $mm('[]')).call($d, __range(1, -1, false));
        if (($f = ($g = (($g = types).$last || $mm('last')).call($g), $g !== false && $g !== nil ? ($h = (($i = (($j = (($k = types).$last || $mm('last')).call($k)).$first || $mm('first')).call($j))['$=='] || $mm('==')).call($i, "const"), ($h === nil || $h === false)) : $g)) !== false && $f !== nil) {
          (($f = types).$pop || $mm('pop')).call($f)
        };
        err = (($h = ($l = (($m = types).$map || $mm('map')), $l._p = (TMP_68 = function(t) {

          var call = nil, a = nil, self = TMP_68._s || this, $a, $b, $c, $d;
          if (t == null) t = nil;

          call = (($a = self).$s || $mm('s')).call($a, "call", t, "===", (($b = self).$s || $mm('s')).call($b, "arglist", (($c = self).$s || $mm('s')).call($c, "js_tmp", "$err")));
          a = (($d = self).$process || $mm('process')).call($d, call, "expr");
          return a;
        }, TMP_68._s = this, TMP_68), $l).call($m)).$join || $mm('join')).call($h, ", ");
        if (($l = (($n = err)['$empty?'] || $mm('empty?')).call($n)) !== false && $l !== nil) {
          err = "true"
        };
        if (($l = ($o = (($o = (($p = __scope.Array) == null ? __opal.cm("Array") : $p))['$==='] || $mm('===')).call($o, (($p = args).$last || $mm('last')).call($p)), $o !== false && $o !== nil ? (($q = ["lasgn", "iasgn"])['$include?'] || $mm('include?')).call($q, (($r = (($s = args).$last || $mm('last')).call($s)).$first || $mm('first')).call($r)) : $o)) !== false && $l !== nil) {
          val = (($l = args).$last || $mm('last')).call($l);
          (($t = val)['$[]='] || $mm('[]=')).call($t, 2, (($u = this).$s || $mm('s')).call($u, "js_tmp", "$err"));
          val = ($v = (($x = this).$process || $mm('process')).call($x, val, "expr"), $w = ";", typeof($v) === 'number' ? $v + $w : $v['$+']($w));
        };
        return "if (" + (err) + ") {" + (this.space) + (val) + (body) + "}";
      };

      def.$process_begin = function(exp, level) {
        var $a, $b;
        return (($a = this).$process || $mm('process')).call($a, (($b = exp)['$[]'] || $mm('[]')).call($b, 0), level);
      };

      def.$process_next = function(exp, level) {
        var $a, $b, $c, $d;
        if (($a = (($b = this)['$in_while?'] || $mm('in_while?')).call($b)) !== false && $a !== nil) {
          return "continue;"
          } else {
          return "return " + ((function() { if (($a = (($c = exp)['$empty?'] || $mm('empty?')).call($c)) !== false && $a !== nil) {
            return "nil"
            } else {
            return (($a = this).$process || $mm('process')).call($a, (($d = exp).$shift || $mm('shift')).call($d), "expr")
          }; return nil; }).call(this)) + ";"
        };
      };

      def.$process_redo = function(exp, level) {
        var $a, $b, $c;
        if (($a = (($b = this)['$in_while?'] || $mm('in_while?')).call($b)) !== false && $a !== nil) {
          (($a = this.while_loop)['$[]='] || $mm('[]=')).call($a, "use_redo", true);
          return "" + ((($c = this.while_loop)['$[]'] || $mm('[]')).call($c, "redo_var")) + " = true";
          } else {
          return "REDO()"
        };
      };

      return nil;
    })(Opal, null)
    
  })(self);
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass, __hash2 = __opal.hash2;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope;

    (function(__base, __super){
      function TargetScope() {};
      TargetScope = __klass(__base, __super, "TargetScope", TargetScope);

      var def = TargetScope.prototype, __scope = TargetScope._scope;
      def.parent = def.name = def.block_name = def.scope_name = def.ivars = def.type = def.defines_defn = def.defines_defs = def.mid = def.defs = def.methods = def.uses_super = def.locals = def.temps = def.parser = def.proto_ivars = def.args = def.queue = def.unique = def.while_stack = def.identity = def.uses_block = nil;

      def.$parent = function() {
        
        return this.parent
      }, 
      def['$parent='] = function(val) {
        
        return this.parent = val
      }, nil;

      def.$name = function() {
        
        return this.name
      }, 
      def['$name='] = function(val) {
        
        return this.name = val
      }, nil;

      def.$block_name = function() {
        
        return this.block_name
      }, 
      def['$block_name='] = function(val) {
        
        return this.block_name = val
      }, nil;

      def.$scope_name = function() {
        
        return this.scope_name
      }, nil;

      def.$ivars = function() {
        
        return this.ivars
      }, nil;

      def.$type = function() {
        
        return this.type
      }, nil;

      def.$defines_defn = function() {
        
        return this.defines_defn
      }, 
      def['$defines_defn='] = function(val) {
        
        return this.defines_defn = val
      }, nil;

      def.$defines_defs = function() {
        
        return this.defines_defs
      }, 
      def['$defines_defs='] = function(val) {
        
        return this.defines_defs = val
      }, nil;

      def.$mid = function() {
        
        return this.mid
      }, 
      def['$mid='] = function(val) {
        
        return this.mid = val
      }, nil;

      def.$defs = function() {
        
        return this.defs
      }, 
      def['$defs='] = function(val) {
        
        return this.defs = val
      }, nil;

      def.$methods = function() {
        
        return this.methods
      }, nil;

      def.$uses_super = function() {
        
        return this.uses_super
      }, 
      def['$uses_super='] = function(val) {
        
        return this.uses_super = val
      }, nil;

      def.$initialize = function(type, parser) {
        
        this.parser = parser;
        this.type = type;
        this.locals = [];
        this.temps = [];
        this.args = [];
        this.ivars = [];
        this.parent = nil;
        this.queue = [];
        this.unique = "a";
        this.while_stack = [];
        this.defines_defs = false;
        this.defines_defn = false;
        this.methods = [];
        this.uses_block = false;
        return this.proto_ivars = [];
      };

      def['$class_scope?'] = function() {
        var $a, $b, $c;
        return (($a = (($b = this.type)['$=='] || $mm('==')).call($b, "class")), $a !== false && $a !== nil ? $a : (($c = this.type)['$=='] || $mm('==')).call($c, "module"));
      };

      def['$class?'] = function() {
        var $a;
        return (($a = this.type)['$=='] || $mm('==')).call($a, "class");
      };

      def['$module?'] = function() {
        var $a;
        return (($a = this.type)['$=='] || $mm('==')).call($a, "module");
      };

      def['$sclass?'] = function() {
        var $a;
        return (($a = this.type)['$=='] || $mm('==')).call($a, "sclass");
      };

      def['$top?'] = function() {
        var $a;
        return (($a = this.type)['$=='] || $mm('==')).call($a, "top");
      };

      def['$iter?'] = function() {
        var $a;
        return (($a = this.type)['$=='] || $mm('==')).call($a, "iter");
      };

      def['$def_in_class?'] = function() {
        var $a, $b;
        return ($a = ($a = ($a = ($a = this.defs, ($a === nil || $a === false)), $a !== false && $a !== nil ? (($a = this.type)['$=='] || $mm('==')).call($a, "def") : $a), $a !== false && $a !== nil ? this.parent : $a), $a !== false && $a !== nil ? (($b = this.parent)['$class?'] || $mm('class?')).call($b) : $a);
      };

      def.$proto = function() {
        
        return "def";
      };

      def['$should_donate?'] = function() {
        var $a, $b, $c, $d;
        return (($a = (($b = this.type)['$=='] || $mm('==')).call($b, "module")), $a !== false && $a !== nil ? $a : (($c = (($d = this.name).$to_s || $mm('to_s')).call($d))['$=='] || $mm('==')).call($c, "Object"));
      };

      def.$to_vars = function() {
        var vars = nil, current_self = nil, iv = nil, indent = nil, res = nil, str = nil, pvars = nil, TMP_1, $a, $b, $c, TMP_2, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, TMP_3, $p;
        vars = ($a = (($b = this.locals).$map || $mm('map')), $a._p = (TMP_1 = function(l) {

          var self = TMP_1._s || this;
          if (l == null) l = nil;

          return "" + (l) + " = nil"
        }, TMP_1._s = this, TMP_1), $a).call($b);
        (($a = vars).$push || $mm('push')).apply($a, [].concat(this.temps));
        current_self = (($c = this.parser).$current_self || $mm('current_self')).call($c);
        iv = ($d = (($e = (($f = this).$ivars || $mm('ivars')).call($f)).$map || $mm('map')), $d._p = (TMP_2 = function(ivar) {

          var self = TMP_2._s || this;
          if (ivar == null) ivar = nil;

          return "if (" + (current_self) + (ivar) + " == null) " + (current_self) + (ivar) + " = nil;\n"
        }, TMP_2._s = this, TMP_2), $d).call($e);
        indent = (($d = this.parser).$parser_indent || $mm('parser_indent')).call($d);
        res = (function() { if (($g = (($h = vars)['$empty?'] || $mm('empty?')).call($h)) !== false && $g !== nil) {
          return ""
          } else {
          return "var " + ((($g = vars).$join || $mm('join')).call($g, ", ")) + ";"
        }; return nil; }).call(this);
        str = (function() { if (($i = (($j = (($k = this).$ivars || $mm('ivars')).call($k))['$empty?'] || $mm('empty?')).call($j)) !== false && $i !== nil) {
          return res
          } else {
          return "" + (res) + "\n" + (indent) + ((($i = iv).$join || $mm('join')).call($i, indent))
        }; return nil; }).call(this);
        if (($l = ($m = (($m = this)['$class?'] || $mm('class?')).call($m), $m !== false && $m !== nil ? ($n = (($o = this.proto_ivars)['$empty?'] || $mm('empty?')).call($o), ($n === nil || $n === false)) : $m)) !== false && $l !== nil) {
          pvars = (($l = ($n = (($p = this.proto_ivars).$map || $mm('map')), $n._p = (TMP_3 = function(i) {

            var self = TMP_3._s || this, $a;
            if (i == null) i = nil;

            return "" + ((($a = self).$proto || $mm('proto')).call($a)) + (i)
          }, TMP_3._s = this, TMP_3), $n).call($p)).$join || $mm('join')).call($l, " = ");
          return (($n = "%s\n%s%s = nil;")['$%'] || $mm('%')).call($n, [str, indent, pvars]);
          } else {
          return str
        };
      };

      def.$to_donate_methods = function() {
        var $a, $b, $c, $d, $e, $f, $g, $h;
        if (($a = ($b = (($b = this)['$should_donate?'] || $mm('should_donate?')).call($b), $b !== false && $b !== nil ? ($c = (($d = this.methods)['$empty?'] || $mm('empty?')).call($d), ($c === nil || $c === false)) : $b)) !== false && $a !== nil) {
          return (($a = ("%s;__opal.donate(" + (this.name) + ", [%s]);"))['$%'] || $mm('%')).call($a, [(($c = this.parser).$parser_indent || $mm('parser_indent')).call($c), (($e = ($g = (($h = this.methods).$map || $mm('map')), $g._p = (($f = "inspect").$to_proc || $mm('to_proc')).call($f), $g).call($h)).$join || $mm('join')).call($e, ", ")])
          } else {
          return ""
        };
      };

      def.$add_ivar = function(ivar) {
        var $a, $b, $c, $d;
        if (($a = (($b = this)['$def_in_class?'] || $mm('def_in_class?')).call($b)) !== false && $a !== nil) {
          return (($a = this.parent).$add_proto_ivar || $mm('add_proto_ivar')).call($a, ivar)
          } else {
          if (($c = (($d = this.ivars)['$include?'] || $mm('include?')).call($d, ivar)) !== false && $c !== nil) {
            return nil
            } else {
            return (($c = this.ivars)['$<<'] || $mm('<<')).call($c, ivar)
          }
        };
      };

      def.$add_proto_ivar = function(ivar) {
        var $a, $b;
        if (($a = (($b = this.proto_ivars)['$include?'] || $mm('include?')).call($b, ivar)) !== false && $a !== nil) {
          return nil
          } else {
          return (($a = this.proto_ivars)['$<<'] || $mm('<<')).call($a, ivar)
        };
      };

      def.$add_arg = function(arg) {
        var $a, $b;
        if (($a = (($b = this.args)['$include?'] || $mm('include?')).call($b, arg)) !== false && $a !== nil) {
          return nil
          } else {
          return (($a = this.args)['$<<'] || $mm('<<')).call($a, arg)
        };
      };

      def.$add_local = function(local) {
        var $a, $b;
        if (($a = (($b = this)['$has_local?'] || $mm('has_local?')).call($b, local)) !== false && $a !== nil) {
          return nil
        };
        return (($a = this.locals)['$<<'] || $mm('<<')).call($a, local);
      };

      def['$has_local?'] = function(local) {
        var $a, $b, $c, $d;
        if (($a = (($b = (($c = this.locals)['$include?'] || $mm('include?')).call($c, local)), $b !== false && $b !== nil ? $b : (($d = this.args)['$include?'] || $mm('include?')).call($d, local))) !== false && $a !== nil) {
          return true
        };
        if (($a = ($b = this.parent, $b !== false && $b !== nil ? (($b = this.type)['$=='] || $mm('==')).call($b, "iter") : $b)) !== false && $a !== nil) {
          return (($a = this.parent)['$has_local?'] || $mm('has_local?')).call($a, local)
        };
        return false;
      };

      def.$add_temp = function(tmps) {
        var $a;tmps = __slice.call(arguments, 0);
        return (($a = this.temps).$push || $mm('push')).apply($a, [].concat(tmps));
      };

      def['$has_temp?'] = function(tmp) {
        var $a;
        return (($a = this.temps)['$include?'] || $mm('include?')).call($a, tmp);
      };

      def.$new_temp = function() {
        var tmp = nil, $a, $b, $c, $d;
        if (($a = (($b = this.queue)['$empty?'] || $mm('empty?')).call($b)) === false || $a === nil) {
          return (($a = this.queue).$pop || $mm('pop')).call($a)
        };
        tmp = "$" + (this.unique);
        this.unique = (($c = this.unique).$succ || $mm('succ')).call($c);
        (($d = this.temps)['$<<'] || $mm('<<')).call($d, tmp);
        return tmp;
      };

      def.$queue_temp = function(name) {
        var $a;
        return (($a = this.queue)['$<<'] || $mm('<<')).call($a, name);
      };

      def.$push_while = function() {
        var info = nil, $a;
        info = __hash2([], {});
        (($a = this.while_stack).$push || $mm('push')).call($a, info);
        return info;
      };

      def.$pop_while = function() {
        var $a;
        return (($a = this.while_stack).$pop || $mm('pop')).call($a);
      };

      def['$in_while?'] = function() {
        var $a, $b;
        return ($a = (($b = this.while_stack)['$empty?'] || $mm('empty?')).call($b), ($a === nil || $a === false));
      };

      def['$uses_block!'] = function() {
        var $a, $b, $c;
        if (($a = (($b = (($c = this.type)['$=='] || $mm('==')).call($c, "iter")) ? this.parent : $b)) !== false && $a !== nil) {
          return (($a = this.parent)['$uses_block!'] || $mm('uses_block!')).call($a)
          } else {
          this.uses_block = true;
          return (($b = this)['$identify!'] || $mm('identify!')).call($b);
        };
      };

      def['$identify!'] = function() {
        var $a, $b;
        if (($a = this.identity) !== false && $a !== nil) {
          return this.identity
        };
        this.identity = (($a = this.parser).$unique_temp || $mm('unique_temp')).call($a);
        if (($b = this.parent) !== false && $b !== nil) {
          (($b = this.parent).$add_temp || $mm('add_temp')).call($b, this.identity)
        };
        return this.identity;
      };

      def.$identity = function() {
        
        return this.identity;
      };

      def.$get_super_chain = function() {
        var chain = nil, scope = nil, defn = nil, mid = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
        $a = [[], this, "null", "null"], chain = $a[0], scope = $a[1], defn = $a[2], mid = $a[3];
        while (scope !== false && scope !== nil){if ((($b = (($c = scope).$type || $mm('type')).call($c))['$=='] || $mm('==')).call($b, "iter")) {
          (($d = chain)['$<<'] || $mm('<<')).call($d, (($e = scope)['$identify!'] || $mm('identify!')).call($e));
          if (($f = (($g = scope).$parent || $mm('parent')).call($g)) !== false && $f !== nil) {
            scope = (($f = scope).$parent || $mm('parent')).call($f)
          };
          } else {
          if ((($h = (($i = scope).$type || $mm('type')).call($i))['$=='] || $mm('==')).call($h, "def")) {
            defn = (($j = scope)['$identify!'] || $mm('identify!')).call($j);
            mid = "'$" + ((($k = scope).$mid || $mm('mid')).call($k)) + "'";
            break;;
            } else {
            break;
          }
        }};
        return [chain, defn, mid];
      };

      def['$uses_block?'] = function() {
        
        return this.uses_block;
      };

      return nil;
    })(Opal, null)
    
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass;
  return (function(__base, __super){
    function Array() {};
    Array = __klass(__base, __super, "Array", Array);

    var def = Array.prototype, __scope = Array._scope;
    def.line = def.end_line = nil;

    def.$line = function() {
      
      return this.line
    }, 
    def['$line='] = function(val) {
      
      return this.line = val
    }, nil;

    return def.$end_line = function() {
      
      return this.end_line
    }, 
    def['$end_line='] = function(val) {
      
      return this.end_line = val
    }, nil;
  })(self, null)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope;

    (function(__base, __super){
      function LexerScope() {};
      LexerScope = __klass(__base, __super, "LexerScope", LexerScope);

      var def = LexerScope.prototype, __scope = LexerScope._scope;
      def.locals = def.parent = def.block = nil;

      def.$locals = function() {
        
        return this.locals
      }, nil;

      def.$parent = function() {
        
        return this.parent
      }, 
      def['$parent='] = function(val) {
        
        return this.parent = val
      }, nil;

      def.$initialize = function(type) {
        var $a;
        this.block = (($a = type)['$=='] || $mm('==')).call($a, "block");
        this.locals = [];
        return this.parent = nil;
      };

      def.$add_local = function(local) {
        var $a;
        return (($a = this.locals)['$<<'] || $mm('<<')).call($a, local);
      };

      def['$has_local?'] = function(local) {
        var $a, $b, $c;
        if (($a = (($b = this.locals)['$include?'] || $mm('include?')).call($b, local)) !== false && $a !== nil) {
          return true
        };
        if (($a = ($c = this.parent, $c !== false && $c !== nil ? this.block : $c)) !== false && $a !== nil) {
          return (($a = this.parent)['$has_local?'] || $mm('has_local?')).call($a, local)
        };
        return false;
      };

      return nil;
    })(Opal, null)
    
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass, __range = __opal.range;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope, $a, $b;

    (function(__base, __super){
      function Grammar() {};
      Grammar = __klass(__base, __super, "Grammar", Grammar);

      var def = Grammar.prototype, __scope = Grammar._scope;
      def.line = def.scope = nil;

      def.$new_block = function(stmt) {
        var s = nil, $a, $b;if (stmt == null) {
          stmt = nil
        }
        s = (($a = this).$s || $mm('s')).call($a, "block");
        if (stmt !== false && stmt !== nil) {
          (($b = s)['$<<'] || $mm('<<')).call($b, stmt)
        };
        return s;
      };

      def.$new_compstmt = function(block) {
        var $a, $b, $c, $d, $e, $f, $g, $h;
        if ((($a = (($b = block).$size || $mm('size')).call($b))['$=='] || $mm('==')).call($a, 1)) {
          return nil
          } else {
          if ((($c = (($d = block).$size || $mm('size')).call($d))['$=='] || $mm('==')).call($c, 2)) {
            return (($e = block)['$[]'] || $mm('[]')).call($e, 1)
            } else {
            (($f = block)['$line='] || $mm('line=')).call($f, (($g = (($h = block)['$[]'] || $mm('[]')).call($h, 1)).$line || $mm('line')).call($g));
            return block;
          }
        };
      };

      def.$new_body = function(compstmt, res, els, ens) {
        var s = nil, $a, $b, $c, $d, TMP_1, $e, $f, $g;
        s = (($a = compstmt), $a !== false && $a !== nil ? $a : (($b = this).$s || $mm('s')).call($b, "block"));
        if (compstmt !== false && compstmt !== nil) {
          (($a = s)['$line='] || $mm('line=')).call($a, (($c = compstmt).$line || $mm('line')).call($c))
        };
        if (res !== false && res !== nil) {
          s = (($d = this).$s || $mm('s')).call($d, "rescue", s);
          ($e = (($f = res).$each || $mm('each')), $e._p = (TMP_1 = function(r) {

            var self = TMP_1._s || this, $a;
            if (r == null) r = nil;

            return (($a = s)['$<<'] || $mm('<<')).call($a, r)
          }, TMP_1._s = this, TMP_1), $e).call($f);
          if (els !== false && els !== nil) {
            (($e = s)['$<<'] || $mm('<<')).call($e, els)
          };
        };
        if (ens !== false && ens !== nil) {
          return (($g = this).$s || $mm('s')).call($g, "ensure", s, ens)
          } else {
          return s
        };
      };

      def.$new_defn = function(line, name, args, body) {
        var scope = nil, s = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o;
        if (($a = ($b = (($c = (($d = body)['$[]'] || $mm('[]')).call($d, 0))['$=='] || $mm('==')).call($c, "block"), ($b === nil || $b === false))) !== false && $a !== nil) {
          body = (($a = this).$s || $mm('s')).call($a, "block", body)
        };
        scope = (($b = this).$s || $mm('s')).call($b, "scope", body);
        if ((($e = (($f = body).$size || $mm('size')).call($f))['$=='] || $mm('==')).call($e, 1)) {
          (($g = body)['$<<'] || $mm('<<')).call($g, (($h = this).$s || $mm('s')).call($h, "nil"))
        };
        (($i = scope)['$line='] || $mm('line=')).call($i, (($j = body).$line || $mm('line')).call($j));
        (($k = args)['$line='] || $mm('line=')).call($k, line);
        s = (($l = this).$s || $mm('s')).call($l, "defn", (($m = name).$to_sym || $mm('to_sym')).call($m), args, scope);
        (($n = s)['$line='] || $mm('line=')).call($n, line);
        (($o = s)['$end_line='] || $mm('end_line=')).call($o, this.line);
        return s;
      };

      def.$new_defs = function(line, recv, name, args, body) {
        var scope = nil, s = nil, $a, $b, $c, $d, $e, $f, $g;
        scope = (($a = this).$s || $mm('s')).call($a, "scope", body);
        (($b = scope)['$line='] || $mm('line=')).call($b, (($c = body).$line || $mm('line')).call($c));
        s = (($d = this).$s || $mm('s')).call($d, "defs", recv, (($e = name).$to_sym || $mm('to_sym')).call($e), args, scope);
        (($f = s)['$line='] || $mm('line=')).call($f, line);
        (($g = s)['$end_line='] || $mm('end_line=')).call($g, this.line);
        return s;
      };

      def.$new_class = function(path, sup, body) {
        var scope = nil, s = nil, $a, $b, $c, $d, $e, $f, $g;
        scope = (($a = this).$s || $mm('s')).call($a, "scope");
        if (($b = (($c = (($d = body).$size || $mm('size')).call($d))['$=='] || $mm('==')).call($c, 1)) === false || $b === nil) {
          (($b = scope)['$<<'] || $mm('<<')).call($b, body)
        };
        (($e = scope)['$line='] || $mm('line=')).call($e, (($f = body).$line || $mm('line')).call($f));
        s = (($g = this).$s || $mm('s')).call($g, "class", path, sup, scope);
        return s;
      };

      def.$new_sclass = function(expr, body) {
        var scope = nil, s = nil, $a, $b, $c, $d, $e;
        scope = (($a = this).$s || $mm('s')).call($a, "scope");
        (($b = scope)['$<<'] || $mm('<<')).call($b, body);
        (($c = scope)['$line='] || $mm('line=')).call($c, (($d = body).$line || $mm('line')).call($d));
        s = (($e = this).$s || $mm('s')).call($e, "sclass", expr, scope);
        return s;
      };

      def.$new_module = function(path, body) {
        var scope = nil, s = nil, $a, $b, $c, $d, $e, $f, $g;
        scope = (($a = this).$s || $mm('s')).call($a, "scope");
        if (($b = (($c = (($d = body).$size || $mm('size')).call($d))['$=='] || $mm('==')).call($c, 1)) === false || $b === nil) {
          (($b = scope)['$<<'] || $mm('<<')).call($b, body)
        };
        (($e = scope)['$line='] || $mm('line=')).call($e, (($f = body).$line || $mm('line')).call($f));
        s = (($g = this).$s || $mm('s')).call($g, "module", path, scope);
        return s;
      };

      def.$new_iter = function(call, args, body) {
        var s = nil, $a, $b, $c;
        s = (($a = this).$s || $mm('s')).call($a, "iter", call, args);
        if (body !== false && body !== nil) {
          (($b = s)['$<<'] || $mm('<<')).call($b, body)
        };
        (($c = s)['$end_line='] || $mm('end_line=')).call($c, this.line);
        return s;
      };

      def.$new_if = function(expr, stmt, tail) {
        var s = nil, $a, $b, $c, $d;
        s = (($a = this).$s || $mm('s')).call($a, "if", expr, stmt, tail);
        (($b = s)['$line='] || $mm('line=')).call($b, (($c = expr).$line || $mm('line')).call($c));
        (($d = s)['$end_line='] || $mm('end_line=')).call($d, this.line);
        return s;
      };

      def.$new_args = function(norm, opt, rest, block) {
        var res = nil, rest_str = nil, $a, TMP_2, $b, $c, TMP_3, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p;
        res = (($a = this).$s || $mm('s')).call($a, "args");
        if (norm !== false && norm !== nil) {
          ($b = (($c = norm).$each || $mm('each')), $b._p = (TMP_2 = function(arg) {

            var self = TMP_2._s || this, $a, $b;
            if (self.scope == null) self.scope = nil;

            if (arg == null) arg = nil;

            (($a = self.scope).$add_local || $mm('add_local')).call($a, arg);
            return (($b = res)['$<<'] || $mm('<<')).call($b, arg);
          }, TMP_2._s = this, TMP_2), $b).call($c)
        };
        if (opt !== false && opt !== nil) {
          ($b = (($d = (($e = opt)['$[]'] || $mm('[]')).call($e, __range(1, -1, false))).$each || $mm('each')), $b._p = (TMP_3 = function(_opt) {

            var self = TMP_3._s || this, $a, $b;
            if (_opt == null) _opt = nil;

            return (($a = res)['$<<'] || $mm('<<')).call($a, (($b = _opt)['$[]'] || $mm('[]')).call($b, 1))
          }, TMP_3._s = this, TMP_3), $b).call($d)
        };
        if (rest !== false && rest !== nil) {
          (($b = res)['$<<'] || $mm('<<')).call($b, rest);
          rest_str = (($f = (($g = rest).$to_s || $mm('to_s')).call($g))['$[]'] || $mm('[]')).call($f, __range(1, -1, false));
          if (($h = (($i = rest_str)['$empty?'] || $mm('empty?')).call($i)) === false || $h === nil) {
            (($h = this.scope).$add_local || $mm('add_local')).call($h, (($j = rest_str).$to_sym || $mm('to_sym')).call($j))
          };
        };
        if (block !== false && block !== nil) {
          (($k = res)['$<<'] || $mm('<<')).call($k, block);
          (($l = this.scope).$add_local || $mm('add_local')).call($l, (($m = (($n = (($o = block).$to_s || $mm('to_s')).call($o))['$[]'] || $mm('[]')).call($n, __range(1, -1, false))).$to_sym || $mm('to_sym')).call($m));
        };
        if (opt !== false && opt !== nil) {
          (($p = res)['$<<'] || $mm('<<')).call($p, opt)
        };
        return res;
      };

      def.$new_block_args = function(norm, opt, rest, block) {
        var res = nil, r = nil, b = nil, $a, TMP_4, $b, $c, TMP_5, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w;
        res = (($a = this).$s || $mm('s')).call($a, "array");
        if (norm !== false && norm !== nil) {
          ($b = (($c = norm).$each || $mm('each')), $b._p = (TMP_4 = function(arg) {

            var self = TMP_4._s || this, $a, $b, $c;
            if (self.scope == null) self.scope = nil;

            if (arg == null) arg = nil;

            (($a = self.scope).$add_local || $mm('add_local')).call($a, arg);
            return (($b = res)['$<<'] || $mm('<<')).call($b, (($c = self).$s || $mm('s')).call($c, "lasgn", arg));
          }, TMP_4._s = this, TMP_4), $b).call($c)
        };
        if (opt !== false && opt !== nil) {
          ($b = (($d = (($e = opt)['$[]'] || $mm('[]')).call($e, __range(1, -1, false))).$each || $mm('each')), $b._p = (TMP_5 = function(_opt) {

            var self = TMP_5._s || this, $a, $b, $c;
            if (_opt == null) _opt = nil;

            return (($a = res)['$<<'] || $mm('<<')).call($a, (($b = self).$s || $mm('s')).call($b, "lasgn", (($c = _opt)['$[]'] || $mm('[]')).call($c, 1)))
          }, TMP_5._s = this, TMP_5), $b).call($d)
        };
        if (rest !== false && rest !== nil) {
          r = (($b = (($f = (($g = rest).$to_s || $mm('to_s')).call($g))['$[]'] || $mm('[]')).call($f, __range(1, -1, false))).$to_sym || $mm('to_sym')).call($b);
          (($h = res)['$<<'] || $mm('<<')).call($h, (($i = this).$s || $mm('s')).call($i, "splat", (($j = this).$s || $mm('s')).call($j, "lasgn", r)));
          (($k = this.scope).$add_local || $mm('add_local')).call($k, r);
        };
        if (block !== false && block !== nil) {
          b = (($l = (($m = (($n = block).$to_s || $mm('to_s')).call($n))['$[]'] || $mm('[]')).call($m, __range(1, -1, false))).$to_sym || $mm('to_sym')).call($l);
          (($o = res)['$<<'] || $mm('<<')).call($o, (($p = this).$s || $mm('s')).call($p, "block_pass", (($q = this).$s || $mm('s')).call($q, "lasgn", b)));
          (($r = this.scope).$add_local || $mm('add_local')).call($r, b);
        };
        if (opt !== false && opt !== nil) {
          (($s = res)['$<<'] || $mm('<<')).call($s, opt)
        };
        if (($t = (($u = (($v = (($w = res).$size || $mm('size')).call($w))['$=='] || $mm('==')).call($v, 2)) ? norm : $u)) !== false && $t !== nil) {
          return (($t = res)['$[]'] || $mm('[]')).call($t, 1)
          } else {
          return (($u = this).$s || $mm('s')).call($u, "masgn", res)
        };
      };

      def.$new_call = function(recv, meth, args) {
        var call = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s;if (args == null) {
          args = nil
        }
        call = (($a = this).$s || $mm('s')).call($a, "call", recv, meth);
        if (($b = args) === false || $b === nil) {
          args = (($b = this).$s || $mm('s')).call($b, "arglist")
        };
        if ((($c = (($d = args)['$[]'] || $mm('[]')).call($d, 0))['$=='] || $mm('==')).call($c, "array")) {
          (($e = args)['$[]='] || $mm('[]=')).call($e, 0, "arglist")
        };
        (($f = call)['$<<'] || $mm('<<')).call($f, args);
        if (recv !== false && recv !== nil) {
          (($g = call)['$line='] || $mm('line=')).call($g, (($h = recv).$line || $mm('line')).call($h))
          } else {
          if (($i = (($j = args)['$[]'] || $mm('[]')).call($j, 1)) !== false && $i !== nil) {
            (($i = call)['$line='] || $mm('line=')).call($i, (($k = (($l = args)['$[]'] || $mm('[]')).call($l, 1)).$line || $mm('line')).call($k))
          }
        };
        if ((($m = (($n = args).$length || $mm('length')).call($n))['$=='] || $mm('==')).call($m, 1)) {
          (($o = args)['$line='] || $mm('line=')).call($o, (($p = call).$line || $mm('line')).call($p))
          } else {
          (($q = args)['$line='] || $mm('line=')).call($q, (($r = (($s = args)['$[]'] || $mm('[]')).call($s, 1)).$line || $mm('line')).call($r))
        };
        return call;
      };

      def.$add_block_pass = function(arglist, block) {
        var $a;
        if (block !== false && block !== nil) {
          (($a = arglist)['$<<'] || $mm('<<')).call($a, block)
        };
        return arglist;
      };

      def.$new_op_asgn = function(op, lhs, rhs) {
        var $case = nil, result = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p;
        $case = op;if ((($e = "||")['$==='] || $mm('===')).call($e, $case)) {
        result = (($a = this).$s || $mm('s')).call($a, "op_asgn_or", (($b = this).$new_gettable || $mm('new_gettable')).call($b, lhs));
        (($c = result)['$<<'] || $mm('<<')).call($c, (($d = lhs)['$<<'] || $mm('<<')).call($d, rhs));
        }
        else if ((($j = "&&")['$==='] || $mm('===')).call($j, $case)) {
        result = (($f = this).$s || $mm('s')).call($f, "op_asgn_and", (($g = this).$new_gettable || $mm('new_gettable')).call($g, lhs));
        (($h = result)['$<<'] || $mm('<<')).call($h, (($i = lhs)['$<<'] || $mm('<<')).call($i, rhs));
        }
        else {result = lhs;
        (($k = result)['$<<'] || $mm('<<')).call($k, (($l = this).$new_call || $mm('new_call')).call($l, (($m = this).$new_gettable || $mm('new_gettable')).call($m, lhs), op, (($n = this).$s || $mm('s')).call($n, "arglist", rhs)));};
        (($o = result)['$line='] || $mm('line=')).call($o, (($p = lhs).$line || $mm('line')).call($p));
        return result;
      };

      def.$new_assign = function(lhs, rhs) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n;
        return (function() { $case = (($a = lhs)['$[]'] || $mm('[]')).call($a, 0);if ((($c = "iasgn")['$==='] || $mm('===')).call($c, $case) || (($d = "cdecl")['$==='] || $mm('===')).call($d, $case) || (($e = "lasgn")['$==='] || $mm('===')).call($e, $case) || (($f = "gasgn")['$==='] || $mm('===')).call($f, $case) || (($g = "cvdecl")['$==='] || $mm('===')).call($g, $case) || (($h = "nth_ref")['$==='] || $mm('===')).call($h, $case)) {
        (($b = lhs)['$<<'] || $mm('<<')).call($b, rhs);
        return lhs;
        }
        else if ((($k = "call")['$==='] || $mm('===')).call($k, $case) || (($l = "attrasgn")['$==='] || $mm('===')).call($l, $case)) {
        (($i = (($j = lhs).$last || $mm('last')).call($j))['$<<'] || $mm('<<')).call($i, rhs);
        return lhs;
        }
        else {return (($m = this).$raise || $mm('raise')).call($m, "Bad lhs for new_assign: " + ((($n = lhs)['$[]'] || $mm('[]')).call($n, 0)))} }).call(this);
      };

      def.$new_assignable = function(ref) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q;
        $case = (($a = ref)['$[]'] || $mm('[]')).call($a, 0);if ((($c = "ivar")['$==='] || $mm('===')).call($c, $case)) {
        (($b = ref)['$[]='] || $mm('[]=')).call($b, 0, "iasgn")
        }
        else if ((($e = "const")['$==='] || $mm('===')).call($e, $case)) {
        (($d = ref)['$[]='] || $mm('[]=')).call($d, 0, "cdecl")
        }
        else if ((($k = "identifier")['$==='] || $mm('===')).call($k, $case)) {
        if (($f = (($g = this.scope)['$has_local?'] || $mm('has_local?')).call($g, (($h = ref)['$[]'] || $mm('[]')).call($h, 1))) === false || $f === nil) {
          (($f = this.scope).$add_local || $mm('add_local')).call($f, (($i = ref)['$[]'] || $mm('[]')).call($i, 1))
        };
        (($j = ref)['$[]='] || $mm('[]=')).call($j, 0, "lasgn");
        }
        else if ((($m = "gvar")['$==='] || $mm('===')).call($m, $case)) {
        (($l = ref)['$[]='] || $mm('[]=')).call($l, 0, "gasgn")
        }
        else if ((($o = "cvar")['$==='] || $mm('===')).call($o, $case)) {
        (($n = ref)['$[]='] || $mm('[]=')).call($n, 0, "cvdecl")
        }
        else {(($p = this).$raise || $mm('raise')).call($p, "Bad new_assignable type: " + ((($q = ref)['$[]'] || $mm('[]')).call($q, 0)))};
        return ref;
      };

      def.$new_gettable = function(ref) {
        var res = nil, $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q;
        res = (function() { $case = (($a = ref)['$[]'] || $mm('[]')).call($a, 0);if ((($d = "lasgn")['$==='] || $mm('===')).call($d, $case)) {
        return (($b = this).$s || $mm('s')).call($b, "lvar", (($c = ref)['$[]'] || $mm('[]')).call($c, 1))
        }
        else if ((($g = "iasgn")['$==='] || $mm('===')).call($g, $case)) {
        return (($e = this).$s || $mm('s')).call($e, "ivar", (($f = ref)['$[]'] || $mm('[]')).call($f, 1))
        }
        else if ((($j = "gasgn")['$==='] || $mm('===')).call($j, $case)) {
        return (($h = this).$s || $mm('s')).call($h, "gvar", (($i = ref)['$[]'] || $mm('[]')).call($i, 1))
        }
        else if ((($m = "cvdecl")['$==='] || $mm('===')).call($m, $case)) {
        return (($k = this).$s || $mm('s')).call($k, "cvar", (($l = ref)['$[]'] || $mm('[]')).call($l, 1))
        }
        else {return (($n = this).$raise || $mm('raise')).call($n, "Bad new_gettable ref: " + ((($o = ref)['$[]'] || $mm('[]')).call($o, 0)))} }).call(this);
        (($p = res)['$line='] || $mm('line=')).call($p, (($q = ref).$line || $mm('line')).call($q));
        return res;
      };

      def.$new_var_ref = function(ref) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w;
        return (function() { $case = (($a = ref)['$[]'] || $mm('[]')).call($a, 0);if ((($b = "self")['$==='] || $mm('===')).call($b, $case) || (($c = "nil")['$==='] || $mm('===')).call($c, $case) || (($d = "true")['$==='] || $mm('===')).call($d, $case) || (($e = "false")['$==='] || $mm('===')).call($e, $case) || (($f = "line")['$==='] || $mm('===')).call($f, $case) || (($g = "file")['$==='] || $mm('===')).call($g, $case)) {
        return ref
        }
        else if ((($h = "const")['$==='] || $mm('===')).call($h, $case)) {
        return ref
        }
        else if ((($i = "ivar")['$==='] || $mm('===')).call($i, $case) || (($j = "gvar")['$==='] || $mm('===')).call($j, $case) || (($k = "cvar")['$==='] || $mm('===')).call($k, $case)) {
        return ref
        }
        else if ((($l = "lit")['$==='] || $mm('===')).call($l, $case)) {
        return ref
        }
        else if ((($m = "str")['$==='] || $mm('===')).call($m, $case)) {
        return ref
        }
        else if ((($u = "identifier")['$==='] || $mm('===')).call($u, $case)) {
        if (($n = (($o = this.scope)['$has_local?'] || $mm('has_local?')).call($o, (($p = ref)['$[]'] || $mm('[]')).call($p, 1))) !== false && $n !== nil) {
          return (($n = this).$s || $mm('s')).call($n, "lvar", (($q = ref)['$[]'] || $mm('[]')).call($q, 1))
          } else {
          return (($r = this).$s || $mm('s')).call($r, "call", nil, (($s = ref)['$[]'] || $mm('[]')).call($s, 1), (($t = this).$s || $mm('s')).call($t, "arglist"))
        }
        }
        else {return (($v = this).$raise || $mm('raise')).call($v, "Bad var_ref type: " + ((($w = ref)['$[]'] || $mm('[]')).call($w, 0)))} }).call(this);
      };

      def.$new_super = function(args) {
        var $a, $b, $c;
        args = (($a = (($b = args), $b !== false && $b !== nil ? $b : (($c = this).$s || $mm('s')).call($c, "arglist")))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        return (($b = this).$s || $mm('s')).apply($b, ["super"].concat(args));
      };

      def.$new_yield = function(args) {
        var $a, $b, $c;
        args = (($a = (($b = args), $b !== false && $b !== nil ? $b : (($c = this).$s || $mm('s')).call($c, "arglist")))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        return (($b = this).$s || $mm('s')).apply($b, ["yield"].concat(args));
      };

      def.$new_xstr = function(str) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h;
        if (($a = str) === false || $a === nil) {
          return (($a = this).$s || $mm('s')).call($a, "xstr", "")
        };
        $case = (($b = str)['$[]'] || $mm('[]')).call($b, 0);if ((($d = "str")['$==='] || $mm('===')).call($d, $case)) {
        (($c = str)['$[]='] || $mm('[]=')).call($c, 0, "xstr")
        }
        else if ((($f = "dstr")['$==='] || $mm('===')).call($f, $case)) {
        (($e = str)['$[]='] || $mm('[]=')).call($e, 0, "dxstr")
        }
        else if ((($h = "evstr")['$==='] || $mm('===')).call($h, $case)) {
        str = (($g = this).$s || $mm('s')).call($g, "dxstr", "", str)
        };
        return str;
      };

      def.$new_dsym = function(str) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i;
        if (($a = str) === false || $a === nil) {
          return (($a = this).$s || $mm('s')).call($a, "nil")
        };
        $case = (($b = str)['$[]'] || $mm('[]')).call($b, 0);if ((($g = "str")['$==='] || $mm('===')).call($g, $case)) {
        (($c = str)['$[]='] || $mm('[]=')).call($c, 0, "lit");
        (($d = str)['$[]='] || $mm('[]=')).call($d, 1, (($e = (($f = str)['$[]'] || $mm('[]')).call($f, 1)).$to_sym || $mm('to_sym')).call($e));
        }
        else if ((($i = "dstr")['$==='] || $mm('===')).call($i, $case)) {
        (($h = str)['$[]='] || $mm('[]=')).call($h, 0, "dsym")
        };
        return str;
      };

      def.$new_str = function(str) {
        var $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p;
        if (($a = str) === false || $a === nil) {
          return (($a = this).$s || $mm('s')).call($a, "str", "")
        };
        if (($b = ($c = (($c = (($d = (($e = str).$size || $mm('size')).call($e))['$=='] || $mm('==')).call($d, 3)) ? (($f = (($g = str)['$[]'] || $mm('[]')).call($g, 1))['$=='] || $mm('==')).call($f, "") : $c), $c !== false && $c !== nil ? (($c = (($h = str)['$[]'] || $mm('[]')).call($h, 0))['$=='] || $mm('==')).call($c, "str") : $c)) !== false && $b !== nil) {
          return (($b = str)['$[]'] || $mm('[]')).call($b, 2)
          } else {
          if (($i = (($j = (($k = (($l = str)['$[]'] || $mm('[]')).call($l, 0))['$=='] || $mm('==')).call($k, "str")) ? (($m = (($n = str).$size || $mm('size')).call($n))['$>'] || $mm('>')).call($m, 3) : $j)) !== false && $i !== nil) {
            (($i = str)['$[]='] || $mm('[]=')).call($i, 0, "dstr");
            return str;
            } else {
            if ((($j = (($o = str)['$[]'] || $mm('[]')).call($o, 0))['$=='] || $mm('==')).call($j, "evstr")) {
              return (($p = this).$s || $mm('s')).call($p, "dstr", "", str)
              } else {
              return str
            }
          }
        };
      };

      def.$new_regexp = function(reg, ending) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j;
        if (($a = reg) === false || $a === nil) {
          return (($a = this).$s || $mm('s')).call($a, "lit", /^/)
        };
        return (function() { $case = (($b = reg)['$[]'] || $mm('[]')).call($b, 0);if ((($f = "str")['$==='] || $mm('===')).call($f, $case)) {
        return (($c = this).$s || $mm('s')).call($c, "lit", (($d = (($e = __scope.Regexp) == null ? __opal.cm("Regexp") : $e)).$new || $mm('new')).call($d, (($e = reg)['$[]'] || $mm('[]')).call($e, 1), ending))
        }
        else if ((($h = "evstr")['$==='] || $mm('===')).call($h, $case)) {
        return (($g = this).$s || $mm('s')).call($g, "dregx", "", reg)
        }
        else if ((($j = "dstr")['$==='] || $mm('===')).call($j, $case)) {
        (($i = reg)['$[]='] || $mm('[]=')).call($i, 0, "dregx");
        return reg;
        }
        else {return nil} }).call(this);
      };

      def.$str_append = function(str, str2) {
        var $a, $b, $c, $d, $e, $f, $g, $h;
        if (($a = str) === false || $a === nil) {
          return str2
        };
        if (($a = str2) === false || $a === nil) {
          return str
        };
        if ((($a = (($b = str).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "evstr")) {
          str = (($c = this).$s || $mm('s')).call($c, "dstr", "", str)
          } else {
          if ((($d = (($e = str).$first || $mm('first')).call($e))['$=='] || $mm('==')).call($d, "str")) {
            str = (($f = this).$s || $mm('s')).call($f, "dstr", (($g = str)['$[]'] || $mm('[]')).call($g, 1))
          }
        };
        (($h = str)['$<<'] || $mm('<<')).call($h, str2);
        return str;
      };

      return nil;
    })(Opal, (($a = ((($b = __scope.Racc) == null ? __opal.cm("Racc") : $b))._scope).Parser == null ? $a.cm("Parser") : $a.Parser))
    
  })(self)
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __klass = __opal.klass, __hash2 = __opal.hash2, __range = __opal.range;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope;

    (function(__base, __super){
      function Parser() {};
      Parser = __klass(__base, __super, "Parser", Parser);

      var def = Parser.prototype, __scope = Parser._scope, TMP_4, TMP_6, TMP_7, TMP_8, TMP_33, $a, $b;
      def.requires = def.result = def.sexp = def.file = def.line = def.indent = def.unique = def.scope = def.optimized_operators = def.helpers = def.method_missing = def.dynamic_require_severity = def.arity_check = def.const_missing = def.while_loop = def.space = nil;

      __scope.INDENT = "  ";

      __scope.LEVEL = ["stmt", "stmt_closure", "list", "expr", "recv"];

      __scope.COMPARE = ["<", ">", "<=", ">="];

      __scope.RESERVED = ["break", "case", "catch", "continue", "debugger", "default", "delete", "do", "else", "finally", "for", "function", "if", "in", "instanceof", "new", "return", "switch", "this", "throw", "try", "typeof", "var", "let", "void", "while", "with", "class", "enum", "export", "extends", "import", "super", "true", "false", "native", "const", "static"];

      __scope.STATEMENTS = ["xstr", "dxstr"];

      def.$requires = function() {
        
        return this.requires
      }, nil;

      def.$result = function() {
        
        return this.result
      }, nil;

      def.$parse = function(source, options) {
        var $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;if (options == null) {
          options = __hash2([], {})
        }
        this.sexp = (($a = (($b = (($c = __scope.Grammar) == null ? __opal.cm("Grammar") : $c)).$new || $mm('new')).call($b)).$parse || $mm('parse')).call($a, source, (($c = options)['$[]'] || $mm('[]')).call($c, "file"));
        this.requires = [];
        this.line = 1;
        this.indent = "";
        this.unique = 0;
        this.helpers = __hash2(["breaker", "slice"], {"breaker": true, "slice": true});
        this.file = (($d = (($e = options)['$[]'] || $mm('[]')).call($e, "file")), $d !== false && $d !== nil ? $d : "(file)");
        this.method_missing = ($d = (($f = (($g = options)['$[]'] || $mm('[]')).call($g, "method_missing"))['$=='] || $mm('==')).call($f, false), ($d === nil || $d === false));
        this.optimized_operators = ($d = (($h = (($i = options)['$[]'] || $mm('[]')).call($i, "optimized_operators"))['$=='] || $mm('==')).call($h, false), ($d === nil || $d === false));
        this.arity_check = (($d = options)['$[]'] || $mm('[]')).call($d, "arity_check");
        this.const_missing = ($j = (($k = (($l = options)['$[]'] || $mm('[]')).call($l, "const_missing"))['$=='] || $mm('==')).call($k, false), ($j === nil || $j === false));
        this.dynamic_require_severity = (($j = (($m = options)['$[]'] || $mm('[]')).call($m, "dynamic_require_severity")), $j !== false && $j !== nil ? $j : "error");
        return this.result = (($j = this).$top || $mm('top')).call($j, this.sexp);
      };

      def.$error = function(msg) {
        var $a, $b;
        return (($a = this).$raise || $mm('raise')).call($a, (($b = __scope.SyntaxError) == null ? __opal.cm("SyntaxError") : $b), "" + (msg) + " :" + (this.file) + ":" + (this.line));
      };

      def.$warning = function(msg) {
        var $a;
        return (($a = this).$warn || $mm('warn')).call($a, "" + (msg) + " :" + (this.file) + ":" + (this.line));
      };

      def.$parser_indent = function() {
        
        return this.indent;
      };

      def.$s = function(parts) {
        var sexp = nil, $a, $b;parts = __slice.call(arguments, 0);
        sexp = (($a = (($b = __scope.Array) == null ? __opal.cm("Array") : $b)).$new || $mm('new')).call($a, parts);
        (($b = sexp)['$line='] || $mm('line=')).call($b, this.line);
        return sexp;
      };

      def.$mid_to_jsid = function(mid) {
        var $a, $b, $c, $d;
        if (($a = (($b = /\=|\+|\-|\*|\/|\!|\?|\<|\>|\&|\||\^|\%|\~|\[/)['$=~'] || $mm('=~')).call($b, (($c = mid).$to_s || $mm('to_s')).call($c))) !== false && $a !== nil) {
          return "['$" + (mid) + "']"
          } else {
          return ($a = ".$", $d = mid, typeof($a) === 'number' ? $a + $d : $a['$+']($d))
        };
      };

      def.$unique_temp = function() {
        var $a;
        return "TMP_" + (this.unique = (($a = this.unique)['$+'] || $mm('+')).call($a, 1));
      };

      def.$top = function(sexp, options) {
        var code = nil, TMP_1, $a, $b;if (options == null) {
          options = __hash2([], {})
        }
        code = nil;
        ($a = (($b = this).$in_scope || $mm('in_scope')), $a._p = (TMP_1 = function() {

          var self = TMP_1._s || this, TMP_2, $a, $b, $c, $d, $e, $f, $g, $h, TMP_3, $i, $j, $k, $l, $m, $n, $o, $p, $q;
          if (self.scope == null) self.scope = nil;
          if (self.helpers == null) self.helpers = nil;

          
          ($a = (($b = self).$indent || $mm('indent')), $a._p = (TMP_2 = function() {

            var self = TMP_2._s || this, $a, $b, $c, $d;
            if (self.indent == null) self.indent = nil;

            
            return code = ($a = self.indent, $b = (($c = self).$process || $mm('process')).call($c, (($d = self).$s || $mm('s')).call($d, "scope", sexp), "stmt"), typeof($a) === 'number' ? $a + $b : $a['$+']($b))
          }, TMP_2._s = self, TMP_2), $a).call($b);
          (($a = self.scope).$add_temp || $mm('add_temp')).call($a, "self = __opal.top");
          (($c = self.scope).$add_temp || $mm('add_temp')).call($c, "__scope = __opal");
          (($d = self.scope).$add_temp || $mm('add_temp')).call($d, "nil = __opal.nil");
          (($e = self.scope).$add_temp || $mm('add_temp')).call($e, "$mm = __opal.mm");
          if (($f = (($g = self.scope).$defines_defn || $mm('defines_defn')).call($g)) !== false && $f !== nil) {
            (($f = self.scope).$add_temp || $mm('add_temp')).call($f, "def = " + ((($h = self).$current_self || $mm('current_self')).call($h)) + "._klass.prototype")
          };
          ($i = (($j = (($k = self.helpers).$keys || $mm('keys')).call($k)).$each || $mm('each')), $i._p = (TMP_3 = function(h) {

            var self = TMP_3._s || this, $a;
            if (self.scope == null) self.scope = nil;

            if (h == null) h = nil;

            return (($a = self.scope).$add_temp || $mm('add_temp')).call($a, "__" + (h) + " = __opal." + (h))
          }, TMP_3._s = self, TMP_3), $i).call($j);
          return code = ($i = ($m = ($o = (($q = __scope.INDENT) == null ? __opal.cm("INDENT") : $q), $p = (($q = self.scope).$to_vars || $mm('to_vars')).call($q), typeof($o) === 'number' ? $o + $p : $o['$+']($p)), $n = "\n", typeof($m) === 'number' ? $m + $n : $m['$+']($n)), $l = code, typeof($i) === 'number' ? $i + $l : $i['$+']($l));
        }, TMP_1._s = this, TMP_1), $a).call($b, "top");
        return "(function(__opal) {\n" + (code) + "\n})(Opal);\n";
      };

      def.$in_scope = TMP_4 = function(type) {
        var parent = nil, TMP_5, $a, $b, $c, $d, __yield;
        __yield = TMP_4._p || nil, TMP_4._p = null;
        
        if (__yield === nil) {
          return nil
        };
        parent = this.scope;
        this.scope = ($a = (($b = (($c = (($d = __scope.TargetScope) == null ? __opal.cm("TargetScope") : $d)).$new || $mm('new')).call($c, type, this)).$tap || $mm('tap')), $a._p = (TMP_5 = function(s) {

          var self = TMP_5._s || this, $a;
          if (s == null) s = nil;

          return (($a = s)['$parent='] || $mm('parent=')).call($a, parent)
        }, TMP_5._s = this, TMP_5), $a).call($b);
        if (__yield.call(null, this.scope) === __breaker) return __breaker.$v;
        return this.scope = parent;
      };

      def.$indent = TMP_6 = function() {
        var indent = nil, res = nil, $a, $b, block;
        block = TMP_6._p || nil, TMP_6._p = null;
        
        indent = this.indent;
        this.indent = (($a = this.indent)['$+'] || $mm('+')).call($a, (($b = __scope.INDENT) == null ? __opal.cm("INDENT") : $b));
        this.space = "\n" + (this.indent);
        res = ((($b = block.call(null)) === __breaker) ? __breaker.$v : $b);
        this.indent = indent;
        this.space = "\n" + (this.indent);
        return res;
      };

      def.$with_temp = TMP_7 = function() {
        var tmp = nil, res = nil, $a, $b, block;
        block = TMP_7._p || nil, TMP_7._p = null;
        
        tmp = (($a = this.scope).$new_temp || $mm('new_temp')).call($a);
        res = ((($b = block.call(null, tmp)) === __breaker) ? __breaker.$v : $b);
        (($b = this.scope).$queue_temp || $mm('queue_temp')).call($b, tmp);
        return res;
      };

      def.$in_while = TMP_8 = function() {
        var result = nil, $a, $b, __yield;
        __yield = TMP_8._p || nil, TMP_8._p = null;
        
        if (__yield === nil) {
          return nil
        };
        this.while_loop = (($a = this.scope).$push_while || $mm('push_while')).call($a);
        result = ((($b = __yield.call(null)) === __breaker) ? __breaker.$v : $b);
        (($b = this.scope).$pop_while || $mm('pop_while')).call($b);
        return result;
      };

      def['$in_while?'] = function() {
        var $a;
        return (($a = this.scope)['$in_while?'] || $mm('in_while?')).call($a);
      };

      def.$process = function(sexp, level) {
        var type = nil, meth = nil, $a, $b, $c, $d, $e;
        type = (($a = sexp).$shift || $mm('shift')).call($a);
        meth = "process_" + (type);
        if (($b = (($c = this)['$respond_to?'] || $mm('respond_to?')).call($c, meth)) === false || $b === nil) {
          (($b = this).$raise || $mm('raise')).call($b, "Unsupported sexp: " + (type))
        };
        this.line = (($d = sexp).$line || $mm('line')).call($d);
        return (($e = this).$__send__ || $mm('__send__')).call($e, meth, sexp, level);
      };

      def.$returns = function(sexp) {
        var $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay, $az, $ba, TMP_9, $bb, $bc, $bd;
        if (($a = sexp) === false || $a === nil) {
          return (($a = this).$returns || $mm('returns')).call($a, (($b = this).$s || $mm('s')).call($b, "nil"))
        };
        return (function() { $case = (($c = sexp).$first || $mm('first')).call($c);if ((($d = "break")['$==='] || $mm('===')).call($d, $case) || (($e = "next")['$==='] || $mm('===')).call($e, $case)) {
        return sexp
        }
        else if ((($g = "yield")['$==='] || $mm('===')).call($g, $case)) {
        (($f = sexp)['$[]='] || $mm('[]=')).call($f, 0, "returnable_yield");
        return sexp;
        }
        else if ((($k = "scope")['$==='] || $mm('===')).call($k, $case)) {
        (($h = sexp)['$[]='] || $mm('[]=')).call($h, 1, (($i = this).$returns || $mm('returns')).call($i, (($j = sexp)['$[]'] || $mm('[]')).call($j, 1)));
        return sexp;
        }
        else if ((($t = "block")['$==='] || $mm('===')).call($t, $case)) {
        if ((($l = (($m = sexp).$length || $mm('length')).call($m))['$>'] || $mm('>')).call($l, 1)) {
          (($n = sexp)['$[]='] || $mm('[]=')).call($n, -1, (($o = this).$returns || $mm('returns')).call($o, (($p = sexp)['$[]'] || $mm('[]')).call($p, -1)))
          } else {
          (($q = sexp)['$<<'] || $mm('<<')).call($q, (($r = this).$returns || $mm('returns')).call($r, (($s = this).$s || $mm('s')).call($s, "nil")))
        };
        return sexp;
        }
        else if ((($x = "when")['$==='] || $mm('===')).call($x, $case)) {
        (($u = sexp)['$[]='] || $mm('[]=')).call($u, 2, (($v = this).$returns || $mm('returns')).call($v, (($w = sexp)['$[]'] || $mm('[]')).call($w, 2)));
        return sexp;
        }
        else if ((($ab = "rescue")['$==='] || $mm('===')).call($ab, $case)) {
        (($y = sexp)['$[]='] || $mm('[]=')).call($y, 1, (($z = this).$returns || $mm('returns')).call($z, (($aa = sexp)['$[]'] || $mm('[]')).call($aa, 1)));
        return sexp;
        }
        else if ((($af = "ensure")['$==='] || $mm('===')).call($af, $case)) {
        (($ac = sexp)['$[]='] || $mm('[]=')).call($ac, 1, (($ad = this).$returns || $mm('returns')).call($ad, (($ae = sexp)['$[]'] || $mm('[]')).call($ae, 1)));
        return sexp;
        }
        else if ((($ag = "while")['$==='] || $mm('===')).call($ag, $case)) {
        return sexp
        }
        else if ((($ah = "return")['$==='] || $mm('===')).call($ah, $case)) {
        return sexp
        }
        else if ((($am = "xstr")['$==='] || $mm('===')).call($am, $case)) {
        if (($ai = (($aj = /return|;/)['$=~'] || $mm('=~')).call($aj, (($ak = sexp)['$[]'] || $mm('[]')).call($ak, 1))) === false || $ai === nil) {
          (($ai = sexp)['$[]='] || $mm('[]=')).call($ai, 1, "return " + ((($al = sexp)['$[]'] || $mm('[]')).call($al, 1)) + ";")
        };
        return sexp;
        }
        else if ((($ar = "dxstr")['$==='] || $mm('===')).call($ar, $case)) {
        if (($an = (($ao = /return|;|\n/)['$=~'] || $mm('=~')).call($ao, (($ap = sexp)['$[]'] || $mm('[]')).call($ap, 1))) === false || $an === nil) {
          (($an = sexp)['$[]='] || $mm('[]=')).call($an, 1, "return " + ((($aq = sexp)['$[]'] || $mm('[]')).call($aq, 1)))
        };
        return sexp;
        }
        else if ((($ay = "if")['$==='] || $mm('===')).call($ay, $case)) {
        (($as = sexp)['$[]='] || $mm('[]=')).call($as, 2, (($at = this).$returns || $mm('returns')).call($at, (($au = (($av = sexp)['$[]'] || $mm('[]')).call($av, 2)), $au !== false && $au !== nil ? $au : (($aw = this).$s || $mm('s')).call($aw, "nil"))));
        (($au = sexp)['$[]='] || $mm('[]=')).call($au, 3, (($ax = this).$returns || $mm('returns')).call($ax, (($ay = (($az = sexp)['$[]'] || $mm('[]')).call($az, 3)), $ay !== false && $ay !== nil ? $ay : (($ba = this).$s || $mm('s')).call($ba, "nil"))));
        return sexp;
        }
        else {return ($bb = (($bc = (($bd = this).$s || $mm('s')).call($bd, "js_return", sexp)).$tap || $mm('tap')), $bb._p = (TMP_9 = function(s) {

          var self = TMP_9._s || this, $a, $b;
          if (s == null) s = nil;

          return (($a = s)['$line='] || $mm('line=')).call($a, (($b = sexp).$line || $mm('line')).call($b))
        }, TMP_9._s = this, TMP_9), $bb).call($bc)} }).call(this);
      };

      def['$expression?'] = function(sexp) {
        var $a, $b, $c;
        return ($a = (($b = (($c = __scope.STATEMENTS) == null ? __opal.cm("STATEMENTS") : $c))['$include?'] || $mm('include?')).call($b, (($c = sexp).$first || $mm('first')).call($c)), ($a === nil || $a === false));
      };

      def.$process_block = function(sexp, level) {
        var result = nil, stmt = nil, type = nil, yasgn = nil, expr = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s;
        result = [];
        if (($a = (($b = sexp)['$empty?'] || $mm('empty?')).call($b)) !== false && $a !== nil) {
          (($a = sexp)['$<<'] || $mm('<<')).call($a, (($c = this).$s || $mm('s')).call($c, "nil"))
        };
        while (!(($e = (($f = sexp)['$empty?'] || $mm('empty?')).call($f)) !== false && $e !== nil)) {stmt = (($e = sexp).$shift || $mm('shift')).call($e);
        type = (($g = stmt).$first || $mm('first')).call($g);
        if (($h = yasgn = (($i = this).$find_inline_yield || $mm('find_inline_yield')).call($i, stmt)) !== false && $h !== nil) {
          (($h = result)['$<<'] || $mm('<<')).call($h, "" + ((($j = this).$process || $mm('process')).call($j, yasgn, level)) + ";")
        };
        ($k = expr = (($k = this)['$expression?'] || $mm('expression?')).call($k, stmt), $k !== false && $k !== nil ? (($l = (($m = (($n = __scope.LEVEL) == null ? __opal.cm("LEVEL") : $n)).$index || $mm('index')).call($m, level))['$<'] || $mm('<')).call($l, (($n = (($o = __scope.LEVEL) == null ? __opal.cm("LEVEL") : $o)).$index || $mm('index')).call($n, "list")) : $k);
        code = (($o = this).$process || $mm('process')).call($o, stmt, level);
        if (($p = (($q = code)['$=='] || $mm('==')).call($q, "")) === false || $p === nil) {
          (($p = result)['$<<'] || $mm('<<')).call($p, (function() { if (expr !== false && expr !== nil) {
            return "" + (code) + ";"
            } else {
            return code
          }; return nil; }).call(this))
        };};
        return (($d = result).$join || $mm('join')).call($d, (function() { if (($r = (($s = this.scope)['$class_scope?'] || $mm('class_scope?')).call($s)) !== false && $r !== nil) {
          return "\n\n" + (this.indent)
          } else {
          return "\n" + (this.indent)
        }; return nil; }).call(this));
      };

      def.$find_inline_yield = function(stmt) {
        var found = nil, $case = nil, arglist = nil, $a, $b, $c, $d, TMP_10, $e, $f, $g, $h, TMP_11, $i, $j, $k, $l, $m, $n;
        found = nil;
        $case = (($a = stmt).$first || $mm('first')).call($a);if ((($d = "js_return")['$==='] || $mm('===')).call($d, $case)) {
        found = (($b = this).$find_inline_yield || $mm('find_inline_yield')).call($b, (($c = stmt)['$[]'] || $mm('[]')).call($c, 1))
        }
        else if ((($e = "array")['$==='] || $mm('===')).call($e, $case)) {
        ($e = (($f = (($g = stmt)['$[]'] || $mm('[]')).call($g, __range(1, -1, false))).$each_with_index || $mm('each_with_index')), $e._p = (TMP_10 = function(el, idx) {

          var self = TMP_10._s || this, $a, $b, $c, $d, $e;
          if (el == null) el = nil;
if (idx == null) idx = nil;

          if ((($a = (($b = el).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "yield")) {
            found = el;
            return (($c = stmt)['$[]='] || $mm('[]=')).call($c, ($d = idx, $e = 1, typeof($d) === 'number' ? $d + $e : $d['$+']($e)), (($d = self).$s || $mm('s')).call($d, "js_tmp", "__yielded"));
            } else {
            return nil
          }
        }, TMP_10._s = this, TMP_10), $e).call($f)
        }
        else if ((($i = "call")['$==='] || $mm('===')).call($i, $case)) {
        arglist = (($h = stmt)['$[]'] || $mm('[]')).call($h, 3);
        ($i = (($j = (($k = arglist)['$[]'] || $mm('[]')).call($k, __range(1, -1, false))).$each_with_index || $mm('each_with_index')), $i._p = (TMP_11 = function(el, idx) {

          var self = TMP_11._s || this, $a, $b, $c, $d, $e;
          if (el == null) el = nil;
if (idx == null) idx = nil;

          if ((($a = (($b = el).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "yield")) {
            found = el;
            return (($c = arglist)['$[]='] || $mm('[]=')).call($c, ($d = idx, $e = 1, typeof($d) === 'number' ? $d + $e : $d['$+']($e)), (($d = self).$s || $mm('s')).call($d, "js_tmp", "__yielded"));
            } else {
            return nil
          }
        }, TMP_11._s = this, TMP_11), $i).call($j);
        };
        if (found !== false && found !== nil) {
          if (($l = (($m = this.scope)['$has_temp?'] || $mm('has_temp?')).call($m, "__yielded")) === false || $l === nil) {
            (($l = this.scope).$add_temp || $mm('add_temp')).call($l, "__yielded")
          };
          return (($n = this).$s || $mm('s')).call($n, "yasgn", "__yielded", found);
          } else {
          return nil
        };
      };

      def.$process_scope = function(sexp, level) {
        var stmt = nil, code = nil, $a, $b, $c, $d;
        stmt = (($a = sexp).$shift || $mm('shift')).call($a);
        if (stmt !== false && stmt !== nil) {
          if (($b = (($c = this.scope)['$class_scope?'] || $mm('class_scope?')).call($c)) === false || $b === nil) {
            stmt = (($b = this).$returns || $mm('returns')).call($b, stmt)
          };
          code = (($d = this).$process || $mm('process')).call($d, stmt, "stmt");
          } else {
          code = "nil"
        };
        return code;
      };

      def.$process_js_return = function(sexp, level) {
        var $a, $b;
        return "return " + ((($a = this).$process || $mm('process')).call($a, (($b = sexp).$shift || $mm('shift')).call($b), "expr"));
      };

      def.$process_js_tmp = function(sexp, level) {
        var $a, $b;
        return (($a = (($b = sexp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
      };

      def.$process_operator = function(sexp, level) {
        var meth = nil, recv = nil, arg = nil, mid = nil, $a, $b, $c, TMP_12, $d, $e;
        (($a = sexp)._isArray ? $a : ($a = [$a])), meth = ($a[0] == null ? nil : $a[0]), recv = ($a[1] == null ? nil : $a[1]), arg = ($a[2] == null ? nil : $a[2]);
        mid = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = meth).$to_s || $mm('to_s')).call($b));
        if (($c = this.optimized_operators) !== false && $c !== nil) {
          return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_12 = function(a) {

            var self = TMP_12._s || this, TMP_13, $a, $b;
            if (a == null) a = nil;

            return ($a = (($b = self).$with_temp || $mm('with_temp')), $a._p = (TMP_13 = function(b) {

              var l = nil, r = nil, self = TMP_13._s || this, $a, $b, $c, $d;
              if (b == null) b = nil;

              l = (($a = self).$process || $mm('process')).call($a, recv, "expr");
              r = (($b = self).$process || $mm('process')).call($b, arg, "expr");
              return (($c = "(%s = %s, %s = %s, typeof(%s) === 'number' ? %s %s %s : %s%s(%s))")['$%'] || $mm('%')).call($c, [a, l, b, r, a, a, (($d = meth).$to_s || $mm('to_s')).call($d), b, a, mid, b]);
            }, TMP_13._s = self, TMP_13), $a).call($b)
          }, TMP_12._s = this, TMP_12), $c).call($d)
          } else {
          return "" + ((($c = this).$process || $mm('process')).call($c, recv, "recv")) + (mid) + "(" + ((($e = this).$process || $mm('process')).call($e, arg, "expr")) + ")"
        };
      };

      def.$js_block_given = function(sexp, level) {
        var $a, $b, $c;
        (($a = this.scope)['$uses_block!'] || $mm('uses_block!')).call($a);
        if (($b = (($c = this.scope).$block_name || $mm('block_name')).call($c)) !== false && $b !== nil) {
          return "(" + ((($b = this.scope).$block_name || $mm('block_name')).call($b)) + " !== nil)"
          } else {
          return "false"
        };
      };

      def.$handle_block_given = function(sexp, reverse) {
        var name = nil, $a, $b;if (reverse == null) {
          reverse = false
        }
        (($a = this.scope)['$uses_block!'] || $mm('uses_block!')).call($a);
        name = (($b = this.scope).$block_name || $mm('block_name')).call($b);
        if (reverse !== false && reverse !== nil) {
          return "" + (name) + " === nil"
          } else {
          return "" + (name) + " !== nil"
        };
      };

      def.$process_lit = function(sexp, level) {
        var val = nil, $case = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s;
        val = (($a = sexp).$shift || $mm('shift')).call($a);
        return (function() { $case = val;if ((($e = (($f = __scope.Numeric) == null ? __opal.cm("Numeric") : $f))['$==='] || $mm('===')).call($e, $case)) {
        if ((($b = level)['$=='] || $mm('==')).call($b, "recv")) {
          return "(" + ((($c = val).$inspect || $mm('inspect')).call($c)) + ")"
          } else {
          return (($d = val).$inspect || $mm('inspect')).call($d)
        }
        }
        else if ((($h = (($i = __scope.Symbol) == null ? __opal.cm("Symbol") : $i))['$==='] || $mm('===')).call($h, $case)) {
        return (($f = (($g = val).$to_s || $mm('to_s')).call($g)).$inspect || $mm('inspect')).call($f)
        }
        else if ((($l = (($m = __scope.Regexp) == null ? __opal.cm("Regexp") : $m))['$==='] || $mm('===')).call($l, $case)) {
        if ((($i = val)['$=='] || $mm('==')).call($i, /^/)) {
          return (($j = /^/).$inspect || $mm('inspect')).call($j)
          } else {
          return (($k = val).$inspect || $mm('inspect')).call($k)
        }
        }
        else if ((($q = (($r = __scope.Range) == null ? __opal.cm("Range") : $r))['$==='] || $mm('===')).call($q, $case)) {
        (($m = this.helpers)['$[]='] || $mm('[]=')).call($m, "range", true);
        return "__range(" + ((($n = val).$begin || $mm('begin')).call($n)) + ", " + ((($o = val).$end || $mm('end')).call($o)) + ", " + ((($p = val)['$exclude_end?'] || $mm('exclude_end?')).call($p)) + ")";
        }
        else {return (($r = this).$raise || $mm('raise')).call($r, "Bad lit: " + ((($s = val).$inspect || $mm('inspect')).call($s)))} }).call(this);
      };

      def.$process_dregx = function(sexp, level) {
        var parts = nil, TMP_14, $a, $b;
        parts = ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_14 = function(part) {

          var self = TMP_14._s || this, $a, $b, $c, $d, $e, $f, $g;
          if (part == null) part = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, part)) !== false && $a !== nil) {
            return (($a = part).$inspect || $mm('inspect')).call($a)
            } else {
            if ((($c = (($d = part)['$[]'] || $mm('[]')).call($d, 0))['$=='] || $mm('==')).call($c, "str")) {
              return (($e = self).$process || $mm('process')).call($e, part, "expr")
              } else {
              return (($f = self).$process || $mm('process')).call($f, (($g = part)['$[]'] || $mm('[]')).call($g, 1), "expr")
            }
          }
        }, TMP_14._s = this, TMP_14), $a).call($b);
        return "(new RegExp(" + ((($a = parts).$join || $mm('join')).call($a, " + ")) + "))";
      };

      def.$process_dot2 = function(sexp, level) {
        var lhs = nil, rhs = nil, $a, $b, $c, $d, $e, $f;
        lhs = (($a = this).$process || $mm('process')).call($a, (($b = sexp)['$[]'] || $mm('[]')).call($b, 0), "expr");
        rhs = (($c = this).$process || $mm('process')).call($c, (($d = sexp)['$[]'] || $mm('[]')).call($d, 1), "expr");
        (($e = this.helpers)['$[]='] || $mm('[]=')).call($e, "range", true);
        return (($f = "__range(%s, %s, false)")['$%'] || $mm('%')).call($f, [lhs, rhs]);
      };

      def.$process_dot3 = function(sexp, level) {
        var lhs = nil, rhs = nil, $a, $b, $c, $d, $e, $f;
        lhs = (($a = this).$process || $mm('process')).call($a, (($b = sexp)['$[]'] || $mm('[]')).call($b, 0), "expr");
        rhs = (($c = this).$process || $mm('process')).call($c, (($d = sexp)['$[]'] || $mm('[]')).call($d, 1), "expr");
        (($e = this.helpers)['$[]='] || $mm('[]=')).call($e, "range", true);
        return (($f = "__range(%s, %s, true)")['$%'] || $mm('%')).call($f, [lhs, rhs]);
      };

      def.$process_str = function(sexp, level) {
        var str = nil, $a, $b, $c, $d;
        str = (($a = sexp).$shift || $mm('shift')).call($a);
        if ((($b = str)['$=='] || $mm('==')).call($b, this.file)) {
          this.uses_file = true;
          return (($c = this.file).$inspect || $mm('inspect')).call($c);
          } else {
          return (($d = str).$inspect || $mm('inspect')).call($d)
        };
      };

      def.$process_defined = function(sexp, level) {
        var part = nil, $case = nil, mid = nil, recv = nil, ivar_name = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, TMP_15, $ab, $ac, $ad, $ae;
        part = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        return (function() { $case = (($b = part)['$[]'] || $mm('[]')).call($b, 0);if ((($d = "self")['$==='] || $mm('===')).call($d, $case)) {
        return (($c = "self").$inspect || $mm('inspect')).call($c)
        }
        else if ((($f = "nil")['$==='] || $mm('===')).call($f, $case)) {
        return (($e = "nil").$inspect || $mm('inspect')).call($e)
        }
        else if ((($h = "true")['$==='] || $mm('===')).call($h, $case)) {
        return (($g = "true").$inspect || $mm('inspect')).call($g)
        }
        else if ((($j = "false")['$==='] || $mm('===')).call($j, $case)) {
        return (($i = "false").$inspect || $mm('inspect')).call($i)
        }
        else if ((($r = "call")['$==='] || $mm('===')).call($r, $case)) {
        mid = (($k = this).$mid_to_jsid || $mm('mid_to_jsid')).call($k, (($l = (($m = part)['$[]'] || $mm('[]')).call($m, 2)).$to_s || $mm('to_s')).call($l));
        recv = (function() { if (($n = (($o = part)['$[]'] || $mm('[]')).call($o, 1)) !== false && $n !== nil) {
          return (($n = this).$process || $mm('process')).call($n, (($p = part)['$[]'] || $mm('[]')).call($p, 1), "expr")
          } else {
          return (($q = this).$current_self || $mm('current_self')).call($q)
        }; return nil; }).call(this);
        return "(" + (recv) + (mid) + " ? 'method' : nil)";
        }
        else if ((($t = "xstr")['$==='] || $mm('===')).call($t, $case)) {
        return "(typeof(" + ((($s = this).$process || $mm('process')).call($s, part, "expression")) + ") !== 'undefined')"
        }
        else if ((($w = "const")['$==='] || $mm('===')).call($w, $case)) {
        return "(__scope." + ((($u = (($v = part)['$[]'] || $mm('[]')).call($v, 1)).$to_s || $mm('to_s')).call($u)) + " != null)"
        }
        else if ((($x = "colon2")['$==='] || $mm('===')).call($x, $case)) {
        return "false"
        }
        else if ((($ab = "ivar")['$==='] || $mm('===')).call($ab, $case)) {
        ivar_name = (($y = (($z = (($aa = part)['$[]'] || $mm('[]')).call($aa, 1)).$to_s || $mm('to_s')).call($z))['$[]'] || $mm('[]')).call($y, __range(1, -1, false));
        return ($ab = (($ac = this).$with_temp || $mm('with_temp')), $ab._p = (TMP_15 = function(t) {

          var self = TMP_15._s || this, $a, $b;
          if (t == null) t = nil;

          return "((" + (t) + " = " + ((($a = self).$current_self || $mm('current_self')).call($a)) + "[" + ((($b = ivar_name).$inspect || $mm('inspect')).call($b)) + "], " + (t) + " != null && " + (t) + " !== nil) ? 'instance-variable' : nil)"
        }, TMP_15._s = this, TMP_15), $ab).call($ac);
        }
        else {return (($ad = this).$raise || $mm('raise')).call($ad, "bad defined? part: " + ((($ae = part)['$[]'] || $mm('[]')).call($ae, 0)))} }).call(this);
      };

      def.$process_not = function(sexp, level) {
        var TMP_16, $a, $b;
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_16 = function(tmp) {

          var self = TMP_16._s || this, $a, $b;
          if (tmp == null) tmp = nil;

          return "(" + (tmp) + " = " + ((($a = self).$process || $mm('process')).call($a, (($b = sexp).$shift || $mm('shift')).call($b), "expr")) + ", (" + (tmp) + " === nil || " + (tmp) + " === false))"
        }, TMP_16._s = this, TMP_16), $a).call($b);
      };

      def.$process_block_pass = function(exp, level) {
        var $a, $b, $c, $d;
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "call", (($c = exp).$shift || $mm('shift')).call($c), "to_proc", (($d = this).$s || $mm('s')).call($d, "arglist")), "expr");
      };

      def.$process_iter = function(sexp, level) {
        var call = nil, args = nil, body = nil, code = nil, params = nil, scope_name = nil, identity = nil, block_arg = nil, splat = nil, len = nil, itercode = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, TMP_17, $ac, $ad, $ae, $af, $ag, $ah;
        (($a = sexp)._isArray ? $a : ($a = [$a])), call = ($a[0] == null ? nil : $a[0]), args = ($a[1] == null ? nil : $a[1]), body = ($a[2] == null ? nil : $a[2]);
        (($a = body), $a !== false && $a !== nil ? $a : body = (($b = this).$s || $mm('s')).call($b, "nil"));
        body = (($a = this).$returns || $mm('returns')).call($a, body);
        code = "";
        params = nil;
        scope_name = nil;
        identity = nil;
        if (($c = (($d = (($e = __scope.Fixnum) == null ? __opal.cm("Fixnum") : $e))['$==='] || $mm('===')).call($d, args)) !== false && $c !== nil) {
          args = nil
        };
        (($c = args), $c !== false && $c !== nil ? $c : args = (($e = this).$s || $mm('s')).call($e, "masgn", (($f = this).$s || $mm('s')).call($f, "array")));
        args = (function() { if ((($c = (($g = args).$first || $mm('first')).call($g))['$=='] || $mm('==')).call($c, "lasgn")) {
          return (($h = this).$s || $mm('s')).call($h, "array", args)
          } else {
          return (($i = args)['$[]'] || $mm('[]')).call($i, 1)
        }; return nil; }).call(this);
        if (($j = ($k = (($k = (($l = args).$last || $mm('last')).call($l))['$is_a?'] || $mm('is_a?')).call($k, (($m = __scope.Array) == null ? __opal.cm("Array") : $m)), $k !== false && $k !== nil ? (($m = (($n = (($o = args).$last || $mm('last')).call($o))['$[]'] || $mm('[]')).call($n, 0))['$=='] || $mm('==')).call($m, "block_pass") : $k)) !== false && $j !== nil) {
          block_arg = (($j = args).$pop || $mm('pop')).call($j);
          block_arg = (($p = (($q = (($r = block_arg)['$[]'] || $mm('[]')).call($r, 1))['$[]'] || $mm('[]')).call($q, 1)).$to_sym || $mm('to_sym')).call($p);
        };
        if (($s = ($t = (($t = (($u = args).$last || $mm('last')).call($u))['$is_a?'] || $mm('is_a?')).call($t, (($v = __scope.Array) == null ? __opal.cm("Array") : $v)), $t !== false && $t !== nil ? (($v = (($w = (($x = args).$last || $mm('last')).call($x))['$[]'] || $mm('[]')).call($w, 0))['$=='] || $mm('==')).call($v, "splat") : $t)) !== false && $s !== nil) {
          splat = (($s = (($y = (($z = args).$last || $mm('last')).call($z))['$[]'] || $mm('[]')).call($y, 1))['$[]'] || $mm('[]')).call($s, 1);
          (($aa = args).$pop || $mm('pop')).call($aa);
          len = (($ab = args).$length || $mm('length')).call($ab);
        };
        ($ac = (($ad = this).$indent || $mm('indent')), $ac._p = (TMP_17 = function() {

          var self = TMP_17._s || this, TMP_18, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_18 = function() {

            var blk = nil, self = TMP_18._s || this, $a, $b, TMP_19, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            identity = (($a = self.scope)['$identify!'] || $mm('identify!')).call($a);
            (($b = self.scope).$add_temp || $mm('add_temp')).call($b, "self = " + (identity) + "._s || this");
            ($c = (($d = (($e = args)['$[]'] || $mm('[]')).call($e, __range(1, -1, false))).$each || $mm('each')), $c._p = (TMP_19 = function(arg) {

              var self = TMP_19._s || this, $a, $b, $c, $d;
              if (arg == null) arg = nil;

              arg = (($a = arg)['$[]'] || $mm('[]')).call($a, 1);
              if (($b = (($c = (($d = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $d))['$include?'] || $mm('include?')).call($c, (($d = arg).$to_s || $mm('to_s')).call($d))) !== false && $b !== nil) {
                arg = "" + (arg) + "$"
              };
              return code = (($b = code)['$+'] || $mm('+')).call($b, "if (" + (arg) + " == null) " + (arg) + " = nil;\n");
            }, TMP_19._s = self, TMP_19), $c).call($d);
            params = (($c = self).$js_block_args || $mm('js_block_args')).call($c, (($f = args)['$[]'] || $mm('[]')).call($f, __range(1, -1, false)));
            if (splat !== false && splat !== nil) {
              (($g = params)['$<<'] || $mm('<<')).call($g, splat);
              code = (($h = code)['$+'] || $mm('+')).call($h, "" + (splat) + " = __slice.call(arguments, " + (($i = len, $j = 1, typeof($i) === 'number' ? $i - $j : $i['$-']($j))) + ");");
            };
            if (block_arg !== false && block_arg !== nil) {
              (($i = self.scope)['$block_name='] || $mm('block_name=')).call($i, block_arg);
              (($j = self.scope).$add_temp || $mm('add_temp')).call($j, block_arg);
              (($k = self.scope).$add_temp || $mm('add_temp')).call($k, "__context");
              scope_name = (($l = self.scope)['$identify!'] || $mm('identify!')).call($l);
              blk = (($m = "\n%s%s = %s._p || nil, __context = %s._s, %s.p = null;\n%s")['$%'] || $mm('%')).call($m, [self.indent, block_arg, scope_name, block_arg, scope_name, self.indent]);
              code = ($n = blk, $o = code, typeof($n) === 'number' ? $n + $o : $n['$+']($o));
            };
            code = (($n = code)['$+'] || $mm('+')).call($n, ($o = "\n" + (self.indent), $p = (($q = self).$process || $mm('process')).call($q, body, "stmt"), typeof($o) === 'number' ? $o + $p : $o['$+']($p)));
            if (($o = (($p = self.scope).$defines_defn || $mm('defines_defn')).call($p)) !== false && $o !== nil) {
              (($o = self.scope).$add_temp || $mm('add_temp')).call($o, "def = ((typeof(" + ((($r = self).$current_self || $mm('current_self')).call($r)) + ") === 'function') ? " + ((($s = self).$current_self || $mm('current_self')).call($s)) + ".prototype : " + ((($t = self).$current_self || $mm('current_self')).call($t)) + ")")
            };
            return code = "\n" + (self.indent) + ((($u = self.scope).$to_vars || $mm('to_vars')).call($u)) + "\n" + (self.indent) + (code);
          }, TMP_18._s = self, TMP_18), $a).call($b, "iter")
        }, TMP_17._s = this, TMP_17), $ac).call($ad);
        itercode = "function(" + ((($ac = params).$join || $mm('join')).call($ac, ", ")) + ") {\n" + (code) + "\n" + (this.indent) + "}";
        (($ae = call)['$<<'] || $mm('<<')).call($ae, (($af = "(%s = %s, %s._s = %s, %s)")['$%'] || $mm('%')).call($af, [identity, itercode, identity, (($ag = this).$current_self || $mm('current_self')).call($ag), identity]));
        return (($ah = this).$process || $mm('process')).call($ah, call, level);
      };

      def.$js_block_args = function(sexp) {
        var TMP_20, $a, $b;
        return ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_20 = function(arg) {

          var a = nil, self = TMP_20._s || this, $a, $b, $c, $d, $e, $f;
          if (self.scope == null) self.scope = nil;

          if (arg == null) arg = nil;

          a = (($a = (($b = arg)['$[]'] || $mm('[]')).call($b, 1)).$to_sym || $mm('to_sym')).call($a);
          if (($c = (($d = (($e = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $e))['$include?'] || $mm('include?')).call($d, (($e = a).$to_s || $mm('to_s')).call($e))) !== false && $c !== nil) {
            a = (($c = ("" + (a) + "$")).$to_sym || $mm('to_sym')).call($c)
          };
          (($f = self.scope).$add_arg || $mm('add_arg')).call($f, a);
          return a;
        }, TMP_20._s = this, TMP_20), $a).call($b);
      };

      def.$process_attrasgn = function(exp, level) {
        var recv = nil, mid = nil, arglist = nil, $a, $b;
        (($a = exp)._isArray ? $a : ($a = [$a])), recv = ($a[0] == null ? nil : $a[0]), mid = ($a[1] == null ? nil : $a[1]), arglist = ($a[2] == null ? nil : $a[2]);
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "call", recv, mid, arglist), level);
      };

      def.$handle_attr_optimize = function(meth, attrs) {
        var out = nil, TMP_21, $a, $b, $c, $d;
        out = [];
        ($a = (($b = attrs).$each || $mm('each')), $a._p = (TMP_21 = function(attr) {

          var mid = nil, ivar = nil, pre = nil, self = TMP_21._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s;
          if (self.scope == null) self.scope = nil;

          if (attr == null) attr = nil;

          mid = (($a = attr)['$[]'] || $mm('[]')).call($a, 1);
          ivar = (($b = ("@" + (mid))).$to_sym || $mm('to_sym')).call($b);
          pre = (($c = self.scope).$proto || $mm('proto')).call($c);
          if (($d = (($e = meth)['$=='] || $mm('==')).call($e, "attr_writer")) === false || $d === nil) {
            (($d = out)['$<<'] || $mm('<<')).call($d, (($f = self).$process || $mm('process')).call($f, (($g = self).$s || $mm('s')).call($g, "defn", mid, (($h = self).$s || $mm('s')).call($h, "args"), (($i = self).$s || $mm('s')).call($i, "scope", (($j = self).$s || $mm('s')).call($j, "ivar", ivar))), "stmt"))
          };
          if ((($k = meth)['$=='] || $mm('==')).call($k, "attr_reader")) {
            return nil
            } else {
            mid = (($l = ("" + (mid) + "=")).$to_sym || $mm('to_sym')).call($l);
            return (($m = out)['$<<'] || $mm('<<')).call($m, (($n = self).$process || $mm('process')).call($n, (($o = self).$s || $mm('s')).call($o, "defn", mid, (($p = self).$s || $mm('s')).call($p, "args", "val"), (($q = self).$s || $mm('s')).call($q, "scope", (($r = self).$s || $mm('s')).call($r, "iasgn", ivar, (($s = self).$s || $mm('s')).call($s, "lvar", "val")))), "stmt"));
          };
        }, TMP_21._s = this, TMP_21), $a).call($b);
        return ($a = (($d = out).$join || $mm('join')).call($d, ", \n" + (this.indent)), $c = ", nil", typeof($a) === 'number' ? $a + $c : $a['$+']($c));
      };

      def.$handle_alias_native = function(sexp) {
        var args = nil, meth = nil, func = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l;
        args = (($a = sexp)['$[]'] || $mm('[]')).call($a, 2);
        meth = (($b = this).$mid_to_jsid || $mm('mid_to_jsid')).call($b, (($c = (($d = (($e = args)['$[]'] || $mm('[]')).call($e, 1))['$[]'] || $mm('[]')).call($d, 1)).$to_s || $mm('to_s')).call($c));
        func = (($f = (($g = args)['$[]'] || $mm('[]')).call($g, 2))['$[]'] || $mm('[]')).call($f, 1);
        (($h = (($i = this.scope).$methods || $mm('methods')).call($i))['$<<'] || $mm('<<')).call($h, meth);
        return (($j = "%s%s = %s.%s")['$%'] || $mm('%')).call($j, [(($k = this.scope).$proto || $mm('proto')).call($k), meth, (($l = this.scope).$proto || $mm('proto')).call($l), func]);
      };

      def.$process_call = function(sexp, level) {
        var recv = nil, meth = nil, arglist = nil, iter = nil, mid = nil, $case = nil, splat = nil, block = nil, tmpfunc = nil, tmprecv = nil, args = nil, recv_code = nil, call_recv = nil, dispatch = nil, result = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, TMP_22, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al;
        (($a = sexp)._isArray ? $a : ($a = [$a])), recv = ($a[0] == null ? nil : $a[0]), meth = ($a[1] == null ? nil : $a[1]), arglist = ($a[2] == null ? nil : $a[2]), iter = ($a[3] == null ? nil : $a[3]);
        mid = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = meth).$to_s || $mm('to_s')).call($b));
        $case = meth;if ((($f = "attr_reader")['$==='] || $mm('===')).call($f, $case) || (($g = "attr_writer")['$==='] || $mm('===')).call($g, $case) || (($h = "attr_accessor")['$==='] || $mm('===')).call($h, $case)) {
        if (($c = (($d = this.scope)['$class_scope?'] || $mm('class_scope?')).call($d)) !== false && $c !== nil) {
          return (($c = this).$handle_attr_optimize || $mm('handle_attr_optimize')).call($c, meth, (($e = arglist)['$[]'] || $mm('[]')).call($e, __range(1, -1, false)))
        }
        }
        else if ((($j = "block_given?")['$==='] || $mm('===')).call($j, $case)) {
        return (($i = this).$js_block_given || $mm('js_block_given')).call($i, sexp, level)
        }
        else if ((($m = "alias_native")['$==='] || $mm('===')).call($m, $case)) {
        if (($k = (($l = this.scope)['$class_scope?'] || $mm('class_scope?')).call($l)) !== false && $k !== nil) {
          return (($k = this).$handle_alias_native || $mm('handle_alias_native')).call($k, sexp)
        }
        }
        else if ((($p = "require")['$==='] || $mm('===')).call($p, $case)) {
        return (($n = this).$handle_require || $mm('handle_require')).call($n, (($o = arglist)['$[]'] || $mm('[]')).call($o, 1))
        };
        splat = ($q = (($r = (($s = arglist)['$[]'] || $mm('[]')).call($s, __range(1, -1, false)))['$any?'] || $mm('any?')), $q._p = (TMP_22 = function(a) {

          var self = TMP_22._s || this, $a, $b;
          if (a == null) a = nil;

          return (($a = (($b = a).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "splat")
        }, TMP_22._s = this, TMP_22), $q).call($r);
        if (($q = ($t = (($t = (($u = __scope.Array) == null ? __opal.cm("Array") : $u))['$==='] || $mm('===')).call($t, (($u = arglist).$last || $mm('last')).call($u)), $t !== false && $t !== nil ? (($v = (($w = (($x = arglist).$last || $mm('last')).call($x)).$first || $mm('first')).call($w))['$=='] || $mm('==')).call($v, "block_pass") : $t)) !== false && $q !== nil) {
          block = (($q = this).$process || $mm('process')).call($q, (($y = this).$s || $mm('s')).call($y, "js_tmp", (($z = this).$process || $mm('process')).call($z, (($aa = arglist).$pop || $mm('pop')).call($aa), "expr")), "expr")
          } else {
          if (iter !== false && iter !== nil) {
            block = iter
          }
        };
        (($ab = recv), $ab !== false && $ab !== nil ? $ab : recv = (($ac = this).$s || $mm('s')).call($ac, "self"));
        if (block !== false && block !== nil) {
          tmpfunc = (($ab = this.scope).$new_temp || $mm('new_temp')).call($ab)
        };
        tmprecv = (($ad = this.scope).$new_temp || $mm('new_temp')).call($ad);
        args = "";
        recv_code = (($ae = this).$process || $mm('process')).call($ae, recv, "recv");
        if (($af = this.method_missing) !== false && $af !== nil) {
          call_recv = (($af = this).$s || $mm('s')).call($af, "js_tmp", (($ag = tmprecv), $ag !== false && $ag !== nil ? $ag : recv_code));
          if (($ag = splat) === false || $ag === nil) {
            (($ag = arglist).$insert || $mm('insert')).call($ag, 1, call_recv)
          };
          args = (($ah = this).$process || $mm('process')).call($ah, arglist, "expr");
          dispatch = "((" + (tmprecv) + " = " + (recv_code) + ")" + (mid) + " || $mm('" + ((($ai = meth).$to_s || $mm('to_s')).call($ai)) + "'))";
          if (tmpfunc !== false && tmpfunc !== nil) {
            dispatch = "(" + (tmpfunc) + " = " + (dispatch) + ", " + (tmpfunc) + "._p = " + (block) + ", " + (tmpfunc) + ")"
          };
          result = (function() { if (splat !== false && splat !== nil) {
            return "" + (dispatch) + ".apply(" + ((($aj = this).$process || $mm('process')).call($aj, call_recv, "expr")) + ", " + (args) + ")"
            } else {
            return "" + (dispatch) + ".call(" + (args) + ")"
          }; return nil; }).call(this);
          } else {
          args = (($ak = this).$process || $mm('process')).call($ak, arglist, "expr");
          dispatch = (function() { if (tmprecv !== false && tmprecv !== nil) {
            return "(" + (tmprecv) + " = " + (recv_code) + ")" + (mid)
            } else {
            return "" + (recv_code) + (mid)
          }; return nil; }).call(this);
          result = (function() { if (splat !== false && splat !== nil) {
            return "" + (dispatch) + ".apply(" + ((($al = tmprecv), $al !== false && $al !== nil ? $al : recv_code)) + ", " + (args) + ")"
            } else {
            return "" + (dispatch) + "(" + (args) + ")"
          }; return nil; }).call(this);
        };
        if (tmpfunc !== false && tmpfunc !== nil) {
          (($al = this.scope).$queue_temp || $mm('queue_temp')).call($al, tmpfunc)
        };
        return result;
      };

      def.$handle_require = function(sexp) {
        var str = nil, $a, $b, $c;
        str = (($a = this).$handle_require_sexp || $mm('handle_require_sexp')).call($a, sexp);
        if (($b = (($c = str)['$nil?'] || $mm('nil?')).call($c)) === false || $b === nil) {
          (($b = this.requires)['$<<'] || $mm('<<')).call($b, str)
        };
        return "";
      };

      def.$handle_require_sexp = function(sexp) {
        var type = nil, recv = nil, meth = nil, args = nil, parts = nil, $case = nil, $a, $b, $c, $d, $e, TMP_23, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v;
        type = (($a = sexp).$shift || $mm('shift')).call($a);
        if ((($b = type)['$=='] || $mm('==')).call($b, "str")) {
          return (($c = sexp)['$[]'] || $mm('[]')).call($c, 0)
          } else {
          if ((($d = type)['$=='] || $mm('==')).call($d, "call")) {
            (($e = sexp)._isArray ? $e : ($e = [$e])), recv = ($e[0] == null ? nil : $e[0]), meth = ($e[1] == null ? nil : $e[1]), args = ($e[2] == null ? nil : $e[2]);
            parts = ($e = (($f = (($g = args)['$[]'] || $mm('[]')).call($g, __range(1, -1, false))).$map || $mm('map')), $e._p = (TMP_23 = function(s) {

              var self = TMP_23._s || this, $a;
              if (s == null) s = nil;

              return (($a = self).$handle_require_sexp || $mm('handle_require_sexp')).call($a, s)
            }, TMP_23._s = this, TMP_23), $e).call($f);
            if ((($e = recv)['$=='] || $mm('==')).call($e, ["const", "File"])) {
              if ((($h = meth)['$=='] || $mm('==')).call($h, "expand_path")) {
                return (($i = this).$handle_expand_path || $mm('handle_expand_path')).apply($i, [].concat(parts))
                } else {
                if ((($j = meth)['$=='] || $mm('==')).call($j, "join")) {
                  return (($k = this).$handle_expand_path || $mm('handle_expand_path')).call($k, (($l = parts).$join || $mm('join')).call($l, "/"))
                  } else {
                  if ((($m = meth)['$=='] || $mm('==')).call($m, "dirname")) {
                    return (($n = this).$handle_expand_path || $mm('handle_expand_path')).call($n, (($o = (($p = (($q = (($r = parts)['$[]'] || $mm('[]')).call($r, 0)).$split || $mm('split')).call($q, "/"))['$[]'] || $mm('[]')).call($p, __range(0, -1, true))).$join || $mm('join')).call($o, "/"))
                  }
                }
              }
            };
          }
        };
        return (function() { $case = this.dynamic_require_severity;if ((($t = "error")['$==='] || $mm('===')).call($t, $case)) {
        return (($s = this).$error || $mm('error')).call($s, "Cannot handle dynamic require")
        }
        else if ((($v = "warning")['$==='] || $mm('===')).call($v, $case)) {
        return (($u = this).$warning || $mm('warning')).call($u, "Cannot handle dynamic require")
        }
        else {return nil} }).call(this);
      };

      def.$handle_expand_path = function(path, base) {
        var $a, TMP_24, $b, $c, $d;if (base == null) {
          base = ""
        }
        return (($a = ($b = (($c = (($d = ("" + (base) + "/" + (path))).$split || $mm('split')).call($d, "/")).$inject || $mm('inject')), $b._p = (TMP_24 = function(path, part) {

          var self = TMP_24._s || this, $a, $b, $c, $d;
          if (path == null) path = nil;
if (part == null) part = nil;

          if (($a = (($b = part)['$=='] || $mm('==')).call($b, "")) === false || $a === nil) {
            if ((($a = part)['$=='] || $mm('==')).call($a, "..")) {
              (($c = path).$pop || $mm('pop')).call($c)
              } else {
              (($d = path)['$<<'] || $mm('<<')).call($d, part)
            }
          };
          return path;
        }, TMP_24._s = this, TMP_24), $b).call($c, [])).$join || $mm('join')).call($a, "/");
      };

      def.$process_arglist = function(sexp, level) {
        var code = nil, work = nil, splat = nil, arg = nil, join = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t;
        code = "";
        work = [];
        while (!(($b = (($c = sexp)['$empty?'] || $mm('empty?')).call($c)) !== false && $b !== nil)) {splat = (($b = (($d = (($e = sexp).$first || $mm('first')).call($e)).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($b, "splat");
        arg = (($f = this).$process || $mm('process')).call($f, (($g = sexp).$shift || $mm('shift')).call($g), "expr");
        if (splat !== false && splat !== nil) {
          if (($h = (($i = work)['$empty?'] || $mm('empty?')).call($i)) !== false && $h !== nil) {
            if (($h = (($j = code)['$empty?'] || $mm('empty?')).call($j)) !== false && $h !== nil) {
              code = (($h = code)['$+'] || $mm('+')).call($h, "[].concat(" + (arg) + ")")
              } else {
              code = (($k = code)['$+'] || $mm('+')).call($k, ".concat(" + (arg) + ")")
            }
            } else {
            join = "[" + ((($l = work).$join || $mm('join')).call($l, ", ")) + "]";
            code = (($m = code)['$+'] || $mm('+')).call($m, (function() { if (($n = (($o = code)['$empty?'] || $mm('empty?')).call($o)) !== false && $n !== nil) {
              return join
              } else {
              return ".concat(" + (join) + ")"
            }; return nil; }).call(this));
            code = (($n = code)['$+'] || $mm('+')).call($n, ".concat(" + (arg) + ")");
          };
          work = [];
          } else {
          (($p = work).$push || $mm('push')).call($p, arg)
        };};
        if (($a = (($q = work)['$empty?'] || $mm('empty?')).call($q)) === false || $a === nil) {
          join = (($a = work).$join || $mm('join')).call($a, ", ");
          code = (($r = code)['$+'] || $mm('+')).call($r, (function() { if (($s = (($t = code)['$empty?'] || $mm('empty?')).call($t)) !== false && $s !== nil) {
            return join
            } else {
            return ".concat([" + (join) + "])"
          }; return nil; }).call(this));
        };
        return code;
      };

      def.$process_splat = function(sexp, level) {
        var $a, $b, $c, $d, $e, $f, $g, $h, $i;
        if ((($a = (($b = sexp).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, ["nil"])) {
          return "[]"
        };
        if ((($c = (($d = (($e = sexp).$first || $mm('first')).call($e)).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "lit")) {
          return "[" + ((($f = this).$process || $mm('process')).call($f, (($g = sexp).$first || $mm('first')).call($g), "expr")) + "]"
        };
        return (($h = this).$process || $mm('process')).call($h, (($i = sexp).$first || $mm('first')).call($i), "recv");
      };

      def.$process_class = function(sexp, level) {
        var cid = nil, sup = nil, body = nil, code = nil, base = nil, name = nil, spacer = nil, cls = nil, boot = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, TMP_25, $u, $v;
        (($a = sexp)._isArray ? $a : ($a = [$a])), cid = ($a[0] == null ? nil : $a[0]), sup = ($a[1] == null ? nil : $a[1]), body = ($a[2] == null ? nil : $a[2]);
        if (($a = (($b = body)['$[]'] || $mm('[]')).call($b, 1)) === false || $a === nil) {
          (($a = body)['$[]='] || $mm('[]=')).call($a, 1, (($c = this).$s || $mm('s')).call($c, "nil"))
        };
        code = nil;
        (($d = this.helpers)['$[]='] || $mm('[]=')).call($d, "klass", true);
        if (($e = (($f = (($g = (($h = __scope.Symbol) == null ? __opal.cm("Symbol") : $h))['$==='] || $mm('===')).call($g, cid)), $f !== false && $f !== nil ? $f : (($h = (($i = __scope.String) == null ? __opal.cm("String") : $i))['$==='] || $mm('===')).call($h, cid))) !== false && $e !== nil) {
          base = (($e = this).$current_self || $mm('current_self')).call($e);
          name = (($f = cid).$to_s || $mm('to_s')).call($f);
          } else {
          if ((($i = (($j = cid)['$[]'] || $mm('[]')).call($j, 0))['$=='] || $mm('==')).call($i, "colon2")) {
            base = (($k = this).$process || $mm('process')).call($k, (($l = cid)['$[]'] || $mm('[]')).call($l, 1), "expr");
            name = (($m = (($n = cid)['$[]'] || $mm('[]')).call($n, 2)).$to_s || $mm('to_s')).call($m);
            } else {
            if ((($o = (($p = cid)['$[]'] || $mm('[]')).call($p, 0))['$=='] || $mm('==')).call($o, "colon3")) {
              base = "Opal.Object";
              name = (($q = (($r = cid)['$[]'] || $mm('[]')).call($r, 1)).$to_s || $mm('to_s')).call($q);
              } else {
              (($s = this).$raise || $mm('raise')).call($s, "Bad receiver in class")
            }
          }
        };
        sup = (function() { if (sup !== false && sup !== nil) {
          return (($t = this).$process || $mm('process')).call($t, sup, "expr")
          } else {
          return "null"
        }; return nil; }).call(this);
        ($u = (($v = this).$indent || $mm('indent')), $u._p = (TMP_25 = function() {

          var self = TMP_25._s || this, TMP_26, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_26 = function() {

            var needs_block = nil, last_body_statement = nil, self = TMP_26._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            (($a = self.scope)['$name='] || $mm('name=')).call($a, name);
            (($b = self.scope).$add_temp || $mm('add_temp')).call($b, "" + ((($c = self.scope).$proto || $mm('proto')).call($c)) + " = " + (name) + ".prototype", "__scope = " + (name) + "._scope");
            if (($d = (($e = (($f = __scope.Array) == null ? __opal.cm("Array") : $f))['$==='] || $mm('===')).call($e, (($f = body).$last || $mm('last')).call($f))) !== false && $d !== nil) {
              needs_block = ($d = (($g = (($h = (($i = body).$last || $mm('last')).call($i)).$first || $mm('first')).call($h))['$=='] || $mm('==')).call($g, "block"), ($d === nil || $d === false));
              (($d = (($j = (($k = body).$last || $mm('last')).call($k)).$first || $mm('first')).call($j))['$=='] || $mm('==')).call($d, "block");
              last_body_statement = (function() { if (needs_block !== false && needs_block !== nil) {
                return (($l = body).$last || $mm('last')).call($l)
                } else {
                return (($m = (($n = body).$last || $mm('last')).call($n)).$last || $mm('last')).call($m)
              }; return nil; }).call(self);
              if (($o = (($p = last_body_statement !== false && last_body_statement !== nil) ? (($q = (($r = __scope.Array) == null ? __opal.cm("Array") : $r))['$==='] || $mm('===')).call($q, last_body_statement) : $p)) !== false && $o !== nil) {
                if (($o = (($p = ["defn", "defs"])['$include?'] || $mm('include?')).call($p, (($r = last_body_statement).$first || $mm('first')).call($r))) !== false && $o !== nil) {
                  if (needs_block !== false && needs_block !== nil) {
                    (($o = body)['$[]='] || $mm('[]=')).call($o, -1, (($s = self).$s || $mm('s')).call($s, "block", (($t = body)['$[]'] || $mm('[]')).call($t, -1)))
                  };
                  (($u = (($v = body).$last || $mm('last')).call($v))['$<<'] || $mm('<<')).call($u, (($w = self).$s || $mm('s')).call($w, "nil"));
                }
              };
            };
            body = (($x = self).$returns || $mm('returns')).call($x, body);
            body = (($y = self).$process || $mm('process')).call($y, body, "stmt");
            code = "\n" + ((($z = self.scope).$to_donate_methods || $mm('to_donate_methods')).call($z));
            return code = (($aa = code)['$+'] || $mm('+')).call($aa, ($ab = ($ad = ($af = self.indent, $ag = (($ah = self.scope).$to_vars || $mm('to_vars')).call($ah), typeof($af) === 'number' ? $af + $ag : $af['$+']($ag)), $ae = "\n\n" + (self.indent), typeof($ad) === 'number' ? $ad + $ae : $ad['$+']($ae)), $ac = body, typeof($ab) === 'number' ? $ab + $ac : $ab['$+']($ac)));
          }, TMP_26._s = self, TMP_26), $a).call($b, "class")
        }, TMP_25._s = this, TMP_25), $u).call($v);
        spacer = "\n" + (this.indent) + ((($u = __scope.INDENT) == null ? __opal.cm("INDENT") : $u));
        cls = "function " + (name) + "() {};";
        boot = "" + (name) + " = __klass(__base, __super, " + ((($u = name).$inspect || $mm('inspect')).call($u)) + ", " + (name) + ");";
        return "(function(__base, __super){" + (spacer) + (cls) + (spacer) + (boot) + "\n" + (code) + "\n" + (this.indent) + "})(" + (base) + ", " + (sup) + ")";
      };

      def.$process_sclass = function(sexp, level) {
        var recv = nil, body = nil, code = nil, call = nil, $a, $b, TMP_27, $c, $d, $e, $f;
        recv = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        body = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        code = nil;
        ($c = (($d = this).$in_scope || $mm('in_scope')), $c._p = (TMP_27 = function() {

          var self = TMP_27._s || this, $a, $b, $c, $d, $e, $f, $g, $h;
          if (self.scope == null) self.scope = nil;

          
          (($a = self.scope).$add_temp || $mm('add_temp')).call($a, "__scope = " + ((($b = self).$current_self || $mm('current_self')).call($b)) + "._scope");
          (($c = self.scope).$add_temp || $mm('add_temp')).call($c, "def = " + ((($d = self).$current_self || $mm('current_self')).call($d)) + ".prototype");
          body = (($e = self).$process || $mm('process')).call($e, body, "stmt");
          return code = ($f = (($h = self.scope).$to_vars || $mm('to_vars')).call($h), $g = body, typeof($f) === 'number' ? $f + $g : $f['$+']($g));
        }, TMP_27._s = this, TMP_27), $c).call($d, "sclass");
        call = (($c = this).$s || $mm('s')).call($c, "call", recv, "singleton_class", (($e = this).$s || $mm('s')).call($e, "arglist"));
        return "(function(){" + (code) + "}).call(" + ((($f = this).$process || $mm('process')).call($f, call, "expr")) + ")";
      };

      def.$process_module = function(sexp, level) {
        var cid = nil, body = nil, code = nil, base = nil, name = nil, spacer = nil, cls = nil, boot = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, TMP_28, $s, $t;
        cid = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        body = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        code = nil;
        (($c = this.helpers)['$[]='] || $mm('[]=')).call($c, "module", true);
        if (($d = (($e = (($f = (($g = __scope.Symbol) == null ? __opal.cm("Symbol") : $g))['$==='] || $mm('===')).call($f, cid)), $e !== false && $e !== nil ? $e : (($g = (($h = __scope.String) == null ? __opal.cm("String") : $h))['$==='] || $mm('===')).call($g, cid))) !== false && $d !== nil) {
          base = (($d = this).$current_self || $mm('current_self')).call($d);
          name = (($e = cid).$to_s || $mm('to_s')).call($e);
          } else {
          if ((($h = (($i = cid)['$[]'] || $mm('[]')).call($i, 0))['$=='] || $mm('==')).call($h, "colon2")) {
            base = (($j = this).$process || $mm('process')).call($j, (($k = cid)['$[]'] || $mm('[]')).call($k, 1), "expr");
            name = (($l = (($m = cid)['$[]'] || $mm('[]')).call($m, 2)).$to_s || $mm('to_s')).call($l);
            } else {
            if ((($n = (($o = cid)['$[]'] || $mm('[]')).call($o, 0))['$=='] || $mm('==')).call($n, "colon3")) {
              base = "Opal.Object";
              name = (($p = (($q = cid)['$[]'] || $mm('[]')).call($q, 1)).$to_s || $mm('to_s')).call($p);
              } else {
              (($r = this).$raise || $mm('raise')).call($r, "Bad receiver in class")
            }
          }
        };
        ($s = (($t = this).$indent || $mm('indent')), $s._p = (TMP_28 = function() {

          var self = TMP_28._s || this, TMP_29, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_29 = function() {

            var self = TMP_29._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            (($a = self.scope)['$name='] || $mm('name=')).call($a, name);
            (($b = self.scope).$add_temp || $mm('add_temp')).call($b, "" + ((($c = self.scope).$proto || $mm('proto')).call($c)) + " = " + (name) + ".prototype", "__scope = " + (name) + "._scope");
            body = (($d = self).$process || $mm('process')).call($d, body, "stmt");
            return code = ($e = ($g = ($i = ($k = ($m = self.indent, $n = (($o = self.scope).$to_vars || $mm('to_vars')).call($o), typeof($m) === 'number' ? $m + $n : $m['$+']($n)), $l = "\n\n" + (self.indent), typeof($k) === 'number' ? $k + $l : $k['$+']($l)), $j = body, typeof($i) === 'number' ? $i + $j : $i['$+']($j)), $h = "\n" + (self.indent), typeof($g) === 'number' ? $g + $h : $g['$+']($h)), $f = (($g = self.scope).$to_donate_methods || $mm('to_donate_methods')).call($g), typeof($e) === 'number' ? $e + $f : $e['$+']($f));
          }, TMP_29._s = self, TMP_29), $a).call($b, "module")
        }, TMP_28._s = this, TMP_28), $s).call($t);
        spacer = "\n" + (this.indent) + ((($s = __scope.INDENT) == null ? __opal.cm("INDENT") : $s));
        cls = "function " + (name) + "() {};";
        boot = "" + (name) + " = __module(__base, " + ((($s = name).$inspect || $mm('inspect')).call($s)) + ", " + (name) + ");";
        return "(function(__base){" + (spacer) + (cls) + (spacer) + (boot) + "\n" + (code) + "\n" + (this.indent) + "})(" + (base) + ")";
      };

      def.$process_undef = function(sexp, level) {
        var $a, $b, $c, $d, $e;
        return "delete " + ((($a = this.scope).$proto || $mm('proto')).call($a)) + ((($b = this).$mid_to_jsid || $mm('mid_to_jsid')).call($b, (($c = (($d = (($e = sexp)['$[]'] || $mm('[]')).call($e, 0))['$[]'] || $mm('[]')).call($d, 1)).$to_s || $mm('to_s')).call($c)));
      };

      def.$process_defn = function(sexp, level) {
        var mid = nil, args = nil, stmts = nil, $a, $b, $c;
        (($a = sexp)._isArray ? $a : ($a = [$a])), mid = ($a[0] == null ? nil : $a[0]), args = ($a[1] == null ? nil : $a[1]), stmts = ($a[2] == null ? nil : $a[2]);
        return (($a = this).$js_def || $mm('js_def')).call($a, nil, mid, args, stmts, (($b = sexp).$line || $mm('line')).call($b), (($c = sexp).$end_line || $mm('end_line')).call($c));
      };

      def.$process_defs = function(sexp, level) {
        var recv = nil, mid = nil, args = nil, stmts = nil, $a, $b, $c;
        (($a = sexp)._isArray ? $a : ($a = [$a])), recv = ($a[0] == null ? nil : $a[0]), mid = ($a[1] == null ? nil : $a[1]), args = ($a[2] == null ? nil : $a[2]), stmts = ($a[3] == null ? nil : $a[3]);
        return (($a = this).$js_def || $mm('js_def')).call($a, recv, mid, args, stmts, (($b = sexp).$line || $mm('line')).call($b), (($c = sexp).$end_line || $mm('end_line')).call($c));
      };

      def.$js_def = function(recvr, mid, args, stmts, line, end_line) {
        var jsid = nil, smethod = nil, recv = nil, code = nil, params = nil, scope_name = nil, uses_super = nil, uses_splat = nil, opt = nil, argc = nil, block_name = nil, splat = nil, arity_code = nil, defcode = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, TMP_30, $al, $am, $an, $ao, $ap, $aq, $ar, $as, $at, $au, $av, $aw, $ax, $ay;
        jsid = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = mid).$to_s || $mm('to_s')).call($b));
        if (recvr !== false && recvr !== nil) {
          (($c = this.scope)['$defines_defs='] || $mm('defines_defs=')).call($c, true);
          if (($d = ($e = (($e = this.scope)['$class_scope?'] || $mm('class_scope?')).call($e), $e !== false && $e !== nil ? (($f = (($g = recvr).$first || $mm('first')).call($g))['$=='] || $mm('==')).call($f, "self") : $e)) !== false && $d !== nil) {
            smethod = true
          };
          recv = (($d = this).$process || $mm('process')).call($d, recvr, "expr");
          } else {
          (($h = this.scope)['$defines_defn='] || $mm('defines_defn=')).call($h, true);
          recv = (($i = this).$current_self || $mm('current_self')).call($i);
        };
        code = "";
        params = nil;
        scope_name = nil;
        uses_super = nil;
        uses_splat = nil;
        if (($j = (($k = (($l = __scope.Array) == null ? __opal.cm("Array") : $l))['$==='] || $mm('===')).call($k, (($l = args).$last || $mm('last')).call($l))) !== false && $j !== nil) {
          opt = (($j = args).$pop || $mm('pop')).call($j)
        };
        argc = ($m = (($o = args).$length || $mm('length')).call($o), $n = 1, typeof($m) === 'number' ? $m - $n : $m['$-']($n));
        if (($m = (($n = (($p = (($q = args).$last || $mm('last')).call($q)).$to_s || $mm('to_s')).call($p))['$start_with?'] || $mm('start_with?')).call($n, "&")) !== false && $m !== nil) {
          block_name = (($m = (($r = (($s = (($t = args).$pop || $mm('pop')).call($t)).$to_s || $mm('to_s')).call($s))['$[]'] || $mm('[]')).call($r, __range(1, -1, false))).$to_sym || $mm('to_sym')).call($m);
          argc = (($u = argc)['$-'] || $mm('-')).call($u, 1);
        };
        if (($v = (($w = (($x = (($y = args).$last || $mm('last')).call($y)).$to_s || $mm('to_s')).call($x))['$start_with?'] || $mm('start_with?')).call($w, "*")) !== false && $v !== nil) {
          uses_splat = true;
          if ((($v = (($z = args).$last || $mm('last')).call($z))['$=='] || $mm('==')).call($v, "*")) {
            argc = (($aa = argc)['$-'] || $mm('-')).call($aa, 1)
            } else {
            splat = (($ab = (($ac = (($ad = (($ae = args)['$[]'] || $mm('[]')).call($ae, -1)).$to_s || $mm('to_s')).call($ad))['$[]'] || $mm('[]')).call($ac, __range(1, -1, false))).$to_sym || $mm('to_sym')).call($ab);
            (($af = args)['$[]='] || $mm('[]=')).call($af, -1, splat);
            argc = (($ag = argc)['$-'] || $mm('-')).call($ag, 1);
          };
        };
        if (($ah = this.arity_check) !== false && $ah !== nil) {
          arity_code = ($ah = (($aj = this).$arity_check || $mm('arity_check')).call($aj, args, opt, uses_splat, block_name, mid), $ai = "\n" + ((($ak = __scope.INDENT) == null ? __opal.cm("INDENT") : $ak)), typeof($ah) === 'number' ? $ah + $ai : $ah['$+']($ai))
        };
        ($ah = (($ai = this).$indent || $mm('indent')), $ah._p = (TMP_30 = function() {

          var self = TMP_30._s || this, TMP_31, $a, $b;
          
          return ($a = (($b = self).$in_scope || $mm('in_scope')), $a._p = (TMP_31 = function() {

            var yielder = nil, stmt_code = nil, blk = nil, self = TMP_31._s || this, $a, $b, $c, $d, $e, $f, $g, $h, TMP_32, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r;
            if (self.scope == null) self.scope = nil;
            if (self.indent == null) self.indent = nil;

            
            (($a = self.scope)['$mid='] || $mm('mid=')).call($a, mid);
            if (recvr !== false && recvr !== nil) {
              (($b = self.scope)['$defs='] || $mm('defs=')).call($b, true)
            };
            if (block_name !== false && block_name !== nil) {
              (($c = self.scope)['$uses_block!'] || $mm('uses_block!')).call($c)
            };
            yielder = (($d = block_name), $d !== false && $d !== nil ? $d : "__yield");
            (($d = self.scope)['$block_name='] || $mm('block_name=')).call($d, yielder);
            params = (($e = self).$process || $mm('process')).call($e, args, "expr");
            stmt_code = ($f = "\n" + (self.indent), $g = (($h = self).$process || $mm('process')).call($h, stmts, "stmt"), typeof($f) === 'number' ? $f + $g : $f['$+']($g));
            if (opt !== false && opt !== nil) {
              ($f = (($g = (($i = opt)['$[]'] || $mm('[]')).call($i, __range(1, -1, false))).$each || $mm('each')), $f._p = (TMP_32 = function(o) {

                var id = nil, self = TMP_32._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
                if (self.indent == null) self.indent = nil;

                if (o == null) o = nil;

                if ((($a = (($b = (($c = o)['$[]'] || $mm('[]')).call($c, 2))['$[]'] || $mm('[]')).call($b, 2))['$=='] || $mm('==')).call($a, "undefined")) {
                  return nil;
                };
                id = (($d = self).$process || $mm('process')).call($d, (($e = self).$s || $mm('s')).call($e, "lvar", (($f = o)['$[]'] || $mm('[]')).call($f, 1)), "expr");
                return code = (($g = code)['$+'] || $mm('+')).call($g, (($h = "if (%s == null) {\n%s%s\n%s}")['$%'] || $mm('%')).call($h, [id, ($i = self.indent, $j = (($k = __scope.INDENT) == null ? __opal.cm("INDENT") : $k), typeof($i) === 'number' ? $i + $j : $i['$+']($j)), (($i = self).$process || $mm('process')).call($i, o, "expre"), self.indent]));
              }, TMP_32._s = self, TMP_32), $f).call($g)
            };
            if (splat !== false && splat !== nil) {
              code = (($f = code)['$+'] || $mm('+')).call($f, "" + (splat) + " = __slice.call(arguments, " + (argc) + ");")
            };
            scope_name = (($j = self.scope).$identity || $mm('identity')).call($j);
            if (($k = (($l = self.scope)['$uses_block?'] || $mm('uses_block?')).call($l)) !== false && $k !== nil) {
              (($k = self.scope).$add_temp || $mm('add_temp')).call($k, yielder);
              blk = (($m = "\n%s%s = %s._p || nil, %s._p = null;\n%s")['$%'] || $mm('%')).call($m, [self.indent, yielder, scope_name, scope_name, self.indent]);
            };
            code = (($n = code)['$+'] || $mm('+')).call($n, stmt_code);
            code = "" + (blk) + (code);
            uses_super = (($o = self.scope).$uses_super || $mm('uses_super')).call($o);
            return code = ($p = "" + (arity_code) + (self.indent) + ((($r = self.scope).$to_vars || $mm('to_vars')).call($r)), $q = code, typeof($p) === 'number' ? $p + $q : $p['$+']($q));
          }, TMP_31._s = self, TMP_31), $a).call($b, "def")
        }, TMP_30._s = this, TMP_30), $ah).call($ai);
        defcode = "" + ((function() { if (scope_name !== false && scope_name !== nil) {
          return "" + (scope_name) + " = "
          } else {
          return nil
        }; return nil; }).call(this)) + "function(" + (params) + ") {\n" + (code) + "\n" + (this.indent) + "}";
        if (recvr !== false && recvr !== nil) {
          if (smethod !== false && smethod !== nil) {
            return "__opal.defs(" + ((($ah = this.scope).$name || $mm('name')).call($ah)) + ", '$" + (mid) + "', " + (defcode) + ")"
            } else {
            return "" + (recv) + (jsid) + " = " + (defcode)
          }
          } else {
          if (($ak = ($al = (($al = this.scope)['$class?'] || $mm('class?')).call($al), $al !== false && $al !== nil ? (($am = (($an = this.scope).$name || $mm('name')).call($an))['$=='] || $mm('==')).call($am, "Object") : $al)) !== false && $ak !== nil) {
            return "" + ((($ak = this).$current_self || $mm('current_self')).call($ak)) + "._defn('$" + (mid) + "', " + (defcode) + ")"
            } else {
            if (($ao = (($ap = this.scope)['$class_scope?'] || $mm('class_scope?')).call($ap)) !== false && $ao !== nil) {
              (($ao = (($aq = this.scope).$methods || $mm('methods')).call($aq))['$<<'] || $mm('<<')).call($ao, "$" + (mid));
              if (uses_super !== false && uses_super !== nil) {
                (($ar = this.scope).$add_temp || $mm('add_temp')).call($ar, uses_super);
                uses_super = "" + (uses_super) + " = " + ((($as = this.scope).$proto || $mm('proto')).call($as)) + (jsid) + ";\n" + (this.indent);
              };
              return "" + (uses_super) + ((($at = this.scope).$proto || $mm('proto')).call($at)) + (jsid) + " = " + (defcode);
              } else {
              if ((($au = (($av = this.scope).$type || $mm('type')).call($av))['$=='] || $mm('==')).call($au, "iter")) {
                return "def" + (jsid) + " = " + (defcode)
                } else {
                if ((($aw = (($ax = this.scope).$type || $mm('type')).call($ax))['$=='] || $mm('==')).call($aw, "top")) {
                  return "" + ((($ay = this).$current_self || $mm('current_self')).call($ay)) + (jsid) + " = " + (defcode)
                  } else {
                  return "def" + (jsid) + " = " + (defcode)
                }
              }
            }
          }
        };
      };

      def.$arity_check = function(args, opt, splat, block_name, mid) {
        var meth = nil, arity = nil, aritycode = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
        meth = (($a = (($b = mid).$to_s || $mm('to_s')).call($b)).$inspect || $mm('inspect')).call($a);
        arity = ($c = (($e = args).$size || $mm('size')).call($e), $d = 1, typeof($c) === 'number' ? $c - $d : $c['$-']($d));
        if (opt !== false && opt !== nil) {
          arity = (($c = arity)['$-'] || $mm('-')).call($c, ($d = (($g = opt).$size || $mm('size')).call($g), $f = 1, typeof($d) === 'number' ? $d - $f : $d['$-']($f)))
        };
        if (splat !== false && splat !== nil) {
          arity = (($d = arity)['$-'] || $mm('-')).call($d, 1)
        };
        if (($f = (($h = opt), $h !== false && $h !== nil ? $h : splat)) !== false && $f !== nil) {
          arity = ($f = (($i = arity)['$-@'] || $mm('-@')).call($i), $h = 1, typeof($f) === 'number' ? $f - $h : $f['$-']($h))
        };
        aritycode = "var $arity = arguments.length;";
        if ((($f = arity)['$<'] || $mm('<')).call($f, 0)) {
          return ($h = aritycode, $j = "if ($arity < " + ((($k = ($l = arity, $m = 1, typeof($l) === 'number' ? $l + $m : $l['$+']($m)))['$-@'] || $mm('-@')).call($k)) + ") { __opal.ac($arity, " + (arity) + ", this, " + (meth) + "); }", typeof($h) === 'number' ? $h + $j : $h['$+']($j))
          } else {
          return ($h = aritycode, $j = "if ($arity !== " + (arity) + ") { __opal.ac($arity, " + (arity) + ", this, " + (meth) + "); }", typeof($h) === 'number' ? $h + $j : $h['$+']($j))
        };
      };

      def.$process_args = function(exp, level) {
        var args = nil, a = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
        args = [];
        while (!(($b = (($c = exp)['$empty?'] || $mm('empty?')).call($c)) !== false && $b !== nil)) {a = (($b = (($d = exp).$shift || $mm('shift')).call($d)).$to_sym || $mm('to_sym')).call($b);
        if ((($e = (($f = a).$to_s || $mm('to_s')).call($f))['$=='] || $mm('==')).call($e, "*")) {
          continue;
        };
        if (($g = (($h = (($i = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $i))['$include?'] || $mm('include?')).call($h, (($i = a).$to_s || $mm('to_s')).call($i))) !== false && $g !== nil) {
          a = (($g = ("" + (a) + "$")).$to_sym || $mm('to_sym')).call($g)
        };
        (($j = this.scope).$add_arg || $mm('add_arg')).call($j, a);
        (($k = args)['$<<'] || $mm('<<')).call($k, a);};
        return (($a = args).$join || $mm('join')).call($a, ", ");
      };

      def.$process_self = function(sexp, level) {
        var $a;
        return (($a = this).$current_self || $mm('current_self')).call($a);
      };

      def.$current_self = function() {
        var $a, $b, $c, $d, $e, $f;
        if (($a = (($b = this.scope)['$class_scope?'] || $mm('class_scope?')).call($b)) !== false && $a !== nil) {
          return (($a = this.scope).$name || $mm('name')).call($a)
          } else {
          if (($c = (($d = (($e = this.scope)['$top?'] || $mm('top?')).call($e)), $d !== false && $d !== nil ? $d : (($f = this.scope)['$iter?'] || $mm('iter?')).call($f))) !== false && $c !== nil) {
            return "self"
            } else {
            return "this"
          }
        };
      };

      ($a = (($b = ["true", "false", "nil"]).$each || $mm('each')), $a._p = (TMP_33 = function(name) {

        var self = TMP_33._s || this, TMP_34, $a, $b;
        if (name == null) name = nil;

        return ($a = (($b = self).$define_method || $mm('define_method')), $a._p = (TMP_34 = function(exp, level) {

          var self = TMP_34._s || this;
          if (exp == null) exp = nil;
if (level == null) level = nil;

          return name
        }, TMP_34._s = self, TMP_34), $a).call($b, "process_" + (name))
      }, TMP_33._s = Parser, TMP_33), $a).call($b);

      def.$process_array = function(sexp, level) {
        var code = nil, work = nil, splat = nil, part = nil, join = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t;
        if (($a = (($b = sexp)['$empty?'] || $mm('empty?')).call($b)) !== false && $a !== nil) {
          return "[]"
        };
        code = "";
        work = [];
        while (!(($c = (($d = sexp)['$empty?'] || $mm('empty?')).call($d)) !== false && $c !== nil)) {splat = (($c = (($e = (($f = sexp).$first || $mm('first')).call($f)).$first || $mm('first')).call($e))['$=='] || $mm('==')).call($c, "splat");
        part = (($g = this).$process || $mm('process')).call($g, (($h = sexp).$shift || $mm('shift')).call($h), "expr");
        if (splat !== false && splat !== nil) {
          if (($i = (($j = work)['$empty?'] || $mm('empty?')).call($j)) !== false && $i !== nil) {
            code = (($i = code)['$+'] || $mm('+')).call($i, (function() { if (($k = (($l = code)['$empty?'] || $mm('empty?')).call($l)) !== false && $k !== nil) {
              return part
              } else {
              return ".concat(" + (part) + ")"
            }; return nil; }).call(this))
            } else {
            join = "[" + ((($k = work).$join || $mm('join')).call($k, ", ")) + "]";
            code = (($m = code)['$+'] || $mm('+')).call($m, (function() { if (($n = (($o = code)['$empty?'] || $mm('empty?')).call($o)) !== false && $n !== nil) {
              return join
              } else {
              return ".concat(" + (join) + ")"
            }; return nil; }).call(this));
            code = (($n = code)['$+'] || $mm('+')).call($n, ".concat(" + (part) + ")");
          };
          work = [];
          } else {
          (($p = work)['$<<'] || $mm('<<')).call($p, part)
        };};
        if (($a = (($q = work)['$empty?'] || $mm('empty?')).call($q)) === false || $a === nil) {
          join = "[" + ((($a = work).$join || $mm('join')).call($a, ", ")) + "]";
          code = (($r = code)['$+'] || $mm('+')).call($r, (function() { if (($s = (($t = code)['$empty?'] || $mm('empty?')).call($t)) !== false && $s !== nil) {
            return join
            } else {
            return ".concat(" + (join) + ")"
          }; return nil; }).call(this));
        };
        return code;
      };

      def.$process_hash = function(sexp, level) {
        var keys = nil, vals = nil, hash_obj = nil, hash_keys = nil, map = nil, TMP_35, $a, $b, TMP_36, $c, $d, TMP_37, $e, TMP_38, $f, $g, $h, $i, $j, TMP_39, $k, $l;
        keys = [];
        vals = [];
        ($a = (($b = sexp).$each_with_index || $mm('each_with_index')), $a._p = (TMP_35 = function(obj, idx) {

          var self = TMP_35._s || this, $a, $b, $c;
          if (obj == null) obj = nil;
if (idx == null) idx = nil;

          if (($a = (($b = idx)['$even?'] || $mm('even?')).call($b)) !== false && $a !== nil) {
            return (($a = keys)['$<<'] || $mm('<<')).call($a, obj)
            } else {
            return (($c = vals)['$<<'] || $mm('<<')).call($c, obj)
          }
        }, TMP_35._s = this, TMP_35), $a).call($b);
        if (($a = ($c = (($d = keys)['$all?'] || $mm('all?')), $c._p = (TMP_36 = function(k) {

          var self = TMP_36._s || this, $a, $b;
          if (k == null) k = nil;

          return (($a = ["lit", "str"])['$include?'] || $mm('include?')).call($a, (($b = k)['$[]'] || $mm('[]')).call($b, 0))
        }, TMP_36._s = this, TMP_36), $c).call($d)) !== false && $a !== nil) {
          hash_obj = __hash2([], {});
          hash_keys = [];
          ($a = (($c = (($e = keys).$size || $mm('size')).call($e)).$times || $mm('times')), $a._p = (TMP_37 = function(i) {

            var k = nil, self = TMP_37._s || this, $a, $b, $c, $d, $e, $f, $g;
            if (i == null) i = nil;

            k = (($a = self).$process || $mm('process')).call($a, (($b = keys)['$[]'] || $mm('[]')).call($b, i), "expr");
            if (($c = (($d = hash_obj)['$include?'] || $mm('include?')).call($d, k)) === false || $c === nil) {
              (($c = hash_keys)['$<<'] || $mm('<<')).call($c, k)
            };
            return (($e = hash_obj)['$[]='] || $mm('[]=')).call($e, k, (($f = self).$process || $mm('process')).call($f, (($g = vals)['$[]'] || $mm('[]')).call($g, i), "expr"));
          }, TMP_37._s = this, TMP_37), $a).call($c);
          map = ($a = (($f = hash_keys).$map || $mm('map')), $a._p = (TMP_38 = function(k) {

            var self = TMP_38._s || this, $a;
            if (k == null) k = nil;

            return "" + (k) + ": " + ((($a = hash_obj)['$[]'] || $mm('[]')).call($a, k))
          }, TMP_38._s = this, TMP_38), $a).call($f);
          (($a = this.helpers)['$[]='] || $mm('[]=')).call($a, "hash2", true);
          return "__hash2([" + ((($g = hash_keys).$join || $mm('join')).call($g, ", ")) + "], {" + ((($h = map).$join || $mm('join')).call($h, ", ")) + "})";
          } else {
          (($i = this.helpers)['$[]='] || $mm('[]=')).call($i, "hash", true);
          return "__hash(" + ((($j = ($k = (($l = sexp).$map || $mm('map')), $k._p = (TMP_39 = function(p) {

            var self = TMP_39._s || this, $a;
            if (p == null) p = nil;

            return (($a = self).$process || $mm('process')).call($a, p, "expr")
          }, TMP_39._s = this, TMP_39), $k).call($l)).$join || $mm('join')).call($j, ", ")) + ")";
        };
      };

      def.$process_while = function(sexp, level) {
        var expr = nil, stmt = nil, redo_var = nil, stmt_level = nil, pre = nil, code = nil, $a, $b, $c, $d, $e, TMP_40, $f, $g, $h, $i;
        (($a = sexp)._isArray ? $a : ($a = [$a])), expr = ($a[0] == null ? nil : $a[0]), stmt = ($a[1] == null ? nil : $a[1]);
        redo_var = (($a = this.scope).$new_temp || $mm('new_temp')).call($a);
        stmt_level = (function() { if (($b = (($c = (($d = level)['$=='] || $mm('==')).call($d, "expr")), $c !== false && $c !== nil ? $c : (($e = level)['$=='] || $mm('==')).call($e, "recv"))) !== false && $b !== nil) {
          return "stmt_closure"
          } else {
          return "stmt"
        }; return nil; }).call(this);
        pre = "while (";
        code = "" + ((($b = this).$js_truthy || $mm('js_truthy')).call($b, expr)) + "){";
        ($c = (($f = this).$in_while || $mm('in_while')), $c._p = (TMP_40 = function() {

          var body = nil, self = TMP_40._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i;
          if (self.while_loop == null) self.while_loop = nil;

          
          if ((($a = stmt_level)['$=='] || $mm('==')).call($a, "stmt_closure")) {
            (($b = self.while_loop)['$[]='] || $mm('[]=')).call($b, "closure", true)
          };
          (($c = self.while_loop)['$[]='] || $mm('[]=')).call($c, "redo_var", redo_var);
          body = (($d = self).$process || $mm('process')).call($d, stmt, "stmt");
          if (($e = (($f = self.while_loop)['$[]'] || $mm('[]')).call($f, "use_redo")) !== false && $e !== nil) {
            pre = ($e = ($h = "" + (redo_var) + "=false;", $i = pre, typeof($h) === 'number' ? $h + $i : $h['$+']($i)), $g = "" + (redo_var) + " || ", typeof($e) === 'number' ? $e + $g : $e['$+']($g));
            code = (($e = code)['$+'] || $mm('+')).call($e, "" + (redo_var) + "=false;");
          };
          return code = (($g = code)['$+'] || $mm('+')).call($g, body);
        }, TMP_40._s = this, TMP_40), $c).call($f);
        code = (($c = code)['$+'] || $mm('+')).call($c, "}");
        code = ($g = pre, $h = code, typeof($g) === 'number' ? $g + $h : $g['$+']($h));
        (($g = this.scope).$queue_temp || $mm('queue_temp')).call($g, redo_var);
        if ((($h = stmt_level)['$=='] || $mm('==')).call($h, "stmt_closure")) {
          code = "(function() {" + (code) + "; return nil;}).call(" + ((($i = this).$current_self || $mm('current_self')).call($i)) + ")"
        };
        return code;
      };

      def.$process_until = function(exp, level) {
        var expr = nil, stmt = nil, redo_var = nil, stmt_level = nil, pre = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, TMP_41, $h, $i, $j, $k;
        expr = (($a = exp)['$[]'] || $mm('[]')).call($a, 0);
        stmt = (($b = exp)['$[]'] || $mm('[]')).call($b, 1);
        redo_var = (($c = this.scope).$new_temp || $mm('new_temp')).call($c);
        stmt_level = (function() { if (($d = (($e = (($f = level)['$=='] || $mm('==')).call($f, "expr")), $e !== false && $e !== nil ? $e : (($g = level)['$=='] || $mm('==')).call($g, "recv"))) !== false && $d !== nil) {
          return "stmt_closure"
          } else {
          return "stmt"
        }; return nil; }).call(this);
        pre = "while (!(";
        code = "" + ((($d = this).$js_truthy || $mm('js_truthy')).call($d, expr)) + ")) {";
        ($e = (($h = this).$in_while || $mm('in_while')), $e._p = (TMP_41 = function() {

          var body = nil, self = TMP_41._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i;
          if (self.while_loop == null) self.while_loop = nil;

          
          if ((($a = stmt_level)['$=='] || $mm('==')).call($a, "stmt_closure")) {
            (($b = self.while_loop)['$[]='] || $mm('[]=')).call($b, "closure", true)
          };
          (($c = self.while_loop)['$[]='] || $mm('[]=')).call($c, "redo_var", redo_var);
          body = (($d = self).$process || $mm('process')).call($d, stmt, "stmt");
          if (($e = (($f = self.while_loop)['$[]'] || $mm('[]')).call($f, "use_redo")) !== false && $e !== nil) {
            pre = ($e = ($h = "" + (redo_var) + "=false;", $i = pre, typeof($h) === 'number' ? $h + $i : $h['$+']($i)), $g = "" + (redo_var) + " || ", typeof($e) === 'number' ? $e + $g : $e['$+']($g));
            code = (($e = code)['$+'] || $mm('+')).call($e, "" + (redo_var) + "=false;");
          };
          return code = (($g = code)['$+'] || $mm('+')).call($g, body);
        }, TMP_41._s = this, TMP_41), $e).call($h);
        code = (($e = code)['$+'] || $mm('+')).call($e, "}");
        code = ($i = pre, $j = code, typeof($i) === 'number' ? $i + $j : $i['$+']($j));
        (($i = this.scope).$queue_temp || $mm('queue_temp')).call($i, redo_var);
        if ((($j = stmt_level)['$=='] || $mm('==')).call($j, "stmt_closure")) {
          code = "(function() {" + (code) + "; return nil;}).call(" + ((($k = this).$current_self || $mm('current_self')).call($k)) + ")"
        };
        return code;
      };

      def.$process_alias = function(exp, level) {
        var new$ = nil, old = nil, current = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t;
        new$ = (($a = this).$mid_to_jsid || $mm('mid_to_jsid')).call($a, (($b = (($c = (($d = exp)['$[]'] || $mm('[]')).call($d, 0))['$[]'] || $mm('[]')).call($c, 1)).$to_s || $mm('to_s')).call($b));
        old = (($e = this).$mid_to_jsid || $mm('mid_to_jsid')).call($e, (($f = (($g = (($h = exp)['$[]'] || $mm('[]')).call($h, 1))['$[]'] || $mm('[]')).call($g, 1)).$to_s || $mm('to_s')).call($f));
        if (($i = (($j = ["class", "module"])['$include?'] || $mm('include?')).call($j, (($k = this.scope).$type || $mm('type')).call($k))) !== false && $i !== nil) {
          (($i = (($l = this.scope).$methods || $mm('methods')).call($l))['$<<'] || $mm('<<')).call($i, "$" + ((($m = (($n = (($o = exp)['$[]'] || $mm('[]')).call($o, 0))['$[]'] || $mm('[]')).call($n, 1)).$to_s || $mm('to_s')).call($m)));
          return (($p = "%s%s = %s%s")['$%'] || $mm('%')).call($p, [(($q = this.scope).$proto || $mm('proto')).call($q), new$, (($r = this.scope).$proto || $mm('proto')).call($r), old]);
          } else {
          current = (($s = this).$current_self || $mm('current_self')).call($s);
          return (($t = "%s.prototype%s = %s.prototype%s")['$%'] || $mm('%')).call($t, [current, new$, current, old]);
        };
      };

      def.$process_masgn = function(sexp, level) {
        var lhs = nil, rhs = nil, tmp = nil, len = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, TMP_42, $r, $s, $t;
        lhs = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        tmp = (($c = this.scope).$new_temp || $mm('new_temp')).call($c);
        len = 0;
        (($d = lhs).$shift || $mm('shift')).call($d);
        if ((($e = (($f = rhs)['$[]'] || $mm('[]')).call($f, 0))['$=='] || $mm('==')).call($e, "array")) {
          len = ($g = (($i = rhs).$length || $mm('length')).call($i), $h = 1, typeof($g) === 'number' ? $g - $h : $g['$-']($h));
          code = ["" + (tmp) + " = " + ((($g = this).$process || $mm('process')).call($g, rhs, "expr"))];
          } else {
          if ((($h = (($j = rhs)['$[]'] || $mm('[]')).call($j, 0))['$=='] || $mm('==')).call($h, "to_ary")) {
            code = ["((" + (tmp) + " = " + ((($k = this).$process || $mm('process')).call($k, (($l = rhs)['$[]'] || $mm('[]')).call($l, 1), "expr")) + ")._isArray ? " + (tmp) + " : (" + (tmp) + " = [" + (tmp) + "]))"]
            } else {
            if ((($m = (($n = rhs)['$[]'] || $mm('[]')).call($n, 0))['$=='] || $mm('==')).call($m, "splat")) {
              code = ["(" + (tmp) + " = " + ((($o = this).$process || $mm('process')).call($o, (($p = rhs)['$[]'] || $mm('[]')).call($p, 1), "expr")) + ")['$to_a'] ? (" + (tmp) + " = " + (tmp) + "['$to_a']()) : (" + (tmp) + ")._isArray ? " + (tmp) + " : (" + (tmp) + " = [" + (tmp) + "])"]
              } else {
              (($q = this).$raise || $mm('raise')).call($q, "Unsupported mlhs type")
            }
          }
        };
        ($r = (($s = lhs).$each_with_index || $mm('each_with_index')), $r._p = (TMP_42 = function(l, idx) {

          var s = nil, self = TMP_42._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n;
          if (l == null) l = nil;
if (idx == null) idx = nil;

          if ((($a = (($b = l).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "splat")) {
            s = (($c = l)['$[]'] || $mm('[]')).call($c, 1);
            (($d = s)['$<<'] || $mm('<<')).call($d, (($e = self).$s || $mm('s')).call($e, "js_tmp", "__slice.call(" + (tmp) + ", " + (idx) + ")"));
            return (($f = code)['$<<'] || $mm('<<')).call($f, (($g = self).$process || $mm('process')).call($g, s, "expr"));
            } else {
            if ((($h = idx)['$>='] || $mm('>=')).call($h, len)) {
              (($i = l)['$<<'] || $mm('<<')).call($i, (($j = self).$s || $mm('s')).call($j, "js_tmp", "(" + (tmp) + "[" + (idx) + "] == null ? nil : " + (tmp) + "[" + (idx) + "])"))
              } else {
              (($k = l)['$<<'] || $mm('<<')).call($k, (($l = self).$s || $mm('s')).call($l, "js_tmp", "" + (tmp) + "[" + (idx) + "]"))
            };
            return (($m = code)['$<<'] || $mm('<<')).call($m, (($n = self).$process || $mm('process')).call($n, l, "expr"));
          }
        }, TMP_42._s = this, TMP_42), $r).call($s);
        (($r = this.scope).$queue_temp || $mm('queue_temp')).call($r, tmp);
        return (($t = code).$join || $mm('join')).call($t, ", ");
      };

      def.$process_svalue = function(sexp, level) {
        var $a, $b;
        return (($a = this).$process || $mm('process')).call($a, (($b = sexp).$shift || $mm('shift')).call($b), level);
      };

      def.$process_lasgn = function(sexp, level) {
        var lvar = nil, rhs = nil, res = nil, $a, $b, $c, $d, $e, $f, $g, $h;
        lvar = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        if (($c = (($d = (($e = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $e))['$include?'] || $mm('include?')).call($d, (($e = lvar).$to_s || $mm('to_s')).call($e))) !== false && $c !== nil) {
          lvar = (($c = ("" + (lvar) + "$")).$to_sym || $mm('to_sym')).call($c)
        };
        (($f = this.scope).$add_local || $mm('add_local')).call($f, lvar);
        res = "" + (lvar) + " = " + ((($g = this).$process || $mm('process')).call($g, rhs, "expr"));
        if ((($h = level)['$=='] || $mm('==')).call($h, "recv")) {
          return "(" + (res) + ")"
          } else {
          return res
        };
      };

      def.$process_lvar = function(exp, level) {
        var lvar = nil, $a, $b, $c, $d, $e;
        lvar = (($a = (($b = exp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
        if (($c = (($d = (($e = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $e))['$include?'] || $mm('include?')).call($d, lvar)) !== false && $c !== nil) {
          lvar = "" + (lvar) + "$"
        };
        return lvar;
      };

      def.$process_iasgn = function(exp, level) {
        var ivar = nil, rhs = nil, lhs = nil, $a, $b, $c, $d, $e, $f, $g, $h;
        ivar = (($a = exp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = exp)['$[]'] || $mm('[]')).call($b, 1);
        ivar = (($c = (($d = ivar).$to_s || $mm('to_s')).call($d))['$[]'] || $mm('[]')).call($c, __range(1, -1, false));
        lhs = (function() { if (($e = (($f = (($g = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $g))['$include?'] || $mm('include?')).call($f, ivar)) !== false && $e !== nil) {
          return "" + ((($e = this).$current_self || $mm('current_self')).call($e)) + "['" + (ivar) + "']"
          } else {
          return "" + ((($g = this).$current_self || $mm('current_self')).call($g)) + "." + (ivar)
        }; return nil; }).call(this);
        return "" + (lhs) + " = " + ((($h = this).$process || $mm('process')).call($h, rhs, "expr"));
      };

      def.$process_ivar = function(exp, level) {
        var ivar = nil, part = nil, $a, $b, $c, $d, $e, $f;
        ivar = (($a = (($b = (($c = exp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        part = (function() { if (($d = (($e = (($f = __scope.RESERVED) == null ? __opal.cm("RESERVED") : $f))['$include?'] || $mm('include?')).call($e, ivar)) !== false && $d !== nil) {
          return "['" + (ivar) + "']"
          } else {
          return "." + (ivar)
        }; return nil; }).call(this);
        (($d = this.scope).$add_ivar || $mm('add_ivar')).call($d, part);
        return "" + ((($f = this).$current_self || $mm('current_self')).call($f)) + (part);
      };

      def.$process_gvar = function(sexp, level) {
        var gvar = nil, $a, $b, $c, $d, $e;
        gvar = (($a = (($b = (($c = sexp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        (($d = this.helpers)['$[]='] || $mm('[]=')).call($d, "gvars", true);
        return "__gvars[" + ((($e = gvar).$inspect || $mm('inspect')).call($e)) + "]";
      };

      def.$process_nth_ref = function(sexp, level) {
        
        return "nil";
      };

      def.$process_gasgn = function(sexp, level) {
        var gvar = nil, rhs = nil, $a, $b, $c, $d, $e, $f, $g, $h;
        gvar = (($a = (($b = (($c = sexp)['$[]'] || $mm('[]')).call($c, 0)).$to_s || $mm('to_s')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        rhs = (($d = sexp)['$[]'] || $mm('[]')).call($d, 1);
        (($e = this.helpers)['$[]='] || $mm('[]=')).call($e, "gvars", true);
        return "__gvars[" + ((($f = (($g = gvar).$to_s || $mm('to_s')).call($g)).$inspect || $mm('inspect')).call($f)) + "] = " + ((($h = this).$process || $mm('process')).call($h, rhs, "expr"));
      };

      def.$process_const = function(sexp, level) {
        var cname = nil, $a, $b, $c, TMP_43, $d;
        cname = (($a = (($b = sexp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
        if (($c = this.const_missing) !== false && $c !== nil) {
          return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_43 = function(t) {

            var self = TMP_43._s || this, $a;
            if (t == null) t = nil;

            return "((" + (t) + " = __scope." + (cname) + ") == null ? __opal.cm(" + ((($a = cname).$inspect || $mm('inspect')).call($a)) + ") : " + (t) + ")"
          }, TMP_43._s = this, TMP_43), $c).call($d)
          } else {
          return "__scope." + (cname)
        };
      };

      def.$process_cdecl = function(sexp, level) {
        var const$ = nil, rhs = nil, $a;
        (($a = sexp)._isArray ? $a : ($a = [$a])), const$ = ($a[0] == null ? nil : $a[0]), rhs = ($a[1] == null ? nil : $a[1]);
        return "__scope." + (const$) + " = " + ((($a = this).$process || $mm('process')).call($a, rhs, "expr"));
      };

      def.$process_return = function(sexp, level) {
        var val = nil, $a, $b, $c, $d, $e, $f;
        val = (($a = this).$process || $mm('process')).call($a, (($b = (($c = sexp).$shift || $mm('shift')).call($c)), $b !== false && $b !== nil ? $b : (($d = this).$s || $mm('s')).call($d, "nil")), "expr");
        if (($b = (($e = level)['$=='] || $mm('==')).call($e, "stmt")) === false || $b === nil) {
          (($b = this).$raise || $mm('raise')).call($b, (($f = __scope.SyntaxError) == null ? __opal.cm("SyntaxError") : $f), "void value expression: cannot return as an expression")
        };
        return "return " + (val);
      };

      def.$process_xstr = function(sexp, level) {
        var code = nil, $a, $b, $c, $d, $e, $f, $g;
        code = (($a = (($b = sexp).$first || $mm('first')).call($b)).$to_s || $mm('to_s')).call($a);
        if (($c = (($d = (($e = level)['$=='] || $mm('==')).call($e, "stmt")) ? ($f = (($g = code)['$include?'] || $mm('include?')).call($g, ";"), ($f === nil || $f === false)) : $d)) !== false && $c !== nil) {
          code = (($c = code)['$+'] || $mm('+')).call($c, ";")
        };
        if ((($d = level)['$=='] || $mm('==')).call($d, "recv")) {
          return "(" + (code) + ")"
          } else {
          return code
        };
      };

      def.$process_dxstr = function(sexp, level) {
        var code = nil, $a, TMP_44, $b, $c, $d, $e, $f, $g;
        code = (($a = ($b = (($c = sexp).$map || $mm('map')), $b._p = (TMP_44 = function(p) {

          var self = TMP_44._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
          if (p == null) p = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, p)) !== false && $a !== nil) {
            return (($a = p).$to_s || $mm('to_s')).call($a)
            } else {
            if ((($c = (($d = p).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "evstr")) {
              return (($e = self).$process || $mm('process')).call($e, (($f = p).$last || $mm('last')).call($f), "stmt")
              } else {
              if ((($g = (($h = p).$first || $mm('first')).call($h))['$=='] || $mm('==')).call($g, "str")) {
                return (($i = (($j = p).$last || $mm('last')).call($j)).$to_s || $mm('to_s')).call($i)
                } else {
                return (($k = self).$raise || $mm('raise')).call($k, "Bad dxstr part")
              }
            }
          }
        }, TMP_44._s = this, TMP_44), $b).call($c)).$join || $mm('join')).call($a);
        if (($b = (($d = (($e = level)['$=='] || $mm('==')).call($e, "stmt")) ? ($f = (($g = code)['$include?'] || $mm('include?')).call($g, ";"), ($f === nil || $f === false)) : $d)) !== false && $b !== nil) {
          code = (($b = code)['$+'] || $mm('+')).call($b, ";")
        };
        if ((($d = level)['$=='] || $mm('==')).call($d, "recv")) {
          code = "(" + (code) + ")"
        };
        return code;
      };

      def.$process_dstr = function(sexp, level) {
        var parts = nil, res = nil, TMP_45, $a, $b, $c;
        parts = ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_45 = function(p) {

          var self = TMP_45._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
          if (p == null) p = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, p)) !== false && $a !== nil) {
            return (($a = p).$inspect || $mm('inspect')).call($a)
            } else {
            if ((($c = (($d = p).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "evstr")) {
              return ($e = ($g = "(", $h = (($i = self).$process || $mm('process')).call($i, (($j = p).$last || $mm('last')).call($j), "expr"), typeof($g) === 'number' ? $g + $h : $g['$+']($h)), $f = ")", typeof($e) === 'number' ? $e + $f : $e['$+']($f))
              } else {
              if ((($e = (($f = p).$first || $mm('first')).call($f))['$=='] || $mm('==')).call($e, "str")) {
                return (($g = (($h = p).$last || $mm('last')).call($h)).$inspect || $mm('inspect')).call($g)
                } else {
                return (($k = self).$raise || $mm('raise')).call($k, "Bad dstr part")
              }
            }
          }
        }, TMP_45._s = this, TMP_45), $a).call($b);
        res = (($a = parts).$join || $mm('join')).call($a, " + ");
        if ((($c = level)['$=='] || $mm('==')).call($c, "recv")) {
          return "(" + (res) + ")"
          } else {
          return res
        };
      };

      def.$process_dsym = function(sexp, level) {
        var parts = nil, TMP_46, $a, $b;
        parts = ($a = (($b = sexp).$map || $mm('map')), $a._p = (TMP_46 = function(p) {

          var self = TMP_46._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
          if (p == null) p = nil;

          if (($a = (($b = (($c = __scope.String) == null ? __opal.cm("String") : $c))['$==='] || $mm('===')).call($b, p)) !== false && $a !== nil) {
            return (($a = p).$inspect || $mm('inspect')).call($a)
            } else {
            if ((($c = (($d = p).$first || $mm('first')).call($d))['$=='] || $mm('==')).call($c, "evstr")) {
              return (($e = self).$process || $mm('process')).call($e, (($f = self).$s || $mm('s')).call($f, "call", (($g = p).$last || $mm('last')).call($g), "to_s", (($h = self).$s || $mm('s')).call($h, "arglist")), "expr")
              } else {
              if ((($i = (($j = p).$first || $mm('first')).call($j))['$=='] || $mm('==')).call($i, "str")) {
                return (($k = (($l = p).$last || $mm('last')).call($l)).$inspect || $mm('inspect')).call($k)
                } else {
                return (($m = self).$raise || $mm('raise')).call($m, "Bad dsym part")
              }
            }
          }
        }, TMP_46._s = this, TMP_46), $a).call($b);
        return "(" + ((($a = parts).$join || $mm('join')).call($a, "+")) + ")";
      };

      def.$process_if = function(sexp, level) {
        var test = nil, truthy = nil, falsy = nil, returnable = nil, check = nil, code = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, TMP_47, $j, TMP_48, $k, $l;
        (($a = sexp)._isArray ? $a : ($a = [$a])), test = ($a[0] == null ? nil : $a[0]), truthy = ($a[1] == null ? nil : $a[1]), falsy = ($a[2] == null ? nil : $a[2]);
        returnable = (($a = (($b = level)['$=='] || $mm('==')).call($b, "expr")), $a !== false && $a !== nil ? $a : (($c = level)['$=='] || $mm('==')).call($c, "recv"));
        if (returnable !== false && returnable !== nil) {
          truthy = (($a = this).$returns || $mm('returns')).call($a, (($d = truthy), $d !== false && $d !== nil ? $d : (($e = this).$s || $mm('s')).call($e, "nil")));
          falsy = (($d = this).$returns || $mm('returns')).call($d, (($f = falsy), $f !== false && $f !== nil ? $f : (($g = this).$s || $mm('s')).call($g, "nil")));
        };
        if (($f = (($h = falsy !== false && falsy !== nil) ? ($i = truthy, ($i === nil || $i === false)) : $h)) !== false && $f !== nil) {
          truthy = falsy;
          falsy = nil;
          check = (($f = this).$js_falsy || $mm('js_falsy')).call($f, test);
          } else {
          check = (($h = this).$js_truthy || $mm('js_truthy')).call($h, test)
        };
        code = "if (" + (check) + ") {\n";
        if (truthy !== false && truthy !== nil) {
          ($i = (($j = this).$indent || $mm('indent')), $i._p = (TMP_47 = function() {

            var self = TMP_47._s || this, $a, $b, $c, $d;
            if (self.indent == null) self.indent = nil;

            
            return code = (($a = code)['$+'] || $mm('+')).call($a, ($b = self.indent, $c = (($d = self).$process || $mm('process')).call($d, truthy, "stmt"), typeof($b) === 'number' ? $b + $c : $b['$+']($c)))
          }, TMP_47._s = this, TMP_47), $i).call($j)
        };
        if (falsy !== false && falsy !== nil) {
          ($i = (($k = this).$indent || $mm('indent')), $i._p = (TMP_48 = function() {

            var self = TMP_48._s || this, $a, $b;
            if (self.indent == null) self.indent = nil;

            
            return code = (($a = code)['$+'] || $mm('+')).call($a, "\n" + (self.indent) + "} else {\n" + (self.indent) + ((($b = self).$process || $mm('process')).call($b, falsy, "stmt")))
          }, TMP_48._s = this, TMP_48), $i).call($k)
        };
        code = (($i = code)['$+'] || $mm('+')).call($i, "\n" + (this.indent) + "}");
        if (returnable !== false && returnable !== nil) {
          code = "(function() { " + (code) + "; return nil; }).call(" + ((($l = this).$current_self || $mm('current_self')).call($l)) + ")"
        };
        return code;
      };

      def.$js_truthy_optimize = function(sexp) {
        var mid = nil, name = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
        if ((($a = (($b = sexp).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "call")) {
          mid = (($c = sexp)['$[]'] || $mm('[]')).call($c, 2);
          if ((($d = mid)['$=='] || $mm('==')).call($d, "block_given?")) {
            return (($e = this).$process || $mm('process')).call($e, sexp, "expr")
            } else {
            if (($f = (($g = (($h = __scope.COMPARE) == null ? __opal.cm("COMPARE") : $h))['$include?'] || $mm('include?')).call($g, (($h = mid).$to_s || $mm('to_s')).call($h))) !== false && $f !== nil) {
              return (($f = this).$process || $mm('process')).call($f, sexp, "expr")
              } else {
              if ((($i = mid)['$=='] || $mm('==')).call($i, "==")) {
                return (($j = this).$process || $mm('process')).call($j, sexp, "expr")
                } else {
                return nil
              }
            }
          };
          } else {
          if (($k = (($l = ["lvar", "self"])['$include?'] || $mm('include?')).call($l, (($m = sexp).$first || $mm('first')).call($m))) !== false && $k !== nil) {
            name = (($k = this).$process || $mm('process')).call($k, sexp, "expr");
            return "" + (name) + " !== false && " + (name) + " !== nil";
            } else {
            return nil
          }
        };
      };

      def.$js_truthy = function(sexp) {
        var optimized = nil, $a, $b, TMP_49, $c;
        if (($a = optimized = (($b = this).$js_truthy_optimize || $mm('js_truthy_optimize')).call($b, sexp)) !== false && $a !== nil) {
          return optimized
        };
        return ($a = (($c = this).$with_temp || $mm('with_temp')), $a._p = (TMP_49 = function(tmp) {

          var self = TMP_49._s || this, $a, $b;
          if (tmp == null) tmp = nil;

          return (($a = "(%s = %s) !== false && %s !== nil")['$%'] || $mm('%')).call($a, [tmp, (($b = self).$process || $mm('process')).call($b, sexp, "expr"), tmp])
        }, TMP_49._s = this, TMP_49), $a).call($c);
      };

      def.$js_falsy = function(sexp) {
        var mid = nil, $a, $b, $c, $d, $e, TMP_50, $f, $g;
        if ((($a = (($b = sexp).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "call")) {
          mid = (($c = sexp)['$[]'] || $mm('[]')).call($c, 2);
          if ((($d = mid)['$=='] || $mm('==')).call($d, "block_given?")) {
            return (($e = this).$handle_block_given || $mm('handle_block_given')).call($e, sexp, true)
          };
        };
        return ($f = (($g = this).$with_temp || $mm('with_temp')), $f._p = (TMP_50 = function(tmp) {

          var self = TMP_50._s || this, $a, $b;
          if (tmp == null) tmp = nil;

          return (($a = "(%s = %s) === false || %s === nil")['$%'] || $mm('%')).call($a, [tmp, (($b = self).$process || $mm('process')).call($b, sexp, "expr"), tmp])
        }, TMP_50._s = this, TMP_50), $f).call($g);
      };

      def.$process_and = function(sexp, level) {
        var lhs = nil, rhs = nil, t = nil, tmp = nil, $a, $b, $c, TMP_51, $d, $e, $f, $g, $h;
        (($a = sexp)._isArray ? $a : ($a = [$a])), lhs = ($a[0] == null ? nil : $a[0]), rhs = ($a[1] == null ? nil : $a[1]);
        t = nil;
        tmp = (($a = this.scope).$new_temp || $mm('new_temp')).call($a);
        if (($b = t = (($c = this).$js_truthy_optimize || $mm('js_truthy_optimize')).call($c, lhs)) !== false && $b !== nil) {
          return ($b = (($d = ("((" + (tmp) + " = " + (t) + ") ? " + ((($e = this).$process || $mm('process')).call($e, rhs, "expr")) + " : " + (tmp) + ")")).$tap || $mm('tap')), $b._p = (TMP_51 = function() {

            var self = TMP_51._s || this, $a;
            if (self.scope == null) self.scope = nil;

            
            return (($a = self.scope).$queue_temp || $mm('queue_temp')).call($a, tmp)
          }, TMP_51._s = this, TMP_51), $b).call($d)
        };
        (($b = this.scope).$queue_temp || $mm('queue_temp')).call($b, tmp);
        return (($f = "(%s = %s, %s !== false && %s !== nil ? %s : %s)")['$%'] || $mm('%')).call($f, [tmp, (($g = this).$process || $mm('process')).call($g, lhs, "expr"), tmp, tmp, (($h = this).$process || $mm('process')).call($h, rhs, "expr"), tmp]);
      };

      def.$process_or = function(sexp, level) {
        var lhs = nil, rhs = nil, t = nil, $a, $b, TMP_52, $c, $d;
        lhs = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        t = nil;
        return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_52 = function(tmp) {

          var self = TMP_52._s || this, $a, $b, $c;
          if (tmp == null) tmp = nil;

          return (($a = "((%s = %s), %s !== false && %s !== nil ? %s : %s)")['$%'] || $mm('%')).call($a, [tmp, (($b = self).$process || $mm('process')).call($b, lhs, "expr"), tmp, tmp, tmp, (($c = self).$process || $mm('process')).call($c, rhs, "expr")])
        }, TMP_52._s = this, TMP_52), $c).call($d);
      };

      def.$process_yield = function(sexp, level) {
        var call = nil, $a, $b, TMP_53, $c, $d;
        call = (($a = this).$handle_yield_call || $mm('handle_yield_call')).call($a, sexp, level);
        if ((($b = level)['$=='] || $mm('==')).call($b, "stmt")) {
          return "if (" + (call) + " === __breaker) return __breaker.$v"
          } else {
          return ($c = (($d = this).$with_temp || $mm('with_temp')), $c._p = (TMP_53 = function(tmp) {

            var self = TMP_53._s || this;
            if (tmp == null) tmp = nil;

            return "(((" + (tmp) + " = " + (call) + ") === __breaker) ? __breaker.$v : " + (tmp) + ")"
          }, TMP_53._s = this, TMP_53), $c).call($d)
        };
      };

      def.$process_yasgn = function(sexp, level) {
        var call = nil, $a, $b, $c, $d, $e, $f;
        call = (($a = this).$handle_yield_call || $mm('handle_yield_call')).call($a, (($b = this).$s || $mm('s')).apply($b, [].concat((($c = (($d = sexp)['$[]'] || $mm('[]')).call($d, 1))['$[]'] || $mm('[]')).call($c, __range(1, -1, false)))), "stmt");
        return (($e = "if ((%s = %s) === __breaker) return __breaker.$v")['$%'] || $mm('%')).call($e, [(($f = sexp)['$[]'] || $mm('[]')).call($f, 0), call]);
      };

      def.$process_returnable_yield = function(sexp, level) {
        var call = nil, $a, TMP_54, $b, $c;
        call = (($a = this).$handle_yield_call || $mm('handle_yield_call')).call($a, sexp, level);
        return ($b = (($c = this).$with_temp || $mm('with_temp')), $b._p = (TMP_54 = function(tmp) {

          var self = TMP_54._s || this, $a;
          if (tmp == null) tmp = nil;

          return (($a = "return %s = %s, %s === __breaker ? %s : %s")['$%'] || $mm('%')).call($a, [tmp, call, tmp, tmp, tmp])
        }, TMP_54._s = this, TMP_54), $b).call($c);
      };

      def.$handle_yield_call = function(sexp, level) {
        var splat = nil, args = nil, y = nil, $a, TMP_55, $b, $c, $d, $e, $f, $g;
        (($a = this.scope)['$uses_block!'] || $mm('uses_block!')).call($a);
        splat = ($b = (($c = sexp)['$any?'] || $mm('any?')), $b._p = (TMP_55 = function(s) {

          var self = TMP_55._s || this, $a, $b;
          if (s == null) s = nil;

          return (($a = (($b = s).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "splat")
        }, TMP_55._s = this, TMP_55), $b).call($c);
        if (($b = splat) === false || $b === nil) {
          (($b = sexp).$unshift || $mm('unshift')).call($b, (($d = this).$s || $mm('s')).call($d, "js_tmp", "null"))
        };
        args = (($e = this).$process_arglist || $mm('process_arglist')).call($e, sexp, level);
        y = (($f = (($g = this.scope).$block_name || $mm('block_name')).call($g)), $f !== false && $f !== nil ? $f : "__yield");
        if (splat !== false && splat !== nil) {
          return "" + (y) + ".apply(null, " + (args) + ")"
          } else {
          return "" + (y) + ".call(" + (args) + ")"
        };
      };

      def.$process_break = function(exp, level) {
        var val = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i;
        val = (function() { if (($a = (($b = exp)['$empty?'] || $mm('empty?')).call($b)) !== false && $a !== nil) {
          return "nil"
          } else {
          return (($a = this).$process || $mm('process')).call($a, (($c = exp).$shift || $mm('shift')).call($c), "expr")
        }; return nil; }).call(this);
        if (($d = (($e = this)['$in_while?'] || $mm('in_while?')).call($e)) !== false && $d !== nil) {
          if (($d = (($f = this.while_loop)['$[]'] || $mm('[]')).call($f, "closure")) !== false && $d !== nil) {
            return "return " + (val) + ";"
            } else {
            return "break;"
          }
          } else {
          if (($d = (($g = this.scope)['$iter?'] || $mm('iter?')).call($g)) !== false && $d !== nil) {
            if (($d = (($h = level)['$=='] || $mm('==')).call($h, "stmt")) === false || $d === nil) {
              (($d = this).$error || $mm('error')).call($d, "break must be used as a statement")
            };
            return "return (__breaker.$v = " + (val) + ", __breaker)";
            } else {
            return (($i = this).$error || $mm('error')).call($i, "void value expression: cannot use break outside of iter/while")
          }
        };
      };

      def.$process_case = function(exp, level) {
        var code = nil, expr = nil, returnable = nil, done_else = nil, wen = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r;
        code = [];
        (($a = this.scope).$add_local || $mm('add_local')).call($a, "$case");
        expr = (($b = this).$process || $mm('process')).call($b, (($c = exp).$shift || $mm('shift')).call($c), "expr");
        returnable = ($d = (($e = level)['$=='] || $mm('==')).call($e, "stmt"), ($d === nil || $d === false));
        done_else = false;
        while (!(($f = (($g = exp)['$empty?'] || $mm('empty?')).call($g)) !== false && $f !== nil)) {wen = (($f = exp).$shift || $mm('shift')).call($f);
        if (($h = (($i = wen !== false && wen !== nil) ? (($j = (($k = wen).$first || $mm('first')).call($k))['$=='] || $mm('==')).call($j, "when") : $i)) !== false && $h !== nil) {
          if (returnable !== false && returnable !== nil) {
            (($h = this).$returns || $mm('returns')).call($h, wen)
          };
          wen = (($i = this).$process || $mm('process')).call($i, wen, "stmt");
          if (($l = (($m = code)['$empty?'] || $mm('empty?')).call($m)) === false || $l === nil) {
            wen = "else " + (wen)
          };
          (($l = code)['$<<'] || $mm('<<')).call($l, wen);
          } else {
          if (wen !== false && wen !== nil) {
            done_else = true;
            if (returnable !== false && returnable !== nil) {
              wen = (($n = this).$returns || $mm('returns')).call($n, wen)
            };
            (($o = code)['$<<'] || $mm('<<')).call($o, "else {" + ((($p = this).$process || $mm('process')).call($p, wen, "stmt")) + "}");
          }
        };};
        if (($d = (($q = returnable !== false && returnable !== nil) ? ($r = done_else, ($r === nil || $r === false)) : $q)) !== false && $d !== nil) {
          (($d = code)['$<<'] || $mm('<<')).call($d, "else {return nil}")
        };
        code = "$case = " + (expr) + ";" + ((($q = code).$join || $mm('join')).call($q, this.space));
        if (returnable !== false && returnable !== nil) {
          code = "(function() { " + (code) + " }).call(" + ((($r = this).$current_self || $mm('current_self')).call($r)) + ")"
        };
        return code;
      };

      def.$process_when = function(exp, level) {
        var arg = nil, body = nil, test = nil, a = nil, call = nil, splt = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z;
        arg = (($a = (($b = exp).$shift || $mm('shift')).call($b))['$[]'] || $mm('[]')).call($a, __range(1, -1, false));
        body = (($c = exp).$shift || $mm('shift')).call($c);
        if (body !== false && body !== nil) {
          body = (($d = this).$process || $mm('process')).call($d, body, level)
        };
        test = [];
        while (!(($f = (($g = arg)['$empty?'] || $mm('empty?')).call($g)) !== false && $f !== nil)) {a = (($f = arg).$shift || $mm('shift')).call($f);
        if ((($h = (($i = a).$first || $mm('first')).call($i))['$=='] || $mm('==')).call($h, "splat")) {
          call = (($j = this).$s || $mm('s')).call($j, "call", (($k = this).$s || $mm('s')).call($k, "js_tmp", "$splt[i]"), "===", (($l = this).$s || $mm('s')).call($l, "arglist", (($m = this).$s || $mm('s')).call($m, "js_tmp", "$case")));
          splt = "(function($splt) {for(var i = 0; i < $splt.length; i++) {";
          splt = (($n = splt)['$+'] || $mm('+')).call($n, "if (" + ((($o = this).$process || $mm('process')).call($o, call, "expr")) + ") { return true; }");
          splt = (($p = splt)['$+'] || $mm('+')).call($p, "} return false; }).call(" + ((($q = this).$current_self || $mm('current_self')).call($q)) + ", " + ((($r = this).$process || $mm('process')).call($r, (($s = a)['$[]'] || $mm('[]')).call($s, 1), "expr")) + ")");
          (($t = test)['$<<'] || $mm('<<')).call($t, splt);
          } else {
          call = (($u = this).$s || $mm('s')).call($u, "call", a, "===", (($v = this).$s || $mm('s')).call($v, "arglist", (($w = this).$s || $mm('s')).call($w, "js_tmp", "$case")));
          call = (($x = this).$process || $mm('process')).call($x, call, "expr");
          (($y = test)['$<<'] || $mm('<<')).call($y, call);
        };};
        return (($e = "if (%s) {%s%s%s}")['$%'] || $mm('%')).call($e, [(($z = test).$join || $mm('join')).call($z, " || "), this.space, body, this.space]);
      };

      def.$process_match3 = function(sexp, level) {
        var lhs = nil, rhs = nil, call = nil, $a, $b, $c, $d, $e;
        lhs = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        rhs = (($b = sexp)['$[]'] || $mm('[]')).call($b, 1);
        call = (($c = this).$s || $mm('s')).call($c, "call", lhs, "=~", (($d = this).$s || $mm('s')).call($d, "arglist", rhs));
        return (($e = this).$process || $mm('process')).call($e, call, level);
      };

      def.$process_cvar = function(exp, level) {
        var TMP_56, $a, $b;
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_56 = function(tmp) {

          var self = TMP_56._s || this, $a, $b, $c, $d;
          if (tmp == null) tmp = nil;

          return (($a = "((%s = Opal.cvars[%s]) == null ? nil : %s)")['$%'] || $mm('%')).call($a, [tmp, (($b = (($c = (($d = exp).$shift || $mm('shift')).call($d)).$to_s || $mm('to_s')).call($c)).$inspect || $mm('inspect')).call($b), tmp])
        }, TMP_56._s = this, TMP_56), $a).call($b);
      };

      def.$process_cvasgn = function(exp, level) {
        var $a, $b, $c, $d, $e;
        return "(Opal.cvars[" + ((($a = (($b = (($c = exp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b)).$inspect || $mm('inspect')).call($a)) + "] = " + ((($d = this).$process || $mm('process')).call($d, (($e = exp).$shift || $mm('shift')).call($e), "expr")) + ")";
      };

      def.$process_cvdecl = function(exp, level) {
        var $a, $b, $c, $d, $e;
        return "(Opal.cvars[" + ((($a = (($b = (($c = exp).$shift || $mm('shift')).call($c)).$to_s || $mm('to_s')).call($b)).$inspect || $mm('inspect')).call($a)) + "] = " + ((($d = this).$process || $mm('process')).call($d, (($e = exp).$shift || $mm('shift')).call($e), "expr")) + ")";
      };

      def.$process_colon2 = function(sexp, level) {
        var base = nil, cname = nil, $a, $b, $c, $d, TMP_57, $e;
        base = (($a = sexp)['$[]'] || $mm('[]')).call($a, 0);
        cname = (($b = (($c = sexp)['$[]'] || $mm('[]')).call($c, 1)).$to_s || $mm('to_s')).call($b);
        if (($d = this.const_missing) !== false && $d !== nil) {
          return ($d = (($e = this).$with_temp || $mm('with_temp')), $d._p = (TMP_57 = function(t) {

            var self = TMP_57._s || this, $a, $b;
            if (t == null) t = nil;

            base = (($a = self).$process || $mm('process')).call($a, base, "expr");
            return "((" + (t) + " = (" + (base) + ")._scope)." + (cname) + " == null ? " + (t) + ".cm(" + ((($b = cname).$inspect || $mm('inspect')).call($b)) + ") : " + (t) + "." + (cname) + ")";
          }, TMP_57._s = this, TMP_57), $d).call($e)
          } else {
          base = (($d = this).$process || $mm('process')).call($d, base, "expr");
          return "(" + (base) + ")._scope." + (cname);
        };
      };

      def.$process_colon3 = function(exp, level) {
        var TMP_58, $a, $b;
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_58 = function(t) {

          var cname = nil, self = TMP_58._s || this, $a, $b, $c;
          if (t == null) t = nil;

          cname = (($a = (($b = exp).$shift || $mm('shift')).call($b)).$to_s || $mm('to_s')).call($a);
          return "((" + (t) + " = __opal.Object._scope." + (cname) + ") == null ? __opal.cm(" + ((($c = cname).$inspect || $mm('inspect')).call($c)) + ") : " + (t) + ")";
        }, TMP_58._s = this, TMP_58), $a).call($b);
      };

      def.$process_super = function(sexp, level) {
        var args = nil, $a, $b, $c, $d, $e, $f;
        args = [];
        while (!(($b = (($c = sexp)['$empty?'] || $mm('empty?')).call($c)) !== false && $b !== nil)) {(($b = args)['$<<'] || $mm('<<')).call($b, (($d = this).$process || $mm('process')).call($d, (($e = sexp).$shift || $mm('shift')).call($e), "expr"))};
        return (($a = this).$js_super || $mm('js_super')).call($a, "[" + ((($f = args).$join || $mm('join')).call($f, ", ")) + "]");
      };

      def.$process_zsuper = function(exp, level) {
        var $a;
        return (($a = this).$js_super || $mm('js_super')).call($a, "__slice.call(arguments)");
      };

      def.$js_super = function(args) {
        var mid = nil, sid = nil, identity = nil, cls_name = nil, jsid = nil, chain = nil, defn = nil, trys = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, TMP_59, $y, $z, $aa, $ab;
        if (($a = (($b = this.scope)['$def_in_class?'] || $mm('def_in_class?')).call($b)) !== false && $a !== nil) {
          mid = (($a = (($c = this.scope).$mid || $mm('mid')).call($c)).$to_s || $mm('to_s')).call($a);
          sid = "super_" + ((($d = this).$unique_temp || $mm('unique_temp')).call($d));
          (($e = this.scope)['$uses_super='] || $mm('uses_super=')).call($e, sid);
          return "" + (sid) + ".apply(" + ((($f = this).$current_self || $mm('current_self')).call($f)) + ", " + (args) + ")";
          } else {
          if ((($g = (($h = this.scope).$type || $mm('type')).call($h))['$=='] || $mm('==')).call($g, "def")) {
            identity = (($i = this.scope)['$identify!'] || $mm('identify!')).call($i);
            cls_name = (($j = (($k = (($l = this.scope).$parent || $mm('parent')).call($l)).$name || $mm('name')).call($k)), $j !== false && $j !== nil ? $j : "" + ((($m = this).$current_self || $mm('current_self')).call($m)) + "._klass.prototype");
            jsid = (($j = this).$mid_to_jsid || $mm('mid_to_jsid')).call($j, (($n = (($o = this.scope).$mid || $mm('mid')).call($o)).$to_s || $mm('to_s')).call($n));
            if (($p = (($q = this.scope).$defs || $mm('defs')).call($q)) !== false && $p !== nil) {
              return (($p = "%s._super%s.apply(this, %s)")['$%'] || $mm('%')).call($p, [cls_name, jsid, args])
              } else {
              return (($r = ("" + ((($s = this).$current_self || $mm('current_self')).call($s)) + "._klass._super.prototype%s.apply(" + ((($t = this).$current_self || $mm('current_self')).call($t)) + ", %s)"))['$%'] || $mm('%')).call($r, [jsid, args])
            };
            } else {
            if ((($u = (($v = this.scope).$type || $mm('type')).call($v))['$=='] || $mm('==')).call($u, "iter")) {
              (($w = (($x = this.scope).$get_super_chain || $mm('get_super_chain')).call($x))._isArray ? $w : ($w = [$w])), chain = ($w[0] == null ? nil : $w[0]), defn = ($w[1] == null ? nil : $w[1]), mid = ($w[2] == null ? nil : $w[2]);
              trys = (($w = ($y = (($z = chain).$map || $mm('map')), $y._p = (TMP_59 = function(c) {

                var self = TMP_59._s || this;
                if (c == null) c = nil;

                return "" + (c) + "._sup"
              }, TMP_59._s = this, TMP_59), $y).call($z)).$join || $mm('join')).call($w, " || ");
              return "(" + (trys) + " || " + ((($y = this).$current_self || $mm('current_self')).call($y)) + "._klass._super.prototype[" + (mid) + "]).apply(" + ((($aa = this).$current_self || $mm('current_self')).call($aa)) + ", " + (args) + ")";
              } else {
              return (($ab = this).$raise || $mm('raise')).call($ab, "Cannot call super() from outside a method block")
            }
          }
        };
      };

      def.$process_op_asgn_or = function(exp, level) {
        var $a, $b, $c, $d;
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "or", (($c = exp).$shift || $mm('shift')).call($c), (($d = exp).$shift || $mm('shift')).call($d)), "expr");
      };

      def.$process_op_asgn_and = function(sexp, level) {
        var $a, $b, $c, $d;
        return (($a = this).$process || $mm('process')).call($a, (($b = this).$s || $mm('s')).call($b, "and", (($c = sexp).$shift || $mm('shift')).call($c), (($d = sexp).$shift || $mm('shift')).call($d)), "expr");
      };

      def.$process_op_asgn1 = function(sexp, level) {
        var lhs = nil, arglist = nil, op = nil, rhs = nil, $a, TMP_60, $b;
        (($a = sexp)._isArray ? $a : ($a = [$a])), lhs = ($a[0] == null ? nil : $a[0]), arglist = ($a[1] == null ? nil : $a[1]), op = ($a[2] == null ? nil : $a[2]), rhs = ($a[3] == null ? nil : $a[3]);
        return ($a = (($b = this).$with_temp || $mm('with_temp')), $a._p = (TMP_60 = function(a) {

          var self = TMP_60._s || this, TMP_61, $a, $b;
          if (a == null) a = nil;

          return ($a = (($b = self).$with_temp || $mm('with_temp')), $a._p = (TMP_61 = function(r) {

            var args = nil, recv = nil, aref = nil, aset = nil, orop = nil, self = TMP_61._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m;
            if (r == null) r = nil;

            args = (($a = self).$process || $mm('process')).call($a, (($b = arglist)['$[]'] || $mm('[]')).call($b, 1), "expr");
            recv = (($c = self).$process || $mm('process')).call($c, lhs, "expr");
            aref = (($d = self).$s || $mm('s')).call($d, "call", (($e = self).$s || $mm('s')).call($e, "js_tmp", r), "[]", (($f = self).$s || $mm('s')).call($f, "arglist", (($g = self).$s || $mm('s')).call($g, "js_tmp", a)));
            aset = (($h = self).$s || $mm('s')).call($h, "call", (($i = self).$s || $mm('s')).call($i, "js_tmp", r), "[]=", (($j = self).$s || $mm('s')).call($j, "arglist", (($k = self).$s || $mm('s')).call($k, "js_tmp", a), rhs));
            orop = (($l = self).$s || $mm('s')).call($l, "or", aref, aset);
            return "(" + (a) + " = " + (args) + ", " + (r) + " = " + (recv) + ", " + ((($m = self).$process || $mm('process')).call($m, orop, "expr")) + ")";
          }, TMP_61._s = self, TMP_61), $a).call($b)
        }, TMP_60._s = this, TMP_60), $a).call($b);
      };

      def.$process_op_asgn2 = function(exp, level) {
        var lhs = nil, mid = nil, op = nil, rhs = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, TMP_62, $j, $k, $l, TMP_63, $m, $n, TMP_64, $o;
        lhs = (($a = this).$process || $mm('process')).call($a, (($b = exp).$shift || $mm('shift')).call($b), "expr");
        mid = (($c = (($d = (($e = exp).$shift || $mm('shift')).call($e)).$to_s || $mm('to_s')).call($d))['$[]'] || $mm('[]')).call($c, __range(0, -2, false));
        op = (($f = exp).$shift || $mm('shift')).call($f);
        rhs = (($g = exp).$shift || $mm('shift')).call($g);
        if ((($h = (($i = op).$to_s || $mm('to_s')).call($i))['$=='] || $mm('==')).call($h, "||")) {
          return ($j = (($k = this).$with_temp || $mm('with_temp')), $j._p = (TMP_62 = function(temp) {

            var getr = nil, asgn = nil, orop = nil, self = TMP_62._s || this, $a, $b, $c, $d, $e, $f, $g, $h;
            if (temp == null) temp = nil;

            getr = (($a = self).$s || $mm('s')).call($a, "call", (($b = self).$s || $mm('s')).call($b, "js_tmp", temp), mid, (($c = self).$s || $mm('s')).call($c, "arglist"));
            asgn = (($d = self).$s || $mm('s')).call($d, "call", (($e = self).$s || $mm('s')).call($e, "js_tmp", temp), "" + (mid) + "=", (($f = self).$s || $mm('s')).call($f, "arglist", rhs));
            orop = (($g = self).$s || $mm('s')).call($g, "or", getr, asgn);
            return "(" + (temp) + " = " + (lhs) + ", " + ((($h = self).$process || $mm('process')).call($h, orop, "expr")) + ")";
          }, TMP_62._s = this, TMP_62), $j).call($k)
          } else {
          if ((($j = (($l = op).$to_s || $mm('to_s')).call($l))['$=='] || $mm('==')).call($j, "&&")) {
            return ($m = (($n = this).$with_temp || $mm('with_temp')), $m._p = (TMP_63 = function(temp) {

              var getr = nil, asgn = nil, andop = nil, self = TMP_63._s || this, $a, $b, $c, $d, $e, $f, $g, $h;
              if (temp == null) temp = nil;

              getr = (($a = self).$s || $mm('s')).call($a, "call", (($b = self).$s || $mm('s')).call($b, "js_tmp", temp), mid, (($c = self).$s || $mm('s')).call($c, "arglist"));
              asgn = (($d = self).$s || $mm('s')).call($d, "call", (($e = self).$s || $mm('s')).call($e, "js_tmp", temp), "" + (mid) + "=", (($f = self).$s || $mm('s')).call($f, "arglist", rhs));
              andop = (($g = self).$s || $mm('s')).call($g, "and", getr, asgn);
              return "(" + (temp) + " = " + (lhs) + ", " + ((($h = self).$process || $mm('process')).call($h, andop, "expr")) + ")";
            }, TMP_63._s = this, TMP_63), $m).call($n)
            } else {
            return ($m = (($o = this).$with_temp || $mm('with_temp')), $m._p = (TMP_64 = function(temp) {

              var getr = nil, oper = nil, asgn = nil, self = TMP_64._s || this, $a, $b, $c, $d, $e, $f, $g, $h, $i;
              if (temp == null) temp = nil;

              getr = (($a = self).$s || $mm('s')).call($a, "call", (($b = self).$s || $mm('s')).call($b, "js_tmp", temp), mid, (($c = self).$s || $mm('s')).call($c, "arglist"));
              oper = (($d = self).$s || $mm('s')).call($d, "call", getr, op, (($e = self).$s || $mm('s')).call($e, "arglist", rhs));
              asgn = (($f = self).$s || $mm('s')).call($f, "call", (($g = self).$s || $mm('s')).call($g, "js_tmp", temp), "" + (mid) + "=", (($h = self).$s || $mm('s')).call($h, "arglist", oper));
              return "(" + (temp) + " = " + (lhs) + ", " + ((($i = self).$process || $mm('process')).call($i, asgn, "expr")) + ")";
            }, TMP_64._s = this, TMP_64), $m).call($o)
          }
        };
      };

      def.$process_ensure = function(exp, level) {
        var begn = nil, retn = nil, body = nil, ensr = nil, res = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j;
        begn = (($a = exp).$shift || $mm('shift')).call($a);
        if (($b = (($c = (($d = level)['$=='] || $mm('==')).call($d, "recv")), $c !== false && $c !== nil ? $c : (($e = level)['$=='] || $mm('==')).call($e, "expr"))) !== false && $b !== nil) {
          retn = true;
          begn = (($b = this).$returns || $mm('returns')).call($b, begn);
        };
        body = (($c = this).$process || $mm('process')).call($c, begn, level);
        ensr = (($f = (($g = exp).$shift || $mm('shift')).call($g)), $f !== false && $f !== nil ? $f : (($h = this).$s || $mm('s')).call($h, "nil"));
        ensr = (($f = this).$process || $mm('process')).call($f, ensr, level);
        if (($i = (($j = body)['$=~'] || $mm('=~')).call($j, /^try \{/)) === false || $i === nil) {
          body = "try {\n" + (body) + "}"
        };
        res = "" + (body) + (this.space) + "finally {" + (this.space) + (ensr) + "}";
        if (retn !== false && retn !== nil) {
          res = "(function() { " + (res) + "; }).call(" + ((($i = this).$current_self || $mm('current_self')).call($i)) + ")"
        };
        return res;
      };

      def.$process_rescue = function(exp, level) {
        var body = nil, handled_else = nil, parts = nil, part = nil, code = nil, $a, $b, $c, $d, $e, TMP_65, $f, $g, $h, $i, $j, $k, $l, TMP_66, $m, $n, $o, TMP_67, $p, $q, $r;
        body = (function() { if ((($a = (($b = (($c = exp).$first || $mm('first')).call($c)).$first || $mm('first')).call($b))['$=='] || $mm('==')).call($a, "resbody")) {
          return (($d = this).$s || $mm('s')).call($d, "nil")
          } else {
          return (($e = exp).$shift || $mm('shift')).call($e)
        }; return nil; }).call(this);
        body = ($f = (($g = this).$indent || $mm('indent')), $f._p = (TMP_65 = function() {

          var self = TMP_65._s || this, $a;
          
          return (($a = self).$process || $mm('process')).call($a, body, level)
        }, TMP_65._s = this, TMP_65), $f).call($g);
        handled_else = false;
        parts = [];
        while (!(($h = (($i = exp)['$empty?'] || $mm('empty?')).call($i)) !== false && $h !== nil)) {if (($h = (($j = (($k = (($l = exp).$first || $mm('first')).call($l)).$first || $mm('first')).call($k))['$=='] || $mm('==')).call($j, "resbody")) === false || $h === nil) {
          handled_else = true
        };
        part = ($h = (($m = this).$indent || $mm('indent')), $h._p = (TMP_66 = function() {

          var self = TMP_66._s || this, $a, $b;
          
          return (($a = self).$process || $mm('process')).call($a, (($b = exp).$shift || $mm('shift')).call($b), level)
        }, TMP_66._s = this, TMP_66), $h).call($m);
        if (($h = (($n = parts)['$empty?'] || $mm('empty?')).call($n)) === false || $h === nil) {
          part = ($h = "else ", $o = part, typeof($h) === 'number' ? $h + $o : $h['$+']($o))
        };
        (($h = parts)['$<<'] || $mm('<<')).call($h, part);};
        if (($f = handled_else) === false || $f === nil) {
          (($f = parts)['$<<'] || $mm('<<')).call($f, ($o = (($p = this).$indent || $mm('indent')), $o._p = (TMP_67 = function() {

            var self = TMP_67._s || this;
            
            return "else { throw $err; }"
          }, TMP_67._s = this, TMP_67), $o).call($p))
        };
        code = "try {" + (this.space) + ((($o = __scope.INDENT) == null ? __opal.cm("INDENT") : $o)) + (body) + (this.space) + "} catch ($err) {" + (this.space) + ((($o = parts).$join || $mm('join')).call($o, this.space)) + (this.space) + "}";
        if ((($q = level)['$=='] || $mm('==')).call($q, "expr")) {
          code = "(function() { " + (code) + " }).call(" + ((($r = this).$current_self || $mm('current_self')).call($r)) + ")"
        };
        return code;
      };

      def.$process_resbody = function(exp, level) {
        var args = nil, body = nil, types = nil, err = nil, val = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, TMP_68, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x;
        args = (($a = exp)['$[]'] || $mm('[]')).call($a, 0);
        body = (($b = exp)['$[]'] || $mm('[]')).call($b, 1);
        body = (($c = this).$process || $mm('process')).call($c, (($d = body), $d !== false && $d !== nil ? $d : (($e = this).$s || $mm('s')).call($e, "nil")), level);
        types = (($d = args)['$[]'] || $mm('[]')).call($d, __range(1, -1, false));
        if (($f = ($g = (($g = types).$last || $mm('last')).call($g), $g !== false && $g !== nil ? ($h = (($i = (($j = (($k = types).$last || $mm('last')).call($k)).$first || $mm('first')).call($j))['$=='] || $mm('==')).call($i, "const"), ($h === nil || $h === false)) : $g)) !== false && $f !== nil) {
          (($f = types).$pop || $mm('pop')).call($f)
        };
        err = (($h = ($l = (($m = types).$map || $mm('map')), $l._p = (TMP_68 = function(t) {

          var call = nil, a = nil, self = TMP_68._s || this, $a, $b, $c, $d;
          if (t == null) t = nil;

          call = (($a = self).$s || $mm('s')).call($a, "call", t, "===", (($b = self).$s || $mm('s')).call($b, "arglist", (($c = self).$s || $mm('s')).call($c, "js_tmp", "$err")));
          a = (($d = self).$process || $mm('process')).call($d, call, "expr");
          return a;
        }, TMP_68._s = this, TMP_68), $l).call($m)).$join || $mm('join')).call($h, ", ");
        if (($l = (($n = err)['$empty?'] || $mm('empty?')).call($n)) !== false && $l !== nil) {
          err = "true"
        };
        if (($l = ($o = (($o = (($p = __scope.Array) == null ? __opal.cm("Array") : $p))['$==='] || $mm('===')).call($o, (($p = args).$last || $mm('last')).call($p)), $o !== false && $o !== nil ? (($q = ["lasgn", "iasgn"])['$include?'] || $mm('include?')).call($q, (($r = (($s = args).$last || $mm('last')).call($s)).$first || $mm('first')).call($r)) : $o)) !== false && $l !== nil) {
          val = (($l = args).$last || $mm('last')).call($l);
          (($t = val)['$[]='] || $mm('[]=')).call($t, 2, (($u = this).$s || $mm('s')).call($u, "js_tmp", "$err"));
          val = ($v = (($x = this).$process || $mm('process')).call($x, val, "expr"), $w = ";", typeof($v) === 'number' ? $v + $w : $v['$+']($w));
        };
        return "if (" + (err) + ") {" + (this.space) + (val) + (body) + "}";
      };

      def.$process_begin = function(exp, level) {
        var $a, $b;
        return (($a = this).$process || $mm('process')).call($a, (($b = exp)['$[]'] || $mm('[]')).call($b, 0), level);
      };

      def.$process_next = function(exp, level) {
        var $a, $b, $c, $d;
        if (($a = (($b = this)['$in_while?'] || $mm('in_while?')).call($b)) !== false && $a !== nil) {
          return "continue;"
          } else {
          return "return " + ((function() { if (($a = (($c = exp)['$empty?'] || $mm('empty?')).call($c)) !== false && $a !== nil) {
            return "nil"
            } else {
            return (($a = this).$process || $mm('process')).call($a, (($d = exp).$shift || $mm('shift')).call($d), "expr")
          }; return nil; }).call(this)) + ";"
        };
      };

      def.$process_redo = function(exp, level) {
        var $a, $b, $c;
        if (($a = (($b = this)['$in_while?'] || $mm('in_while?')).call($b)) !== false && $a !== nil) {
          (($a = this.while_loop)['$[]='] || $mm('[]=')).call($a, "use_redo", true);
          return "" + ((($c = this.while_loop)['$[]'] || $mm('[]')).call($c, "redo_var")) + " = true";
          } else {
          return "REDO()"
        };
      };

      return nil;
    })(Opal, null)
    
  })(self);
})(Opal);
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __module = __opal.module, __hash2 = __opal.hash2;
  return (function(__base){
    function Opal() {};
    Opal = __module(__base, "Opal", Opal);
    var def = Opal.prototype, __scope = Opal._scope;

    __opal.defs(Opal, '$parse', function(source, options) {
      var $a, $b, $c;if (options == null) {
        options = __hash2([], {})
      }
      return (($a = (($b = (($c = __scope.Parser) == null ? __opal.cm("Parser") : $c)).$new || $mm('new')).call($b)).$parse || $mm('parse')).call($a, source, options)
    });

    __opal.defs(Opal, '$core_dir', function() {
      var $a, $b;
      return (($a = (($b = __scope.File) == null ? __opal.cm("File") : $b)).$expand_path || $mm('expand_path')).call($a, "../../opal", nil)
    });

    __opal.defs(Opal, '$append_path', function(path) {
      var $a, $b;
      return (($a = (($b = this).$paths || $mm('paths')).call($b))['$<<'] || $mm('<<')).call($a, path)
    });

    __opal.defs(Opal, '$paths', function() {
      var $a, $b;
      if (this.paths == null) this.paths = nil;

      return (($a = this.paths), $a !== false && $a !== nil ? $a : this.paths = [(($b = this).$core_dir || $mm('core_dir')).call($b)])
    });
    
  })(self);
})(Opal);

Opal.eval = function(str) {
  var js = Opal.Opal.Parser.$new().$parse(str);
  return eval(js);
};
(function(__opal) {
  var self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __klass = __opal.klass, __gvars = __opal.gvars, __hash2 = __opal.hash2, __range = __opal.range;
  return (function(__base, __super){
    function OpalIRB() {};
    OpalIRB = __klass(__base, __super, "OpalIRB", OpalIRB);

    var def = OpalIRB.prototype, __scope = OpalIRB._scope, $a, $b, $c, $d, $e, $f, $g, $h;
    def.settings = def.input = def.output = def.history = def.multiline = def.prompt = def.saved = def.historyi = nil;

    __scope.SAVED_CONSOLE_LOG = console.log;

    __gvars["output"] = (($a = (($b = __scope.Element) == null ? __opal.cm("Element") : $b)).$find || $mm('find')).call($a, "#output");

    __gvars["input"] = (($b = (($c = __scope.Element) == null ? __opal.cm("Element") : $c)).$find || $mm('find')).call($b, "#input");

    __gvars["prompt"] = (($c = (($d = __scope.Element) == null ? __opal.cm("Element") : $d)).$find || $mm('find')).call($c, "#prompt");

    __gvars["inputdiv"] = (($d = (($e = __scope.Element) == null ? __opal.cm("Element") : $e)).$find || $mm('find')).call($d, "#inputdiv");

    __gvars["inputl"] = (($e = (($f = __scope.Element) == null ? __opal.cm("Element") : $f)).$find || $mm('find')).call($e, "#inputl");

    __gvars["inputr"] = (($f = (($g = __scope.Element) == null ? __opal.cm("Element") : $g)).$find || $mm('find')).call($f, "#inputr");

    __gvars["inputcopy"] = (($g = (($h = __scope.Element) == null ? __opal.cm("Element") : $h)).$find || $mm('find')).call($g, "#inputcopy");

    __opal.defs(OpalIRB, '$reset_settings', function() {
      
      return localStorage.clear();
    });

    __opal.defs(OpalIRB, '$save_settings', function() {
      var $a;
      if (this.settings == null) this.settings = nil;

      return localStorage.settings = JSON.stringify( (($a = this.settings).$map || $mm('map')).call($a));
    });

    __opal.defs(OpalIRB, '$resize_input', function(e) {
      var width = nil, content = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j;
      width = ($a = (($c = __gvars["inputdiv"]).$width || $mm('width')).call($c), $b = (($d = __gvars["inputl"]).$width || $mm('width')).call($d), typeof($a) === 'number' ? $a - $b : $a['$-']($b));
      content = (($a = __gvars["input"]).$value || $mm('value')).call($a);
      (($b = __gvars["inputcopy"]).$html || $mm('html')).call($b, content);
      (($e = __gvars["inputcopy"]).$width || $mm('width')).call($e, width);
      (($f = __gvars["input"]).$width || $mm('width')).call($f, width);
      return (($g = __gvars["input"]).$height || $mm('height')).call($g, ($h = (($j = __gvars["inputcopy"]).$height || $mm('height')).call($j), $i = 2, typeof($h) === 'number' ? $h + $i : $h['$+']($i)));
    });

    __opal.defs(OpalIRB, '$scroll_to_bottom', function() {
      
      return window.scrollTo( 0, __gvars["prompt"][0].offsetTop);
    });

    __scope.DEFAULT_SETTINGS = __hash2(["max_lines", "max_depth", "show_hidden", "colorize"], {"max_lines": 500, "max_depth": 2, "show_hidden": false, "colorize": true});

    def.$escape_html = function(s) {
      var $a, $b, $c;
      return (($a = (($b = (($c = s).$gsub || $mm('gsub')).call($c, /&/, "&amp;")).$gsub || $mm('gsub')).call($b, /</, "&lt;")).$gsub || $mm('gsub')).call($a, />/, "&gt;");
    };

    def.$settings = function() {
      
      return this.settings
    }, nil;

    def.$initialize = function(output, input, prompt, settings) {
      var myself = nil, $a, $b, TMP_1, $c;if (settings == null) {
        settings = __hash2([], {})
      }
      $a = [output, input, prompt], this.output = $a[0], this.input = $a[1], this.prompt = $a[2];
      this.history = [];
      this.historyi = -1;
      this.saved = "";
      this.multiline = false;
      this.settings = (($a = (($b = __scope.DEFAULT_SETTINGS) == null ? __opal.cm("DEFAULT_SETTINGS") : $b)).$clone || $mm('clone')).call($a);
      myself = this;
      return ($b = (($c = this.input).$on || $mm('on')), $b._p = (TMP_1 = function(evt) {

        var self = TMP_1._s || this, $a;
        if (evt == null) evt = nil;

        return (($a = myself).$handle_keypress || $mm('handle_keypress')).call($a, evt)
      }, TMP_1._s = this, TMP_1), $b).call($c, "keydown");
    };

    def.$print = function(args) {
      var s = nil, o = nil, $a, $b, $c, $d, $e;
      s = args;
      o = ($a = ($c = (($e = this.output).$html || $mm('html')).call($e), $d = s, typeof($c) === 'number' ? $c + $d : $c['$+']($d)), $b = "\n", typeof($a) === 'number' ? $a + $b : $a['$+']($b));
      (($a = this.output)['$html='] || $mm('html=')).call($a, o);
      return nil;
    };

    def.$to_s = function() {
      var $a;
      return (($a = __hash2(["history", "multiline", "settings"], {"history": this.history, "multiline": this.multiline, "settings": this.settings})).$inspect || $mm('inspect')).call($a);
    };

    def.$set_prompt = function() {
      var s = nil, $a;
      s = (function() { if (($a = this.multiline) !== false && $a !== nil) {
        return "------"
        } else {
        return "opal"
      }; return nil; }).call(this);
      return (($a = this.prompt)['$html='] || $mm('html=')).call($a, "" + (s) + "&gt;&nbsp;");
    };

    def.$add_to_history = function(s) {
      var $a;
      (($a = this.history).$unshift || $mm('unshift')).call($a, s);
      return this.historyi = -1;
    };

    def.$add_to_saved = function(s) {
      var $a, $b, $c, $d, $e, $f;
      this.saved = (($a = this.saved)['$+'] || $mm('+')).call($a, (function() { if ((($b = (($c = s)['$[]'] || $mm('[]')).call($c, __range(0, -1, true)))['$=='] || $mm('==')).call($b, "\\")) {
        return (($d = s)['$[]'] || $mm('[]')).call($d, __range(0, -1, true))
        } else {
        return s
      }; return nil; }).call(this));
      this.saved = (($e = this.saved)['$+'] || $mm('+')).call($e, "\n");
      return (($f = this).$add_to_history || $mm('add_to_history')).call($f, s);
    };

    def.$clear = function() {
      var $a;
      (($a = this.output)['$html='] || $mm('html=')).call($a, "");
      return nil;
    };

    def.$process_saved = function() {
      var compiled = nil, value = nil, output = nil, e = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k;
      try {
        compiled = (($a = (($b = (($c = ((($d = __scope.Opal) == null ? __opal.cm("Opal") : $d))._scope).Parser == null ? $c.cm("Parser") : $c.Parser)).$new || $mm('new')).call($b)).$parse || $mm('parse')).call($a, this.saved);
        (($c = this).$log || $mm('log')).call($c, compiled);
        value = eval(compiled);
        __gvars["_"] = value;
        output = nodeutil.inspect( value, (($d = this.settings)['$[]'] || $mm('[]')).call($d, "show_hidden"), (($e = this.settings)['$[]'] || $mm('[]')).call($e, "max_depth"), (($f = this.settings)['$[]'] || $mm('[]')).call($f, "colorize"));
      } catch ($err) {
      if ((($g = (($i = __scope.Exception) == null ? __opal.cm("Exception") : $i))['$==='] || $mm('===')).call($g, $err)) {
        e = $err;if (($g = (($h = e).$backtrace || $mm('backtrace')).call($h)) !== false && $g !== nil) {
          output = ($g = "FOR:\n" + (compiled) + "\n============\n", $i = (($j = (($k = e).$backtrace || $mm('backtrace')).call($k)).$join || $mm('join')).call($j, "\n"), typeof($g) === 'number' ? $g + $i : $g['$+']($i))
          } else {
          output = e.toString()
        }}
      else { throw $err; }
      };
      this.saved = "";
      return (($i = this).$print || $mm('print')).call($i, output);
    };

    def.$help = function() {
      var text = nil, $a, $b, $c, $d, $e, $f;
      text = (($a = [" ", "<strong>Features</strong>", "<strong>========</strong>", "+ <strong>Esc</strong> toggles multiline mode.", "+ <strong>Up/Down arrow</strong> flips through line history.", "+ Access the internals of this console through <strong>$irb</strong>.", "+ <strong>clear</strong> clears this console.", "+ <strong>history</strong> shows line history.", " ", "<strong>@Settings</strong>", "<strong>========</strong>", "You can modify the behavior of this IRB by altering <strong>$irb.@settings</strong>:", " ", "+ <strong>max_lines</strong> (" + ((($b = this.settings)['$[]'] || $mm('[]')).call($b, "max_lines")) + "): max line count of this console", "+ <strong>max_depth</strong> (" + ((($c = this.settings)['$[]'] || $mm('[]')).call($c, "max_depth")) + "): max_depth in which to inspect outputted object", "+ <strong>show_hidden</strong> (" + ((($d = this.settings)['$[]'] || $mm('[]')).call($d, "show_hidden")) + "): flag to output hidden (not enumerable) properties of objects", "+ <strong>colorize</strong> (" + ((($e = this.settings)['$[]'] || $mm('[]')).call($e, "colorize")) + "): flag to colorize output (set to false if IRB is slow)", " ", " "]).$join || $mm('join')).call($a, "\n");
      return (($f = this).$print || $mm('print')).call($f, text);
    };

    def.$log = function(thing) {
      
      return console.log(thing);
    };

    def.$history = function() {
      var TMP_2, $a, $b, $c;
      return ($a = (($b = (($c = this.history).$reverse || $mm('reverse')).call($c)).$each_with_index || $mm('each_with_index')), $a._p = (TMP_2 = function(line, i) {

        var self = TMP_2._s || this, $a;
        if (line == null) line = nil;
if (i == null) i = nil;

        return (($a = self).$print || $mm('print')).call($a, "" + (i) + ": " + (line))
      }, TMP_2._s = this, TMP_2), $a).call($b);
    };

    def.$handle_keypress = function(e) {
      var $case = nil, input = nil, $a, $b, $c, $d, $e, $f, $g, $h, $i, $j, $k, $l, $m, $n, $o, $p, $q, $r, $s, $t, $u, $v, $w, $x, $y, $z, $aa, $ab, $ac, $ad, $ae, $af, $ag, $ah, $ai, $aj, $ak, $al;
      (($a = this).$log || $mm('log')).call($a, (($b = e).$which || $mm('which')).call($b));
      return (function() { $case = (($c = e).$which || $mm('which')).call($c);if ((($l = (13))['$==='] || $mm('===')).call($l, $case)) {
      (($d = e).$prevent_default || $mm('prevent_default')).call($d);
      input = (($e = this.input).$value || $mm('value')).call($e);
      (($f = this.input)['$value='] || $mm('value=')).call($f, "");
      (($g = this).$print || $mm('print')).call($g, ($h = (($j = this.prompt).$html || $mm('html')).call($j), $i = (($k = this).$escape_html || $mm('escape_html')).call($k, input), typeof($h) === 'number' ? $h + $i : $h['$+']($i)));
      if (input !== false && input !== nil) {
        (($h = this).$add_to_saved || $mm('add_to_saved')).call($h, input);
        if (($i = ($l = ($l = (($m = (($n = input)['$[]'] || $mm('[]')).call($n, __range(0, -1, true)))['$=='] || $mm('==')).call($m, "\\"), ($l === nil || $l === false)), $l !== false && $l !== nil ? ($l = this.multiline, ($l === nil || $l === false)) : $l)) !== false && $i !== nil) {
          return (($i = this).$process_saved || $mm('process_saved')).call($i)
          } else {
          return nil
        };
        } else {
        return nil
      };
      }
      else if ((($y = (27))['$==='] || $mm('===')).call($y, $case)) {
      (($o = e).$prevent_default || $mm('prevent_default')).call($o);
      input = this.input.val();
      if (($p = ($q = (($q = input !== false && input !== nil) ? this.multiline : $q), $q !== false && $q !== nil ? this.saved : $q)) !== false && $p !== nil) {
        input = (($p = this.input).$value || $mm('value')).call($p);
        (($q = this.input).$value || $mm('value')).call($q, "");
        (($r = this).$print || $mm('print')).call($r, ($s = (($u = this.prompt).$html || $mm('html')).call($u), $t = (($v = this).$escape_html || $mm('escape_html')).call($v, input), typeof($s) === 'number' ? $s + $t : $s['$+']($t)));
        (($s = this).$add_to_saved || $mm('add_to_saved')).call($s, input);
        (($t = this).$process_saved || $mm('process_saved')).call($t);
        } else {
        if (($w = ($x = this.multiline, $x !== false && $x !== nil ? this.saved : $x)) !== false && $w !== nil) {
          (($w = this).$process_saved || $mm('process_saved')).call($w)
        }
      };
      this.multiline = ($x = this.multiline, ($x === nil || $x === false));
      return (($x = this).$set_prompt || $mm('set_prompt')).call($x);
      }
      else if ((($af = (38))['$==='] || $mm('===')).call($af, $case)) {
      (($z = e).$prevent_default || $mm('prevent_default')).call($z);
      if ((($aa = this.historyi)['$<'] || $mm('<')).call($aa, ($ab = (($ad = this.history).$length || $mm('length')).call($ad), $ac = 1, typeof($ab) === 'number' ? $ab - $ac : $ab['$-']($ac)))) {
        this.historyi = (($ab = this.historyi)['$+'] || $mm('+')).call($ab, 1);
        return (($ac = this.input)['$value='] || $mm('value=')).call($ac, (($ae = this.history)['$[]'] || $mm('[]')).call($ae, this.historyi));
        } else {
        return nil
      };
      }
      else if ((($al = (40))['$==='] || $mm('===')).call($al, $case)) {
      (($ag = e).$prevent_default || $mm('prevent_default')).call($ag);
      if ((($ah = this.historyi)['$>'] || $mm('>')).call($ah, 0)) {
        this.historyi = (($ai = this.historyi)['$+'] || $mm('+')).call($ai, -1);
        return (($aj = this.input)['$value='] || $mm('value=')).call($aj, (($ak = this.history)['$[]'] || $mm('[]')).call($ak, this.historyi));
        } else {
        return nil
      };
      }
      else {return nil} }).call(this);
    };

    __opal.defs(OpalIRB, '$init', function() {
      var irb = nil, TMP_3, $a, $b, TMP_4, $c, $d, $e, TMP_5, TMP_6, $f, TMP_7, $g, $h, $i, $j, $k, $l;
      ($a = (($b = __gvars["input"]).$on || $mm('on')), $a._p = (TMP_3 = function() {

        var self = TMP_3._s || this, $a;
        
        return (($a = self).$scroll_to_bottom || $mm('scroll_to_bottom')).call($a)
      }, TMP_3._s = this, TMP_3), $a).call($b, "keydown");
      ($a = (($c = (($d = (($e = __scope.Element) == null ? __opal.cm("Element") : $e)).$find || $mm('find')).call($d, window)).$on || $mm('on')), $a._p = (TMP_4 = function(e) {

        var self = TMP_4._s || this, $a;
        if (e == null) e = nil;

        return (($a = self).$resize_input || $mm('resize_input')).call($a, e)
      }, TMP_4._s = this, TMP_4), $a).call($c, "resize");
      ($a = (($e = __gvars["input"]).$on || $mm('on')), $a._p = (TMP_5 = function(e) {

        var self = TMP_5._s || this, $a;
        if (e == null) e = nil;

        return (($a = self).$resize_input || $mm('resize_input')).call($a, e)
      }, TMP_5._s = this, TMP_5), $a).call($e, "keyup");
      ($a = (($f = __gvars["input"]).$on || $mm('on')), $a._p = (TMP_6 = function(e) {

        var self = TMP_6._s || this, $a;
        if (e == null) e = nil;

        return (($a = self).$resize_input || $mm('resize_input')).call($a, e)
      }, TMP_6._s = this, TMP_6), $a).call($f, "change");
      ($a = (($g = (($h = (($i = __scope.Element) == null ? __opal.cm("Element") : $i)).$find || $mm('find')).call($h, "html")).$on || $mm('on')), $a._p = (TMP_7 = function(e) {

        var self = TMP_7._s || this, $a;
        if (e == null) e = nil;

        return (($a = __gvars["input"]).$focus || $mm('focus')).call($a)
      }, TMP_7._s = this, TMP_7), $a).call($g, "click");
      irb = (($a = (($i = __scope.OpalIRB) == null ? __opal.cm("OpalIRB") : $i)).$new || $mm('new')).call($a, __gvars["output"], __gvars["input"], __gvars["prompt"]);
      __gvars["irb"] = irb;
      (($i = this).$resize_input || $mm('resize_input')).call($i);
      (($j = __gvars["input"]).$focus || $mm('focus')).call($j);
      return (($k = irb).$print || $mm('print')).call($k, (($l = ["# Opal IRB", "# <a href=\"https://github.com/fkchang/opal-irb\" target=\"_blank\">https://github.com/fkchang/opal-irb</a>", "# inspired by <a href=\"https://github.com/larryng/coffeescript-repl\" target=\"_blank\">https://github.com/larryng/coffeescript-repl</a>", "#", "# <strong>help</strong> for features and tips.", " "]).$join || $mm('join')).call($l, "\n"));
    });

    return nil;
  })(self, null);
})(Opal);
(function(__opal) {
  var TMP_1, $a, $b, $c, self = __opal.top, __scope = __opal, nil = __opal.nil, $mm = __opal.mm, __breaker = __opal.breaker, __slice = __opal.slice, __gvars = __opal.gvars;
  return ($a = (($b = (($c = __scope.Document) == null ? __opal.cm("Document") : $c))['$ready?'] || $mm('ready?')), $a._p = (TMP_1 = function() {

    var self = TMP_1._s || this, $a, $b, def = ((typeof(self) === 'function') ? self.prototype : self);
    
    def.$help = function() {
      var $a;
      (($a = __gvars["irb"]).$help || $mm('help')).call($a);
      return null;
    };
    def.$clear = function() {
      var $a;
      (($a = __gvars["irb"]).$clear || $mm('clear')).call($a);
      return null;
    };
    def.$history = function() {
      var $a;
      (($a = __gvars["irb"]).$history || $mm('history')).call($a);
      return null;
    };
    return (($a = (($b = __scope.OpalIRB) == null ? __opal.cm("OpalIRB") : $b)).$init || $mm('init')).call($a);
  }, TMP_1._s = self, TMP_1), $a).call($b);
})(Opal);
