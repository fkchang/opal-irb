(function(undefined) {
  if (typeof(this.Opal) !== 'undefined') {
    console.warn('Opal already loaded. Loading twice can cause troubles, please fix your setup.');
    return this.Opal;
  }

  // The Opal object that is exposed globally
  var Opal = this.Opal = {};

  // All bridged classes - keep track to donate methods from Object
  var bridged_classes = Opal.bridged_classes = [];

  // TopScope is used for inheriting constants from the top scope
  var TopScope = function(){};

  // Opal just acts as the top scope
  TopScope.prototype = Opal;

  // To inherit scopes
  Opal.constructor = TopScope;

  // List top scope constants
  Opal.constants = [];

  // This is a useful reference to global object inside ruby files
  Opal.global = this;

  // Minify common function calls
  var $hasOwn = Opal.hasOwnProperty;
  var $slice  = Opal.slice = Array.prototype.slice;

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

  // Get constants
  Opal.get = function(name) {
    var constant = this[name];

    if (constant == null) {
      return this.base.$const_missing(name);
    }

    return constant;
  };

  /*
   * Create a new constants scope for the given class with the given
   * base. Constants are looked up through their parents, so the base
   * scope will be the outer scope of the new klass.
   */
  function create_scope(base, klass, id) {
    var const_alloc = function() {};
    var const_scope = const_alloc.prototype = new base.constructor();

    klass.$$scope       = const_scope;
    klass.$$base_module = base.base;

    const_scope.base        = klass;
    const_scope.constructor = const_alloc;
    const_scope.constants   = [];

    if (id) {
      klass.$$orig_scope = base;
      base[id] = base.constructor[id] = klass;
      base.constants.push(id);
    }
  }

  Opal.create_scope = create_scope;

  /*
   * A `class Foo; end` expression in ruby is compiled to call this runtime
   * method which either returns an existing class of the given name, or creates
   * a new class in the given `base` scope.
   *
   * If a constant with the given name exists, then we check to make sure that
   * it is a class and also that the superclasses match. If either of these
   * fail, then we raise a `TypeError`. Note, superklass may be null if one was
   * not specified in the ruby code.
   *
   * We pass a constructor to this method of the form `function ClassName() {}`
   * simply so that classes show up with nicely formatted names inside debuggers
   * in the web browser (or node/sprockets).
   *
   * The `base` is the current `self` value where the class is being created
   * from. We use this to get the scope for where the class should be created.
   * If `base` is an object (not a class/module), we simple get its class and
   * use that as the base instead.
   *
   * @param [Object] base where the class is being created
   * @param [Class] superklass superclass of the new class (may be null)
   * @param [String] id the name of the class to be created
   * @param [Function] constructor function to use as constructor
   * @return [Class] new or existing ruby class
   */
  Opal.klass = function(base, superklass, id, constructor) {
    // If base is an object, use its class
    if (!base.$$is_class) {
      base = base.$$class;
    }

    // Not specifying a superclass means we can assume it to be Object
    if (superklass === null) {
      superklass = ObjectClass;
    }

    var klass = base.$$scope[id];

    // If a constant exists in the scope, then we must use that
    if ($hasOwn.call(base.$$scope, id) && klass.$$orig_scope === base.$$scope) {
      // Make sure the existing constant is a class, or raise error
      if (!klass.$$is_class) {
        throw Opal.TypeError.$new(id + " is not a class");
      }

      // Make sure existing class has same superclass
      if (superklass !== klass.$$super && superklass !== ObjectClass) {
        throw Opal.TypeError.$new("superclass mismatch for class " + id);
      }
    }
    else if (typeof(superklass) === 'function') {
      // passed native constructor as superklass, so bridge it as ruby class
      return bridge_class(id, superklass);
    }
    else {
      // if class doesnt exist, create a new one with given superclass
      klass = boot_class(superklass, constructor);

      // name class using base (e.g. Foo or Foo::Baz)
      klass.$$name = id;

      // every class gets its own constant scope, inherited from current scope
      create_scope(base.$$scope, klass, id);

      // Name new class directly onto current scope (Opal.Foo.Baz = klass)
      base[id] = base.$$scope[id] = klass;

      // Copy all parent constants to child, unless parent is Object
      if (superklass !== ObjectClass && superklass !== BasicObjectClass) {
        Opal.donate_constants(superklass, klass);
      }

      // call .inherited() hook with new class on the superclass
      if (superklass.$inherited) {
        superklass.$inherited(klass);
      }
    }

    return klass;
  };

  // Create generic class with given superclass.
  function boot_class(superklass, constructor) {
    var alloc = boot_class_alloc(null, constructor, superklass)

    return boot_class_object(superklass, alloc);
  }

  // Make `boot_class` available to the JS-API
  Opal.boot = boot_class;

  /*
   * The class object itself (as in `Class.new`)
   *
   * @param [(Opal) Class] superklass Another class object (as in `Class.new`)
   * @param [constructor]  alloc      The constructor that holds the prototype
   *                                  that will be used for instances of the
   *                                  newly constructed class.
   */
  function boot_class_object(superklass, alloc) {
    var singleton_class = function() {};
    singleton_class.prototype = superklass.constructor.prototype;

    function OpalClass() {}
    OpalClass.prototype = new singleton_class();

    var klass = new OpalClass();

    setup_module_or_class_object(klass, OpalClass, superklass, alloc.prototype);

    // @property $$alloc This is the constructor of instances of the current
    //                   class. Its prototype will be used for method lookup
    klass.$$alloc = alloc;

    // @property $$proto.$$class Make available to instances a reference to the
    //                           class they belong to.
    klass.$$proto.$$class = klass;

    return klass;
  }

  /*
   * Adds common/required properties to a module or class object
   * (as in `Module.new` / `Class.new`)
   *
   * @param module      The module or class that needs to be prepared
   *
   * @param constructor The constructor of the module or class itself,
   *                    usually it's already assigned by using `new`. Some
   *                    ipothesis on why it's needed can be found below.
   *
   * @param superklass  The superclass of the class/module object, for modules
   *                    is `Module` (of `ModuleClass` in JS context)
   *
   * @param prototype   The prototype on which the class/module methods will
   *                    be stored.
   */
  function setup_module_or_class_object(module, constructor, superklass, prototype) {
    // @property $$id Each class is assigned a unique `id` that helps
    //                comparation and implementation of `#object_id`
    module.$$id = unique_id++;

    // @property $$proto This is the prototype on which methods will be defined
    module.$$proto = prototype;

    // @property constructor keeps a ref to the constructor, but apparently the
    //                       constructor is already set on:
    //
    //                          `var module = new constructor` is called.
    //
    //                       Maybe there are some browsers not abiding (IE6?)
    module.constructor = constructor;

    // @property $$is_class Clearly mark this as a class-like
    module.$$is_class = true;

    // @property $$super the superclass, doesn't get changed by module inclusions
    module.$$super = superklass;

    // @property $$parent direct parent class or module
    //                    starts with the superclass, after module inclusion is
    //                    the last included module
    module.$$parent = superklass;

    // @property $$methods keeps track of methods defined on the class
    //                     but seems to be used just by `define_basic_object_method`
    //                     and for donating (Ruby) Object methods to bridged classes
    //                     TODO: check if it can be removed
    module.$$methods = [];

    // @property $$inc included modules
    module.$$inc = [];
  }

  // Define new module (or return existing module)
  Opal.module = function(base, id) {
    var module;

    if (!base.$$is_class) {
      base = base.$$class;
    }

    if ($hasOwn.call(base.$$scope, id)) {
      module = base.$$scope[id];

      if (!module.$$is_mod && module !== ObjectClass) {
        throw Opal.TypeError.$new(id + " is not a module");
      }
    }
    else {
      module = boot_module_object();
      module.$$name = id;

      create_scope(base.$$scope, module, id);

      // Name new module directly onto current scope (Opal.Foo.Baz = module)
      base[id] = base.$$scope[id] = module;
    }

    return module;
  };

  /*
   * Internal function to create a new module instance. This simply sets up
   * the prototype hierarchy and method tables.
   */
  function boot_module_object() {
    var mtor = function() {};
    mtor.prototype = ModuleClass.constructor.prototype;

    function module_constructor() {}
    module_constructor.prototype = new mtor();

    var module = new module_constructor();
    var module_prototype = {};

    setup_module_or_class_object(module, module_constructor, ModuleClass, module_prototype);

    module.$$is_mod = true;
    module.$$dep    = [];

    return module;
  }

  /*
   * Get (or prepare) the singleton class for the passed object.
   *
   * @param object [Ruby Object]
   */
  Opal.get_singleton_class = function(object) {
    if (object.$$meta) {
      return object.$$meta;
    }

    if (object.$$is_class) {
      return build_class_singleton_class(object);
    }

    return build_object_singleton_class(object);
  };

  /*
   * Build the singleton class for an existing class.
   *
   * NOTE: Actually in MRI a class' singleton class inherits from its
   * superclass' singleton class which in turn inherits from Class;
   */
  function build_class_singleton_class(klass) {
    var meta = new Opal.Class.$$alloc;

    meta.$$class = Opal.Class;
    meta.$$proto = klass.constructor.prototype;

    meta.$$is_singleton = true;
    meta.$$inc          = [];
    meta.$$methods      = [];
    meta.$$scope        = klass.$$scope;

    return klass.$$meta = meta;
  }

  /*
   * Build the singleton class for a Ruby (non class) Object.
   */
  function build_object_singleton_class(object) {
    var orig_class = object.$$class,
        class_id   = "#<Class:#<" + orig_class.$$name + ":" + orig_class.$$id + ">>";

    var Singleton = function () {};
    var meta = Opal.boot(orig_class, Singleton);
    meta.$$name   = class_id;

    meta.$$proto  = object;
    meta.$$class  = orig_class.$$class;
    meta.$$scope  = orig_class.$$scope;
    meta.$$parent = orig_class;
    return object.$$meta = meta;
  }

  /*
   * The actual inclusion of a module into a class.
   */
  Opal.append_features = function(module, klass) {
    var included = klass.$$inc;

    // check if this module is already included in the klass
    for (var j = 0, jj = included.length; j < jj; j++) {
      if (included[j] === module) {
        return;
      }
    }

    included.push(module);
    module.$$dep.push(klass);

    // iclass
    var iclass = {
      $$name:   module.$$name,
      $$proto:  module.$$proto,
      $$parent: klass.$$parent,
      $$module: module,
      $$iclass: true
    };

    klass.$$parent = iclass;

    var donator   = module.$$proto,
        prototype = klass.$$proto,
        methods   = module.$$methods;

    for (var i = 0, length = methods.length; i < length; i++) {
      var method = methods[i], current;


      if ( prototype.hasOwnProperty(method) &&
          !(current = prototype[method]).$$donated && !current.$$stub ) {
        // if the target class already has a method of the same name defined
        // and that method was NOT donated, then it must be a method defined
        // by the class so we do not want to override it
      }
      else {
        prototype[method] = donator[method];
        prototype[method].$$donated = true;
      }
    }

    if (klass.$$dep) {
      Opal.donate(klass, methods.slice(), true);
    }

    Opal.donate_constants(module, klass);
  };

  // Boot a base class (makes instances).
  function boot_class_alloc(id, constructor, superklass) {
    if (superklass) {
      var ctor = function() {};
          ctor.prototype   = superklass.$$proto || superklass.prototype;

      if (id) {
        ctor.displayName = id;
      }

      constructor.prototype = new ctor();
    }

    constructor.prototype.constructor = constructor;

    return constructor;
  }

  /*
   * Builds the class object for core classes:
   * - make the class object have a singleton class
   * - make the singleton class inherit from its parent singleton class
   *
   * @param id         [String]      the name of the class
   * @param alloc      [Function]    the constructor for the core class instances
   * @param superclass [Class alloc] the constructor of the superclass
   */
  function boot_core_class_object(id, alloc, superclass) {
    var superclass_constructor = function() {};
        superclass_constructor.prototype = superclass.prototype;

    var singleton_class = function() {};
        singleton_class.prototype = new superclass_constructor();

    singleton_class.displayName = "#<Class:"+id+">";

    // the singleton_class acts as the class object constructor
    var klass = new singleton_class();

    setup_module_or_class_object(klass, singleton_class, superclass, alloc.prototype);

    klass.$$alloc = alloc;
    klass.$$name  = id;

    // Give all instances a ref to their class
    alloc.prototype.$$class = klass;

    Opal[id] = klass;
    Opal.constants.push(id);

    return klass;
  }

  /*
   * For performance, some core ruby classes are toll-free bridged to their
   * native javascript counterparts (e.g. a ruby Array is a javascript Array).
   *
   * This method is used to setup a native constructor (e.g. Array), to have
   * its prototype act like a normal ruby class. Firstly, a new ruby class is
   * created using the native constructor so that its prototype is set as the
   * target for th new class. Note: all bridged classes are set to inherit
   * from Object.
   *
   * Bridged classes are tracked in `bridged_classes` array so that methods
   * defined on Object can be "donated" to all bridged classes. This allows
   * us to fake the inheritance of a native prototype from our Object
   * prototype.
   *
   * Example:
   *
   *    bridge_class("Proc", Function);
   *
   * @param [String] name the name of the ruby class to create
   * @param [Function] constructor native javascript constructor to use
   * @return [Class] returns new ruby class
   */
  function bridge_class(name, constructor) {
    var klass = boot_class_object(ObjectClass, constructor);

    klass.$$name = name;

    create_scope(Opal, klass, name);
    bridged_classes.push(klass);

    var object_methods = BasicObjectClass.$$methods.concat(ObjectClass.$$methods);

    for (var i = 0, len = object_methods.length; i < len; i++) {
      var meth = object_methods[i];
      constructor.prototype[meth] = ObjectClass.$$proto[meth];
    }

    add_stubs_subscriber(constructor.prototype);

    return klass;
  }

  /*
   * constant assign
   */
  Opal.casgn = function(base_module, name, value) {
    var scope = base_module.$$scope;

    if (value.$$is_class && value.$$name === nil) {
      value.$$name = name;
    }

    if (value.$$is_class) {
      value.$$base_module = base_module;
    }

    scope.constants.push(name);
    return scope[name] = value;
  };

  /*
   * constant decl
   */
  Opal.cdecl = function(base_scope, name, value) {
    base_scope.constants.push(name);
    return base_scope[name] = value;
  };

  /*
   * constant get
   */
  Opal.cget = function(base_scope, path) {
    if (path == null) {
      path       = base_scope;
      base_scope = Opal.Object;
    }

    var result = base_scope;

    path = path.split('::');
    while (path.length !== 0) {
      result = result.$const_get(path.shift());
    }

    return result;
  };

  /*
   * When a source module is included into the target module, we must also copy
   * its constants to the target.
   */
  Opal.donate_constants = function(source_mod, target_mod) {
    var source_constants = source_mod.$$scope.constants,
        target_scope     = target_mod.$$scope,
        target_constants = target_scope.constants;

    for (var i = 0, length = source_constants.length; i < length; i++) {
      target_constants.push(source_constants[i]);
      target_scope[source_constants[i]] = source_mod.$$scope[source_constants[i]];
    }
  };

  /*
   * Methods stubs are used to facilitate method_missing in opal. A stub is a
   * placeholder function which just calls `method_missing` on the receiver.
   * If no method with the given name is actually defined on an object, then it
   * is obvious to say that the stub will be called instead, and then in turn
   * method_missing will be called.
   *
   * When a file in ruby gets compiled to javascript, it includes a call to
   * this function which adds stubs for every method name in the compiled file.
   * It should then be safe to assume that method_missing will work for any
   * method call detected.
   *
   * Method stubs are added to the BasicObject prototype, which every other
   * ruby object inherits, so all objects should handle method missing. A stub
   * is only added if the given property name (method name) is not already
   * defined.
   *
   * Note: all ruby methods have a `$` prefix in javascript, so all stubs will
   * have this prefix as well (to make this method more performant).
   *
   *    Opal.add_stubs(["$foo", "$bar", "$baz="]);
   *
   * All stub functions will have a private `$$stub` property set to true so
   * that other internal methods can detect if a method is just a stub or not.
   * `Kernel#respond_to?` uses this property to detect a methods presence.
   *
   * @param [Array] stubs an array of method stubs to add
   */
  Opal.add_stubs = function(stubs) {
    var subscribers = Opal.stub_subscribers;
    var subscriber;

    for (var i = 0, length = stubs.length; i < length; i++) {
      var method_name = stubs[i], stub = stub_for(method_name);

      for (var j = 0; j < subscribers.length; j++) {
        subscriber = subscribers[j];
        if (!(method_name in subscriber)) {
          subscriber[method_name] = stub;
        }
      }
    }
  };

  /*
   * Add a prototype to the subscribers list, and (TODO) add previously stubbed
   * methods.
   *
   * @param [Prototype]
   */
  function add_stubs_subscriber(prototype) {
    // TODO: Add previously stubbed methods too.
    Opal.stub_subscribers.push(prototype);
  }

  /*
   * Keep a list of prototypes that want method_missing stubs to be added.
   *
   * @default [Prototype List] BasicObject.prototype
   */
  Opal.stub_subscribers = [BasicObject.prototype];

  /*
   * Add a method_missing stub function to the given prototype for the
   * given name.
   *
   * @param [Prototype] prototype the target prototype
   * @param [String] stub stub name to add (e.g. "$foo")
   */
  function add_stub_for(prototype, stub) {
    var method_missing_stub = stub_for(stub);
    prototype[stub] = method_missing_stub;
  }

  /*
   * Generate the method_missing stub for a given method name.
   *
   * @param [String] method_name The js-name of the method to stub (e.g. "$foo")
   */
  function stub_for(method_name) {
    function method_missing_stub() {
      // Copy any given block onto the method_missing dispatcher
      this.$method_missing.$$p = method_missing_stub.$$p;

      // Set block property to null ready for the next call (stop false-positives)
      method_missing_stub.$$p = null;

      // call method missing with correct args (remove '$' prefix on method name)
      return this.$method_missing.apply(this, [method_name.slice(1)].concat($slice.call(arguments)));
    }

    method_missing_stub.$$stub = true;

    return method_missing_stub;
  }

  // Expose for other parts of Opal to use
  Opal.add_stub_for = add_stub_for;

  // Arity count error dispatcher
  Opal.ac = function(actual, expected, object, meth) {
    var inspect = (object.$$is_class ? object.$$name + '.' : object.$$class.$$name + '#') + meth;
    var msg = '[' + inspect + '] wrong number of arguments(' + actual + ' for ' + expected + ')';
    throw Opal.ArgumentError.$new(msg);
  };

  // Super dispatcher
  Opal.find_super_dispatcher = function(obj, jsid, current_func, iter, defs) {
    var dispatcher;

    if (defs) {
      dispatcher = obj.$$is_class ? defs.$$super : obj.$$class.$$proto;
    }
    else {
      if (obj.$$is_class) {
        dispatcher = obj.$$super;
      }
      else {
        dispatcher = find_obj_super_dispatcher(obj, jsid, current_func);
      }
    }

    dispatcher = dispatcher['$' + jsid];
    dispatcher.$$p = iter;

    return dispatcher;
  };

  // Iter dispatcher for super in a block
  Opal.find_iter_super_dispatcher = function(obj, jsid, current_func, iter, defs) {
    if (current_func.$$def) {
      return Opal.find_super_dispatcher(obj, current_func.$$jsid, current_func, iter, defs);
    }
    else {
      return Opal.find_super_dispatcher(obj, jsid, current_func, iter, defs);
    }
  };

  function find_obj_super_dispatcher(obj, jsid, current_func) {
    var klass = obj.$$meta || obj.$$class;
    jsid = '$' + jsid;

    while (klass) {
      if (klass.$$proto[jsid] === current_func) {
        // ok
        break;
      }

      klass = klass.$$parent;
    }

    // if we arent in a class, we couldnt find current?
    if (!klass) {
      throw new Error("could not find current class for super()");
    }

    klass = klass.$$parent;

    // else, let's find the next one
    while (klass) {
      var working = klass.$$proto[jsid];

      if (working && working !== current_func) {
        // ok
        break;
      }

      klass = klass.$$parent;
    }

    return klass.$$proto;
  };

  /*
   * Used to return as an expression. Sometimes, we can't simply return from
   * a javascript function as if we were a method, as the return is used as
   * an expression, or even inside a block which must "return" to the outer
   * method. This helper simply throws an error which is then caught by the
   * method. This approach is expensive, so it is only used when absolutely
   * needed.
   */
  Opal.ret = function(val) {
    Opal.returner.$v = val;
    throw Opal.returner;
  };

  // handles yield calls for 1 yielded arg
  Opal.yield1 = function(block, arg) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1 && arg.$$is_array) {
      return block.apply(null, arg);
    }
    else {
      return block(arg);
    }
  };

  // handles yield for > 1 yielded arg
  Opal.yieldX = function(block, args) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1 && args.length == 1) {
      if (args[0].$$is_array) {
        return block.apply(null, args[0]);
      }
    }

    if (!args.$$is_array) {
      args = $slice.call(args);
    }

    return block.apply(null, args);
  };

  // Finds the corresponding exception match in candidates.  Each candidate can
  // be a value, or an array of values.  Returns null if not found.
  Opal.rescue = function(exception, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];

      if (candidate.$$is_array) {
        var result = Opal.rescue(exception, candidate);

        if (result) {
          return result;
        }
      }
      else if (candidate['$==='](exception)) {
        return candidate;
      }
    }

    return null;
  };

  Opal.is_a = function(object, klass) {
    if (object.$$meta === klass) {
      return true;
    }

    var search = object.$$class;

    while (search) {
      if (search === klass) {
        return true;
      }

      for (var i = 0, length = search.$$inc.length; i < length; i++) {
        if (search.$$inc[i] == klass) {
          return true;
        }
      }

      search = search.$$super;
    }

    return false;
  };

  // Helper to convert the given object to an array
  Opal.to_ary = function(value) {
    if (value.$$is_array) {
      return value;
    }
    else if (value.$to_ary && !value.$to_ary.$$stub) {
      return value.$to_ary();
    }

    return [value];
  };

  /*
   * Call a ruby method on a ruby object with some arguments:
   *
   *   var my_array = [1, 2, 3, 4]
   *   Opal.send(my_array, 'length')     # => 4
   *   Opal.send(my_array, 'reverse!')   # => [4, 3, 2, 1]
   *
   * A missing method will be forwarded to the object via
   * method_missing.
   *
   * The result of either call with be returned.
   *
   * @param [Object] recv the ruby object
   * @param [String] mid ruby method to call
   */
  Opal.send = function(recv, mid) {
    var args = $slice.call(arguments, 2),
        func = recv['$' + mid];

    if (func) {
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  Opal.block_send = function(recv, mid, block) {
    var args = $slice.call(arguments, 3),
        func = recv['$' + mid];

    if (func) {
      func.$$p = block;
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  /*
   * Donate methods for a class/module
   */
  Opal.donate = function(klass, defined, indirect) {
    var methods = klass.$$methods, included_in = klass.$$dep;

    // if (!indirect) {
      klass.$$methods = methods.concat(defined);
    // }

    if (included_in) {
      for (var i = 0, length = included_in.length; i < length; i++) {
        var includee = included_in[i];
        var dest     = includee.$$proto;

        for (var j = 0, jj = defined.length; j < jj; j++) {
          var method = defined[j];

          dest[method] = klass.$$proto[method];
          dest[method].$$donated = true;
        }

        if (includee.$$dep) {
          Opal.donate(includee, defined, true);
        }
      }
    }
  };

  Opal.defn = function(obj, jsid, body) {
    if (obj.$$is_mod) {
      obj.$$proto[jsid] = body;
      Opal.donate(obj, [jsid]);

      if (obj.$$module_function) {
        obj[jsid] = body;
      }
    }
    else if (obj.$$is_class) {
      obj.$$proto[jsid] = body;

      if (obj === BasicObjectClass) {
        define_basic_object_method(jsid, body);
      }
      else if (obj === ObjectClass) {
        Opal.donate(obj, [jsid]);
      }
    }
    else {
      obj[jsid] = body;
    }

    return nil;
  };

  /*
   * Define a singleton method on the given object.
   */
  Opal.defs = function(obj, jsid, body) {
    if (obj.$$is_class || obj.$$is_mod) {
      obj.constructor.prototype[jsid] = body;
    }
    else {
      obj[jsid] = body;
    }
  };

  function define_basic_object_method(jsid, body) {
    BasicObjectClass.$$methods.push(jsid);
    for (var i = 0, len = bridged_classes.length; i < len; i++) {
      bridged_classes[i].$$proto[jsid] = body;
    }
  }

  Opal.hash = function() {
    if (arguments.length == 1 && arguments[0].$$class == Opal.Hash) {
      return arguments[0];
    }

    var hash = new Opal.Hash.$$alloc(),
        keys = [],
        _map = {},
        smap = {},
        key, obj, length, khash;

    hash.map   = _map;
    hash.smap  = smap;
    hash.keys  = keys;

    if (arguments.length == 1) {
      if (arguments[0].$$is_array) {
        var args = arguments[0];

        for (var i = 0, ii = args.length; i < ii; i++) {
          var pair = args[i];

          if (pair.length !== 2) {
            throw Opal.ArgumentError.$new("value not of length 2: " + pair.$inspect());
          }

          key = pair[0];
          obj = pair[1];

          if (key.$$is_string) {
            khash = key;
            map = smap;
          } else {
            khash = key.$hash();
            map = _map;
          }

          if (map[khash] == null) {
            keys.push(key);
          }

          map[khash] = obj;
        }
      }
      else {
        obj = arguments[0];
        for (key in obj) {
          khash = key.$hash();
          map[khash] = obj[khash];
          keys.push(key);
        }
      }
    }
    else {
      length = arguments.length;
      if (length % 2 !== 0) {
        throw Opal.ArgumentError.$new("odd number of arguments for Hash");
      }

      for (var j = 0; j < length; j++) {
        key = arguments[j];
        obj = arguments[++j];

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        if (map[khash] == null) {
          keys.push(key);
        }

        map[khash] = obj;
      }
    }

    return hash;
  };

  /*
   * hash2 is a faster creator for hashes that just use symbols and
   * strings as keys. The map and keys array can be constructed at
   * compile time, so they are just added here by the constructor
   * function
   */
  Opal.hash2 = function(keys, map) {
    var hash = new Opal.Hash.$$alloc();

    hash.keys = keys;
    hash.map  = {};
    hash.smap = map;

    return hash;
  };

  /*
   * Create a new range instance with first and last values, and whether the
   * range excludes the last value.
   */
  Opal.range = function(first, last, exc) {
    var range         = new Opal.Range.$$alloc();
        range.begin   = first;
        range.end     = last;
        range.exclude = exc;

    return range;
  };

  // Require system
  // --------------
  (function(Opal) {
    var loaded_features = ['corelib/runtime.js'],
        require_table   = {'corelib/runtime.js': true},
        modules         = {};

    var current_dir  = '.';

    function mark_as_loaded(filename) {
      if (require_table[filename]) {
        return false;
      }

      loaded_features.push(filename);
      require_table[filename] = true;

      return true;
    }

    function normalize_loadable_path(path) {
      var parts, part, new_parts = [], SEPARATOR = '/';

      if (current_dir !== '.') {
        path = current_dir.replace(/\/*$/, '/') + path;
      }

      parts = path.split(SEPARATOR);

      for (var i = 0, ii = parts.length; i < ii; i++) {
        part = parts[i];
        if (part == '') continue;
        (part === '..') ? new_parts.pop() : new_parts.push(part)
      }

      return new_parts.join(SEPARATOR);
    }

    function load(path) {
      mark_as_loaded(path);

      var module = modules[path];

      if (module) {
        module(Opal);
      }
      else {
        var severity = Opal.dynamic_require_severity || 'warning';
        var message  = 'cannot load such file -- ' + path;

        if (severity === "error") {
          Opal.LoadError ? Opal.LoadError.$new(message) : function(){throw message}();
        }
        else if (severity === "warning") {
          console.warn('WARNING: LoadError: ' + message);
        }
      }

      return true;
    }

    function require(path) {
      if (require_table[path]) {
        return false;
      }

      return load(path);
    }

    Opal.modules         = modules;
    Opal.loaded_features = loaded_features;

    Opal.normalize_loadable_path = normalize_loadable_path;
    Opal.mark_as_loaded          = mark_as_loaded;

    Opal.load    = load;
    Opal.require = require;
  })(Opal);

  // Initialization
  // --------------

  // The actual class for BasicObject
  var BasicObjectClass;

  // The actual Object class
  var ObjectClass;

  // The actual Module class
  var ModuleClass;

  // The actual Class class
  var ClassClass;

  // Constructor for instances of BasicObject
  function BasicObject(){}

  // Constructor for instances of Object
  function Object(){}

  // Constructor for instances of Class
  function Class(){}

  // Constructor for instances of Module
  function Module(){}

  // Constructor for instances of NilClass (nil)
  function NilClass(){}

  // Constructors for *instances* of core objects
  boot_class_alloc('BasicObject', BasicObject);
  boot_class_alloc('Object',      Object,       BasicObject);
  boot_class_alloc('Module',      Module,       Object);
  boot_class_alloc('Class',       Class,        Module);

  // Constructors for *classes* of core objects
  BasicObjectClass = boot_core_class_object('BasicObject', BasicObject, Class);
  ObjectClass      = boot_core_class_object('Object',      Object,      BasicObjectClass.constructor);
  ModuleClass      = boot_core_class_object('Module',      Module,      ObjectClass.constructor);
  ClassClass       = boot_core_class_object('Class',       Class,       ModuleClass.constructor);

  // Fix booted classes to use their metaclass
  BasicObjectClass.$$class = ClassClass;
  ObjectClass.$$class      = ClassClass;
  ModuleClass.$$class      = ClassClass;
  ClassClass.$$class       = ClassClass;

  // Fix superclasses of booted classes
  BasicObjectClass.$$super = null;
  ObjectClass.$$super      = BasicObjectClass;
  ModuleClass.$$super      = ObjectClass;
  ClassClass.$$super       = ModuleClass;

  BasicObjectClass.$$parent = null;
  ObjectClass.$$parent      = BasicObjectClass;
  ModuleClass.$$parent      = ObjectClass;
  ClassClass.$$parent       = ModuleClass;

  // Internally, Object acts like a module as it is "included" into bridged
  // classes. In other words, we donate methods from Object into our bridged
  // classes as their prototypes don't inherit from our root Object, so they
  // act like module includes.
  ObjectClass.$$dep = bridged_classes;

  Opal.base                     = ObjectClass;
  BasicObjectClass.$$scope      = ObjectClass.$$scope = Opal;
  BasicObjectClass.$$orig_scope = ObjectClass.$$orig_scope = Opal;
  Opal.Kernel                   = ObjectClass;

  ModuleClass.$$scope      = ObjectClass.$$scope;
  ModuleClass.$$orig_scope = ObjectClass.$$orig_scope;
  ClassClass.$$scope       = ObjectClass.$$scope;
  ClassClass.$$orig_scope  = ObjectClass.$$orig_scope;

  ObjectClass.$$proto.toString = function() {
    return this.$to_s();
  };

  ObjectClass.$$proto.$require = Opal.require;

  Opal.top = new ObjectClass.$$alloc();

  // Nil
  var nil_id = Opal.uid(); // nil id is traditionally 4
  Opal.klass(ObjectClass, ObjectClass, 'NilClass', NilClass);
  var nil = Opal.nil = new NilClass();
  nil.$$id = nil_id;
  nil.call = nil.apply = function() { throw Opal.LocalJumpError.$new('no block given'); };

  Opal.breaker  = new Error('unexpected break');
  Opal.returner = new Error('unexpected return');

  bridge_class('Array',     Array);
  bridge_class('Boolean',   Boolean);
  bridge_class('Numeric',   Number);
  bridge_class('String',    String);
  bridge_class('Proc',      Function);
  bridge_class('Exception', Error);
  bridge_class('Regexp',    RegExp);
  bridge_class('Time',      Date);

  TypeError.$$super = Error;
}).call(this);

if (typeof(global) !== 'undefined') {
  global.Opal = this.Opal;
  Opal.global = global;
}
if (typeof(window) !== 'undefined') {
  window.Opal = this.Opal;
  Opal.global = window;
}
Opal.mark_as_loaded(Opal.normalize_loadable_path("corelib/runtime"));
/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/helpers"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module;

  Opal.add_stubs(['$new', '$class', '$===', '$respond_to?', '$raise', '$type_error', '$__send__', '$coerce_to', '$nil?', '$<=>', '$inspect']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    Opal.defs(self, '$type_error', function(object, type, method, coerced) {
      var $a, $b, self = this;

      if (method == null) {
        method = nil
      }
      if (coerced == null) {
        coerced = nil
      }
      if ((($a = (($b = method !== false && method !== nil) ? coerced : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return $scope.get('TypeError').$new("can't convert " + (object.$class()) + " into " + (type) + " (" + (object.$class()) + "#" + (method) + " gives " + (coerced.$class()))
        } else {
        return $scope.get('TypeError').$new("no implicit conversion of " + (object.$class()) + " into " + (type))
      };
    });

    Opal.defs(self, '$coerce_to', function(object, type, method) {
      var $a, self = this;

      if ((($a = type['$==='](object)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return object};
      if ((($a = object['$respond_to?'](method)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise(self.$type_error(object, type))
      };
      return object.$__send__(method);
    });

    Opal.defs(self, '$coerce_to!', function(object, type, method) {
      var $a, self = this, coerced = nil;

      coerced = self.$coerce_to(object, type, method);
      if ((($a = type['$==='](coerced)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise(self.$type_error(object, type, method, coerced))
      };
      return coerced;
    });

    Opal.defs(self, '$coerce_to?', function(object, type, method) {
      var $a, self = this, coerced = nil;

      if ((($a = object['$respond_to?'](method)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return nil
      };
      coerced = self.$coerce_to(object, type, method);
      if ((($a = coerced['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil};
      if ((($a = type['$==='](coerced)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise(self.$type_error(object, type, method, coerced))
      };
      return coerced;
    });

    Opal.defs(self, '$try_convert', function(object, type, method) {
      var $a, self = this;

      if ((($a = type['$==='](object)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return object};
      if ((($a = object['$respond_to?'](method)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return object.$__send__(method)
        } else {
        return nil
      };
    });

    Opal.defs(self, '$compare', function(a, b) {
      var $a, self = this, compare = nil;

      compare = a['$<=>'](b);
      if ((($a = compare === nil) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "comparison of " + (a.$class()) + " with " + (b.$class()) + " failed")};
      return compare;
    });

    Opal.defs(self, '$destructure', function(args) {
      var self = this;

      
      if (args.length == 1) {
        return args[0];
      }
      else if (args.$$is_array) {
        return args;
      }
      else {
        return $slice.call(args);
      }
    
    });

    Opal.defs(self, '$respond_to?', function(obj, method) {
      var self = this;

      
      if (obj == null || !obj.$$class) {
        return false;
      }
    
      return obj['$respond_to?'](method);
    });

    Opal.defs(self, '$inspect', function(obj) {
      var self = this;

      
      if (obj === undefined) {
        return "undefined";
      }
      else if (obj === null) {
        return "null";
      }
      else if (!obj.$$class) {
        return obj.toString();
      }
      else {
        return obj.$inspect();
      }
    
    });
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/module"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$attr_reader', '$attr_writer', '$=~', '$raise', '$const_missing', '$const_get', '$to_str', '$to_proc', '$append_features', '$included', '$name', '$new', '$to_s', '$__id__']);
  return (function($base, $super) {
    function $Module(){};
    var self = $Module = $klass($base, $super, 'Module', $Module);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4;

    Opal.defs(self, '$new', TMP_1 = function() {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      
      function AnonModule(){}
      var klass      = Opal.boot(Opal.Module, AnonModule);
      klass.$$name   = nil;
      klass.$$class  = Opal.Module;
      klass.$$dep    = []
      klass.$$is_mod = true;
      klass.$$proto  = {};

      // inherit scope from parent
      Opal.create_scope(Opal.Module.$$scope, klass);

      if (block !== nil) {
        var block_self = block.$$s;
        block.$$s = null;
        block.call(klass);
        block.$$s = block_self;
      }

      return klass;
    
    });

    def['$==='] = function(object) {
      var $a, self = this;

      if ((($a = object == null) !== nil && (!$a.$$is_boolean || $a == true))) {
        return false};
      return Opal.is_a(object, self);
    };

    def['$<'] = function(other) {
      var self = this;

      
      var working = self;

      while (working) {
        if (working === other) {
          return true;
        }

        working = working.$$parent;
      }

      return false;
    
    };

    def.$alias_method = function(newname, oldname) {
      var self = this;

      
      self.$$proto['$' + newname] = self.$$proto['$' + oldname];

      if (self.$$methods) {
        Opal.donate(self, ['$' + newname ])
      }
    
      return self;
    };

    def.$alias_native = function(mid, jsid) {
      var self = this;

      if (jsid == null) {
        jsid = mid
      }
      return self.$$proto['$' + mid] = self.$$proto[jsid];
    };

    def.$ancestors = function() {
      var self = this;

      
      var parent = self,
          result = [];

      while (parent) {
        result.push(parent);
        result = result.concat(parent.$$inc);

        parent = parent.$$super;
      }

      return result;
    
    };

    def.$append_features = function(klass) {
      var self = this;

      Opal.append_features(self, klass);
      return self;
    };

    def.$attr_accessor = function(names) {
      var $a, $b, self = this;

      names = $slice.call(arguments, 0);
      ($a = self).$attr_reader.apply($a, [].concat(names));
      return ($b = self).$attr_writer.apply($b, [].concat(names));
    };

    def.$attr_reader = function(names) {
      var self = this;

      names = $slice.call(arguments, 0);
      
      var proto = self.$$proto, cls = self;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function() { return this[name] };

          if (cls.$$is_singleton) {
            proto.constructor.prototype['$' + name] = func;
          }
          else {
            proto['$' + name] = func;
            Opal.donate(self, ['$' + name ]);
          }
        })(names[i]);
      }
    
      return nil;
    };

    def.$attr_writer = function(names) {
      var self = this;

      names = $slice.call(arguments, 0);
      
      var proto = self.$$proto, cls = self;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function(value) { return this[name] = value; };

          if (cls.$$is_singleton) {
            proto.constructor.prototype['$' + name + '='] = func;
          }
          else {
            proto['$' + name + '='] = func;
            Opal.donate(self, ['$' + name + '=']);
          }
        })(names[i]);
      }
    
      return nil;
    };

    Opal.defn(self, '$attr', def.$attr_accessor);

    def.$autoload = function(const$, path) {
      var self = this;

      
      var autoloaders;

      if (!(autoloaders = self.$$autoload)) {
        autoloaders = self.$$autoload = {};
      }

      autoloaders[const$] = path;
      return nil;
    ;
    };

    def.$constants = function() {
      var self = this;

      return self.$$scope.constants;
    };

    def['$const_defined?'] = function(name, inherit) {
      var $a, self = this;

      if (inherit == null) {
        inherit = true
      }
      if ((($a = name['$=~'](/^[A-Z]\w*$/)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('NameError'), "wrong constant name " + (name))
      };
      
      scopes = [self.$$scope];
      if (inherit || self === Opal.Object) {
        var parent = self.$$super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent.$$scope);
          parent = parent.$$super;
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
      var $a, self = this;

      if (inherit == null) {
        inherit = true
      }
      if ((($a = name['$=~'](/^[A-Z]\w*$/)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('NameError'), "wrong constant name " + (name))
      };
      
      var scopes = [self.$$scope];
      if (inherit || self == Opal.Object) {
        var parent = self.$$super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent.$$scope);
          parent = parent.$$super;
        }
      }

      for (var i = 0, len = scopes.length; i < len; i++) {
        if (scopes[i].hasOwnProperty(name)) {
          return scopes[i][name];
        }
      }

      return self.$const_missing(name);
    
    };

    def.$const_missing = function(const$) {
      var self = this;

      
      if (self.$$autoload) {
        var file = self.$$autoload[const$];

        if (file) {
          self.$require(file);

          return self.$const_get(const$);
        }
      }
    ;
      return self.$raise($scope.get('NameError'), "uninitialized constant " + (self) + "::" + (const$));
    };

    def.$const_set = function(name, value) {
      var $a, self = this;

      if ((($a = name['$=~'](/^[A-Z]\w*$/)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('NameError'), "wrong constant name " + (name))
      };
      try {
      name = name.$to_str()
      } catch ($err) {if (true) {
        self.$raise($scope.get('TypeError'), "conversion with #to_str failed")
        }else { throw $err; }
      };
      Opal.casgn(self, name, value);
      return value;
    };

    def.$define_method = TMP_2 = function(name, method) {
      var self = this, $iter = TMP_2.$$p, block = $iter || nil;

      TMP_2.$$p = null;
      
      if (method) {
        block = method.$to_proc();
      }

      if (block === nil) {
        throw new Error("no block given");
      }

      var jsid    = '$' + name;
      block.$$jsid = name;
      block.$$s    = null;
      block.$$def  = block;

      self.$$proto[jsid] = block;
      Opal.donate(self, [jsid]);

      return name;
    ;
    };

    def.$remove_method = function(name) {
      var self = this;

      
      var jsid    = '$' + name;
      var current = self.$$proto[jsid];
      delete self.$$proto[jsid];

      // Check if we need to reverse Opal.donate
      // Opal.retire(self, [jsid]);
      return self;
    
    };

    def.$include = function(mods) {
      var self = this;

      mods = $slice.call(arguments, 0);
      
      for (var i = mods.length - 1; i >= 0; i--) {
        var mod = mods[i];

        if (mod === self) {
          continue;
        }

        (mod).$append_features(self);
        (mod).$included(self);
      }
    
      return self;
    };

    def['$include?'] = function(mod) {
      var self = this;

      
      for (var cls = self; cls; cls = cls.parent) {
        for (var i = 0; i != cls.$$inc.length; i++) {
          var mod2 = cls.$$inc[i];
          if (mod === mod2) {
            return true;
          }
        }
      }
      return false;
    
    };

    def.$instance_method = function(name) {
      var self = this;

      
      var meth = self.$$proto['$' + name];

      if (!meth || meth.$$stub) {
        self.$raise($scope.get('NameError'), "undefined method `" + (name) + "' for class `" + (self.$name()) + "'");
      }

      return $scope.get('UnboundMethod').$new(self, meth, name);
    
    };

    def.$instance_methods = function(include_super) {
      var self = this;

      if (include_super == null) {
        include_super = false
      }
      
      var methods = [],
          proto   = self.$$proto;

      for (var prop in proto) {
        if (!prop.charAt(0) === '$') {
          continue;
        }

        if (typeof(proto[prop]) !== "function") {
          continue;
        }

        if (proto[prop].$$stub) {
          continue;
        }

        if (!self.$$is_mod) {
          if (self !== Opal.BasicObject && proto[prop] === Opal.BasicObject.$$proto[prop]) {
            continue;
          }

          if (!include_super && !proto.hasOwnProperty(prop)) {
            continue;
          }

          if (!include_super && proto[prop].$$donated) {
            continue;
          }
        }

        methods.push(prop.substr(1));
      }

      return methods;
    
    };

    def.$included = function(mod) {
      var self = this;

      return nil;
    };

    def.$extended = function(mod) {
      var self = this;

      return nil;
    };

    def.$module_eval = TMP_3 = function() {
      var self = this, $iter = TMP_3.$$p, block = $iter || nil;

      TMP_3.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        self.$raise($scope.get('ArgumentError'), "no block given")
      };
      
      var old = block.$$s,
          result;

      block.$$s = null;
      result = block.call(self);
      block.$$s = old;

      return result;
    
    };

    Opal.defn(self, '$class_eval', def.$module_eval);

    def.$module_exec = TMP_4 = function() {
      var self = this, $iter = TMP_4.$$p, block = $iter || nil;

      TMP_4.$$p = null;
      
      if (block === nil) {
        throw new Error("no block given");
      }

      var block_self = block.$$s, result;

      block.$$s = null;
      result = block.apply(self, $slice.call(arguments));
      block.$$s = block_self;

      return result;
    
    };

    Opal.defn(self, '$class_exec', def.$module_exec);

    def['$method_defined?'] = function(method) {
      var self = this;

      
      var body = self.$$proto['$' + method];
      return (!!body) && !body.$$stub;
    
    };

    def.$module_function = function(methods) {
      var self = this;

      methods = $slice.call(arguments, 0);
      
      if (methods.length === 0) {
        self.$$module_function = true;
      }
      else {
        for (var i = 0, length = methods.length; i < length; i++) {
          var meth = methods[i], func = self.$$proto['$' + meth];

          self.constructor.prototype['$' + meth] = func;
        }
      }

      return self;
    
    };

    def.$name = function() {
      var self = this;

      
      if (self.$$full_name) {
        return self.$$full_name;
      }

      var result = [], base = self;

      while (base) {
        if (base.$$name === nil) {
          return result.length === 0 ? nil : result.join('::');
        }

        result.unshift(base.$$name);

        base = base.$$base_module;

        if (base === Opal.Object) {
          break;
        }
      }

      if (result.length === 0) {
        return nil;
      }

      return self.$$full_name = result.join('::');
    
    };

    def.$public = function(methods) {
      var self = this;

      methods = $slice.call(arguments, 0);
      
      if (methods.length === 0) {
        self.$$module_function = false;
      }

      return nil;
    
    };

    Opal.defn(self, '$private', def.$public);

    Opal.defn(self, '$protected', def.$public);

    Opal.defn(self, '$nesting', def.$public);

    def.$private_class_method = function(name) {
      var self = this;

      return self['$' + name] || nil;
    };

    Opal.defn(self, '$public_class_method', def.$private_class_method);

    def['$private_method_defined?'] = function(obj) {
      var self = this;

      return false;
    };

    def.$private_constant = function() {
      var self = this;

      return nil;
    };

    Opal.defn(self, '$protected_method_defined?', def['$private_method_defined?']);

    Opal.defn(self, '$public_instance_methods', def.$instance_methods);

    Opal.defn(self, '$public_method_defined?', def['$method_defined?']);

    def.$remove_class_variable = function() {
      var self = this;

      return nil;
    };

    def.$remove_const = function(name) {
      var self = this;

      
      var old = self.$$scope[name];
      delete self.$$scope[name];
      return old;
    
    };

    def.$to_s = function() {
      var $a, self = this;

      return ((($a = self.$name()) !== false && $a !== nil) ? $a : "#<" + (self.$$is_mod ? 'Module' : 'Class') + ":0x" + (self.$__id__().$to_s(16)) + ">");
    };

    return (def.$undef_method = function(symbol) {
      var self = this;

      Opal.add_stub_for(self.$$proto, "$" + symbol);
      return self;
    }, nil) && 'undef_method';
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/class"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$raise', '$allocate']);
  self.$require("corelib/module");
  return (function($base, $super) {
    function $Class(){};
    var self = $Class = $klass($base, $super, 'Class', $Class);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2;

    Opal.defs(self, '$new', TMP_1 = function(sup) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      if (sup == null) {
        sup = $scope.get('Object')
      }
      TMP_1.$$p = null;
      
      if (!sup.$$is_class || sup.$$is_mod) {
        self.$raise($scope.get('TypeError'), "superclass must be a Class");
      }

      function AnonClass(){};
      var klass      = Opal.boot(sup, AnonClass)
      klass.$$name   = nil;
      klass.$$parent = sup;

      // inherit scope from parent
      Opal.create_scope(sup.$$scope, klass);

      sup.$inherited(klass);

      if (block !== nil) {
        var block_self = block.$$s;
        block.$$s = null;
        block.call(klass);
        block.$$s = block_self;
      }

      return klass;
    ;
    });

    def.$allocate = function() {
      var self = this;

      
      var obj = new self.$$alloc;
      obj.$$id = Opal.uid();
      return obj;
    
    };

    def.$inherited = function(cls) {
      var self = this;

      return nil;
    };

    def.$new = TMP_2 = function(args) {
      var self = this, $iter = TMP_2.$$p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_2.$$p = null;
      
      var obj = self.$allocate();

      obj.$initialize.$$p = block;
      obj.$initialize.apply(obj, args);
      return obj;
    ;
    };

    return (def.$superclass = function() {
      var self = this;

      return self.$$super || nil;
    }, nil) && 'superclass';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/basic_object"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$raise', '$inspect']);
  return (function($base, $super) {
    function $BasicObject(){};
    var self = $BasicObject = $klass($base, $super, 'BasicObject', $BasicObject);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4;

    Opal.defn(self, '$initialize', function() {
      var self = this;

      return nil;
    });

    Opal.defn(self, '$==', function(other) {
      var self = this;

      return self === other;
    });

    Opal.defn(self, '$__id__', function() {
      var self = this;

      return self.$$id || (self.$$id = Opal.uid());
    });

    Opal.defn(self, '$__send__', TMP_1 = function(symbol, args) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_1.$$p = null;
      
      var func = self['$' + symbol]

      if (func) {
        if (block !== nil) {
          func.$$p = block;
        }

        return func.apply(self, args);
      }

      if (block !== nil) {
        self.$method_missing.$$p = block;
      }

      return self.$method_missing.apply(self, [symbol].concat(args));
    
    });

    Opal.defn(self, '$!', function() {
      var self = this;

      return false;
    });

    Opal.defn(self, '$eql?', def['$==']);

    Opal.defn(self, '$equal?', def['$==']);

    Opal.defn(self, '$instance_eval', TMP_2 = function() {
      var self = this, $iter = TMP_2.$$p, block = $iter || nil;

      TMP_2.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        $scope.get('Kernel').$raise($scope.get('ArgumentError'), "no block given")
      };
      
      var old = block.$$s,
          result;

      block.$$s = null;
      result = block.call(self, self);
      block.$$s = old;

      return result;
    
    });

    Opal.defn(self, '$instance_exec', TMP_3 = function(args) {
      var self = this, $iter = TMP_3.$$p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_3.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        $scope.get('Kernel').$raise($scope.get('ArgumentError'), "no block given")
      };
      
      var block_self = block.$$s,
          result;

      block.$$s = null;
      result = block.apply(self, args);
      block.$$s = block_self;

      return result;
    
    });

    return (Opal.defn(self, '$method_missing', TMP_4 = function(symbol, args) {
      var $a, self = this, $iter = TMP_4.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_4.$$p = null;
      return $scope.get('Kernel').$raise($scope.get('NoMethodError'), (function() {if ((($a = self.$inspect && !self.$inspect.$$stub) !== nil && (!$a.$$is_boolean || $a == true))) {
        return "undefined method `" + (symbol) + "' for " + (self.$inspect()) + ":" + (self.$$class)
        } else {
        return "undefined method `" + (symbol) + "' for " + (self.$$class)
      }; return nil; })());
    }), nil) && 'method_missing';
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/kernel"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $gvars = Opal.gvars;

  Opal.add_stubs(['$raise', '$inspect', '$==', '$class', '$new', '$respond_to?', '$to_ary', '$to_a', '$allocate', '$copy_instance_variables', '$initialize_clone', '$initialize_copy', '$singleton_class', '$initialize_dup', '$for', '$to_proc', '$append_features', '$extended', '$to_i', '$to_s', '$to_f', '$*', '$__id__', '$===', '$empty?', '$ArgumentError', '$nan?', '$infinite?', '$to_int', '$>', '$length', '$print', '$format', '$puts', '$each', '$<=', '$[]', '$nil?', '$is_a?', '$rand', '$coerce_to', '$respond_to_missing?', '$expand_path', '$join', '$start_with?']);
  return (function($base) {
    var self = $module($base, 'Kernel');

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_9;

    def.$method_missing = TMP_1 = function(symbol, args) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_1.$$p = null;
      return self.$raise($scope.get('NoMethodError'), "undefined method `" + (symbol) + "' for " + (self.$inspect()));
    };

    def['$=~'] = function(obj) {
      var self = this;

      return false;
    };

    def['$==='] = function(other) {
      var self = this;

      return self['$=='](other);
    };

    def['$<=>'] = function(other) {
      var self = this;

      
      if (self['$=='](other)) {
        return 0;
      }

      return nil;
    ;
    };

    def.$method = function(name) {
      var self = this;

      
      var meth = self['$' + name];

      if (!meth || meth.$$stub) {
        self.$raise($scope.get('NameError'), "undefined method `" + (name) + "' for class `" + (self.$class()) + "'");
      }

      return $scope.get('Method').$new(self, meth, name);
    
    };

    def.$methods = function(all) {
      var self = this;

      if (all == null) {
        all = true
      }
      
      var methods = [];

      for (var key in self) {
        if (key[0] == "$" && typeof(self[key]) === "function") {
          if (all == false || all === nil) {
            if (!Opal.hasOwnProperty.call(self, key)) {
              continue;
            }
          }
          if (self[key].$$stub === undefined) {
            methods.push(key.substr(1));
          }
        }
      }

      return methods;
    
    };

    def.$Array = TMP_2 = function(object, args) {
      var self = this, $iter = TMP_2.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_2.$$p = null;
      
      if (object == null || object === nil) {
        return [];
      }
      else if (object['$respond_to?']("to_ary")) {
        return object.$to_ary();
      }
      else if (object['$respond_to?']("to_a")) {
        return object.$to_a();
      }
      else {
        return [object];
      }
    ;
    };

    def.$caller = function() {
      var self = this;

      return [];
    };

    def.$class = function() {
      var self = this;

      return self.$$class;
    };

    def.$copy_instance_variables = function(other) {
      var self = this;

      
      for (var name in other) {
        if (name.charAt(0) !== '$') {
          self[name] = other[name];
        }
      }
    
    };

    def.$clone = function() {
      var self = this, copy = nil;

      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$initialize_clone(self);
      return copy;
    };

    def.$initialize_clone = function(other) {
      var self = this;

      return self.$initialize_copy(other);
    };

    def.$define_singleton_method = TMP_3 = function(name) {
      var self = this, $iter = TMP_3.$$p, body = $iter || nil;

      TMP_3.$$p = null;
      if (body !== false && body !== nil) {
        } else {
        self.$raise($scope.get('ArgumentError'), "tried to create Proc object without a block")
      };
      
      var jsid   = '$' + name;
      body.$$jsid = name;
      body.$$s    = null;
      body.$$def  = body;

      self.$singleton_class().$$proto[jsid] = body;

      return self;
    
    };

    def.$dup = function() {
      var self = this, copy = nil;

      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$initialize_dup(self);
      return copy;
    };

    def.$initialize_dup = function(other) {
      var self = this;

      return self.$initialize_copy(other);
    };

    def.$enum_for = TMP_4 = function(method, args) {
      var $a, $b, self = this, $iter = TMP_4.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      if (method == null) {
        method = "each"
      }
      TMP_4.$$p = null;
      return ($a = ($b = $scope.get('Enumerator')).$for, $a.$$p = block.$to_proc(), $a).apply($b, [self, method].concat(args));
    };

    Opal.defn(self, '$to_enum', def.$enum_for);

    def['$equal?'] = function(other) {
      var self = this;

      return self === other;
    };

    def.$extend = function(mods) {
      var self = this;

      mods = $slice.call(arguments, 0);
      
      var singleton = self.$singleton_class();

      for (var i = mods.length - 1; i >= 0; i--) {
        var mod = mods[i];

        (mod).$append_features(singleton);
        (mod).$extended(self);
      }
    ;
      return self;
    };

    def.$format = function(format, args) {
      var self = this;

      args = $slice.call(arguments, 1);
      
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
          width = (args[w_idx]).$to_i();
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
          prec = (args[p_idx]).$to_i();
        } else {
          prec = parseInt(prec_str, 10);
        }
        if (idx_str) {
          idx = parseInt(idx_str, 10) - 1;
        }
        switch (spec) {
        case 'c':
          obj = args[idx];
          if (obj.$$is_string) {
            str = obj.charAt(0);
          } else {
            str = String.fromCharCode((obj).$to_i());
          }
          break;
        case 's':
          str = (args[idx]).$to_s();
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'p':
          str = (args[idx]).$inspect();
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'd':
        case 'i':
        case 'u':
          str = (args[idx]).$to_i().toString();
          break;
        case 'b':
        case 'B':
          str = (args[idx]).$to_i().toString(2);
          break;
        case 'o':
          str = (args[idx]).$to_i().toString(8);
          break;
        case 'x':
        case 'X':
          str = (args[idx]).$to_i().toString(16);
          break;
        case 'e':
        case 'E':
          str = (args[idx]).$to_f().toExponential(prec);
          break;
        case 'f':
          str = (args[idx]).$to_f().toFixed(prec);
          break;
        case 'g':
        case 'G':
          str = (args[idx]).$to_f().toPrecision(prec);
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
            str = "0"['$*'](prec - str.length) + str;
          }
        }
        var total_len = prefix.length + str.length;
        if (width !== undefined && total_len < width) {
          if (flags.indexOf('-') != -1) {
            str = str + " "['$*'](width - total_len);
          } else {
            var pad_char = ' ';
            if (flags.indexOf('0') != -1) {
              str = "0"['$*'](width - total_len) + str;
            } else {
              prefix = " "['$*'](width - total_len) + prefix;
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

    def.$freeze = function() {
      var self = this;

      self.___frozen___ = true;
      return self;
    };

    def['$frozen?'] = function() {
      var $a, self = this;
      if (self.___frozen___ == null) self.___frozen___ = nil;

      return ((($a = self.___frozen___) !== false && $a !== nil) ? $a : false);
    };

    def.$hash = function() {
      var self = this;

      return [self.$$class.$$name,(self.$$class).$__id__(),self.$__id__()].join(':');
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return nil;
    };

    def.$inspect = function() {
      var self = this;

      return self.$to_s();
    };

    def['$instance_of?'] = function(klass) {
      var self = this;

      return self.$$class === klass;
    };

    def['$instance_variable_defined?'] = function(name) {
      var self = this;

      return Opal.hasOwnProperty.call(self, name.substr(1));
    };

    def.$instance_variable_get = function(name) {
      var self = this;

      
      var ivar = self[name.substr(1)];

      return ivar == null ? nil : ivar;
    
    };

    def.$instance_variable_set = function(name, value) {
      var self = this;

      return self[name.substr(1)] = value;
    };

    def.$instance_variables = function() {
      var self = this;

      
      var result = [];

      for (var name in self) {
        if (name.charAt(0) !== '$') {
          if (name !== '$$class' && name !== '$$id') {
            result.push('@' + name);
          }
        }
      }

      return result;
    
    };

    def.$Integer = function(value, base) {
      var $a, $b, self = this, $case = nil;

      if (base == null) {
        base = nil
      }
      if ((($a = $scope.get('String')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
        if ((($a = value['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('ArgumentError'), "invalid value for Integer: (empty string)")};
        return parseInt(value, ((($a = base) !== false && $a !== nil) ? $a : undefined));};
      if (base !== false && base !== nil) {
        self.$raise(self.$ArgumentError("base is only valid for String values"))};
      return (function() {$case = value;if ($scope.get('Integer')['$===']($case)) {return value}else if ($scope.get('Float')['$===']($case)) {if ((($a = ((($b = value['$nan?']()) !== false && $b !== nil) ? $b : value['$infinite?']())) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('FloatDomainError'), "unable to coerce " + (value) + " to Integer")};
      return value.$to_int();}else if ($scope.get('NilClass')['$===']($case)) {return self.$raise($scope.get('TypeError'), "can't convert nil into Integer")}else {if ((($a = value['$respond_to?']("to_int")) !== nil && (!$a.$$is_boolean || $a == true))) {
        return value.$to_int()
      } else if ((($a = value['$respond_to?']("to_i")) !== nil && (!$a.$$is_boolean || $a == true))) {
        return value.$to_i()
        } else {
        return self.$raise($scope.get('TypeError'), "can't convert " + (value.$class()) + " into Integer")
      }}})();
    };

    def.$Float = function(value) {
      var $a, self = this;

      if ((($a = $scope.get('String')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return parseFloat(value);
      } else if ((($a = value['$respond_to?']("to_f")) !== nil && (!$a.$$is_boolean || $a == true))) {
        return value.$to_f()
        } else {
        return self.$raise($scope.get('TypeError'), "can't convert " + (value.$class()) + " into Float")
      };
    };

    def['$is_a?'] = function(klass) {
      var self = this;

      return Opal.is_a(self, klass);
    };

    Opal.defn(self, '$kind_of?', def['$is_a?']);

    def.$lambda = TMP_5 = function() {
      var self = this, $iter = TMP_5.$$p, block = $iter || nil;

      TMP_5.$$p = null;
      block.$$is_lambda = true;
      return block;
    };

    def.$load = function(file) {
      var self = this;

      return Opal.load(Opal.normalize_loadable_path(file));
    };

    def.$loop = TMP_6 = function() {
      var self = this, $iter = TMP_6.$$p, block = $iter || nil;

      TMP_6.$$p = null;
      
      while (true) {
        if (block() === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$nil?'] = function() {
      var self = this;

      return false;
    };

    Opal.defn(self, '$object_id', def.$__id__);

    def.$printf = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      if (args.$length()['$>'](0)) {
        self.$print(($a = self).$format.apply($a, [].concat(args)))};
      return nil;
    };

    def.$private_methods = function() {
      var self = this;

      return [];
    };

    Opal.defn(self, '$private_instance_methods', def.$private_methods);

    def.$proc = TMP_7 = function() {
      var self = this, $iter = TMP_7.$$p, block = $iter || nil;

      TMP_7.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        self.$raise($scope.get('ArgumentError'), "tried to create Proc object without a block")
      };
      block.$$is_lambda = false;
      return block;
    };

    def.$puts = function(strs) {
      var $a, self = this;
      if ($gvars.stdout == null) $gvars.stdout = nil;

      strs = $slice.call(arguments, 0);
      return ($a = $gvars.stdout).$puts.apply($a, [].concat(strs));
    };

    def.$p = function(args) {
      var $a, $b, TMP_8, self = this;

      args = $slice.call(arguments, 0);
      ($a = ($b = args).$each, $a.$$p = (TMP_8 = function(obj){var self = TMP_8.$$s || this;
        if ($gvars.stdout == null) $gvars.stdout = nil;
if (obj == null) obj = nil;
      return $gvars.stdout.$puts(obj.$inspect())}, TMP_8.$$s = self, TMP_8), $a).call($b);
      if (args.$length()['$<='](1)) {
        return args['$[]'](0)
        } else {
        return args
      };
    };

    def.$print = function(strs) {
      var $a, self = this;
      if ($gvars.stdout == null) $gvars.stdout = nil;

      strs = $slice.call(arguments, 0);
      return ($a = $gvars.stdout).$print.apply($a, [].concat(strs));
    };

    def.$warn = function(strs) {
      var $a, $b, self = this;
      if ($gvars.VERBOSE == null) $gvars.VERBOSE = nil;
      if ($gvars.stderr == null) $gvars.stderr = nil;

      strs = $slice.call(arguments, 0);
      if ((($a = ((($b = $gvars.VERBOSE['$nil?']()) !== false && $b !== nil) ? $b : strs['$empty?']())) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil
        } else {
        return ($a = $gvars.stderr).$puts.apply($a, [].concat(strs))
      };
    };

    def.$raise = function(exception, string) {
      var self = this;
      if ($gvars["!"] == null) $gvars["!"] = nil;

      
      if (exception == null && $gvars["!"]) {
        exception = $gvars["!"];
      }
      else if (exception.$$is_string) {
        exception = $scope.get('RuntimeError').$new(exception);
      }
      else if (!exception['$is_a?']($scope.get('Exception'))) {
        exception = exception.$new(string);
      }

      $gvars["!"] = exception;
      throw exception;
    ;
    };

    Opal.defn(self, '$fail', def.$raise);

    def.$rand = function(max) {
      var self = this;

      
      if (max === undefined) {
        return Math.random();
      }
      else if (max.$$is_range) {
        var arr = max.$to_a();

        return arr[self.$rand(arr.length)];
      }
      else {
        return Math.floor(Math.random() *
          Math.abs($scope.get('Opal').$coerce_to(max, $scope.get('Integer'), "to_int")));
      }
    
    };

    def['$respond_to?'] = function(name, include_all) {
      var $a, self = this;

      if (include_all == null) {
        include_all = false
      }
      if ((($a = self['$respond_to_missing?'](name)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      
      var body = self['$' + name];

      if (typeof(body) === "function" && !body.$$stub) {
        return true;
      }
    
      return false;
    };

    def['$respond_to_missing?'] = function(method_name) {
      var self = this;

      return false;
    };

    def.$require = function(file) {
      var self = this;

      return Opal.require(Opal.normalize_loadable_path(file));
    };

    def.$require_relative = function(file) {
      var self = this;

      file = $scope.get('File').$expand_path($scope.get('File').$join(Opal.current_file, "..", file));
      return Opal.require(Opal.normalize_loadable_path(file));
    };

    def.$require_tree = function(path) {
      var self = this;

      path = $scope.get('File').$expand_path(path);
      
      for (var name in Opal.modules) {
        if ((name)['$start_with?'](path)) {
          Opal.require(name);
        }
      }
    ;
      return nil;
    };

    Opal.defn(self, '$send', def.$__send__);

    Opal.defn(self, '$public_send', def.$__send__);

    def.$singleton_class = function() {
      var self = this;

      return Opal.get_singleton_class(self);
    };

    Opal.defn(self, '$sprintf', def.$format);

    Opal.defn(self, '$srand', def.$rand);

    def.$String = function(str) {
      var self = this;

      return String(str);
    };

    def.$taint = function() {
      var self = this;

      return self;
    };

    def['$tainted?'] = function() {
      var self = this;

      return false;
    };

    def.$tap = TMP_9 = function() {
      var self = this, $iter = TMP_9.$$p, block = $iter || nil;

      TMP_9.$$p = null;
      if (Opal.yield1(block, self) === $breaker) return $breaker.$v;
      return self;
    };

    def.$to_proc = function() {
      var self = this;

      return self;
    };

    def.$to_s = function() {
      var self = this;

      return "#<" + (self.$class()) + ":0x" + (self.$__id__().$to_s(16)) + ">";
    };

    Opal.defn(self, '$untaint', def.$taint);
        ;Opal.donate(self, ["$method_missing", "$=~", "$===", "$<=>", "$method", "$methods", "$Array", "$caller", "$class", "$copy_instance_variables", "$clone", "$initialize_clone", "$define_singleton_method", "$dup", "$initialize_dup", "$enum_for", "$to_enum", "$equal?", "$extend", "$format", "$freeze", "$frozen?", "$hash", "$initialize_copy", "$inspect", "$instance_of?", "$instance_variable_defined?", "$instance_variable_get", "$instance_variable_set", "$instance_variables", "$Integer", "$Float", "$is_a?", "$kind_of?", "$lambda", "$load", "$loop", "$nil?", "$object_id", "$printf", "$private_methods", "$private_instance_methods", "$proc", "$puts", "$p", "$print", "$warn", "$raise", "$fail", "$rand", "$respond_to?", "$respond_to_missing?", "$require", "$require_relative", "$require_tree", "$send", "$public_send", "$singleton_class", "$sprintf", "$srand", "$String", "$taint", "$tainted?", "$tap", "$to_proc", "$to_s", "$untaint"]);
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/nil_class"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$raise']);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = self.$$proto, $scope = self.$$scope;

    def['$!'] = function() {
      var self = this;

      return true;
    };

    def['$&'] = function(other) {
      var self = this;

      return false;
    };

    def['$|'] = function(other) {
      var self = this;

      return other !== false && other !== nil;
    };

    def['$^'] = function(other) {
      var self = this;

      return other !== false && other !== nil;
    };

    def['$=='] = function(other) {
      var self = this;

      return other === nil;
    };

    def.$dup = function() {
      var self = this;

      return self.$raise($scope.get('TypeError'));
    };

    def.$inspect = function() {
      var self = this;

      return "nil";
    };

    def['$nil?'] = function() {
      var self = this;

      return true;
    };

    def.$singleton_class = function() {
      var self = this;

      return $scope.get('NilClass');
    };

    def.$to_a = function() {
      var self = this;

      return [];
    };

    def.$to_h = function() {
      var self = this;

      return Opal.hash();
    };

    def.$to_i = function() {
      var self = this;

      return 0;
    };

    Opal.defn(self, '$to_f', def.$to_i);

    return (def.$to_s = function() {
      var self = this;

      return "";
    }, nil) && 'to_s';
  })(self, null);
  return Opal.cdecl($scope, 'NIL', nil);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/boolean"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$undef_method']);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = self.$$proto, $scope = self.$$scope;

    def.$$is_boolean = true;

    (function(self) {
      var $scope = self.$$scope, def = self.$$proto;

      return self.$undef_method("new")
    })(self.$singleton_class());

    def['$!'] = function() {
      var self = this;

      return self != true;
    };

    def['$&'] = function(other) {
      var self = this;

      return (self == true) ? (other !== false && other !== nil) : false;
    };

    def['$|'] = function(other) {
      var self = this;

      return (self == true) ? true : (other !== false && other !== nil);
    };

    def['$^'] = function(other) {
      var self = this;

      return (self == true) ? (other === false || other === nil) : (other !== false && other !== nil);
    };

    def['$=='] = function(other) {
      var self = this;

      return (self == true) === other.valueOf();
    };

    Opal.defn(self, '$equal?', def['$==']);

    Opal.defn(self, '$singleton_class', def.$class);

    return (def.$to_s = function() {
      var self = this;

      return (self == true) ? 'true' : 'false';
    }, nil) && 'to_s';
  })(self, null);
  Opal.cdecl($scope, 'TrueClass', $scope.get('Boolean'));
  Opal.cdecl($scope, 'FalseClass', $scope.get('Boolean'));
  Opal.cdecl($scope, 'TRUE', true);
  return Opal.cdecl($scope, 'FALSE', false);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/error"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $module = Opal.module;

  Opal.add_stubs(['$attr_reader', '$class']);
  (function($base, $super) {
    function $Exception(){};
    var self = $Exception = $klass($base, $super, 'Exception', $Exception);

    var def = self.$$proto, $scope = self.$$scope;

    def.message = nil;
    self.$attr_reader("message");

    Opal.defs(self, '$new', function(message) {
      var self = this;

      if (message == null) {
        message = "Exception"
      }
      
      var err = new self.$$alloc(message);

      if (Error.captureStackTrace) {
        Error.captureStackTrace(err);
      }

      err.name = self.$$name;
      err.$initialize(message);
      return err;
    
    });

    def.$initialize = function(message) {
      var self = this;

      return self.message = message;
    };

    def.$backtrace = function() {
      var self = this;

      
      var backtrace = self.stack;

      if (typeof(backtrace) === 'string') {
        return backtrace.split("\n").slice(0, 15);
      }
      else if (backtrace) {
        return backtrace.slice(0, 15);
      }

      return [];
    
    };

    def.$inspect = function() {
      var self = this;

      return "#<" + (self.$class()) + ": '" + (self.message) + "'>";
    };

    return Opal.defn(self, '$to_s', def.$message);
  })(self, null);
  (function($base, $super) {
    function $ScriptError(){};
    var self = $ScriptError = $klass($base, $super, 'ScriptError', $ScriptError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('Exception'));
  (function($base, $super) {
    function $SyntaxError(){};
    var self = $SyntaxError = $klass($base, $super, 'SyntaxError', $SyntaxError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('ScriptError'));
  (function($base, $super) {
    function $LoadError(){};
    var self = $LoadError = $klass($base, $super, 'LoadError', $LoadError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('ScriptError'));
  (function($base, $super) {
    function $NotImplementedError(){};
    var self = $NotImplementedError = $klass($base, $super, 'NotImplementedError', $NotImplementedError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('ScriptError'));
  (function($base, $super) {
    function $SystemExit(){};
    var self = $SystemExit = $klass($base, $super, 'SystemExit', $SystemExit);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('Exception'));
  (function($base, $super) {
    function $StandardError(){};
    var self = $StandardError = $klass($base, $super, 'StandardError', $StandardError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('Exception'));
  (function($base, $super) {
    function $NameError(){};
    var self = $NameError = $klass($base, $super, 'NameError', $NameError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $NoMethodError(){};
    var self = $NoMethodError = $klass($base, $super, 'NoMethodError', $NoMethodError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('NameError'));
  (function($base, $super) {
    function $RuntimeError(){};
    var self = $RuntimeError = $klass($base, $super, 'RuntimeError', $RuntimeError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $LocalJumpError(){};
    var self = $LocalJumpError = $klass($base, $super, 'LocalJumpError', $LocalJumpError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $TypeError(){};
    var self = $TypeError = $klass($base, $super, 'TypeError', $TypeError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $ArgumentError(){};
    var self = $ArgumentError = $klass($base, $super, 'ArgumentError', $ArgumentError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $IndexError(){};
    var self = $IndexError = $klass($base, $super, 'IndexError', $IndexError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $StopIteration(){};
    var self = $StopIteration = $klass($base, $super, 'StopIteration', $StopIteration);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('IndexError'));
  (function($base, $super) {
    function $KeyError(){};
    var self = $KeyError = $klass($base, $super, 'KeyError', $KeyError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('IndexError'));
  (function($base, $super) {
    function $RangeError(){};
    var self = $RangeError = $klass($base, $super, 'RangeError', $RangeError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $FloatDomainError(){};
    var self = $FloatDomainError = $klass($base, $super, 'FloatDomainError', $FloatDomainError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('RangeError'));
  (function($base, $super) {
    function $IOError(){};
    var self = $IOError = $klass($base, $super, 'IOError', $IOError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  (function($base, $super) {
    function $SystemCallError(){};
    var self = $SystemCallError = $klass($base, $super, 'SystemCallError', $SystemCallError);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('StandardError'));
  return (function($base) {
    var self = $module($base, 'Errno');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $EINVAL(){};
      var self = $EINVAL = $klass($base, $super, 'EINVAL', $EINVAL);

      var def = self.$$proto, $scope = self.$$scope, TMP_1;

      return (Opal.defs(self, '$new', TMP_1 = function() {
        var self = this, $iter = TMP_1.$$p, $yield = $iter || nil;

        TMP_1.$$p = null;
        return Opal.find_super_dispatcher(self, 'new', TMP_1, null, $EINVAL).apply(self, ["Invalid argument"]);
      }), nil) && 'new'
    })(self, $scope.get('SystemCallError'))
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/regexp"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $gvars = Opal.gvars;

  Opal.add_stubs(['$nil?', '$[]', '$respond_to?', '$to_str', '$to_s', '$coerce_to', '$new', '$raise', '$class', '$call']);
  return (function($base, $super) {
    function $Regexp(){};
    var self = $Regexp = $klass($base, $super, 'Regexp', $Regexp);

    var def = self.$$proto, $scope = self.$$scope, TMP_1;

    def.$$is_regexp = true;

    (function(self) {
      var $scope = self.$$scope, def = self.$$proto;

      self.$$proto.$escape = function(string) {
        var self = this;

        
        return string.replace(/([-[\]/{}()*+?.^$\\| ])/g, '\\$1')
                     .replace(/[\n]/g, '\\n')
                     .replace(/[\r]/g, '\\r')
                     .replace(/[\f]/g, '\\f')
                     .replace(/[\t]/g, '\\t');
      
      };
      self.$$proto.$last_match = function(n) {
        var $a, self = this;
        if ($gvars["~"] == null) $gvars["~"] = nil;

        if (n == null) {
          n = nil
        }
        if ((($a = n['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return $gvars["~"]
          } else {
          return $gvars["~"]['$[]'](n)
        };
      };
      self.$$proto.$quote = self.$$proto.$escape;
      self.$$proto.$union = function(parts) {
        var self = this;

        parts = $slice.call(arguments, 0);
        return new RegExp(parts.join(''));
      };
      return (self.$$proto.$new = function(regexp, options) {
        var self = this;

        return new RegExp(regexp, options);
      }, nil) && 'new';
    })(self.$singleton_class());

    def['$=='] = function(other) {
      var self = this;

      return other.constructor == RegExp && self.toString() === other.toString();
    };

    def['$==='] = function(str) {
      var self = this;

      
      if (!str.$$is_string && str['$respond_to?']("to_str")) {
        str = str.$to_str();
      }

      if (!str.$$is_string) {
        return false;
      }

      return self.test(str);
    ;
    };

    def['$=~'] = function(string) {
      var $a, self = this;

      if ((($a = string === nil) !== nil && (!$a.$$is_boolean || $a == true))) {
        $gvars["~"] = nil;
        return nil;};
      string = $scope.get('Opal').$coerce_to(string, $scope.get('String'), "to_str").$to_s();
      
      var re = self;

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
        $gvars["~"] = $scope.get('MatchData').$new(re, result);

        return result.index;
      }
      else {
        $gvars["~"] = nil;
        return nil;
      }
    
    };

    Opal.defn(self, '$eql?', def['$==']);

    def.$inspect = function() {
      var self = this;

      return self.toString();
    };

    def.$match = TMP_1 = function(string, pos) {
      var $a, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      if ((($a = string === nil) !== nil && (!$a.$$is_boolean || $a == true))) {
        $gvars["~"] = nil;
        return nil;};
      if ((($a = string.$$is_string == null) !== nil && (!$a.$$is_boolean || $a == true))) {
        if ((($a = string['$respond_to?']("to_str")) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          self.$raise($scope.get('TypeError'), "no implicit conversion of " + (string.$class()) + " into String")
        };
        string = string.$to_str();};
      
      var re = self;

      if (re.global) {
        // should we clear it afterwards too?
        re.lastIndex = 0;
      }
      else {
        re = new RegExp(re.source, 'g' + (re.multiline ? 'm' : '') + (re.ignoreCase ? 'i' : ''));
      }

      var result = re.exec(string);

      if (result) {
        result = $gvars["~"] = $scope.get('MatchData').$new(re, result);

        if (block === nil) {
          return result;
        }
        else {
          return block.$call(result);
        }
      }
      else {
        return $gvars["~"] = nil;
      }
    
    };

    def.$source = function() {
      var self = this;

      return self.source;
    };

    return Opal.defn(self, '$to_s', def.$source);
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/comparable"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module;

  Opal.add_stubs(['$===', '$>', '$<', '$equal?', '$<=>', '$normalize', '$raise', '$class']);
  return (function($base) {
    var self = $module($base, 'Comparable');

    var def = self.$$proto, $scope = self.$$scope;

    Opal.defs(self, '$normalize', function(what) {
      var $a, self = this;

      if ((($a = $scope.get('Integer')['$==='](what)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return what};
      if (what['$>'](0)) {
        return 1};
      if (what['$<'](0)) {
        return -1};
      return 0;
    });

    def['$=='] = function(other) {
      var $a, self = this, cmp = nil;

      try {
      if ((($a = self['$equal?'](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return true};
        if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          return false
        };
        return $scope.get('Comparable').$normalize(cmp) == 0;
      } catch ($err) {if (Opal.rescue($err, [$scope.get('StandardError')])) {
        return false
        }else { throw $err; }
      };
    };

    def['$>'] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return $scope.get('Comparable').$normalize(cmp) > 0;
    };

    def['$>='] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return $scope.get('Comparable').$normalize(cmp) >= 0;
    };

    def['$<'] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return $scope.get('Comparable').$normalize(cmp) < 0;
    };

    def['$<='] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return $scope.get('Comparable').$normalize(cmp) <= 0;
    };

    def['$between?'] = function(min, max) {
      var self = this;

      if (self['$<'](min)) {
        return false};
      if (self['$>'](max)) {
        return false};
      return true;
    };
        ;Opal.donate(self, ["$==", "$>", "$>=", "$<", "$<=", "$between?"]);
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/enumerable"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module;

  Opal.add_stubs(['$raise', '$enum_for', '$flatten', '$map', '$==', '$destructure', '$nil?', '$coerce_to!', '$coerce_to', '$===', '$new', '$<<', '$[]', '$[]=', '$inspect', '$__send__', '$yield', '$enumerator_size', '$respond_to?', '$size', '$private', '$compare', '$<=>', '$dup', '$sort', '$call', '$first', '$zip', '$to_a']);
  return (function($base) {
    var self = $module($base, 'Enumerable');

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_15, TMP_16, TMP_17, TMP_18, TMP_19, TMP_20, TMP_22, TMP_23, TMP_24, TMP_25, TMP_26, TMP_27, TMP_28, TMP_29, TMP_30, TMP_31, TMP_32, TMP_33, TMP_35, TMP_36, TMP_40, TMP_41;

    def['$all?'] = TMP_1 = function() {
      var $a, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      
      var result = true;

      if (block !== nil) {
        self.$each.$$p = function() {
          var value = Opal.yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) === nil || ($a.$$is_boolean && $a == false))) {
            result = false;
            return $breaker;
          }
        }
      }
      else {
        self.$each.$$p = function(obj) {
          if (arguments.length == 1 && (($a = obj) === nil || ($a.$$is_boolean && $a == false))) {
            result = false;
            return $breaker;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def['$any?'] = TMP_2 = function() {
      var $a, self = this, $iter = TMP_2.$$p, block = $iter || nil;

      TMP_2.$$p = null;
      
      var result = false;

      if (block !== nil) {
        self.$each.$$p = function() {
          var value = Opal.yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            result = true;
            return $breaker;
          }
        };
      }
      else {
        self.$each.$$p = function(obj) {
          if (arguments.length != 1 || (($a = obj) !== nil && (!$a.$$is_boolean || $a == true))) {
            result = true;
            return $breaker;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def.$chunk = TMP_3 = function(state) {
      var self = this, $iter = TMP_3.$$p, block = $iter || nil;

      TMP_3.$$p = null;
      return self.$raise($scope.get('NotImplementedError'));
    };

    def.$collect = TMP_4 = function() {
      var self = this, $iter = TMP_4.$$p, block = $iter || nil;

      TMP_4.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect")
      };
      
      var result = [];

      self.$each.$$p = function() {
        var value = Opal.yieldX(block, arguments);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        result.push(value);
      };

      self.$each();

      return result;
    
    };

    def.$collect_concat = TMP_5 = function() {
      var $a, $b, TMP_6, self = this, $iter = TMP_5.$$p, block = $iter || nil;

      TMP_5.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect_concat")
      };
      return ($a = ($b = self).$map, $a.$$p = (TMP_6 = function(item){var self = TMP_6.$$s || this, $a;
if (item == null) item = nil;
      return $a = Opal.yield1(block, item), $a === $breaker ? $a : $a}, TMP_6.$$s = self, TMP_6), $a).call($b).$flatten(1);
    };

    def.$count = TMP_7 = function(object) {
      var $a, self = this, $iter = TMP_7.$$p, block = $iter || nil;

      TMP_7.$$p = null;
      
      var result = 0;

      if (object != null) {
        block = function() {
          return $scope.get('Opal').$destructure(arguments)['$=='](object);
        };
      }
      else if (block === nil) {
        block = function() { return true; };
      }

      self.$each.$$p = function() {
        var value = Opal.yieldX(block, arguments);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
          result++;
        }
      }

      self.$each();

      return result;
    
    };

    def.$cycle = TMP_8 = function(n) {
      var $a, self = this, $iter = TMP_8.$$p, block = $iter || nil;

      if (n == null) {
        n = nil
      }
      TMP_8.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("cycle", n)
      };
      if ((($a = n['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        n = $scope.get('Opal')['$coerce_to!'](n, $scope.get('Integer'), "to_int");
        if ((($a = n <= 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          return nil};
      };
      
      var result,
          all  = [];

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        all.push(param);
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }

      if (all.length === 0) {
        return nil;
      }
    
      if ((($a = n['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        
        while (true) {
          for (var i = 0, length = all.length; i < length; i++) {
            var value = Opal.yield1(block, all[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }
        }
      
        } else {
        
        while (n > 1) {
          for (var i = 0, length = all.length; i < length; i++) {
            var value = Opal.yield1(block, all[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }

          n--;
        }
      
      };
    };

    def.$detect = TMP_9 = function(ifnone) {
      var $a, self = this, $iter = TMP_9.$$p, block = $iter || nil;

      TMP_9.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("detect", ifnone)
      };
      
      var result = undefined;

      self.$each.$$p = function() {
        var params = $scope.get('Opal').$destructure(arguments),
            value  = Opal.yield1(block, params);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
          result = params;
          return $breaker;
        }
      };

      self.$each();

      if (result === undefined && ifnone !== undefined) {
        if (typeof(ifnone) === 'function') {
          result = ifnone();
        }
        else {
          result = ifnone;
        }
      }

      return result === undefined ? nil : result;
    
    };

    def.$drop = function(number) {
      var $a, self = this;

      number = $scope.get('Opal').$coerce_to(number, $scope.get('Integer'), "to_int");
      if ((($a = number < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "attempt to drop negative size")};
      
      var result  = [],
          current = 0;

      self.$each.$$p = function() {
        if (number <= current) {
          result.push($scope.get('Opal').$destructure(arguments));
        }

        current++;
      };

      self.$each()

      return result;
    
    };

    def.$drop_while = TMP_10 = function() {
      var $a, self = this, $iter = TMP_10.$$p, block = $iter || nil;

      TMP_10.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("drop_while")
      };
      
      var result   = [],
          dropping = true;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments);

        if (dropping) {
          var value = Opal.yield1(block, param);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) === nil || ($a.$$is_boolean && $a == false))) {
            dropping = false;
            result.push(param);
          }
        }
        else {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$each_cons = TMP_11 = function(n) {
      var self = this, $iter = TMP_11.$$p, block = $iter || nil;

      TMP_11.$$p = null;
      return self.$raise($scope.get('NotImplementedError'));
    };

    def.$each_entry = TMP_12 = function() {
      var self = this, $iter = TMP_12.$$p, block = $iter || nil;

      TMP_12.$$p = null;
      return self.$raise($scope.get('NotImplementedError'));
    };

    def.$each_slice = TMP_13 = function(n) {
      var $a, self = this, $iter = TMP_13.$$p, block = $iter || nil;

      TMP_13.$$p = null;
      n = $scope.get('Opal').$coerce_to(n, $scope.get('Integer'), "to_int");
      if ((($a = n <= 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "invalid slice size")};
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_slice", n)
      };
      
      var result,
          slice = []

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments);

        slice.push(param);

        if (slice.length === n) {
          if (Opal.yield1(block, slice) === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          slice = [];
        }
      };

      self.$each();

      if (result !== undefined) {
        return result;
      }

      // our "last" group, if smaller than n then won't have been yielded
      if (slice.length > 0) {
        if (Opal.yield1(block, slice) === $breaker) {
          return $breaker.$v;
        }
      }
    ;
      return nil;
    };

    def.$each_with_index = TMP_14 = function(args) {
      var $a, self = this, $iter = TMP_14.$$p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_14.$$p = null;
      if ((block !== nil)) {
        } else {
        return ($a = self).$enum_for.apply($a, ["each_with_index"].concat(args))
      };
      
      var result,
          index = 0;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = block(param, index);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        index++;
      };

      self.$each.apply(self, args);

      if (result !== undefined) {
        return result;
      }
    
      return self;
    };

    def.$each_with_object = TMP_15 = function(object) {
      var self = this, $iter = TMP_15.$$p, block = $iter || nil;

      TMP_15.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_with_object", object)
      };
      
      var result;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = block(param, object);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }
      };

      self.$each();

      if (result !== undefined) {
        return result;
      }
    
      return object;
    };

    def.$entries = function(args) {
      var self = this;

      args = $slice.call(arguments, 0);
      
      var result = [];

      self.$each.$$p = function() {
        result.push($scope.get('Opal').$destructure(arguments));
      };

      self.$each.apply(self, args);

      return result;
    
    };

    Opal.defn(self, '$find', def.$detect);

    def.$find_all = TMP_16 = function() {
      var $a, self = this, $iter = TMP_16.$$p, block = $iter || nil;

      TMP_16.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("find_all")
      };
      
      var result = [];

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$find_index = TMP_17 = function(object) {
      var $a, self = this, $iter = TMP_17.$$p, block = $iter || nil;

      TMP_17.$$p = null;
      if ((($a = object === undefined && block === nil) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.$enum_for("find_index")};
      
      var result = nil,
          index  = 0;

      if (object != null) {
        self.$each.$$p = function() {
          var param = $scope.get('Opal').$destructure(arguments);

          if ((param)['$=='](object)) {
            result = index;
            return $breaker;
          }

          index += 1;
        };
      }
      else if (block !== nil) {
        self.$each.$$p = function() {
          var value = Opal.yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            result = index;
            return $breaker;
          }

          index += 1;
        };
      }

      self.$each();

      return result;
    
    };

    def.$first = function(number) {
      var $a, self = this, result = nil;

      if ((($a = number === undefined) !== nil && (!$a.$$is_boolean || $a == true))) {
        result = nil;
        
        self.$each.$$p = function() {
          result = $scope.get('Opal').$destructure(arguments);

          return $breaker;
        };

        self.$each();
      ;
        } else {
        result = [];
        number = $scope.get('Opal').$coerce_to(number, $scope.get('Integer'), "to_int");
        if ((($a = number < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('ArgumentError'), "attempt to take negative size")};
        if ((($a = number == 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          return []};
        
        var current = 0,
            number  = $scope.get('Opal').$coerce_to(number, $scope.get('Integer'), "to_int");

        self.$each.$$p = function() {
          result.push($scope.get('Opal').$destructure(arguments));

          if (number <= ++current) {
            return $breaker;
          }
        };

        self.$each();
      ;
      };
      return result;
    };

    Opal.defn(self, '$flat_map', def.$collect_concat);

    def.$grep = TMP_18 = function(pattern) {
      var $a, self = this, $iter = TMP_18.$$p, block = $iter || nil;

      TMP_18.$$p = null;
      
      var result = [];

      if (block !== nil) {
        self.$each.$$p = function() {
          var param = $scope.get('Opal').$destructure(arguments),
              value = pattern['$==='](param);

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            value = Opal.yield1(block, param);

            if (value === $breaker) {
              result = $breaker.$v;
              return $breaker;
            }

            result.push(value);
          }
        };
      }
      else {
        self.$each.$$p = function() {
          var param = $scope.get('Opal').$destructure(arguments),
              value = pattern['$==='](param);

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            result.push(param);
          }
        };
      }

      self.$each();

      return result;
    ;
    };

    def.$group_by = TMP_19 = function() {
      var $a, $b, $c, self = this, $iter = TMP_19.$$p, block = $iter || nil, hash = nil;

      TMP_19.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("group_by")
      };
      hash = $scope.get('Hash').$new();
      
      var result;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        (($a = value, $b = hash, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, []))))['$<<'](param);
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }
    
      return hash;
    };

    def['$include?'] = function(obj) {
      var self = this;

      
      var result = false;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments);

        if ((param)['$=='](obj)) {
          result = true;
          return $breaker;
        }
      }

      self.$each();

      return result;
    
    };

    def.$inject = TMP_20 = function(object, sym) {
      var self = this, $iter = TMP_20.$$p, block = $iter || nil;

      TMP_20.$$p = null;
      
      var result = object;

      if (block !== nil && sym === undefined) {
        self.$each.$$p = function() {
          var value = $scope.get('Opal').$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          value = Opal.yieldX(block, [result, value]);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          result = value;
        };
      }
      else {
        if (sym === undefined) {
          if (!$scope.get('Symbol')['$==='](object)) {
            self.$raise($scope.get('TypeError'), "" + (object.$inspect()) + " is not a Symbol");
          }

          sym    = object;
          result = undefined;
        }

        self.$each.$$p = function() {
          var value = $scope.get('Opal').$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          result = (result).$__send__(sym, value);
        };
      }

      self.$each();

      return result == undefined ? nil : result;
    ;
    };

    def.$lazy = function() {
      var $a, $b, TMP_21, self = this;

      return ($a = ($b = (($scope.get('Enumerator')).$$scope.get('Lazy'))).$new, $a.$$p = (TMP_21 = function(enum$, args){var self = TMP_21.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
      return ($a = enum$).$yield.apply($a, [].concat(args))}, TMP_21.$$s = self, TMP_21), $a).call($b, self, self.$enumerator_size());
    };

    def.$enumerator_size = function() {
      var $a, self = this;

      if ((($a = self['$respond_to?']("size")) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.$size()
        } else {
        return nil
      };
    };

    self.$private("enumerator_size");

    Opal.defn(self, '$map', def.$collect);

    def.$max = TMP_22 = function() {
      var self = this, $iter = TMP_22.$$p, block = $iter || nil;

      TMP_22.$$p = null;
      
      var result;

      if (block !== nil) {
        self.$each.$$p = function() {
          var param = $scope.get('Opal').$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          var value = block(param, result);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (value === nil) {
            self.$raise($scope.get('ArgumentError'), "comparison failed");
          }

          if (value > 0) {
            result = param;
          }
        };
      }
      else {
        self.$each.$$p = function() {
          var param = $scope.get('Opal').$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          if ($scope.get('Opal').$compare(param, result) > 0) {
            result = param;
          }
        };
      }

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$max_by = TMP_23 = function() {
      var self = this, $iter = TMP_23.$$p, block = $iter || nil;

      TMP_23.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("max_by")
      };
      
      var result,
          by;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (result === undefined) {
          result = param;
          by     = value;
          return;
        }

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((value)['$<=>'](by) > 0) {
          result = param
          by     = value;
        }
      };

      self.$each();

      return result === undefined ? nil : result;
    
    };

    Opal.defn(self, '$member?', def['$include?']);

    def.$min = TMP_24 = function() {
      var self = this, $iter = TMP_24.$$p, block = $iter || nil;

      TMP_24.$$p = null;
      
      var result;

      if (block !== nil) {
        self.$each.$$p = function() {
          var param = $scope.get('Opal').$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          var value = block(param, result);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (value === nil) {
            self.$raise($scope.get('ArgumentError'), "comparison failed");
          }

          if (value < 0) {
            result = param;
          }
        };
      }
      else {
        self.$each.$$p = function() {
          var param = $scope.get('Opal').$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          if ($scope.get('Opal').$compare(param, result) < 0) {
            result = param;
          }
        };
      }

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$min_by = TMP_25 = function() {
      var self = this, $iter = TMP_25.$$p, block = $iter || nil;

      TMP_25.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("min_by")
      };
      
      var result,
          by;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (result === undefined) {
          result = param;
          by     = value;
          return;
        }

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((value)['$<=>'](by) < 0) {
          result = param
          by     = value;
        }
      };

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$minmax = TMP_26 = function() {
      var self = this, $iter = TMP_26.$$p, block = $iter || nil;

      TMP_26.$$p = null;
      return self.$raise($scope.get('NotImplementedError'));
    };

    def.$minmax_by = TMP_27 = function() {
      var self = this, $iter = TMP_27.$$p, block = $iter || nil;

      TMP_27.$$p = null;
      return self.$raise($scope.get('NotImplementedError'));
    };

    def['$none?'] = TMP_28 = function() {
      var $a, self = this, $iter = TMP_28.$$p, block = $iter || nil;

      TMP_28.$$p = null;
      
      var result = true;

      if (block !== nil) {
        self.$each.$$p = function() {
          var value = Opal.yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            result = false;
            return $breaker;
          }
        }
      }
      else {
        self.$each.$$p = function() {
          var value = $scope.get('Opal').$destructure(arguments);

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            result = false;
            return $breaker;
          }
        };
      }

      self.$each();

      return result;
    
    };

    def['$one?'] = TMP_29 = function() {
      var $a, self = this, $iter = TMP_29.$$p, block = $iter || nil;

      TMP_29.$$p = null;
      
      var result = false;

      if (block !== nil) {
        self.$each.$$p = function() {
          var value = Opal.yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            if (result === true) {
              result = false;
              return $breaker;
            }

            result = true;
          }
        }
      }
      else {
        self.$each.$$p = function() {
          var value = $scope.get('Opal').$destructure(arguments);

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            if (result === true) {
              result = false;
              return $breaker;
            }

            result = true;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def.$partition = TMP_30 = function() {
      var $a, self = this, $iter = TMP_30.$$p, block = $iter || nil;

      TMP_30.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("partition")
      };
      
      var truthy = [], falsy = [];

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
          truthy.push(param);
        }
        else {
          falsy.push(param);
        }
      };

      self.$each();

      return [truthy, falsy];
    
    };

    Opal.defn(self, '$reduce', def.$inject);

    def.$reject = TMP_31 = function() {
      var $a, self = this, $iter = TMP_31.$$p, block = $iter || nil;

      TMP_31.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reject")
      };
      
      var result = [];

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) === nil || ($a.$$is_boolean && $a == false))) {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$reverse_each = TMP_32 = function() {
      var self = this, $iter = TMP_32.$$p, block = $iter || nil;

      TMP_32.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reverse_each")
      };
      
      var result = [];

      self.$each.$$p = function() {
        result.push(arguments);
      };

      self.$each();

      for (var i = result.length - 1; i >= 0; i--) {
        Opal.yieldX(block, result[i]);
      }

      return result;
    
    };

    Opal.defn(self, '$select', def.$find_all);

    def.$slice_before = TMP_33 = function(pattern) {
      var $a, $b, TMP_34, self = this, $iter = TMP_33.$$p, block = $iter || nil;

      TMP_33.$$p = null;
      if ((($a = pattern === undefined && block === nil || arguments.length > 1) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "wrong number of arguments (" + (arguments.length) + " for 1)")};
      return ($a = ($b = $scope.get('Enumerator')).$new, $a.$$p = (TMP_34 = function(e){var self = TMP_34.$$s || this, $a;
if (e == null) e = nil;
      
        var slice = [];

        if (block !== nil) {
          if (pattern === undefined) {
            self.$each.$$p = function() {
              var param = $scope.get('Opal').$destructure(arguments),
                  value = Opal.yield1(block, param);

              if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true)) && slice.length > 0) {
                e['$<<'](slice);
                slice = [];
              }

              slice.push(param);
            };
          }
          else {
            self.$each.$$p = function() {
              var param = $scope.get('Opal').$destructure(arguments),
                  value = block(param, pattern.$dup());

              if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true)) && slice.length > 0) {
                e['$<<'](slice);
                slice = [];
              }

              slice.push(param);
            };
          }
        }
        else {
          self.$each.$$p = function() {
            var param = $scope.get('Opal').$destructure(arguments),
                value = pattern['$==='](param);

            if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true)) && slice.length > 0) {
              e['$<<'](slice);
              slice = [];
            }

            slice.push(param);
          };
        }

        self.$each();

        if (slice.length > 0) {
          e['$<<'](slice);
        }
      ;}, TMP_34.$$s = self, TMP_34), $a).call($b);
    };

    def.$sort = TMP_35 = function() {
      var self = this, $iter = TMP_35.$$p, block = $iter || nil;

      TMP_35.$$p = null;
      return self.$raise($scope.get('NotImplementedError'));
    };

    def.$sort_by = TMP_36 = function() {
      var $a, $b, TMP_37, $c, $d, TMP_38, $e, $f, TMP_39, self = this, $iter = TMP_36.$$p, block = $iter || nil;

      TMP_36.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("sort_by")
      };
      return ($a = ($b = ($c = ($d = ($e = ($f = self).$map, $e.$$p = (TMP_39 = function(){var self = TMP_39.$$s || this;

      arg = $scope.get('Opal').$destructure(arguments);
        return [block.$call(arg), arg];}, TMP_39.$$s = self, TMP_39), $e).call($f)).$sort, $c.$$p = (TMP_38 = function(a, b){var self = TMP_38.$$s || this;
if (a == null) a = nil;if (b == null) b = nil;
      return a['$[]'](0)['$<=>'](b['$[]'](0))}, TMP_38.$$s = self, TMP_38), $c).call($d)).$map, $a.$$p = (TMP_37 = function(arg){var self = TMP_37.$$s || this;
if (arg == null) arg = nil;
      return arg[1];}, TMP_37.$$s = self, TMP_37), $a).call($b);
    };

    def.$take = function(num) {
      var self = this;

      return self.$first(num);
    };

    def.$take_while = TMP_40 = function() {
      var $a, self = this, $iter = TMP_40.$$p, block = $iter || nil;

      TMP_40.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("take_while")
      };
      
      var result = [];

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = Opal.yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) === nil || ($a.$$is_boolean && $a == false))) {
          return $breaker;
        }

        result.push(param);
      };

      self.$each();

      return result;
    
    };

    Opal.defn(self, '$to_a', def.$entries);

    def.$zip = TMP_41 = function(others) {
      var $a, self = this, $iter = TMP_41.$$p, block = $iter || nil;

      others = $slice.call(arguments, 0);
      TMP_41.$$p = null;
      return ($a = self.$to_a()).$zip.apply($a, [].concat(others));
    };
        ;Opal.donate(self, ["$all?", "$any?", "$chunk", "$collect", "$collect_concat", "$count", "$cycle", "$detect", "$drop", "$drop_while", "$each_cons", "$each_entry", "$each_slice", "$each_with_index", "$each_with_object", "$entries", "$find", "$find_all", "$find_index", "$first", "$flat_map", "$grep", "$group_by", "$include?", "$inject", "$lazy", "$enumerator_size", "$map", "$max", "$max_by", "$member?", "$min", "$min_by", "$minmax", "$minmax_by", "$none?", "$one?", "$partition", "$reduce", "$reject", "$reverse_each", "$select", "$slice_before", "$sort", "$sort_by", "$take", "$take_while", "$to_a", "$zip"]);
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/enumerator"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$include', '$allocate', '$new', '$to_proc', '$coerce_to', '$nil?', '$empty?', '$+', '$class', '$__send__', '$===', '$call', '$enum_for', '$destructure', '$inspect', '$[]', '$raise', '$yield', '$each', '$enumerator_size', '$respond_to?', '$try_convert', '$<', '$for']);
  self.$require("corelib/enumerable");
  return (function($base, $super) {
    function $Enumerator(){};
    var self = $Enumerator = $klass($base, $super, 'Enumerator', $Enumerator);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4;

    def.size = def.args = def.object = def.method = nil;
    self.$include($scope.get('Enumerable'));

    Opal.defs(self, '$for', TMP_1 = function(object, method, args) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      args = $slice.call(arguments, 2);
      if (method == null) {
        method = "each"
      }
      TMP_1.$$p = null;
      
      var obj = self.$allocate();

      obj.object = object;
      obj.size   = block;
      obj.method = method;
      obj.args   = args;

      return obj;
    ;
    });

    def.$initialize = TMP_2 = function() {
      var $a, $b, self = this, $iter = TMP_2.$$p, block = $iter || nil;

      TMP_2.$$p = null;
      if (block !== false && block !== nil) {
        self.object = ($a = ($b = $scope.get('Generator')).$new, $a.$$p = block.$to_proc(), $a).call($b);
        self.method = "each";
        self.args = [];
        self.size = arguments[0] || nil;
        if ((($a = self.size) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.size = $scope.get('Opal').$coerce_to(self.size, $scope.get('Integer'), "to_int")
          } else {
          return nil
        };
        } else {
        self.object = arguments[0];
        self.method = arguments[1] || "each";
        self.args = $slice.call(arguments, 2);
        return self.size = nil;
      };
    };

    def.$each = TMP_3 = function(args) {
      var $a, $b, $c, self = this, $iter = TMP_3.$$p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_3.$$p = null;
      if ((($a = ($b = block['$nil?'](), $b !== false && $b !== nil ?args['$empty?']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self};
      args = self.args['$+'](args);
      if ((($a = block['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        return ($a = self.$class()).$new.apply($a, [self.object, self.method].concat(args))};
      return ($b = ($c = self.object).$__send__, $b.$$p = block.$to_proc(), $b).apply($c, [self.method].concat(args));
    };

    def.$size = function() {
      var $a, self = this;

      if ((($a = $scope.get('Proc')['$==='](self.size)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return ($a = self.size).$call.apply($a, [].concat(self.args))
        } else {
        return self.size
      };
    };

    def.$with_index = TMP_4 = function(offset) {
      var self = this, $iter = TMP_4.$$p, block = $iter || nil;

      if (offset == null) {
        offset = 0
      }
      TMP_4.$$p = null;
      if (offset !== false && offset !== nil) {
        offset = $scope.get('Opal').$coerce_to(offset, $scope.get('Integer'), "to_int")
        } else {
        offset = 0
      };
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("with_index", offset)
      };
      
      var result, index = 0;

      self.$each.$$p = function() {
        var param = $scope.get('Opal').$destructure(arguments),
            value = block(param, index);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        index++;
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }

      return nil;
    
    };

    Opal.defn(self, '$with_object', def.$each_with_object);

    def.$inspect = function() {
      var $a, self = this, result = nil;

      result = "#<" + (self.$class()) + ": " + (self.object.$inspect()) + ":" + (self.method);
      if ((($a = self.args['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        result = result['$+']("(" + (self.args.$inspect()['$[]']($scope.get('Range').$new(1, -2))) + ")")
      };
      return result['$+'](">");
    };

    (function($base, $super) {
      function $Generator(){};
      var self = $Generator = $klass($base, $super, 'Generator', $Generator);

      var def = self.$$proto, $scope = self.$$scope, TMP_5, TMP_6;

      def.block = nil;
      self.$include($scope.get('Enumerable'));

      def.$initialize = TMP_5 = function() {
        var self = this, $iter = TMP_5.$$p, block = $iter || nil;

        TMP_5.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('LocalJumpError'), "no block given")
        };
        return self.block = block;
      };

      return (def.$each = TMP_6 = function(args) {
        var $a, $b, self = this, $iter = TMP_6.$$p, block = $iter || nil, yielder = nil;

        args = $slice.call(arguments, 0);
        TMP_6.$$p = null;
        yielder = ($a = ($b = $scope.get('Yielder')).$new, $a.$$p = block.$to_proc(), $a).call($b);
        
        try {
          args.unshift(yielder);

          if (Opal.yieldX(self.block, args) === $breaker) {
            return $breaker.$v;
          }
        }
        catch (e) {
          if (e === $breaker) {
            return $breaker.$v;
          }
          else {
            throw e;
          }
        }
      ;
        return self;
      }, nil) && 'each';
    })(self, null);

    (function($base, $super) {
      function $Yielder(){};
      var self = $Yielder = $klass($base, $super, 'Yielder', $Yielder);

      var def = self.$$proto, $scope = self.$$scope, TMP_7;

      def.block = nil;
      def.$initialize = TMP_7 = function() {
        var self = this, $iter = TMP_7.$$p, block = $iter || nil;

        TMP_7.$$p = null;
        return self.block = block;
      };

      def.$yield = function(values) {
        var self = this;

        values = $slice.call(arguments, 0);
        
        var value = Opal.yieldX(self.block, values);

        if (value === $breaker) {
          throw $breaker;
        }

        return value;
      ;
      };

      return (def['$<<'] = function(values) {
        var $a, self = this;

        values = $slice.call(arguments, 0);
        ($a = self).$yield.apply($a, [].concat(values));
        return self;
      }, nil) && '<<';
    })(self, null);

    return (function($base, $super) {
      function $Lazy(){};
      var self = $Lazy = $klass($base, $super, 'Lazy', $Lazy);

      var def = self.$$proto, $scope = self.$$scope, TMP_8, TMP_11, TMP_13, TMP_18, TMP_20, TMP_21, TMP_23, TMP_26, TMP_29;

      def.enumerator = nil;
      (function($base, $super) {
        function $StopLazyError(){};
        var self = $StopLazyError = $klass($base, $super, 'StopLazyError', $StopLazyError);

        var def = self.$$proto, $scope = self.$$scope;

        return nil;
      })(self, $scope.get('Exception'));

      def.$initialize = TMP_8 = function(object, size) {
        var TMP_9, self = this, $iter = TMP_8.$$p, block = $iter || nil;

        if (size == null) {
          size = nil
        }
        TMP_8.$$p = null;
        if ((block !== nil)) {
          } else {
          self.$raise($scope.get('ArgumentError'), "tried to call lazy new without a block")
        };
        self.enumerator = object;
        return Opal.find_super_dispatcher(self, 'initialize', TMP_8, (TMP_9 = function(yielder, each_args){var self = TMP_9.$$s || this, $a, $b, TMP_10;
if (yielder == null) yielder = nil;each_args = $slice.call(arguments, 1);
        try {
          return ($a = ($b = object).$each, $a.$$p = (TMP_10 = function(args){var self = TMP_10.$$s || this;
args = $slice.call(arguments, 0);
            
              args.unshift(yielder);

              if (Opal.yieldX(block, args) === $breaker) {
                return $breaker;
              }
            ;}, TMP_10.$$s = self, TMP_10), $a).apply($b, [].concat(each_args))
          } catch ($err) {if (Opal.rescue($err, [$scope.get('Exception')])) {
            return nil
            }else { throw $err; }
          }}, TMP_9.$$s = self, TMP_9)).apply(self, [size]);
      };

      Opal.defn(self, '$force', def.$to_a);

      def.$lazy = function() {
        var self = this;

        return self;
      };

      def.$collect = TMP_11 = function() {
        var $a, $b, TMP_12, self = this, $iter = TMP_11.$$p, block = $iter || nil;

        TMP_11.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "tried to call lazy map without a block")
        };
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_12 = function(enum$, args){var self = TMP_12.$$s || this;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = Opal.yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          enum$.$yield(value);
        }, TMP_12.$$s = self, TMP_12), $a).call($b, self, self.$enumerator_size());
      };

      def.$collect_concat = TMP_13 = function() {
        var $a, $b, TMP_14, self = this, $iter = TMP_13.$$p, block = $iter || nil;

        TMP_13.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "tried to call lazy map without a block")
        };
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_14 = function(enum$, args){var self = TMP_14.$$s || this, $a, $b, TMP_15, $c, TMP_16;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = Opal.yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((value)['$respond_to?']("force") && (value)['$respond_to?']("each")) {
            ($a = ($b = (value)).$each, $a.$$p = (TMP_15 = function(v){var self = TMP_15.$$s || this;
if (v == null) v = nil;
          return enum$.$yield(v)}, TMP_15.$$s = self, TMP_15), $a).call($b)
          }
          else {
            var array = $scope.get('Opal').$try_convert(value, $scope.get('Array'), "to_ary");

            if (array === nil) {
              enum$.$yield(value);
            }
            else {
              ($a = ($c = (value)).$each, $a.$$p = (TMP_16 = function(v){var self = TMP_16.$$s || this;
if (v == null) v = nil;
          return enum$.$yield(v)}, TMP_16.$$s = self, TMP_16), $a).call($c);
            }
          }
        ;}, TMP_14.$$s = self, TMP_14), $a).call($b, self, nil);
      };

      def.$drop = function(n) {
        var $a, $b, TMP_17, self = this, current_size = nil, set_size = nil, dropped = nil;

        n = $scope.get('Opal').$coerce_to(n, $scope.get('Integer'), "to_int");
        if (n['$<'](0)) {
          self.$raise($scope.get('ArgumentError'), "attempt to drop negative size")};
        current_size = self.$enumerator_size();
        set_size = (function() {if ((($a = $scope.get('Integer')['$==='](current_size)) !== nil && (!$a.$$is_boolean || $a == true))) {
          if (n['$<'](current_size)) {
            return n
            } else {
            return current_size
          }
          } else {
          return current_size
        }; return nil; })();
        dropped = 0;
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_17 = function(enum$, args){var self = TMP_17.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (dropped['$<'](n)) {
            return dropped = dropped['$+'](1)
            } else {
            return ($a = enum$).$yield.apply($a, [].concat(args))
          }}, TMP_17.$$s = self, TMP_17), $a).call($b, self, set_size);
      };

      def.$drop_while = TMP_18 = function() {
        var $a, $b, TMP_19, self = this, $iter = TMP_18.$$p, block = $iter || nil, succeeding = nil;

        TMP_18.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "tried to call lazy drop_while without a block")
        };
        succeeding = true;
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_19 = function(enum$, args){var self = TMP_19.$$s || this, $a, $b;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (succeeding !== false && succeeding !== nil) {
            
            var value = Opal.yieldX(block, args);

            if (value === $breaker) {
              return $breaker;
            }

            if ((($a = value) === nil || ($a.$$is_boolean && $a == false))) {
              succeeding = false;

              ($a = enum$).$yield.apply($a, [].concat(args));
            }
          
            } else {
            return ($b = enum$).$yield.apply($b, [].concat(args))
          }}, TMP_19.$$s = self, TMP_19), $a).call($b, self, nil);
      };

      def.$enum_for = TMP_20 = function(method, args) {
        var $a, $b, self = this, $iter = TMP_20.$$p, block = $iter || nil;

        args = $slice.call(arguments, 1);
        if (method == null) {
          method = "each"
        }
        TMP_20.$$p = null;
        return ($a = ($b = self.$class()).$for, $a.$$p = block.$to_proc(), $a).apply($b, [self, method].concat(args));
      };

      def.$find_all = TMP_21 = function() {
        var $a, $b, TMP_22, self = this, $iter = TMP_21.$$p, block = $iter || nil;

        TMP_21.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "tried to call lazy select without a block")
        };
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_22 = function(enum$, args){var self = TMP_22.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = Opal.yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
        ;}, TMP_22.$$s = self, TMP_22), $a).call($b, self, nil);
      };

      Opal.defn(self, '$flat_map', def.$collect_concat);

      def.$grep = TMP_23 = function(pattern) {
        var $a, $b, TMP_24, $c, TMP_25, self = this, $iter = TMP_23.$$p, block = $iter || nil;

        TMP_23.$$p = null;
        if (block !== false && block !== nil) {
          return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_24 = function(enum$, args){var self = TMP_24.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
          
            var param = $scope.get('Opal').$destructure(args),
                value = pattern['$==='](param);

            if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
              value = Opal.yield1(block, param);

              if (value === $breaker) {
                return $breaker;
              }

              enum$.$yield(Opal.yield1(block, param));
            }
          ;}, TMP_24.$$s = self, TMP_24), $a).call($b, self, nil)
          } else {
          return ($a = ($c = $scope.get('Lazy')).$new, $a.$$p = (TMP_25 = function(enum$, args){var self = TMP_25.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
          
            var param = $scope.get('Opal').$destructure(args),
                value = pattern['$==='](param);

            if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
              enum$.$yield(param);
            }
          ;}, TMP_25.$$s = self, TMP_25), $a).call($c, self, nil)
        };
      };

      Opal.defn(self, '$map', def.$collect);

      Opal.defn(self, '$select', def.$find_all);

      def.$reject = TMP_26 = function() {
        var $a, $b, TMP_27, self = this, $iter = TMP_26.$$p, block = $iter || nil;

        TMP_26.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "tried to call lazy reject without a block")
        };
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_27 = function(enum$, args){var self = TMP_27.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = Opal.yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((($a = value) === nil || ($a.$$is_boolean && $a == false))) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
        ;}, TMP_27.$$s = self, TMP_27), $a).call($b, self, nil);
      };

      def.$take = function(n) {
        var $a, $b, TMP_28, self = this, current_size = nil, set_size = nil, taken = nil;

        n = $scope.get('Opal').$coerce_to(n, $scope.get('Integer'), "to_int");
        if (n['$<'](0)) {
          self.$raise($scope.get('ArgumentError'), "attempt to take negative size")};
        current_size = self.$enumerator_size();
        set_size = (function() {if ((($a = $scope.get('Integer')['$==='](current_size)) !== nil && (!$a.$$is_boolean || $a == true))) {
          if (n['$<'](current_size)) {
            return n
            } else {
            return current_size
          }
          } else {
          return current_size
        }; return nil; })();
        taken = 0;
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_28 = function(enum$, args){var self = TMP_28.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (taken['$<'](n)) {
            ($a = enum$).$yield.apply($a, [].concat(args));
            return taken = taken['$+'](1);
            } else {
            return self.$raise($scope.get('StopLazyError'))
          }}, TMP_28.$$s = self, TMP_28), $a).call($b, self, set_size);
      };

      def.$take_while = TMP_29 = function() {
        var $a, $b, TMP_30, self = this, $iter = TMP_29.$$p, block = $iter || nil;

        TMP_29.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "tried to call lazy take_while without a block")
        };
        return ($a = ($b = $scope.get('Lazy')).$new, $a.$$p = (TMP_30 = function(enum$, args){var self = TMP_30.$$s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = Opal.yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a.$$is_boolean || $a == true))) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
          else {
            self.$raise($scope.get('StopLazyError'));
          }
        ;}, TMP_30.$$s = self, TMP_30), $a).call($b, self, nil);
      };

      Opal.defn(self, '$to_enum', def.$enum_for);

      return (def.$inspect = function() {
        var self = this;

        return "#<" + (self.$class()) + ": " + (self.enumerator.$inspect()) + ">";
      }, nil) && 'inspect';
    })(self, self);
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/array"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $gvars = Opal.gvars, $range = Opal.range;

  Opal.add_stubs(['$require', '$include', '$new', '$class', '$raise', '$===', '$to_a', '$respond_to?', '$to_ary', '$coerce_to', '$coerce_to?', '$==', '$to_str', '$clone', '$hash', '$<=>', '$inspect', '$empty?', '$enum_for', '$nil?', '$coerce_to!', '$initialize_clone', '$initialize_dup', '$replace', '$eql?', '$length', '$begin', '$end', '$exclude_end?', '$flatten', '$__id__', '$[]', '$to_s', '$join', '$delete_if', '$to_proc', '$each', '$reverse', '$!', '$map', '$rand', '$keep_if', '$shuffle!', '$>', '$<', '$sort', '$times', '$[]=', '$<<', '$at']);
  self.$require("corelib/enumerable");
  return (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_15, TMP_17, TMP_18, TMP_19, TMP_20, TMP_21, TMP_24;

    def.length = nil;
    self.$include($scope.get('Enumerable'));

    def.$$is_array = true;

    Opal.defs(self, '$[]', function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      return objects;
    });

    def.$initialize = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      return ($a = self.$class()).$new.apply($a, [].concat(args));
    };

    Opal.defs(self, '$new', TMP_1 = function(size, obj) {
      var $a, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      if (size == null) {
        size = nil
      }
      if (obj == null) {
        obj = nil
      }
      TMP_1.$$p = null;
      if ((($a = arguments.length > 2) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "wrong number of arguments (" + (arguments.length) + " for 0..2)")};
      if ((($a = arguments.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        return []};
      if ((($a = arguments.length === 1) !== nil && (!$a.$$is_boolean || $a == true))) {
        if ((($a = $scope.get('Array')['$==='](size)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return size.$to_a()
        } else if ((($a = size['$respond_to?']("to_ary")) !== nil && (!$a.$$is_boolean || $a == true))) {
          return size.$to_ary()}};
      size = $scope.get('Opal').$coerce_to(size, $scope.get('Integer'), "to_int");
      if ((($a = size < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "negative array size")};
      
      var result = [];

      if (block === nil) {
        for (var i = 0; i < size; i++) {
          result.push(obj);
        }
      }
      else {
        for (var i = 0, value; i < size; i++) {
          value = block(i);

          if (value === $breaker) {
            return $breaker.$v;
          }

          result[i] = value;
        }
      }

      return result;
    
    });

    Opal.defs(self, '$try_convert', function(obj) {
      var self = this;

      return $scope.get('Opal')['$coerce_to?'](obj, $scope.get('Array'), "to_ary");
    });

    def['$&'] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = $scope.get('Opal').$coerce_to(other, $scope.get('Array'), "to_ary").$to_a()
      };
      
      var result = [],
          seen   = {};

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if (!seen[item]) {
          for (var j = 0, length2 = other.length; j < length2; j++) {
            var item2 = other[j];

            if (!seen[item2] && (item)['$=='](item2)) {
              seen[item] = true;
              result.push(item);
            }
          }
        }
      }

      return result;
    
    };

    def['$|'] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = $scope.get('Opal').$coerce_to(other, $scope.get('Array'), "to_ary").$to_a()
      };
      
      var result = [],
          seen   = {};

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if (!seen[item]) {
          seen[item] = true;
          result.push(item);
        }
      }

      for (var i = 0, length = other.length; i < length; i++) {
        var item = other[i];

        if (!seen[item]) {
          seen[item] = true;
          result.push(item);
        }
      }
      return result;
    
    };

    def['$*'] = function(other) {
      var $a, self = this;

      if ((($a = other['$respond_to?']("to_str")) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.join(other.$to_str())};
      if ((($a = other['$respond_to?']("to_int")) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('TypeError'), "no implicit conversion of " + (other.$class()) + " into Integer")
      };
      other = $scope.get('Opal').$coerce_to(other, $scope.get('Integer'), "to_int");
      if ((($a = other < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "negative argument")};
      
      var result = [];

      for (var i = 0; i < other; i++) {
        result = result.concat(self);
      }

      return result;
    
    };

    def['$+'] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = $scope.get('Opal').$coerce_to(other, $scope.get('Array'), "to_ary").$to_a()
      };
      return self.concat(other);
    };

    def['$-'] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = $scope.get('Opal').$coerce_to(other, $scope.get('Array'), "to_ary").$to_a()
      };
      if ((($a = self.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        return []};
      if ((($a = other.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.$clone()};
      
      var seen   = {},
          result = [];

      for (var i = 0, length = other.length; i < length; i++) {
        seen[other[i]] = true;
      }

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if (!seen[item]) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$<<'] = function(object) {
      var self = this;

      self.push(object);
      return self;
    };

    def['$<=>'] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_a()
      } else if ((($a = other['$respond_to?']("to_ary")) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_ary().$to_a()
        } else {
        return nil
      };
      
      if (self.$hash() === other.$hash()) {
        return 0;
      }

      if (self.length != other.length) {
        return (self.length > other.length) ? 1 : -1;
      }

      for (var i = 0, length = self.length; i < length; i++) {
        var tmp = (self[i])['$<=>'](other[i]);

        if (tmp !== 0) {
          return tmp;
        }
      }

      return 0;
    ;
    };

    def['$=='] = function(other) {
      var $a, self = this;

      if ((($a = self === other) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        if ((($a = other['$respond_to?']("to_ary")) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          return false
        };
        return other['$=='](self);
      };
      other = other.$to_a();
      if ((($a = self.length === other.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return false
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var a = self[i],
            b = other[i];

        if (a.$$is_array && b.$$is_array && (a === self)) {
          continue;
        }

        if (!(a)['$=='](b)) {
          return false;
        }
      }
    
      return true;
    };

    def['$[]'] = function(index, length) {
      var $a, self = this;

      if ((($a = $scope.get('Range')['$==='](index)) !== nil && (!$a.$$is_boolean || $a == true))) {
        
        var size    = self.length,
            exclude = index.exclude,
            from    = $scope.get('Opal').$coerce_to(index.begin, $scope.get('Integer'), "to_int"),
            to      = $scope.get('Opal').$coerce_to(index.end, $scope.get('Integer'), "to_int");

        if (from < 0) {
          from += size;

          if (from < 0) {
            return nil;
          }
        }

        if (from > size) {
          return nil;
        }

        if (to < 0) {
          to += size;

          if (to < 0) {
            return [];
          }
        }

        if (!exclude) {
          to += 1;
        }

        return self.slice(from, to);
      ;
        } else {
        index = $scope.get('Opal').$coerce_to(index, $scope.get('Integer'), "to_int");
        
        var size = self.length;

        if (index < 0) {
          index += size;

          if (index < 0) {
            return nil;
          }
        }

        if (length === undefined) {
          if (index >= size || index < 0) {
            return nil;
          }

          return self[index];
        }
        else {
          length = $scope.get('Opal').$coerce_to(length, $scope.get('Integer'), "to_int");

          if (length < 0 || index > size || index < 0) {
            return nil;
          }

          return self.slice(index, index + length);
        }
      
      };
    };

    def['$[]='] = function(index, value, extra) {
      var $a, self = this, data = nil, length = nil;

      if ((($a = $scope.get('Range')['$==='](index)) !== nil && (!$a.$$is_boolean || $a == true))) {
        if ((($a = $scope.get('Array')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
          data = value.$to_a()
        } else if ((($a = value['$respond_to?']("to_ary")) !== nil && (!$a.$$is_boolean || $a == true))) {
          data = value.$to_ary().$to_a()
          } else {
          data = [value]
        };
        
        var size    = self.length,
            exclude = index.exclude,
            from    = $scope.get('Opal').$coerce_to(index.begin, $scope.get('Integer'), "to_int"),
            to      = $scope.get('Opal').$coerce_to(index.end, $scope.get('Integer'), "to_int");

        if (from < 0) {
          from += size;

          if (from < 0) {
            self.$raise($scope.get('RangeError'), "" + (index.$inspect()) + " out of range");
          }
        }

        if (to < 0) {
          to += size;
        }

        if (!exclude) {
          to += 1;
        }

        if (from > size) {
          for (var i = size; i < from; i++) {
            self[i] = nil;
          }
        }

        if (to < 0) {
          self.splice.apply(self, [from, 0].concat(data));
        }
        else {
          self.splice.apply(self, [from, to - from].concat(data));
        }

        return value;
      ;
        } else {
        if ((($a = extra === undefined) !== nil && (!$a.$$is_boolean || $a == true))) {
          length = 1
          } else {
          length = value;
          value = extra;
          if ((($a = $scope.get('Array')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
            data = value.$to_a()
          } else if ((($a = value['$respond_to?']("to_ary")) !== nil && (!$a.$$is_boolean || $a == true))) {
            data = value.$to_ary().$to_a()
            } else {
            data = [value]
          };
        };
        
        var size   = self.length,
            index  = $scope.get('Opal').$coerce_to(index, $scope.get('Integer'), "to_int"),
            length = $scope.get('Opal').$coerce_to(length, $scope.get('Integer'), "to_int"),
            old;

        if (index < 0) {
          old    = index;
          index += size;

          if (index < 0) {
            self.$raise($scope.get('IndexError'), "index " + (old) + " too small for array; minimum " + (-self.length));
          }
        }

        if (length < 0) {
          self.$raise($scope.get('IndexError'), "negative length (" + (length) + ")")
        }

        if (index > size) {
          for (var i = size; i < index; i++) {
            self[i] = nil;
          }
        }

        if (extra === undefined) {
          self[index] = value;
        }
        else {
          self.splice.apply(self, [index, length].concat(data));
        }

        return value;
      ;
      };
    };

    def.$assoc = function(object) {
      var self = this;

      
      for (var i = 0, length = self.length, item; i < length; i++) {
        if (item = self[i], item.length && (item[0])['$=='](object)) {
          return item;
        }
      }

      return nil;
    
    };

    def.$at = function(index) {
      var self = this;

      index = $scope.get('Opal').$coerce_to(index, $scope.get('Integer'), "to_int");
      
      if (index < 0) {
        index += self.length;
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      return self[index];
    
    };

    def.$cycle = TMP_2 = function(n) {
      var $a, $b, self = this, $iter = TMP_2.$$p, block = $iter || nil;

      if (n == null) {
        n = nil
      }
      TMP_2.$$p = null;
      if ((($a = ((($b = self['$empty?']()) !== false && $b !== nil) ? $b : n['$=='](0))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil};
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("cycle", n)
      };
      if ((($a = n['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        
        while (true) {
          for (var i = 0, length = self.length; i < length; i++) {
            var value = Opal.yield1(block, self[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }
        }
      
        } else {
        n = $scope.get('Opal')['$coerce_to!'](n, $scope.get('Integer'), "to_int");
        
        if (n <= 0) {
          return self;
        }

        while (n > 0) {
          for (var i = 0, length = self.length; i < length; i++) {
            var value = Opal.yield1(block, self[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }

          n--;
        }
      
      };
      return self;
    };

    def.$clear = function() {
      var self = this;

      self.splice(0, self.length);
      return self;
    };

    def.$clone = function() {
      var self = this, copy = nil;

      copy = [];
      copy.$initialize_clone(self);
      return copy;
    };

    def.$dup = function() {
      var self = this, copy = nil;

      copy = [];
      copy.$initialize_dup(self);
      return copy;
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return self.$replace(other);
    };

    def.$collect = TMP_3 = function() {
      var self = this, $iter = TMP_3.$$p, block = $iter || nil;

      TMP_3.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect")
      };
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.yield1(block, self[i]);

        if (value === $breaker) {
          return $breaker.$v;
        }

        result.push(value);
      }

      return result;
    
    };

    def['$collect!'] = TMP_4 = function() {
      var self = this, $iter = TMP_4.$$p, block = $iter || nil;

      TMP_4.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect!")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.yield1(block, self[i]);

        if (value === $breaker) {
          return $breaker.$v;
        }

        self[i] = value;
      }
    
      return self;
    };

    def.$compact = function() {
      var self = this;

      
      var result = [];

      for (var i = 0, length = self.length, item; i < length; i++) {
        if ((item = self[i]) !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$compact!'] = function() {
      var self = this;

      
      var original = self.length;

      for (var i = 0, length = self.length; i < length; i++) {
        if (self[i] === nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : self;
    
    };

    def.$concat = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = $scope.get('Opal').$coerce_to(other, $scope.get('Array'), "to_ary").$to_a()
      };
      
      for (var i = 0, length = other.length; i < length; i++) {
        self.push(other[i]);
      }
    
      return self;
    };

    def.$delete = function(object) {
      var self = this;

      
      var original = self.length;

      for (var i = 0, length = original; i < length; i++) {
        if ((self[i])['$=='](object)) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : object;
    
    };

    def.$delete_at = function(index) {
      var self = this;

      
      index = $scope.get('Opal').$coerce_to(index, $scope.get('Integer'), "to_int");

      if (index < 0) {
        index += self.length;
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      var result = self[index];

      self.splice(index, 1);

      return result;
    ;
    };

    def.$delete_if = TMP_5 = function() {
      var self = this, $iter = TMP_5.$$p, block = $iter || nil;

      TMP_5.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("delete_if")
      };
      
      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return self;
    };

    def.$drop = function(number) {
      var self = this;

      
      if (number < 0) {
        self.$raise($scope.get('ArgumentError'))
      }

      return self.slice(number);
    ;
    };

    Opal.defn(self, '$dup', def.$clone);

    def.$each = TMP_6 = function() {
      var self = this, $iter = TMP_6.$$p, block = $iter || nil;

      TMP_6.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.yield1(block, self[i]);

        if (value == $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def.$each_index = TMP_7 = function() {
      var self = this, $iter = TMP_7.$$p, block = $iter || nil;

      TMP_7.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_index")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.yield1(block, i);

        if (value === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$empty?'] = function() {
      var self = this;

      return self.length === 0;
    };

    def['$eql?'] = function(other) {
      var $a, self = this;

      if ((($a = self === other) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return false
      };
      other = other.$to_a();
      if ((($a = self.length === other.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return false
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var a = self[i],
            b = other[i];

        if (a.$$is_array && b.$$is_array && (a === self)) {
          continue;
        }

        if (!(a)['$eql?'](b)) {
          return false;
        }
      }
    
      return true;
    };

    def.$fetch = TMP_8 = function(index, defaults) {
      var self = this, $iter = TMP_8.$$p, block = $iter || nil;

      TMP_8.$$p = null;
      
      var original = index;

      index = $scope.get('Opal').$coerce_to(index, $scope.get('Integer'), "to_int");

      if (index < 0) {
        index += self.length;
      }

      if (index >= 0 && index < self.length) {
        return self[index];
      }

      if (block !== nil) {
        return block(original);
      }

      if (defaults != null) {
        return defaults;
      }

      if (self.length === 0) {
        self.$raise($scope.get('IndexError'), "index " + (original) + " outside of array bounds: 0...0")
      }
      else {
        self.$raise($scope.get('IndexError'), "index " + (original) + " outside of array bounds: -" + (self.length) + "..." + (self.length));
      }
    ;
    };

    def.$fill = TMP_9 = function(args) {
      var $a, self = this, $iter = TMP_9.$$p, block = $iter || nil, one = nil, two = nil, obj = nil, left = nil, right = nil;

      args = $slice.call(arguments, 0);
      TMP_9.$$p = null;
      if (block !== false && block !== nil) {
        if ((($a = args.length > 2) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('ArgumentError'), "wrong number of arguments (" + (args.$length()) + " for 0..2)")};
        $a = Opal.to_ary(args), one = ($a[0] == null ? nil : $a[0]), two = ($a[1] == null ? nil : $a[1]);
        } else {
        if ((($a = args.length == 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('ArgumentError'), "wrong number of arguments (0 for 1..3)")
        } else if ((($a = args.length > 3) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('ArgumentError'), "wrong number of arguments (" + (args.$length()) + " for 1..3)")};
        $a = Opal.to_ary(args), obj = ($a[0] == null ? nil : $a[0]), one = ($a[1] == null ? nil : $a[1]), two = ($a[2] == null ? nil : $a[2]);
      };
      if ((($a = $scope.get('Range')['$==='](one)) !== nil && (!$a.$$is_boolean || $a == true))) {
        if (two !== false && two !== nil) {
          self.$raise($scope.get('TypeError'), "length invalid with range")};
        left = $scope.get('Opal').$coerce_to(one.$begin(), $scope.get('Integer'), "to_int");
        if ((($a = left < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          left += self.length;};
        if ((($a = left < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('RangeError'), "" + (one.$inspect()) + " out of range")};
        right = $scope.get('Opal').$coerce_to(one.$end(), $scope.get('Integer'), "to_int");
        if ((($a = right < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          right += self.length;};
        if ((($a = one['$exclude_end?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          right += 1;
        };
        if ((($a = right <= left) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self};
      } else if (one !== false && one !== nil) {
        left = $scope.get('Opal').$coerce_to(one, $scope.get('Integer'), "to_int");
        if ((($a = left < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          left += self.length;};
        if ((($a = left < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          left = 0};
        if (two !== false && two !== nil) {
          right = $scope.get('Opal').$coerce_to(two, $scope.get('Integer'), "to_int");
          if ((($a = right == 0) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self};
          right += left;
          } else {
          right = self.length
        };
        } else {
        left = 0;
        right = self.length;
      };
      if ((($a = left > self.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        
        for (var i = self.length; i < right; i++) {
          self[i] = nil;
        }
      ;};
      if ((($a = right > self.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.length = right};
      if (block !== false && block !== nil) {
        
        for (var length = self.length; left < right; left++) {
          var value = block(left);

          if (value === $breaker) {
            return $breaker.$v;
          }

          self[left] = value;
        }
      ;
        } else {
        
        for (var length = self.length; left < right; left++) {
          self[left] = obj;
        }
      ;
      };
      return self;
    };

    def.$first = function(count) {
      var self = this;

      
      if (count == null) {
        return self.length === 0 ? nil : self[0];
      }

      count = $scope.get('Opal').$coerce_to(count, $scope.get('Integer'), "to_int");

      if (count < 0) {
        self.$raise($scope.get('ArgumentError'), "negative array size");
      }

      return self.slice(0, count);
    
    };

    def.$flatten = function(level) {
      var self = this;

      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if ($scope.get('Opal')['$respond_to?'](item, "to_ary")) {
          item = (item).$to_ary();

          if (level == null) {
            result.push.apply(result, (item).$flatten().$to_a());
          }
          else if (level == 0) {
            result.push(item);
          }
          else {
            result.push.apply(result, (item).$flatten(level - 1).$to_a());
          }
        }
        else {
          result.push(item);
        }
      }

      return result;
    ;
    };

    def['$flatten!'] = function(level) {
      var self = this;

      
      var flattened = self.$flatten(level);

      if (self.length == flattened.length) {
        for (var i = 0, length = self.length; i < length; i++) {
          if (self[i] !== flattened[i]) {
            break;
          }
        }

        if (i == length) {
          return nil;
        }
      }

      self.$replace(flattened);
    ;
      return self;
    };

    def.$hash = function() {
      var self = this;

      
      var hash = ['A'], item, item_hash;
      for (var i = 0, length = self.length; i < length; i++) {
        item = self[i];
        // Guard against recursion
        item_hash = self === item ? 'self' : item.$hash();
        hash.push(item_hash);
      }
      return hash.join(',');
    
    };

    def['$include?'] = function(member) {
      var self = this;

      
      for (var i = 0, length = self.length; i < length; i++) {
        if ((self[i])['$=='](member)) {
          return true;
        }
      }

      return false;
    
    };

    def.$index = TMP_10 = function(object) {
      var self = this, $iter = TMP_10.$$p, block = $iter || nil;

      TMP_10.$$p = null;
      
      if (object != null) {
        for (var i = 0, length = self.length; i < length; i++) {
          if ((self[i])['$=='](object)) {
            return i;
          }
        }
      }
      else if (block !== nil) {
        for (var i = 0, length = self.length, value; i < length; i++) {
          if ((value = block(self[i])) === $breaker) {
            return $breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }
      else {
        return self.$enum_for("index");
      }

      return nil;
    
    };

    def.$insert = function(index, objects) {
      var self = this;

      objects = $slice.call(arguments, 1);
      
      index = $scope.get('Opal').$coerce_to(index, $scope.get('Integer'), "to_int");

      if (objects.length > 0) {
        if (index < 0) {
          index += self.length + 1;

          if (index < 0) {
            self.$raise($scope.get('IndexError'), "" + (index) + " is out of bounds");
          }
        }
        if (index > self.length) {
          for (var i = self.length; i < index; i++) {
            self.push(nil);
          }
        }

        self.splice.apply(self, [index, 0].concat(objects));
      }
    ;
      return self;
    };

    def.$inspect = function() {
      var self = this;

      
      var result = [],
          id     = self.$__id__();

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self['$[]'](i);

        if ((item).$__id__() === id) {
          result.push('[...]');
        }
        else {
          result.push((item).$inspect());
        }
      }

      return '[' + result.join(', ') + ']';
    ;
    };

    def.$join = function(sep) {
      var $a, self = this;
      if ($gvars[","] == null) $gvars[","] = nil;

      if (sep == null) {
        sep = nil
      }
      if ((($a = self.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        return ""};
      if ((($a = sep === nil) !== nil && (!$a.$$is_boolean || $a == true))) {
        sep = $gvars[","]};
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if ($scope.get('Opal')['$respond_to?'](item, "to_str")) {
          var tmp = (item).$to_str();

          if (tmp !== nil) {
            result.push((tmp).$to_s());

            continue;
          }
        }

        if ($scope.get('Opal')['$respond_to?'](item, "to_ary")) {
          var tmp = (item).$to_ary();

          if (tmp !== nil) {
            result.push((tmp).$join(sep));

            continue;
          }
        }

        if ($scope.get('Opal')['$respond_to?'](item, "to_s")) {
          var tmp = (item).$to_s();

          if (tmp !== nil) {
            result.push(tmp);

            continue;
          }
        }

        self.$raise($scope.get('NoMethodError'), "" + ($scope.get('Opal').$inspect(item)) + " doesn't respond to #to_str, #to_ary or #to_s");
      }

      if (sep === nil) {
        return result.join('');
      }
      else {
        return result.join($scope.get('Opal')['$coerce_to!'](sep, $scope.get('String'), "to_str").$to_s());
      }
    ;
    };

    def.$keep_if = TMP_11 = function() {
      var self = this, $iter = TMP_11.$$p, block = $iter || nil;

      TMP_11.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("keep_if")
      };
      
      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return self;
    };

    def.$last = function(count) {
      var self = this;

      
      if (count == null) {
        return self.length === 0 ? nil : self[self.length - 1];
      }

      count = $scope.get('Opal').$coerce_to(count, $scope.get('Integer'), "to_int");

      if (count < 0) {
        self.$raise($scope.get('ArgumentError'), "negative array size");
      }

      if (count > self.length) {
        count = self.length;
      }

      return self.slice(self.length - count, self.length);
    
    };

    def.$length = function() {
      var self = this;

      return self.length;
    };

    Opal.defn(self, '$map', def.$collect);

    Opal.defn(self, '$map!', def['$collect!']);

    def.$pop = function(count) {
      var $a, self = this;

      if ((($a = count === undefined) !== nil && (!$a.$$is_boolean || $a == true))) {
        if ((($a = self.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          return nil};
        return self.pop();};
      count = $scope.get('Opal').$coerce_to(count, $scope.get('Integer'), "to_int");
      if ((($a = count < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "negative array size")};
      if ((($a = self.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        return []};
      if ((($a = count > self.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.splice(0, self.length);
        } else {
        return self.splice(self.length - count, self.length);
      };
    };

    def.$push = function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      
      for (var i = 0, length = objects.length; i < length; i++) {
        self.push(objects[i]);
      }
    
      return self;
    };

    def.$rassoc = function(object) {
      var self = this;

      
      for (var i = 0, length = self.length, item; i < length; i++) {
        item = self[i];

        if (item.length && item[1] !== undefined) {
          if ((item[1])['$=='](object)) {
            return item;
          }
        }
      }

      return nil;
    
    };

    def.$reject = TMP_12 = function() {
      var self = this, $iter = TMP_12.$$p, block = $iter || nil;

      TMP_12.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reject")
      };
      
      var result = [];

      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          result.push(self[i]);
        }
      }
      return result;
    
    };

    def['$reject!'] = TMP_13 = function() {
      var $a, $b, self = this, $iter = TMP_13.$$p, block = $iter || nil, original = nil;

      TMP_13.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reject!")
      };
      original = self.$length();
      ($a = ($b = self).$delete_if, $a.$$p = block.$to_proc(), $a).call($b);
      if (self.$length()['$=='](original)) {
        return nil
        } else {
        return self
      };
    };

    def.$replace = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = $scope.get('Opal').$coerce_to(other, $scope.get('Array'), "to_ary").$to_a()
      };
      
      self.splice(0, self.length);
      self.push.apply(self, other);
    
      return self;
    };

    def.$reverse = function() {
      var self = this;

      return self.slice(0).reverse();
    };

    def['$reverse!'] = function() {
      var self = this;

      return self.reverse();
    };

    def.$reverse_each = TMP_14 = function() {
      var $a, $b, self = this, $iter = TMP_14.$$p, block = $iter || nil;

      TMP_14.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reverse_each")
      };
      ($a = ($b = self.$reverse()).$each, $a.$$p = block.$to_proc(), $a).call($b);
      return self;
    };

    def.$rindex = TMP_15 = function(object) {
      var self = this, $iter = TMP_15.$$p, block = $iter || nil;

      TMP_15.$$p = null;
      
      if (object != null) {
        for (var i = self.length - 1; i >= 0; i--) {
          if ((self[i])['$=='](object)) {
            return i;
          }
        }
      }
      else if (block !== nil) {
        for (var i = self.length - 1, value; i >= 0; i--) {
          if ((value = block(self[i])) === $breaker) {
            return $breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }
      else if (object == null) {
        return self.$enum_for("rindex");
      }

      return nil;
    
    };

    def.$sample = function(n) {
      var $a, $b, TMP_16, self = this;

      if (n == null) {
        n = nil
      }
      if ((($a = ($b = n['$!'](), $b !== false && $b !== nil ?self['$empty?']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil};
      if ((($a = (($b = n !== false && n !== nil) ? self['$empty?']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return []};
      if (n !== false && n !== nil) {
        return ($a = ($b = ($range(1, n, false))).$map, $a.$$p = (TMP_16 = function(){var self = TMP_16.$$s || this;

        return self['$[]'](self.$rand(self.$length()))}, TMP_16.$$s = self, TMP_16), $a).call($b)
        } else {
        return self['$[]'](self.$rand(self.$length()))
      };
    };

    def.$select = TMP_17 = function() {
      var self = this, $iter = TMP_17.$$p, block = $iter || nil;

      TMP_17.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("select")
      };
      
      var result = [];

      for (var i = 0, length = self.length, item, value; i < length; i++) {
        item = self[i];

        if ((value = Opal.yield1(block, item)) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_18 = function() {
      var $a, $b, self = this, $iter = TMP_18.$$p, block = $iter || nil;

      TMP_18.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("select!")
      };
      
      var original = self.length;
      ($a = ($b = self).$keep_if, $a.$$p = block.$to_proc(), $a).call($b);
      return self.length === original ? nil : self;
    
    };

    def.$shift = function(count) {
      var $a, self = this;

      if ((($a = count === undefined) !== nil && (!$a.$$is_boolean || $a == true))) {
        if ((($a = self.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
          return nil};
        return self.shift();};
      count = $scope.get('Opal').$coerce_to(count, $scope.get('Integer'), "to_int");
      if ((($a = count < 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "negative array size")};
      if ((($a = self.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        return []};
      return self.splice(0, count);
    };

    Opal.defn(self, '$size', def.$length);

    def.$shuffle = function() {
      var self = this;

      return self.$clone()['$shuffle!']();
    };

    def['$shuffle!'] = function() {
      var self = this;

      
      for (var i = self.length - 1; i > 0; i--) {
        var tmp = self[i],
            j   = Math.floor(Math.random() * (i + 1));

        self[i] = self[j];
        self[j] = tmp;
      }
    
      return self;
    };

    Opal.defn(self, '$slice', def['$[]']);

    def['$slice!'] = function(index, length) {
      var self = this;

      
      if (index < 0) {
        index += self.length;
      }

      if (length != null) {
        return self.splice(index, length);
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      return self.splice(index, 1)[0];
    
    };

    def.$sort = TMP_19 = function() {
      var $a, self = this, $iter = TMP_19.$$p, block = $iter || nil;

      TMP_19.$$p = null;
      if ((($a = self.length > 1) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return self
      };
      
      if (!(block !== nil)) {
        block = function(a, b) {
          return (a)['$<=>'](b);
        };
      }

      try {
        return self.slice().sort(function(x, y) {
          var ret = block(x, y);

          if (ret === $breaker) {
            throw $breaker;
          }
          else if (ret === nil) {
            self.$raise($scope.get('ArgumentError'), "comparison of " + ((x).$inspect()) + " with " + ((y).$inspect()) + " failed");
          }

          return (ret)['$>'](0) ? 1 : ((ret)['$<'](0) ? -1 : 0);
        });
      }
      catch (e) {
        if (e === $breaker) {
          return $breaker.$v;
        }
        else {
          throw e;
        }
      }
    ;
    };

    def['$sort!'] = TMP_20 = function() {
      var $a, $b, self = this, $iter = TMP_20.$$p, block = $iter || nil;

      TMP_20.$$p = null;
      
      var result;

      if ((block !== nil)) {
        result = ($a = ($b = (self.slice())).$sort, $a.$$p = block.$to_proc(), $a).call($b);
      }
      else {
        result = (self.slice()).$sort();
      }

      self.length = 0;
      for(var i = 0, length = result.length; i < length; i++) {
        self.push(result[i]);
      }

      return self;
    ;
    };

    def.$take = function(count) {
      var self = this;

      
      if (count < 0) {
        self.$raise($scope.get('ArgumentError'));
      }

      return self.slice(0, count);
    ;
    };

    def.$take_while = TMP_21 = function() {
      var self = this, $iter = TMP_21.$$p, block = $iter || nil;

      TMP_21.$$p = null;
      
      var result = [];

      for (var i = 0, length = self.length, item, value; i < length; i++) {
        item = self[i];

        if ((value = block(item)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          return result;
        }

        result.push(item);
      }

      return result;
    
    };

    def.$to_a = function() {
      var self = this;

      return self;
    };

    Opal.defn(self, '$to_ary', def.$to_a);

    Opal.defn(self, '$to_s', def.$inspect);

    def.$transpose = function() {
      var $a, $b, TMP_22, self = this, result = nil, max = nil;

      if ((($a = self['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        return []};
      result = [];
      max = nil;
      ($a = ($b = self).$each, $a.$$p = (TMP_22 = function(row){var self = TMP_22.$$s || this, $a, $b, TMP_23;
if (row == null) row = nil;
      if ((($a = $scope.get('Array')['$==='](row)) !== nil && (!$a.$$is_boolean || $a == true))) {
          row = row.$to_a()
          } else {
          row = $scope.get('Opal').$coerce_to(row, $scope.get('Array'), "to_ary").$to_a()
        };
        ((($a = max) !== false && $a !== nil) ? $a : max = row.length);
        if ((($a = (row.length)['$=='](max)['$!']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('IndexError'), "element size differs (" + (row.length) + " should be " + (max))};
        return ($a = ($b = (row.length)).$times, $a.$$p = (TMP_23 = function(i){var self = TMP_23.$$s || this, $a, $b, $c, entry = nil;
if (i == null) i = nil;
        entry = (($a = i, $b = result, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, []))));
          return entry['$<<'](row.$at(i));}, TMP_23.$$s = self, TMP_23), $a).call($b);}, TMP_22.$$s = self, TMP_22), $a).call($b);
      return result;
    };

    def.$uniq = function() {
      var self = this;

      
      var result = [],
          seen   = {};

      for (var i = 0, length = self.length, item, hash; i < length; i++) {
        item = self[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;

          result.push(item);
        }
      }

      return result;
    
    };

    def['$uniq!'] = function() {
      var self = this;

      
      var original = self.length,
          seen     = {};

      for (var i = 0, length = original, item, hash; i < length; i++) {
        item = self[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;
        }
        else {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : self;
    
    };

    def.$unshift = function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      
      for (var i = objects.length - 1; i >= 0; i--) {
        self.unshift(objects[i]);
      }
    
      return self;
    };

    return (def.$zip = TMP_24 = function(others) {
      var self = this, $iter = TMP_24.$$p, block = $iter || nil;

      others = $slice.call(arguments, 0);
      TMP_24.$$p = null;
      
      var result = [], size = self.length, part, o;

      for (var i = 0; i < size; i++) {
        part = [self[i]];

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
    
    }, nil) && 'zip';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/array/inheritance"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$new', '$allocate', '$initialize', '$to_proc', '$__send__', '$clone', '$respond_to?', '$==', '$eql?', '$inspect', '$*', '$class', '$slice', '$uniq', '$flatten']);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self.$$proto, $scope = self.$$scope;

    return (Opal.defs(self, '$inherited', function(klass) {
      var self = this, replace = nil;

      replace = $scope.get('Class').$new((($scope.get('Array')).$$scope.get('Wrapper')));
      
      klass.$$proto         = replace.$$proto;
      klass.$$proto.$$class = klass;
      klass.$$alloc         = replace.$$alloc;
      klass.$$parent        = (($scope.get('Array')).$$scope.get('Wrapper'));

      klass.$allocate = replace.$allocate;
      klass.$new      = replace.$new;
      klass["$[]"]    = replace["$[]"];
    
    }), nil) && 'inherited'
  })(self, null);
  return (function($base, $super) {
    function $Wrapper(){};
    var self = $Wrapper = $klass($base, $super, 'Wrapper', $Wrapper);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5;

    def.literal = nil;
    Opal.defs(self, '$allocate', TMP_1 = function(array) {
      var self = this, $iter = TMP_1.$$p, $yield = $iter || nil, obj = nil;

      if (array == null) {
        array = []
      }
      TMP_1.$$p = null;
      obj = Opal.find_super_dispatcher(self, 'allocate', TMP_1, null, $Wrapper).apply(self, []);
      obj.literal = array;
      return obj;
    });

    Opal.defs(self, '$new', TMP_2 = function(args) {
      var $a, $b, self = this, $iter = TMP_2.$$p, block = $iter || nil, obj = nil;

      args = $slice.call(arguments, 0);
      TMP_2.$$p = null;
      obj = self.$allocate();
      ($a = ($b = obj).$initialize, $a.$$p = block.$to_proc(), $a).apply($b, [].concat(args));
      return obj;
    });

    Opal.defs(self, '$[]', function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      return self.$allocate(objects);
    });

    def.$initialize = TMP_3 = function(args) {
      var $a, $b, self = this, $iter = TMP_3.$$p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_3.$$p = null;
      return self.literal = ($a = ($b = $scope.get('Array')).$new, $a.$$p = block.$to_proc(), $a).apply($b, [].concat(args));
    };

    def.$method_missing = TMP_4 = function(args) {
      var $a, $b, self = this, $iter = TMP_4.$$p, block = $iter || nil, result = nil;

      args = $slice.call(arguments, 0);
      TMP_4.$$p = null;
      result = ($a = ($b = self.literal).$__send__, $a.$$p = block.$to_proc(), $a).apply($b, [].concat(args));
      if ((($a = result === self.literal) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self
        } else {
        return result
      };
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return self.literal = (other.literal).$clone();
    };

    def['$respond_to?'] = TMP_5 = function(name) {var $zuper = $slice.call(arguments, 0);
      var $a, self = this, $iter = TMP_5.$$p, $yield = $iter || nil;

      TMP_5.$$p = null;
      return ((($a = Opal.find_super_dispatcher(self, 'respond_to?', TMP_5, $iter).apply(self, $zuper)) !== false && $a !== nil) ? $a : self.literal['$respond_to?'](name));
    };

    def['$=='] = function(other) {
      var self = this;

      return self.literal['$=='](other);
    };

    def['$eql?'] = function(other) {
      var self = this;

      return self.literal['$eql?'](other);
    };

    def.$to_a = function() {
      var self = this;

      return self.literal;
    };

    def.$to_ary = function() {
      var self = this;

      return self;
    };

    def.$inspect = function() {
      var self = this;

      return self.literal.$inspect();
    };

    def['$*'] = function(other) {
      var self = this;

      
      var result = self.literal['$*'](other);

      if (result.$$is_array) {
        return self.$class().$allocate(result)
      }
      else {
        return result;
      }
    ;
    };

    def['$[]'] = function(index, length) {
      var self = this;

      
      var result = self.literal.$slice(index, length);

      if (result.$$is_array && (index.$$is_range || length !== undefined)) {
        return self.$class().$allocate(result)
      }
      else {
        return result;
      }
    ;
    };

    Opal.defn(self, '$slice', def['$[]']);

    def.$uniq = function() {
      var self = this;

      return self.$class().$allocate(self.literal.$uniq());
    };

    return (def.$flatten = function(level) {
      var self = this;

      return self.$class().$allocate(self.literal.$flatten(level));
    }, nil) && 'flatten';
  })($scope.get('Array'), null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/hash"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$include', '$!', '$==', '$call', '$coerce_to!', '$lambda?', '$abs', '$arity', '$raise', '$enum_for', '$flatten', '$eql?', '$object_id', '$===', '$clone', '$merge!', '$to_proc', '$alias_method']);
  self.$require("corelib/enumerable");
  return (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13;

    def.proc = def.none = nil;
    self.$include($scope.get('Enumerable'));

    Opal.defs(self, '$[]', function(objs) {
      var self = this;

      objs = $slice.call(arguments, 0);
      return Opal.hash.apply(null, objs);
    });

    Opal.defs(self, '$allocate', function() {
      var self = this;

      
      var hash = new self.$$alloc;

      hash.map  = {};
      hash.smap = {};
      hash.keys = [];
      hash.none = nil;
      hash.proc = nil;

      return hash;
    
    });

    def.$initialize = TMP_1 = function(defaults) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      
      self.none = (defaults === undefined ? nil : defaults);
      self.proc = block;
    
      return self;
    };

    def['$=='] = function(other) {
      var self = this;

      
      if (self === other) {
        return true;
      }

      if (!other.keys || !other.smap || !other.map) {
        return false;
      }

      if (self.keys.length !== other.keys.length) {
        return false;
      }

      var _map  = self.map,
          smap  = self.smap,
          _map2 = other.map,
          smap2 = other.smap,
          map, map2, key, khash, value, value2;

      for (var i = 0, length = self.keys.length; i < length; i++) {
        key = self.keys[i];

        if (key.$$is_string) {
          khash = key;
          map   = smap;
          map2  = smap2;
        } else {
          khash = key.$hash();
          map   = _map;
          map2  = _map2;
        }

        value  = map[khash];
        if (value === undefined) console.log('==', key, self);
        value2 = map2[khash];

        if (value2 === undefined || ((value)['$=='](value2))['$!']()) {
          return false;
        }
      }

      return true;
    
    };

    def['$[]'] = function(key) {
      var self = this;

      
      var map, khash;

      if (key.$$is_string) {
        map = self.smap;
        khash = key;
      } else {
        map = self.map;
        khash = key.$hash();
      }

      if (map === undefined) { console.log(self, '[] --> key:', key, khash, map) }


      if (Opal.hasOwnProperty.call(map, khash)) {
        return map[khash];
      }

      var proc = self.proc;

      if (proc !== nil) {
        return (proc).$call(self, key);
      }

      return self.none;
    
    };

    def['$[]='] = function(key, value) {
      var self = this;

      
      var map, khash, value;

      if (key.$$is_string) {
        map = self.smap;
        khash = key;
      } else {
        map = self.map;
        khash = key.$hash();
      }

      if (!Opal.hasOwnProperty.call(map, khash)) {
        self.keys.push(key);
      }

      map[khash] = value;

      return value;
    
    };

    def.$assoc = function(object) {
      var self = this;

      
      var keys = self.keys,
          map, key, khash;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if ((key)['$=='](object)) {
          if (key.$$is_string) {
            map = self.smap;
            khash = key;
          } else {
            map = self.map;
            khash = key.$hash();
          }

          return [key, map[khash]];
        }
      }

      return nil;
    
    };

    def.$clear = function() {
      var self = this;

      
      self.map = {};
      self.smap = {};
      self.keys = [];
      return self;
    
    };

    def.$clone = function() {
      var self = this;

      
      var _map  = {},
          smap  = {},
          _map2 = self.map,
          smap2 = self.smap,
          keys  = [],
          map, map2, key, khash, value;

      for (var i = 0, length = self.keys.length; i < length; i++) {
        key   = self.keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
          map2 = smap2;
        } else {
          khash = key.$hash();
          map = _map;
          map2 = _map2;
        }

        value = map2[khash];

        keys.push(key);
        map[khash] = value;
      }

      var clone = new self.$$class.$$alloc();

      clone.map  = _map;
      clone.smap = smap;
      clone.keys = keys;
      clone.none = self.none;
      clone.proc = self.proc;

      return clone;
    
    };

    def.$default = function(val) {
      var self = this;

      
      if (val !== undefined && self.proc !== nil) {
        return self.proc.$call(self, val);
      }
      return self.none;
    ;
    };

    def['$default='] = function(object) {
      var self = this;

      
      self.proc = nil;
      return (self.none = object);
    
    };

    def.$default_proc = function() {
      var self = this;

      return self.proc;
    };

    def['$default_proc='] = function(proc) {
      var self = this;

      
      if (proc !== nil) {
        proc = $scope.get('Opal')['$coerce_to!'](proc, $scope.get('Proc'), "to_proc");

        if (proc['$lambda?']() && proc.$arity().$abs() != 2) {
          self.$raise($scope.get('TypeError'), "default_proc takes two arguments");
        }
      }
      self.none = nil;
      return (self.proc = proc);
    ;
    };

    def.$delete = TMP_2 = function(key) {
      var self = this, $iter = TMP_2.$$p, block = $iter || nil;

      TMP_2.$$p = null;
      
      var result, map, khash;

      if (key.$$is_string) {
        map = self.smap;
        khash = key;
      } else {
        map = self.map;
        khash = key.$hash();
      }

      result = map[khash];

      if (result != null) {
        delete map[khash];
        self.keys.$delete(key);

        return result;
      }

      if (block !== nil) {
        return block.$call(key);
      }
      return nil;
    
    };

    def.$delete_if = TMP_3 = function() {
      var self = this, $iter = TMP_3.$$p, block = $iter || nil;

      TMP_3.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("delete_if")
      };
      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys,
          map, key, value, obj, khash;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          map = smap;
          khash = key;
        } else {
          map = _map;
          khash = key.$hash();
        }
        obj = map[khash];
        value = block(key, obj);

        if (value === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          keys.splice(i, 1);
          delete map[khash];

          length--;
          i--;
        }
      }

      return self;
    
    };

    Opal.defn(self, '$dup', def.$clone);

    def.$each = TMP_4 = function() {
      var self = this, $iter = TMP_4.$$p, block = $iter || nil;

      TMP_4.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each")
      };
      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys,
          map, key, khash, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          map = smap;
          khash = key;
        } else {
          map = _map;
          khash = key.$hash();
        }

        value = Opal.yield1(block, [key, map[khash]]);

        if (value === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    def.$each_key = TMP_5 = function() {
      var self = this, $iter = TMP_5.$$p, block = $iter || nil;

      TMP_5.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each_key")
      };
      
      var keys = self.keys, key;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (block(key) === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    Opal.defn(self, '$each_pair', def.$each);

    def.$each_value = TMP_6 = function() {
      var self = this, $iter = TMP_6.$$p, block = $iter || nil;

      TMP_6.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each_value")
      };
      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          map = smap;
          khash = key;
        } else {
          map = _map;
          khash = key.$hash();
        }

        if (block(map[khash]) === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    def['$empty?'] = function() {
      var self = this;

      return self.keys.length === 0;
    };

    Opal.defn(self, '$eql?', def['$==']);

    def.$fetch = TMP_7 = function(key, defaults) {
      var self = this, $iter = TMP_7.$$p, block = $iter || nil;

      TMP_7.$$p = null;
      
      var map, khash, value;

      if (key.$$is_string) {
        khash = key;
        map = self.smap;
      } else {
        khash = key.$hash();
        map = self.map;
      }

      value = map[khash];

      if (value != null) {
        return value;
      }

      if (block !== nil) {
        var value;

        if ((value = block(key)) === $breaker) {
          return $breaker.$v;
        }

        return value;
      }

      if (defaults != null) {
        return defaults;
      }

      self.$raise($scope.get('KeyError'), "key not found");
    
    };

    def.$flatten = function(level) {
      var self = this;

      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys,
          result = [],
          map, key, khash, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        value = map[khash];

        result.push(key);

        if (value.$$is_array) {
          if (level == null || level === 1) {
            result.push(value);
          }
          else {
            result = result.concat((value).$flatten(level - 1));
          }
        }
        else {
          result.push(value);
        }
      }

      return result;
    
    };

    def['$has_key?'] = function(key) {
      var self = this;

      
      var keys = self.keys,
          map, khash;

      if (key.$$is_string) {
        khash = key;
        map = self.smap;
      } else {
        khash = key.$hash();
        map = self.map;
      }

      if (Opal.hasOwnProperty.call(map, khash)) {
        for (var i = 0, length = keys.length; i < length; i++) {
          if (!(key['$eql?'](keys[i]))['$!']()) {
            return true;
          }
        }
      }

      return false;
    
    };

    def['$has_value?'] = function(value) {
      var self = this;

      
      for (var khash in self.map) {
        if ((self.map[khash])['$=='](value)) {
          return true;
        }
      }

      return false;
    ;
    };

    Opal.defn(self, '$include?', def['$has_key?']);

    def.$index = function(object) {
      var self = this;

      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys,
          map, khash, key;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          map = smap;
          khash = key;
        } else {
          map = _map;
          khash = key.$hash();
        }

        if ((map[khash])['$=='](object)) {
          return key;
        }
      }

      return nil;
    
    };

    def.$indexes = function(keys) {
      var self = this;

      keys = $slice.call(arguments, 0);
      
      var result = [],
          _map = self.map,
          smap = self.smap,
          map, key, khash, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        value = map[khash];

        if (value != null) {
          result.push(value);
        }
        else {
          result.push(self.none);
        }
      }

      return result;
    
    };

    Opal.defn(self, '$indices', def.$indexes);

    var inspect_ids = null;

    def.$inspect = function() {
      var self = this;

      
      var top = (inspect_ids === null);
      try {
        var inspect = [],
            keys = self.keys
            _map = self.map,
            smap = self.smap,
            id = self.$object_id();

        if (top) {
          inspect_ids = {}
        }

        if (inspect_ids.hasOwnProperty(id)) {
          return '{...}';
        }

        inspect_ids[id] = true;

        for (var i = 0, length = keys.length; i < length; i++) {
          var key = keys[i],
              value = key.$$is_string ? smap[key] : _map[key.$hash()];

          value = value;
          key = key;
          inspect.push(key.$inspect() + '=>' + value.$inspect());
        }

        return '{' + inspect.join(', ') + '}';
      } finally {

        if (top) {
          inspect_ids = null;
        }
      }
    
    };

    def.$invert = function() {
      var self = this;

      
      var result = Opal.hash(),
          keys = self.keys,
          _map = self.map,
          smap = self.smap,
          keys2 = result.keys,
          _map2 = result.map,
          smap2 = result.smap,
          map, map2, key, khash, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          map = smap;
          khash = key;
        } else {
          map = _map;
          khash = key.$hash();
        }

        value = map[khash];
        keys2.push(value);

        if (value.$$is_string) {
          map2 = smap2;
          khash = value;
        } else {
          map2 = _map2;
          khash = value.$hash();
        }

        map2[khash] = key;
      }

      return result;
    
    };

    def.$keep_if = TMP_8 = function() {
      var self = this, $iter = TMP_8.$$p, block = $iter || nil;

      TMP_8.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("keep_if")
      };
      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys,
          map, key, khash, value, keep;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        value = map[khash];
        keep  = block(key, value);

        if (keep === $breaker) {
          return $breaker.$v;
        }

        if (keep === false || keep === nil) {
          keys.splice(i, 1);
          delete map[khash];

          length--;
          i--;
        }
      }

      return self;
    
    };

    Opal.defn(self, '$key', def.$index);

    Opal.defn(self, '$key?', def['$has_key?']);

    def.$keys = function() {
      var self = this;

      return self.keys.slice(0);
    };

    def.$length = function() {
      var self = this;

      return self.keys.length;
    };

    Opal.defn(self, '$member?', def['$has_key?']);

    def.$merge = TMP_9 = function(other) {
      var $a, $b, self = this, $iter = TMP_9.$$p, block = $iter || nil, cloned = nil;

      TMP_9.$$p = null;
      if ((($a = $scope.get('Hash')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        other = $scope.get('Opal')['$coerce_to!'](other, $scope.get('Hash'), "to_hash")
      };
      cloned = self.$clone();
      ($a = ($b = cloned)['$merge!'], $a.$$p = block.$to_proc(), $a).call($b, other);
      return cloned;
    };

    def['$merge!'] = TMP_10 = function(other) {
      var self = this, $iter = TMP_10.$$p, block = $iter || nil;

      TMP_10.$$p = null;
      
      if (! $scope.get('Hash')['$==='](other)) {
        other = $scope.get('Opal')['$coerce_to!'](other, $scope.get('Hash'), "to_hash");
      }

      var keys  = self.keys,
          _map  = self.map,
          smap  = self.smap,
          keys2 = other.keys,
          _map2 = other.map,
          smap2 = other.smap,
          map, map2, key, khash, value, value2;

      if (block === nil) {
        for (var i = 0, length = keys2.length; i < length; i++) {
          key = keys2[i];

          if (key.$$is_string) {
            khash = key;
            map = smap;
            map2 = smap2;
          } else {
            khash = key.$hash();
            map = _map;
            map2 = _map2;
          }

          if (map[khash] == null) {
            keys.push(key);
          }

          map[khash] = map2[khash];
        }
      }
      else {
        for (var i = 0, length = keys2.length; i < length; i++) {
          key    = keys2[i];

          if (key.$$is_string) {
            khash = key;
            map = smap;
            map2 = smap2;
          } else {
            khash = key.$hash();
            map = _map;
            map2 = _map2;
          }

          value  = map[khash];
          value2 = map2[khash];

          if (value == null) {
            keys.push(key);
            map[khash] = value2;
          }
          else {
            map[khash] = block(key, value, value2);
          }
        }
      }

      return self;
    ;
    };

    def.$rassoc = function(object) {
      var self = this;

      
      var keys = self.keys,
          _map = self.map,
          smap = self.smap,
          key, khash, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i]

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        value = map[khash];

        if ((value)['$=='](object)) {
          return [key, value];
        }
      }

      return nil;
    
    };

    def.$reject = TMP_11 = function() {
      var self = this, $iter = TMP_11.$$p, block = $iter || nil;

      TMP_11.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("reject")
      };
      
      var keys   = self.keys,
          _map    = self.map,
          smap    = self.smap,
          result = Opal.hash(),
          _map2   = result.map,
          smap2   = result.smap,
          keys2  = result.keys,
          map, map2, key, khash, object, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
          map2 = smap2;
        } else {
          khash = key.$hash();
          map = _map;
          map2 = _map2;
        }

        object = map[khash];

        if ((value = block(key, object)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          keys2.push(key);
          map2[khash] = object;
        }
      }

      return result;
    
    };

    def.$replace = function(other) {
      var self = this;

      
      var keys  = self.keys = [],
          _map  = self.map  = {},
          smap  = self.smap = {},
          _map2 = other.map,
          smap2 = other.smap,
          key, khash, map, map2;

      for (var i = 0, length = other.keys.length; i < length; i++) {
        key = other.keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
          map2 = smap2;
        } else {
          khash = key.$hash();
          map = _map;
          map2 = _map2;
        }

        keys.push(key);
        map[khash] = map2[khash];
      }

      return self;
    
    };

    def.$select = TMP_12 = function() {
      var self = this, $iter = TMP_12.$$p, block = $iter || nil;

      TMP_12.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("select")
      };
      
      var keys   = self.keys,
          _map   = self.map,
          smap   = self.smap,
          result = Opal.hash(),
          _map2  = result.map,
          smap2  = result.smap,
          keys2  = result.keys,
          map, map2, key, khash, value, object;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
          map2 = smap2;
        } else {
          khash = key.$hash();
          map = _map;
          map2 = _map2;
        }

        value = map[khash];
        object = block(key, value);

        if (object === $breaker) {
          return $breaker.$v;
        }

        if (object !== false && object !== nil) {
          keys2.push(key);
          map2[khash] = value;
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_13 = function() {
      var self = this, $iter = TMP_13.$$p, block = $iter || nil;

      TMP_13.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("select!")
      };
      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys,
          result = nil,
          key, khash, value, object;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        value = map[khash];
        object = block(key, value);

        if (object === $breaker) {
          return $breaker.$v;
        }

        if (object === false || object === nil) {
          keys.splice(i, 1);
          delete map[khash];

          length--;
          i--;
          result = self
        }
      }

      return result;
    
    };

    def.$shift = function() {
      var self = this;

      
      var keys = self.keys,
          _map = self.map,
          smap = self.smap,
          map, key, khash, value;

      if (keys.length) {
        key = keys[0];
        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }
        value = map[khash];

        delete map[khash];
        keys.splice(0, 1);

        return [key, value];
      }

      return nil;
    
    };

    Opal.defn(self, '$size', def.$length);

    self.$alias_method("store", "[]=");

    def.$to_a = function() {
      var self = this;

      
      var keys = self.keys,
          _map = self.map,
          smap = self.smap,
          result = [],
          map, key;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        result.push([key, map[khash]]);
      }

      return result;
    
    };

    def.$to_h = function() {
      var self = this;

      
      if (self.$$class === Opal.Hash) {
        return self
      }

      var hash   = new Opal.Hash.$$alloc,
          cloned = self.$clone();

      hash.map  = cloned.map;
      hash.smap = cloned.smap;
      hash.keys = cloned.keys;
      hash.none = cloned.none;
      hash.proc = cloned.proc;

      return hash;
    ;
    };

    def.$to_hash = function() {
      var self = this;

      return self;
    };

    Opal.defn(self, '$to_s', def.$inspect);

    Opal.defn(self, '$update', def['$merge!']);

    Opal.defn(self, '$value?', def['$has_value?']);

    Opal.defn(self, '$values_at', def.$indexes);

    return (def.$values = function() {
      var self = this;

      
      var _map = self.map,
          smap = self.smap,
          keys = self.keys,
          result = [],
          map, khash;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          khash = key;
          map = smap;
        } else {
          khash = key.$hash();
          map = _map;
        }

        result.push(map[khash]);
      }

      return result;
    
    }, nil) && 'values';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/string"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $gvars = Opal.gvars;

  Opal.add_stubs(['$require', '$include', '$to_str', '$===', '$format', '$coerce_to', '$to_s', '$respond_to?', '$<=>', '$raise', '$=~', '$empty?', '$ljust', '$ceil', '$/', '$+', '$rjust', '$floor', '$to_a', '$each_char', '$to_proc', '$coerce_to!', '$initialize_clone', '$initialize_dup', '$enum_for', '$split', '$chomp', '$escape', '$class', '$to_i', '$!', '$each_line', '$match', '$new', '$try_convert', '$chars', '$&', '$join', '$is_a?', '$[]', '$str', '$value', '$proc', '$shift', '$send']);
  self.$require("corelib/comparable");
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7;

    def.length = nil;
    self.$include($scope.get('Comparable'));

    def.$$is_string = true;

    Opal.defs(self, '$try_convert', function(what) {
      var self = this;

      try {
      return what.$to_str()
      } catch ($err) {if (true) {
        return nil
        }else { throw $err; }
      };
    });

    Opal.defs(self, '$new', function(str) {
      var self = this;

      if (str == null) {
        str = ""
      }
      return new String(str);
    });

    def['$%'] = function(data) {
      var $a, self = this;

      if ((($a = $scope.get('Array')['$==='](data)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return ($a = self).$format.apply($a, [self].concat(data))
        } else {
        return self.$format(self, data)
      };
    };

    def['$*'] = function(count) {
      var self = this;

      
      if (count < 1) {
        return '';
      }

      var result  = '',
          pattern = self;

      while (count > 0) {
        if (count & 1) {
          result += pattern;
        }

        count >>= 1;
        pattern += pattern;
      }

      return result;
    
    };

    def['$+'] = function(other) {
      var self = this;

      other = $scope.get('Opal').$coerce_to(other, $scope.get('String'), "to_str");
      return self + other.$to_s();
    };

    def['$<=>'] = function(other) {
      var $a, self = this;

      if ((($a = other['$respond_to?']("to_str")) !== nil && (!$a.$$is_boolean || $a == true))) {
        other = other.$to_str().$to_s();
        return self > other ? 1 : (self < other ? -1 : 0);
        } else {
        
        var cmp = other['$<=>'](self);

        if (cmp === nil) {
          return nil;
        }
        else {
          return cmp > 0 ? -1 : (cmp < 0 ? 1 : 0);
        }
      ;
      };
    };

    def['$<<'] = function(other) {
      var self = this;

      return self.$raise($scope.get('NotImplementedError'), "Mutable String methods are not supported in Opal.");
    };

    def['$=='] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('String')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return false
      };
      return self.$to_s() == other.$to_s();
    };

    Opal.defn(self, '$eql?', def['$==']);

    Opal.defn(self, '$===', def['$==']);

    def['$=~'] = function(other) {
      var self = this;

      
      if (other.$$is_string) {
        self.$raise($scope.get('TypeError'), "type mismatch: String given");
      }

      return other['$=~'](self);
    ;
    };

    def['$[]'] = function(index, length) {
      var self = this;

      
      var size = self.length;

      if (index.$$is_range) {
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

        return self.substr(index, length);
      }

      if (index < 0) {
        index += self.length;
      }

      if (length == null) {
        if (index >= self.length || index < 0) {
          return nil;
        }

        return self.substr(index, 1);
      }

      if (index > self.length || index < 0) {
        return nil;
      }

      return self.substr(index, length);
    
    };

    def.$capitalize = function() {
      var self = this;

      return self.charAt(0).toUpperCase() + self.substr(1).toLowerCase();
    };

    Opal.defn(self, '$capitalize!', def['$<<']);

    def.$casecmp = function(other) {
      var self = this;

      other = $scope.get('Opal').$coerce_to(other, $scope.get('String'), "to_str").$to_s();
      return (self.toLowerCase())['$<=>'](other.toLowerCase());
    };

    def.$center = function(width, padstr) {
      var $a, self = this;

      if (padstr == null) {
        padstr = " "
      }
      width = $scope.get('Opal').$coerce_to(width, $scope.get('Integer'), "to_int");
      padstr = $scope.get('Opal').$coerce_to(padstr, $scope.get('String'), "to_str").$to_s();
      if ((($a = padstr['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "zero width padding")};
      if ((($a = width <= self.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self};
      
      var ljustified = self.$ljust((width['$+'](self.length))['$/'](2).$ceil(), padstr),
          rjustified = self.$rjust((width['$+'](self.length))['$/'](2).$floor(), padstr);

      return rjustified + ljustified.slice(self.length);
    ;
    };

    def.$chars = TMP_1 = function() {
      var $a, $b, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$each_char().$to_a()
      };
      return ($a = ($b = self).$each_char, $a.$$p = block.$to_proc(), $a).call($b);
    };

    def.$chomp = function(separator) {
      var $a, self = this;
      if ($gvars["/"] == null) $gvars["/"] = nil;

      if (separator == null) {
        separator = $gvars["/"]
      }
      if ((($a = separator === nil || self.length === 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self};
      separator = $scope.get('Opal')['$coerce_to!'](separator, $scope.get('String'), "to_str").$to_s();
      
      if (separator === "\n") {
        return self.replace(/\r?\n?$/, '');
      }
      else if (separator === "") {
        return self.replace(/(\r?\n)+$/, '');
      }
      else if (self.length > separator.length) {
        var tail = self.substr(self.length - separator.length, separator.length);

        if (tail === separator) {
          return self.substr(0, self.length - separator.length);
        }
      }
    
      return self;
    };

    Opal.defn(self, '$chomp!', def['$<<']);

    def.$chop = function() {
      var self = this;

      
      var length = self.length;

      if (length <= 1) {
        return "";
      }

      if (self.charAt(length - 1) === "\n" && self.charAt(length - 2) === "\r") {
        return self.substr(0, length - 2);
      }
      else {
        return self.substr(0, length - 1);
      }
    
    };

    Opal.defn(self, '$chop!', def['$<<']);

    def.$chr = function() {
      var self = this;

      return self.charAt(0);
    };

    def.$clone = function() {
      var self = this, copy = nil;

      copy = self.slice();
      copy.$initialize_clone(self);
      return copy;
    };

    def.$dup = function() {
      var self = this, copy = nil;

      copy = self.slice();
      copy.$initialize_dup(self);
      return copy;
    };

    def.$count = function(str) {
      var self = this;

      return (self.length - self.replace(new RegExp(str, 'g'), '').length) / str.length;
    };

    Opal.defn(self, '$dup', def.$clone);

    def.$downcase = function() {
      var self = this;

      return self.toLowerCase();
    };

    Opal.defn(self, '$downcase!', def['$<<']);

    def.$each_char = TMP_2 = function() {
      var $a, self = this, $iter = TMP_2.$$p, block = $iter || nil;

      TMP_2.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_char")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        ((($a = Opal.yield1(block, self.charAt(i))) === $breaker) ? $breaker.$v : $a);
      }
    
      return self;
    };

    def.$each_line = TMP_3 = function(separator) {
      var $a, self = this, $iter = TMP_3.$$p, $yield = $iter || nil;
      if ($gvars["/"] == null) $gvars["/"] = nil;

      if (separator == null) {
        separator = $gvars["/"]
      }
      TMP_3.$$p = null;
      if (($yield !== nil)) {
        } else {
        return self.$split(separator)
      };
      
      var chomped  = self.$chomp(),
          trailing = self.length != chomped.length,
          splitted = chomped.split(separator);

      for (var i = 0, length = splitted.length; i < length; i++) {
        if (i < length - 1 || trailing) {
          ((($a = Opal.yield1($yield, splitted[i] + separator)) === $breaker) ? $breaker.$v : $a);
        }
        else {
          ((($a = Opal.yield1($yield, splitted[i])) === $breaker) ? $breaker.$v : $a);
        }
      }
    ;
      return self;
    };

    def['$empty?'] = function() {
      var self = this;

      return self.length === 0;
    };

    def['$end_with?'] = function(suffixes) {
      var self = this;

      suffixes = $slice.call(arguments, 0);
      
      for (var i = 0, length = suffixes.length; i < length; i++) {
        var suffix = $scope.get('Opal').$coerce_to(suffixes[i], $scope.get('String'), "to_str").$to_s();

        if (self.length >= suffix.length &&
            self.substr(self.length - suffix.length, suffix.length) == suffix) {
          return true;
        }
      }
    
      return false;
    };

    Opal.defn(self, '$eql?', def['$==']);

    Opal.defn(self, '$equal?', def['$===']);

    def.$gsub = TMP_4 = function(pattern, replace) {
      var $a, $b, self = this, $iter = TMP_4.$$p, block = $iter || nil;

      TMP_4.$$p = null;
      if ((($a = ((($b = $scope.get('String')['$==='](pattern)) !== false && $b !== nil) ? $b : pattern['$respond_to?']("to_str"))) !== nil && (!$a.$$is_boolean || $a == true))) {
        pattern = (new RegExp("" + $scope.get('Regexp').$escape(pattern.$to_str())))};
      if ((($a = $scope.get('Regexp')['$==='](pattern)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('TypeError'), "wrong argument type " + (pattern.$class()) + " (expected Regexp)")
      };
      
      var pattern = pattern.toString(),
          options = pattern.substr(pattern.lastIndexOf('/') + 1) + 'g',
          regexp  = pattern.substr(1, pattern.lastIndexOf('/') - 1);

      self.$sub.$$p = block;
      return self.$sub(new RegExp(regexp, options), replace);
    
    };

    Opal.defn(self, '$gsub!', def['$<<']);

    def.$hash = function() {
      var self = this;

      return self.toString();
    };

    def.$hex = function() {
      var self = this;

      return self.$to_i(16);
    };

    def['$include?'] = function(other) {
      var $a, self = this;

      
      if (other.$$is_string) {
        return self.indexOf(other) !== -1;
      }
    
      if ((($a = other['$respond_to?']("to_str")) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('TypeError'), "no implicit conversion of " + (other.$class()) + " into String")
      };
      return self.indexOf(other.$to_str()) !== -1;
    };

    def.$index = function(what, offset) {
      var $a, self = this, result = nil;

      if (offset == null) {
        offset = nil
      }
      if ((($a = $scope.get('String')['$==='](what)) !== nil && (!$a.$$is_boolean || $a == true))) {
        what = what.$to_s()
      } else if ((($a = what['$respond_to?']("to_str")) !== nil && (!$a.$$is_boolean || $a == true))) {
        what = what.$to_str().$to_s()
      } else if ((($a = $scope.get('Regexp')['$==='](what)['$!']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('TypeError'), "type mismatch: " + (what.$class()) + " given")};
      result = -1;
      if (offset !== false && offset !== nil) {
        offset = $scope.get('Opal').$coerce_to(offset, $scope.get('Integer'), "to_int");
        
        var size = self.length;

        if (offset < 0) {
          offset = offset + size;
        }

        if (offset > size) {
          return nil;
        }
      
        if ((($a = $scope.get('Regexp')['$==='](what)) !== nil && (!$a.$$is_boolean || $a == true))) {
          result = ((($a = (what['$=~'](self.substr(offset)))) !== false && $a !== nil) ? $a : -1)
          } else {
          result = self.substr(offset).indexOf(what)
        };
        
        if (result !== -1) {
          result += offset;
        }
      
      } else if ((($a = $scope.get('Regexp')['$==='](what)) !== nil && (!$a.$$is_boolean || $a == true))) {
        result = ((($a = (what['$=~'](self))) !== false && $a !== nil) ? $a : -1)
        } else {
        result = self.indexOf(what)
      };
      if ((($a = result === -1) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil
        } else {
        return result
      };
    };

    def.$inspect = function() {
      var self = this;

      
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

      return escapable.test(self) ? '"' + self.replace(escapable, function(a) {
        var c = meta[a];

        return typeof c === 'string' ? c :
          '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
      }) + '"' : '"' + self + '"';
    
    };

    def.$intern = function() {
      var self = this;

      return self;
    };

    def.$lines = function(separator) {
      var self = this;
      if ($gvars["/"] == null) $gvars["/"] = nil;

      if (separator == null) {
        separator = $gvars["/"]
      }
      return self.$each_line(separator).$to_a();
    };

    def.$length = function() {
      var self = this;

      return self.length;
    };

    def.$ljust = function(width, padstr) {
      var $a, self = this;

      if (padstr == null) {
        padstr = " "
      }
      width = $scope.get('Opal').$coerce_to(width, $scope.get('Integer'), "to_int");
      padstr = $scope.get('Opal').$coerce_to(padstr, $scope.get('String'), "to_str").$to_s();
      if ((($a = padstr['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "zero width padding")};
      if ((($a = width <= self.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self};
      
      var index  = -1,
          result = "";

      width -= self.length;

      while (++index < width) {
        result += padstr;
      }

      return self + result.slice(0, width);
    
    };

    def.$lstrip = function() {
      var self = this;

      return self.replace(/^\s*/, '');
    };

    Opal.defn(self, '$lstrip!', def['$<<']);

    def.$match = TMP_5 = function(pattern, pos) {
      var $a, $b, self = this, $iter = TMP_5.$$p, block = $iter || nil;

      TMP_5.$$p = null;
      if ((($a = ((($b = $scope.get('String')['$==='](pattern)) !== false && $b !== nil) ? $b : pattern['$respond_to?']("to_str"))) !== nil && (!$a.$$is_boolean || $a == true))) {
        pattern = (new RegExp("" + $scope.get('Regexp').$escape(pattern.$to_str())))};
      if ((($a = $scope.get('Regexp')['$==='](pattern)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('TypeError'), "wrong argument type " + (pattern.$class()) + " (expected Regexp)")
      };
      return ($a = ($b = pattern).$match, $a.$$p = block.$to_proc(), $a).call($b, self, pos);
    };

    def.$next = function() {
      var self = this;

      
      if (self.length === 0) {
        return "";
      }

      var initial = self.substr(0, self.length - 1);
      var last    = String.fromCharCode(self.charCodeAt(self.length - 1) + 1);

      return initial + last;
    
    };

    Opal.defn(self, '$next!', def['$<<']);

    def.$ord = function() {
      var self = this;

      return self.charCodeAt(0);
    };

    def.$partition = function(str) {
      var self = this;

      
      var result = self.split(str);
      var splitter = (result[0].length === self.length ? "" : str);

      return [result[0], splitter, result.slice(1).join(str.toString())];
    
    };

    def.$reverse = function() {
      var self = this;

      return self.split('').reverse().join('');
    };

    Opal.defn(self, '$reverse!', def['$<<']);

    def.$rindex = function(search, offset) {
      var self = this;

      
      var search_type = (search == null ? Opal.NilClass : search.constructor);
      if (search_type != String && search_type != RegExp) {
        var msg = "type mismatch: " + search_type + " given";
        self.$raise($scope.get('TypeError').$new(msg));
      }

      if (self.length == 0) {
        return search.length == 0 ? 0 : nil;
      }

      var result = -1;
      if (offset != null) {
        if (offset < 0) {
          offset = self.length + offset;
        }

        if (search_type == String) {
          result = self.lastIndexOf(search, offset);
        }
        else {
          result = self.substr(0, offset + 1).$reverse().search(search);
          if (result !== -1) {
            result = offset - result;
          }
        }
      }
      else {
        if (search_type == String) {
          result = self.lastIndexOf(search);
        }
        else {
          result = self.$reverse().search(search);
          if (result !== -1) {
            result = self.length - 1 - result;
          }
        }
      }

      return result === -1 ? nil : result;
    
    };

    def.$rjust = function(width, padstr) {
      var $a, self = this;

      if (padstr == null) {
        padstr = " "
      }
      width = $scope.get('Opal').$coerce_to(width, $scope.get('Integer'), "to_int");
      padstr = $scope.get('Opal').$coerce_to(padstr, $scope.get('String'), "to_str").$to_s();
      if ((($a = padstr['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "zero width padding")};
      if ((($a = width <= self.length) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self};
      
      var chars     = Math.floor(width - self.length),
          patterns  = Math.floor(chars / padstr.length),
          result    = Array(patterns + 1).join(padstr),
          remaining = chars - result.length;

      return result + padstr.slice(0, remaining) + self;
    
    };

    def.$rstrip = function() {
      var self = this;

      return self.replace(/\s*$/, '');
    };

    def.$scan = TMP_6 = function(pattern) {
      var self = this, $iter = TMP_6.$$p, block = $iter || nil;

      TMP_6.$$p = null;
      
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

      while ((match = pattern.exec(self)) != null) {
        var match_data = $scope.get('MatchData').$new(pattern, match);
        if (block === nil) {
          match.length == 1 ? result.push(match[0]) : result.push(match.slice(1));
        }
        else {
          match.length == 1 ? block(match[0]) : block.apply(self, match.slice(1));
        }
      }

      return (block !== nil ? self : result);
    
    };

    Opal.defn(self, '$size', def.$length);

    Opal.defn(self, '$slice', def['$[]']);

    Opal.defn(self, '$slice!', def['$<<']);

    def.$split = function(pattern, limit) {
      var self = this, $a;
      if ($gvars[";"] == null) $gvars[";"] = nil;

      if (pattern == null) {
        pattern = ((($a = $gvars[";"]) !== false && $a !== nil) ? $a : " ")
      }
      
      if (pattern === nil || pattern === undefined) {
        pattern = $gvars[";"];
      }

      var result = [];
      if (limit !== undefined) {
        limit = $scope.get('Opal')['$coerce_to!'](limit, $scope.get('Integer'), "to_int");
      }

      if (self.length === 0) {
        return [];
      }

      if (limit === 1) {
        return [self];
      }

      if (pattern && pattern.$$is_regexp) {
        var pattern_str = pattern.toString();

        /* Opal and JS's repr of an empty RE. */
        var blank_pattern = (pattern_str.substr(0, 3) == '/^/') ||
                  (pattern_str.substr(0, 6) == '/(?:)/');

        /* This is our fast path */
        if (limit === undefined || limit === 0) {
          result = self.split(blank_pattern ? /(?:)/ : pattern);
        }
        else {
          /* RegExp.exec only has sane behavior with global flag */
          if (! pattern.global) {
            pattern = eval(pattern_str + 'g');
          }

          var match_data;
          var prev_index = 0;
          pattern.lastIndex = 0;

          while ((match_data = pattern.exec(self)) !== null) {
            var segment = self.slice(prev_index, match_data.index);
            result.push(segment);

            prev_index = pattern.lastIndex;

            if (match_data[0].length === 0) {
              if (blank_pattern) {
                /* explicitly split on JS's empty RE form.*/
                pattern = /(?:)/;
              }

              result = self.split(pattern);
              /* with "unlimited", ruby leaves a trail on blanks. */
              if (limit !== undefined && limit < 0 && blank_pattern) {
                result.push('');
              }

              prev_index = undefined;
              break;
            }

            if (limit !== undefined && limit > 1 && result.length + 1 == limit) {
              break;
            }
          }

          if (prev_index !== undefined) {
            result.push(self.slice(prev_index, self.length));
          }
        }
      }
      else {
        var splitted = 0, start = 0, lim = 0;

        if (pattern === nil || pattern === undefined) {
          pattern = ' '
        } else {
          pattern = $scope.get('Opal').$try_convert(pattern, $scope.get('String'), "to_str").$to_s();
        }

        var string = (pattern == ' ') ? self.replace(/[\r\n\t\v]\s+/g, ' ')
                                      : self;
        var cursor = -1;
        while ((cursor = string.indexOf(pattern, start)) > -1 && cursor < string.length) {
          if (splitted + 1 === limit) {
            break;
          }

          if (pattern == ' ' && cursor == start) {
            start = cursor + 1;
            continue;
          }

          result.push(string.substr(start, pattern.length ? cursor - start : 1));
          splitted++;

          start = cursor + (pattern.length ? pattern.length : 1);
        }

        if (string.length > 0 && (limit < 0 || string.length > start)) {
          if (string.length == start) {
            result.push('');
          }
          else {
            result.push(string.substr(start, string.length));
          }
        }
      }

      if (limit === undefined || limit === 0) {
        while (result[result.length-1] === '') {
          result.length = result.length - 1;
        }
      }

      if (limit > 0) {
        var tail = result.slice(limit - 1).join('');
        result.splice(limit - 1, result.length - 1, tail);
      }

      return result;
    ;
    };

    def.$squeeze = function(sets) {
      var self = this;

      sets = $slice.call(arguments, 0);
      
      if (sets.length === 0) {
        return self.replace(/(.)\1+/g, '$1');
      }
    
      
      var set = $scope.get('Opal').$coerce_to(sets[0], $scope.get('String'), "to_str").$chars();

      for (var i = 1, length = sets.length; i < length; i++) {
        set = (set)['$&']($scope.get('Opal').$coerce_to(sets[i], $scope.get('String'), "to_str").$chars());
      }

      if (set.length === 0) {
        return self;
      }

      return self.replace(new RegExp("([" + $scope.get('Regexp').$escape((set).$join()) + "])\\1+", "g"), "$1");
    ;
    };

    Opal.defn(self, '$squeeze!', def['$<<']);

    def['$start_with?'] = function(prefixes) {
      var self = this;

      prefixes = $slice.call(arguments, 0);
      
      for (var i = 0, length = prefixes.length; i < length; i++) {
        var prefix = $scope.get('Opal').$coerce_to(prefixes[i], $scope.get('String'), "to_str").$to_s();

        if (self.indexOf(prefix) === 0) {
          return true;
        }
      }

      return false;
    
    };

    def.$strip = function() {
      var self = this;

      return self.replace(/^\s*/, '').replace(/\s*$/, '');
    };

    Opal.defn(self, '$strip!', def['$<<']);

    
    // convert Ruby back reference to JavaScript back reference
    function convertReplace(replace) {
      return replace.replace(
        /(^|[^\\])\\(\d)/g, function(a, b, c) { return b + '$' + c }
      ).replace(
        /(^|[^\\])(\\\\)+\\\\(\d)/g, '$1$2\\$3'
      ).replace(
        /(^|[^\\])(?:(\\)\\)+([^\\]|$)/g, '$1$2$3'
      );
    }
  

    def.$sub = TMP_7 = function(pattern, replace) {
      var self = this, $iter = TMP_7.$$p, block = $iter || nil;

      TMP_7.$$p = null;
      
      if (typeof(pattern) !== 'string' && !pattern.$$is_regexp) {
        pattern = $scope.get('Opal')['$coerce_to!'](pattern, $scope.get('String'), "to_str");
      }

      if (replace !== undefined) {
        if (replace['$is_a?']($scope.get('Hash'))) {
          return self.replace(pattern, function(str) {
            var value = replace['$[]'](self.$str());

            return (value == null) ? nil : self.$value().$to_s();
          });
        }
        else {
          if (typeof(replace) !== 'string') {
            replace = $scope.get('Opal')['$coerce_to!'](replace, $scope.get('String'), "to_str");
          }

          replace = convertReplace(replace);
          return self.replace(pattern, replace);
        }

      }
      else if (block != null && block !== nil) {
        return self.replace(pattern, function() {
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
          for (var i = 1; i < match_len; i++) {
            Opal.gvars[String(i)] = match_data[i];
          }
          $gvars["&"] = match_data[0];
          $gvars["~"] = match_data;
          return block(match_data[0]);
        });
      }
      else {
        self.$raise($scope.get('ArgumentError'), "wrong number of arguments (1 for 2)")
      }
    ;
    };

    Opal.defn(self, '$sub!', def['$<<']);

    Opal.defn(self, '$succ', def.$next);

    Opal.defn(self, '$succ!', def['$<<']);

    def.$sum = function(n) {
      var self = this;

      if (n == null) {
        n = 16
      }
      
      var result = 0;

      for (var i = 0, length = self.length; i < length; i++) {
        result += (self.charCodeAt(i) % ((1 << n) - 1));
      }

      return result;
    
    };

    def.$swapcase = function() {
      var self = this;

      
      var str = self.replace(/([a-z]+)|([A-Z]+)/g, function($0,$1,$2) {
        return $1 ? $0.toUpperCase() : $0.toLowerCase();
      });

      if (self.constructor === String) {
        return str;
      }

      return self.$class().$new(str);
    
    };

    Opal.defn(self, '$swapcase!', def['$<<']);

    def.$to_f = function() {
      var self = this;

      
      if (self.charAt(0) === '_') {
        return 0;
      }

      var result = parseFloat(self.replace(/_/g, ''));

      if (isNaN(result) || result == Infinity || result == -Infinity) {
        return 0;
      }
      else {
        return result;
      }
    
    };

    def.$to_i = function(base) {
      var self = this;

      if (base == null) {
        base = 10
      }
      
      var result = parseInt(self, base);

      if (isNaN(result)) {
        return 0;
      }

      return result;
    
    };

    def.$to_proc = function() {
      var $a, $b, TMP_8, self = this, sym = nil;

      sym = self;
      return ($a = ($b = self).$proc, $a.$$p = (TMP_8 = function(args){var self = TMP_8.$$s || this, block, $a, $b, obj = nil;
args = $slice.call(arguments, 0);
        block = TMP_8.$$p || nil, TMP_8.$$p = null;
      if ((($a = args['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$raise($scope.get('ArgumentError'), "no receiver given")};
        obj = args.$shift();
        return ($a = ($b = obj).$send, $a.$$p = block.$to_proc(), $a).apply($b, [sym].concat(args));}, TMP_8.$$s = self, TMP_8), $a).call($b);
    };

    def.$to_s = function() {
      var self = this;

      return self.toString();
    };

    Opal.defn(self, '$to_str', def.$to_s);

    Opal.defn(self, '$to_sym', def.$intern);

    def.$tr = function(from, to) {
      var self = this;

      
      if (from.length == 0 || from === to) {
        return self;
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
        var ch = from_chars[i];
        if (last_from == null) {
          last_from = ch;
          from_chars_expanded.push(ch);
        }
        else if (ch === '-') {
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
          var end = ch.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(ch);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(ch);
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
            var ch = to_chars[i];
            if (last_from == null) {
              last_from = ch;
              to_chars_expanded.push(ch);
            }
            else if (ch === '-') {
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
              var end = ch.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(ch);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(ch);
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
      for (var i = 0, length = self.length; i < length; i++) {
        var ch = self.charAt(i);
        var sub = subs[ch];
        if (inverse) {
          new_str += (sub == null ? global_sub : ch);
        }
        else {
          new_str += (sub != null ? sub : ch);
        }
      }
      return new_str;
    
    };

    Opal.defn(self, '$tr!', def['$<<']);

    def.$tr_s = function(from, to) {
      var self = this;

      
      if (from.length == 0) {
        return self;
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
        var ch = from_chars[i];
        if (last_from == null) {
          last_from = ch;
          from_chars_expanded.push(ch);
        }
        else if (ch === '-') {
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
          var end = ch.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(ch);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(ch);
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
            var ch = to_chars[i];
            if (last_from == null) {
              last_from = ch;
              to_chars_expanded.push(ch);
            }
            else if (ch === '-') {
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
              var end = ch.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(ch);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(ch);
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
      for (var i = 0, length = self.length; i < length; i++) {
        var ch = self.charAt(i);
        var sub = subs[ch]
        if (inverse) {
          if (sub == null) {
            if (last_substitute == null) {
              new_str += global_sub;
              last_substitute = true;
            }
          }
          else {
            new_str += ch;
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
            new_str += ch;
            last_substitute = null;
          }
        }
      }
      return new_str;
    
    };

    Opal.defn(self, '$tr_s!', def['$<<']);

    def.$upcase = function() {
      var self = this;

      return self.toUpperCase();
    };

    Opal.defn(self, '$upcase!', def['$<<']);

    def.$freeze = function() {
      var self = this;

      return self;
    };

    return (def['$frozen?'] = function() {
      var self = this;

      return true;
    }, nil) && 'frozen?';
  })(self, null);
  return Opal.cdecl($scope, 'Symbol', $scope.get('String'));
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/string/inheritance"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$new', '$allocate', '$initialize', '$to_proc', '$__send__', '$class', '$clone', '$respond_to?', '$==', '$inspect']);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self.$$proto, $scope = self.$$scope;

    return (Opal.defs(self, '$inherited', function(klass) {
      var self = this, replace = nil;

      replace = $scope.get('Class').$new((($scope.get('String')).$$scope.get('Wrapper')));
      
      klass.$$proto         = replace.$$proto;
      klass.$$proto.$$class = klass;
      klass.$$alloc         = replace.$$alloc;
      klass.$$parent        = (($scope.get('String')).$$scope.get('Wrapper'));

      klass.$allocate = replace.$allocate;
      klass.$new      = replace.$new;
    
    }), nil) && 'inherited'
  })(self, null);
  return (function($base, $super) {
    function $Wrapper(){};
    var self = $Wrapper = $klass($base, $super, 'Wrapper', $Wrapper);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4;

    def.literal = nil;
    Opal.defs(self, '$allocate', TMP_1 = function(string) {
      var self = this, $iter = TMP_1.$$p, $yield = $iter || nil, obj = nil;

      if (string == null) {
        string = ""
      }
      TMP_1.$$p = null;
      obj = Opal.find_super_dispatcher(self, 'allocate', TMP_1, null, $Wrapper).apply(self, []);
      obj.literal = string;
      return obj;
    });

    Opal.defs(self, '$new', TMP_2 = function(args) {
      var $a, $b, self = this, $iter = TMP_2.$$p, block = $iter || nil, obj = nil;

      args = $slice.call(arguments, 0);
      TMP_2.$$p = null;
      obj = self.$allocate();
      ($a = ($b = obj).$initialize, $a.$$p = block.$to_proc(), $a).apply($b, [].concat(args));
      return obj;
    });

    Opal.defs(self, '$[]', function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      return self.$allocate(objects);
    });

    def.$initialize = function(string) {
      var self = this;

      if (string == null) {
        string = ""
      }
      return self.literal = string;
    };

    def.$method_missing = TMP_3 = function(args) {
      var $a, $b, self = this, $iter = TMP_3.$$p, block = $iter || nil, result = nil;

      args = $slice.call(arguments, 0);
      TMP_3.$$p = null;
      result = ($a = ($b = self.literal).$__send__, $a.$$p = block.$to_proc(), $a).apply($b, [].concat(args));
      if ((($a = result.$$is_string != null) !== nil && (!$a.$$is_boolean || $a == true))) {
        if ((($a = result == self.literal) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self
          } else {
          return self.$class().$allocate(result)
        }
        } else {
        return result
      };
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return self.literal = (other.literal).$clone();
    };

    def['$respond_to?'] = TMP_4 = function(name) {var $zuper = $slice.call(arguments, 0);
      var $a, self = this, $iter = TMP_4.$$p, $yield = $iter || nil;

      TMP_4.$$p = null;
      return ((($a = Opal.find_super_dispatcher(self, 'respond_to?', TMP_4, $iter).apply(self, $zuper)) !== false && $a !== nil) ? $a : self.literal['$respond_to?'](name));
    };

    def['$=='] = function(other) {
      var self = this;

      return self.literal['$=='](other);
    };

    Opal.defn(self, '$eql?', def['$==']);

    Opal.defn(self, '$===', def['$==']);

    def.$to_s = function() {
      var self = this;

      return self.literal;
    };

    def.$to_str = function() {
      var self = this;

      return self;
    };

    return (def.$inspect = function() {
      var self = this;

      return self.literal.$inspect();
    }, nil) && 'inspect';
  })($scope.get('String'), null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/match_data"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $gvars = Opal.gvars;

  Opal.add_stubs(['$attr_reader', '$[]', '$===', '$!', '$==', '$raise', '$inspect']);
  return (function($base, $super) {
    function $MatchData(){};
    var self = $MatchData = $klass($base, $super, 'MatchData', $MatchData);

    var def = self.$$proto, $scope = self.$$scope;

    def.string = def.matches = def.begin = nil;
    self.$attr_reader("post_match", "pre_match", "regexp", "string");

    def.$initialize = function(regexp, match_groups) {
      var self = this;

      $gvars["~"] = self;
      self.regexp = regexp;
      self.begin = match_groups.index;
      self.string = match_groups.input;
      self.pre_match = self.string.substr(0, regexp.lastIndex - match_groups[0].length);
      self.post_match = self.string.substr(regexp.lastIndex);
      self.matches = [];
      
      for (var i = 0, length = match_groups.length; i < length; i++) {
        var group = match_groups[i];

        if (group == null) {
          self.matches.push(nil);
        }
        else {
          self.matches.push(group);
        }
      }
    
    };

    def['$[]'] = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      return ($a = self.matches)['$[]'].apply($a, [].concat(args));
    };

    def['$=='] = function(other) {
      var $a, $b, $c, $d, self = this;

      if ((($a = $scope.get('MatchData')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return false
      };
      return ($a = ($b = ($c = ($d = self.string == other.string, $d !== false && $d !== nil ?self.regexp == other.regexp : $d), $c !== false && $c !== nil ?self.pre_match == other.pre_match : $c), $b !== false && $b !== nil ?self.post_match == other.post_match : $b), $a !== false && $a !== nil ?self.begin == other.begin : $a);
    };

    def.$begin = function(pos) {
      var $a, $b, self = this;

      if ((($a = ($b = pos['$=='](0)['$!'](), $b !== false && $b !== nil ?pos['$=='](1)['$!']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "MatchData#begin only supports 0th element")};
      return self.begin;
    };

    def.$captures = function() {
      var self = this;

      return self.matches.slice(1);
    };

    def.$inspect = function() {
      var self = this;

      
      var str = "#<MatchData " + (self.matches[0]).$inspect();

      for (var i = 1, length = self.matches.length; i < length; i++) {
        str += " " + i + ":" + (self.matches[i]).$inspect();
      }

      return str + ">";
    ;
    };

    def.$length = function() {
      var self = this;

      return self.matches.length;
    };

    Opal.defn(self, '$size', def.$length);

    def.$to_a = function() {
      var self = this;

      return self.matches;
    };

    def.$to_s = function() {
      var self = this;

      return self.matches[0];
    };

    return (def.$values_at = function(indexes) {
      var self = this;

      indexes = $slice.call(arguments, 0);
      
      var values       = [],
          match_length = self.matches.length;

      for (var i = 0, length = indexes.length; i < length; i++) {
        var pos = indexes[i];

        if (pos >= 0) {
          values.push(self.matches[pos]);
        }
        else {
          pos += match_length;

          if (pos > 0) {
            values.push(self.matches[pos]);
          }
          else {
            values.push(nil);
          }
        }
      }

      return values;
    ;
    }, nil) && 'values_at';
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/numeric"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$include', '$coerce', '$===', '$raise', '$class', '$__send__', '$send_coerced', '$coerce_to!', '$-@', '$**', '$-', '$respond_to?', '$==', '$enum_for', '$gcd', '$lcm', '$<', '$>', '$floor', '$/', '$%']);
  self.$require("corelib/comparable");
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;

    self.$include($scope.get('Comparable'));

    def.$$is_number = true;

    def.$coerce = function(other, type) {
      var self = this, $case = nil;

      if (type == null) {
        type = "operation"
      }
      try {
      
      if (other.$$is_number) {
        return [self, other];
      }
      else {
        return other.$coerce(self);
      }
    
      } catch ($err) {if (true) {
        return (function() {$case = type;if ("operation"['$===']($case)) {return self.$raise($scope.get('TypeError'), "" + (other.$class()) + " can't be coerced into Numeric")}else if ("comparison"['$===']($case)) {return self.$raise($scope.get('ArgumentError'), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")}else { return nil }})()
        }else { throw $err; }
      };
    };

    def.$send_coerced = function(method, other) {
      var $a, self = this, type = nil, $case = nil, a = nil, b = nil;

      type = (function() {$case = method;if ("+"['$===']($case) || "-"['$===']($case) || "*"['$===']($case) || "/"['$===']($case) || "%"['$===']($case) || "&"['$===']($case) || "|"['$===']($case) || "^"['$===']($case) || "**"['$===']($case)) {return "operation"}else if (">"['$===']($case) || ">="['$===']($case) || "<"['$===']($case) || "<="['$===']($case) || "<=>"['$===']($case)) {return "comparison"}else { return nil }})();
      $a = Opal.to_ary(self.$coerce(other, type)), a = ($a[0] == null ? nil : $a[0]), b = ($a[1] == null ? nil : $a[1]);
      return a.$__send__(method, b);
    };

    def['$+'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self + other;
      }
      else {
        return self.$send_coerced("+", other);
      }
    
    };

    def['$-'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self - other;
      }
      else {
        return self.$send_coerced("-", other);
      }
    
    };

    def['$*'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self * other;
      }
      else {
        return self.$send_coerced("*", other);
      }
    
    };

    def['$/'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self / other;
      }
      else {
        return self.$send_coerced("/", other);
      }
    
    };

    def['$%'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        if (other < 0 || self < 0) {
          return (self % other + other) % other;
        }
        else {
          return self % other;
        }
      }
      else {
        return self.$send_coerced("%", other);
      }
    
    };

    def['$&'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self & other;
      }
      else {
        return self.$send_coerced("&", other);
      }
    
    };

    def['$|'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self | other;
      }
      else {
        return self.$send_coerced("|", other);
      }
    
    };

    def['$^'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self ^ other;
      }
      else {
        return self.$send_coerced("^", other);
      }
    
    };

    def['$<'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self < other;
      }
      else {
        return self.$send_coerced("<", other);
      }
    
    };

    def['$<='] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self <= other;
      }
      else {
        return self.$send_coerced("<=", other);
      }
    
    };

    def['$>'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self > other;
      }
      else {
        return self.$send_coerced(">", other);
      }
    
    };

    def['$>='] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self >= other;
      }
      else {
        return self.$send_coerced(">=", other);
      }
    
    };

    def['$<=>'] = function(other) {
      var self = this;

      try {
      
      if (other.$$is_number) {
        return self > other ? 1 : (self < other ? -1 : 0);
      }
      else {
        return self.$send_coerced("<=>", other);
      }
    
      } catch ($err) {if (Opal.rescue($err, [$scope.get('ArgumentError')])) {
        return nil
        }else { throw $err; }
      };
    };

    def['$<<'] = function(count) {
      var self = this;

      count = $scope.get('Opal')['$coerce_to!'](count, $scope.get('Integer'), "to_int");
      return count > 0 ? self << count : self >> -count;
    };

    def['$>>'] = function(count) {
      var self = this;

      count = $scope.get('Opal')['$coerce_to!'](count, $scope.get('Integer'), "to_int");
      return count > 0 ? self >> count : self << -count;
    };

    def['$[]'] = function(bit) {
      var self = this, min = nil, max = nil;

      bit = $scope.get('Opal')['$coerce_to!'](bit, $scope.get('Integer'), "to_int");
      min = ((2)['$**'](30))['$-@']();
      max = ((2)['$**'](30))['$-'](1);
      return (bit < min || bit > max) ? 0 : (self >> bit) % 2;
    };

    def['$+@'] = function() {
      var self = this;

      return +self;
    };

    def['$-@'] = function() {
      var self = this;

      return -self;
    };

    def['$~'] = function() {
      var self = this;

      return ~self;
    };

    def['$**'] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return Math.pow(self, other);
      }
      else {
        return self.$send_coerced("**", other);
      }
    
    };

    def['$=='] = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self == Number(other);
      }
      else if (other['$respond_to?']("==")) {
        return other['$=='](self);
      }
      else {
        return false;
      }
    ;
    };

    def.$abs = function() {
      var self = this;

      return Math.abs(self);
    };

    def.$ceil = function() {
      var self = this;

      return Math.ceil(self);
    };

    def.$chr = function(encoding) {
      var self = this;

      return String.fromCharCode(self);
    };

    def.$conj = function() {
      var self = this;

      return self;
    };

    Opal.defn(self, '$conjugate', def.$conj);

    def.$downto = TMP_1 = function(finish) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("downto", finish)
      };
      
      for (var i = self; i >= finish; i--) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    Opal.defn(self, '$eql?', def['$==']);

    Opal.defn(self, '$equal?', def['$==']);

    def['$even?'] = function() {
      var self = this;

      return self % 2 === 0;
    };

    def.$floor = function() {
      var self = this;

      return Math.floor(self);
    };

    def.$gcd = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Integer')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('TypeError'), "not an integer")
      };
      
      var min = Math.abs(self),
          max = Math.abs(other);

      while (min > 0) {
        var tmp = min;

        min = max % min;
        max = tmp;
      }

      return max;
    
    };

    def.$gcdlcm = function(other) {
      var self = this;

      return [self.$gcd(), self.$lcm()];
    };

    def.$hash = function() {
      var self = this;

      return 'Numeric:'+self.toString();
    };

    def['$integer?'] = function() {
      var self = this;

      return self % 1 === 0;
    };

    def['$is_a?'] = TMP_2 = function(klass) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, self = this, $iter = TMP_2.$$p, $yield = $iter || nil;

      TMP_2.$$p = null;
      if ((($a = (($b = klass['$==']($scope.get('Fixnum'))) ? $scope.get('Integer')['$==='](self) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']($scope.get('Integer'))) ? $scope.get('Integer')['$==='](self) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']($scope.get('Float'))) ? $scope.get('Float')['$==='](self) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      return Opal.find_super_dispatcher(self, 'is_a?', TMP_2, $iter).apply(self, $zuper);
    };

    Opal.defn(self, '$kind_of?', def['$is_a?']);

    def['$instance_of?'] = TMP_3 = function(klass) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, self = this, $iter = TMP_3.$$p, $yield = $iter || nil;

      TMP_3.$$p = null;
      if ((($a = (($b = klass['$==']($scope.get('Fixnum'))) ? $scope.get('Integer')['$==='](self) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']($scope.get('Integer'))) ? $scope.get('Integer')['$==='](self) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']($scope.get('Float'))) ? $scope.get('Float')['$==='](self) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true};
      return Opal.find_super_dispatcher(self, 'instance_of?', TMP_3, $iter).apply(self, $zuper);
    };

    def.$lcm = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Integer')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('TypeError'), "not an integer")
      };
      
      if (self == 0 || other == 0) {
        return 0;
      }
      else {
        return Math.abs(self * other / self.$gcd(other));
      }
    
    };

    Opal.defn(self, '$magnitude', def.$abs);

    Opal.defn(self, '$modulo', def['$%']);

    def.$next = function() {
      var self = this;

      return self + 1;
    };

    def['$nonzero?'] = function() {
      var self = this;

      return self == 0 ? nil : self;
    };

    def['$odd?'] = function() {
      var self = this;

      return self % 2 !== 0;
    };

    def.$ord = function() {
      var self = this;

      return self;
    };

    def.$pred = function() {
      var self = this;

      return self - 1;
    };

    def.$round = function(ndigits) {
      var self = this;

      if (ndigits == null) {
        ndigits = 0
      }
      
      var scale = Math.pow(10, ndigits);
      return Math.round(self * scale) / scale;
    
    };

    def.$step = TMP_4 = function(limit, step) {
      var $a, self = this, $iter = TMP_4.$$p, block = $iter || nil;

      if (step == null) {
        step = 1
      }
      TMP_4.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("step", limit, step)
      };
      if ((($a = step == 0) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "step cannot be 0")};
      
      var value = self;

      if (step > 0) {
        while (value <= limit) {
          block(value);
          value += step;
        }
      }
      else {
        while (value >= limit) {
          block(value);
          value += step;
        }
      }
    
      return self;
    };

    Opal.defn(self, '$succ', def.$next);

    def.$times = TMP_5 = function() {
      var self = this, $iter = TMP_5.$$p, block = $iter || nil;

      TMP_5.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("times")
      };
      
      for (var i = 0; i < self; i++) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def.$to_f = function() {
      var self = this;

      return self;
    };

    def.$to_i = function() {
      var self = this;

      return parseInt(self);
    };

    Opal.defn(self, '$to_int', def.$to_i);

    def.$to_s = function(base) {
      var $a, $b, self = this;

      if (base == null) {
        base = 10
      }
      if ((($a = ((($b = base['$<'](2)) !== false && $b !== nil) ? $b : base['$>'](36))) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "base must be between 2 and 36")};
      return self.toString(base);
    };

    Opal.defn(self, '$inspect', def.$to_s);

    def.$divmod = function(rhs) {
      var self = this, q = nil, r = nil;

      q = (self['$/'](rhs)).$floor();
      r = self['$%'](rhs);
      return [q, r];
    };

    def.$upto = TMP_6 = function(finish) {
      var self = this, $iter = TMP_6.$$p, block = $iter || nil;

      TMP_6.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("upto", finish)
      };
      
      for (var i = self; i <= finish; i++) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$zero?'] = function() {
      var self = this;

      return self == 0;
    };

    def.$size = function() {
      var self = this;

      return 4;
    };

    def['$nan?'] = function() {
      var self = this;

      return isNaN(self);
    };

    def['$finite?'] = function() {
      var self = this;

      return self != Infinity && self != -Infinity;
    };

    def['$infinite?'] = function() {
      var self = this;

      
      if (self == Infinity) {
        return +1;
      }
      else if (self == -Infinity) {
        return -1;
      }
      else {
        return nil;
      }
    
    };

    def['$positive?'] = function() {
      var self = this;

      return 1 / self > 0;
    };

    return (def['$negative?'] = function() {
      var self = this;

      return 1 / self < 0;
    }, nil) && 'negative?';
  })(self, null);
  Opal.cdecl($scope, 'Fixnum', $scope.get('Numeric'));
  (function($base, $super) {
    function $Integer(){};
    var self = $Integer = $klass($base, $super, 'Integer', $Integer);

    var def = self.$$proto, $scope = self.$$scope;

    return (Opal.defs(self, '$===', function(other) {
      var self = this;

      
      if (!other.$$is_number) {
        return false;
      }

      return (other % 1) === 0;
    
    }), nil) && '==='
  })(self, $scope.get('Numeric'));
  return (function($base, $super) {
    function $Float(){};
    var self = $Float = $klass($base, $super, 'Float', $Float);

    var def = self.$$proto, $scope = self.$$scope, $a;

    Opal.defs(self, '$===', function(other) {
      var self = this;

      return !!other.$$is_number;
    });

    Opal.cdecl($scope, 'INFINITY', Infinity);

    Opal.cdecl($scope, 'NAN', NaN);

    if ((($a = (typeof(Number.EPSILON) !== "undefined")) !== nil && (!$a.$$is_boolean || $a == true))) {
      return Opal.cdecl($scope, 'EPSILON', Number.EPSILON)
      } else {
      return Opal.cdecl($scope, 'EPSILON', 2.2204460492503130808472633361816E-16)
    };
  })(self, $scope.get('Numeric'));
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/complex"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  return (function($base, $super) {
    function $Complex(){};
    var self = $Complex = $klass($base, $super, 'Complex', $Complex);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('Numeric'))
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/rational"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  return (function($base, $super) {
    function $Rational(){};
    var self = $Rational = $klass($base, $super, 'Rational', $Rational);

    var def = self.$$proto, $scope = self.$$scope;

    return nil;
  })(self, $scope.get('Numeric'))
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/proc"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$raise']);
  return (function($base, $super) {
    function $Proc(){};
    var self = $Proc = $klass($base, $super, 'Proc', $Proc);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2;

    def.$$is_proc = true;

    def.$$is_lambda = false;

    Opal.defs(self, '$new', TMP_1 = function() {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        self.$raise($scope.get('ArgumentError'), "tried to create a Proc object without a block")
      };
      return block;
    });

    def.$call = TMP_2 = function(args) {
      var self = this, $iter = TMP_2.$$p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_2.$$p = null;
      
      if (block !== nil) {
        self.$$p = block;
      }

      var result;

      if (self.$$is_lambda) {
        result = self.apply(null, args);
      }
      else {
        result = Opal.yieldX(self, args);
      }

      if (result === $breaker) {
        return $breaker.$v;
      }

      return result;
    
    };

    Opal.defn(self, '$[]', def.$call);

    def.$to_proc = function() {
      var self = this;

      return self;
    };

    def['$lambda?'] = function() {
      var self = this;

      return !!self.$$is_lambda;
    };

    return (def.$arity = function() {
      var self = this;

      return self.length;
    }, nil) && 'arity';
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/method"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$attr_reader', '$class', '$arity', '$new', '$name']);
  (function($base, $super) {
    function $Method(){};
    var self = $Method = $klass($base, $super, 'Method', $Method);

    var def = self.$$proto, $scope = self.$$scope, TMP_1;

    def.method = def.receiver = def.owner = def.name = def.obj = nil;
    self.$attr_reader("owner", "receiver", "name");

    def.$initialize = function(receiver, method, name) {
      var self = this;

      self.receiver = receiver;
      self.owner = receiver.$class();
      self.name = name;
      return self.method = method;
    };

    def.$arity = function() {
      var self = this;

      return self.method.$arity();
    };

    def.$call = TMP_1 = function(args) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_1.$$p = null;
      
      self.method.$$p = block;

      return self.method.apply(self.receiver, args);
    ;
    };

    Opal.defn(self, '$[]', def.$call);

    def.$unbind = function() {
      var self = this;

      return $scope.get('UnboundMethod').$new(self.owner, self.method, self.name);
    };

    def.$to_proc = function() {
      var self = this;

      return self.method;
    };

    return (def.$inspect = function() {
      var self = this;

      return "#<Method: " + (self.obj.$class()) + "#" + (self.name) + "}>";
    }, nil) && 'inspect';
  })(self, null);
  return (function($base, $super) {
    function $UnboundMethod(){};
    var self = $UnboundMethod = $klass($base, $super, 'UnboundMethod', $UnboundMethod);

    var def = self.$$proto, $scope = self.$$scope;

    def.method = def.name = def.owner = nil;
    self.$attr_reader("owner", "name");

    def.$initialize = function(owner, method, name) {
      var self = this;

      self.owner = owner;
      self.method = method;
      return self.name = name;
    };

    def.$arity = function() {
      var self = this;

      return self.method.$arity();
    };

    def.$bind = function(object) {
      var self = this;

      return $scope.get('Method').$new(object, self.method, self.name);
    };

    return (def.$inspect = function() {
      var self = this;

      return "#<UnboundMethod: " + (self.owner.$name()) + "#" + (self.name) + ">";
    }, nil) && 'inspect';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/range"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$include', '$attr_reader', '$<=>', '$raise', '$include?', '$<=', '$<', '$enum_for', '$succ', '$!', '$==', '$===', '$exclude_end?', '$eql?', '$begin', '$end', '$-', '$abs', '$to_i', '$inspect']);
  self.$require("corelib/enumerable");
  return (function($base, $super) {
    function $Range(){};
    var self = $Range = $klass($base, $super, 'Range', $Range);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3;

    def.begin = def.exclude = def.end = nil;
    self.$include($scope.get('Enumerable'));

    def.$$is_range = true;

    self.$attr_reader("begin", "end");

    def.$initialize = function(first, last, exclude) {
      var $a, self = this;

      if (exclude == null) {
        exclude = false
      }
      if ((($a = first['$<=>'](last)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'))
      };
      self.begin = first;
      self.end = last;
      return self.exclude = exclude;
    };

    def['$=='] = function(other) {
      var self = this;

      
      if (!other.$$is_range) {
        return false;
      }

      return self.exclude === other.exclude &&
             self.begin   ==  other.begin &&
             self.end     ==  other.end;
    
    };

    def['$==='] = function(value) {
      var self = this;

      return self['$include?'](value);
    };

    def['$cover?'] = function(value) {
      var $a, $b, self = this;

      return (($a = self.begin['$<='](value)) ? ((function() {if ((($b = self.exclude) !== nil && (!$b.$$is_boolean || $b == true))) {
        return value['$<'](self.end)
        } else {
        return value['$<='](self.end)
      }; return nil; })()) : $a);
    };

    def.$each = TMP_1 = function() {
      var $a, $b, self = this, $iter = TMP_1.$$p, block = $iter || nil, current = nil, last = nil;

      TMP_1.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each")
      };
      current = self.begin;
      last = self.end;
      while (current['$<'](last)) {
      if (Opal.yield1(block, current) === $breaker) return $breaker.$v;
      current = current.$succ();};
      if ((($a = ($b = self.exclude['$!'](), $b !== false && $b !== nil ?current['$=='](last) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        if (Opal.yield1(block, current) === $breaker) return $breaker.$v};
      return self;
    };

    def['$eql?'] = function(other) {
      var $a, $b, self = this;

      if ((($a = $scope.get('Range')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return false
      };
      return ($a = ($b = self.exclude['$==='](other['$exclude_end?']()), $b !== false && $b !== nil ?self.begin['$eql?'](other.$begin()) : $b), $a !== false && $a !== nil ?self.end['$eql?'](other.$end()) : $a);
    };

    def['$exclude_end?'] = function() {
      var self = this;

      return self.exclude;
    };

    Opal.defn(self, '$first', def.$begin);

    Opal.defn(self, '$include?', def['$cover?']);

    Opal.defn(self, '$last', def.$end);

    def.$max = TMP_2 = function() {var $zuper = $slice.call(arguments, 0);
      var self = this, $iter = TMP_2.$$p, $yield = $iter || nil;

      TMP_2.$$p = null;
      if (($yield !== nil)) {
        return Opal.find_super_dispatcher(self, 'max', TMP_2, $iter).apply(self, $zuper)
        } else {
        return self.exclude ? self.end - 1 : self.end;
      };
    };

    Opal.defn(self, '$member?', def['$cover?']);

    def.$min = TMP_3 = function() {var $zuper = $slice.call(arguments, 0);
      var self = this, $iter = TMP_3.$$p, $yield = $iter || nil;

      TMP_3.$$p = null;
      if (($yield !== nil)) {
        return Opal.find_super_dispatcher(self, 'min', TMP_3, $iter).apply(self, $zuper)
        } else {
        return self.begin
      };
    };

    Opal.defn(self, '$member?', def['$include?']);

    def.$size = function() {
      var $a, $b, self = this, _begin = nil, _end = nil, infinity = nil;

      _begin = self.begin;
      _end = self.end;
      if ((($a = self.exclude) !== nil && (!$a.$$is_boolean || $a == true))) {
        _end = _end['$-'](1)};
      if ((($a = ($b = $scope.get('Numeric')['$==='](_begin), $b !== false && $b !== nil ?$scope.get('Numeric')['$==='](_end) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        return nil
      };
      if (_end['$<'](_begin)) {
        return 0};
      infinity = (($scope.get('Float')).$$scope.get('INFINITY'));
      if ((($a = ((($b = infinity['$=='](_begin.$abs())) !== false && $b !== nil) ? $b : _end.$abs()['$=='](infinity))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return infinity};
      return ((Math.abs(_end - _begin) + 1)).$to_i();
    };

    def.$step = function(n) {
      var self = this;

      if (n == null) {
        n = 1
      }
      return self.$raise($scope.get('NotImplementedError'));
    };

    def.$to_s = function() {
      var self = this;

      return self.begin.$inspect() + (self.exclude ? '...' : '..') + self.end.$inspect();
    };

    return Opal.defn(self, '$inspect', def.$to_s);
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/time"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$include', '$kind_of?', '$to_i', '$coerce_to', '$between?', '$raise', '$new', '$compact', '$nil?', '$===', '$<=>', '$to_f', '$strftime', '$is_a?', '$zero?', '$wday', '$utc?', '$warn', '$year', '$mon', '$day', '$yday', '$hour', '$min', '$sec', '$rjust', '$ljust', '$zone', '$to_s', '$[]', '$cweek_cyear', '$month', '$isdst', '$private', '$<=', '$!', '$==', '$-', '$ceil', '$/', '$+']);
  self.$require("corelib/comparable");
  return (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = self.$$proto, $scope = self.$$scope;

    def.tz_offset = nil;
    self.$include($scope.get('Comparable'));

    
    var days_of_week = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        short_days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        short_months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        long_months  = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  ;

    Opal.defs(self, '$at', function(seconds, frac) {
      var self = this;

      if (frac == null) {
        frac = 0
      }
      return new Date(seconds * 1000 + frac);
    });

    Opal.defs(self, '$new', function(year, month, day, hour, minute, second, utc_offset) {
      var self = this;

      
      switch (arguments.length) {
        case 1:
          return new Date(year, 0);

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
          return new Date(year, month - 1, day, hour, minute, second);

        default:
          return new Date();
      }
    
    });

    Opal.defs(self, '$local', function(year, month, day, hour, minute, second, millisecond) {
      var $a, self = this;

      if (month == null) {
        month = nil
      }
      if (day == null) {
        day = nil
      }
      if (hour == null) {
        hour = nil
      }
      if (minute == null) {
        minute = nil
      }
      if (second == null) {
        second = nil
      }
      if (millisecond == null) {
        millisecond = nil
      }
      if ((($a = arguments.length === 10) !== nil && (!$a.$$is_boolean || $a == true))) {
        
        var args = $slice.call(arguments).reverse();

        second = args[9];
        minute = args[8];
        hour   = args[7];
        day    = args[6];
        month  = args[5];
        year   = args[4];
      };
      year = (function() {if ((($a = year['$kind_of?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return year.$to_i()
        } else {
        return $scope.get('Opal').$coerce_to(year, $scope.get('Integer'), "to_int")
      }; return nil; })();
      month = (function() {if ((($a = month['$kind_of?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return month.$to_i()
        } else {
        return $scope.get('Opal').$coerce_to(((($a = month) !== false && $a !== nil) ? $a : 1), $scope.get('Integer'), "to_int")
      }; return nil; })();
      if ((($a = month['$between?'](1, 12)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "month out of range: " + (month))
      };
      day = (function() {if ((($a = day['$kind_of?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return day.$to_i()
        } else {
        return $scope.get('Opal').$coerce_to(((($a = day) !== false && $a !== nil) ? $a : 1), $scope.get('Integer'), "to_int")
      }; return nil; })();
      if ((($a = day['$between?'](1, 31)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "day out of range: " + (day))
      };
      hour = (function() {if ((($a = hour['$kind_of?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return hour.$to_i()
        } else {
        return $scope.get('Opal').$coerce_to(((($a = hour) !== false && $a !== nil) ? $a : 0), $scope.get('Integer'), "to_int")
      }; return nil; })();
      if ((($a = hour['$between?'](0, 24)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "hour out of range: " + (hour))
      };
      minute = (function() {if ((($a = minute['$kind_of?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return minute.$to_i()
        } else {
        return $scope.get('Opal').$coerce_to(((($a = minute) !== false && $a !== nil) ? $a : 0), $scope.get('Integer'), "to_int")
      }; return nil; })();
      if ((($a = minute['$between?'](0, 59)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "minute out of range: " + (minute))
      };
      second = (function() {if ((($a = second['$kind_of?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
        return second.$to_i()
        } else {
        return $scope.get('Opal').$coerce_to(((($a = second) !== false && $a !== nil) ? $a : 0), $scope.get('Integer'), "to_int")
      }; return nil; })();
      if ((($a = second['$between?'](0, 59)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "second out of range: " + (second))
      };
      return ($a = self).$new.apply($a, [].concat([year, month, day, hour, minute, second].$compact()));
    });

    Opal.defs(self, '$gm', function(year, month, day, hour, minute, second, utc_offset) {
      var $a, self = this;

      if ((($a = year['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('TypeError'), "missing year (got nil)")};
      
      if (month > 12 || day > 31 || hour > 24 || minute > 59 || second > 59) {
        self.$raise($scope.get('ArgumentError'));
      }

      var date = new Date(Date.UTC(year, (month || 1) - 1, (day || 1), (hour || 0), (minute || 0), (second || 0)));
      date.tz_offset = 0
      return date;
    ;
    });

    (function(self) {
      var $scope = self.$$scope, def = self.$$proto;

      self.$$proto.$mktime = self.$$proto.$local;
      return self.$$proto.$utc = self.$$proto.$gm;
    })(self.$singleton_class());

    Opal.defs(self, '$now', function() {
      var self = this;

      return new Date();
    });

    def['$+'] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Time')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('TypeError'), "time + time?")};
      other = $scope.get('Opal').$coerce_to(other, $scope.get('Integer'), "to_int");
      
      var result           = new Date(self.getTime() + (other * 1000));
          result.tz_offset = self.tz_offset;

      return result;
    
    };

    def['$-'] = function(other) {
      var $a, self = this;

      if ((($a = $scope.get('Time')['$==='](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return (self.getTime() - other.getTime()) / 1000};
      other = $scope.get('Opal').$coerce_to(other, $scope.get('Integer'), "to_int");
      
      var result           = new Date(self.getTime() - (other * 1000));
          result.tz_offset = self.tz_offset;

      return result;
    
    };

    def['$<=>'] = function(other) {
      var self = this;

      return self.$to_f()['$<=>'](other.$to_f());
    };

    def['$=='] = function(other) {
      var self = this;

      return self.$to_f() === other.$to_f();
    };

    def.$asctime = function() {
      var self = this;

      return self.$strftime("%a %b %e %H:%M:%S %Y");
    };

    Opal.defn(self, '$ctime', def.$asctime);

    def.$day = function() {
      var self = this;

      
      if (self.tz_offset === 0) {
        return self.getUTCDate();
      }
      else {
        return self.getDate();
      }
    ;
    };

    def.$yday = function() {
      var self = this;

      
      // http://javascript.about.com/library/bldayyear.htm
      var onejan = new Date(self.getFullYear(), 0, 1);
      return Math.ceil((self - onejan) / 86400000);
    
    };

    def.$isdst = function() {
      var self = this;

      return self.$raise($scope.get('NotImplementedError'));
    };

    def['$eql?'] = function(other) {
      var $a, self = this;

      return ($a = other['$is_a?']($scope.get('Time')), $a !== false && $a !== nil ?(self['$<=>'](other))['$zero?']() : $a);
    };

    def['$friday?'] = function() {
      var self = this;

      return self.$wday() == 5;
    };

    def.$hour = function() {
      var self = this;

      
      if (self.tz_offset === 0) {
        return self.getUTCHours();
      }
      else {
        return self.getHours();
      }
    ;
    };

    def.$inspect = function() {
      var $a, self = this;

      if ((($a = self['$utc?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.$strftime("%Y-%m-%d %H:%M:%S UTC")
        } else {
        return self.$strftime("%Y-%m-%d %H:%M:%S %z")
      };
    };

    Opal.defn(self, '$mday', def.$day);

    def.$min = function() {
      var self = this;

      
      if (self.tz_offset === 0) {
        return self.getUTCMinutes();
      }
      else {
        return self.getMinutes();
      }
    ;
    };

    def.$mon = function() {
      var self = this;

      
      if (self.tz_offset === 0) {
        return self.getUTCMonth() + 1;
      }
      else {
        return self.getMonth() + 1;
      }
    ;
    };

    def['$monday?'] = function() {
      var self = this;

      return self.$wday() == 1;
    };

    Opal.defn(self, '$month', def.$mon);

    def['$saturday?'] = function() {
      var self = this;

      return self.$wday() == 6;
    };

    def.$sec = function() {
      var self = this;

      
      if (self.tz_offset === 0) {
        return self.getUTCSeconds();
      }
      else {
        return self.getSeconds();
      }
    ;
    };

    def.$usec = function() {
      var self = this;

      self.$warn("Microseconds are not supported");
      return 0;
    };

    def.$zone = function() {
      var self = this;

      
      var string = self.toString(),
          result;

      if (string.indexOf('(') == -1) {
        result = string.match(/[A-Z]{3,4}/)[0];
      }
      else {
        result = string.match(/\([^)]+\)/)[0].match(/[A-Z]/g).join('');
      }

      if (result == "GMT" && /(GMT\W*\d{4})/.test(string)) {
        return RegExp.$1;
      }
      else {
        return result;
      }
    
    };

    def.$getgm = function() {
      var self = this;

      
      var result           = new Date(self.getTime());
          result.tz_offset = 0;

      return result;
    
    };

    def['$gmt?'] = function() {
      var self = this;

      return self.tz_offset === 0;
    };

    def.$gmt_offset = function() {
      var self = this;

      return -self.getTimezoneOffset() * 60;
    };

    def.$strftime = function(format) {
      var self = this;

      
      return format.replace(/%([\-_#^0]*:{0,2})(\d+)?([EO]*)(.)/g, function(full, flags, width, _, conv) {
        var result = "",
            width  = parseInt(width),
            zero   = flags.indexOf('0') !== -1,
            pad    = flags.indexOf('-') === -1,
            blank  = flags.indexOf('_') !== -1,
            upcase = flags.indexOf('^') !== -1,
            invert = flags.indexOf('#') !== -1,
            colons = (flags.match(':') || []).length;

        if (zero && blank) {
          if (flags.indexOf('0') < flags.indexOf('_')) {
            zero = false;
          }
          else {
            blank = false;
          }
        }

        switch (conv) {
          case 'Y':
            result += self.$year();
            break;

          case 'C':
            zero    = !blank;
            result += Math.round(self.$year() / 100);
            break;

          case 'y':
            zero    = !blank;
            result += (self.$year() % 100);
            break;

          case 'm':
            zero    = !blank;
            result += self.$mon();
            break;

          case 'B':
            result += long_months[self.$mon() - 1];
            break;

          case 'b':
          case 'h':
            blank   = !zero;
            result += short_months[self.$mon() - 1];
            break;

          case 'd':
            zero    = !blank
            result += self.$day();
            break;

          case 'e':
            blank   = !zero
            result += self.$day();
            break;

          case 'j':
            result += self.$yday();
            break;

          case 'H':
            zero    = !blank;
            result += self.$hour();
            break;

          case 'k':
            blank   = !zero;
            result += self.$hour();
            break;

          case 'I':
            zero    = !blank;
            result += (self.$hour() % 12 || 12);
            break;

          case 'l':
            blank   = !zero;
            result += (self.$hour() % 12 || 12);
            break;

          case 'P':
            result += (self.$hour() >= 12 ? "pm" : "am");
            break;

          case 'p':
            result += (self.$hour() >= 12 ? "PM" : "AM");
            break;

          case 'M':
            zero    = !blank;
            result += self.$min();
            break;

          case 'S':
            zero    = !blank;
            result += self.$sec()
            break;

          case 'L':
            zero    = !blank;
            width   = isNaN(width) ? 3 : width;
            result += self.getMilliseconds();
            break;

          case 'N':
            width   = isNaN(width) ? 9 : width;
            result += (self.getMilliseconds().toString()).$rjust(3, "0");
            result  = (result).$ljust(width, "0");
            break;

          case 'z':
            var offset  = self.getTimezoneOffset(),
                hours   = Math.floor(Math.abs(offset) / 60),
                minutes = Math.abs(offset) % 60;

            result += offset < 0 ? "+" : "-";
            result += hours < 10 ? "0" : "";
            result += hours;

            if (colons > 0) {
              result += ":";
            }

            result += minutes < 10 ? "0" : "";
            result += minutes;

            if (colons > 1) {
              result += ":00";
            }

            break;

          case 'Z':
            result += self.$zone();
            break;

          case 'A':
            result += days_of_week[self.$wday()];
            break;

          case 'a':
            result += short_days[self.$wday()];
            break;

          case 'u':
            result += (self.$wday() + 1);
            break;

          case 'w':
            result += self.$wday();
            break;

          case 'V':
            result += self.$cweek_cyear()['$[]'](0).$to_s().$rjust(2, "0");
            break;

          case 'G':
            result += self.$cweek_cyear()['$[]'](1);
            break;

          case 'g':
            result += self.$cweek_cyear()['$[]'](1)['$[]']($range(-2, -1, false));
            break;

          case 's':
            result += self.$to_i();
            break;

          case 'n':
            result += "\n";
            break;

          case 't':
            result += "\t";
            break;

          case '%':
            result += "%";
            break;

          case 'c':
            result += self.$strftime("%a %b %e %T %Y");
            break;

          case 'D':
          case 'x':
            result += self.$strftime("%m/%d/%y");
            break;

          case 'F':
            result += self.$strftime("%Y-%m-%d");
            break;

          case 'v':
            result += self.$strftime("%e-%^b-%4Y");
            break;

          case 'r':
            result += self.$strftime("%I:%M:%S %p");
            break;

          case 'R':
            result += self.$strftime("%H:%M");
            break;

          case 'T':
          case 'X':
            result += self.$strftime("%H:%M:%S");
            break;

          default:
            return full;
        }

        if (upcase) {
          result = result.toUpperCase();
        }

        if (invert) {
          result = result.replace(/[A-Z]/, function(c) { c.toLowerCase() }).
                          replace(/[a-z]/, function(c) { c.toUpperCase() });
        }

        if (pad && (zero || blank)) {
          result = (result).$rjust(isNaN(width) ? 2 : width, blank ? " " : "0");
        }

        return result;
      });
    
    };

    def['$sunday?'] = function() {
      var self = this;

      return self.$wday() == 0;
    };

    def['$thursday?'] = function() {
      var self = this;

      return self.$wday() == 4;
    };

    def.$to_a = function() {
      var self = this;

      return [self.$sec(), self.$min(), self.$hour(), self.$day(), self.$month(), self.$year(), self.$wday(), self.$yday(), self.$isdst(), self.$zone()];
    };

    def.$to_f = function() {
      var self = this;

      return self.getTime() / 1000;
    };

    def.$to_i = function() {
      var self = this;

      return parseInt(self.getTime() / 1000);
    };

    Opal.defn(self, '$to_s', def.$inspect);

    def['$tuesday?'] = function() {
      var self = this;

      return self.$wday() == 2;
    };

    Opal.defn(self, '$utc?', def['$gmt?']);

    Opal.defn(self, '$utc_offset', def.$gmt_offset);

    def.$wday = function() {
      var self = this;

      
      if (self.tz_offset === 0) {
        return self.getUTCDay();
      }
      else {
        return self.getDay();
      }
    ;
    };

    def['$wednesday?'] = function() {
      var self = this;

      return self.$wday() == 3;
    };

    def.$year = function() {
      var self = this;

      
      if (self.tz_offset === 0) {
        return self.getUTCFullYear();
      }
      else {
        return self.getFullYear();
      }
    ;
    };

    self.$private("cweek_cyear");

    return (def.$cweek_cyear = function() {
      var $a, $b, self = this, jan01 = nil, jan01_wday = nil, first_monday = nil, year = nil, offset = nil, week = nil, dec31 = nil, dec31_wday = nil;

      jan01 = $scope.get('Time').$new(self.$year(), 1, 1);
      jan01_wday = jan01.$wday();
      first_monday = 0;
      year = self.$year();
      if ((($a = (($b = jan01_wday['$<='](4)) ? jan01_wday['$=='](0)['$!']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        offset = jan01_wday['$-'](1)
        } else {
        offset = jan01_wday['$-'](7)['$-'](1);
        if (offset['$=='](-8)) {
          offset = -1};
      };
      week = ((self.$yday()['$+'](offset))['$/'](7.0)).$ceil();
      if (week['$<='](0)) {
        return $scope.get('Time').$new(self.$year()['$-'](1), 12, 31).$cweek_cyear()
      } else if (week['$=='](53)) {
        dec31 = $scope.get('Time').$new(self.$year(), 12, 31);
        dec31_wday = dec31.$wday();
        if ((($a = (($b = dec31_wday['$<='](3)) ? dec31_wday['$=='](0)['$!']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          week = 1;
          year = year['$+'](1);};};
      return [week, year];
    }, nil) && 'cweek_cyear';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/struct"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$==', '$[]', '$upcase', '$const_set', '$new', '$unshift', '$each', '$define_struct_attribute', '$instance_eval', '$to_proc', '$raise', '$<<', '$members', '$define_method', '$instance_variable_get', '$instance_variable_set', '$include', '$each_with_index', '$class', '$===', '$>=', '$size', '$include?', '$to_sym', '$enum_for', '$hash', '$all?', '$length', '$map', '$+', '$join', '$inspect', '$each_pair']);
  return (function($base, $super) {
    function $Struct(){};
    var self = $Struct = $klass($base, $super, 'Struct', $Struct);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_8, TMP_10;

    Opal.defs(self, '$new', TMP_1 = function(name, args) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, $c, TMP_2, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_1.$$p = null;
      if (self['$==']($scope.get('Struct'))) {
        } else {
        return Opal.find_super_dispatcher(self, 'new', TMP_1, $iter, $Struct).apply(self, $zuper)
      };
      if (name['$[]'](0)['$=='](name['$[]'](0).$upcase())) {
        return $scope.get('Struct').$const_set(name, ($a = self).$new.apply($a, [].concat(args)))
        } else {
        args.$unshift(name);
        return ($b = ($c = $scope.get('Class')).$new, $b.$$p = (TMP_2 = function(){var self = TMP_2.$$s || this, $a, $b, TMP_3, $c;

        ($a = ($b = args).$each, $a.$$p = (TMP_3 = function(arg){var self = TMP_3.$$s || this;
if (arg == null) arg = nil;
          return self.$define_struct_attribute(arg)}, TMP_3.$$s = self, TMP_3), $a).call($b);
          if (block !== false && block !== nil) {
            return ($a = ($c = self).$instance_eval, $a.$$p = block.$to_proc(), $a).call($c)
            } else {
            return nil
          };}, TMP_2.$$s = self, TMP_2), $b).call($c, self);
      };
    });

    Opal.defs(self, '$define_struct_attribute', function(name) {
      var $a, $b, TMP_4, $c, TMP_5, self = this;

      if (self['$==']($scope.get('Struct'))) {
        self.$raise($scope.get('ArgumentError'), "you cannot define attributes to the Struct class")};
      self.$members()['$<<'](name);
      ($a = ($b = self).$define_method, $a.$$p = (TMP_4 = function(){var self = TMP_4.$$s || this;

      return self.$instance_variable_get("@" + (name))}, TMP_4.$$s = self, TMP_4), $a).call($b, name);
      return ($a = ($c = self).$define_method, $a.$$p = (TMP_5 = function(value){var self = TMP_5.$$s || this;
if (value == null) value = nil;
      return self.$instance_variable_set("@" + (name), value)}, TMP_5.$$s = self, TMP_5), $a).call($c, "" + (name) + "=");
    });

    Opal.defs(self, '$members', function() {
      var $a, self = this;
      if (self.members == null) self.members = nil;

      if (self['$==']($scope.get('Struct'))) {
        self.$raise($scope.get('ArgumentError'), "the Struct class has no members")};
      return ((($a = self.members) !== false && $a !== nil) ? $a : self.members = []);
    });

    Opal.defs(self, '$inherited', function(klass) {
      var $a, $b, TMP_6, self = this, members = nil;
      if (self.members == null) self.members = nil;

      if (self['$==']($scope.get('Struct'))) {
        return nil};
      members = self.members;
      return ($a = ($b = klass).$instance_eval, $a.$$p = (TMP_6 = function(){var self = TMP_6.$$s || this;

      return self.members = members}, TMP_6.$$s = self, TMP_6), $a).call($b);
    });

    (function(self) {
      var $scope = self.$$scope, def = self.$$proto;

      return self.$$proto['$[]'] = self.$$proto.$new
    })(self.$singleton_class());

    self.$include($scope.get('Enumerable'));

    def.$initialize = function(args) {
      var $a, $b, TMP_7, self = this;

      args = $slice.call(arguments, 0);
      return ($a = ($b = self.$members()).$each_with_index, $a.$$p = (TMP_7 = function(name, index){var self = TMP_7.$$s || this;
if (name == null) name = nil;if (index == null) index = nil;
      return self.$instance_variable_set("@" + (name), args['$[]'](index))}, TMP_7.$$s = self, TMP_7), $a).call($b);
    };

    def.$members = function() {
      var self = this;

      return self.$class().$members();
    };

    def['$[]'] = function(name) {
      var $a, self = this;

      if ((($a = $scope.get('Integer')['$==='](name)) !== nil && (!$a.$$is_boolean || $a == true))) {
        if (name['$>='](self.$members().$size())) {
          self.$raise($scope.get('IndexError'), "offset " + (name) + " too large for struct(size:" + (self.$members().$size()) + ")")};
        name = self.$members()['$[]'](name);
      } else if ((($a = self.$members()['$include?'](name.$to_sym())) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('NameError'), "no member '" + (name) + "' in struct")
      };
      return self.$instance_variable_get("@" + (name));
    };

    def['$[]='] = function(name, value) {
      var $a, self = this;

      if ((($a = $scope.get('Integer')['$==='](name)) !== nil && (!$a.$$is_boolean || $a == true))) {
        if (name['$>='](self.$members().$size())) {
          self.$raise($scope.get('IndexError'), "offset " + (name) + " too large for struct(size:" + (self.$members().$size()) + ")")};
        name = self.$members()['$[]'](name);
      } else if ((($a = self.$members()['$include?'](name.$to_sym())) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('NameError'), "no member '" + (name) + "' in struct")
      };
      return self.$instance_variable_set("@" + (name), value);
    };

    def.$each = TMP_8 = function() {
      var $a, $b, TMP_9, self = this, $iter = TMP_8.$$p, $yield = $iter || nil;

      TMP_8.$$p = null;
      if (($yield !== nil)) {
        } else {
        return self.$enum_for("each")
      };
      ($a = ($b = self.$members()).$each, $a.$$p = (TMP_9 = function(name){var self = TMP_9.$$s || this, $a;
if (name == null) name = nil;
      return $a = Opal.yield1($yield, self['$[]'](name)), $a === $breaker ? $a : $a}, TMP_9.$$s = self, TMP_9), $a).call($b);
      return self;
    };

    def.$each_pair = TMP_10 = function() {
      var $a, $b, TMP_11, self = this, $iter = TMP_10.$$p, $yield = $iter || nil;

      TMP_10.$$p = null;
      if (($yield !== nil)) {
        } else {
        return self.$enum_for("each_pair")
      };
      ($a = ($b = self.$members()).$each, $a.$$p = (TMP_11 = function(name){var self = TMP_11.$$s || this, $a;
if (name == null) name = nil;
      return $a = Opal.yieldX($yield, [name, self['$[]'](name)]), $a === $breaker ? $a : $a}, TMP_11.$$s = self, TMP_11), $a).call($b);
      return self;
    };

    def['$eql?'] = function(other) {
      var $a, $b, $c, TMP_12, self = this;

      return ((($a = self.$hash()['$=='](other.$hash())) !== false && $a !== nil) ? $a : ($b = ($c = other.$each_with_index())['$all?'], $b.$$p = (TMP_12 = function(object, index){var self = TMP_12.$$s || this;
if (object == null) object = nil;if (index == null) index = nil;
      return self['$[]'](self.$members()['$[]'](index))['$=='](object)}, TMP_12.$$s = self, TMP_12), $b).call($c));
    };

    def.$length = function() {
      var self = this;

      return self.$members().$length();
    };

    Opal.defn(self, '$size', def.$length);

    def.$to_a = function() {
      var $a, $b, TMP_13, self = this;

      return ($a = ($b = self.$members()).$map, $a.$$p = (TMP_13 = function(name){var self = TMP_13.$$s || this;
if (name == null) name = nil;
      return self['$[]'](name)}, TMP_13.$$s = self, TMP_13), $a).call($b);
    };

    Opal.defn(self, '$values', def.$to_a);

    def.$inspect = function() {
      var $a, $b, TMP_14, self = this, result = nil;

      result = "#<struct ";
      if (self.$class()['$==']($scope.get('Struct'))) {
        result = result['$+']("" + (self.$class()) + " ")};
      result = result['$+'](($a = ($b = self.$each_pair()).$map, $a.$$p = (TMP_14 = function(name, value){var self = TMP_14.$$s || this;
if (name == null) name = nil;if (value == null) value = nil;
      return "" + (name) + "=" + (value.$inspect())}, TMP_14.$$s = self, TMP_14), $a).call($b).$join(", "));
      result = result['$+'](">");
      return result;
    };

    return Opal.defn(self, '$to_s', def.$inspect);
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/io"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var $a, $b, self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $module = Opal.module, $gvars = Opal.gvars;
  if ($gvars.stdout == null) $gvars.stdout = nil;
  if ($gvars.stderr == null) $gvars.stderr = nil;

  Opal.add_stubs(['$attr_accessor', '$size', '$write', '$join', '$map', '$String', '$concat', '$chomp', '$getbyte', '$getc', '$raise', '$new', '$write_proc=', '$extend']);
  (function($base, $super) {
    function $IO(){};
    var self = $IO = $klass($base, $super, 'IO', $IO);

    var def = self.$$proto, $scope = self.$$scope;

    Opal.cdecl($scope, 'SEEK_SET', 0);

    Opal.cdecl($scope, 'SEEK_CUR', 1);

    Opal.cdecl($scope, 'SEEK_END', 2);

    self.$attr_accessor("write_proc");

    def.$write = function(string) {
      var self = this;

      self.write_proc(string);
      return string.$size();
    };

    (function($base) {
      var self = $module($base, 'Writable');

      var def = self.$$proto, $scope = self.$$scope;

      def['$<<'] = function(string) {
        var self = this;

        self.$write(string);
        return self;
      };

      def.$print = function(args) {
        var $a, $b, TMP_1, self = this;
        if ($gvars[","] == null) $gvars[","] = nil;

        args = $slice.call(arguments, 0);
        self.$write(($a = ($b = args).$map, $a.$$p = (TMP_1 = function(arg){var self = TMP_1.$$s || this;
if (arg == null) arg = nil;
        return self.$String(arg)}, TMP_1.$$s = self, TMP_1), $a).call($b).$join($gvars[","]));
        return nil;
      };

      def.$puts = function(args) {
        var $a, $b, TMP_2, self = this, newline = nil;
        if ($gvars["/"] == null) $gvars["/"] = nil;

        args = $slice.call(arguments, 0);
        newline = $gvars["/"];
        self.$write(($a = ($b = args).$map, $a.$$p = (TMP_2 = function(arg){var self = TMP_2.$$s || this;
if (arg == null) arg = nil;
        return self.$String(arg).$chomp()}, TMP_2.$$s = self, TMP_2), $a).call($b).$concat([nil]).$join(newline));
        return nil;
      };
            ;Opal.donate(self, ["$<<", "$print", "$puts"]);
    })(self);

    return (function($base) {
      var self = $module($base, 'Readable');

      var def = self.$$proto, $scope = self.$$scope;

      def.$readbyte = function() {
        var self = this;

        return self.$getbyte();
      };

      def.$readchar = function() {
        var self = this;

        return self.$getc();
      };

      def.$readline = function(sep) {
        var self = this;
        if ($gvars["/"] == null) $gvars["/"] = nil;

        if (sep == null) {
          sep = $gvars["/"]
        }
        return self.$raise($scope.get('NotImplementedError'));
      };

      def.$readpartial = function(integer, outbuf) {
        var self = this;

        if (outbuf == null) {
          outbuf = nil
        }
        return self.$raise($scope.get('NotImplementedError'));
      };
            ;Opal.donate(self, ["$readbyte", "$readchar", "$readline", "$readpartial"]);
    })(self);
  })(self, null);
  Opal.cdecl($scope, 'STDERR', $gvars.stderr = $scope.get('IO').$new());
  Opal.cdecl($scope, 'STDIN', $gvars.stdin = $scope.get('IO').$new());
  Opal.cdecl($scope, 'STDOUT', $gvars.stdout = $scope.get('IO').$new());
  (($a = [typeof(process) === 'object' ? function(s){process.stdout.write(s)} : function(s){console.log(s)}]), $b = $gvars.stdout, $b['$write_proc='].apply($b, $a), $a[$a.length-1]);
  (($a = [typeof(process) === 'object' ? function(s){process.stderr.write(s)} : function(s){console.warn(s)}]), $b = $gvars.stderr, $b['$write_proc='].apply($b, $a), $a[$a.length-1]);
  $gvars.stdout.$extend((($scope.get('IO')).$$scope.get('Writable')));
  return $gvars.stderr.$extend((($scope.get('IO')).$$scope.get('Writable')));
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/main"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice;

  Opal.add_stubs(['$include']);
  Opal.defs(self, '$to_s', function() {
    var self = this;

    return "main";
  });
  return (Opal.defs(self, '$include', function(mod) {
    var self = this;

    return $scope.get('Object').$include(mod);
  }), nil) && 'include';
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/variables"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $gvars = Opal.gvars, $hash2 = Opal.hash2;

  Opal.add_stubs(['$new']);
  $gvars["&"] = $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
  $gvars.LOADED_FEATURES = $gvars["\""] = Opal.loaded_features;
  $gvars.LOAD_PATH = $gvars[":"] = [];
  $gvars["/"] = "\n";
  $gvars[","] = nil;
  Opal.cdecl($scope, 'ARGV', []);
  Opal.cdecl($scope, 'ARGF', $scope.get('Object').$new());
  Opal.cdecl($scope, 'ENV', $hash2([], {}));
  $gvars.VERBOSE = false;
  $gvars.DEBUG = false;
  $gvars.SAFE = 0;
  Opal.cdecl($scope, 'RUBY_PLATFORM', "opal");
  Opal.cdecl($scope, 'RUBY_ENGINE', "opal");
  Opal.cdecl($scope, 'RUBY_VERSION', "2.1.1");
  Opal.cdecl($scope, 'RUBY_ENGINE_VERSION', "0.6.1");
  return Opal.cdecl($scope, 'RUBY_RELEASE_DATE', "2014-04-15");
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/dir"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$[]']);
  return (function($base, $super) {
    function $Dir(){};
    var self = $Dir = $klass($base, $super, 'Dir', $Dir);

    var def = self.$$proto, $scope = self.$$scope;

    return (function(self) {
      var $scope = self.$$scope, def = self.$$proto;

      self.$$proto.$chdir = TMP_1 = function(dir) {
        var $a, self = this, $iter = TMP_1.$$p, $yield = $iter || nil, prev_cwd = nil;

        TMP_1.$$p = null;
        try {
        prev_cwd = Opal.current_dir;
        Opal.current_dir = dir;
        return $a = Opal.yieldX($yield, []), $a === $breaker ? $a : $a;
        } finally {
        Opal.current_dir = prev_cwd;
        };
      };
      self.$$proto.$pwd = function() {
        var $a, self = this;

        return ((($a = Opal.current_dir) !== false && $a !== nil) ? $a : ".");
      };
      self.$$proto.$getwd = self.$$proto.$pwd;
      return (self.$$proto.$home = function() {
        var $a, self = this;

        return ((($a = $scope.get('ENV')['$[]']("HOME")) !== false && $a !== nil) ? $a : ".");
      }, nil) && 'home';
    })(self.$singleton_class())
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["corelib/file"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$join', '$compact', '$split', '$==', '$first', '$[]=', '$home', '$each', '$pop', '$<<', '$[]', '$gsub', '$find', '$=~']);
  return (function($base, $super) {
    function $File(){};
    var self = $File = $klass($base, $super, 'File', $File);

    var def = self.$$proto, $scope = self.$$scope;

    Opal.cdecl($scope, 'Separator', Opal.cdecl($scope, 'SEPARATOR', "/"));

    return (function(self) {
      var $scope = self.$$scope, def = self.$$proto;

      self.$$proto.$expand_path = function(path, basedir) {
        var $a, $b, TMP_1, self = this, parts = nil, new_parts = nil;

        if (basedir == null) {
          basedir = nil
        }
        path = [basedir, path].$compact().$join($scope.get('SEPARATOR'));
        parts = path.$split($scope.get('SEPARATOR'));
        new_parts = [];
        if (parts.$first()['$==']("~")) {
          parts['$[]='](0, $scope.get('Dir').$home())};
        ($a = ($b = parts).$each, $a.$$p = (TMP_1 = function(part){var self = TMP_1.$$s || this;
if (part == null) part = nil;
        if (part['$==']("..")) {
            return new_parts.$pop()
            } else {
            return new_parts['$<<'](part)
          }}, TMP_1.$$s = self, TMP_1), $a).call($b);
        return new_parts.$join($scope.get('SEPARATOR'));
      };
      self.$$proto.$dirname = function(path) {
        var self = this;

        return self.$split(path)['$[]']($range(0, -2, false));
      };
      self.$$proto.$basename = function(path) {
        var self = this;

        return self.$split(path)['$[]'](-1);
      };
      self.$$proto['$exist?'] = function(path) {
        var self = this;

        return Opal.modules[path] != null;
      };
      self.$$proto['$exists?'] = self.$$proto['$exist?'];
      self.$$proto['$directory?'] = function(path) {
        var $a, $b, TMP_2, self = this, files = nil, file = nil;

        files = [];
        
        for (var key in Opal.modules) {
          files.push(key)
        }
      ;
        path = path.$gsub((new RegExp("(^." + $scope.get('SEPARATOR') + "+|" + $scope.get('SEPARATOR') + "+$)")));
        file = ($a = ($b = files).$find, $a.$$p = (TMP_2 = function(file){var self = TMP_2.$$s || this;
if (file == null) file = nil;
        return file['$=~']((new RegExp("^" + path)))}, TMP_2.$$s = self, TMP_2), $a).call($b);
        return file;
      };
      self.$$proto.$join = function(paths) {
        var self = this;

        paths = $slice.call(arguments, 0);
        return paths.$join($scope.get('SEPARATOR')).$gsub((new RegExp("" + $scope.get('SEPARATOR') + "+")), $scope.get('SEPARATOR'));
      };
      return (self.$$proto.$split = function(path) {
        var self = this;

        return path.$split($scope.get('SEPARATOR'));
      }, nil) && 'split';
    })(self.$singleton_class());
  })(self, $scope.get('IO'))
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice;

  Opal.add_stubs(['$require']);
  self.$require("corelib/runtime");
  self.$require("corelib/helpers");
  self.$require("corelib/module");
  self.$require("corelib/class");
  self.$require("corelib/basic_object");
  self.$require("corelib/kernel");
  self.$require("corelib/nil_class");
  self.$require("corelib/boolean");
  self.$require("corelib/error");
  self.$require("corelib/regexp");
  self.$require("corelib/comparable");
  self.$require("corelib/enumerable");
  self.$require("corelib/enumerator");
  self.$require("corelib/array");
  self.$require("corelib/array/inheritance");
  self.$require("corelib/hash");
  self.$require("corelib/string");
  self.$require("corelib/string/inheritance");
  self.$require("corelib/match_data");
  self.$require("corelib/numeric");
  self.$require("corelib/complex");
  self.$require("corelib/rational");
  self.$require("corelib/proc");
  self.$require("corelib/method");
  self.$require("corelib/range");
  self.$require("corelib/time");
  self.$require("corelib/struct");
  self.$require("corelib/io");
  self.$require("corelib/main");
  self.$require("corelib/variables");
  self.$require("corelib/dir");
  return self.$require("corelib/file");
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["native"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $range = Opal.range, $hash2 = Opal.hash2, $klass = Opal.klass, $gvars = Opal.gvars;

  Opal.add_stubs(['$try_convert', '$native?', '$respond_to?', '$to_n', '$raise', '$inspect', '$Native', '$end_with?', '$define_method', '$[]', '$convert', '$call', '$to_proc', '$new', '$each', '$native_reader', '$native_writer', '$extend', '$to_a', '$to_ary', '$include', '$method_missing', '$bind', '$instance_method', '$[]=', '$slice', '$-', '$length', '$enum_for', '$===', '$>=', '$<<', '$==', '$instance_variable_set', '$members', '$each_with_index', '$each_pair', '$name']);
  (function($base) {
    var self = $module($base, 'Native');

    var def = self.$$proto, $scope = self.$$scope, TMP_1;

    Opal.defs(self, '$is_a?', function(object, klass) {
      var self = this;

      
      try {
        return object instanceof self.$try_convert(klass);
      }
      catch (e) {
        return false;
      }
    ;
    });

    Opal.defs(self, '$try_convert', function(value) {
      var self = this;

      
      if (self['$native?'](value)) {
        return value;
      }
      else if (value['$respond_to?']("to_n")) {
        return value.$to_n();
      }
      else {
        return nil;
      }
    ;
    });

    Opal.defs(self, '$convert', function(value) {
      var self = this;

      
      if (self['$native?'](value)) {
        return value;
      }
      else if (value['$respond_to?']("to_n")) {
        return value.$to_n();
      }
      else {
        self.$raise($scope.get('ArgumentError'), "" + (value.$inspect()) + " isn't native");
      }
    ;
    });

    Opal.defs(self, '$call', TMP_1 = function(obj, key, args) {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      args = $slice.call(arguments, 2);
      TMP_1.$$p = null;
      
      var prop = obj[key];

      if (prop instanceof Function) {
        var converted = new Array(args.length);

        for (var i = 0, length = args.length; i < length; i++) {
          var item = args[i],
              conv = self.$try_convert(item);

          converted[i] = conv === nil ? item : conv;
        }

        if (block !== nil) {
          converted.push(block);
        }

        return self.$Native(prop.apply(obj, converted));
      }
      else {
        return self.$Native(prop);
      }
    ;
    });

    (function($base) {
      var self = $module($base, 'Helpers');

      var def = self.$$proto, $scope = self.$$scope;

      def.$alias_native = function(new$, old, options) {
        var $a, $b, TMP_2, $c, TMP_3, $d, TMP_4, self = this, as = nil;

        if (old == null) {
          old = new$
        }
        if (options == null) {
          options = $hash2([], {})
        }
        if ((($a = old['$end_with?']("=")) !== nil && (!$a.$$is_boolean || $a == true))) {
          return ($a = ($b = self).$define_method, $a.$$p = (TMP_2 = function(value){var self = TMP_2.$$s || this;
            if (self["native"] == null) self["native"] = nil;
if (value == null) value = nil;
          self["native"][old['$[]']($range(0, -2, false))] = $scope.get('Native').$convert(value);
            return value;}, TMP_2.$$s = self, TMP_2), $a).call($b, new$)
        } else if ((($a = as = options['$[]']("as")) !== nil && (!$a.$$is_boolean || $a == true))) {
          return ($a = ($c = self).$define_method, $a.$$p = (TMP_3 = function(args){var self = TMP_3.$$s || this, block, $a, $b, $c;
            if (self["native"] == null) self["native"] = nil;
args = $slice.call(arguments, 0);
            block = TMP_3.$$p || nil, TMP_3.$$p = null;
          if ((($a = value = ($b = ($c = $scope.get('Native')).$call, $b.$$p = block.$to_proc(), $b).apply($c, [self["native"], old].concat(args))) !== nil && (!$a.$$is_boolean || $a == true))) {
              return as.$new(value.$to_n())
              } else {
              return nil
            }}, TMP_3.$$s = self, TMP_3), $a).call($c, new$)
          } else {
          return ($a = ($d = self).$define_method, $a.$$p = (TMP_4 = function(args){var self = TMP_4.$$s || this, block, $a, $b;
            if (self["native"] == null) self["native"] = nil;
args = $slice.call(arguments, 0);
            block = TMP_4.$$p || nil, TMP_4.$$p = null;
          return ($a = ($b = $scope.get('Native')).$call, $a.$$p = block.$to_proc(), $a).apply($b, [self["native"], old].concat(args))}, TMP_4.$$s = self, TMP_4), $a).call($d, new$)
        };
      };

      def.$native_reader = function(names) {
        var $a, $b, TMP_5, self = this;

        names = $slice.call(arguments, 0);
        return ($a = ($b = names).$each, $a.$$p = (TMP_5 = function(name){var self = TMP_5.$$s || this, $a, $b, TMP_6;
if (name == null) name = nil;
        return ($a = ($b = self).$define_method, $a.$$p = (TMP_6 = function(){var self = TMP_6.$$s || this;
            if (self["native"] == null) self["native"] = nil;

          return self.$Native(self["native"][name])}, TMP_6.$$s = self, TMP_6), $a).call($b, name)}, TMP_5.$$s = self, TMP_5), $a).call($b);
      };

      def.$native_writer = function(names) {
        var $a, $b, TMP_7, self = this;

        names = $slice.call(arguments, 0);
        return ($a = ($b = names).$each, $a.$$p = (TMP_7 = function(name){var self = TMP_7.$$s || this, $a, $b, TMP_8;
if (name == null) name = nil;
        return ($a = ($b = self).$define_method, $a.$$p = (TMP_8 = function(value){var self = TMP_8.$$s || this;
            if (self["native"] == null) self["native"] = nil;
if (value == null) value = nil;
          return self.$Native(self["native"][name] = value)}, TMP_8.$$s = self, TMP_8), $a).call($b, "" + (name) + "=")}, TMP_7.$$s = self, TMP_7), $a).call($b);
      };

      def.$native_accessor = function(names) {
        var $a, $b, self = this;

        names = $slice.call(arguments, 0);
        ($a = self).$native_reader.apply($a, [].concat(names));
        return ($b = self).$native_writer.apply($b, [].concat(names));
      };
            ;Opal.donate(self, ["$alias_native", "$native_reader", "$native_writer", "$native_accessor"]);
    })(self);

    Opal.defs(self, '$included', function(klass) {
      var self = this;

      return klass.$extend($scope.get('Helpers'));
    });

    def.$initialize = function(native$) {
      var $a, self = this;

      if ((($a = $scope.get('Kernel')['$native?'](native$)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        $scope.get('Kernel').$raise($scope.get('ArgumentError'), "" + (native$.$inspect()) + " isn't native")
      };
      return self["native"] = native$;
    };

    def.$to_n = function() {
      var self = this;
      if (self["native"] == null) self["native"] = nil;

      return self["native"];
    };
        ;Opal.donate(self, ["$initialize", "$to_n"]);
  })(self);
  (function($base) {
    var self = $module($base, 'Kernel');

    var def = self.$$proto, $scope = self.$$scope, TMP_9;

    def['$native?'] = function(value) {
      var self = this;

      return value == null || !value.$$class;
    };

    def.$Native = function(obj) {
      var $a, self = this;

      if ((($a = obj == null) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil
      } else if ((($a = self['$native?'](obj)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return (($scope.get('Native')).$$scope.get('Object')).$new(obj)
        } else {
        return obj
      };
    };

    def.$Array = TMP_9 = function(object, args) {
      var $a, $b, self = this, $iter = TMP_9.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_9.$$p = null;
      
      if (object == null || object === nil) {
        return [];
      }
      else if (self['$native?'](object)) {
        return ($a = ($b = (($scope.get('Native')).$$scope.get('Array'))).$new, $a.$$p = block.$to_proc(), $a).apply($b, [object].concat(args)).$to_a();
      }
      else if (object['$respond_to?']("to_ary")) {
        return object.$to_ary();
      }
      else if (object['$respond_to?']("to_a")) {
        return object.$to_a();
      }
      else {
        return [object];
      }
    ;
    };
        ;Opal.donate(self, ["$native?", "$Native", "$Array"]);
  })(self);
  (function($base, $super) {
    function $Object(){};
    var self = $Object = $klass($base, $super, 'Object', $Object);

    var def = self.$$proto, $scope = self.$$scope, TMP_10, TMP_11, TMP_12;

    def["native"] = nil;
    self.$include(Opal.get('Native'));

    Opal.defn(self, '$==', function(other) {
      var self = this;

      return self["native"] === $scope.get('Native').$try_convert(other);
    });

    Opal.defn(self, '$has_key?', function(name) {
      var self = this;

      return Opal.hasOwnProperty.call(self["native"], name);
    });

    Opal.defn(self, '$key?', def['$has_key?']);

    Opal.defn(self, '$include?', def['$has_key?']);

    Opal.defn(self, '$member?', def['$has_key?']);

    Opal.defn(self, '$each', TMP_10 = function(args) {
      var $a, self = this, $iter = TMP_10.$$p, $yield = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_10.$$p = null;
      if (($yield !== nil)) {
        
        for (var key in self["native"]) {
          ((($a = Opal.yieldX($yield, [key, self["native"][key]])) === $breaker) ? $breaker.$v : $a)
        }
      ;
        return self;
        } else {
        return ($a = self).$method_missing.apply($a, ["each"].concat(args))
      };
    });

    Opal.defn(self, '$[]', function(key) {
      var self = this;

      
      var prop = self["native"][key];

      if (prop instanceof Function) {
        return prop;
      }
      else {
        return Opal.get('Native').$call(self["native"], key)
      }
    ;
    });

    Opal.defn(self, '$[]=', function(key, value) {
      var $a, self = this, native$ = nil;

      native$ = $scope.get('Native').$try_convert(value);
      if ((($a = native$ === nil) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self["native"][key] = value;
        } else {
        return self["native"][key] = native$;
      };
    });

    Opal.defn(self, '$merge!', function(other) {
      var self = this;

      
      var other = $scope.get('Native').$convert(other);

      for (var prop in other) {
        self["native"][prop] = other[prop];
      }
    ;
      return self;
    });

    Opal.defn(self, '$respond_to?', function(name, include_all) {
      var self = this;

      if (include_all == null) {
        include_all = false
      }
      return $scope.get('Kernel').$instance_method("respond_to?").$bind(self).$call(name, include_all);
    });

    Opal.defn(self, '$respond_to_missing?', function(name) {
      var self = this;

      return Opal.hasOwnProperty.call(self["native"], name);
    });

    Opal.defn(self, '$method_missing', TMP_11 = function(mid, args) {
      var $a, $b, self = this, $iter = TMP_11.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_11.$$p = null;
      
      if (mid.charAt(mid.length - 1) === '=') {
        return self['$[]='](mid.$slice(0, mid.$length()['$-'](1)), args['$[]'](0));
      }
      else {
        return ($a = ($b = Opal.get('Native')).$call, $a.$$p = block.$to_proc(), $a).apply($b, [self["native"], mid].concat(args));
      }
    ;
    });

    Opal.defn(self, '$nil?', function() {
      var self = this;

      return false;
    });

    Opal.defn(self, '$is_a?', function(klass) {
      var self = this;

      return Opal.is_a(self, klass);
    });

    Opal.defn(self, '$kind_of?', def['$is_a?']);

    Opal.defn(self, '$instance_of?', function(klass) {
      var self = this;

      return self.$$class === klass;
    });

    Opal.defn(self, '$class', function() {
      var self = this;

      return self.$$class;
    });

    Opal.defn(self, '$to_a', TMP_12 = function(options) {
      var $a, $b, self = this, $iter = TMP_12.$$p, block = $iter || nil;

      if (options == null) {
        options = $hash2([], {})
      }
      TMP_12.$$p = null;
      return ($a = ($b = (($scope.get('Native')).$$scope.get('Array'))).$new, $a.$$p = block.$to_proc(), $a).call($b, self["native"], options).$to_a();
    });

    return (Opal.defn(self, '$inspect', function() {
      var self = this;

      return "#<Native:" + (String(self["native"])) + ">";
    }), nil) && 'inspect';
  })($scope.get('Native'), $scope.get('BasicObject'));
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self.$$proto, $scope = self.$$scope, TMP_13, TMP_14;

    def.named = def["native"] = def.get = def.block = def.set = def.length = nil;
    self.$include($scope.get('Native'));

    self.$include($scope.get('Enumerable'));

    def.$initialize = TMP_13 = function(native$, options) {
      var $a, self = this, $iter = TMP_13.$$p, block = $iter || nil;

      if (options == null) {
        options = $hash2([], {})
      }
      TMP_13.$$p = null;
      Opal.find_super_dispatcher(self, 'initialize', TMP_13, null).apply(self, [native$]);
      self.get = ((($a = options['$[]']("get")) !== false && $a !== nil) ? $a : options['$[]']("access"));
      self.named = options['$[]']("named");
      self.set = ((($a = options['$[]']("set")) !== false && $a !== nil) ? $a : options['$[]']("access"));
      self.length = ((($a = options['$[]']("length")) !== false && $a !== nil) ? $a : "length");
      self.block = block;
      if ((($a = self.$length() == null) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.$raise($scope.get('ArgumentError'), "no length found on the array-like object")
        } else {
        return nil
      };
    };

    def.$each = TMP_14 = function() {
      var self = this, $iter = TMP_14.$$p, block = $iter || nil;

      TMP_14.$$p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each")
      };
      
      for (var i = 0, length = self.$length(); i < length; i++) {
        var value = Opal.yield1(block, self['$[]'](i));

        if (value === $breaker) {
          return $breaker.$v;
        }
      }
    ;
      return self;
    };

    def['$[]'] = function(index) {
      var $a, self = this, result = nil, $case = nil;

      result = (function() {$case = index;if ($scope.get('String')['$===']($case) || $scope.get('Symbol')['$===']($case)) {if ((($a = self.named) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self["native"][self.named](index);
        } else {
        return self["native"][index];
      }}else if ($scope.get('Integer')['$===']($case)) {if ((($a = self.get) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self["native"][self.get](index);
        } else {
        return self["native"][index];
      }}else { return nil }})();
      if (result !== false && result !== nil) {
        if ((($a = self.block) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.block.$call(result)
          } else {
          return self.$Native(result)
        }
        } else {
        return nil
      };
    };

    def['$[]='] = function(index, value) {
      var $a, self = this;

      if ((($a = self.set) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self["native"][self.set](index, $scope.get('Native').$convert(value));
        } else {
        return self["native"][index] = $scope.get('Native').$convert(value);
      };
    };

    def.$last = function(count) {
      var $a, self = this, index = nil, result = nil;

      if (count == null) {
        count = nil
      }
      if (count !== false && count !== nil) {
        index = self.$length()['$-'](1);
        result = [];
        while (index['$>='](0)) {
        result['$<<'](self['$[]'](index));
        index = index['$-'](1);};
        return result;
        } else {
        return self['$[]'](self.$length()['$-'](1))
      };
    };

    def.$length = function() {
      var self = this;

      return self["native"][self.length];
    };

    Opal.defn(self, '$to_ary', def.$to_a);

    return (def.$inspect = function() {
      var self = this;

      return self.$to_a().$inspect();
    }, nil) && 'inspect';
  })($scope.get('Native'), null);
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Proc(){};
    var self = $Proc = $klass($base, $super, 'Proc', $Proc);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      return self;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Regexp(){};
    var self = $Regexp = $klass($base, $super, 'Regexp', $Regexp);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $MatchData(){};
    var self = $MatchData = $klass($base, $super, 'MatchData', $MatchData);

    var def = self.$$proto, $scope = self.$$scope;

    def.matches = nil;
    return (def.$to_n = function() {
      var self = this;

      return self.matches;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Struct(){};
    var self = $Struct = $klass($base, $super, 'Struct', $Struct);

    var def = self.$$proto, $scope = self.$$scope;

    def.$initialize = function(args) {
      var $a, $b, TMP_15, $c, TMP_16, self = this, object = nil;

      args = $slice.call(arguments, 0);
      if ((($a = (($b = args.$length()['$=='](1)) ? self['$native?'](args['$[]'](0)) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        object = args['$[]'](0);
        return ($a = ($b = self.$members()).$each, $a.$$p = (TMP_15 = function(name){var self = TMP_15.$$s || this;
if (name == null) name = nil;
        return self.$instance_variable_set("@" + (name), self.$Native(object[name]))}, TMP_15.$$s = self, TMP_15), $a).call($b);
        } else {
        return ($a = ($c = self.$members()).$each_with_index, $a.$$p = (TMP_16 = function(name, index){var self = TMP_16.$$s || this;
if (name == null) name = nil;if (index == null) index = nil;
        return self.$instance_variable_set("@" + (name), args['$[]'](index))}, TMP_16.$$s = self, TMP_16), $a).call($c)
      };
    };

    return (def.$to_n = function() {
      var $a, $b, TMP_17, self = this, result = nil;

      result = {};
      ($a = ($b = self).$each_pair, $a.$$p = (TMP_17 = function(name, value){var self = TMP_17.$$s || this;
if (name == null) name = nil;if (value == null) value = nil;
      return result[name] = value.$to_n();}, TMP_17.$$s = self, TMP_17), $a).call($b);
      return result;
    }, nil) && 'to_n';
  })(self, null);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var obj = self[i];

        if ((obj)['$respond_to?']("to_n")) {
          result.push((obj).$to_n());
        }
        else {
          result.push(obj);
        }
      }

      return result;
    ;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      return self;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_n = function() {
      var self = this;

      return null;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = self.$$proto, $scope = self.$$scope, TMP_18;

    def.$initialize = TMP_18 = function(defaults) {
      var self = this, $iter = TMP_18.$$p, block = $iter || nil;

      TMP_18.$$p = null;
      
      if (defaults != null) {
        if (defaults.constructor === Object) {
          var _map = self.map,
              smap = self.smap,
              keys = self.keys,
              map, khash, value;

          for (var key in defaults) {
            value = defaults[key];

            if (key.$$is_string) {
              map = smap;
              khash = key;
            } else {
              map = _map;
              khash = key.$hash();
            }

            if (value && value.constructor === Object) {
              map[khash] = $scope.get('Hash').$new(value);
            }
            else {
              map[khash] = self.$Native(value);
            }

            keys.push(key);
          }
        }
        else {
          self.none = defaults;
        }
      }
      else if (block !== nil) {
        self.proc = block;
      }

      return self;
    
    };

    return (def.$to_n = function() {
      var self = this;

      
      var result = {},
          keys   = self.keys,
          _map   = self.map,
          smap   = self.smap,
          map, khash, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        key   = keys[i];

        if (key.$$is_string) {
          map = smap;
          khash = key;
        } else {
          map = _map;
          khash = key.$hash();
        }

        value = map[khash];

        if ((value)['$respond_to?']("to_n")) {
          result[key] = (value).$to_n();
        }
        else {
          result[key] = value;
        }
      }

      return result;
    ;
    }, nil) && 'to_n';
  })(self, null);
  (function($base, $super) {
    function $Module(){};
    var self = $Module = $klass($base, $super, 'Module', $Module);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$native_module = function() {
      var self = this;

      return Opal.global[self.$name()] = self;
    }, nil) && 'native_module'
  })(self, null);
  (function($base, $super) {
    function $Class(){};
    var self = $Class = $klass($base, $super, 'Class', $Class);

    var def = self.$$proto, $scope = self.$$scope;

    def.$native_alias = function(jsid, mid) {
      var self = this;

      return self.$$proto[jsid] = self.$$proto['$' + mid];
    };

    return Opal.defn(self, '$native_class', def.$native_module);
  })(self, null);
  return $gvars.$ = $gvars.global = self.$Native(Opal.global);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery/constants"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var $a, self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $gvars = Opal.gvars;
  if ($gvars.$ == null) $gvars.$ = nil;

  Opal.add_stubs(['$require', '$[]', '$raise']);
  self.$require("native");
  if ((($a = ($scope.JQUERY_CLASS != null)) !== nil && (!$a.$$is_boolean || $a == true))) {
    return nil
    } else {
    return (function() {if ((($a = $gvars.$['$[]']("jQuery")) !== nil && (!$a.$$is_boolean || $a == true))) {return Opal.cdecl($scope, 'JQUERY_CLASS', Opal.cdecl($scope, 'JQUERY_SELECTOR', $gvars.$['$[]']("jQuery")))}else if ((($a = $gvars.$['$[]']("Zepto")) !== nil && (!$a.$$is_boolean || $a == true))) {Opal.cdecl($scope, 'JQUERY_SELECTOR', $gvars.$['$[]']("Zepto"));
    return Opal.cdecl($scope, 'JQUERY_CLASS', $gvars.$['$[]']("Zepto")['$[]']("zepto")['$[]']("Z"));}else {return self.$raise($scope.get('NameError'), "Can't find jQuery or Zepto. jQuery must be included before opal-jquery")}})()
  };
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery/element"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$to_n', '$include', '$alias_native', '$attr_reader', '$expose', '$nil?', '$is_a?', '$has_key?', '$delete', '$call', '$gsub', '$upcase', '$[]', '$compact', '$map', '$respond_to?', '$<<', '$Native', '$new']);
  self.$require("native");
  self.$require("opal-jquery/constants");
  return (function($base, $super) {
    function $Element(){};
    var self = $Element = $klass($base, $super, 'Element', $Element);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_5, TMP_6;

    var $ = $scope.get('JQUERY_SELECTOR').$to_n();

    self.$include($scope.get('Enumerable'));

    Opal.defs(self, '$find', function(selector) {
      var self = this;

      return $(selector);
    });

    Opal.defs(self, '$[]', function(selector) {
      var self = this;

      return $(selector);
    });

    Opal.defs(self, '$id', function(id) {
      var self = this;

      
      var el = document.getElementById(id);

      if (!el) {
        return nil;
      }

      return $(el);
    
    });

    Opal.defs(self, '$new', function(tag) {
      var self = this;

      if (tag == null) {
        tag = "div"
      }
      return $(document.createElement(tag));
    });

    Opal.defs(self, '$parse', function(str) {
      var self = this;

      return $(str);
    });

    Opal.defs(self, '$expose', function(methods) {
      var self = this, method = nil;

      methods = $slice.call(arguments, 0);
      method = nil;
      
      for (var i = 0, length = methods.length, method; i < length; i++) {
        method = methods[i];
        self.$alias_native(method, method)
      }

      return nil;
    
    });

    self.$attr_reader("selector");

    self.$expose("after", "before", "parent", "parents", "prepend", "prev", "remove");

    self.$expose("hide", "show", "toggle", "children", "blur", "closest", "detach");

    self.$expose("focus", "find", "next", "siblings", "text", "trigger", "append");

    self.$expose("serialize", "is", "filter", "last", "first");

    self.$expose("wrap", "stop", "clone", "empty");

    self.$expose("get", "attr", "prop");

    Opal.defn(self, '$succ', def.$next);

    Opal.defn(self, '$<<', def.$append);

    self.$alias_native("[]=", "attr");

    self.$alias_native("add_class", "addClass");

    self.$alias_native("append_to", "appendTo");

    self.$alias_native("has_class?", "hasClass");

    self.$alias_native("html=", "html");

    self.$alias_native("remove_attr", "removeAttr");

    self.$alias_native("remove_class", "removeClass");

    self.$alias_native("text=", "text");

    self.$alias_native("toggle_class", "toggleClass");

    self.$alias_native("value=", "val");

    self.$alias_native("scroll_top=", "scrollTop");

    self.$alias_native("scroll_top", "scrollTop");

    self.$alias_native("scroll_left=", "scrollLeft");

    self.$alias_native("scroll_left", "scrollLeft");

    self.$alias_native("remove_attribute", "removeAttr");

    self.$alias_native("slide_down", "slideDown");

    self.$alias_native("slide_up", "slideUp");

    self.$alias_native("slide_toggle", "slideToggle");

    self.$alias_native("fade_toggle", "fadeToggle");

    self.$alias_native("height=", "height");

    self.$alias_native("width=", "width");

    def.$to_n = function() {
      var self = this;

      return self;
    };

    def['$[]'] = function(name) {
      var self = this;

      return self.attr(name) || nil;
    };

    def.$attr = function(name, value) {
      var $a, self = this;

      if (value == null) {
        value = nil
      }
      if ((($a = value['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.attr(name) || nil;
        } else {
        return self.attr(name, value);
      };
    };

    def['$has_attribute?'] = function(name) {
      var self = this;

      return !!self.attr(name);
    };

    def.$append_to_body = function() {
      var self = this;

      return self.appendTo(document.body);
    };

    def.$append_to_head = function() {
      var self = this;

      return self.appendTo(document.head);
    };

    def.$at = function(index) {
      var self = this;

      
      var length = self.length;

      if (index < 0) {
        index += length;
      }

      if (index < 0 || index >= length) {
        return nil;
      }

      return $(self[index]);
    
    };

    def.$class_name = function() {
      var self = this;

      
      var first = self[0];
      return (first && first.className) || "";
    
    };

    def['$class_name='] = function(name) {
      var self = this;

      
      for (var i = 0, length = self.length; i < length; i++) {
        self[i].className = name;
      }
    
      return self;
    };

    def.$css = function(name, value) {
      var $a, $b, self = this;

      if (value == null) {
        value = nil
      }
      if ((($a = ($b = value['$nil?'](), $b !== false && $b !== nil ?name['$is_a?']($scope.get('String')) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.css(name)
      } else if ((($a = name['$is_a?']($scope.get('Hash'))) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.css(name.$to_n());
        } else {
        self.css(name, value);
      };
      return self;
    };

    def.$animate = TMP_1 = function(params) {
      var $a, self = this, $iter = TMP_1.$$p, block = $iter || nil, speed = nil;

      TMP_1.$$p = null;
      speed = (function() {if ((($a = params['$has_key?']("speed")) !== nil && (!$a.$$is_boolean || $a == true))) {
        return params.$delete("speed")
        } else {
        return 400
      }; return nil; })();
      
      self.animate(params.$to_n(), speed, function() {
        (function() {if ((block !== nil)) {
        return block.$call()
        } else {
        return nil
      }; return nil; })()
      })
    ;
    };

    def.$data = function(args) {
      var self = this;

      args = $slice.call(arguments, 0);
      
      var result = self.data.apply(self, args);
      return result == null ? nil : result;
    
    };

    def.$effect = TMP_2 = function(name, args) {
      var $a, $b, TMP_3, $c, TMP_4, self = this, $iter = TMP_2.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_2.$$p = null;
      name = ($a = ($b = name).$gsub, $a.$$p = (TMP_3 = function(match){var self = TMP_3.$$s || this;
if (match == null) match = nil;
      return match['$[]'](1).$upcase()}, TMP_3.$$s = self, TMP_3), $a).call($b, /_\w/);
      args = ($a = ($c = args).$map, $a.$$p = (TMP_4 = function(a){var self = TMP_4.$$s || this, $a;
if (a == null) a = nil;
      if ((($a = a['$respond_to?']("to_n")) !== nil && (!$a.$$is_boolean || $a == true))) {
          return a.$to_n()
          } else {
          return nil
        }}, TMP_4.$$s = self, TMP_4), $a).call($c).$compact();
      args['$<<'](function() { (function() {if ((block !== nil)) {
        return block.$call()
        } else {
        return nil
      }; return nil; })() });
      return self[name].apply(self, args);
    };

    def['$visible?'] = function() {
      var self = this;

      return self.is(':visible');
    };

    def.$offset = function() {
      var self = this;

      return self.$Native(self.offset());
    };

    def.$each = TMP_5 = function() {
      var self = this, $iter = TMP_5.$$p, $yield = $iter || nil;

      TMP_5.$$p = null;
      for (var i = 0, length = self.length; i < length; i++) {
      if (Opal.yield1($yield, $(self[i])) === $breaker) return $breaker.$v;
      };
      return self;
    };

    def.$first = function() {
      var self = this;

      return self.length ? self.first() : nil;
    };

    def.$html = function(content) {
      var self = this;

      
      if (content != null) {
        return self.html(content);
      }

      return self.html() || '';
    
    };

    def.$id = function() {
      var self = this;

      
      var first = self[0];
      return (first && first.id) || "";
    
    };

    def['$id='] = function(id) {
      var self = this;

      
      var first = self[0];

      if (first) {
        first.id = id;
      }

      return self;
    
    };

    def.$tag_name = function() {
      var self = this;

      return self.length > 0 ? self[0].tagName.toLowerCase() : nil;
    };

    def.$inspect = function() {
      var self = this;

      
      if      (self[0] === document) return '#<Element [document]>'
      else if (self[0] === window  ) return '#<Element [window]>'

      var val, el, str, result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        el  = self[i];
        if (!el.tagName) { return '#<Element ['+el.toString()+']'; }

        str = "<" + el.tagName.toLowerCase();

        if (val = el.id) str += (' id="' + val + '"');
        if (val = el.className) str += (' class="' + val + '"');

        result.push(str + '>');
      }

      return '#<Element [' + result.join(', ') + ']>';
    
    };

    def.$to_s = function() {
      var self = this;

      
      var val, el, result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        el  = self[i];

        result.push(el.outerHTML)
      }

      return result.join(', ');
    
    };

    def.$length = function() {
      var self = this;

      return self.length;
    };

    def['$any?'] = function() {
      var self = this;

      return self.length > 0;
    };

    def['$empty?'] = function() {
      var self = this;

      return self.length === 0;
    };

    Opal.defn(self, '$empty?', def['$none?']);

    def.$on = TMP_6 = function(name, sel) {
      var self = this, $iter = TMP_6.$$p, block = $iter || nil;

      if (sel == null) {
        sel = nil
      }
      TMP_6.$$p = null;
      
      var wrapper = function(evt) {
        if (evt.preventDefault) {
          evt = $scope.get('Event').$new(evt);
        }

        return block.apply(null, arguments);
      };

      block._jq_wrap = wrapper;

      if (sel == nil) {
        self.on(name, wrapper);
      }
      else {
        self.on(name, sel, wrapper);
      }
    ;
      return block;
    };

    def.$off = function(name, sel, block) {
      var self = this;

      if (block == null) {
        block = nil
      }
      
      if (sel == null) {
        return self.off(name);
      }
      else if (block === nil) {
        return self.off(name, sel._jq_wrap);
      }
      else {
        return self.off(name, sel, block._jq_wrap);
      }
    
    };

    Opal.defn(self, '$size', def.$length);

    def.$value = function() {
      var self = this;

      return self.val() || "";
    };

    def.$height = function() {
      var self = this;

      return self.height() || nil;
    };

    def.$width = function() {
      var self = this;

      return self.width() || nil;
    };

    return (def.$position = function() {
      var self = this;

      return self.$Native(self.position());
    }, nil) && 'position';
  })(self, $scope.get('JQUERY_CLASS').$to_n());
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery/window"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $gvars = Opal.gvars;

  Opal.add_stubs(['$require', '$find']);
  self.$require("opal-jquery/element");
  Opal.cdecl($scope, 'Window', $scope.get('Element').$find(window));
  return $gvars.window = $scope.get('Window');
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery/document"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $gvars = Opal.gvars;

  Opal.add_stubs(['$require', '$find', '$to_n']);
  self.$require("opal-jquery/constants");
  self.$require("opal-jquery/element");
  Opal.cdecl($scope, 'Document', $scope.get('Element').$find(document));
  (function(self) {
    var $scope = self.$$scope, def = self.$$proto;

    var $ = $scope.get('JQUERY_SELECTOR').$to_n();
    self.$$proto['$ready?'] = TMP_1 = function() {
      var self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      if (block !== false && block !== nil) {
        return $(block);
        } else {
        return nil
      };
    };
    self.$$proto.$title = function() {
      var self = this;

      return document.title;
    };
    self.$$proto['$title='] = function(title) {
      var self = this;

      return document.title = title;
    };
    self.$$proto.$head = function() {
      var self = this;

      return $scope.get('Element').$find(document.head);
    };
    return (self.$$proto.$body = function() {
      var self = this;

      return $scope.get('Element').$find(document.body);
    }, nil) && 'body';
  })($scope.get('Document').$singleton_class());
  return $gvars.document = $scope.get('Document');
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery/event"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$to_n', '$stop', '$prevent']);
  self.$require("opal-jquery/constants");
  return (function($base, $super) {
    function $Event(){};
    var self = $Event = $klass($base, $super, 'Event', $Event);

    var def = self.$$proto, $scope = self.$$scope;

    def["native"] = nil;
    var $ = $scope.get('JQUERY_SELECTOR').$to_n();

    def.$initialize = function(native$) {
      var self = this;

      return self["native"] = native$;
    };

    def.$to_n = function() {
      var self = this;

      return self["native"];
    };

    def['$[]'] = function(name) {
      var self = this;

      return self["native"][name];
    };

    def.$type = function() {
      var self = this;

      return self["native"].type;
    };

    def.$current_target = function() {
      var self = this;

      return $(self["native"].currentTarget);
    };

    def.$target = function() {
      var self = this;

      return $(self["native"].target);
    };

    def['$prevented?'] = function() {
      var self = this;

      return self["native"].isDefaultPrevented();
    };

    def.$prevent = function() {
      var self = this;

      return self["native"].preventDefault();
    };

    def['$stopped?'] = function() {
      var self = this;

      return self["native"].isPropagationStopped();
    };

    def.$stop = function() {
      var self = this;

      return self["native"].stopPropagation();
    };

    def.$stop_immediate = function() {
      var self = this;

      return self["native"].stopImmediatePropagation();
    };

    def.$kill = function() {
      var self = this;

      self.$stop();
      return self.$prevent();
    };

    Opal.defn(self, '$default_prevented?', def['$prevented?']);

    Opal.defn(self, '$prevent_default', def.$prevent);

    Opal.defn(self, '$propagation_stopped?', def['$stopped?']);

    Opal.defn(self, '$stop_propagation', def.$stop);

    Opal.defn(self, '$stop_immediate_propagation', def.$stop_immediate);

    def.$page_x = function() {
      var self = this;

      return self["native"].pageX;
    };

    def.$page_y = function() {
      var self = this;

      return self["native"].pageY;
    };

    def.$touch_x = function() {
      var self = this;

      return self["native"].originalEvent.touches[0].pageX;
    };

    def.$touch_y = function() {
      var self = this;

      return self["native"].originalEvent.touches[0].pageY;
    };

    def.$ctrl_key = function() {
      var self = this;

      return self["native"].ctrlKey;
    };

    def.$key_code = function() {
      var self = this;

      return self["native"].keyCode;
    };

    return (def.$which = function() {
      var self = this;

      return self["native"].which;
    }, nil) && 'which';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["json"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $hash2 = Opal.hash2, $klass = Opal.klass;

  Opal.add_stubs(['$new', '$push', '$[]=', '$[]', '$create_id', '$json_create', '$attr_accessor', '$create_id=', '$===', '$parse', '$generate', '$from_object', '$to_json', '$responds_to?', '$to_io', '$write', '$to_s', '$to_a', '$strftime']);
  (function($base) {
    var self = $module($base, 'JSON');

    var def = self.$$proto, $scope = self.$$scope, $a, $b;

    
    var $parse  = JSON.parse,
        $hasOwn = Opal.hasOwnProperty;

    function to_opal(value, options) {
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

          if (value.$$is_array) {
            var arr = (options.array_class).$new();

            for (var i = 0, ii = value.length; i < ii; i++) {
              (arr).$push(to_opal(value[i], options));
            }

            return arr;
          }
          else {
            var hash = (options.object_class).$new();

            for (var k in value) {
              if ($hasOwn.call(value, k)) {
                (hash)['$[]='](k, to_opal(value[k], options));
              }
            }

            var klass;
            if ((klass = (hash)['$[]']($scope.get('JSON').$create_id())) != nil) {
              klass = Opal.cget(klass);
              return (klass).$json_create(hash);
            }
            else {
              return hash;
            }
          }
      }
    };
  

    (function(self) {
      var $scope = self.$$scope, def = self.$$proto;

      return self.$attr_accessor("create_id")
    })(self.$singleton_class());

    (($a = ["json_class"]), $b = self, $b['$create_id='].apply($b, $a), $a[$a.length-1]);

    Opal.defs(self, '$[]', function(value, options) {
      var $a, self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      if ((($a = $scope.get('String')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.$parse(value, options)
        } else {
        return self.$generate(value, options)
      };
    });

    Opal.defs(self, '$parse', function(source, options) {
      var self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      return self.$from_object($parse(source), options);
    });

    Opal.defs(self, '$parse!', function(source, options) {
      var self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      return self.$parse(source, options);
    });

    Opal.defs(self, '$from_object', function(js_object, options) {
      var $a, $b, $c, self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      ($a = "object_class", $b = options, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, $scope.get('Hash'))));
      ($a = "array_class", $b = options, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, $scope.get('Array'))));
      return to_opal(js_object, options.smap);
    });

    Opal.defs(self, '$generate', function(obj, options) {
      var self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      return obj.$to_json(options);
    });

    Opal.defs(self, '$dump', function(obj, io, limit) {
      var $a, self = this, string = nil;

      if (io == null) {
        io = nil
      }
      if (limit == null) {
        limit = nil
      }
      string = self.$generate(obj);
      if (io !== false && io !== nil) {
        if ((($a = io['$responds_to?']("to_io")) !== nil && (!$a.$$is_boolean || $a == true))) {
          io = io.$to_io()};
        io.$write(string);
        return io;
        } else {
        return string
      };
    });
    
  })(self);
  (function($base, $super) {
    function $Object(){};
    var self = $Object = $klass($base, $super, 'Object', $Object);

    var def = self.$$proto, $scope = self.$$scope;

    return (Opal.defn(self, '$to_json', function() {
      var self = this;

      return self.$to_s().$to_json();
    }), nil) && 'to_json'
  })(self, null);
  (function($base) {
    var self = $module($base, 'Enumerable');

    var def = self.$$proto, $scope = self.$$scope;

    def.$to_json = function() {
      var self = this;

      return self.$to_a().$to_json();
    }
        ;Opal.donate(self, ["$to_json"]);
  })(self);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_json = function() {
      var self = this;

      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        result.push((self[i]).$to_json());
      }

      return '[' + result.join(', ') + ']';
    
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_json = function() {
      var self = this;

      return (self == true) ? 'true' : 'false';
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_json = function() {
      var self = this;

      
      var inspect = [],
          keys = self.keys,
          _map = self.map,
          smap = self.smap,
          map, khash;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if (key.$$is_string) {
          map = smap;
          khash = key;
        } else {
          map = _map;
          khash = key.$hash();
        }

        inspect.push((key).$to_s().$to_json() + ':' + (map[khash]).$to_json());
      }

      return '{' + inspect.join(', ') + '}';
    ;
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_json = function() {
      var self = this;

      return "null";
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_json = function() {
      var self = this;

      return self.toString();
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self.$$proto, $scope = self.$$scope;

    return Opal.defn(self, '$to_json', def.$inspect)
  })(self, null);
  (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$to_json = function() {
      var self = this;

      return self.$strftime("%FT%T%z").$to_json();
    }, nil) && 'to_json'
  })(self, null);
  return (function($base, $super) {
    function $Date(){};
    var self = $Date = $klass($base, $super, 'Date', $Date);

    var def = self.$$proto, $scope = self.$$scope;

    def.$to_json = function() {
      var self = this;

      return self.$to_s().$to_json();
    };

    return (def.$as_json = function() {
      var self = this;

      return self.$to_s();
    }, nil) && 'as_json';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["promise"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$resolve', '$new', '$reject', '$attr_reader', '$!', '$==', '$<<', '$>>', '$exception?', '$resolved?', '$value', '$rejected?', '$===', '$error', '$realized?', '$raise', '$^', '$call', '$resolve!', '$exception!', '$reject!', '$class', '$object_id', '$+', '$inspect', '$act?', '$prev', '$concat', '$it', '$lambda', '$reverse', '$<=', '$length', '$shift', '$-', '$each', '$wait', '$then', '$to_proc', '$map', '$reduce', '$always', '$try', '$tap', '$all?', '$find']);
  return (function($base, $super) {
    function $Promise(){};
    var self = $Promise = $klass($base, $super, 'Promise', $Promise);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4;

    def.success = def.exception = def.realized = def.delayed = def.failure = def.error = def.prev = def.next = def.value = nil;
    Opal.defs(self, '$value', function(value) {
      var self = this;

      return self.$new().$resolve(value);
    });

    Opal.defs(self, '$error', function(value) {
      var self = this;

      return self.$new().$reject(value);
    });

    Opal.defs(self, '$when', function(promises) {
      var self = this;

      promises = $slice.call(arguments, 0);
      return $scope.get('When').$new(promises);
    });

    self.$attr_reader("value", "error", "prev", "next");

    def.$initialize = function(success, failure) {
      var self = this;

      if (success == null) {
        success = nil
      }
      if (failure == null) {
        failure = nil
      }
      self.success = success;
      self.failure = failure;
      self.realized = nil;
      self.exception = false;
      self.value = nil;
      self.error = nil;
      self.delayed = nil;
      self.prev = nil;
      return self.next = nil;
    };

    def['$act?'] = function() {
      var self = this;

      return self.success['$=='](nil)['$!']();
    };

    def['$exception?'] = function() {
      var self = this;

      return self.exception;
    };

    def['$realized?'] = function() {
      var self = this;

      return self.realized['$=='](nil)['$!']();
    };

    def['$resolved?'] = function() {
      var self = this;

      return self.realized['$==']("resolve");
    };

    def['$rejected?'] = function() {
      var self = this;

      return self.realized['$==']("reject");
    };

    def['$^'] = function(promise) {
      var self = this;

      promise['$<<'](self);
      self['$>>'](promise);
      return promise;
    };

    def['$<<'] = function(promise) {
      var self = this;

      self.prev = promise;
      return self;
    };

    def['$>>'] = function(promise) {
      var $a, $b, $c, $d, self = this;

      self.next = promise;
      if ((($a = self['$exception?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        promise.$reject(self.delayed)
      } else if ((($a = self['$resolved?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        promise.$resolve(((($a = self.delayed) !== false && $a !== nil) ? $a : self.$value()))
      } else if ((($a = ($b = self['$rejected?'](), $b !== false && $b !== nil ?(((($c = self.failure['$!']()) !== false && $c !== nil) ? $c : $scope.get('Promise')['$===']((((($d = self.delayed) !== false && $d !== nil) ? $d : self.error))))) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        promise.$reject(((($a = self.delayed) !== false && $a !== nil) ? $a : self.$error()))};
      return self;
    };

    def.$resolve = function(value) {
      var $a, self = this, e = nil;

      if (value == null) {
        value = nil
      }
      if ((($a = self['$realized?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "the promise has already been realized")};
      if ((($a = $scope.get('Promise')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
        value['$<<'](self.prev);
        return value['$^'](self);};
      self.realized = "resolve";
      self.value = value;
      try {
      if ((($a = self.success) !== nil && (!$a.$$is_boolean || $a == true))) {
          value = self.success.$call(value)};
        self['$resolve!'](value);
      } catch ($err) {if (Opal.rescue($err, [$scope.get('Exception')])) {e = $err;
        self['$exception!'](e)
        }else { throw $err; }
      };
      return self;
    };

    def['$resolve!'] = function(value) {
      var $a, self = this;

      if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.next.$resolve(value)
        } else {
        return self.delayed = value
      };
    };

    def.$reject = function(value) {
      var $a, self = this, e = nil;

      if (value == null) {
        value = nil
      }
      if ((($a = self['$realized?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "the promise has already been realized")};
      if ((($a = $scope.get('Promise')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
        value['$<<'](self.prev);
        return value['$^'](self);};
      self.realized = "reject";
      self.error = value;
      try {
      if ((($a = self.failure) !== nil && (!$a.$$is_boolean || $a == true))) {
          value = self.failure.$call(value);
          if ((($a = $scope.get('Promise')['$==='](value)) !== nil && (!$a.$$is_boolean || $a == true))) {
            self['$reject!'](value)};
          } else {
          self['$reject!'](value)
        }
      } catch ($err) {if (Opal.rescue($err, [$scope.get('Exception')])) {e = $err;
        self['$exception!'](e)
        }else { throw $err; }
      };
      return self;
    };

    def['$reject!'] = function(value) {
      var $a, self = this;

      if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.next.$reject(value)
        } else {
        return self.delayed = value
      };
    };

    def['$exception!'] = function(error) {
      var self = this;

      self.exception = true;
      return self['$reject!'](error);
    };

    def.$then = TMP_1 = function() {
      var $a, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      TMP_1.$$p = null;
      if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "a promise has already been chained")};
      return self['$^']($scope.get('Promise').$new(block));
    };

    Opal.defn(self, '$do', def.$then);

    def.$fail = TMP_2 = function() {
      var $a, self = this, $iter = TMP_2.$$p, block = $iter || nil;

      TMP_2.$$p = null;
      if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "a promise has already been chained")};
      return self['$^']($scope.get('Promise').$new(nil, block));
    };

    Opal.defn(self, '$rescue', def.$fail);

    Opal.defn(self, '$catch', def.$fail);

    def.$always = TMP_3 = function() {
      var $a, self = this, $iter = TMP_3.$$p, block = $iter || nil;

      TMP_3.$$p = null;
      if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "a promise has already been chained")};
      return self['$^']($scope.get('Promise').$new(block, block));
    };

    Opal.defn(self, '$finally', def.$always);

    Opal.defn(self, '$ensure', def.$always);

    def.$trace = TMP_4 = function(depth) {
      var $a, self = this, $iter = TMP_4.$$p, block = $iter || nil;

      if (depth == null) {
        depth = nil
      }
      TMP_4.$$p = null;
      if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$raise($scope.get('ArgumentError'), "a promise has already been chained")};
      return self['$^']($scope.get('Trace').$new(depth, block));
    };

    def.$inspect = function() {
      var $a, self = this, result = nil;

      result = "#<" + (self.$class()) + "(" + (self.$object_id()) + ")";
      if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
        result = result['$+'](" >> " + (self.next.$inspect()))};
      if ((($a = self['$realized?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        result = result['$+'](": " + ((((($a = self.value) !== false && $a !== nil) ? $a : self.error)).$inspect()) + ">")
        } else {
        result = result['$+'](">")
      };
      return result;
    };

    (function($base, $super) {
      function $Trace(){};
      var self = $Trace = $klass($base, $super, 'Trace', $Trace);

      var def = self.$$proto, $scope = self.$$scope, TMP_6;

      Opal.defs(self, '$it', function(promise) {
        var $a, self = this, current = nil, prev = nil;

        if ((($a = promise['$realized?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          self.$raise($scope.get('ArgumentError'), "the promise hasn't been realized")
        };
        current = (function() {if ((($a = promise['$act?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return [promise.$value()]
          } else {
          return []
        }; return nil; })();
        if ((($a = prev = promise.$prev()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return current.$concat(self.$it(prev))
          } else {
          return current
        };
      });

      return (def.$initialize = TMP_6 = function(depth, block) {
        var $a, $b, TMP_5, self = this, $iter = TMP_6.$$p, $yield = $iter || nil;

        TMP_6.$$p = null;
        self.depth = depth;
        return Opal.find_super_dispatcher(self, 'initialize', TMP_6, null).apply(self, [($a = ($b = self).$lambda, $a.$$p = (TMP_5 = function(){var self = TMP_5.$$s || this, $a, $b, trace = nil;

        trace = $scope.get('Trace').$it(self).$reverse();
          if ((($a = (($b = depth !== false && depth !== nil) ? depth['$<='](trace.$length()) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            trace.$shift(trace.$length()['$-'](depth))};
          return ($a = block).$call.apply($a, [].concat(trace));}, TMP_5.$$s = self, TMP_5), $a).call($b)]);
      }, nil) && 'initialize';
    })(self, self);

    return (function($base, $super) {
      function $When(){};
      var self = $When = $klass($base, $super, 'When', $When);

      var def = self.$$proto, $scope = self.$$scope, TMP_7, TMP_9, TMP_11, TMP_13, TMP_17;

      def.wait = nil;
      def.$initialize = TMP_7 = function(promises) {
        var $a, $b, TMP_8, self = this, $iter = TMP_7.$$p, $yield = $iter || nil;

        if (promises == null) {
          promises = []
        }
        TMP_7.$$p = null;
        Opal.find_super_dispatcher(self, 'initialize', TMP_7, null).apply(self, []);
        self.wait = [];
        return ($a = ($b = promises).$each, $a.$$p = (TMP_8 = function(promise){var self = TMP_8.$$s || this;
if (promise == null) promise = nil;
        return self.$wait(promise)}, TMP_8.$$s = self, TMP_8), $a).call($b);
      };

      def.$each = TMP_9 = function() {
        var $a, $b, TMP_10, self = this, $iter = TMP_9.$$p, block = $iter || nil;

        TMP_9.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "no block given")
        };
        return ($a = ($b = self).$then, $a.$$p = (TMP_10 = function(values){var self = TMP_10.$$s || this, $a, $b;
if (values == null) values = nil;
        return ($a = ($b = values).$each, $a.$$p = block.$to_proc(), $a).call($b)}, TMP_10.$$s = self, TMP_10), $a).call($b);
      };

      def.$collect = TMP_11 = function() {
        var $a, $b, TMP_12, self = this, $iter = TMP_11.$$p, block = $iter || nil;

        TMP_11.$$p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise($scope.get('ArgumentError'), "no block given")
        };
        return ($a = ($b = self).$then, $a.$$p = (TMP_12 = function(values){var self = TMP_12.$$s || this, $a, $b;
if (values == null) values = nil;
        return $scope.get('When').$new(($a = ($b = values).$map, $a.$$p = block.$to_proc(), $a).call($b))}, TMP_12.$$s = self, TMP_12), $a).call($b);
      };

      def.$inject = TMP_13 = function(args) {
        var $a, $b, TMP_14, self = this, $iter = TMP_13.$$p, block = $iter || nil;

        args = $slice.call(arguments, 0);
        TMP_13.$$p = null;
        return ($a = ($b = self).$then, $a.$$p = (TMP_14 = function(values){var self = TMP_14.$$s || this, $a, $b;
if (values == null) values = nil;
        return ($a = ($b = values).$reduce, $a.$$p = block.$to_proc(), $a).apply($b, [].concat(args))}, TMP_14.$$s = self, TMP_14), $a).call($b);
      };

      Opal.defn(self, '$map', def.$collect);

      Opal.defn(self, '$reduce', def.$inject);

      def.$wait = function(promise) {
        var $a, $b, TMP_15, self = this;

        if ((($a = $scope.get('Promise')['$==='](promise)) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          promise = $scope.get('Promise').$value(promise)
        };
        if ((($a = promise['$act?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          promise = promise.$then()};
        self.wait['$<<'](promise);
        ($a = ($b = promise).$always, $a.$$p = (TMP_15 = function(){var self = TMP_15.$$s || this, $a;
          if (self.next == null) self.next = nil;

        if ((($a = self.next) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$try()
            } else {
            return nil
          }}, TMP_15.$$s = self, TMP_15), $a).call($b);
        return self;
      };

      Opal.defn(self, '$and', def.$wait);

      def['$>>'] = TMP_17 = function() {var $zuper = $slice.call(arguments, 0);
        var $a, $b, TMP_16, self = this, $iter = TMP_17.$$p, $yield = $iter || nil;

        TMP_17.$$p = null;
        return ($a = ($b = Opal.find_super_dispatcher(self, '>>', TMP_17, $iter).apply(self, $zuper)).$tap, $a.$$p = (TMP_16 = function(){var self = TMP_16.$$s || this;

        return self.$try()}, TMP_16.$$s = self, TMP_16), $a).call($b);
      };

      return (def.$try = function() {
        var $a, $b, $c, $d, self = this, promise = nil;

        if ((($a = ($b = ($c = self.wait)['$all?'], $b.$$p = "realized?".$to_proc(), $b).call($c)) !== nil && (!$a.$$is_boolean || $a == true))) {
          if ((($a = promise = ($b = ($d = self.wait).$find, $b.$$p = "rejected?".$to_proc(), $b).call($d)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$reject(promise.$error())
            } else {
            return self.$resolve(($a = ($b = self.wait).$map, $a.$$p = "value".$to_proc(), $a).call($b))
          }
          } else {
          return nil
        };
      }, nil) && 'try';
    })(self, self);
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery/http"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $hash2 = Opal.hash2;

  Opal.add_stubs(['$require', '$to_n', '$new', '$attr_reader', '$send', '$to_proc', '$delete', '$upcase', '$succeed', '$fail', '$promise', '$parse', '$private', '$tap', '$proc', '$ok?', '$resolve', '$reject', '$from_object', '$call']);
  self.$require("json");
  self.$require("native");
  self.$require("promise");
  self.$require("opal-jquery/constants");
  return (function($base, $super) {
    function $HTTP(){};
    var self = $HTTP = $klass($base, $super, 'HTTP', $HTTP);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8;

    def.settings = def.url = def.method = def.handler = def.payload = def.json = def.body = def.ok = def.xhr = def.promise = def.status_code = nil;
    var $ = $scope.get('JQUERY_SELECTOR').$to_n();

    Opal.defs(self, '$setup', function() {
      var self = this;

      return $scope.get('Hash').$new($.ajaxSetup());
    });

    Opal.defs(self, '$setup=', function(settings) {
      var self = this;

      return $.ajaxSetup(settings.$to_n());
    });

    self.$attr_reader("body", "error_message", "method", "status_code", "url", "xhr");

    Opal.defs(self, '$get', TMP_1 = function(url, opts) {
      var $a, $b, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_1.$$p = null;
      return ($a = ($b = self).$send, $a.$$p = block.$to_proc(), $a).call($b, "get", url, opts);
    });

    Opal.defs(self, '$post', TMP_2 = function(url, opts) {
      var $a, $b, self = this, $iter = TMP_2.$$p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_2.$$p = null;
      return ($a = ($b = self).$send, $a.$$p = block.$to_proc(), $a).call($b, "post", url, opts);
    });

    Opal.defs(self, '$put', TMP_3 = function(url, opts) {
      var $a, $b, self = this, $iter = TMP_3.$$p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_3.$$p = null;
      return ($a = ($b = self).$send, $a.$$p = block.$to_proc(), $a).call($b, "put", url, opts);
    });

    Opal.defs(self, '$delete', TMP_4 = function(url, opts) {
      var $a, $b, self = this, $iter = TMP_4.$$p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_4.$$p = null;
      return ($a = ($b = self).$send, $a.$$p = block.$to_proc(), $a).call($b, "delete", url, opts);
    });

    Opal.defs(self, '$patch', TMP_5 = function(url, opts) {
      var $a, $b, self = this, $iter = TMP_5.$$p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_5.$$p = null;
      return ($a = ($b = self).$send, $a.$$p = block.$to_proc(), $a).call($b, "patch", url, opts);
    });

    Opal.defs(self, '$head', TMP_6 = function(url, opts) {
      var $a, $b, self = this, $iter = TMP_6.$$p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_6.$$p = null;
      return ($a = ($b = self).$send, $a.$$p = block.$to_proc(), $a).call($b, "head", url, opts);
    });

    Opal.defs(self, '$send', TMP_7 = function(method, url, options) {
      var $a, $b, self = this, $iter = TMP_7.$$p, block = $iter || nil;

      TMP_7.$$p = null;
      return ($a = ($b = self).$new, $a.$$p = block.$to_proc(), $a).call($b, method, url, options).$send();
    });

    def.$initialize = TMP_8 = function(method, url, options) {
      var self = this, $iter = TMP_8.$$p, handler = $iter || nil;

      if (options == null) {
        options = $hash2([], {})
      }
      TMP_8.$$p = null;
      self.method = method;
      self.url = url;
      self.ok = true;
      self.payload = options.$delete("payload");
      self.settings = options;
      return self.handler = handler;
    };

    def.$send = function(payload) {
      var $a, self = this, settings = nil;

      if (payload == null) {
        payload = self.payload
      }
      settings = self.settings.$to_n();
      
      if (typeof(payload) === 'string') {
        settings.data = payload;
      }
      else if (payload != nil) {
        settings.data = payload.$to_json();
        settings.contentType = 'application/json';
      }

      settings.url  = self.url;
      settings.type = self.method.$upcase();

      settings.success = function(data, status, xhr) {
        return self.$succeed(data, status, xhr);
      };

      settings.error = function(xhr, status, error) {
        return self.$fail(xhr, status, error);
      };

      $.ajax(settings);
    ;
      if ((($a = self.handler) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self
        } else {
        return self.$promise()
      };
    };

    def.$json = function() {
      var $a, self = this;

      return ((($a = self.json) !== false && $a !== nil) ? $a : $scope.get('JSON').$parse(self.body));
    };

    def['$ok?'] = function() {
      var self = this;

      return self.ok;
    };

    def.$get_header = function(key) {
      var self = this;

      return self.xhr.getResponseHeader(key);;
    };

    self.$private();

    def.$promise = function() {
      var $a, $b, TMP_9, self = this;

      if ((($a = self.promise) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.promise};
      return self.promise = ($a = ($b = $scope.get('Promise').$new()).$tap, $a.$$p = (TMP_9 = function(promise){var self = TMP_9.$$s || this, $a, $b, TMP_10;
if (promise == null) promise = nil;
      return self.handler = ($a = ($b = self).$proc, $a.$$p = (TMP_10 = function(res){var self = TMP_10.$$s || this, $a;
if (res == null) res = nil;
        if ((($a = res['$ok?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return promise.$resolve(res)
            } else {
            return promise.$reject(res)
          }}, TMP_10.$$s = self, TMP_10), $a).call($b)}, TMP_9.$$s = self, TMP_9), $a).call($b);
    };

    def.$succeed = function(data, status, xhr) {
      var $a, self = this;

      
      self.body = data;
      self.xhr  = xhr;
      self.status_code = xhr.status;

      if (typeof(data) === 'object') {
        self.json = $scope.get('JSON').$from_object(data);
      }
    ;
      if ((($a = self.handler) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.handler.$call(self)
        } else {
        return nil
      };
    };

    return (def.$fail = function(xhr, status, error) {
      var $a, self = this;

      
      self.body = xhr.responseText;
      self.xhr = xhr;
      self.status_code = xhr.status;
    ;
      self.ok = false;
      if ((($a = self.handler) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.handler.$call(self)
        } else {
        return nil
      };
    }, nil) && 'fail';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery/kernel"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module;

  return (function($base) {
    var self = $module($base, 'Kernel');

    var def = self.$$proto, $scope = self.$$scope;

    def.$alert = function(msg) {
      var self = this;

      alert(msg);
      return nil;
    }
        ;Opal.donate(self, ["$alert"]);
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-jquery"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice;

  Opal.add_stubs(['$require']);
  self.$require("opal-jquery/window");
  self.$require("opal-jquery/document");
  self.$require("opal-jquery/element");
  self.$require("opal-jquery/event");
  self.$require("opal-jquery/http");
  return self.$require("opal-jquery/kernel");
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["set"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $module = Opal.module;

  Opal.add_stubs(['$include', '$new', '$nil?', '$===', '$raise', '$each', '$add', '$call', '$merge', '$class', '$respond_to?', '$subtract', '$dup', '$join', '$to_a', '$equal?', '$instance_of?', '$==', '$instance_variable_get', '$is_a?', '$size', '$all?', '$include?', '$[]=', '$enum_for', '$[]', '$<<', '$replace', '$delete', '$select', '$each_key', '$to_proc', '$empty?', '$eql?', '$instance_eval', '$clear', '$keys']);
  (function($base, $super) {
    function $Set(){};
    var self = $Set = $klass($base, $super, 'Set', $Set);

    var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_4, TMP_7, TMP_9, TMP_12;

    def.hash = nil;
    self.$include($scope.get('Enumerable'));

    Opal.defs(self, '$[]', function(ary) {
      var self = this;

      ary = $slice.call(arguments, 0);
      return self.$new(ary);
    });

    def.$initialize = TMP_1 = function(enum$) {
      var $a, $b, TMP_2, self = this, $iter = TMP_1.$$p, block = $iter || nil;

      if (enum$ == null) {
        enum$ = nil
      }
      TMP_1.$$p = null;
      self.hash = $scope.get('Hash').$new();
      if ((($a = enum$['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil};
      if ((($a = $scope.get('Enumerable')['$==='](enum$)) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "value must be enumerable")
      };
      if (block !== false && block !== nil) {
        return ($a = ($b = enum$).$each, $a.$$p = (TMP_2 = function(item){var self = TMP_2.$$s || this;
if (item == null) item = nil;
        return self.$add(block.$call(item))}, TMP_2.$$s = self, TMP_2), $a).call($b)
        } else {
        return self.$merge(enum$)
      };
    };

    def.$dup = function() {
      var self = this, result = nil;

      result = self.$class().$new();
      return result.$merge(self);
    };

    def['$-'] = function(enum$) {
      var $a, self = this;

      if ((($a = enum$['$respond_to?']("each")) !== nil && (!$a.$$is_boolean || $a == true))) {
        } else {
        self.$raise($scope.get('ArgumentError'), "value must be enumerable")
      };
      return self.$dup().$subtract(enum$);
    };

    Opal.defn(self, '$difference', def['$-']);

    def.$inspect = function() {
      var self = this;

      return "#<Set: {" + (self.$to_a().$join(",")) + "}>";
    };

    def['$=='] = function(other) {
      var $a, $b, TMP_3, self = this;

      if ((($a = self['$equal?'](other)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return true
      } else if ((($a = other['$instance_of?'](self.$class())) !== nil && (!$a.$$is_boolean || $a == true))) {
        return self.hash['$=='](other.$instance_variable_get("@hash"))
      } else if ((($a = ($b = other['$is_a?']($scope.get('Set')), $b !== false && $b !== nil ?self.$size()['$=='](other.$size()) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return ($a = ($b = other)['$all?'], $a.$$p = (TMP_3 = function(o){var self = TMP_3.$$s || this;
          if (self.hash == null) self.hash = nil;
if (o == null) o = nil;
        return self.hash['$include?'](o)}, TMP_3.$$s = self, TMP_3), $a).call($b)
        } else {
        return false
      };
    };

    def.$add = function(o) {
      var self = this;

      self.hash['$[]='](o, true);
      return self;
    };

    Opal.defn(self, '$<<', def.$add);

    def.$classify = TMP_4 = function() {
      var $a, $b, TMP_5, $c, TMP_6, self = this, $iter = TMP_4.$$p, block = $iter || nil, result = nil;

      TMP_4.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("classify")
      };
      result = ($a = ($b = $scope.get('Hash')).$new, $a.$$p = (TMP_5 = function(h, k){var self = TMP_5.$$s || this;
if (h == null) h = nil;if (k == null) k = nil;
      return h['$[]='](k, self.$class().$new())}, TMP_5.$$s = self, TMP_5), $a).call($b);
      ($a = ($c = self).$each, $a.$$p = (TMP_6 = function(item){var self = TMP_6.$$s || this, $a;
if (item == null) item = nil;
      return result['$[]'](((($a = Opal.yield1(block, item)) === $breaker) ? $breaker.$v : $a)).$add(item)}, TMP_6.$$s = self, TMP_6), $a).call($c);
      return result;
    };

    def['$collect!'] = TMP_7 = function() {
      var $a, $b, TMP_8, self = this, $iter = TMP_7.$$p, block = $iter || nil, result = nil;

      TMP_7.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect!")
      };
      result = self.$class().$new();
      ($a = ($b = self).$each, $a.$$p = (TMP_8 = function(item){var self = TMP_8.$$s || this, $a;
if (item == null) item = nil;
      return result['$<<'](((($a = Opal.yield1(block, item)) === $breaker) ? $breaker.$v : $a))}, TMP_8.$$s = self, TMP_8), $a).call($b);
      return self.$replace(result);
    };

    Opal.defn(self, '$map!', def['$collect!']);

    def.$delete = function(o) {
      var self = this;

      self.hash.$delete(o);
      return self;
    };

    def['$delete?'] = function(o) {
      var $a, self = this;

      if ((($a = self['$include?'](o)) !== nil && (!$a.$$is_boolean || $a == true))) {
        self.$delete(o);
        return self;
        } else {
        return nil
      };
    };

    def.$delete_if = TMP_9 = function() {try {

      var $a, $b, TMP_10, $c, $d, TMP_11, self = this, $iter = TMP_9.$$p, $yield = $iter || nil;

      TMP_9.$$p = null;
      ((($a = ($yield !== nil)) !== false && $a !== nil) ? $a : Opal.ret(self.$enum_for("delete_if")));
      ($a = ($b = ($c = ($d = self).$select, $c.$$p = (TMP_11 = function(o){var self = TMP_11.$$s || this, $a;
if (o == null) o = nil;
      return $a = Opal.yield1($yield, o), $a === $breaker ? $a : $a}, TMP_11.$$s = self, TMP_11), $c).call($d)).$each, $a.$$p = (TMP_10 = function(o){var self = TMP_10.$$s || this;
        if (self.hash == null) self.hash = nil;
if (o == null) o = nil;
      return self.hash.$delete(o)}, TMP_10.$$s = self, TMP_10), $a).call($b);
      return self;
      } catch ($returner) { if ($returner === Opal.returner) { return $returner.$v } throw $returner; }
    };

    def['$add?'] = function(o) {
      var $a, self = this;

      if ((($a = self['$include?'](o)) !== nil && (!$a.$$is_boolean || $a == true))) {
        return nil
        } else {
        return self.$add(o)
      };
    };

    def.$each = TMP_12 = function() {
      var $a, $b, self = this, $iter = TMP_12.$$p, block = $iter || nil;

      TMP_12.$$p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each")
      };
      ($a = ($b = self.hash).$each_key, $a.$$p = block.$to_proc(), $a).call($b);
      return self;
    };

    def['$empty?'] = function() {
      var self = this;

      return self.hash['$empty?']();
    };

    def['$eql?'] = function(other) {
      var $a, $b, TMP_13, self = this;

      return self.hash['$eql?'](($a = ($b = other).$instance_eval, $a.$$p = (TMP_13 = function(){var self = TMP_13.$$s || this;
        if (self.hash == null) self.hash = nil;

      return self.hash}, TMP_13.$$s = self, TMP_13), $a).call($b));
    };

    def.$clear = function() {
      var self = this;

      self.hash.$clear();
      return self;
    };

    def['$include?'] = function(o) {
      var self = this;

      return self.hash['$include?'](o);
    };

    Opal.defn(self, '$member?', def['$include?']);

    def.$merge = function(enum$) {
      var $a, $b, TMP_14, self = this;

      ($a = ($b = enum$).$each, $a.$$p = (TMP_14 = function(item){var self = TMP_14.$$s || this;
if (item == null) item = nil;
      return self.$add(item)}, TMP_14.$$s = self, TMP_14), $a).call($b);
      return self;
    };

    def.$replace = function(enum$) {
      var self = this;

      self.$clear();
      self.$merge(enum$);
      return self;
    };

    def.$size = function() {
      var self = this;

      return self.hash.$size();
    };

    Opal.defn(self, '$length', def.$size);

    def.$subtract = function(enum$) {
      var $a, $b, TMP_15, self = this;

      ($a = ($b = enum$).$each, $a.$$p = (TMP_15 = function(item){var self = TMP_15.$$s || this;
if (item == null) item = nil;
      return self.$delete(item)}, TMP_15.$$s = self, TMP_15), $a).call($b);
      return self;
    };

    return (def.$to_a = function() {
      var self = this;

      return self.hash.$keys();
    }, nil) && 'to_a';
  })(self, null);
  return (function($base) {
    var self = $module($base, 'Enumerable');

    var def = self.$$proto, $scope = self.$$scope, TMP_16;

    def.$to_set = TMP_16 = function(klass, args) {
      var $a, $b, self = this, $iter = TMP_16.$$p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      if (klass == null) {
        klass = $scope.get('Set')
      }
      TMP_16.$$p = null;
      return ($a = ($b = klass).$new, $a.$$p = block.$to_proc(), $a).apply($b, [self].concat(args));
    }
        ;Opal.donate(self, ["$to_set"]);
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/parser/sexp"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$attr_reader', '$attr_accessor', '$[]', '$[]=', '$send', '$to_proc', '$<<', '$push', '$new', '$dup', '$is_a?', '$==', '$array', '$join', '$map', '$inspect', '$line']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $Sexp(){};
      var self = $Sexp = $klass($base, $super, 'Sexp', $Sexp);

      var def = self.$$proto, $scope = self.$$scope, TMP_1;

      def.array = def.source = nil;
      self.$attr_reader("array");

      self.$attr_accessor("source");

      def.$initialize = function(args) {
        var self = this;

        return self.array = args;
      };

      def.$type = function() {
        var self = this;

        return self.array['$[]'](0);
      };

      def['$type='] = function(type) {
        var self = this;

        return self.array['$[]='](0, type);
      };

      def.$children = function() {
        var self = this;

        return self.array['$[]']($range(1, -1, false));
      };

      def.$method_missing = TMP_1 = function(sym, args) {
        var $a, $b, self = this, $iter = TMP_1.$$p, block = $iter || nil;

        args = $slice.call(arguments, 1);
        TMP_1.$$p = null;
        return ($a = ($b = self.array).$send, $a.$$p = block.$to_proc(), $a).apply($b, [sym].concat(args));
      };

      def['$<<'] = function(other) {
        var self = this;

        self.array['$<<'](other);
        return self;
      };

      def.$push = function(parts) {
        var $a, self = this;

        parts = $slice.call(arguments, 0);
        ($a = self.array).$push.apply($a, [].concat(parts));
        return self;
      };

      def.$to_ary = function() {
        var self = this;

        return self.array;
      };

      def.$dup = function() {
        var self = this;

        return $scope.get('Sexp').$new(self.array.$dup());
      };

      def['$=='] = function(other) {
        var $a, self = this;

        if ((($a = other['$is_a?']($scope.get('Sexp'))) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.array['$=='](other.$array())
          } else {
          return self.array['$=='](other)
        };
      };

      Opal.defn(self, '$eql?', def['$==']);

      def.$line = function() {
        var $a, self = this;

        return ($a = self.source, $a !== false && $a !== nil ?self.source['$[]'](0) : $a);
      };

      def.$column = function() {
        var $a, self = this;

        return ($a = self.source, $a !== false && $a !== nil ?self.source['$[]'](1) : $a);
      };

      def.$inspect = function() {
        var $a, $b, TMP_2, self = this;

        return "(" + (($a = ($b = self.array).$map, $a.$$p = (TMP_2 = function(e){var self = TMP_2.$$s || this;
if (e == null) e = nil;
        return e.$inspect()}, TMP_2.$$s = self, TMP_2), $a).call($b).$join(", ")) + ")";
      };

      def.$pretty_inspect = function() {
        var $a, $b, TMP_3, self = this;

        return "(" + ((function() {if ((($a = self.$line()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "" + (self.$line()) + " "
          } else {
          return ""
        }; return nil; })()) + (($a = ($b = self.array).$map, $a.$$p = (TMP_3 = function(e){var self = TMP_3.$$s || this;
if (e == null) e = nil;
        return e.$inspect()}, TMP_3.$$s = self, TMP_3), $a).call($b).$join(", ")) + ")";
      };

      return Opal.defn(self, '$to_s', def.$inspect);
    })(self, null)
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["strscan"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$attr_reader', '$length', '$pos=']);
  return (function($base, $super) {
    function $StringScanner(){};
    var self = $StringScanner = $klass($base, $super, 'StringScanner', $StringScanner);

    var def = self.$$proto, $scope = self.$$scope;

    def.pos = def.string = def.working = def.prev_pos = def.matched = def.match = nil;
    self.$attr_reader("pos");

    self.$attr_reader("matched");

    def.$initialize = function(string) {
      var self = this;

      self.string = string;
      self.pos = 0;
      self.matched = nil;
      self.working = string;
      return self.match = [];
    };

    self.$attr_reader("string");

    def['$beginning_of_line?'] = function() {
      var self = this;

      return self.pos === 0 || self.string.charAt(self.pos - 1) === "\n";
    };

    Opal.defn(self, '$bol?', def['$beginning_of_line?']);

    def.$scan = function(regex) {
      var self = this;

      
      var regex  = new RegExp('^' + regex.toString().substring(1, regex.toString().length - 1)),
          result = regex.exec(self.working);

      if (result == null) {
        return self.matched = nil;
      }
      else if (typeof(result) === 'object') {
        self.prev_pos = self.pos;
        self.pos     += result[0].length;
        self.working  = self.working.substring(result[0].length);
        self.matched  = result[0];
        self.match    = result;

        return result[0];
      }
      else if (typeof(result) === 'string') {
        self.pos     += result.length;
        self.working  = self.working.substring(result.length);

        return result;
      }
      else {
        return nil;
      }
    ;
    };

    def['$[]'] = function(idx) {
      var self = this;

      
      var match = self.match;

      if (idx < 0) {
        idx += match.length;
      }

      if (idx < 0 || idx >= match.length) {
        return nil;
      }

      if (match[idx] == null) {
        return nil;
      }

      return match[idx];
    ;
    };

    def.$check = function(regex) {
      var self = this;

      
      var regexp = new RegExp('^' + regex.toString().substring(1, regex.toString().length - 1)),
          result = regexp.exec(self.working);

      if (result == null) {
        return self.matched = nil;
      }

      return self.matched = result[0];
    ;
    };

    def.$peek = function(length) {
      var self = this;

      return self.working.substring(0, length);
    };

    def['$eos?'] = function() {
      var self = this;

      return self.working.length === 0;
    };

    def.$skip = function(re) {
      var self = this;

      
      re = new RegExp('^' + re.source)
      var result = re.exec(self.working);

      if (result == null) {
        return self.matched = nil;
      }
      else {
        var match_str = result[0];
        var match_len = match_str.length;
        self.matched = match_str;
        self.prev_pos = self.pos;
        self.pos += match_len;
        self.working = self.working.substring(match_len);
        return match_len;
      }
    ;
    };

    def.$get_byte = function() {
      var self = this;

      
      var result = nil;
      if (self.pos < self.string.length) {
        self.prev_pos = self.pos;
        self.pos += 1;
        result = self.matched = self.working.substring(0, 1);
        self.working = self.working.substring(1);
      }
      else {
        self.matched = nil;
      }

      return result;
    ;
    };

    Opal.defn(self, '$getch', def.$get_byte);

    def['$pos='] = function(pos) {
      var self = this;

      
      if (pos < 0) {
        pos += self.string.$length();
      }
    ;
      self.pos = pos;
      return self.working = self.string.slice(pos);
    };

    def.$reset = function() {
      var self = this;

      self.working = self.string;
      self.matched = nil;
      return self.pos = 0;
    };

    def.$rest = function() {
      var self = this;

      return self.working;
    };

    def['$rest?'] = function() {
      var self = this;

      return self.working.length !== 0;
    };

    def.$terminate = function() {
      var $a, $b, self = this;

      self.match = nil;
      return (($a = [self.string.$length()]), $b = self, $b['$pos='].apply($b, $a), $a[$a.length-1]);
    };

    return (def.$unscan = function() {
      var self = this;

      self.pos = self.prev_pos;
      self.prev_pos = nil;
      self.match = nil;
      return self;
    }, nil) && 'unscan';
  })(self, null)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/parser/keywords"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $hash2 = Opal.hash2;

  Opal.add_stubs(['$attr_accessor', '$map', '$new', '$each', '$[]=', '$name', '$[]']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Keywords');

      var def = self.$$proto, $scope = self.$$scope, $a, $b, TMP_1;

      (function($base, $super) {
        function $KeywordTable(){};
        var self = $KeywordTable = $klass($base, $super, 'KeywordTable', $KeywordTable);

        var def = self.$$proto, $scope = self.$$scope;

        self.$attr_accessor("name", "id", "state");

        return (def.$initialize = function(name, id, state) {
          var self = this;

          self.name = name;
          self.id = id;
          return self.state = state;
        }, nil) && 'initialize';
      })(self, null);

      Opal.cdecl($scope, 'KEYWORDS', ($a = ($b = [["__LINE__", ["k__LINE__", "k__LINE__"], "expr_end"], ["__FILE__", ["k__FILE__", "k__FILE__"], "expr_end"], ["alias", ["kALIAS", "kALIAS"], "expr_fname"], ["and", ["kAND", "kAND"], "expr_beg"], ["begin", ["kBEGIN", "kBEGIN"], "expr_beg"], ["break", ["kBREAK", "kBREAK"], "expr_mid"], ["case", ["kCASE", "kCASE"], "expr_beg"], ["class", ["kCLASS", "kCLASS"], "expr_class"], ["def", ["kDEF", "kDEF"], "expr_fname"], ["defined?", ["kDEFINED", "kDEFINED"], "expr_arg"], ["do", ["kDO", "kDO"], "expr_beg"], ["else", ["kELSE", "kELSE"], "expr_beg"], ["elsif", ["kELSIF", "kELSIF"], "expr_beg"], ["end", ["kEND", "kEND"], "expr_end"], ["ensure", ["kENSURE", "kENSURE"], "expr_beg"], ["false", ["kFALSE", "kFALSE"], "expr_end"], ["for", ["kFOR", "kFOR"], "expr_beg"], ["if", ["kIF", "kIF_MOD"], "expr_beg"], ["in", ["kIN", "kIN"], "expr_beg"], ["module", ["kMODULE", "kMODULE"], "expr_beg"], ["nil", ["kNIL", "kNIL"], "expr_end"], ["next", ["kNEXT", "kNEXT"], "expr_mid"], ["not", ["kNOT", "kNOT"], "expr_beg"], ["or", ["kOR", "kOR"], "expr_beg"], ["redo", ["kREDO", "kREDO"], "expr_end"], ["rescue", ["kRESCUE", "kRESCUE_MOD"], "expr_mid"], ["return", ["kRETURN", "kRETURN"], "expr_mid"], ["self", ["kSELF", "kSELF"], "expr_end"], ["super", ["kSUPER", "kSUPER"], "expr_arg"], ["then", ["kTHEN", "kTHEN"], "expr_beg"], ["true", ["kTRUE", "kTRUE"], "expr_end"], ["undef", ["kUNDEF", "kUNDEF"], "expr_fname"], ["unless", ["kUNLESS", "kUNLESS_MOD"], "expr_beg"], ["until", ["kUNTIL", "kUNTIL_MOD"], "expr_beg"], ["when", ["kWHEN", "kWHEN"], "expr_beg"], ["while", ["kWHILE", "kWHILE_MOD"], "expr_beg"], ["yield", ["kYIELD", "kYIELD"], "expr_arg"]]).$map, $a.$$p = (TMP_1 = function(decl){var self = TMP_1.$$s || this, $a;
if (decl == null) decl = nil;
      return ($a = $scope.get('KeywordTable')).$new.apply($a, [].concat(decl))}, TMP_1.$$s = self, TMP_1), $a).call($b));

      Opal.defs(self, '$map', function() {
        var $a, $b, TMP_2, self = this;
        if (self.map == null) self.map = nil;

        if ((($a = self.map) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          self.map = $hash2([], {});
          ($a = ($b = $scope.get('KEYWORDS')).$each, $a.$$p = (TMP_2 = function(k){var self = TMP_2.$$s || this;
            if (self.map == null) self.map = nil;
if (k == null) k = nil;
          return self.map['$[]='](k.$name(), k)}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };
        return self.map;
      });

      Opal.defs(self, '$keyword', function(kw) {
        var self = this;

        return self.$map()['$[]'](kw);
      });
      
    })(self)
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/parser/lexer"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $hash2 = Opal.hash2;

  Opal.add_stubs(['$require', '$|', '$attr_reader', '$attr_accessor', '$new', '$has_local?', '$scope', '$parser', '$to_sym', '$<<', '$&', '$>>', '$!', '$==', '$include?', '$arg?', '$space?', '$check', '$after_operator?', '$scan', '$+', '$length', '$matched', '$pos=', '$-', '$pos', '$yylex', '$yylval', '$new_strterm', '$merge', '$yylval=', '$to_f', '$gsub', '$scanner', '$to_i', '$raise', '$peek', '$chr', '$%', '$[]', '$escape', '$peek_variable_name', '$bol?', '$eos?', '$read_escape', '$join', '$count', '$strterm', '$[]=', '$pushback', '$strterm=', '$add_string_content', '$line=', '$line', '$label_state?', '$end_with?', '$=~', '$keyword', '$state', '$name', '$id', '$cond?', '$cmdarg?', '$here_document', '$parse_string', '$skip', '$empty?', '$new_op_asgn', '$set_arg_state', '$spcarg?', '$beg?', '$===', '$new_strterm2', '$cond_push', '$cmdarg_push', '$cond_lexpop', '$cmdarg_lexpop', '$end?', '$heredoc_identifier', '$sub', '$inspect', '$process_numeric', '$process_identifier', '$size', '$pop', '$last']);
  self.$require("strscan");
  self.$require("opal/parser/keywords");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $Lexer(){};
      var self = $Lexer = $klass($base, $super, 'Lexer', $Lexer);

      var def = self.$$proto, $scope = self.$$scope;

      def.scanner = def.cond = def.cmdarg = def.lex_state = def.space_seen = def.column = def.yylval = def.tok_line = def.tok_column = def.line = def.scanner_stack = def.start_of_lambda = def.file = nil;
      Opal.cdecl($scope, 'STR_FUNC_ESCAPE', 1);

      Opal.cdecl($scope, 'STR_FUNC_EXPAND', 2);

      Opal.cdecl($scope, 'STR_FUNC_REGEXP', 4);

      Opal.cdecl($scope, 'STR_FUNC_QWORDS', 8);

      Opal.cdecl($scope, 'STR_FUNC_SYMBOL', 16);

      Opal.cdecl($scope, 'STR_FUNC_INDENT', 32);

      Opal.cdecl($scope, 'STR_FUNC_XQUOTE', 64);

      Opal.cdecl($scope, 'STR_SQUOTE', 0);

      Opal.cdecl($scope, 'STR_DQUOTE', $scope.get('STR_FUNC_EXPAND'));

      Opal.cdecl($scope, 'STR_XQUOTE', $scope.get('STR_FUNC_EXPAND')['$|']($scope.get('STR_FUNC_XQUOTE')));

      Opal.cdecl($scope, 'STR_REGEXP', $scope.get('STR_FUNC_REGEXP')['$|']($scope.get('STR_FUNC_ESCAPE'))['$|']($scope.get('STR_FUNC_EXPAND')));

      Opal.cdecl($scope, 'STR_SWORD', $scope.get('STR_FUNC_QWORDS'));

      Opal.cdecl($scope, 'STR_DWORD', $scope.get('STR_FUNC_QWORDS')['$|']($scope.get('STR_FUNC_EXPAND')));

      Opal.cdecl($scope, 'STR_SSYM', $scope.get('STR_FUNC_SYMBOL'));

      Opal.cdecl($scope, 'STR_DSYM', $scope.get('STR_FUNC_SYMBOL')['$|']($scope.get('STR_FUNC_EXPAND')));

      self.$attr_reader("line", "column");

      self.$attr_reader("scope");

      self.$attr_reader("eof_content");

      self.$attr_accessor("lex_state");

      self.$attr_accessor("strterm");

      self.$attr_accessor("scanner");

      self.$attr_accessor("yylval");

      self.$attr_accessor("parser");

      def.$initialize = function(source, file) {
        var self = this;

        self.lex_state = "expr_beg";
        self.cond = 0;
        self.cmdarg = 0;
        self.line = 1;
        self.tok_line = 1;
        self.column = 0;
        self.tok_column = 0;
        self.file = file;
        self.scanner = $scope.get('StringScanner').$new(source);
        self.scanner_stack = [self.scanner];
        self.case_stmt = nil;
        return self.start_of_lambda = nil;
      };

      def['$has_local?'] = function(local) {
        var self = this;

        return self.$parser().$scope()['$has_local?'](local.$to_sym());
      };

      def.$cond_push = function(n) {
        var self = this;

        return self.cond = (self.cond['$<<'](1))['$|']((n['$&'](1)));
      };

      def.$cond_pop = function() {
        var self = this;

        return self.cond = self.cond['$>>'](1);
      };

      def.$cond_lexpop = function() {
        var self = this;

        return self.cond = (self.cond['$>>'](1))['$|']((self.cond['$&'](1)));
      };

      def['$cond?'] = function() {
        var self = this;

        return (self.cond['$&'](1))['$=='](0)['$!']();
      };

      def.$cmdarg_push = function(n) {
        var self = this;

        return self.cmdarg = (self.cmdarg['$<<'](1))['$|']((n['$&'](1)));
      };

      def.$cmdarg_pop = function() {
        var self = this;

        return self.cmdarg = self.cmdarg['$>>'](1);
      };

      def.$cmdarg_lexpop = function() {
        var self = this;

        return self.cmdarg = (self.cmdarg['$>>'](1))['$|']((self.cmdarg['$&'](1)));
      };

      def['$cmdarg?'] = function() {
        var self = this;

        return (self.cmdarg['$&'](1))['$=='](0)['$!']();
      };

      def['$arg?'] = function() {
        var self = this;

        return ["expr_arg", "expr_cmdarg"]['$include?'](self.lex_state);
      };

      def['$end?'] = function() {
        var self = this;

        return ["expr_end", "expr_endarg", "expr_endfn"]['$include?'](self.lex_state);
      };

      def['$beg?'] = function() {
        var self = this;

        return ["expr_beg", "expr_value", "expr_mid", "expr_class"]['$include?'](self.lex_state);
      };

      def['$after_operator?'] = function() {
        var self = this;

        return ["expr_fname", "expr_dot"]['$include?'](self.lex_state);
      };

      def['$label_state?'] = function() {
        var $a, self = this;

        return ((($a = ["expr_beg", "expr_endfn"]['$include?'](self.lex_state)) !== false && $a !== nil) ? $a : self['$arg?']());
      };

      def['$spcarg?'] = function() {
        var $a, $b, self = this;

        return ($a = ($b = self['$arg?'](), $b !== false && $b !== nil ?self.space_seen : $b), $a !== false && $a !== nil ?self['$space?']()['$!']() : $a);
      };

      def['$space?'] = function() {
        var self = this;

        return self.scanner.$check(/\s/);
      };

      def.$set_arg_state = function() {
        var $a, self = this;

        return self.lex_state = (function() {if ((($a = self['$after_operator?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "expr_arg"
          } else {
          return "expr_beg"
        }; return nil; })();
      };

      def.$scan = function(regexp) {
        var $a, self = this, result = nil;

        if ((($a = result = self.scanner.$scan(regexp)) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.column = self.column['$+'](result.$length());
          self.yylval = self.yylval['$+'](self.scanner.$matched());};
        return result;
      };

      def.$skip = function(regexp) {
        var $a, self = this, result = nil;

        if ((($a = result = self.scanner.$scan(regexp)) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.column = self.column['$+'](result.$length());
          self.tok_column = self.column;};
        return result;
      };

      def.$check = function(regexp) {
        var self = this;

        return self.scanner.$check(regexp);
      };

      def.$pushback = function(n) {
        var $a, self = this;

        return ($a = self.scanner, $a['$pos=']($a.$pos()['$-'](n)));
      };

      def.$matched = function() {
        var self = this;

        return self.scanner.$matched();
      };

      def['$line='] = function(line) {
        var self = this;

        self.column = self.tok_column = 0;
        return self.line = self.tok_line = line;
      };

      def.$next_token = function() {
        var self = this, token = nil, value = nil, location = nil;

        token = self.$yylex();
        value = self.$yylval();
        location = [self.tok_line, self.tok_column];
        self.tok_column = self.column;
        self.tok_line = self.line;
        return [token, [value, location]];
      };

      def.$new_strterm = function(func, term, paren) {
        var self = this;

        return $hash2(["type", "func", "term", "paren"], {"type": "string", "func": func, "term": term, "paren": paren});
      };

      def.$new_strterm2 = function(func, term, paren) {
        var self = this;

        term = self.$new_strterm(func, term, paren);
        return term.$merge($hash2(["balance", "nesting"], {"balance": true, "nesting": 0}));
      };

      def.$new_op_asgn = function(value) {
        var $a, $b, self = this;

        (($a = [value]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
        return "tOP_ASGN";
      };

      def.$process_numeric = function() {
        var $a, $b, self = this;

        self.lex_state = "expr_end";
        if ((($a = self.$scan(/[\d_]+\.[\d_]+\b|[\d_]+(\.[\d_]+)?[eE][-+]?[\d_]+\b/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          (($a = [self.$scanner().$matched().$gsub(/_/, "").$to_f()]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tFLOAT";
        } else if ((($a = self.$scan(/([^0][\d_]*|0)\b/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          (($a = [self.$scanner().$matched().$gsub(/_/, "").$to_i()]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tINTEGER";
        } else if ((($a = self.$scan(/0[bB](0|1|_)+/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          (($a = [self.$scanner().$matched().$to_i(2)]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tINTEGER";
        } else if ((($a = self.$scan(/0[xX](\d|[a-f]|[A-F]|_)+/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          (($a = [self.$scanner().$matched().$to_i(16)]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tINTEGER";
        } else if ((($a = self.$scan(/0[oO]?([0-7]|_)+/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          (($a = [self.$scanner().$matched().$to_i(8)]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tINTEGER";
        } else if ((($a = self.$scan(/0[dD]([0-9]|_)+/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          (($a = [self.$scanner().$matched().$gsub(/_/, "").$to_i()]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tINTEGER";
          } else {
          return self.$raise("Lexing error on numeric type: `" + (self.$scanner().$peek(5)) + "`")
        };
      };

      def.$read_escape = function() {
        var $a, self = this;

        if ((($a = self.$scan(/\\/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\\"
        } else if ((($a = self.$scan(/n/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\n"
        } else if ((($a = self.$scan(/t/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\t"
        } else if ((($a = self.$scan(/r/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\r"
        } else if ((($a = self.$scan(/f/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\f"
        } else if ((($a = self.$scan(/v/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\v"
        } else if ((($a = self.$scan(/a/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\a"
        } else if ((($a = self.$scan(/e/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "\e"
        } else if ((($a = self.$scan(/s/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return " "
        } else if ((($a = self.$scan(/[0-7]{1,3}/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return (self.$matched().$to_i(8)['$%'](256)).$chr()
        } else if ((($a = self.$scan(/x([0-9a-fA-F]{1,2})/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$scanner()['$[]'](1).$to_i(16).$chr()
        } else if ((($a = self.$scan(/u([0-9a-zA-Z]{1,4})/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          if ((($a = (Opal.Object.$$scope.Encoding == null ? nil : 'constant')) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$scanner()['$[]'](1).$to_i(16).$chr((($scope.get('Encoding')).$$scope.get('UTF_8')))
            } else {
            return ""
          }
          } else {
          return self.$scan(/./)
        };
      };

      def.$peek_variable_name = function() {
        var $a, self = this;

        if ((($a = self.$check(/[@$]/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "tSTRING_DVAR"
        } else if ((($a = self.$scan(/\{/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "tSTRING_DBEG"
          } else {
          return nil
        };
      };

      def.$here_document = function(str_parse) {
        var $a, $b, $c, self = this, eos_regx = nil, expand = nil, escape = nil, str_buffer = nil, tok = nil, reg = nil, complete_str = nil;

        eos_regx = (new RegExp("[ \\t]*" + $scope.get('Regexp').$escape(str_parse['$[]']("term")) + "(\\r*\\n|$)"));
        expand = true;
        escape = str_parse['$[]']("func")['$==']($scope.get('STR_SQUOTE'))['$!']();
        if ((($a = self.$check(eos_regx)) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$scan((new RegExp("[ \\t]*" + $scope.get('Regexp').$escape(str_parse['$[]']("term")))));
          if ((($a = str_parse['$[]']("scanner")) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.scanner_stack['$<<'](str_parse['$[]']("scanner"));
            self.scanner = str_parse['$[]']("scanner");};
          return "tSTRING_END";};
        str_buffer = [];
        if ((($a = self.$scan(/#/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          if ((($a = tok = self.$peek_variable_name()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return tok};
          str_buffer['$<<']("#");};
        while (!((($b = ($c = self.$check(eos_regx), $c !== false && $c !== nil ?self.$scanner()['$bol?']() : $c)) !== nil && (!$b.$$is_boolean || $b == true)))) {
        if ((($b = self.$scanner()['$eos?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$raise("reached EOF while in heredoc")};
        if ((($b = self.$scan(/\n/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          str_buffer['$<<'](self.$scanner().$matched())
        } else if ((($b = (($c = expand !== false && expand !== nil) ? self.$check(/#(?=[\$\@\{])/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          break;
        } else if ((($b = self.$scan(/\\/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          str_buffer['$<<'](((function() {if (escape !== false && escape !== nil) {
            return self.$read_escape()
            } else {
            return self.$scanner().$matched()
          }; return nil; })()))
          } else {
          reg = $scope.get('Regexp').$new("[^#\u0000\\\\\n]+|.");
          self.$scan(reg);
          str_buffer['$<<'](self.$scanner().$matched());
        };};
        complete_str = str_buffer.$join("");
        self.line = self.line['$+'](complete_str.$count("\n"));
        (($a = [complete_str]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
        return "tSTRING_CONTENT";
      };

      def.$parse_string = function() {
        var $a, $b, self = this, str_parse = nil, func = nil, space = nil, qwords = nil, expand = nil, regexp = nil, str_buffer = nil, complete_str = nil;

        str_parse = self.$strterm();
        func = str_parse['$[]']("func");
        space = false;
        qwords = (func['$&']($scope.get('STR_FUNC_QWORDS')))['$=='](0)['$!']();
        expand = (func['$&']($scope.get('STR_FUNC_EXPAND')))['$=='](0)['$!']();
        regexp = (func['$&']($scope.get('STR_FUNC_REGEXP')))['$=='](0)['$!']();
        if ((($a = (($b = qwords !== false && qwords !== nil) ? self.$scan(/\s+/) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          space = true};
        str_buffer = [];
        if ((($a = self.$scan($scope.get('Regexp').$new($scope.get('Regexp').$escape(str_parse['$[]']("term"))))) !== nil && (!$a.$$is_boolean || $a == true))) {
          if ((($a = (($b = qwords !== false && qwords !== nil) ? str_parse['$[]']("done_last_space")['$!']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            str_parse['$[]=']("done_last_space", true);
            self.$pushback(1);
            (($a = [" "]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
            return "tSPACE";};
          if ((($a = str_parse['$[]']("balance")) !== nil && (!$a.$$is_boolean || $a == true))) {
            if (str_parse['$[]']("nesting")['$=='](0)) {
              if (regexp !== false && regexp !== nil) {
                (($a = [self.$scan(/\w+/)]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
                return "tREGEXP_END";};
              return "tSTRING_END";
              } else {
              str_buffer['$<<'](self.$scanner().$matched());
              ($a = "nesting", $b = str_parse, $b['$[]=']($a, $b['$[]']($a)['$-'](1)));
              (($a = [str_parse]), $b = self, $b['$strterm='].apply($b, $a), $a[$a.length-1]);
            }
          } else if (regexp !== false && regexp !== nil) {
            self.lex_state = "expr_end";
            (($a = [self.$scan(/\w+/)]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
            return "tREGEXP_END";
            } else {
            if ((($a = str_parse['$[]']("scanner")) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.scanner_stack['$<<'](str_parse['$[]']("scanner"));
              self.scanner = str_parse['$[]']("scanner");};
            return "tSTRING_END";
          };};
        if (space !== false && space !== nil) {
          (($a = [" "]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tSPACE";};
        if ((($a = ($b = str_parse['$[]']("balance"), $b !== false && $b !== nil ?self.$scan($scope.get('Regexp').$new($scope.get('Regexp').$escape(str_parse['$[]']("paren")))) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          str_buffer['$<<'](self.$scanner().$matched());
          ($a = "nesting", $b = str_parse, $b['$[]=']($a, $b['$[]']($a)['$+'](1)));
        } else if ((($a = self.$check(/#[@$]/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.$scan(/#/);
          if (expand !== false && expand !== nil) {
            return "tSTRING_DVAR"
            } else {
            str_buffer['$<<'](self.$scanner().$matched())
          };
        } else if ((($a = self.$scan(/#\{/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          if (expand !== false && expand !== nil) {
            return "tSTRING_DBEG"
            } else {
            str_buffer['$<<'](self.$scanner().$matched())
          }
        } else if ((($a = self.$scan(/\#/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          str_buffer['$<<']("#")};
        self.$add_string_content(str_buffer, str_parse);
        complete_str = str_buffer.$join("");
        self.line = self.line['$+'](complete_str.$count("\n"));
        (($a = [complete_str]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
        return "tSTRING_CONTENT";
      };

      def.$add_string_content = function(str_buffer, str_parse) {
        var $a, $b, $c, self = this, func = nil, end_str_re = nil, qwords = nil, expand = nil, regexp = nil, escape = nil, xquote = nil, c = nil, handled = nil, reg = nil;

        func = str_parse['$[]']("func");
        end_str_re = $scope.get('Regexp').$new($scope.get('Regexp').$escape(str_parse['$[]']("term")));
        qwords = (func['$&']($scope.get('STR_FUNC_QWORDS')))['$=='](0)['$!']();
        expand = (func['$&']($scope.get('STR_FUNC_EXPAND')))['$=='](0)['$!']();
        regexp = (func['$&']($scope.get('STR_FUNC_REGEXP')))['$=='](0)['$!']();
        escape = (func['$&']($scope.get('STR_FUNC_ESCAPE')))['$=='](0)['$!']();
        xquote = (func['$==']($scope.get('STR_XQUOTE')));
        while (!((($b = self.$scanner()['$eos?']()) !== nil && (!$b.$$is_boolean || $b == true)))) {
        c = nil;
        handled = true;
        if ((($b = self.$check(end_str_re)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = ($c = str_parse['$[]']("balance"), $c !== false && $c !== nil ?(str_parse['$[]']("nesting")['$=='](0)['$!']()) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$scan(end_str_re);
            c = self.$scanner().$matched();
            ($b = "nesting", $c = str_parse, $c['$[]=']($b, $c['$[]']($b)['$-'](1)));
            } else {
            break;
          }
        } else if ((($b = ($c = str_parse['$[]']("balance"), $c !== false && $c !== nil ?self.$scan($scope.get('Regexp').$new($scope.get('Regexp').$escape(str_parse['$[]']("paren")))) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          ($b = "nesting", $c = str_parse, $c['$[]=']($b, $c['$[]']($b)['$+'](1)));
          c = self.$scanner().$matched();
        } else if ((($b = (($c = qwords !== false && qwords !== nil) ? self.$scan(/\s/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$pushback(1);
          break;;
        } else if ((($b = (($c = expand !== false && expand !== nil) ? self.$check(/#(?=[\$\@\{])/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          break;
        } else if ((($b = (($c = qwords !== false && qwords !== nil) ? self.$scan(/\s/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$pushback(1);
          break;;
        } else if ((($b = self.$scan(/\\/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if (xquote !== false && xquote !== nil) {
            c = "\\"['$+'](self.$scan(/./))
          } else if ((($b = (($c = qwords !== false && qwords !== nil) ? self.$scan(/\n/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
            str_buffer['$<<']("\n");
            continue;;
          } else if ((($b = (($c = expand !== false && expand !== nil) ? self.$scan(/\n/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
            continue;
          } else if ((($b = (($c = qwords !== false && qwords !== nil) ? self.$scan(/\s/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
            c = " "
          } else if (regexp !== false && regexp !== nil) {
            if ((($b = self.$scan(/(.)/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              c = "\\"['$+'](self.$scanner().$matched())}
          } else if (expand !== false && expand !== nil) {
            c = self.$read_escape()
          } else if ((($b = self.$scan(/\n/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          } else if ((($b = self.$scan(/\\/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            if (escape !== false && escape !== nil) {
              c = "\\\\"
              } else {
              c = self.$scanner().$matched()
            }
          } else if ((($b = self.$scan(end_str_re)) !== nil && (!$b.$$is_boolean || $b == true))) {
            } else {
            str_buffer['$<<']("\\")
          }
          } else {
          handled = false
        };
        if (handled !== false && handled !== nil) {
          } else {
          reg = (function() {if (qwords !== false && qwords !== nil) {
            return $scope.get('Regexp').$new("[^" + ($scope.get('Regexp').$escape(str_parse['$[]']("term"))) + "#\u0000\n \\\\]+|.")
          } else if ((($b = str_parse['$[]']("balance")) !== nil && (!$b.$$is_boolean || $b == true))) {
            return $scope.get('Regexp').$new("[^" + ($scope.get('Regexp').$escape(str_parse['$[]']("term"))) + ($scope.get('Regexp').$escape(str_parse['$[]']("paren"))) + "#\u0000\\\\]+|.")
            } else {
            return $scope.get('Regexp').$new("[^" + ($scope.get('Regexp').$escape(str_parse['$[]']("term"))) + "#\u0000\\\\]+|.")
          }; return nil; })();
          self.$scan(reg);
          c = self.$scanner().$matched();
        };
        ((($b = c) !== false && $b !== nil) ? $b : c = self.$scanner().$matched());
        str_buffer['$<<'](c);};
        if ((($a = self.$scanner()['$eos?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$raise("reached EOF while in string")
          } else {
          return nil
        };
      };

      def.$heredoc_identifier = function() {
        var $a, $b, self = this, escape_method = nil, heredoc = nil, end_of_line = nil;

        if ((($a = self.$scan(/(-?)(['"])?(\w+)\2?/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          escape_method = (function() {if ((($a = (self.scanner['$[]'](2)['$==']("'"))) !== nil && (!$a.$$is_boolean || $a == true))) {
            return $scope.get('STR_SQUOTE')
            } else {
            return $scope.get('STR_DQUOTE')
          }; return nil; })();
          heredoc = self.scanner['$[]'](3);
          (($a = [self.$new_strterm(escape_method, heredoc, heredoc)]), $b = self, $b['$strterm='].apply($b, $a), $a[$a.length-1]);
          self.$strterm()['$[]=']("type", "heredoc");
          end_of_line = self.$scan(/.*\n/);
          if ((($a = end_of_line['$==']("\n")['$!']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$strterm()['$[]=']("scanner", $scope.get('StringScanner').$new(end_of_line))};
          ($a = self, $a['$line=']($a.$line()['$+'](1)));
          (($a = [heredoc]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tSTRING_BEG";
          } else {
          return nil
        };
      };

      def.$process_identifier = function(matched, cmd_start) {
        var $a, $b, $c, self = this, last_state = nil, result = nil, kw = nil, old_state = nil;

        last_state = self.lex_state;
        if ((($a = ($b = ($c = self['$label_state?'](), $c !== false && $c !== nil ?self.$check(/::/)['$!']() : $c), $b !== false && $b !== nil ?self.$scan(/:/) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.lex_state = "expr_beg";
          (($a = [matched]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
          return "tLABEL";};
        if (matched['$==']("defined?")) {
          if ((($a = self['$after_operator?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.lex_state = "expr_end";
            return "tIDENTIFIER";};
          self.lex_state = "expr_arg";
          return "kDEFINED";};
        if ((($a = matched['$end_with?']("?", "!")) !== nil && (!$a.$$is_boolean || $a == true))) {
          result = "tIDENTIFIER"
        } else if (self.lex_state['$==']("expr_fname")) {
          if ((($a = ($b = self.$check(/\=\>/)['$!'](), $b !== false && $b !== nil ?self.$scan(/\=/) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            result = "tIDENTIFIER";
            matched = matched['$+'](self.$scanner().$matched());}
        } else if ((($a = matched['$=~'](/^[A-Z]/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          result = "tCONSTANT"
          } else {
          result = "tIDENTIFIER"
        };
        if ((($a = ($b = self.lex_state['$==']("expr_dot")['$!'](), $b !== false && $b !== nil ?kw = $scope.get('Keywords').$keyword(matched) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          old_state = self.lex_state;
          self.lex_state = kw.$state();
          if (old_state['$==']("expr_fname")) {
            (($a = [kw.$name()]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
            return kw.$id()['$[]'](0);};
          if (self.lex_state['$==']("expr_beg")) {
            cmd_start = true};
          if (matched['$==']("do")) {
            if ((($a = self['$after_operator?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.lex_state = "expr_end";
              return "tIDENTIFIER";};
            if ((($a = self.start_of_lambda) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.start_of_lambda = false;
              self.lex_state = "expr_beg";
              return "kDO_LAMBDA";
            } else if ((($a = self['$cond?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.lex_state = "expr_beg";
              return "kDO_COND";
            } else if ((($a = ($b = self['$cmdarg?'](), $b !== false && $b !== nil ?self.lex_state['$==']("expr_cmdarg")['$!']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.lex_state = "expr_beg";
              return "kDO_BLOCK";
            } else if (self.lex_state['$==']("expr_endarg")) {
              return "kDO_BLOCK"
              } else {
              self.lex_state = "expr_beg";
              return "kDO";
            };
          } else if ((($a = ((($b = old_state['$==']("expr_beg")) !== false && $b !== nil) ? $b : old_state['$==']("expr_value"))) !== nil && (!$a.$$is_boolean || $a == true))) {
            (($a = [matched]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
            return kw.$id()['$[]'](0);
            } else {
            if ((($a = kw.$id()['$[]'](0)['$=='](kw.$id()['$[]'](1))['$!']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.lex_state = "expr_beg"};
            (($a = [matched]), $b = self, $b['$yylval='].apply($b, $a), $a[$a.length-1]);
            return kw.$id()['$[]'](1);
          };};
        if ((($a = ["expr_beg", "expr_dot", "expr_mid", "expr_arg", "expr_cmdarg"]['$include?'](self.lex_state)) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.lex_state = (function() {if (cmd_start !== false && cmd_start !== nil) {
            return "expr_cmdarg"
            } else {
            return "expr_arg"
          }; return nil; })()
          } else {
          self.lex_state = "expr_end"
        };
        if ((($a = ($b = ["expr_dot", "expr_fname"]['$include?'](last_state)['$!'](), $b !== false && $b !== nil ?self['$has_local?'](matched) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          self.lex_state = "expr_end"};
        return (function() {if ((($a = matched['$=~'](/^[A-Z]/)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "tCONSTANT"
          } else {
          return "tIDENTIFIER"
        }; return nil; })();
      };

      return (def.$yylex = function() {try {

        var $a, $b, $c, $d, self = this, cmd_start = nil, c = nil, token = nil, line_count = nil, result = nil, str_type = nil, paren = nil, term = nil, $case = nil, func = nil, start_word = nil, end_word = nil, matched = nil, sign = nil, utype = nil;

        self.yylval = "";
        self.space_seen = false;
        cmd_start = false;
        c = "";
        if ((($a = self.$strterm()) !== nil && (!$a.$$is_boolean || $a == true))) {
          if (self.$strterm()['$[]']("type")['$==']("heredoc")) {
            token = self.$here_document(self.$strterm())
            } else {
            token = self.$parse_string()
          };
          if ((($a = ((($b = token['$==']("tSTRING_END")) !== false && $b !== nil) ? $b : token['$==']("tREGEXP_END"))) !== nil && (!$a.$$is_boolean || $a == true))) {
            (($a = [nil]), $b = self, $b['$strterm='].apply($b, $a), $a[$a.length-1]);
            self.lex_state = "expr_end";};
          return token;};
        while ((($b = true) !== nil && (!$b.$$is_boolean || $b == true))) {
        if ((($b = self.$skip(/\ |\t|\r/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.space_seen = true;
          continue;;
        } else if ((($b = self.$skip(/(\n|#)/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          c = self.$scanner().$matched();
          if (c['$==']("#")) {
            self.$skip(/(.*)/)
            } else {
            ($b = self, $b['$line=']($b.$line()['$+'](1)))
          };
          self.$skip(/(\n+)/);
          if ((($b = self.$scanner().$matched()) !== nil && (!$b.$$is_boolean || $b == true))) {
            ($b = self, $b['$line=']($b.$line()['$+'](self.$scanner().$matched().$length())))};
          if ((($b = ["expr_beg", "expr_dot"]['$include?'](self.lex_state)) !== nil && (!$b.$$is_boolean || $b == true))) {
            continue;};
          if ((($b = self.$skip(/([\ \t\r\f\v]*)\./)) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = self.$scanner()['$[]'](1)['$empty?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
              } else {
              self.space_seen = true
            };
            self.$pushback(1);
            if ((($b = self.$check(/\.\./)) !== nil && (!$b.$$is_boolean || $b == true))) {
              } else {
              continue;
            };};
          cmd_start = true;
          self.lex_state = "expr_beg";
          (($b = ["\\n"]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
          return "tNL";
        } else if ((($b = self.$scan(/\;/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_beg";
          return "tSEMI";
        } else if ((($b = self.$check(/\*/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\*\*\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return self.$new_op_asgn("**");
          } else if ((($b = self.$scan(/\*\*/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$set_arg_state();
            return "tPOW";
          } else if ((($b = self.$scan(/\*\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return self.$new_op_asgn("*");
            } else {
            self.$scan(/\*/);
            if ((($b = self['$after_operator?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
              self.lex_state = "expr_arg";
              return "tSTAR2";
            } else if ((($b = ($c = self.space_seen, $c !== false && $c !== nil ?self.$check(/\S/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
              self.lex_state = "expr_beg";
              return "tSTAR";
            } else if ((($b = ["expr_beg", "expr_mid"]['$include?'](self.lex_state)) !== nil && (!$b.$$is_boolean || $b == true))) {
              self.lex_state = "expr_beg";
              return "tSTAR";
              } else {
              self.lex_state = "expr_beg";
              return "tSTAR2";
            };
          }
        } else if ((($b = self.$scan(/\!/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self['$after_operator?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_arg";
            if ((($b = self.$scan(/@/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              return ["tBANG", "!"]};
            } else {
            self.lex_state = "expr_beg"
          };
          if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            return "tNEQ"
          } else if ((($b = self.$scan(/\~/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            return "tNMATCH"};
          return "tBANG";
        } else if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = (($c = self.lex_state['$==']("expr_beg")) ? self.space_seen['$!']() : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = ($c = self.$scan(/begin/), $c !== false && $c !== nil ?self['$space?']() : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
              self.$scan(/(.*)/);
              line_count = 0;
              while ((($c = true) !== nil && (!$c.$$is_boolean || $c == true))) {
              if ((($c = self.$scanner()['$eos?']()) !== nil && (!$c.$$is_boolean || $c == true))) {
                self.$raise("embedded document meets end of file")};
              if ((($c = ($d = self.$scan(/\=end/), $d !== false && $d !== nil ?self['$space?']() : $d)) !== nil && (!$c.$$is_boolean || $c == true))) {
                self.line = self.line['$+'](line_count);
                return self.$yylex();};
              if ((($c = self.$scan(/\n/)) !== nil && (!$c.$$is_boolean || $c == true))) {
                line_count = line_count['$+'](1);
                continue;;};
              self.$scan(/(.*)/);};}};
          self.$set_arg_state();
          if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              return "tEQQ"};
            return "tEQ";};
          if ((($b = self.$scan(/\~/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            return "tMATCH"
          } else if ((($b = self.$scan(/\>/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            return "tASSOC"};
          return "tEQL";
        } else if ((($b = self.$scan(/\"/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          (($b = [self.$new_strterm($scope.get('STR_DQUOTE'), "\"", "\x00")]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1]);
          return "tSTRING_BEG";
        } else if ((($b = self.$scan(/\'/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          (($b = [self.$new_strterm($scope.get('STR_SQUOTE'), "'", "\x00")]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1]);
          return "tSTRING_BEG";
        } else if ((($b = self.$scan(/\`/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          (($b = [self.$new_strterm($scope.get('STR_XQUOTE'), "`", "\x00")]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1]);
          return "tXSTRING_BEG";
        } else if ((($b = self.$scan(/\&/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\&/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              return self.$new_op_asgn("&&")};
            return "tANDOP";
          } else if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return self.$new_op_asgn("&");};
          if ((($b = self['$spcarg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            result = "tAMPER"
          } else if ((($b = self['$beg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            result = "tAMPER"
            } else {
            result = "tAMPER2"
          };
          self.$set_arg_state();
          return result;
        } else if ((($b = self.$scan(/\|/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\|/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              return self.$new_op_asgn("||")};
            return "tOROP";
          } else if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            return self.$new_op_asgn("|")};
          self.$set_arg_state();
          return "tPIPE";
        } else if ((($b = self.$scan(/\%[QqWwixrs]/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          str_type = self.$scanner().$matched()['$[]'](1, 1);
          paren = term = self.$scan(/./);
          $case = term;if ("("['$===']($case)) {term = ")"}else if ("["['$===']($case)) {term = "]"}else if ("{"['$===']($case)) {term = "}"}else if ("<"['$===']($case)) {term = ">"}else {paren = "\x00"};
          $b = Opal.to_ary((function() {$case = str_type;if ("Q"['$===']($case)) {return ["tSTRING_BEG", $scope.get('STR_DQUOTE')]}else if ("q"['$===']($case)) {return ["tSTRING_BEG", $scope.get('STR_SQUOTE')]}else if ("W"['$===']($case)) {self.$skip(/\s*/);
          return ["tWORDS_BEG", $scope.get('STR_DWORD')];}else if ("w"['$===']($case) || "i"['$===']($case)) {self.$skip(/\s*/);
          return ["tAWORDS_BEG", $scope.get('STR_SWORD')];}else if ("x"['$===']($case)) {return ["tXSTRING_BEG", $scope.get('STR_XQUOTE')]}else if ("r"['$===']($case)) {return ["tREGEXP_BEG", $scope.get('STR_REGEXP')]}else if ("s"['$===']($case)) {return ["tSTRING_BEG", $scope.get('STR_SQUOTE')]}else { return nil }})()), token = ($b[0] == null ? nil : $b[0]), func = ($b[1] == null ? nil : $b[1]);
          (($b = [self.$new_strterm2(func, term, paren)]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1]);
          return token;
        } else if ((($b = self.$scan(/\//)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self['$beg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            (($b = [self.$new_strterm($scope.get('STR_REGEXP'), "/", "/")]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1]);
            return "tREGEXP_BEG";
          } else if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return self.$new_op_asgn("/");
          } else if ((($b = self['$after_operator?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_arg"
          } else if ((($b = self['$arg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = ($c = self.$check(/\s/)['$!'](), $c !== false && $c !== nil ?self.space_seen : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
              (($b = [self.$new_strterm($scope.get('STR_REGEXP'), "/", "/")]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1]);
              return "tREGEXP_BEG";}
            } else {
            self.lex_state = "expr_beg"
          };
          return "tDIVIDE";
        } else if ((($b = self.$scan(/\%/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return self.$new_op_asgn("%");
          } else if ((($b = self.$check(/[^\s]/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = ((($c = self.lex_state['$==']("expr_beg")) !== false && $c !== nil) ? $c : ((($d = self.lex_state['$==']("expr_arg")) ? self.space_seen : $d)))) !== nil && (!$b.$$is_boolean || $b == true))) {
              start_word = self.$scan(/./);
              end_word = ((($b = $hash2(["(", "[", "{"], {"(": ")", "[": "]", "{": "}"})['$[]'](start_word)) !== false && $b !== nil) ? $b : start_word);
              (($b = [self.$new_strterm2($scope.get('STR_DQUOTE'), end_word, start_word)]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1]);
              return "tSTRING_BEG";}};
          self.$set_arg_state();
          return "tPERCENT";
        } else if ((($b = self.$scan(/\\/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\r?\n/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.space_seen = true;
            continue;;};
          self.$raise($scope.get('SyntaxError'), "backslash must appear before newline :" + (self.file) + ":" + (self.line));
        } else if ((($b = self.$scan(/\(/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          result = self.$scanner().$matched();
          if ((($b = self['$beg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            result = "tLPAREN"
          } else if ((($b = ($c = self.space_seen, $c !== false && $c !== nil ?self['$arg?']() : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
            result = "tLPAREN_ARG"
            } else {
            result = "tLPAREN2"
          };
          self.lex_state = "expr_beg";
          self.$cond_push(0);
          self.$cmdarg_push(0);
          return result;
        } else if ((($b = self.$scan(/\)/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$cond_lexpop();
          self.$cmdarg_lexpop();
          self.lex_state = "expr_end";
          return "tRPAREN";
        } else if ((($b = self.$scan(/\[/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          result = self.$scanner().$matched();
          if ((($b = self['$after_operator?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_arg";
            if ((($b = self.$scan(/\]=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              return "tASET"
            } else if ((($b = self.$scan(/\]/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              return "tAREF"
              } else {
              self.$raise("Unexpected '[' token")
            };
          } else if ((($b = self['$beg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            result = "tLBRACK"
          } else if ((($b = ($c = self['$arg?'](), $c !== false && $c !== nil ?self.space_seen : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
            result = "tLBRACK"
            } else {
            result = "tLBRACK2"
          };
          self.lex_state = "expr_beg";
          self.$cond_push(0);
          self.$cmdarg_push(0);
          return result;
        } else if ((($b = self.$scan(/\]/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$cond_lexpop();
          self.$cmdarg_lexpop();
          self.lex_state = "expr_end";
          return "tRBRACK";
        } else if ((($b = self.$scan(/\}/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$cond_lexpop();
          self.$cmdarg_lexpop();
          self.lex_state = "expr_end";
          return "tRCURLY";
        } else if ((($b = self.$scan(/\.\.\./)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_beg";
          return "tDOT3";
        } else if ((($b = self.$scan(/\.\./)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_beg";
          return "tDOT2";
        } else if ((($b = self.$scan(/\./)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if (self.lex_state['$==']("expr_fname")) {
            } else {
            self.lex_state = "expr_dot"
          };
          return "tDOT";
        } else if ((($b = self.$scan(/\:\:/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self['$beg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return "tCOLON3";
          } else if ((($b = self['$spcarg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return "tCOLON3";};
          self.lex_state = "expr_dot";
          return "tCOLON2";
        } else if ((($b = self.$scan(/\:/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = ((($c = self['$end?']()) !== false && $c !== nil) ? $c : self.$check(/\s/))) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = self.$check(/\w/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              } else {
              self.lex_state = "expr_beg";
              return "tCOLON";
            };
            self.lex_state = "expr_fname";
            return "tSYMBEG";};
          if ((($b = self.$scan(/\'/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            (($b = [self.$new_strterm($scope.get('STR_SSYM'), "'", "\x00")]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1])
          } else if ((($b = self.$scan(/\"/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            (($b = [self.$new_strterm($scope.get('STR_DSYM'), "\"", "\x00")]), $c = self, $c['$strterm='].apply($c, $b), $b[$b.length-1])};
          self.lex_state = "expr_fname";
          return "tSYMBEG";
        } else if ((($b = self.$scan(/\^\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_beg";
          return self.$new_op_asgn("^");
        } else if ((($b = self.$scan(/\^/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$set_arg_state();
          return "tCARET";
        } else if ((($b = self.$check(/\</)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\<\<\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return self.$new_op_asgn("<<");
          } else if ((($b = self.$scan(/\<\</)) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = self['$after_operator?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
              self.lex_state = "expr_arg";
              return "tLSHFT";
            } else if ((($b = ($c = ($d = self['$after_operator?']()['$!'](), $d !== false && $d !== nil ?self['$end?']()['$!']() : $d), $c !== false && $c !== nil ?(((($d = self['$arg?']()['$!']()) !== false && $d !== nil) ? $d : self.space_seen)) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
              if ((($b = token = self.$heredoc_identifier()) !== nil && (!$b.$$is_boolean || $b == true))) {
                return token};
              self.lex_state = "expr_beg";
              return "tLSHFT";};
            self.lex_state = "expr_beg";
            return "tLSHFT";
          } else if ((($b = self.$scan(/\<\=\>/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            if ((($b = self['$after_operator?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
              self.lex_state = "expr_arg"
              } else {
              if (self.lex_state['$==']("expr_class")) {
                cmd_start = true};
              self.lex_state = "expr_beg";
            };
            return "tCMP";
          } else if ((($b = self.$scan(/\<\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$set_arg_state();
            return "tLEQ";
          } else if ((($b = self.$scan(/\</)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$set_arg_state();
            return "tLT";}
        } else if ((($b = self.$check(/\>/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\>\>\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            return self.$new_op_asgn(">>")
          } else if ((($b = self.$scan(/\>\>/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$set_arg_state();
            return "tRSHFT";
          } else if ((($b = self.$scan(/\>\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$set_arg_state();
            return "tGEQ";
          } else if ((($b = self.$scan(/\>/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$set_arg_state();
            return "tGT";}
        } else if ((($b = self.$scan(/->/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_end";
          self.start_of_lambda = true;
          return "tLAMBDA";
        } else if ((($b = self.$scan(/[+-]/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          matched = self.$scanner().$matched();
          $b = Opal.to_ary((function() {if (matched['$==']("+")) {
            return ["tPLUS", "tUPLUS"]
            } else {
            return ["tMINUS", "tUMINUS"]
          }; return nil; })()), sign = ($b[0] == null ? nil : $b[0]), utype = ($b[1] == null ? nil : $b[1]);
          if ((($b = self['$beg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_mid";
            (($b = [matched]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
            if ((($b = ($c = self.$scanner().$peek(1)['$=~'](/\d/), $c !== false && $c !== nil ?Opal.ret((function() {if (utype['$==']("tUMINUS")) {
              return "-@NUM"
              } else {
              return "+@NUM"
            }; return nil; })()) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
              } else {
              return utype
            };
          } else if ((($b = self['$after_operator?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_arg";
            if ((($b = self.$scan(/@/)) !== nil && (!$b.$$is_boolean || $b == true))) {
              (($b = [matched['$+']("@")]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
              return "tIDENTIFIER";};
            (($b = [matched]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
            return sign;};
          if ((($b = self.$scan(/\=/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return self.$new_op_asgn(matched);};
          if ((($b = self['$spcarg?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_mid";
            (($b = [matched]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
            return utype;};
          self.lex_state = "expr_beg";
          (($b = [matched]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
          return sign;
        } else if ((($b = self.$scan(/\?/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self['$end?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return "tEH";};
          if ((($b = self.$check(/\ |\t|\r|\s/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_beg";
            return "tEH";
          } else if ((($b = self.$scan(/\\/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_end";
            (($b = [self.$read_escape()]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
            return "tSTRING";};
          self.lex_state = "expr_end";
          (($b = [self.$scan(/./)]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
          return "tSTRING";
        } else if ((($b = self.$scan(/\~/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$set_arg_state();
          return "tTILDE";
        } else if ((($b = self.$check(/\$/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.$scan(/\$([1-9]\d*)/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_end";
            (($b = [self.$scanner().$matched().$sub("$", "")]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
            return "tNTH_REF";
          } else if ((($b = self.$scan(/(\$_)(\w+)/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_end";
            return "tGVAR";
          } else if ((($b = self.$scan(/\$[\+\'\`\&!@\"~*$?\/\\:;=.,<>_]/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_end";
            return "tGVAR";
          } else if ((($b = self.$scan(/\$\w+/)) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.lex_state = "expr_end";
            return "tGVAR";
            } else {
            self.$raise("Bad gvar name: " + (self.$scanner().$peek(5).$inspect()))
          }
        } else if ((($b = self.$scan(/\$\w+/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_end";
          return "tGVAR";
        } else if ((($b = self.$scan(/\@\@\w*/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_end";
          return "tCVAR";
        } else if ((($b = self.$scan(/\@\w*/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_end";
          return "tIVAR";
        } else if ((($b = self.$scan(/\,/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.lex_state = "expr_beg";
          return "tCOMMA";
        } else if ((($b = self.$scan(/\{/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = self.start_of_lambda) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.start_of_lambda = false;
            self.lex_state = "expr_beg";
            return "tLAMBEG";
          } else if ((($b = ((($c = self['$arg?']()) !== false && $c !== nil) ? $c : self.lex_state['$==']("expr_end"))) !== nil && (!$b.$$is_boolean || $b == true))) {
            result = "tLCURLY"
          } else if (self.lex_state['$==']("expr_endarg")) {
            result = "LBRACE_ARG"
            } else {
            result = "tLBRACE"
          };
          self.lex_state = "expr_beg";
          self.$cond_push(0);
          self.$cmdarg_push(0);
          return result;
        } else if ((($b = ($c = self.$scanner()['$bol?'](), $c !== false && $c !== nil ?self.$skip(/\__END__(\n|$)/) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          while ((($c = true) !== nil && (!$c.$$is_boolean || $c == true))) {
          if ((($c = self.$scanner()['$eos?']()) !== nil && (!$c.$$is_boolean || $c == true))) {
            self.eof_content = self.$yylval();
            return false;};
          self.$scan(/(.*)/);
          self.$scan(/\n/);}
        } else if ((($b = self.$check(/[0-9]/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          return self.$process_numeric()
        } else if ((($b = self.$scan(/(\w)+[\?\!]?/)) !== nil && (!$b.$$is_boolean || $b == true))) {
          return self.$process_identifier(self.$scanner().$matched(), cmd_start)};
        if ((($b = self.$scanner()['$eos?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
          if (self.scanner_stack.$size()['$=='](1)) {
            (($b = [false]), $c = self, $c['$yylval='].apply($c, $b), $b[$b.length-1]);
            return false;
            } else {
            self.scanner_stack.$pop();
            self.scanner = self.scanner_stack.$last();
            return self.$yylex();
          }};
        self.$raise("Unexpected content in parsing stream `" + (self.$scanner().$peek(5)) + "` :" + (self.file) + ":" + (self.line));};
        } catch ($returner) { if ($returner === Opal.returner) { return $returner.$v } throw $returner; }
      }, nil) && 'yylex';
    })(self, null)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["racc/parser.rb"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$class', '$_racc_do_parse_rb', '$_racc_setup', '$[]', '$!', '$==', '$next_token', '$racc_read_token', '$+', '$<', '$nil?', '$puts', '$>', '$-', '$push', '$<<', '$racc_shift', '$-@', '$*', '$last', '$pop', '$__send__', '$raise', '$racc_reduce', '$>=', '$inspect', '$racc_next_state', '$racc_token2str', '$racc_print_stacks', '$empty?', '$map', '$racc_print_states', '$each_index', '$each']);
  return (function($base) {
    var self = $module($base, 'Racc');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $Parser(){};
      var self = $Parser = $klass($base, $super, 'Parser', $Parser);

      var def = self.$$proto, $scope = self.$$scope;

      def.yydebug = nil;
      def.$_racc_setup = function() {
        var self = this;

        return ((self.$class()).$$scope.get('Racc_arg'));
      };

      def.$do_parse = function() {
        var self = this;

        return self.$_racc_do_parse_rb(self.$_racc_setup(), false);
      };

      def.$_racc_do_parse_rb = function(arg, in_debug) {
        var $a, $b, $c, $d, self = this, action_table = nil, action_check = nil, action_default = nil, action_pointer = nil, goto_table = nil, goto_check = nil, goto_default = nil, goto_pointer = nil, nt_base = nil, reduce_table = nil, token_table = nil, shift_n = nil, reduce_n = nil, use_result = nil, racc_state = nil, racc_tstack = nil, racc_vstack = nil, racc_t = nil, racc_tok = nil, racc_val = nil, racc_read_next = nil, racc_user_yyerror = nil, racc_error_status = nil, token = nil, act = nil, i = nil, nerr = nil, custate = nil, curstate = nil, reduce_i = nil, reduce_len = nil, reduce_to = nil, method_id = nil, tmp_t = nil, tmp_v = nil, reduce_call_result = nil, k1 = nil;

        action_table = arg['$[]'](0);
        action_check = arg['$[]'](1);
        action_default = arg['$[]'](2);
        action_pointer = arg['$[]'](3);
        goto_table = arg['$[]'](4);
        goto_check = arg['$[]'](5);
        goto_default = arg['$[]'](6);
        goto_pointer = arg['$[]'](7);
        nt_base = arg['$[]'](8);
        reduce_table = arg['$[]'](9);
        token_table = arg['$[]'](10);
        shift_n = arg['$[]'](11);
        reduce_n = arg['$[]'](12);
        use_result = arg['$[]'](13);
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
        while ((($b = true) !== nil && (!$b.$$is_boolean || $b == true))) {
        i = action_pointer['$[]'](racc_state['$[]'](-1));
        if (i !== false && i !== nil) {
          if (racc_read_next !== false && racc_read_next !== nil) {
            if ((($b = racc_t['$=='](0)['$!']()) !== nil && (!$b.$$is_boolean || $b == true))) {
              token = self.$next_token();
              racc_tok = token['$[]'](0);
              racc_val = token['$[]'](1);
              if (racc_tok['$=='](false)) {
                racc_t = 0
                } else {
                racc_t = token_table['$[]'](racc_tok);
                if (racc_t !== false && racc_t !== nil) {
                  } else {
                  racc_t = 1
                };
              };
              if ((($b = self.yydebug) !== nil && (!$b.$$is_boolean || $b == true))) {
                self.$racc_read_token(racc_t, racc_tok, racc_val)};
              racc_read_next = false;}};
          i = i['$+'](racc_t);
          if ((($b = ((($c = ((($d = (i['$<'](0))) !== false && $d !== nil) ? $d : ((act = action_table['$[]'](i)))['$nil?']())) !== false && $c !== nil) ? $c : (action_check['$[]'](i)['$=='](racc_state['$[]'](-1))['$!']()))) !== nil && (!$b.$$is_boolean || $b == true))) {
            act = action_default['$[]'](racc_state['$[]'](-1))};
          } else {
          act = action_default['$[]'](racc_state['$[]'](-1))
        };
        if ((($b = self.yydebug) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$puts("(act: " + (act) + ", shift_n: " + (shift_n) + ", reduce_n: " + (reduce_n) + ")")};
        if ((($b = (($c = act['$>'](0)) ? act['$<'](shift_n) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          if (racc_error_status['$>'](0)) {
            if ((($b = racc_t['$=='](1)['$!']()) !== nil && (!$b.$$is_boolean || $b == true))) {
              racc_error_status = racc_error_status['$-'](1)}};
          racc_vstack.$push(racc_val);
          curstate = act;
          racc_state['$<<'](act);
          racc_read_next = true;
          if ((($b = self.yydebug) !== nil && (!$b.$$is_boolean || $b == true))) {
            racc_tstack.$push(racc_t);
            self.$racc_shift(racc_t, racc_tstack, racc_vstack);};
        } else if ((($b = (($c = act['$<'](0)) ? act['$>'](reduce_n['$-@']()) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
          reduce_i = act['$*'](-3);
          reduce_len = reduce_table['$[]'](reduce_i);
          reduce_to = reduce_table['$[]'](reduce_i['$+'](1));
          method_id = reduce_table['$[]'](reduce_i['$+'](2));
          tmp_t = racc_tstack.$last(reduce_len);
          tmp_v = racc_vstack.$last(reduce_len);
          racc_state.$pop(reduce_len);
          racc_vstack.$pop(reduce_len);
          racc_tstack.$pop(reduce_len);
          if (use_result !== false && use_result !== nil) {
            reduce_call_result = self.$__send__(method_id, tmp_v, nil, tmp_v['$[]'](0));
            racc_vstack.$push(reduce_call_result);
            } else {
            self.$raise("not using result??")
          };
          racc_tstack.$push(reduce_to);
          if ((($b = self.yydebug) !== nil && (!$b.$$is_boolean || $b == true))) {
            self.$racc_reduce(tmp_t, reduce_to, racc_tstack, racc_vstack)};
          k1 = reduce_to['$-'](nt_base);
          if ((($b = ((reduce_i = goto_pointer['$[]'](k1)))['$=='](nil)['$!']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            reduce_i = reduce_i['$+'](racc_state['$[]'](-1));
            if ((($b = ($c = ($d = (reduce_i['$>='](0)), $d !== false && $d !== nil ?(((curstate = goto_table['$[]'](reduce_i)))['$=='](nil)['$!']()) : $d), $c !== false && $c !== nil ?(goto_check['$[]'](reduce_i)['$=='](k1)) : $c)) !== nil && (!$b.$$is_boolean || $b == true))) {
              racc_state.$push(curstate)
              } else {
              racc_state.$push(goto_default['$[]'](k1))
            };
            } else {
            racc_state.$push(goto_default['$[]'](k1))
          };
        } else if (act['$=='](shift_n)) {
          return racc_vstack['$[]'](0)
        } else if (act['$=='](reduce_n['$-@']())) {
          self.$raise($scope.get('SyntaxError'), "unexpected '" + (racc_tok.$inspect()) + "'")
          } else {
          self.$raise("Rac: unknown action: " + (act))
        };
        if ((($b = self.yydebug) !== nil && (!$b.$$is_boolean || $b == true))) {
          self.$racc_next_state(racc_state['$[]'](-1), racc_state)};};
      };

      def.$racc_read_token = function(t, tok, val) {
        var self = this;

        self.$puts("read    " + (tok) + "(" + (self.$racc_token2str(t)) + ") " + (val.$inspect()));
        return self.$puts("\n");
      };

      def.$racc_shift = function(tok, tstack, vstack) {
        var self = this;

        self.$puts("shift  " + (self.$racc_token2str(tok)));
        self.$racc_print_stacks(tstack, vstack);
        return self.$puts("\n");
      };

      def.$racc_reduce = function(toks, sim, tstack, vstack) {
        var $a, $b, TMP_1, self = this;

        self.$puts("reduce " + ((function() {if ((($a = toks['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "<none>"
          } else {
          return ($a = ($b = toks).$map, $a.$$p = (TMP_1 = function(t){var self = TMP_1.$$s || this;
if (t == null) t = nil;
          return self.$racc_token2str(t)}, TMP_1.$$s = self, TMP_1), $a).call($b)
        }; return nil; })()));
        self.$puts("  --> " + (self.$racc_token2str(sim)));
        return self.$racc_print_stacks(tstack, vstack);
      };

      def.$racc_next_state = function(curstate, state) {
        var self = this;

        self.$puts("goto  " + (curstate));
        self.$racc_print_states(state);
        return self.$puts("\n");
      };

      def.$racc_token2str = function(tok) {
        var self = this;

        return ((self.$class()).$$scope.get('Racc_token_to_s_table'))['$[]'](tok);
      };

      def.$racc_print_stacks = function(t, v) {
        var $a, $b, TMP_2, self = this;

        self.$puts("  [");
        ($a = ($b = t).$each_index, $a.$$p = (TMP_2 = function(i){var self = TMP_2.$$s || this;
if (i == null) i = nil;
        return self.$puts("    (" + (self.$racc_token2str(t['$[]'](i))) + " " + (v['$[]'](i).$inspect()) + ")")}, TMP_2.$$s = self, TMP_2), $a).call($b);
        return self.$puts("  ]");
      };

      return (def.$racc_print_states = function(s) {
        var $a, $b, TMP_3, self = this;

        self.$puts("  [");
        ($a = ($b = s).$each, $a.$$p = (TMP_3 = function(st){var self = TMP_3.$$s || this;
if (st == null) st = nil;
        return self.$puts("   " + (st))}, TMP_3.$$s = self, TMP_3), $a).call($b);
        return self.$puts("  ]");
      }, nil) && 'racc_print_states';
    })(self, null)
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/parser/grammar"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $hash = Opal.hash;

  Opal.add_stubs(['$require', '$new', '$each', '$empty?', '$[]=', '$to_i', '$+', '$split', '$new_compstmt', '$[]', '$new_block', '$<<', '$new_body', '$lex_state=', '$lexer', '$new_alias', '$s', '$to_sym', '$value', '$new_if', '$new_while', '$new_until', '$new_rescue_mod', '$new_assign', '$new_op_asgn', '$op_to_setter', '$new_unary_call', '$new_return', '$new_break', '$new_next', '$new_call', '$new_super', '$new_yield', '$new_assignable', '$new_attrasgn', '$new_colon2', '$new_colon3', '$new_const', '$new_sym', '$new_op_asgn1', '$new_irange', '$new_erange', '$new_binary_call', '$new_int', '$new_float', '$include?', '$type', '$==', '$-@', '$to_f', '$new_not', '$new_and', '$new_or', '$add_block_pass', '$new_hash', '$cmdarg_push', '$cmdarg_pop', '$new_block_pass', '$new_splat', '$line', '$new_paren', '$new_array', '$new_nil', '$cond_push', '$cond_pop', '$new_class', '$new_sclass', '$new_module', '$push_scope', '$new_def', '$pop_scope', '$new_iter', '$new_ident', '$new_block_args', '$push', '$intern', '$first', '$nil?', '$new_str', '$str_append', '$new_xstr', '$new_regexp', '$concat', '$new_str_content', '$strterm', '$strterm=', '$new_evstr', '$cond_lexpop', '$cmdarg_lexpop', '$new_gvar', '$new_ivar', '$new_cvar', '$new_dsym', '$negate_num', '$new_self', '$new_true', '$new_false', '$new___FILE__', '$new___LINE__', '$new_var_ref', '$new_args', '$add_local', '$scope', '$raise']);
  self.$require("racc/parser.rb");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $Parser(){};
      var self = $Parser = $klass($base, $super, 'Parser', $Parser);

      var def = self.$$proto, $scope = self.$$scope, $a, $b, TMP_1, $c, TMP_3, $d, TMP_5, $e, TMP_7, clist = nil, racc_action_table = nil, arr = nil, idx = nil, racc_action_check = nil, racc_action_pointer = nil, racc_action_default = nil, racc_goto_table = nil, racc_goto_check = nil, racc_goto_pointer = nil, racc_goto_default = nil, racc_reduce_table = nil, racc_reduce_n = nil, racc_shift_n = nil, racc_token_table = nil, racc_nt_base = nil, racc_use_result_var = nil;

      clist = ["63,64,65,8,51,-90,-93,543,57,58,203,204,566,61,270,59,60,62,23,24,66", "67,-95,-505,-89,597,828,22,28,27,90,89,91,92,446,639,17,577,-88,-92", "-91,-64,7,41,6,9,94,93,639,84,50,86,85,87,270,88,95,96,-90,81,82,270", "38,39,101,784,678,-83,638,100,203,204,-508,710,587,639,-437,-94,-75", "265,782,638,-95,-437,36,599,598,30,-505,566,52,298,299,54,744,32,566", "-91,609,40,269,761,203,204,-92,566,-507,18,638,-505,-85,542,79,73,75", "76,77,78,-90,265,-90,74,80,-90,566,101,-87,565,-81,56,100,-437,53,-507", "-83,37,83,63,64,65,269,51,-80,-84,-83,57,58,269,535,-92,61,537,59,60", "62,23,24,66,67,305,608,710,-82,401,22,28,27,90,89,91,92,-83,101,17,709", "-507,579,100,-83,586,41,-86,265,94,93,760,84,50,86,85,87,305,88,95,96", "597,81,82,101,38,39,655,101,100,565,639,200,100,656,101,-91,565,-91", "201,100,-91,778,-92,101,-92,565,208,-92,100,212,-268,661,52,203,204", "54,-84,-268,-90,252,73,40,101,638,565,864,-82,100,74,18,710,518,519", "305,79,73,75,76,77,78,599,598,604,74,80,101,199,709,-268,907,100,56", "777,-446,53,-268,908,37,83,63,64,65,575,51,597,-268,592,57,58,576,203", "204,61,593,59,60,62,256,257,66,67,597,265,-84,602,841,255,28,27,90,89", "91,92,-82,-80,217,397,398,203,204,597,-88,41,-268,906,94,93,597,84,50", "86,85,87,259,88,95,96,574,81,82,-84,38,39,562,599,598,610,-84,-274,101", "-82,709,-445,-89,100,-274,619,-82,-321,-445,-508,599,598,208,-276,-321", "212,561,-275,52,-441,-276,54,635,254,-275,225,-441,40,101,599,598,600", "514,100,225,216,599,598,595,515,79,73,75,76,77,78,-82,-275,583,74,80", "-446,-274,-90,-275,796,-445,56,772,202,53,522,-321,37,83,63,64,65,-276", "51,262,101,-275,57,58,787,100,263,61,552,59,60,62,256,257,66,67,513", "535,203,204,534,255,288,292,90,89,91,92,-88,-87,217,-275,582,771,101", "615,-95,41,-94,100,94,93,793,84,50,86,85,87,-275,88,95,96,794,81,82", "-275,38,39,549,225,229,234,235,236,231,233,241,242,237,238,-274,218", "219,-445,552,239,240,-274,208,583,-445,212,-508,409,52,550,581,54,411", "410,222,797,228,40,224,223,220,221,232,230,226,216,227,-275,798,-439", "79,73,75,76,77,78,-439,552,525,74,80,-440,243,801,-227,526,101,56,-440", "-274,53,100,-445,37,83,63,64,65,582,51,-444,101,-443,57,58,483,100,-444", "61,-443,59,60,62,256,257,66,67,103,104,105,106,107,255,288,292,90,89", "91,92,101,-437,217,442,444,100,481,615,-437,41,443,535,94,93,537,84", "50,86,85,87,-276,88,95,96,787,81,82,-276,38,39,810,225,229,234,235,236", "231,233,241,242,237,238,-274,218,219,692,811,239,240,-274,208,549,535", "212,-508,537,52,813,444,54,546,787,222,573,228,40,224,223,220,221,232", "230,226,216,227,-276,603,-434,79,73,75,76,77,78,-434,341,340,74,80,483", "243,338,337,341,340,56,692,-274,53,750,522,37,83,63,64,65,-442,51,806", "787,655,57,58,-442,341,340,61,656,59,60,62,256,257,66,67,103,104,105", "106,107,255,288,292,90,89,91,92,607,620,217,-81,-86,338,337,341,340", "41,-89,-94,94,93,539,84,50,86,85,87,305,88,95,96,538,81,82,-507,38,39", "815,225,229,234,235,236,231,233,241,242,237,238,-84,218,219,806,787", "239,240,-92,208,763,572,212,573,611,52,614,305,54,225,617,222,490,228", "40,224,223,220,221,232,230,226,216,227,823,825,828,79,73,75,76,77,78", "829,524,831,74,80,-254,243,523,-227,490,876,56,-256,618,53,265,305,37", "83,63,64,65,274,51,516,833,834,57,58,835,95,96,61,509,59,60,62,256,257", "66,67,103,104,105,106,107,255,288,292,90,89,91,92,508,507,217,338,337", "341,340,-63,-255,41,265,842,94,93,843,84,50,86,85,87,259,88,95,96,844", "81,82,265,38,39,265,225,229,234,235,236,231,233,241,242,237,238,746", "218,219,244,225,239,240,847,208,848,678,212,490,850,52,483,-254,54,854", "225,222,252,228,40,224,223,220,221,232,230,226,216,227,481,225,225,79", "73,75,76,77,78,859,479,861,74,80,213,243,636,222,448,876,56,224,223", "53,447,225,37,83,63,64,65,445,51,867,869,870,57,58,305,713,573,61,705", "59,60,62,256,257,66,67,702,880,-257,412,700,255,288,292,90,89,91,92", "881,883,217,338,337,341,340,399,690,41,388,-508,94,93,552,84,50,86,85", "87,259,88,95,96,385,81,82,893,38,39,894,225,229,234,235,236,231,233", "241,242,237,238,686,218,219,685,305,239,240,899,208,900,578,212,828", "829,52,684,225,54,652,644,222,252,228,40,224,223,220,221,232,230,226", "216,227,297,678,296,79,73,75,76,77,78,909,528,244,74,80,222,243,305", "657,224,223,56,915,244,53,670,684,37,83,63,64,65,225,51,198,197,196", "57,58,195,668,925,61,828,59,60,62,256,257,66,67,927,928,108,-75,667", "255,288,292,90,89,91,92,222,97,217,665,224,223,220,221,,41,,,94,93,", "84,50,86,85,87,,88,95,96,,81,82,,38,39,,225,229,234,235,236,231,233", "241,242,237,238,,218,219,,,239,240,,208,,,212,,,52,,,54,,,222,,228,40", "224,223,220,221,232,230,226,216,227,,,,79,73,75,76,77,78,,,,74,80,,243", ",,,,56,,,53,,,37,83,63,64,65,225,51,,,,57,58,,,,61,,59,60,62,23,24,66", "67,,,,,,22,28,27,90,89,91,92,222,,17,,224,223,220,221,,41,,,94,93,,84", "50,86,85,87,,88,95,96,,81,82,,38,39,,225,229,234,235,236,231,233,241", "242,237,238,,218,219,,,239,240,,208,,,212,,,52,,,54,,,222,,228,40,224", "223,220,221,232,230,226,18,227,,,,79,73,75,76,77,78,,,,74,80,,243,,", ",,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67", ",,,,,255,28,27,90,89,91,92,,554,217,333,331,330,,332,,41,,,94,93,,84", "50,86,85,87,259,88,95,96,,81,82,,38,39,,225,229,234,235,236,231,233", "241,242,237,238,,218,219,,,239,240,,208,,,212,,,52,,,54,,254,222,,228", "40,224,223,220,221,232,230,226,216,227,,,,79,73,75,76,77,78,,,,74,80", ",243,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257", "66,67,,,,,,255,288,292,90,89,91,92,,554,217,333,331,330,,332,,41,,,94", "93,,84,50,86,85,87,259,88,95,96,,81,82,,38,39,,225,229,234,235,236,231", "233,241,242,237,238,,218,219,,,239,240,,208,,,212,,,52,,,54,,644,222", ",228,40,224,223,220,221,232,230,226,216,227,,,,79,73,75,76,77,78,,,", "74,80,,243,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62", "23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50", "86,85,87,,88,95,96,,81,82,,38,39,,225,229,234,235,236,231,233,241,242", "237,238,,218,219,,,239,240,,36,,,30,,,52,,,54,,32,222,,228,40,224,223", "220,221,232,230,226,18,227,,,,79,73,75,76,77,78,,,,74,80,,243,,,,,56", ",,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,", ",22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95", "96,,81,82,,38,39,,225,229,234,235,236,231,233,241,242,237,238,,218,219", ",,239,240,,36,,,30,,,52,,,54,,32,222,,228,40,224,223,220,221,232,230", "226,18,227,,,,79,73,75,76,77,78,,,,74,80,,243,,,,,56,,,53,,,37,83,63", "64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91", "92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,225", "229,234,235,236,231,233,241,242,237,238,,218,219,,,239,240,,208,,,212", "213,,52,,,54,,,222,,228,40,224,223,220,221,232,230,226,18,227,,,,79", "73,75,76,77,78,,,,74,80,,243,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57", "58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,217,,,,,", ",41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,225,229,234,235", "236,231,233,241,242,237,238,,218,219,,,239,240,,208,,,212,,,52,,,54", ",,222,,228,40,224,223,220,221,232,230,226,216,227,,,,79,73,75,76,77", "78,,,,74,80,,243,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59", "60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,259,88,95,96,,81,82,,38,39,,225,229,234,235,236,231", "233,241,242,237,238,,218,219,,,239,240,,208,,,212,,,52,,,54,,,222,,228", "40,224,223,220,221,232,230,226,216,227,,,,79,73,75,76,77,78,,,,74,80", ",243,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24", "66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,225,229,234,235,236,231,233,241,242,237", "238,,218,219,,,239,240,,36,,,30,,,52,,,54,,32,222,,228,40,224,223,220", "221,232,230,226,18,227,,,,79,73,75,76,77,78,,,,74,80,,243,,,,,56,,,53", ",,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255", "28,27,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96", ",81,82,,38,39,,225,229,234,235,236,231,233,241,242,237,238,,218,219", ",,239,240,,208,,,212,,,52,,,54,,254,222,252,228,40,224,223,220,221,232", "230,226,216,227,,,,79,73,75,76,77,78,,,,74,80,,243,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,28,27", "90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96,,81", "82,,38,39,,225,229,234,235,236,231,233,241,242,237,238,,218,219,,,239", "240,,208,,,212,,,52,,,54,,254,222,252,228,40,224,223,220,221,232,230", "226,216,227,,,,79,73,75,76,77,78,,,,74,80,,243,,,,,56,,,53,,,37,83,63", "64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,28,27,90,89", "91,92,,554,217,333,331,330,,332,,41,,,94,93,,84,50,86,85,87,259,88,95", "96,,81,82,,38,39,554,,333,331,330,,332,,,557,,,,,,,,803,,,208,,,212", "225,,52,,,54,,254,,252,,40,,,557,,239,240,,216,,,560,,79,73,75,76,77", "78,,222,,74,80,224,223,220,221,,,56,,,53,,,37,83,63,64,65,8,51,,,,57", "58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,554,17,333", "331,330,,332,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,", ",,,,,,,,557,,,,,,,,560,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79", "73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58", ",,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41", ",9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,225,-528,-528,-528", "-528,231,233,,,-528,-528,,,,,,239,240,,36,,,30,,,52,,,54,,32,222,,228", "40,224,223,220,221,232,230,226,18,227,,,,79,73,75,76,77,78,,,,74,80", ",,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257", "66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93,,84,50,86", "85,87,,88,95,96,,81,82,324,,333,331,330,,332,,,,,,,,,,,,,,,,,696,,,212", ",,52,,,54,,,,,,335,,,,,,,,338,337,341,340,,79,73,75,76,77,78,765,,,74", "80,,,,,,,56,,,53,,,293,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23", "24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86", "85,87,,88,95,96,,81,82,,38,39,,225,-528,-528,-528,-528,231,233,,,-528", "-528,,,,,,239,240,,36,,,30,,,52,,,54,,32,222,,228,40,224,223,220,221", "232,230,226,18,227,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27", "90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82", ",38,39,,225,-528,-528,-528,-528,231,233,,,-528,-528,,,,,,239,240,,36", ",,278,,,52,,,54,,32,222,,228,40,224,223,220,221,232,230,226,18,227,", ",,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57", "58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217", ",,,,,,289,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,738,,333,331,330", ",332,,,,,,,,,,,,,,,,,286,,,283,,,52,,,54,,282,,,,335,732,,,,,,,338,337", "341,340,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,293,83,63,64,65", ",51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91", "92,,,217,,,,,,,289,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,324,,333", "331,330,,332,,,,,,,,,,,,,,,,,286,,,212,,,52,,,54,,,,,,335,,,,,,,,338", "337,341,340,,79,73,75,76,77,78,,,,74,80,,,,295,,,56,,,53,,,293,83,63", "64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89", "91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39", ",225,-528,-528,-528,-528,231,233,,,-528,-528,,,,,,239,240,,36,,,30,", ",52,,,54,,32,222,,228,40,224,223,220,221,232,230,226,18,227,,,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,", ",61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,", "9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,225,-528,-528,-528", "-528,231,233,,,-528,-528,,,,,,239,240,,36,,,30,,,52,,,54,,32,222,,228", "40,224,223,220,221,232,230,226,18,227,,,,79,73,75,76,77,78,,,,74,80", ",,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66", "67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87", ",88,95,96,,81,82,,38,39,,225,229,234,235,236,231,233,241,242,237,238", ",-528,-528,,,239,240,,36,,,30,,,52,,,54,,32,222,,228,40,224,223,220", "221,232,230,226,18,227,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,", ",37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255", "288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96", ",81,82,,38,39,,225,-528,-528,-528,-528,231,233,,,-528,-528,,,,,,239", "240,,208,,,212,,,52,,,54,,644,222,252,228,40,224,223,220,221,232,230", "226,216,227,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64", "65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89", "91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39", ",225,229,234,235,236,231,233,241,,237,238,,,,,,239,240,,208,,,212,,", "52,,,54,,,222,,228,40,224,223,220,221,232,230,226,216,227,,,,79,73,75", "76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61", ",59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41", ",,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,225,,,,,,,,,,,,,,,", "239,240,,208,,,212,,,52,,,54,,,222,,228,40,224,223,220,221,,,226,216", "227,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51", ",,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92", ",,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,225", "229,234,235,236,231,233,,,237,238,,,,,,239,240,,208,,,212,,,52,,,54", ",,222,,228,40,224,223,220,221,232,230,226,216,227,,,,79,73,75,76,77", "78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60", "62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84", "50,86,85,87,,88,95,96,,81,82,,38,39,,225,,,,,,,,,,,,,,,,239,240,,36", ",,30,,,52,,,54,,32,222,,228,40,224,223,220,221,,,226,18,227,,,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,", "61,,59,60,62,256,257,66,67,,,,,,255,28,27,90,89,91,92,,,217,,,,,,,41", ",,94,93,,84,50,86,85,87,259,88,95,96,,81,82,,38,39,,225,,,,,,,,,,,,", ",,,239,240,,208,,,212,,,52,,,54,,254,222,,228,40,224,223,220,221,,,226", "216,227,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65", ",51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,28,27,90,89,91,92", ",,217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96,,81,82,,38,39,,225", ",,,,,,,,,,,,,,,239,240,,208,,,212,,,52,,,54,,254,222,,228,40,224,223", "220,221,,,226,216,227,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,", "37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27", "90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,", "38,39,,225,229,234,235,236,231,233,241,242,237,238,,-528,-528,,,239", "240,,208,,,212,,,52,,,54,,,222,,228,40,224,223,220,221,232,230,226,18", "227,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51", ",,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,28,27,90,89,91,92,,", "217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96,,81,82,,38,39,,225", ",,,,,,,,,,,,,,,239,240,,208,,,212,,,52,,,54,,254,222,,228,40,224,223", "220,221,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83", "63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292", "90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96,,81", "82,,38,39,,225,,,,,,,,,,,,,,,,239,240,,208,,,212,,,52,,,54,,,222,,228", "40,224,223,220,221,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,", "53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22", "28,27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,", ",,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,", ",,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,", ",,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78", ",,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62", "23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86", "85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54", ",,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90", "89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38", "39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,,,79", "73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58", ",,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,,41", ",,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,", "208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80", "101,,,,,100,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256", "257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93,,84,50", "86,85,87,,88,95,96,,81,82,324,,333,331,330,,332,,,,,,,,,,,,,,,,,353", ",,30,,,52,,,54,,32,,,,335,319,,,,,,,338,337,341,340,,79,73,75,76,77", "78,,,,74,80,,,,,,,56,,,53,,,293,83,63,64,65,,51,,,,57,58,,,,61,,59,60", "62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93", ",84,50,86,85,358,,88,95,96,,81,82,738,,333,331,330,,332,,,,,,,,,,,,", ",364,,,359,,,212,,,52,,,54,,,,,,335,732,,,,,,,338,337,341,340,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,293,83,63,64,65,,51,,,,57,58,,", ",61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,,41,,", "94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208", ",,212,,,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66", "67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,", "644,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,", "37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,", "217,,,,,,,289,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,324,,333,331", "330,,332,,,,,,,,,,,,,,,,,888,,,212,,,52,,,54,,,,,,335,,545,,,,,,338", "337,341,340,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,293,83,63,64", "65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89", "91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39", ",,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,", "61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,", "41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,", ",,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74", "80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257", "66,67,,,,,,255,28,27,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85", "87,259,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54", ",254,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,", ",37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255", "288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96", ",81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,", ",216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8", "51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,", "17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,", ",,,,,,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59", "60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,6,9,94,93", ",84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30", ",,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,401", "56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,", ",,,22,28,27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95", "96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,", ",,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65", ",51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,", ",17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,", ",,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77", "78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60", "62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50", "86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52", ",,54,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53", ",,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28", "27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82", ",38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,", ",79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57", "58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7", "41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,", ",,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74", "80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24", "66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,6,9,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32", ",,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83", "63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292", "90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82", ",38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,", ",,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57", "58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217", ",,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,", ",,,,,,,,,208,,,212,,,52,,,54,,749,,,,40,,,,,,,,216,,,,,79,73,75,76,77", "78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60", "62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,217,,,,,,,41,,,94,93,,84", "50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,", "52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,", ",53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,", "22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95", "96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40,,,", ",,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65", ",51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,", ",217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,", ",,,,,,,,,,,,,,208,,,212,,,52,,,54,,418,,,,40,,,,,,,,216,,,,,79,73,75", "76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61", ",59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,418,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80", ",,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66", "67,,,,,,22,28,27,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87", ",88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,", ",40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83", "63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,28,27,90", "89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96,,81,82", ",38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,254,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,217,", ",,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,", ",,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78", ",,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62", "23,24,66,67,,,,,,22,28,27,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50", "86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52", ",,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53", ",,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28", "27,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,", ",,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,", ",,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,", ",,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62", "23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86", "85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54", ",,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,", "217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,", ",,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59", "60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67", ",,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88", "95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40", ",,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64", "65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89", "91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39", ",,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,", ",61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,", "9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,", "36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80", ",,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66", "67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87", ",88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32,,", ",40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63", "64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91", "92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,", ",,,,,,,,,,,,,,,,,208,,,212,,450,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,", "61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,", "41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,", ",,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74", "80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24", "66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32", ",,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83", "63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292", "90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82", ",38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,", ",,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57", "58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217", ",,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,", ",,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78", ",,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62", "256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84", "50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,", "52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,", ",53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,", ",255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88", "95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40", ",,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64", "65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89", "91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39", ",,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,", "61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,", "41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,", ",,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74", "80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257", "66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86", "85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54", ",,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,", "217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,", ",,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59", "60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66", "67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,", ",,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,", "217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,", ",,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59", "60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66", "67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,", ",,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,", "217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,", ",,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59", "60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66", "67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,", ",,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,", "217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,", ",,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59", "60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66", "67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,", ",,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,", ",57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,", "217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,", ",,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59", "60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67", ",,,,,22,28,27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88", "95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40", ",,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64", "65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92", ",,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,", ",,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73,75,76", "77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59", "60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93", ",84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30", ",,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,401", "56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67", ",,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87", ",88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,", ",40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83", "63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90", "89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38", "39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79", "73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58", ",,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,", ",,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,", ",,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,", ",,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62", "256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84", "50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,", "52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,", ",53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,", "22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95", "96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40,,,", ",,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65", ",51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91", "92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,", ",,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75", "76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61", ",59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,", "30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,", ",,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67", ",,,,,255,28,27,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,259", "88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,254", ",252,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,28,27", "90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96,,81", "82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,499,,,54,,254,,252,,40,,,", ",,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65", ",51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,28,27,90,89,91,92", ",,217,,,,,,,41,,,94,93,,84,50,86,85,87,259,88,95,96,,81,82,,38,39,,", ",,,,,,,,,,,,,,,,,,208,,,212,,503,52,,,54,,254,,252,,40,,,,,,,,216,,", ",,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57", "58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217", ",,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,", ",,,,,,,,,208,,,212,,,52,,,54,,254,,,,40,,,,,,,,216,,,,,79,73,75,76,77", "78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60", "62,256,257,66,67,,,,,,255,28,27,90,89,91,92,,,217,,,,,,,41,,,94,93,", "84,50,86,85,87,259,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,", "212,,,52,,,54,,644,,252,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80", ",,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257", "66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86", "85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54", ",,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27", "90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82", ",38,39,,,,,,,,,,,,,,,,,,,,,36,,,278,,,52,,,54,,32,,,,40,,,,,,,,18,,", ",,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57", "58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217", ",,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,", ",,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78", ",,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62", "256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84", "50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,", "52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,", ",53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,", ",255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93,,84,50,86,85,358,,88", "95,96,,81,82,738,,333,331,330,,332,,,,,,,,,,,,,,,,,359,,,212,,,52,,", "54,,,,,,335,,,,,,,,338,337,341,340,,79,73,75,76,77,78,,,,74,80,,,,,", ",56,,,53,,,293,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67", ",,,,,255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93,,84,50,86,85,87", ",88,95,96,,81,82,738,,333,331,330,,332,,,,,,,,,,,,,,,,,286,,,212,,,52", ",,54,,,,,,335,,,,,,,,338,337,341,340,,79,73,75,76,77,78,,,,74,80,,,", "511,,,56,,,53,,,293,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24", "66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,278,,,52,,,54,,32", ",,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83", "63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90", "89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38", "39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79", "73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58", ",,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41", ",9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,", ",36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80", ",,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257", "66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93,,84,50,86", "85,87,,88,95,96,,81,82,,,,,,,,,,,,,,,,,,,,,,,,286,,,283,,,52,,,54,,", ",,,,,,,,,,,,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,293,83,63", "64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91", "92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,", ",,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73,75", "76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61", ",59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,,41,,,94,93", ",84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212", ",,52,,,54,,,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56", ",,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,", ",,255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93,,84,50,86,85,87,,88", "95,96,,81,82,,,,,,,,,,,,,,,,,,,,,,,,286,,,283,,,52,,,54,,,,,,,,,,,,", ",,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,293,83,63,64,65,,51", ",,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92", ",,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,", ",,,,,,,,,,,,,,,208,,,212,,,52,,,54,,418,,,,40,,,,,,,,216,,,,,79,73,75", "76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61", ",59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,217,,,,,,,41,,,94", "93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,", ",212,,,52,,,54,,,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,", ",,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66", "67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,", ",,,,40,,,,,,,,216,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37", "83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288", "292,90,89,91,92,,,217,,,,,,,289,,,94,93,,84,50,86,85,87,,88,95,96,,81", "82,,,,,,,,,,,,,,,,,,,,,,,,286,,,283,,,52,,,54,,,,,,,,,,,,,,,,,,,79,73", "75,76,77,78,,,,74,80,,,,,,,56,,,53,,,293,83,63,64,65,,51,,,,57,58,,", ",61,,59,60,62,256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,", ",41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,", ",,,,208,,,212,,,52,,,54,,254,,,,40,,,,,,,,216,,,,,79,73,75,76,77,78", ",,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62", "23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50", "86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,", "54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53", ",,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28", "27,90,89,91,92,,,17,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82", ",38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,,,52,,,54,,,,,,40,,,,,,,,18,,,", ",79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57", "58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7", "41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,", ",,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74", "80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,,,,57,58,,,,61,,59,60,62,23,24", "66,67,,,,,,22,28,27,90,89,91,92,,,17,,,,,,7,41,,9,94,93,,84,50,86,85", "87,,88,95,96,,81,82,,38,39,,,,,,,,,,,,,,,,,,,,,36,,,30,,,52,,,54,,32", ",,,40,,,,,,,,18,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83", "63,64,65,,51,,,,57,58,,,,61,,59,60,62,256,257,66,67,,,,,,255,288,292", "90,89,91,92,,,217,,,,,,,41,,,94,93,,84,50,86,85,87,,88,95,96,,81,82", ",38,39,,,,,,,,,,,,,,,,,,,,,208,,,212,528,,52,,,54,,,,,,40,,,,,,,,216", ",,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,8,51,", ",,57,58,,,,61,,59,60,62,23,24,66,67,,,,,,22,28,27,90,89,91,92,,,17,", ",,,,7,41,,9,94,93,,84,50,86,85,87,,88,95,96,,81,82,,38,39,,,,,,,,,,", ",,,,,,,,,,36,,,30,,,52,,,54,,32,,,,40,,,,,,,,18,,,,,79,73,75,76,77,78", ",,,74,80,,,,,,,56,,,53,,,37,83,63,64,65,,51,,,,57,58,,,,61,,59,60,62", "256,257,66,67,,,,,,255,288,292,90,89,91,92,,,217,,,,,,,289,,,94,93,", "84,50,86,85,87,,88,95,96,,81,82,,-527,,,,,,,-527,-527,-527,,,-527,-527", "-527,,-527,,,,,,286,,,283,-527,,52,,,54,,,,,-527,-527,,-527,-527,-527", "-527,-527,,,,,,,79,73,75,76,77,78,,,,74,80,,,,,,,56,-511,,53,,,293,83", "-511,-511,-511,-527,,-511,-511,-511,,-511,-527,,,,,265,-527,,-511,-511", "-511,,,,,,,,,-511,-511,,-511,-511,-511,-511,-511,-527,,,,,,,,,,,,,-527", ",-527,,,-527,,,,,-511,-511,-511,-511,-511,-511,-511,-511,-511,-511,-511", "-511,-511,-511,,,-511,-511,-511,,762,-511,,,-511,,,-511,,-511,,-511", ",-511,,-511,-511,-511,-511,-511,-511,-511,,-511,-511,-511,,,,,,,,,,", ",,-511,-511,-511,-511,-511,-511,,,-511,,-91,-511,-511,-511,,,,-511,-511", ",-511,,,,,,,,,-511,,,,,,,,,,,-511,-511,,-511,-511,-511,-511,-511,,,", ",,,,,,,,,,,,,,,,,,,,-511,-511,-511,-511,-511,-511,-511,-511,-511,-511", "-511,-511,-511,-511,,,-511,-511,-511,,625,,,,-511,,,,,,,-511,,-511,", "-511,-511,-511,-511,-511,-511,-511,,-511,-511,-511,,,,,,,,,,,,,-511", "-511,,-83,-437,-511,,,-511,,-91,-437,-437,-437,,,-437,-437,-437,,-437", ",,,,,,,-437,,-437,-437,-437,,,,,,,,-437,-437,,-437,-437,-437,-437,-437", ",,,,,,,,,,,,,,,,,,,,,,,-437,-437,-437,-437,-437,-437,-437,-437,-437", "-437,-437,-437,-437,-437,,,-437,-437,-437,,-437,-437,,,-437,,,-437,", "-437,,-437,,-437,,-437,-437,-437,-437,-437,-437,-437,,-437,,-437,,,", ",,,,,,,,,-437,-437,-437,-437,-274,-437,,-437,-437,,-437,-274,-274,-274", ",,,-274,-274,,-274,,,,,,,,,,,,,,,,,,,,-274,-274,,-274,-274,-274,-274", "-274,,,,,,,,,,,,,,,,,,,,,,,,-274,-274,-274,-274,-274,-274,-274,-274", "-274,-274,-274,-274,-274,-274,,,-274,-274,-274,,628,,,,-274,,,,,,,-274", ",-274,,-274,-274,-274,-274,-274,-274,-274,,-274,,-274,,,,,,,,,,,,,-274", "-274,,-85,-274,-274,,,-274,,-93,-274,-274,-274,,,-274,-274,-274,,-274", ",,,,,,,,,-274,-274,,,,,,,,,-274,-274,,-274,-274,-274,-274,-274,,,,,", ",,,,,,,,,,,,,,,,,,-274,-274,-274,-274,-274,-274,-274,-274,-274,-274", "-274,-274,-274,-274,,,-274,-274,-274,,628,-274,,,-274,,,-274,,-274,", "-274,,-274,,-274,-274,-274,-274,-274,-274,-274,,-274,,-274,,,,,,,,,", ",,,-274,-274,-274,-274,-434,-274,,,-274,,-93,-434,-434,-434,,,-434,-434", "-434,,-434,,,,,,,,-434,,-434,-434,-434,,,,,,,,-434,-434,,-434,-434,-434", "-434,-434,,,,,,,,,,,,,,,,,,,,,,,,-434,-434,-434,-434,-434,-434,-434", "-434,-434,-434,-434,-434,-434,-434,,,-434,-434,-434,,-434,-434,,,-434", ",,-434,,-434,,-434,,-434,,-434,-434,-434,-434,-434,-434,-434,,-434,", "-434,,,,,,,,,,,,,-434,-434,-434,-434,-513,-434,,-434,-434,,-434,-513", "-513,-513,,,-513,-513,-513,,-513,,,,,,,,,-513,-513,-513,-513,,,,,,,", "-513,-513,,-513,-513,-513,-513,-513,,,,,,,,,,,,,,,,,,,,,,,,-513,-513", "-513,-513,-513,-513,-513,-513,-513,-513,-513,-513,-513,-513,,,-513,-513", "-513,,,-513,,,-513,,,-513,,-513,,-513,,-513,,-513,-513,-513,-513,-513", "-513,-513,,-513,-513,-513,,,,,,,,,,,,,-513,-513,-513,-513,-269,-513", ",-513,-513,,,-269,-269,-269,,,-269,-269,-269,,-269,,,,,,,,,,-269,-269", "-269,,,,,,,,-269,-269,,-269,-269,-269,-269,-269,,,,,,,,,,,,,,,,,,,,", ",,,-269,-269,-269,-269,-269,-269,-269,-269,-269,-269,-269,-269,-269", "-269,,,-269,-269,-269,,,-269,,,-269,,,-269,,-269,,-269,,-269,,-269,-269", "-269,-269,-269,-269,-269,,-269,,-269,,,,,,,,,,,,,-269,-269,-269,-269", "-512,-269,,-269,-269,,,-512,-512,-512,,,-512,-512,-512,,-512,,,,,,,", ",-512,-512,-512,-512,,,,,,,,-512,-512,,-512,-512,-512,-512,-512,,,,", ",,,,,,,,,,,,,,,,,,,-512,-512,-512,-512,-512,-512,-512,-512,-512,-512", "-512,-512,-512,-512,,,-512,-512,-512,,,-512,,,-512,,,-512,,-512,,-512", ",-512,,-512,-512,-512,-512,-512,-512,-512,,-512,-512,-512,,,,,,,,,,", ",,-512,-512,-512,-512,-282,-512,,-512,-512,,,-282,-282,-282,,,-282,-282", "-282,,-282,,,,,,,,,,-282,-282,,,,,,,,,-282,-282,,-282,-282,-282,-282", "-282,,,,,,,,,,,,,,,,,,,,,,,,-282,-282,-282,-282,-282,-282,-282,-282", "-282,-282,-282,-282,-282,-282,,,-282,-282,-282,,,-282,,274,-282,,,-282", ",-282,,-282,,-282,,-282,-282,-282,-282,-282,-282,-282,,-282,,-282,,", ",,,,,,,,,,-282,-282,-282,-282,-370,-282,,,-282,,,-370,-370,-370,,,-370", "-370,-370,,-370,,,,,,,,,-370,-370,-370,,,,,,,,,-370,-370,,-370,-370", "-370,-370,-370,,,,,,,,,,,,,,,,,,,,,,,,-370,-370,-370,-370,-370,-370", "-370,-370,-370,-370,-370,-370,-370,-370,,,-370,-370,-370,,,-370,,265", "-370,,,-370,,-370,,-370,,-370,,-370,-370,-370,-370,-370,-370,-370,,-370", "-370,-370,,,,,,,,,,,,,-370,-370,-370,-370,-527,-370,,,-370,,,-527,-527", "-527,,,-527,-527,-527,,-527,,,,,,,,,-527,-527,-527,,,,,,,,,-527,-527", ",-527,-527,-527,-527,-527,,,,,,,,,,,,,,,,,,,,,,,,-527,-527,-527,-527", "-527,-527,-527,-527,-527,-527,-527,-527,-527,-527,,,-527,-527,-527,", ",-527,,265,-527,,,-527,,-527,,-527,,-527,,-527,-527,-527,-527,-527,-527", "-527,,-527,-527,-527,,,,,,,,,,,,,-527,-527,-527,-527,-527,-527,,,-527", ",,-527,-527,-527,,,-527,-527,-527,,-527,,,,,,,,,,-527,,,,,,,,,,-527", "-527,,-527,-527,-527,-527,-527,,,,,,717,430,,,718,,,,,,,,,142,143,,139", "121,122,123,130,127,129,,,124,125,,,-527,144,145,131,132,,,-527,,,265", ",265,-527,,,,136,135,,120,141,138,137,133,134,128,126,118,140,119,,", "146,-527,,,,,,,,,,,,,-527,,-527,,,-527,156,167,157,180,153,173,163,162", "188,191,178,161,160,155,181,189,190,165,154,168,172,174,166,159,,,,175", "182,177,176,169,179,164,152,171,170,183,184,185,186,187,151,158,149", "150,147,148,,111,113,,,112,,,,,,,,,142,143,,139,121,122,123,130,127", "129,,,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137", "133,134,128,126,118,140,119,,,146,192,,,,,,,,,,80,156,167,157,180,153", "173,163,162,188,191,178,161,160,155,181,189,190,165,154,168,172,174", "166,159,,,,175,182,177,176,169,179,164,152,171,170,183,184,185,186,187", "151,158,149,150,147,148,,111,113,110,,112,,,,,,,,,142,143,,139,121,122", "123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120", "141,138,137,133,134,128,126,118,140,119,,,146,192,,,,,,,,,,80,156,167", "157,180,153,173,163,162,188,191,178,161,160,155,181,189,190,165,154", "168,172,174,166,159,,,,175,182,177,176,169,179,164,152,171,170,183,184", "185,186,187,151,158,149,150,147,148,,111,113,,,112,,,,,,,,,142,143,", "139,121,122,123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,,,,,,", ",136,135,,120,141,138,137,133,134,128,126,118,140,119,,,146,192,,,,", ",,,,,80,156,167,157,180,153,173,163,162,188,191,178,161,160,155,181", "189,190,165,154,168,172,174,166,159,,,,175,182,177,176,169,179,164,152", "171,170,183,184,185,186,187,151,158,149,150,147,148,,111,113,,,112,", ",,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125,,,,144,145,131", "132,,,,,,,,,,,,,136,135,,120,141,138,137,133,134,128,126,118,140,119", ",,146,192,,,,,,,,,,80,156,167,157,180,153,173,163,162,188,191,178,161", "160,155,181,189,190,165,154,168,172,174,166,159,,,,175,182,177,176,169", "179,164,152,171,170,183,184,185,186,187,151,158,149,150,147,148,,111", "113,,,112,,,,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125,,,", "144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133,134,128,126", "118,140,119,,,146,156,167,157,180,153,173,163,162,188,191,178,161,160", "155,181,189,190,165,154,168,172,174,166,159,,,,175,182,177,176,169,179", "164,152,171,170,183,184,185,186,187,151,158,149,150,147,148,,111,113", "395,394,112,,396,,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125", ",,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133,134,128", "126,118,140,119,,,146,156,167,157,180,153,173,163,162,188,191,178,161", "160,155,181,189,190,165,154,168,172,174,166,159,,,,175,182,177,373,372", "374,371,152,171,170,183,184,185,186,187,151,158,149,150,369,370,,367", "113,86,85,368,,88,,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125", ",,,144,145,131,132,,,,,,378,,,,,,,136,135,,120,141,138,137,133,134,128", "126,118,140,119,,,146,156,167,157,180,153,173,163,162,188,191,178,161", "160,155,181,189,190,165,154,168,172,174,166,159,,,,175,182,177,176,169", "179,164,152,171,170,183,184,185,186,187,151,158,149,150,147,148,,111", "113,395,394,112,,396,,,,,,,142,143,,139,121,122,123,130,127,129,,,124", "125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133,134", "128,126,118,140,119,432,436,146,,434,,,,,,,,,142,143,,139,121,122,123", "130,127,129,,,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141", "138,137,133,134,128,126,118,140,119,672,430,146,,673,,,,,,,,,142,143", ",139,121,122,123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,265,", ",,,,,136,135,,120,141,138,137,133,134,128,126,118,140,119,426,430,146", ",427,,,,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125,,,,144,145", "131,132,,,,,,265,,,,,,,136,135,,120,141,138,137,133,134,128,126,118", "140,119,675,436,146,,676,,,,,,,,,142,143,,139,121,122,123,130,127,129", ",,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133", "134,128,126,118,140,119,922,436,146,,923,,,,,,,,,142,143,,139,121,122", "123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120", "141,138,137,133,134,128,126,118,140,119,487,430,146,,488,,,,,,,,,142", "143,,139,121,122,123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,265", ",,,,,,136,135,,120,141,138,137,133,134,128,126,118,140,119,724,436,146", ",856,,,,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125,,,,144,145", "131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133,134,128,126,118,140", "119,631,436,146,,632,,,,,,,,,142,143,,139,121,122,123,130,127,129,,", "124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133", "134,128,126,118,140,119,487,430,146,,488,,,,,,,,,142,143,,139,121,122", "123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120", "141,138,137,133,134,128,126,118,140,119,920,430,146,,921,,,,,,,,,142", "143,,139,121,122,123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,265", ",,,,,,136,135,,120,141,138,137,133,134,128,126,118,140,119,629,430,146", ",630,,,,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125,,,,144,145", "131,132,,,,,,265,,,,,,,136,135,,120,141,138,137,133,134,128,126,118", "140,119,631,436,146,,632,,,,,,,,,142,143,,139,121,122,123,130,127,129", ",,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133", "134,128,126,118,140,119,487,430,146,,488,,,,,,,,,142,143,,139,121,122", "123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120", "141,138,137,133,134,128,126,118,140,119,487,430,146,,488,,,,,,,,,142", "143,,139,121,122,123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,", ",,,,,,136,135,,120,141,138,137,133,134,128,126,118,140,119,487,430,146", ",488,,,,,,,,,142,143,,139,121,122,123,130,127,129,,,124,125,,,,144,145", "131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133,134,128,126,118,140", "119,719,436,146,,720,,,,,,,,,142,143,,139,121,122,123,130,127,129,,", "124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120,141,138,137,133", "134,128,126,118,140,119,724,436,146,,722,,,,,,,,,142,143,,139,121,122", "123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,,,,,,,,136,135,,120", "141,138,137,133,134,128,126,118,140,119,629,430,146,,630,,,,,,,,,142", "143,,139,121,122,123,130,127,129,,,124,125,,,,144,145,131,132,,,,,,265", ",,,,,,136,135,,120,141,138,137,133,134,128,126,118,140,119,,,146"];

      racc_action_table = arr = Opal.get('Array').$new(24653, nil);

      idx = 0;

      ($a = ($b = clist).$each, $a.$$p = (TMP_1 = function(str){var self = TMP_1.$$s || this, $a, $b, TMP_2;
if (str == null) str = nil;
      return ($a = ($b = str.$split(",", -1)).$each, $a.$$p = (TMP_2 = function(i){var self = TMP_2.$$s || this, $a;
if (i == null) i = nil;
        if ((($a = i['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            arr['$[]='](idx, i.$to_i())
          };
          return idx = idx['$+'](1);}, TMP_2.$$s = self, TMP_2), $a).call($b)}, TMP_1.$$s = self, TMP_1), $a).call($b);

      clist = ["0,0,0,0,0,920,720,318,0,0,682,682,345,0,290,0,0,0,0,0,0,0,354,358,813", "605,873,0,0,0,0,0,0,0,209,500,0,353,351,718,719,667,0,0,0,0,0,0,477", "0,0,0,0,0,26,0,0,0,717,0,0,55,0,0,733,682,669,675,500,733,307,307,720", "569,363,490,358,577,667,290,671,477,209,358,0,605,605,0,358,860,0,37", "37,0,605,0,344,922,389,0,290,630,594,594,921,853,719,0,490,358,720,318", "0,0,0,0,0,0,920,26,920,0,0,920,812,345,354,345,813,0,345,358,0,675,675", "0,0,499,499,499,26,499,351,718,719,499,499,55,314,630,499,314,499,499", "499,499,499,499,499,307,389,568,717,350,499,499,499,499,499,499,499", "675,569,499,569,922,359,569,675,363,499,577,674,499,499,629,499,499", "499,499,499,594,499,499,499,386,499,499,363,499,499,494,860,363,860", "501,13,860,494,344,922,344,922,13,344,922,662,921,853,921,853,499,921", "853,499,889,499,499,15,15,499,673,889,629,499,71,499,812,501,812,812", "672,812,71,499,814,293,293,494,499,499,499,499,499,499,386,386,386,499", "499,568,13,568,287,887,568,499,659,35,499,287,887,499,499,513,513,513", "352,513,391,889,376,513,513,352,729,729,513,376,513,513,513,513,513", "513,513,384,677,673,384,763,513,513,513,513,513,513,513,672,35,513,83", "83,449,449,382,35,513,287,887,513,513,380,513,513,513,513,513,513,513", "513,513,352,513,513,673,513,513,342,391,391,391,673,676,814,672,814", "886,763,814,676,426,672,42,886,676,384,384,513,782,42,513,339,909,513", "374,782,513,449,513,909,680,374,513,729,382,382,382,285,729,681,513", "380,380,380,285,513,513,513,513,513,513,426,579,695,513,513,207,676", "426,579,695,886,513,654,14,513,445,42,513,513,522,522,522,782,522,25", "587,909,522,522,683,587,25,522,327,522,522,522,522,522,522,522,285,310", "343,343,310,522,522,522,522,522,522,522,207,14,522,579,695,653,275,416", "14,522,445,275,522,522,688,522,522,522,522,522,516,522,522,522,689,522", "522,516,522,522,692,416,416,416,416,416,416,416,416,416,416,416,722", "416,416,284,694,416,416,722,522,361,284,522,722,110,522,326,361,522", "110,110,416,696,416,522,416,416,416,416,416,416,416,522,416,516,697", "372,522,522,522,522,522,522,372,698,300,522,522,373,416,701,416,300", "727,522,373,722,522,727,284,522,522,523,523,523,361,523,369,3,370,523", "523,643,3,369,523,370,523,523,523,523,523,523,523,276,276,276,276,276", "523,523,523,523,523,523,523,348,368,523,206,300,348,641,634,368,523", "206,687,523,523,687,523,523,523,523,523,928,523,523,523,706,523,523", "928,523,523,712,634,634,634,634,634,634,634,634,634,634,634,923,634", "634,546,714,634,634,923,523,324,311,523,923,311,523,716,206,523,323", "896,634,896,634,523,634,634,634,634,634,634,634,523,634,928,385,367", "523,523,523,523,523,523,367,552,552,523,523,315,634,546,546,546,546", "523,798,923,523,618,297,523,523,483,483,483,371,483,910,910,775,483", "483,371,828,828,483,775,483,483,483,483,483,483,483,5,5,5,5,5,483,483", "483,483,483,483,483,388,427,483,618,297,798,798,798,798,483,618,297", "483,483,313,483,483,483,483,483,775,483,483,483,312,483,483,724,483", "483,725,658,658,658,658,658,658,658,658,658,658,658,427,658,658,704", "704,658,658,427,483,633,349,483,349,407,483,413,309,483,302,419,658", "626,658,483,658,658,658,658,658,658,658,483,658,734,735,736,483,483", "483,483,483,483,738,299,741,483,483,421,658,298,658,621,825,483,748", "425,483,292,289,483,483,481,481,481,288,481,286,742,742,481,481,742", "742,742,481,281,481,481,481,481,481,481,481,666,666,666,666,666,481", "481,481,481,481,481,481,280,279,481,825,825,825,825,277,616,481,433", "766,481,481,767,481,481,481,481,481,481,481,481,481,770,481,481,773", "481,481,774,476,476,476,476,476,476,476,476,476,476,476,609,476,476", "776,455,476,476,779,481,780,781,481,264,785,481,253,788,481,789,454", "476,481,476,481,476,476,476,476,476,476,476,481,476,250,456,457,481", "481,481,481,481,481,804,249,807,481,481,217,476,476,454,211,900,481", "454,454,481,210,458,481,481,479,479,479,208,479,816,819,820,479,479", "821,571,570,479,564,479,479,479,479,479,479,479,559,837,838,193,555", "479,479,479,479,479,479,479,845,846,479,900,900,900,900,97,544,479,78", "856,479,479,857,479,479,479,479,479,479,479,479,479,77,479,479,862,479", "479,863,759,759,759,759,759,759,759,759,759,759,759,531,759,759,530", "41,759,759,871,479,872,355,479,875,876,479,529,453,479,492,479,759,479", "759,479,759,759,759,759,759,759,759,479,759,36,520,34,479,479,479,479", "479,479,888,517,20,479,479,453,759,493,495,453,453,479,898,496,479,512", "905,479,479,524,524,524,473,524,12,11,10,524,524,9,510,914,524,916,524", "524,524,524,524,524,524,917,919,6,507,506,524,524,524,524,524,524,524", "473,1,524,502,473,473,473,473,,524,,,524,524,,524,524,524,524,524,,524", "524,524,,524,524,,524,524,,747,747,747,747,747,747,747,747,747,747,747", ",747,747,,,747,747,,524,,,524,,,524,,,524,,,747,,747,524,747,747,747", "747,747,747,747,524,747,,,,524,524,524,524,524,524,,,,524,524,,747,", ",,,524,,,524,,,524,524,528,528,528,472,528,,,,528,528,,,,528,,528,528", "528,528,528,528,528,,,,,,528,528,528,528,528,528,528,472,,528,,472,472", "472,472,,528,,,528,528,,528,528,528,528,528,,528,528,528,,528,528,,528", "528,,679,679,679,679,679,679,679,679,679,679,679,,679,679,,,679,679", ",528,,,528,,,528,,,528,,,679,,679,528,679,679,679,679,679,679,679,528", "679,,,,528,528,528,528,528,528,,,,528,528,,679,,,,,528,,,528,,,528,528", "906,906,906,,906,,,,906,906,,,,906,,906,906,906,906,906,906,906,,,,", ",906,906,906,906,906,906,906,,560,906,560,560,560,,560,,906,,,906,906", ",906,906,906,906,906,906,906,906,906,,906,906,,906,906,,752,752,752", "752,752,752,752,752,752,752,752,,752,752,,,752,752,,906,,,906,,,906", ",,906,,906,752,,752,906,752,752,752,752,752,752,752,906,752,,,,906,906", "906,906,906,906,,,,906,906,,752,,,,,906,,,906,,,906,906,534,534,534", ",534,,,,534,534,,,,534,,534,534,534,534,534,534,534,,,,,,534,534,534", "534,534,534,534,,803,534,803,803,803,,803,,534,,,534,534,,534,534,534", "534,534,534,534,534,534,,534,534,,534,534,,764,764,764,764,764,764,764", "764,764,764,764,,764,764,,,764,764,,534,,,534,,,534,,,534,,534,764,", "764,534,764,764,764,764,764,764,764,534,764,,,,534,534,534,534,534,534", ",,,534,534,,764,,,,,534,,,534,,,534,534,904,904,904,904,904,,,,904,904", ",,,904,,904,904,904,904,904,904,904,,,,,,904,904,904,904,904,904,904", ",,904,,,,,,904,904,,904,904,904,,904,904,904,904,904,,904,904,904,,904", "904,,904,904,,840,840,840,840,840,840,840,840,840,840,840,,840,840,", ",840,840,,904,,,904,,,904,,,904,,904,840,,840,904,840,840,840,840,840", "840,840,904,840,,,,904,904,904,904,904,904,,,,904,904,,840,,,,,904,", ",904,,,904,904,897,897,897,897,897,,,,897,897,,,,897,,897,897,897,897", "897,897,897,,,,,,897,897,897,897,897,897,897,,,897,,,,,,897,897,,897", "897,897,,897,897,897,897,897,,897,897,897,,897,897,,897,897,,424,424", "424,424,424,424,424,424,424,424,424,,424,424,,,424,424,,897,,,897,,", "897,,,897,,897,424,,424,897,424,424,424,424,424,424,424,897,424,,,,897", "897,897,897,897,897,,,,897,897,,424,,,,,897,,,897,,,897,897,17,17,17", ",17,,,,17,17,,,,17,,17,17,17,17,17,17,17,,,,,,17,17,17,17,17,17,17,", ",17,,,,,,,17,,,17,17,,17,17,17,17,17,,17,17,17,,17,17,,17,17,,754,754", "754,754,754,754,754,754,754,754,754,,754,754,,,754,754,,17,,,17,17,", "17,,,17,,,754,,754,17,754,754,754,754,754,754,754,17,754,,,,17,17,17", "17,17,17,,,,17,17,,754,,,,,17,,,17,,,17,17,18,18,18,,18,,,,18,18,,,", "18,,18,18,18,18,18,18,18,,,,,,18,18,18,18,18,18,18,,,18,,,,,,,18,,,18", "18,,18,18,18,18,18,,18,18,18,,18,18,,18,18,,757,757,757,757,757,757", "757,757,757,757,757,,757,757,,,757,757,,18,,,18,,,18,,,18,,,757,,757", "18,757,757,757,757,757,757,757,18,757,,,,18,18,18,18,18,18,,,,18,18", ",757,,,,,18,,,18,,,18,18,537,537,537,,537,,,,537,537,,,,537,,537,537", "537,537,537,537,537,,,,,,537,537,537,537,537,537,537,,,537,,,,,,,537", ",,537,537,,537,537,537,537,537,537,537,537,537,,537,537,,537,537,,19", "19,19,19,19,19,19,19,19,19,19,,19,19,,,19,19,,537,,,537,,,537,,,537", ",,19,,19,537,19,19,19,19,19,19,19,537,19,,,,537,537,537,537,537,537", ",,,537,537,,19,,,,,537,,,537,,,537,537,892,892,892,892,892,,,,892,892", ",,,892,,892,892,892,892,892,892,892,,,,,,892,892,892,892,892,892,892", ",,892,,,,,,892,892,,892,892,892,,892,892,892,892,892,,892,892,892,,892", "892,,892,892,,527,527,527,527,527,527,527,527,527,527,527,,527,527,", ",527,527,,892,,,892,,,892,,,892,,892,527,,527,892,527,527,527,527,527", "527,527,892,527,,,,892,892,892,892,892,892,,,,892,892,,527,,,,,892,", ",892,,,892,892,22,22,22,,22,,,,22,22,,,,22,,22,22,22,22,22,22,22,,,", ",,22,22,22,22,22,22,22,,,22,,,,,,,22,,,22,22,,22,22,22,22,22,22,22,22", "22,,22,22,,22,22,,439,439,439,439,439,439,439,439,439,439,439,,439,439", ",,439,439,,22,,,22,,,22,,,22,,22,439,22,439,22,439,439,439,439,439,439", "439,22,439,,,,22,22,22,22,22,22,,,,22,22,,439,,,,,22,,,22,,,22,22,23", "23,23,,23,,,,23,23,,,,23,,23,23,23,23,23,23,23,,,,,,23,23,23,23,23,23", "23,,,23,,,,,,,23,,,23,23,,23,23,23,23,23,23,23,23,23,,23,23,,23,23,", "247,247,247,247,247,247,247,247,247,247,247,,247,247,,,247,247,,23,", ",23,,,23,,,23,,23,247,23,247,23,247,247,247,247,247,247,247,23,247,", ",,23,23,23,23,23,23,,,,23,23,,247,,,,,23,,,23,,,23,23,24,24,24,,24,", ",,24,24,,,,24,,24,24,24,24,24,24,24,,,,,,24,24,24,24,24,24,24,,702,24", "702,702,702,,702,,24,,,24,24,,24,24,24,24,24,24,24,24,24,,24,24,,24", "24,335,,335,335,335,,335,,,702,,,,,,,,702,,,24,,,24,461,,24,,,24,,24", ",24,,24,,,335,,461,461,,24,,,335,,24,24,24,24,24,24,,461,,24,24,461", "461,461,461,,,24,,,24,,,24,24,542,542,542,542,542,,,,542,542,,,,542", ",542,542,542,542,542,542,542,,,,,,542,542,542,542,542,542,542,,557,542", "557,557,557,,557,542,542,,542,542,542,,542,542,542,542,542,,542,542", "542,,542,542,,542,542,,,,,,,,,,557,,,,,,,,557,,,542,,,542,,,542,,,542", ",542,,,,542,,,,,,,,542,,,,,542,542,542,542,542,542,,,,542,542,,,,,,", "542,,,542,,,542,542,543,543,543,543,543,,,,543,543,,,,543,,543,543,543", "543,543,543,543,,,,,,543,543,543,543,543,543,543,,,543,,,,,,543,543", ",543,543,543,,543,543,543,543,543,,543,543,543,,543,543,,543,543,,471", "471,471,471,471,471,471,,,471,471,,,,,,471,471,,543,,,543,,,543,,,543", ",543,471,,471,543,471,471,471,471,471,471,471,543,471,,,,543,543,543", "543,543,543,,,,543,543,,,,,,,543,,,543,,,543,543,549,549,549,,549,,", ",549,549,,,,549,,549,549,549,549,549,549,549,,,,,,549,549,549,549,549", "549,549,,,549,,,,,,,549,,,549,549,,549,549,549,549,549,,549,549,549", ",549,549,638,,638,638,638,,638,,,,,,,,,,,,,,,,,549,,,549,,,549,,,549", ",,,,,638,,,,,,,,638,638,638,638,,549,549,549,549,549,549,638,,,549,549", ",,,,,,549,,,549,,,549,549,563,563,563,563,563,,,,563,563,,,,563,,563", "563,563,563,563,563,563,,,,,,563,563,563,563,563,563,563,,,563,,,,,", "563,563,,563,563,563,,563,563,563,563,563,,563,563,563,,563,563,,563", "563,,467,467,467,467,467,467,467,,,467,467,,,,,,467,467,,563,,,563,", ",563,,,563,,563,467,,467,563,467,467,467,467,467,467,467,563,467,,,", "563,563,563,563,563,563,,,,563,563,,,,,,,563,,,563,,,563,563,30,30,30", "30,30,,,,30,30,,,,30,,30,30,30,30,30,30,30,,,,,,30,30,30,30,30,30,30", ",,30,,,,,,30,30,,30,30,30,,30,30,30,30,30,,30,30,30,,30,30,,30,30,,468", "468,468,468,468,468,468,,,468,468,,,,,,468,468,,30,,,30,,,30,,,30,,30", "468,,468,30,468,468,468,468,468,468,468,30,468,,,,30,30,30,30,30,30", ",,,30,30,,,,,,,30,,,30,,,30,30,31,31,31,,31,,,,31,31,,,,31,,31,31,31", "31,31,31,31,,,,,,31,31,31,31,31,31,31,,,31,,,,,,,31,,,31,31,,31,31,31", "31,31,,31,31,31,,31,31,590,,590,590,590,,590,,,,,,,,,,,,,,,,,31,,,31", ",,31,,,31,,31,,,,590,590,,,,,,,590,590,590,590,,31,31,31,31,31,31,,", ",31,31,,,,,,,31,,,31,,,31,31,32,32,32,,32,,,,32,32,,,,32,,32,32,32,32", "32,32,32,,,,,,32,32,32,32,32,32,32,,,32,,,,,,,32,,,32,32,,32,32,32,32", "32,,32,32,32,,32,32,550,,550,550,550,,550,,,,,,,,,,,,,,,,,32,,,32,,", "32,,,32,,,,,,550,,,,,,,,550,550,550,550,,32,32,32,32,32,32,,,,32,32", ",,,32,,,32,,,32,,,32,32,567,567,567,567,567,,,,567,567,,,,567,,567,567", "567,567,567,567,567,,,,,,567,567,567,567,567,567,567,,,567,,,,,,567", "567,,567,567,567,,567,567,567,567,567,,567,567,567,,567,567,,567,567", ",469,469,469,469,469,469,469,,,469,469,,,,,,469,469,,567,,,567,,,567", ",,567,,567,469,,469,567,469,469,469,469,469,469,469,567,469,,,,567,567", "567,567,567,567,,,,567,567,,,,,,,567,,,567,,,567,567,572,572,572,572", "572,,,,572,572,,,,572,,572,572,572,572,572,572,572,,,,,,572,572,572", "572,572,572,572,,,572,,,,,,572,572,,572,572,572,,572,572,572,572,572", ",572,572,572,,572,572,,572,572,,470,470,470,470,470,470,470,,,470,470", ",,,,,470,470,,572,,,572,,,572,,,572,,572,470,,470,572,470,470,470,470", "470,470,470,572,470,,,,572,572,572,572,572,572,,,,572,572,,,,,,,572", ",,572,,,572,572,885,885,885,885,885,,,,885,885,,,,885,,885,885,885,885", "885,885,885,,,,,,885,885,885,885,885,885,885,,,885,,,,,,885,885,,885", "885,885,,885,885,885,885,885,,885,885,885,,885,885,,885,885,,451,451", "451,451,451,451,451,451,451,451,451,,451,451,,,451,451,,885,,,885,,", "885,,,885,,885,451,,451,885,451,451,451,451,451,451,451,885,451,,,,885", "885,885,885,885,885,,,,885,885,,,,,,,885,,,885,,,885,885,883,883,883", ",883,,,,883,883,,,,883,,883,883,883,883,883,883,883,,,,,,883,883,883", "883,883,883,883,,,883,,,,,,,883,,,883,883,,883,883,883,883,883,,883", "883,883,,883,883,,883,883,,462,462,462,462,462,462,462,,,462,462,,,", ",,462,462,,883,,,883,,,883,,,883,,883,462,883,462,883,462,462,462,462", "462,462,462,883,462,,,,883,883,883,883,883,883,,,,883,883,,,,,,,883", ",,883,,,883,883,38,38,38,,38,,,,38,38,,,,38,,38,38,38,38,38,38,38,,", ",,,38,38,38,38,38,38,38,,,38,,,,,,,38,,,38,38,,38,38,38,38,38,,38,38", "38,,38,38,,38,38,,475,475,475,475,475,475,475,475,,475,475,,,,,,475", "475,,38,,,38,,,38,,,38,,,475,,475,38,475,475,475,475,475,475,475,38", "475,,,,38,38,38,38,38,38,,,,38,38,,,,,,,38,,,38,,,38,38,39,39,39,,39", ",,,39,39,,,,39,,39,39,39,39,39,39,39,,,,,,39,39,39,39,39,39,39,,,39", ",,,,,,39,,,39,39,,39,39,39,39,39,,39,39,39,,39,39,,39,39,,466,,,,,,", ",,,,,,,,,466,466,,39,,,39,,,39,,,39,,,466,,466,39,466,466,466,466,,", "466,39,466,,,,39,39,39,39,39,39,,,,39,39,,,,,,,39,,,39,,,39,39,40,40", "40,,40,,,,40,40,,,,40,,40,40,40,40,40,40,40,,,,,,40,40,40,40,40,40,40", ",,40,,,,,,,40,,,40,40,,40,40,40,40,40,,40,40,40,,40,40,,40,40,,474,474", "474,474,474,474,474,,,474,474,,,,,,474,474,,40,,,40,,,40,,,40,,,474", ",474,40,474,474,474,474,474,474,474,40,474,,,,40,40,40,40,40,40,,,,40", "40,,,,,,,40,,,40,,,40,40,868,868,868,868,868,,,,868,868,,,,868,,868", "868,868,868,868,868,868,,,,,,868,868,868,868,868,868,868,,,868,,,,,", "868,868,,868,868,868,,868,868,868,868,868,,868,868,868,,868,868,,868", "868,,465,,,,,,,,,,,,,,,,465,465,,868,,,868,,,868,,,868,,868,465,,465", "868,465,465,465,465,,,465,868,465,,,,868,868,868,868,868,868,,,,868", "868,,,,,,,868,,,868,,,868,868,574,574,574,,574,,,,574,574,,,,574,,574", "574,574,574,574,574,574,,,,,,574,574,574,574,574,574,574,,,574,,,,,", ",574,,,574,574,,574,574,574,574,574,574,574,574,574,,574,574,,574,574", ",464,,,,,,,,,,,,,,,,464,464,,574,,,574,,,574,,,574,,574,464,,464,574", "464,464,464,464,,,464,574,464,,,,574,574,574,574,574,574,,,,574,574", ",,,,,,574,,,574,,,574,574,582,582,582,,582,,,,582,582,,,,582,,582,582", "582,582,582,582,582,,,,,,582,582,582,582,582,582,582,,,582,,,,,,,582", ",,582,582,,582,582,582,582,582,582,582,582,582,,582,582,,582,582,,463", ",,,,,,,,,,,,,,,463,463,,582,,,582,,,582,,,582,,582,463,,463,582,463", "463,463,463,,,463,582,463,,,,582,582,582,582,582,582,,,,582,582,,,,", ",,582,,,582,,,582,582,52,52,52,,52,,,,52,52,,,,52,,52,52,52,52,52,52", "52,,,,,,52,52,52,52,52,52,52,,,52,,,,,,,52,,,52,52,,52,52,52,52,52,", "52,52,52,,52,52,,52,52,,452,452,452,452,452,452,452,452,452,452,452", ",452,452,,,452,452,,52,,,52,,,52,,,52,,,452,,452,52,452,452,452,452", "452,452,452,52,452,,,,52,52,52,52,52,52,,,,52,52,,,,,,,52,,,52,,,52", "52,53,53,53,,53,,,,53,53,,,,53,,53,53,53,53,53,53,53,,,,,,53,53,53,53", "53,53,53,,,53,,,,,,,53,,,53,53,,53,53,53,53,53,53,53,53,53,,53,53,,53", "53,,460,,,,,,,,,,,,,,,,460,460,,53,,,53,,,53,,,53,,53,460,,460,53,460", "460,460,460,,,,53,,,,,53,53,53,53,53,53,,,,53,53,,,,,,,53,,,53,,,53", "53,54,54,54,,54,,,,54,54,,,,54,,54,54,54,54,54,54,54,,,,,,54,54,54,54", "54,54,54,,,54,,,,,,,54,,,54,54,,54,54,54,54,54,54,54,54,54,,54,54,,54", "54,,459,,,,,,,,,,,,,,,,459,459,,54,,,54,,,54,,,54,,,459,,459,54,459", "459,459,459,,,,54,,,,,54,54,54,54,54,54,,,,54,54,,,,,,,54,,,54,,,54", "54,586,586,586,,586,,,,586,586,,,,586,,586,586,586,586,586,586,586,", ",,,,586,586,586,586,586,586,586,,,586,,,,,,,586,,,586,586,,586,586,586", "586,586,,586,586,586,,586,586,,586,586,,,,,,,,,,,,,,,,,,,,,586,,,586", ",,586,,,586,,,,,,586,,,,,,,,586,,,,,586,586,586,586,586,586,,,,586,586", ",,,,,,586,,,586,,,586,586,865,865,865,865,865,,,,865,865,,,,865,,865", "865,865,865,865,865,865,,,,,,865,865,865,865,865,865,865,,,865,,,,,", "865,865,,865,865,865,,865,865,865,865,865,,865,865,865,,865,865,,865", "865,,,,,,,,,,,,,,,,,,,,,865,,,865,,,865,,,865,,865,,,,865,,,,,,,,865", ",,,,865,865,865,865,865,865,,,,865,865,,,,,,,865,,,865,,,865,865,57", "57,57,,57,,,,57,57,,,,57,,57,57,57,57,57,57,57,,,,,,57,57,57,57,57,57", "57,,,57,,,,,,,57,,,57,57,,57,57,57,57,57,,57,57,57,,57,57,,57,57,,,", ",,,,,,,,,,,,,,,,,57,,,57,,,57,,,57,,,,,,57,,,,,,,,57,,,,,57,57,57,57", "57,57,,,,57,57,,,,,,,57,,,57,,,57,57,58,58,58,,58,,,,58,58,,,,58,,58", "58,58,58,58,58,58,,,,,,58,58,58,58,58,58,58,,,58,,,,,,,58,,,58,58,,58", "58,58,58,58,,58,58,58,,58,58,,58,58,,,,,,,,,,,,,,,,,,,,,58,,,58,,,58", ",,58,,,,,,58,,,,,,,,58,,,,,58,58,58,58,58,58,,,,58,58,,,,,,,58,,,58", ",,58,58,61,61,61,,61,,,,61,61,,,,61,,61,61,61,61,61,61,61,,,,,,61,61", "61,61,61,61,61,,,61,,,,,,,61,,,61,61,,61,61,61,61,61,,61,61,61,,61,61", ",61,61,,,,,,,,,,,,,,,,,,,,,61,,,61,,,61,,,61,,,,,,61,,,,,,,,61,,,,,61", "61,61,61,61,61,,,,61,61,61,,,,,61,61,,,61,,,61,61,62,62,62,,62,,,,62", "62,,,,62,,62,62,62,62,62,62,62,,,,,,62,62,62,62,62,62,62,,,62,,,,,,", "62,,,62,62,,62,62,62,62,62,,62,62,62,,62,62,56,,56,56,56,,56,,,,,,,", ",,,,,,,,,62,,,62,,,62,,,62,,62,,,,56,56,,,,,,,56,56,56,56,,62,62,62", "62,62,62,,,,62,62,,,,,,,62,,,62,,,62,62,63,63,63,,63,,,,63,63,,,,63", ",63,63,63,63,63,63,63,,,,,,63,63,63,63,63,63,63,,,63,,,,,,,63,,,63,63", ",63,63,63,63,63,,63,63,63,,63,63,879,,879,879,879,,879,,,,,,,,,,,,,", "63,,,63,,,63,,,63,,,63,,,,,,879,879,,,,,,,879,879,879,879,,63,63,63", "63,63,63,,,,63,63,,,,,,,63,,,63,,,63,63,588,588,588,,588,,,,588,588", ",,,588,,588,588,588,588,588,588,588,,,,,,588,588,588,588,588,588,588", ",,588,,,,,,,588,,,588,588,,588,588,588,588,588,,588,588,588,,588,588", ",588,588,,,,,,,,,,,,,,,,,,,,,588,,,588,,,588,,,588,,,,,,588,,,,,,,,588", ",,,,588,588,588,588,588,588,,,,588,588,,,,,,,588,,,588,,,588,588,864", "864,864,,864,,,,864,864,,,,864,,864,864,864,864,864,864,864,,,,,,864", "864,864,864,864,864,864,,,864,,,,,,,864,,,864,864,,864,864,864,864,864", ",864,864,864,,864,864,,864,864,,,,,,,,,,,,,,,,,,,,,864,,,864,,,864,", ",864,,864,,,,864,,,,,,,,864,,,,,864,864,864,864,864,864,,,,864,864,", ",,,,,864,,,864,,,864,864,448,448,448,,448,,,,448,448,,,,448,,448,448", "448,448,448,448,448,,,,,,448,448,448,448,448,448,448,,,448,,,,,,,448", ",,448,448,,448,448,448,448,448,,448,448,448,,448,448,,448,448,,,,,,", ",,,,,,,,,,,,,,448,,,448,,,448,,,448,,,,,,448,,,,,,,,448,,,,,448,448", "448,448,448,448,,,,448,448,,,,,,,448,,,448,,,448,448,854,854,854,,854", ",,,854,854,,,,854,,854,854,854,854,854,854,854,,,,,,854,854,854,854", "854,854,854,,,854,,,,,,,854,,,854,854,,854,854,854,854,854,,854,854", "854,,854,854,319,,319,319,319,,319,,,,,,,,,,,,,,,,,854,,,854,,,854,", ",854,,,,,,319,,319,,,,,,319,319,319,319,,854,854,854,854,854,854,,,", "854,854,,,,,,,854,,,854,,,854,854,447,447,447,,447,,,,447,447,,,,447", ",447,447,447,447,447,447,447,,,,,,447,447,447,447,447,447,447,,,447", ",,,,,,447,,,447,447,,447,447,447,447,447,,447,447,447,,447,447,,447", "447,,,,,,,,,,,,,,,,,,,,,447,,,447,,,447,,,447,,,,,,447,,,,,,,,447,,", ",,447,447,447,447,447,447,,,,447,447,,,,,,,447,,,447,,,447,447,446,446", "446,,446,,,,446,446,,,,446,,446,446,446,446,446,446,446,,,,,,446,446", "446,446,446,446,446,,,446,,,,,,,446,,,446,446,,446,446,446,446,446,", "446,446,446,,446,446,,446,446,,,,,,,,,,,,,,,,,,,,,446,,,446,,,446,,", "446,,,,,,446,,,,,,,,446,,,,,446,446,446,446,446,446,,,,446,446,,,,,", ",446,,,446,,,446,446,444,444,444,,444,,,,444,444,,,,444,,444,444,444", "444,444,444,444,,,,,,444,444,444,444,444,444,444,,,444,,,,,,,444,,,444", "444,,444,444,444,444,444,444,444,444,444,,444,444,,444,444,,,,,,,,,", ",,,,,,,,,,,444,,,444,,,444,,,444,,444,,,,444,,,,,,,,444,,,,,444,444", "444,444,444,444,,,,444,444,,,,,,,444,,,444,,,444,444,615,615,615,,615", ",,,615,615,,,,615,,615,615,615,615,615,615,615,,,,,,615,615,615,615", "615,615,615,,,615,,,,,,,615,,,615,615,,615,615,615,615,615,,615,615", "615,,615,615,,615,615,,,,,,,,,,,,,,,,,,,,,615,,,615,,,615,,,615,,,,", ",615,,,,,,,,615,,,,,615,615,615,615,615,615,,,,615,615,,,,,,,615,,,615", ",,615,615,850,850,850,850,850,,,,850,850,,,,850,,850,850,850,850,850", "850,850,,,,,,850,850,850,850,850,850,850,,,850,,,,,,850,850,,850,850", "850,,850,850,850,850,850,,850,850,850,,850,850,,850,850,,,,,,,,,,,,", ",,,,,,,,850,,,850,,,850,,,850,,850,,,,850,,,,,,,,850,,,,,850,850,850", "850,850,850,,,,850,850,,,,,,,850,,,850,,,850,850,99,99,99,99,99,,,,99", "99,,,,99,,99,99,99,99,99,99,99,,,,,,99,99,99,99,99,99,99,,,99,,,,,,99", "99,99,99,99,99,,99,99,99,99,99,,99,99,99,,99,99,,99,99,,,,,,,,,,,,,", ",,,,,,,99,,,99,,,99,,,99,,99,,,,99,,,,,,,,99,,,,,99,99,99,99,99,99,", ",,99,99,,,,,,99,99,,,99,,,99,99,103,103,103,,103,,,,103,103,,,,103,", "103,103,103,103,103,103,103,,,,,,103,103,103,103,103,103,103,,,103,", ",,,,,103,,,103,103,,103,103,103,103,103,,103,103,103,,103,103,,103,103", ",,,,,,,,,,,,,,,,,,,,103,,,103,,,103,,,103,,,,,,103,,,,,,,,103,,,,,103", "103,103,103,103,103,,,,103,103,,,,,,,103,,,103,,,103,103,104,104,104", ",104,,,,104,104,,,,104,,104,104,104,104,104,104,104,,,,,,104,104,104", "104,104,104,104,,,104,,,,,,,104,,,104,104,,104,104,104,104,104,,104", "104,104,,104,104,,104,104,,,,,,,,,,,,,,,,,,,,,104,,,104,,,104,,,104", ",,,,,104,,,,,,,,104,,,,,104,104,104,104,104,104,,,,104,104,,,,,,,104", ",,104,,,104,104,105,105,105,,105,,,,105,105,,,,105,,105,105,105,105", "105,105,105,,,,,,105,105,105,105,105,105,105,,,105,,,,,,,105,,,105,105", ",105,105,105,105,105,,105,105,105,,105,105,,105,105,,,,,,,,,,,,,,,,", ",,,,105,,,105,,,105,,,105,,,,,,105,,,,,,,,105,,,,,105,105,105,105,105", "105,,,,105,105,,,,,,,105,,,105,,,105,105,106,106,106,,106,,,,106,106", ",,,106,,106,106,106,106,106,106,106,,,,,,106,106,106,106,106,106,106", ",,106,,,,,,,106,,,106,106,,106,106,106,106,106,,106,106,106,,106,106", ",106,106,,,,,,,,,,,,,,,,,,,,,106,,,106,,,106,,,106,,,,,,106,,,,,,,,106", ",,,,106,106,106,106,106,106,,,,106,106,,,,,,,106,,,106,,,106,106,107", "107,107,107,107,,,,107,107,,,,107,,107,107,107,107,107,107,107,,,,,", "107,107,107,107,107,107,107,,,107,,,,,,107,107,,107,107,107,,107,107", "107,107,107,,107,107,107,,107,107,,107,107,,,,,,,,,,,,,,,,,,,,,107,", ",107,,,107,,,107,,107,,,,107,,,,,,,,107,,,,,107,107,107,107,107,107", ",,,107,107,,,,,,,107,,,107,,,107,107,108,108,108,108,108,,,,108,108", ",,,108,,108,108,108,108,108,108,108,,,,,,108,108,108,108,108,108,108", ",,108,,,,,,108,108,108,108,108,108,,108,108,108,108,108,,108,108,108", ",108,108,,108,108,,,,,,,,,,,,,,,,,,,,,108,,,108,,,108,,,108,,108,,,", "108,,,,,,,,108,,,,,108,108,108,108,108,108,,,,108,108,,,,,,,108,,,108", ",,108,108,841,841,841,,841,,,,841,841,,,,841,,841,841,841,841,841,841", "841,,,,,,841,841,841,841,841,841,841,,,841,,,,,,,841,,,841,841,,841", "841,841,841,841,,841,841,841,,841,841,,841,841,,,,,,,,,,,,,,,,,,,,,841", ",,841,,,841,,,841,,,,,,841,,,,,,,,841,,,,,841,841,841,841,841,841,,", ",841,841,,,,,,,841,,,841,,,841,841,617,617,617,,617,,,,617,617,,,,617", ",617,617,617,617,617,617,617,,,,,,617,617,617,617,617,617,617,,,617", ",,,,,,617,,,617,617,,617,617,617,617,617,,617,617,617,,617,617,,617", "617,,,,,,,,,,,,,,,,,,,,,617,,,617,,,617,,,617,,617,,,,617,,,,,,,,617", ",,,,617,617,617,617,617,617,,,,617,617,,,,,,,617,,,617,,,617,617,619", "619,619,,619,,,,619,619,,,,619,,619,619,619,619,619,619,619,,,,,,619", "619,619,619,619,619,619,,,619,,,,,,,619,,,619,619,,619,619,619,619,619", ",619,619,619,,619,619,,619,619,,,,,,,,,,,,,,,,,,,,,619,,,619,,,619,", ",619,,,,,,619,,,,,,,,619,,,,,619,619,619,619,619,619,,,,619,619,,,,", ",,619,,,619,,,619,619,195,195,195,195,195,,,,195,195,,,,195,,195,195", "195,195,195,195,195,,,,,,195,195,195,195,195,195,195,,,195,,,,,,195", "195,,195,195,195,,195,195,195,195,195,,195,195,195,,195,195,,195,195", ",,,,,,,,,,,,,,,,,,,,195,,,195,,,195,,,195,,195,,,,195,,,,,,,,195,,,", ",195,195,195,195,195,195,,,,195,195,,,,,,,195,,,195,,,195,195,196,196", "196,,196,,,,196,196,,,,196,,196,196,196,196,196,196,196,,,,,,196,196", "196,196,196,196,196,,,196,,,,,,,196,,,196,196,,196,196,196,196,196,", "196,196,196,,196,196,,196,196,,,,,,,,,,,,,,,,,,,,,196,,,196,,,196,,", "196,,196,,,,196,,,,,,,,196,,,,,196,196,196,196,196,196,,,,196,196,,", ",,,,196,,,196,,,196,196,197,197,197,,197,,,,197,197,,,,197,,197,197", "197,197,197,197,197,,,,,,197,197,197,197,197,197,197,,,197,,,,,,,197", ",,197,197,,197,197,197,197,197,,197,197,197,,197,197,,197,197,,,,,,", ",,,,,,,,,,,,,,197,,,197,,,197,,,197,,197,,,,197,,,,,,,,197,,,,,197,197", "197,197,197,197,,,,197,197,,,,,,,197,,,197,,,197,197,198,198,198,,198", ",,,198,198,,,,198,,198,198,198,198,198,198,198,,,,,,198,198,198,198", "198,198,198,,,198,,,,,,,198,,,198,198,,198,198,198,198,198,,198,198", "198,,198,198,,198,198,,,,,,,,,,,,,,,,,,,,,198,,,198,,,198,,,198,,,,", ",198,,,,,,,,198,,,,,198,198,198,198,198,198,,,,198,198,,,,,,,198,,,198", ",,198,198,199,199,199,,199,,,,199,199,,,,199,,199,199,199,199,199,199", "199,,,,,,199,199,199,199,199,199,199,,,199,,,,,,,199,,,199,199,,199", "199,199,199,199,199,199,199,199,,199,199,,199,199,,,,,,,,,,,,,,,,,,", ",,199,,,199,,,199,,,199,,199,,,,199,,,,,,,,199,,,,,199,199,199,199,199", "199,,,,199,199,,,,,,,199,,,199,,,199,199,620,620,620,,620,,,,620,620", ",,,620,,620,620,620,620,620,620,620,,,,,,620,620,620,620,620,620,620", ",,620,,,,,,,620,,,620,620,,620,620,620,620,620,,620,620,620,,620,620", ",620,620,,,,,,,,,,,,,,,,,,,,,620,,,620,,,620,,,620,,,,,,620,,,,,,,,620", ",,,,620,620,620,620,620,620,,,,620,620,,,,,,,620,,,620,,,620,620,625", "625,625,,625,,,,625,625,,,,625,,625,625,625,625,625,625,625,,,,,,625", "625,625,625,625,625,625,,,625,,,,,,,625,,,625,625,,625,625,625,625,625", ",625,625,625,,625,625,,625,625,,,,,,,,,,,,,,,,,,,,,625,,,625,,,625,", ",625,,,,,,625,,,,,,,,625,,,,,625,625,625,625,625,625,,,,625,625,,,,", ",,625,,,625,,,625,625,202,202,202,,202,,,,202,202,,,,202,,202,202,202", "202,202,202,202,,,,,,202,202,202,202,202,202,202,,,202,,,,,,,202,,,202", "202,,202,202,202,202,202,,202,202,202,,202,202,,202,202,,,,,,,,,,,,", ",,,,,,,,202,,,202,,,202,,,202,,,,,,202,,,,,,,,202,,,,,202,202,202,202", "202,202,,,,202,202,,,,,,,202,,,202,,,202,202,203,203,203,,203,,,,203", "203,,,,203,,203,203,203,203,203,203,203,,,,,,203,203,203,203,203,203", "203,,,203,,,,,,,203,,,203,203,,203,203,203,203,203,,203,203,203,,203", "203,,203,203,,,,,,,,,,,,,,,,,,,,,203,,,203,,,203,,,203,,,,,,203,,,,", ",,,203,,,,,203,203,203,203,203,203,,,,203,203,,,,,,,203,,,203,,,203", "203,204,204,204,,204,,,,204,204,,,,204,,204,204,204,204,204,204,204", ",,,,,204,204,204,204,204,204,204,,,204,,,,,,,204,,,204,204,,204,204", "204,204,204,,204,204,204,,204,204,,204,204,,,,,,,,,,,,,,,,,,,,,204,", ",204,,,204,,,204,,,,,,204,,,,,,,,204,,,,,204,204,204,204,204,204,,,", "204,204,,,,,,,204,,,204,,,204,204,628,628,628,,628,,,,628,628,,,,628", ",628,628,628,628,628,628,628,,,,,,628,628,628,628,628,628,628,,,628", ",,,,,,628,,,628,628,,628,628,628,628,628,,628,628,628,,628,628,,628", "628,,,,,,,,,,,,,,,,,,,,,628,,,628,,,628,,,628,,,,,,628,,,,,,,,628,,", ",,628,628,628,628,628,628,,,,628,628,,,,,,,628,,,628,,,628,628,829,829", "829,,829,,,,829,829,,,,829,,829,829,829,829,829,829,829,,,,,,829,829", "829,829,829,829,829,,,829,,,,,,,829,,,829,829,,829,829,829,829,829,", "829,829,829,,829,829,,829,829,,,,,,,,,,,,,,,,,,,,,829,,,829,,,829,,", "829,,,,,,829,,,,,,,,829,,,,,829,829,829,829,829,829,,,,829,829,,,,,", ",829,,,829,,,829,829,418,418,418,,418,,,,418,418,,,,418,,418,418,418", "418,418,418,418,,,,,,418,418,418,418,418,418,418,,,418,,,,,,,418,,,418", "418,,418,418,418,418,418,,418,418,418,,418,418,,418,418,,,,,,,,,,,,", ",,,,,,,,418,,,418,,,418,,,418,,,,,,418,,,,,,,,418,,,,,418,418,418,418", "418,418,,,,418,418,,,,,,,418,,,418,,,418,418,730,730,730,730,730,,,", "730,730,,,,730,,730,730,730,730,730,730,730,,,,,,730,730,730,730,730", "730,730,,,730,,,,,,730,730,,730,730,730,,730,730,730,730,730,,730,730", "730,,730,730,,730,730,,,,,,,,,,,,,,,,,,,,,730,,,730,,,730,,,730,,730", ",,,730,,,,,,,,730,,,,,730,730,730,730,730,730,,,,730,730,,,,,,,730,", ",730,,,730,730,636,636,636,,636,,,,636,636,,,,636,,636,636,636,636,636", "636,636,,,,,,636,636,636,636,636,636,636,,,636,,,,,,,636,,,636,636,", "636,636,636,636,636,,636,636,636,,636,636,,636,636,,,,,,,,,,,,,,,,,", ",,,636,,,636,,,636,,,636,,,,,,636,,,,,,,,636,,,,,636,636,636,636,636", "636,,,,636,636,,,,,,,636,,,636,,,636,636,809,809,809,809,809,,,,809", "809,,,,809,,809,809,809,809,809,809,809,,,,,,809,809,809,809,809,809", "809,,,809,,,,,,809,809,,809,809,809,,809,809,809,809,809,,809,809,809", ",809,809,,809,809,,,,,,,,,,,,,,,,,,,,,809,,,809,,,809,,,809,,809,,,", "809,,,,,,,,809,,,,,809,809,809,809,809,809,,,,809,809,,,,,,,809,,,809", ",,809,809,212,212,212,212,212,,,,212,212,,,,212,,212,212,212,212,212", "212,212,,,,,,212,212,212,212,212,212,212,,,212,,,,,,212,212,,212,212", "212,,212,212,212,212,212,,212,212,212,,212,212,,212,212,,,,,,,,,,,,", ",,,,,,,,212,,,212,,,212,,,212,,212,,,,212,,,,,,,,212,,,,,212,212,212", "212,212,212,,,,212,212,,,,,,,212,,,212,,,212,212,213,213,213,,213,,", ",213,213,,,,213,,213,213,213,213,213,213,213,,,,,,213,213,213,213,213", "213,213,,,213,,,,,,,213,,,213,213,,213,213,213,213,213,,213,213,213", ",213,213,,213,213,,,,,,,,,,,,,,,,,,,,,213,,,213,,213,213,,,213,,,,,", "213,,,,,,,,213,,,,,213,213,213,213,213,213,,,,213,213,,,,,,,213,,,213", ",,213,213,216,216,216,,216,,,,216,216,,,,216,,216,216,216,216,216,216", "216,,,,,,216,216,216,216,216,216,216,,,216,,,,,,,216,,,216,216,,216", "216,216,216,216,,216,216,216,,216,216,,216,216,,,,,,,,,,,,,,,,,,,,,216", ",,216,,,216,,,216,,,,,,216,,,,,,,,216,,,,,216,216,216,216,216,216,,", ",216,216,,,,,,,216,,,216,,,216,216,808,808,808,808,808,,,,808,808,,", ",808,,808,808,808,808,808,808,808,,,,,,808,808,808,808,808,808,808,", ",808,,,,,,808,808,,808,808,808,,808,808,808,808,808,,808,808,808,,808", "808,,808,808,,,,,,,,,,,,,,,,,,,,,808,,,808,,,808,,,808,,808,,,,808,", ",,,,,,808,,,,,808,808,808,808,808,808,,,,808,808,,,,,,,808,,,808,,,808", "808,218,218,218,,218,,,,218,218,,,,218,,218,218,218,218,218,218,218", ",,,,,218,218,218,218,218,218,218,,,218,,,,,,,218,,,218,218,,218,218", "218,218,218,,218,218,218,,218,218,,218,218,,,,,,,,,,,,,,,,,,,,,218,", ",218,,,218,,,218,,,,,,218,,,,,,,,218,,,,,218,218,218,218,218,218,,,", "218,218,,,,,,,218,,,218,,,218,218,219,219,219,,219,,,,219,219,,,,219", ",219,219,219,219,219,219,219,,,,,,219,219,219,219,219,219,219,,,219", ",,,,,,219,,,219,219,,219,219,219,219,219,,219,219,219,,219,219,,219", "219,,,,,,,,,,,,,,,,,,,,,219,,,219,,,219,,,219,,,,,,219,,,,,,,,219,,", ",,219,219,219,219,219,219,,,,219,219,,,,,,,219,,,219,,,219,219,220,220", "220,,220,,,,220,220,,,,220,,220,220,220,220,220,220,220,,,,,,220,220", "220,220,220,220,220,,,220,,,,,,,220,,,220,220,,220,220,220,220,220,", "220,220,220,,220,220,,220,220,,,,,,,,,,,,,,,,,,,,,220,,,220,,,220,,", "220,,,,,,220,,,,,,,,220,,,,,220,220,220,220,220,220,,,,220,220,,,,,", ",220,,,220,,,220,220,221,221,221,,221,,,,221,221,,,,221,,221,221,221", "221,221,221,221,,,,,,221,221,221,221,221,221,221,,,221,,,,,,,221,,,221", "221,,221,221,221,221,221,,221,221,221,,221,221,,221,221,,,,,,,,,,,,", ",,,,,,,,221,,,221,,,221,,,221,,,,,,221,,,,,,,,221,,,,,221,221,221,221", "221,221,,,,221,221,,,,,,,221,,,221,,,221,221,222,222,222,,222,,,,222", "222,,,,222,,222,222,222,222,222,222,222,,,,,,222,222,222,222,222,222", "222,,,222,,,,,,,222,,,222,222,,222,222,222,222,222,,222,222,222,,222", "222,,222,222,,,,,,,,,,,,,,,,,,,,,222,,,222,,,222,,,222,,,,,,222,,,,", ",,,222,,,,,222,222,222,222,222,222,,,,222,222,,,,,,,222,,,222,,,222", "222,223,223,223,,223,,,,223,223,,,,223,,223,223,223,223,223,223,223", ",,,,,223,223,223,223,223,223,223,,,223,,,,,,,223,,,223,223,,223,223", "223,223,223,,223,223,223,,223,223,,223,223,,,,,,,,,,,,,,,,,,,,,223,", ",223,,,223,,,223,,,,,,223,,,,,,,,223,,,,,223,223,223,223,223,223,,,", "223,223,,,,,,,223,,,223,,,223,223,224,224,224,,224,,,,224,224,,,,224", ",224,224,224,224,224,224,224,,,,,,224,224,224,224,224,224,224,,,224", ",,,,,,224,,,224,224,,224,224,224,224,224,,224,224,224,,224,224,,224", "224,,,,,,,,,,,,,,,,,,,,,224,,,224,,,224,,,224,,,,,,224,,,,,,,,224,,", ",,224,224,224,224,224,224,,,,224,224,,,,,,,224,,,224,,,224,224,225,225", "225,,225,,,,225,225,,,,225,,225,225,225,225,225,225,225,,,,,,225,225", "225,225,225,225,225,,,225,,,,,,,225,,,225,225,,225,225,225,225,225,", "225,225,225,,225,225,,225,225,,,,,,,,,,,,,,,,,,,,,225,,,225,,,225,,", "225,,,,,,225,,,,,,,,225,,,,,225,225,225,225,225,225,,,,225,225,,,,,", ",225,,,225,,,225,225,226,226,226,,226,,,,226,226,,,,226,,226,226,226", "226,226,226,226,,,,,,226,226,226,226,226,226,226,,,226,,,,,,,226,,,226", "226,,226,226,226,226,226,,226,226,226,,226,226,,226,226,,,,,,,,,,,,", ",,,,,,,,226,,,226,,,226,,,226,,,,,,226,,,,,,,,226,,,,,226,226,226,226", "226,226,,,,226,226,,,,,,,226,,,226,,,226,226,227,227,227,,227,,,,227", "227,,,,227,,227,227,227,227,227,227,227,,,,,,227,227,227,227,227,227", "227,,,227,,,,,,,227,,,227,227,,227,227,227,227,227,,227,227,227,,227", "227,,227,227,,,,,,,,,,,,,,,,,,,,,227,,,227,,,227,,,227,,,,,,227,,,,", ",,,227,,,,,227,227,227,227,227,227,,,,227,227,,,,,,,227,,,227,,,227", "227,228,228,228,,228,,,,228,228,,,,228,,228,228,228,228,228,228,228", ",,,,,228,228,228,228,228,228,228,,,228,,,,,,,228,,,228,228,,228,228", "228,228,228,,228,228,228,,228,228,,228,228,,,,,,,,,,,,,,,,,,,,,228,", ",228,,,228,,,228,,,,,,228,,,,,,,,228,,,,,228,228,228,228,228,228,,,", "228,228,,,,,,,228,,,228,,,228,228,229,229,229,,229,,,,229,229,,,,229", ",229,229,229,229,229,229,229,,,,,,229,229,229,229,229,229,229,,,229", ",,,,,,229,,,229,229,,229,229,229,229,229,,229,229,229,,229,229,,229", "229,,,,,,,,,,,,,,,,,,,,,229,,,229,,,229,,,229,,,,,,229,,,,,,,,229,,", ",,229,229,229,229,229,229,,,,229,229,,,,,,,229,,,229,,,229,229,230,230", "230,,230,,,,230,230,,,,230,,230,230,230,230,230,230,230,,,,,,230,230", "230,230,230,230,230,,,230,,,,,,,230,,,230,230,,230,230,230,230,230,", "230,230,230,,230,230,,230,230,,,,,,,,,,,,,,,,,,,,,230,,,230,,,230,,", "230,,,,,,230,,,,,,,,230,,,,,230,230,230,230,230,230,,,,230,230,,,,,", ",230,,,230,,,230,230,231,231,231,,231,,,,231,231,,,,231,,231,231,231", "231,231,231,231,,,,,,231,231,231,231,231,231,231,,,231,,,,,,,231,,,231", "231,,231,231,231,231,231,,231,231,231,,231,231,,231,231,,,,,,,,,,,,", ",,,,,,,,231,,,231,,,231,,,231,,,,,,231,,,,,,,,231,,,,,231,231,231,231", "231,231,,,,231,231,,,,,,,231,,,231,,,231,231,232,232,232,,232,,,,232", "232,,,,232,,232,232,232,232,232,232,232,,,,,,232,232,232,232,232,232", "232,,,232,,,,,,,232,,,232,232,,232,232,232,232,232,,232,232,232,,232", "232,,232,232,,,,,,,,,,,,,,,,,,,,,232,,,232,,,232,,,232,,,,,,232,,,,", ",,,232,,,,,232,232,232,232,232,232,,,,232,232,,,,,,,232,,,232,,,232", "232,233,233,233,,233,,,,233,233,,,,233,,233,233,233,233,233,233,233", ",,,,,233,233,233,233,233,233,233,,,233,,,,,,,233,,,233,233,,233,233", "233,233,233,,233,233,233,,233,233,,233,233,,,,,,,,,,,,,,,,,,,,,233,", ",233,,,233,,,233,,,,,,233,,,,,,,,233,,,,,233,233,233,233,233,233,,,", "233,233,,,,,,,233,,,233,,,233,233,234,234,234,,234,,,,234,234,,,,234", ",234,234,234,234,234,234,234,,,,,,234,234,234,234,234,234,234,,,234", ",,,,,,234,,,234,234,,234,234,234,234,234,,234,234,234,,234,234,,234", "234,,,,,,,,,,,,,,,,,,,,,234,,,234,,,234,,,234,,,,,,234,,,,,,,,234,,", ",,234,234,234,234,234,234,,,,234,234,,,,,,,234,,,234,,,234,234,235,235", "235,,235,,,,235,235,,,,235,,235,235,235,235,235,235,235,,,,,,235,235", "235,235,235,235,235,,,235,,,,,,,235,,,235,235,,235,235,235,235,235,", "235,235,235,,235,235,,235,235,,,,,,,,,,,,,,,,,,,,,235,,,235,,,235,,", "235,,,,,,235,,,,,,,,235,,,,,235,235,235,235,235,235,,,,235,235,,,,,", ",235,,,235,,,235,235,236,236,236,,236,,,,236,236,,,,236,,236,236,236", "236,236,236,236,,,,,,236,236,236,236,236,236,236,,,236,,,,,,,236,,,236", "236,,236,236,236,236,236,,236,236,236,,236,236,,236,236,,,,,,,,,,,,", ",,,,,,,,236,,,236,,,236,,,236,,,,,,236,,,,,,,,236,,,,,236,236,236,236", "236,236,,,,236,236,,,,,,,236,,,236,,,236,236,237,237,237,,237,,,,237", "237,,,,237,,237,237,237,237,237,237,237,,,,,,237,237,237,237,237,237", "237,,,237,,,,,,,237,,,237,237,,237,237,237,237,237,,237,237,237,,237", "237,,237,237,,,,,,,,,,,,,,,,,,,,,237,,,237,,,237,,,237,,,,,,237,,,,", ",,,237,,,,,237,237,237,237,237,237,,,,237,237,,,,,,,237,,,237,,,237", "237,238,238,238,,238,,,,238,238,,,,238,,238,238,238,238,238,238,238", ",,,,,238,238,238,238,238,238,238,,,238,,,,,,,238,,,238,238,,238,238", "238,238,238,,238,238,238,,238,238,,238,238,,,,,,,,,,,,,,,,,,,,,238,", ",238,,,238,,,238,,,,,,238,,,,,,,,238,,,,,238,238,238,238,238,238,,,", "238,238,,,,,,,238,,,238,,,238,238,239,239,239,,239,,,,239,239,,,,239", ",239,239,239,239,239,239,239,,,,,,239,239,239,239,239,239,239,,,239", ",,,,,,239,,,239,239,,239,239,239,239,239,,239,239,239,,239,239,,239", "239,,,,,,,,,,,,,,,,,,,,,239,,,239,,,239,,,239,,,,,,239,,,,,,,,239,,", ",,239,239,239,239,239,239,,,,239,239,,,,,,,239,,,239,,,239,239,240,240", "240,,240,,,,240,240,,,,240,,240,240,240,240,240,240,240,,,,,,240,240", "240,240,240,240,240,,,240,,,,,,,240,,,240,240,,240,240,240,240,240,", "240,240,240,,240,240,,240,240,,,,,,,,,,,,,,,,,,,,,240,,,240,,,240,,", "240,,,,,,240,,,,,,,,240,,,,,240,240,240,240,240,240,,,,240,240,,,,,", ",240,,,240,,,240,240,241,241,241,,241,,,,241,241,,,,241,,241,241,241", "241,241,241,241,,,,,,241,241,241,241,241,241,241,,,241,,,,,,,241,,,241", "241,,241,241,241,241,241,,241,241,241,,241,241,,241,241,,,,,,,,,,,,", ",,,,,,,,241,,,241,,,241,,,241,,,,,,241,,,,,,,,241,,,,,241,241,241,241", "241,241,,,,241,241,,,,,,,241,,,241,,,241,241,242,242,242,,242,,,,242", "242,,,,242,,242,242,242,242,242,242,242,,,,,,242,242,242,242,242,242", "242,,,242,,,,,,,242,,,242,242,,242,242,242,242,242,,242,242,242,,242", "242,,242,242,,,,,,,,,,,,,,,,,,,,,242,,,242,,,242,,,242,,,,,,242,,,,", ",,,242,,,,,242,242,242,242,242,242,,,,242,242,,,,,,,242,,,242,,,242", "242,243,243,243,,243,,,,243,243,,,,243,,243,243,243,243,243,243,243", ",,,,,243,243,243,243,243,243,243,,,243,,,,,,,243,,,243,243,,243,243", "243,243,243,,243,243,243,,243,243,,243,243,,,,,,,,,,,,,,,,,,,,,243,", ",243,,,243,,,243,,,,,,243,,,,,,,,243,,,,,243,243,243,243,243,243,,,", "243,243,,,,,,,243,,,243,,,243,243,378,378,378,,378,,,,378,378,,,,378", ",378,378,378,378,378,378,378,,,,,,378,378,378,378,378,378,378,,,378", ",,,,,,378,,,378,378,,378,378,378,378,378,,378,378,378,,378,378,,378", "378,,,,,,,,,,,,,,,,,,,,,378,,,378,,,378,,,378,,,,,,378,,,,,,,,378,,", ",,378,378,378,378,378,378,,,,378,378,,,,,,,378,,,378,,,378,378,806,806", "806,,806,,,,806,806,,,,806,,806,806,806,806,806,806,806,,,,,,806,806", "806,806,806,806,806,,,806,,,,,,,806,,,806,806,,806,806,806,806,806,", "806,806,806,,806,806,,806,806,,,,,,,,,,,,,,,,,,,,,806,,,806,,,806,,", "806,,,,,,806,,,,,,,,806,,,,,806,806,806,806,806,806,,,,806,806,,,,,", ",806,,,806,,,806,806,505,505,505,505,505,,,,505,505,,,,505,,505,505", "505,505,505,505,505,,,,,,505,505,505,505,505,505,505,,,505,,,,,,505", "505,,505,505,505,,505,505,505,505,505,,505,505,505,,505,505,,505,505", ",,,,,,,,,,,,,,,,,,,,505,,,505,,,505,,,505,,505,,,,505,,,,,,,,505,,,", ",505,505,505,505,505,505,,,,505,505,,,,,,505,505,,,505,,,505,505,252", "252,252,,252,,,,252,252,,,,252,,252,252,252,252,252,252,252,,,,,,252", "252,252,252,252,252,252,,,252,,,,,,,252,,,252,252,,252,252,252,252,252", ",252,252,252,,252,252,,252,252,,,,,,,,,,,,,,,,,,,,,252,,,252,,,252,", ",252,,,,,,252,,,,,,,,252,,,,,252,252,252,252,252,252,,,,252,252,,,,", ",,252,,,252,,,252,252,787,787,787,787,787,,,,787,787,,,,787,,787,787", "787,787,787,787,787,,,,,,787,787,787,787,787,787,787,,,787,,,,,,787", "787,,787,787,787,,787,787,787,787,787,,787,787,787,,787,787,,787,787", ",,,,,,,,,,,,,,,,,,,,787,,,787,,,787,,,787,,787,,,,787,,,,,,,,787,,,", ",787,787,787,787,787,787,,,,787,787,,,,,,,787,,,787,,,787,787,254,254", "254,,254,,,,254,254,,,,254,,254,254,254,254,254,254,254,,,,,,254,254", "254,254,254,254,254,,,254,,,,,,,254,,,254,254,,254,254,254,254,254,", "254,254,254,,254,254,,254,254,,,,,,,,,,,,,,,,,,,,,254,,,254,,,254,,", "254,,,,,,254,,,,,,,,254,,,,,254,254,254,254,254,254,,,,254,254,,,,,", ",254,,,254,,,254,254,259,259,259,,259,,,,259,259,,,,259,,259,259,259", "259,259,259,259,,,,,,259,259,259,259,259,259,259,,,259,,,,,,,259,,,259", "259,,259,259,259,259,259,,259,259,259,,259,259,,259,259,,,,,,,,,,,,", ",,,,,,,,259,,,259,,,259,,,259,,,,,,259,,,,,,,,259,,,,,259,259,259,259", "259,259,,,,259,259,,,,,,,259,,,259,,,259,259,640,640,640,640,640,,,", "640,640,,,,640,,640,640,640,640,640,640,640,,,,,,640,640,640,640,640", "640,640,,,640,,,,,,640,640,,640,640,640,,640,640,640,640,640,,640,640", "640,,640,640,,640,640,,,,,,,,,,,,,,,,,,,,,640,,,640,,,640,,,640,,640", ",,,640,,,,,,,,640,,,,,640,640,640,640,640,640,,,,640,640,,,,,,,640,", ",640,,,640,640,644,644,644,,644,,,,644,644,,,,644,,644,644,644,644,644", "644,644,,,,,,644,644,644,644,644,644,644,,,644,,,,,,,644,,,644,644,", "644,644,644,644,644,,644,644,644,,644,644,,644,644,,,,,,,,,,,,,,,,,", ",,,644,,,644,,,644,,,644,,,,,,644,,,,,,,,644,,,,,644,644,644,644,644", "644,,,,644,644,,,,,,,644,,,644,,,644,644,651,651,651,651,651,,,,651", "651,,,,651,,651,651,651,651,651,651,651,,,,,,651,651,651,651,651,651", "651,,,651,,,,,,651,651,,651,651,651,,651,651,651,651,651,,651,651,651", ",651,651,,651,651,,,,,,,,,,,,,,,,,,,,,651,,,651,,,651,,,651,,651,,,", "651,,,,,,,,651,,,,,651,651,651,651,651,651,,,,651,651,,,,,,,651,,,651", ",,651,651,265,265,265,,265,,,,265,265,,,,265,,265,265,265,265,265,265", "265,,,,,,265,265,265,265,265,265,265,,,265,,,,,,,265,,,265,265,,265", "265,265,265,265,265,265,265,265,,265,265,,265,265,,,,,,,,,,,,,,,,,,", ",,265,,,265,,,265,,,265,,265,,265,,265,,,,,,,,265,,,,,265,265,265,265", "265,265,,,,265,265,,,,,,,265,,,265,,,265,265,266,266,266,,266,,,,266", "266,,,,266,,266,266,266,266,266,266,266,,,,,,266,266,266,266,266,266", "266,,,266,,,,,,,266,,,266,266,,266,266,266,266,266,266,266,266,266,", "266,266,,266,266,,,,,,,,,,,,,,,,,,,,,266,,,266,,,266,,,266,,266,,266", ",266,,,,,,,,266,,,,,266,266,266,266,266,266,,,,266,266,,,,,,,266,,,266", ",,266,266,274,274,274,,274,,,,274,274,,,,274,,274,274,274,274,274,274", "274,,,,,,274,274,274,274,274,274,274,,,274,,,,,,,274,,,274,274,,274", "274,274,274,274,274,274,274,274,,274,274,,274,274,,,,,,,,,,,,,,,,,,", ",,274,,,274,,274,274,,,274,,274,,274,,274,,,,,,,,274,,,,,274,274,274", "274,274,274,,,,274,274,,,,,,,274,,,274,,,274,274,777,777,777,,777,,", ",777,777,,,,777,,777,777,777,777,777,777,777,,,,,,777,777,777,777,777", "777,777,,,777,,,,,,,777,,,777,777,,777,777,777,777,777,,777,777,777", ",777,777,,777,777,,,,,,,,,,,,,,,,,,,,,777,,,777,,,777,,,777,,777,,,", "777,,,,,,,,777,,,,,777,777,777,777,777,777,,,,777,777,,,,,,,777,,,777", ",,777,777,657,657,657,,657,,,,657,657,,,,657,,657,657,657,657,657,657", "657,,,,,,657,657,657,657,657,657,657,,,657,,,,,,,657,,,657,657,,657", "657,657,657,657,657,657,657,657,,657,657,,657,657,,,,,,,,,,,,,,,,,,", ",,657,,,657,,,657,,,657,,657,,657,,657,,,,,,,,657,,,,,657,657,657,657", "657,657,,,,657,657,,,,,,,657,,,657,,,657,657,762,762,762,,762,,,,762", "762,,,,762,,762,762,762,762,762,762,762,,,,,,762,762,762,762,762,762", "762,,,762,,,,,,,762,,,762,762,,762,762,762,762,762,,762,762,762,,762", "762,,762,762,,,,,,,,,,,,,,,,,,,,,762,,,762,,,762,,,762,,,,,,762,,,,", ",,,762,,,,,762,762,762,762,762,762,,,,762,762,,,,,,,762,,,762,,,762", "762,278,278,278,278,278,,,,278,278,,,,278,,278,278,278,278,278,278,278", ",,,,,278,278,278,278,278,278,278,,,278,,,,,,278,278,,278,278,278,,278", "278,278,278,278,,278,278,278,,278,278,,278,278,,,,,,,,,,,,,,,,,,,,,278", ",,278,,,278,,,278,,278,,,,278,,,,,,,,278,,,,,278,278,278,278,278,278", ",,,278,278,,,,,,,278,,,278,,,278,278,761,761,761,,761,,,,761,761,,,", "761,,761,761,761,761,761,761,761,,,,,,761,761,761,761,761,761,761,,", "761,,,,,,,761,,,761,761,,761,761,761,761,761,,761,761,761,,761,761,", "761,761,,,,,,,,,,,,,,,,,,,,,761,,,761,,,761,,,761,,,,,,761,,,,,,,,761", ",,,,761,761,761,761,761,761,,,,761,761,,,,,,,761,,,761,,,761,761,760", "760,760,,760,,,,760,760,,,,760,,760,760,760,760,760,760,760,,,,,,760", "760,760,760,760,760,760,,,760,,,,,,,760,,,760,760,,760,760,760,760,760", ",760,760,760,,760,760,,760,760,,,,,,,,,,,,,,,,,,,,,760,,,760,,,760,", ",760,,,,,,760,,,,,,,,760,,,,,760,760,760,760,760,760,,,,760,760,,,,", ",,760,,,760,,,760,760,366,366,366,,366,,,,366,366,,,,366,,366,366,366", "366,366,366,366,,,,,,366,366,366,366,366,366,366,,,366,,,,,,,366,,,366", "366,,366,366,366,366,366,,366,366,366,,366,366,823,,823,823,823,,823", ",,,,,,,,,,,,,,,,366,,,366,,,366,,,366,,,,,,823,,,,,,,,823,823,823,823", ",366,366,366,366,366,366,,,,366,366,,,,,,,366,,,366,,,366,366,282,282", "282,,282,,,,282,282,,,,282,,282,282,282,282,282,282,282,,,,,,282,282", "282,282,282,282,282,,,282,,,,,,,282,,,282,282,,282,282,282,282,282,", "282,282,282,,282,282,732,,732,732,732,,732,,,,,,,,,,,,,,,,,282,,,282", ",,282,,,282,,,,,,732,,,,,,,,732,732,732,732,,282,282,282,282,282,282", ",,,282,282,,,,282,,,282,,,282,,,282,282,283,283,283,283,283,,,,283,283", ",,,283,,283,283,283,283,283,283,283,,,,,,283,283,283,283,283,283,283", ",,283,,,,,,283,283,,283,283,283,,283,283,283,283,283,,283,283,283,,283", "283,,283,283,,,,,,,,,,,,,,,,,,,,,283,,,283,,,283,,,283,,283,,,,283,", ",,,,,,283,,,,,283,283,283,283,283,283,,,,283,283,,,,,,,283,,,283,,,283", "283,663,663,663,663,663,,,,663,663,,,,663,,663,663,663,663,663,663,663", ",,,,,663,663,663,663,663,663,663,,,663,,,,,,663,663,,663,663,663,,663", "663,663,663,663,,663,663,663,,663,663,,663,663,,,,,,,,,,,,,,,,,,,,,663", ",,663,,,663,,,663,,663,,,,663,,,,,,,,663,,,,,663,663,663,663,663,663", ",,,663,663,,,,,,,663,,,663,,,663,663,664,664,664,664,664,,,,664,664", ",,,664,,664,664,664,664,664,664,664,,,,,,664,664,664,664,664,664,664", ",,664,,,,,,664,664,,664,664,664,,664,664,664,664,664,,664,664,664,,664", "664,,664,664,,,,,,,,,,,,,,,,,,,,,664,,,664,,,664,,,664,,664,,,,664,", ",,,,,,664,,,,,664,664,664,664,664,664,,,,664,664,,,,,,,664,,,664,,,664", "664,668,668,668,,668,,,,668,668,,,,668,,668,668,668,668,668,668,668", ",,,,,668,668,668,668,668,668,668,,,668,,,,,,,668,,,668,668,,668,668", "668,668,668,,668,668,668,,668,668,,,,,,,,,,,,,,,,,,,,,,,,668,,,668,", ",668,,,668,,,,,,,,,,,,,,,,,,,668,668,668,668,668,668,,,,668,668,,,,", ",,668,,,668,,,668,668,347,347,347,,347,,,,347,347,,,,347,,347,347,347", "347,347,347,347,,,,,,347,347,347,347,347,347,347,,,347,,,,,,,347,,,347", "347,,347,347,347,347,347,,347,347,347,,347,347,,347,347,,,,,,,,,,,,", ",,,,,,,,347,,,347,,,347,,,347,,,,,,347,,,,,,,,347,,,,,347,347,347,347", "347,347,,,,347,347,,,,,,,347,,,347,,,347,347,346,346,346,,346,,,,346", "346,,,,346,,346,346,346,346,346,346,346,,,,,,346,346,346,346,346,346", "346,,,346,,,,,,,346,,,346,346,,346,346,346,346,346,,346,346,346,,346", "346,,346,346,,,,,,,,,,,,,,,,,,,,,346,,,346,,,346,,,346,,,,,,346,,,,", ",,,346,,,,,346,346,346,346,346,346,,,,346,346,,,,,,,346,,,346,,,346", "346,678,678,678,,678,,,,678,678,,,,678,,678,678,678,678,678,678,678", ",,,,,678,678,678,678,678,678,678,,,678,,,,,,,678,,,678,678,,678,678", "678,678,678,,678,678,678,,678,678,,,,,,,,,,,,,,,,,,,,,,,,678,,,678,", ",678,,,678,,,,,,,,,,,,,,,,,,,678,678,678,678,678,678,,,,678,678,,,,", ",,678,,,678,,,678,678,684,684,684,,684,,,,684,684,,,,684,,684,684,684", "684,684,684,684,,,,,,684,684,684,684,684,684,684,,,684,,,,,,,684,,,684", "684,,684,684,684,684,684,,684,684,684,,684,684,,684,684,,,,,,,,,,,,", ",,,,,,,,684,,,684,,,684,,,684,,684,,,,684,,,,,,,,684,,,,,684,684,684", "684,684,684,,,,684,684,,,,,,,684,,,684,,,684,684,750,750,750,,750,,", ",750,750,,,,750,,750,750,750,750,750,750,750,,,,,,750,750,750,750,750", "750,750,,,750,,,,,,,750,,,750,750,,750,750,750,750,750,,750,750,750", ",750,750,,750,750,,,,,,,,,,,,,,,,,,,,,750,,,750,,,750,,,750,,,,,,750", ",,,,,,,750,,,,,750,750,750,750,750,750,,,,750,750,,,,,,,750,,,750,,", "750,750,749,749,749,,749,,,,749,749,,,,749,,749,749,749,749,749,749", "749,,,,,,749,749,749,749,749,749,749,,,749,,,,,,,749,,,749,749,,749", "749,749,749,749,,749,749,749,,749,749,,749,749,,,,,,,,,,,,,,,,,,,,,749", ",,749,,,749,,,749,,,,,,749,,,,,,,,749,,,,,749,749,749,749,749,749,,", ",749,749,,,,,,,749,,,749,,,749,749,295,295,295,,295,,,,295,295,,,,295", ",295,295,295,295,295,295,295,,,,,,295,295,295,295,295,295,295,,,295", ",,,,,,295,,,295,295,,295,295,295,295,295,,295,295,295,,295,295,,,,,", ",,,,,,,,,,,,,,,,,,295,,,295,,,295,,,295,,,,,,,,,,,,,,,,,,,295,295,295", "295,295,295,,,,295,295,,,,,,,295,,,295,,,295,295,715,715,715,,715,,", ",715,715,,,,715,,715,715,715,715,715,715,715,,,,,,715,715,715,715,715", "715,715,,,715,,,,,,,715,,,715,715,,715,715,715,715,715,,715,715,715", ",715,715,,715,715,,,,,,,,,,,,,,,,,,,,,715,,,715,,,715,,,715,,715,,,", "715,,,,,,,,715,,,,,715,715,715,715,715,715,,,,715,715,,,,,,,715,,,715", ",,715,715,743,743,743,743,743,,,,743,743,,,,743,,743,743,743,743,743", "743,743,,,,,,743,743,743,743,743,743,743,,,743,,,,,,743,743,,743,743", "743,,743,743,743,743,743,,743,743,743,,743,743,,743,743,,,,,,,,,,,,", ",,,,,,,,743,,,743,,,743,,,743,,743,,,,743,,,,,,,,743,,,,,743,743,743", "743,743,743,,,,743,743,,,,,,,743,,,743,,,743,743,721,721,721,,721,,", ",721,721,,,,721,,721,721,721,721,721,721,721,,,,,,721,721,721,721,721", "721,721,,,721,,,,,,,721,,,721,721,,721,721,721,721,721,,721,721,721", ",721,721,,721,721,,,,,,,,,,,,,,,,,,,,,721,,,721,,,721,,,721,,,,,,721", ",,,,,,,721,,,,,721,721,721,721,721,721,,,,721,721,,,,,,,721,,,721,,", "721,721,726,726,726,726,726,,,,726,726,,,,726,,726,726,726,726,726,726", "726,,,,,,726,726,726,726,726,726,726,,,726,,,,,,726,726,,726,726,726", ",726,726,726,726,726,,726,726,726,,726,726,,726,726,,,,,,,,,,,,,,,,", ",,,,726,,,726,,,726,,,726,,726,,,,726,,,,,,,,726,,,,,726,726,726,726", "726,726,,,,726,726,,,,,,,726,,,726,,,726,726,731,731,731,731,731,,,", "731,731,,,,731,,731,731,731,731,731,731,731,,,,,,731,731,731,731,731", "731,731,,,731,,,,,,731,731,,731,731,731,,731,731,731,731,731,,731,731", "731,,731,731,,731,731,,,,,,,,,,,,,,,,,,,,,731,,,731,,,731,,,731,,731", ",,,731,,,,,,,,731,,,,,731,731,731,731,731,731,,,,731,731,,,,,,,731,", ",731,,,731,731,304,304,304,,304,,,,304,304,,,,304,,304,304,304,304,304", "304,304,,,,,,304,304,304,304,304,304,304,,,304,,,,,,,304,,,304,304,", "304,304,304,304,304,,304,304,304,,304,304,,304,304,,,,,,,,,,,,,,,,,", ",,,304,,,304,304,,304,,,304,,,,,,304,,,,,,,,304,,,,,304,304,304,304", "304,304,,,,304,304,,,,,,,304,,,304,,,304,304,306,306,306,306,306,,,", "306,306,,,,306,,306,306,306,306,306,306,306,,,,,,306,306,306,306,306", "306,306,,,306,,,,,,306,306,,306,306,306,,306,306,306,306,306,,306,306", "306,,306,306,,306,306,,,,,,,,,,,,,,,,,,,,,306,,,306,,,306,,,306,,306", ",,,306,,,,,,,,306,,,,,306,306,306,306,306,306,,,,306,306,,,,,,,306,", ",306,,,306,306,511,511,511,,511,,,,511,511,,,,511,,511,511,511,511,511", "511,511,,,,,,511,511,511,511,511,511,511,,,511,,,,,,,511,,,511,511,", "511,511,511,511,511,,511,511,511,,511,511,,489,,,,,,,489,489,489,,,489", "489,489,,489,,,,,,511,,,511,489,,511,,,511,,,,,489,489,,489,489,489", "489,489,,,,,,,511,511,511,511,511,511,,,,511,511,,,,,,,511,631,,511", ",,511,511,631,631,631,489,,631,631,631,,631,489,,,,,489,489,,631,631", "631,,,,,,,,,631,631,,631,631,631,631,631,489,,,,,,,,,,,,,489,,489,,", "489,,,,,631,631,631,631,631,631,631,631,631,631,631,631,631,631,,,631", "631,631,,631,631,,,631,,,631,,631,,631,,631,,631,631,631,631,631,631", "631,,631,631,631,,,,,,,,,,,,,631,631,631,631,432,631,,,631,,631,432", "432,432,,,,432,432,,432,,,,,,,,,432,,,,,,,,,,,432,432,,432,432,432,432", "432,,,,,,,,,,,,,,,,,,,,,,,,432,432,432,432,432,432,432,432,432,432,432", "432,432,432,,,432,432,432,,432,,,,432,,,,,,,432,,432,,432,432,432,432", "432,432,432,,432,432,432,,,,,,,,,,,,,432,432,,432,87,432,,,432,,432", "87,87,87,,,87,87,87,,87,,,,,,,,87,,87,87,87,,,,,,,,87,87,,87,87,87,87", "87,,,,,,,,,,,,,,,,,,,,,,,,87,87,87,87,87,87,87,87,87,87,87,87,87,87", ",,87,87,87,,87,87,,,87,,,87,,87,,87,,87,,87,87,87,87,87,87,87,,87,,87", ",,,,,,,,,,,,87,87,87,87,434,87,,87,87,,87,434,434,434,,,,434,434,,434", ",,,,,,,,,,,,,,,,,,,434,434,,434,434,434,434,434,,,,,,,,,,,,,,,,,,,,", ",,,434,434,434,434,434,434,434,434,434,434,434,434,434,434,,,434,434", "434,,434,,,,434,,,,,,,434,,434,,434,434,434,434,434,434,434,,434,,434", ",,,,,,,,,,,,434,434,,434,632,434,,,434,,434,632,632,632,,,632,632,632", ",632,,,,,,,,,,632,632,,,,,,,,,632,632,,632,632,632,632,632,,,,,,,,,", ",,,,,,,,,,,,,,632,632,632,632,632,632,632,632,632,632,632,632,632,632", ",,632,632,632,,632,632,,,632,,,632,,632,,632,,632,,632,632,632,632,632", "632,632,,632,,632,,,,,,,,,,,,,632,632,632,632,84,632,,,632,,632,84,84", "84,,,84,84,84,,84,,,,,,,,84,,84,84,84,,,,,,,,84,84,,84,84,84,84,84,", ",,,,,,,,,,,,,,,,,,,,,,84,84,84,84,84,84,84,84,84,84,84,84,84,84,,,84", "84,84,,84,84,,,84,,,84,,84,,84,,84,,84,84,84,84,84,84,84,,84,,84,,,", ",,,,,,,,,84,84,84,84,437,84,,84,84,,84,437,437,437,,,437,437,437,,437", ",,,,,,,,437,437,437,437,,,,,,,,437,437,,437,437,437,437,437,,,,,,,,", ",,,,,,,,,,,,,,,437,437,437,437,437,437,437,437,437,437,437,437,437,437", ",,437,437,437,,,437,,,437,,,437,,437,,437,,437,,437,437,437,437,437", "437,437,,437,437,437,,,,,,,,,,,,,437,437,437,437,50,437,,437,437,,,50", "50,50,,,50,50,50,,50,,,,,,,,,,50,50,50,,,,,,,,50,50,,50,50,50,50,50", ",,,,,,,,,,,,,,,,,,,,,,,50,50,50,50,50,50,50,50,50,50,50,50,50,50,,,50", "50,50,,,50,,,50,,,50,,50,,50,,50,,50,50,50,50,50,50,50,,50,,50,,,,,", ",,,,,,,50,50,50,50,436,50,,50,50,,,436,436,436,,,436,436,436,,436,,", ",,,,,,436,436,436,436,,,,,,,,436,436,,436,436,436,436,436,,,,,,,,,,", ",,,,,,,,,,,,,436,436,436,436,436,436,436,436,436,436,436,436,436,436", ",,436,436,436,,,436,,,436,,,436,,436,,436,,436,,436,436,436,436,436", "436,436,,436,436,436,,,,,,,,,,,,,436,436,436,436,28,436,,436,436,,,28", "28,28,,,28,28,28,,28,,,,,,,,,,28,28,,,,,,,,,28,28,,28,28,28,28,28,,", ",,,,,,,,,,,,,,,,,,,,,28,28,28,28,28,28,28,28,28,28,28,28,28,28,,,28", "28,28,,,28,,28,28,,,28,,28,,28,,28,,28,28,28,28,28,28,28,,28,,28,,,", ",,,,,,,,,28,28,28,28,27,28,,,28,,,27,27,27,,,27,27,27,,27,,,,,,,,,27", "27,27,,,,,,,,,27,27,,27,27,27,27,27,,,,,,,,,,,,,,,,,,,,,,,,27,27,27", "27,27,27,27,27,27,27,27,27,27,27,,,27,27,27,,,27,,27,27,,,27,,27,,27", ",27,,27,27,27,27,27,27,27,,27,27,27,,,,,,,,,,,,,27,27,27,27,428,27,", ",27,,,428,428,428,,,428,428,428,,428,,,,,,,,,428,428,428,,,,,,,,,428", "428,,428,428,428,428,428,,,,,,,,,,,,,,,,,,,,,,,,428,428,428,428,428", "428,428,428,428,428,428,428,428,428,,,428,428,428,,,428,,428,428,,,428", ",428,,428,,428,,428,428,428,428,428,428,428,,428,428,428,,,,,,,,,,,", ",428,428,428,428,486,428,,,428,,,486,486,486,,,486,486,486,,486,,,,", ",,,,,486,,,,,,,,,,486,486,,486,486,486,486,486,,,,,,575,575,,,575,,", ",,,,,,575,575,,575,575,575,575,575,575,575,,,575,575,,,486,575,575,575", "575,,,486,,,575,,486,486,,,,575,575,,575,575,575,575,575,575,575,575", "575,575,575,,,575,486,,,,,,,,,,,,,486,,486,,,486,8,8,8,8,8,8,8,8,8,8", "8,8,8,8,8,8,8,8,8,8,8,8,8,8,,,,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8", "8,8,,8,8,,,8,,,,,,,,,8,8,,8,8,8,8,8,8,8,,,8,8,,,,8,8,8,8,,,,,,,,,,,", ",8,8,,8,8,8,8,8,8,8,8,8,8,8,,,8,8,,,,,,,,,,8,7,7,7,7,7,7,7,7,7,7,7,7", "7,7,7,7,7,7,7,7,7,7,7,7,,,,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7", ",7,7,7,,7,,,,,,,,,7,7,,7,7,7,7,7,7,7,,,7,7,,,,7,7,7,7,,,,,,,,,,,,,7", "7,,7,7,7,7,7,7,7,7,7,7,7,,,7,7,,,,,,,,,,7,412,412,412,412,412,412,412", "412,412,412,412,412,412,412,412,412,412,412,412,412,412,412,412,412", ",,,412,412,412,412,412,412,412,412,412,412,412,412,412,412,412,412,412", "412,412,412,412,,412,412,,,412,,,,,,,,,412,412,,412,412,412,412,412", "412,412,,,412,412,,,,412,412,412,412,,,,,,,,,,,,,412,412,,412,412,412", "412,412,412,412,412,412,412,412,,,412,412,,,,,,,,,,412,408,408,408,408", "408,408,408,408,408,408,408,408,408,408,408,408,408,408,408,408,408", "408,408,408,,,,408,408,408,408,408,408,408,408,408,408,408,408,408,408", "408,408,408,408,408,408,408,,408,408,,,408,,,,,,,,,408,408,,408,408", "408,408,408,408,408,,,408,408,,,,408,408,408,408,,,,,,,,,,,,,408,408", ",408,408,408,408,408,408,408,408,408,408,408,,,408,408,,,,,,,,,,408", "740,740,740,740,740,740,740,740,740,740,740,740,740,740,740,740,740", "740,740,740,740,740,740,740,,,,740,740,740,740,740,740,740,740,740,740", "740,740,740,740,740,740,740,740,740,740,740,,740,740,,,740,,,,,,,,,740", "740,,740,740,740,740,740,740,740,,,740,740,,,,740,740,740,740,,,,,,", ",,,,,,740,740,,740,740,740,740,740,740,740,740,740,740,740,,,740,192", "192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192", "192,192,192,192,192,192,,,,192,192,192,192,192,192,192,192,192,192,192", "192,192,192,192,192,192,192,192,192,192,,192,192,192,192,192,,192,,", ",,,,192,192,,192,192,192,192,192,192,192,,,192,192,,,,192,192,192,192", ",,,,,,,,,,,,192,192,,192,192,192,192,192,192,192,192,192,192,192,,,192", "65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65", "65,,,,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65", ",65,65,65,65,65,,65,,,,,,,65,65,,65,65,65,65,65,65,65,,,65,65,,,,65", "65,65,65,,,,,,65,,,,,,,65,65,,65,65,65,65,65,65,65,65,65,65,65,,,65", "79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79", "79,,,,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79,79", ",79,79,79,79,79,,79,,,,,,,79,79,,79,79,79,79,79,79,79,,,79,79,,,,79", "79,79,79,,,,,,,,,,,,,79,79,,79,79,79,79,79,79,79,79,79,79,79,201,201", "79,,201,,,,,,,,,201,201,,201,201,201,201,201,201,201,,,201,201,,,,201", "201,201,201,,,,,,,,,,,,,201,201,,201,201,201,201,201,201,201,201,201", "201,201,514,514,201,,514,,,,,,,,,514,514,,514,514,514,514,514,514,514", ",,514,514,,,,514,514,514,514,,,,,,514,,,,,,,514,514,,514,514,514,514", "514,514,514,514,514,514,514,200,200,514,,200,,,,,,,,,200,200,,200,200", "200,200,200,200,200,,,200,200,,,,200,200,200,200,,,,,,200,,,,,,,200", "200,,200,200,200,200,200,200,200,200,200,200,200,515,515,200,,515,,", ",,,,,,515,515,,515,515,515,515,515,515,515,,,515,515,,,,515,515,515", "515,,,,,,,,,,,,,515,515,,515,515,515,515,515,515,515,515,515,515,515", "908,908,515,,908,,,,,,,,,908,908,,908,908,908,908,908,908,908,,,908", "908,,,,908,908,908,908,,,,,,,,,,,,,908,908,,908,908,908,908,908,908", "908,908,908,908,908,583,583,908,,583,,,,,,,,,583,583,,583,583,583,583", "583,583,583,,,583,583,,,,583,583,583,583,,,,,,583,,,,,,,583,583,,583", "583,583,583,583,583,583,583,583,583,583,796,796,583,,796,,,,,,,,,796", "796,,796,796,796,796,796,796,796,,,796,796,,,,796,796,796,796,,,,,,", ",,,,,,796,796,,796,796,796,796,796,796,796,796,796,796,796,526,526,796", ",526,,,,,,,,,526,526,,526,526,526,526,526,526,526,,,526,526,,,,526,526", "526,526,,,,,,,,,,,,,526,526,,526,526,526,526,526,526,526,526,526,526", "526,262,262,526,,262,,,,,,,,,262,262,,262,262,262,262,262,262,262,,", "262,262,,,,262,262,262,262,,,,,,,,,,,,,262,262,,262,262,262,262,262", "262,262,262,262,262,262,907,907,262,,907,,,,,,,,,907,907,,907,907,907", "907,907,907,907,,,907,907,,,,907,907,907,907,,,,,,907,,,,,,,907,907", ",907,907,907,907,907,907,907,907,907,907,907,442,442,907,,442,,,,,,", ",,442,442,,442,442,442,442,442,442,442,,,442,442,,,,442,442,442,442", ",,,,,442,,,,,,,442,442,,442,442,442,442,442,442,442,442,442,442,442", "443,443,442,,443,,,,,,,,,443,443,,443,443,443,443,443,443,443,,,443", "443,,,,443,443,443,443,,,,,,,,,,,,,443,443,,443,443,443,443,443,443", "443,443,443,443,443,263,263,443,,263,,,,,,,,,263,263,,263,263,263,263", "263,263,263,,,263,263,,,,263,263,263,263,,,,,,,,,,,,,263,263,,263,263", "263,263,263,263,263,263,263,263,263,655,655,263,,655,,,,,,,,,655,655", ",655,655,655,655,655,655,655,,,655,655,,,,655,655,655,655,,,,,,,,,,", ",,655,655,,655,655,655,655,655,655,655,655,655,655,655,656,656,655,", "656,,,,,,,,,656,656,,656,656,656,656,656,656,656,,,656,656,,,,656,656", "656,656,,,,,,,,,,,,,656,656,,656,656,656,656,656,656,656,656,656,656", "656,576,576,656,,576,,,,,,,,,576,576,,576,576,576,576,576,576,576,,", "576,576,,,,576,576,576,576,,,,,,,,,,,,,576,576,,576,576,576,576,576", "576,576,576,576,576,576,581,581,576,,581,,,,,,,,,581,581,,581,581,581", "581,581,581,581,,,581,581,,,,581,581,581,581,,,,,,,,,,,,,581,581,,581", "581,581,581,581,581,581,581,581,581,581,525,525,581,,525,,,,,,,,,525", "525,,525,525,525,525,525,525,525,,,525,525,,,,525,525,525,525,,,,,,525", ",,,,,,525,525,,525,525,525,525,525,525,525,525,525,525,525,,,525"];

      racc_action_check = arr = Opal.get('Array').$new(24653, nil);

      idx = 0;

      ($a = ($c = clist).$each, $a.$$p = (TMP_3 = function(str){var self = TMP_3.$$s || this, $a, $b, TMP_4;
if (str == null) str = nil;
      return ($a = ($b = str.$split(",", -1)).$each, $a.$$p = (TMP_4 = function(i){var self = TMP_4.$$s || this, $a;
if (i == null) i = nil;
        if ((($a = i['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            arr['$[]='](idx, i.$to_i())
          };
          return idx = idx['$+'](1);}, TMP_4.$$s = self, TMP_4), $a).call($b)}, TMP_3.$$s = self, TMP_3), $a).call($c);

      racc_action_pointer = [-2, 1131, nil, 429, nil, 668, 1009, 22754, 22631, 995, 968, 967, 1014, 128, 318, 192, nil, 1916, 2053, 2190, 1052, nil, 2464, 2601, 2738, 338, 29, 22244, 22115, nil, 3423, 3560, 3697, nil, 942, 181, 1013, 30, 4382, 4519, 4656, 914, 275, nil, nil, nil, nil, nil, nil, nil, 21857, nil, 5204, 5341, 5478, 36, 6312, 5889, 6026, nil, nil, 6163, 6300, 6437, nil, 23347, nil, nil, nil, nil, nil, 120, nil, nil, nil, nil, nil, 888, 874, 23459, nil, nil, nil, 250, 21599, nil, nil, 21212, nil, nil, nil, nil, nil, nil, nil, nil, nil, 1000, nil, 7807, nil, nil, nil, 7944, 8081, 8218, 8355, 8492, 8629, nil, 447, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, 23235, 856, nil, 9177, 9314, 9451, 9588, 9725, 23639, 23519, 10136, 10273, 10410, nil, 507, 310, 907, -53, 820, 862, 11369, 11506, nil, nil, 11643, 855, 11917, 12054, 12191, 12328, 12465, 12602, 12739, 12876, 13013, 13150, 13287, 13424, 13561, 13698, 13835, 13972, 14109, 14246, 14383, 14520, 14657, 14794, 14931, 15068, 15205, 15342, nil, nil, nil, 2601, nil, 813, 803, nil, 15890, 825, 16164, nil, nil, nil, nil, 16301, nil, nil, 23999, 24239, 814, 16849, 16986, nil, nil, nil, nil, nil, nil, nil, 17123, 326, 531, 772, 17671, 766, 765, 708, 18219, 18356, 412, 300, 772, 185, 735, 694, -11, nil, 728, 185, nil, 19726, nil, 595, 743, 737, 453, nil, 712, nil, 20548, nil, 20685, 34, nil, 652, 309, 509, 649, 621, 23, 583, nil, nil, -21, 6997, nil, nil, nil, 514, 498, nil, 374, 297, nil, nil, nil, nil, nil, nil, nil, 2753, nil, nil, nil, 311, nil, nil, 287, 399, 84, 0, 19041, 18904, 457, 757, 33, 14, 199, -18, -2, 1021, nil, nil, -2, 121, nil, 418, nil, 73, nil, nil, 18082, 581, 505, 475, 477, 610, 444, 456, 287, nil, 203, nil, 15479, nil, 262, nil, 255, nil, 236, 536, 135, nil, 597, 38, nil, 219, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, 662, 23000, nil, nil, nil, 22877, 664, nil, nil, 409, nil, 10821, 652, nil, 680, nil, nil, 1779, 722, 264, 633, 22373, nil, nil, nil, 21083, 776, 21341, nil, 21986, 21728, nil, 2464, nil, nil, 24119, 24179, 7396, 320, 7259, 7122, 6848, 277, nil, 4108, 5204, 984, 850, 835, 865, 866, 889, 5478, 5341, 2761, 4245, 5067, 4930, 4793, 4519, 3286, 3423, 3834, 3971, 3012, 1169, 1032, 4656, 4382, 820, -27, nil, 957, nil, 820, nil, 683, nil, nil, 22502, nil, nil, 20886, 0, nil, 962, 959, 123, 957, 1063, nil, nil, 135, -40, 130, 1042, nil, nil, 15753, 1031, 993, nil, nil, 979, 20822, 1001, 272, 23579, 23699, 387, 988, nil, nil, 941, nil, 409, 546, 1094, 24539, 23939, 2327, 1231, 1043, 1029, 944, nil, nil, 1505, nil, nil, 2190, nil, nil, nil, nil, 2875, 3012, 910, nil, 576, nil, nil, 3149, 3709, nil, 568, nil, nil, 894, nil, 2861, nil, 853, 1354, nil, nil, 3286, 961, nil, nil, 3834, 135, 47, 955, 961, 3971, nil, 4930, 22500, 24419, 53, nil, 315, nil, 24479, 5067, 23819, nil, nil, 5615, 292, 6574, nil, 3572, nil, nil, nil, 66, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, -35, nil, nil, nil, 769, nil, nil, nil, nil, nil, 7533, 736, 8903, 594, 9040, 9862, 716, nil, nil, nil, 9999, 686, nil, 10547, 98, 14, 20954, 21470, 676, 546, nil, 11095, nil, 3161, nil, 16438, 460, nil, 470, 16575, nil, nil, nil, nil, nil, nil, 16712, nil, 359, 313, 24299, 24359, 17397, 683, 139, nil, nil, 125, 18493, 18630, nil, 805, -50, 18767, -62, nil, -14, 217, 207, 92, 43, 265, 207, 19178, 1231, 304, 313, -26, 407, 19315, nil, nil, 468, 347, 460, nil, nil, 340, nil, 363, 316, 453, 393, 402, nil, nil, 445, 2724, nil, 751, nil, 592, nil, nil, nil, nil, nil, 603, nil, 619, 19863, 545, 34, 15, 16, -18, 20137, 409, nil, 656, 655, 20274, 414, nil, 249, 10958, 20411, 18231, -61, 666, 667, 668, nil, 668, nil, 23123, 714, 775, 20000, nil, nil, nil, 1094, 687, 19589, 19452, nil, 1368, nil, 1916, nil, nil, 2053, nil, 957, 17945, 17808, 17534, 213, 1505, nil, 759, 861, nil, nil, 768, nil, nil, 793, 796, 614, 874, 17260, nil, 793, 898, 780, 281, nil, nil, 903, nil, 16027, 786, 828, nil, nil, nil, nil, nil, nil, 23879, nil, 627, nil, nil, nil, nil, 1491, 931, nil, 15616, 933, 11780, 11232, nil, nil, 112, 0, 219, nil, 955, nil, nil, 956, 957, 844, nil, 18094, nil, 762, nil, nil, 597, 10684, nil, nil, nil, nil, nil, nil, nil, 870, 855, nil, 1642, 8766, nil, nil, nil, 902, 866, nil, nil, nil, 7670, nil, nil, 93, 6985, nil, 914, 879, nil, nil, 77, nil, 1011, 1014, 6711, 5752, nil, nil, 4793, nil, nil, 951, 916, -102, nil, 919, 913, nil, nil, 6449, nil, nil, nil, 4245, nil, 4108, 269, 186, 1022, 147, nil, nil, 2327, nil, nil, nil, 629, 1779, 1080, nil, 899, nil, nil, nil, 1642, 1086, 1368, 24059, 23759, 285, 677, nil, nil, nil, 1099, nil, 982, 1109, nil, 1025, -7, 92, 85, 546, nil, nil, nil, nil, 524];

      racc_action_default = [-3, -528, -1, -516, -4, -6, -528, -528, -528, -528, -528, -528, -528, -528, -268, -36, -37, -528, -528, -42, -44, -45, -279, -317, -318, -49, -246, -246, -246, -61, -10, -65, -72, -74, -528, -445, -528, -528, -528, -528, -528, -518, -226, -261, -262, -263, -264, -265, -266, -267, -506, -270, -528, -527, -498, -287, -527, -528, -528, -292, -295, -516, -528, -528, -309, -528, -319, -320, -388, -389, -390, -391, -392, -527, -395, -527, -527, -527, -527, -527, -422, -428, -429, -528, -504, -435, -436, -505, -438, -439, -440, -441, -442, -443, -444, -447, -448, -528, -2, -517, -523, -524, -525, -528, -528, -528, -528, -528, -3, -13, -528, -100, -101, -102, -103, -104, -105, -106, -109, -110, -111, -112, -113, -114, -115, -116, -117, -118, -119, -120, -121, -122, -123, -124, -125, -126, -127, -128, -129, -130, -131, -132, -133, -134, -135, -136, -137, -138, -139, -140, -141, -142, -143, -144, -145, -146, -147, -148, -149, -150, -151, -152, -153, -154, -155, -156, -157, -158, -159, -160, -161, -162, -163, -164, -165, -166, -167, -168, -169, -170, -171, -172, -173, -174, -175, -176, -177, -178, -179, -180, -181, -182, -528, -18, -107, -10, -528, -528, -528, -527, -528, -528, -528, -528, -528, -40, -528, -445, -528, -268, -528, -528, -10, -528, -41, -218, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -528, -359, -361, -46, -227, -239, -253, -253, -243, -528, -254, -528, -279, -317, -318, -500, -528, -47, -48, -528, -528, -53, -527, -528, -286, -364, -371, -373, -59, -369, -60, -528, -516, -11, -61, -10, -528, -528, -66, -69, -10, -80, -528, -528, -87, -282, -518, -528, -321, -370, -528, -71, -528, -76, -275, -430, -431, -528, -203, -204, -219, -528, -519, -10, -518, -228, -518, -520, -520, -528, -528, -520, -528, -288, -289, -528, -528, -332, -333, -340, -527, -464, -347, -527, -527, -358, -463, -465, -466, -467, -468, -469, -528, -482, -487, -488, -490, -491, -492, -528, -43, -528, -528, -528, -528, -516, -528, -517, -445, -528, -528, -268, -528, -471, -472, -96, -528, -98, -528, -268, -528, -306, -445, -528, -100, -101, -138, -139, -155, -160, -167, -170, -312, -528, -496, -528, -393, -528, -408, -528, -410, -528, -528, -528, -400, -528, -528, -406, -528, -421, -423, -424, -425, -426, -432, -433, 929, -5, -526, -19, -20, -21, -22, -23, -528, -528, -15, -16, -17, -528, -528, -25, -33, -183, -254, -528, -528, -26, -34, -35, -27, -185, -528, -507, -508, -246, -366, -509, -510, -507, -246, -508, -368, -509, -510, -32, -192, -38, -39, -528, -528, -527, -275, -528, -528, -528, -528, -285, -193, -194, -195, -196, -197, -198, -199, -200, -205, -206, -207, -208, -209, -210, -211, -212, -213, -214, -215, -216, -217, -220, -221, -222, -223, -528, -527, -240, -528, -241, -528, -251, -528, -255, -503, -246, -507, -508, -246, -527, -54, -528, -518, -518, -253, -239, -247, -248, -528, -527, -527, -528, -281, -9, -517, -528, -62, -273, -77, -67, -528, -528, -527, -528, -528, -86, -528, -430, -431, -73, -78, -528, -528, -528, -528, -528, -224, -528, -380, -528, -528, -229, -230, -522, -521, -232, -522, -277, -278, -499, -329, -10, -10, -528, -331, -528, -349, -356, -528, -353, -354, -528, -357, -464, -528, -473, -528, -475, -477, -481, -489, -493, -10, -322, -323, -324, -10, -528, -528, -528, -528, -10, -375, -527, -528, -528, -275, -301, -96, -97, -528, -527, -528, -304, -449, -528, -528, -528, -310, -462, -314, -514, -515, -518, -394, -409, -412, -413, -415, -396, -411, -397, -398, -399, -528, -402, -404, -405, -528, -427, -7, -14, -108, -24, -528, -260, -528, -276, -528, -528, -55, -237, -238, -365, -528, -57, -367, -528, -507, -508, -507, -508, -528, -183, -284, -528, -343, -528, -345, -10, -253, -252, -256, -528, -501, -502, -50, -362, -51, -363, -10, -233, -528, -528, -528, -528, -528, -42, -528, -245, -249, -528, -10, -10, -280, -12, -62, -528, -70, -75, -528, -507, -508, -527, -511, -85, -528, -528, -191, -201, -202, -528, -527, -527, -271, -272, -520, -528, -528, -330, -341, -528, -348, -527, -342, -528, -527, -527, -483, -470, -528, -528, -480, -527, -325, -527, -293, -326, -327, -328, -296, -528, -299, -528, -528, -528, -507, -508, -511, -274, -528, -96, -99, -511, -528, -10, -528, -451, -528, -10, -10, -462, -528, -495, -495, -495, -461, -464, -485, -528, -528, -528, -10, -401, -403, -407, -184, -258, -528, -528, -29, -187, -30, -188, -56, -31, -189, -58, -190, -528, -528, -528, -276, -225, -344, -528, -528, -242, -257, -528, -234, -235, -527, -527, -518, -528, -528, -250, -528, -528, -68, -81, -79, -283, -527, -338, -10, -381, -527, -382, -383, -231, -334, -335, -355, -528, -275, -528, -351, -352, -474, -476, -479, -528, -336, -528, -528, -10, -10, -298, -300, -528, -276, -528, -276, -528, -450, -307, -528, -528, -518, -453, -528, -457, -528, -459, -460, -528, -528, -315, -497, -414, -417, -418, -419, -420, -528, -259, -28, -186, -528, -346, -360, -52, -528, -253, -372, -374, -8, -10, -387, -339, -528, -528, -385, -274, -527, -478, -290, -528, -291, -528, -528, -528, -10, -302, -305, -10, -311, -313, -528, -495, -495, -494, -495, -528, -486, -484, -462, -416, -236, -244, -528, -386, -10, -88, -528, -528, -95, -384, -350, -10, -294, -297, -256, -527, -10, -528, -452, -528, -455, -456, -458, -10, -380, -527, -528, -528, -94, -527, -376, -377, -378, -528, -308, -495, -528, -379, -528, -507, -508, -511, -93, -337, -303, -454, -316, -89];

      clist = ["13,214,5,480,312,281,248,248,248,530,328,375,548,494,571,551,553,206", "206,249,249,249,206,206,206,393,12,683,320,102,13,285,285,99,428,433", "491,309,291,291,114,114,415,422,563,567,533,536,109,194,540,520,206", "206,117,117,12,206,206,556,699,206,352,361,363,642,98,642,304,291,291", "344,345,734,596,348,731,294,580,785,606,264,271,273,804,660,555,102", "691,648,877,737,650,707,711,645,486,489,114,13,2,5,807,206,206,206,206", "13,13,406,5,662,114,306,346,808,347,402,403,404,405,809,640,721,349", "12,897,250,250,250,726,588,868,12,12,651,366,277,393,730,382,384,590", "279,391,663,664,740,879,318,425,645,541,355,697,824,826,827,317,314", "280,316,313,694,377,877,497,698,591,477,500,501,911,715,789,853,379", "380,584,414,420,423,386,309,605,438,376,246,260,261,389,832,742,419", "419,13,206,206,206,206,743,821,206,206,206,872,408,736,407,357,193,849", "13,206,802,734,268,272,400,1,,12,,10,,114,,,,,,,,737,437,712,,,12,,", ",,642,,,,,,496,248,,,10,,,35,,248,,,,495,249,,206,206,669,,521,,249", ",328,206,,428,433,13,,,556,285,13,703,356,35,284,284,291,924,544,912", "901,902,285,903,,,745,723,102,291,,12,505,13,,701,12,,,,,,,517,,351", "365,,365,10,,874,413,874,510,,874,10,10,12,699,531,,532,926,504,866", "691,,280,,,,206,206,674,736,,,,,,35,,,,674,568,569,734,35,35,904,361", "589,,,250,250,,291,102,,648,650,206,250,737,,,795,,277,799,800,,585", "277,506,,755,768,633,512,,758,,,874,,918,,775,,,280,674,,570,,280,,857", "14,674,10,,,,,792,781,,556,,309,816,493,498,,819,820,10,,,,502,873,114", "875,,206,114,14,287,287,612,,35,,613,,117,,,,117,,,,,671,,,,35,642,", ",,,,,437,,354,362,268,,272,621,,521,,,626,773,774,,,,,,736,309,,206", ",10,,,,13,10,666,,,,285,865,206,,14,,916,291,,653,654,,14,14,716,,858", "206,10,790,12,,725,35,,,,284,35,,647,13,13,649,,891,,437,695,,284,,885", ",,291,,309,437,892,913,35,13,,,309,13,12,12,,898,13,,206,,,,,,,,206", ",641,,206,,206,12,,,328,12,708,708,,,12,882,727,,751,753,,,,917,756", "437,766,14,,728,437,,,,623,206,206,741,365,627,,206,,,14,,,,,,,,,,,687", "13,776,521,,,,,,,,,13,783,,,,,206,,,,,,13,13,,12,,285,,,,688,689,,291", "623,12,285,623,,419,,,,291,830,,,12,12,,,704,14,,,706,287,14,,,714,", ",,,,,,,287,812,,,,,,,,,206,14,,,,13,,10,,13,13,,839,,814,,,,,,674,,13", ",,,,,,206,,12,817,,818,12,12,,822,,35,641,,,10,10,284,,12,767,,,114", "846,,,,,,,770,362,,,,10,13,,,10,,,779,780,10,,,35,35,,,845,,,365,206", ",13,13,,,,12,,,,,,35,860,,,35,,,,,35,437,,,,,12,12,,,,,708,,,,,,,,871", ",13,,,,887,,,919,,,,291,,10,623,13,,627,13,,,,,837,10,,12,,,,,,,,,13", "10,10,,,309,12,13,,12,,35,13,,,,,,,13,,206,35,,,,12,,,,,,852,12,35,35", "14,,12,284,,,287,,,12,,,,284,,,,862,863,,437,,,,,,,,10,,,,10,10,,,,14", "14,,,,623,623,362,10,,,,,215,,,,247,247,247,,14,884,,35,14,,,35,35,14", ",,301,302,303,,896,,,,35,,,,,,,247,247,,,10,,,,,905,,,,,,,910,,,,,914", ",,,10,10,,,,,,,,,,,35,,,,,,,,,,,,,14,,,,,,,,35,35,,14,,,,,,10,,,,890", "321,14,14,,,,287,,,,10,,,10,,,287,381,,383,383,387,390,383,,,,,35,,10", ",886,,,,,10,,,,,10,35,,,35,,,10,,,,,,,,,,,,,,35,14,,,,14,14,35,416,247", "424,247,35,,439,,,836,14,35,,,,,,,,,215,,451,452,453,454,455,456,457", "458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474", "475,476,,,,,,,14,,247,,247,,,,,247,,,,,,247,247,,,,,14,14,,247,,,,,", ",,,,,,,,,,,,,,,,,,,,315,,,,527,,,,,,,,,14,,,,889,,,,,,,,,,,14,,,14,", ",492,,,,,205,,,,,,,,,14,,,,,,,14,,,,,14,,,,,,,14,,,,,,,307,,,,,343,343", ",,343,,,,,,,,,547,,,547,547,,,,,290,290,,,,,,290,290,290,,,,,,,,247", ",,,,,290,343,343,343,343,,,,290,290,,,,,,,,,417,421,247,,439,634,424", ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,247,,247,,247,,,,,,,,,,,,,,622,482,658", "484,,,,,485,,,,,,,,247,,,,,,,,,679,680,681,440,441,,,,,,,,247,449,,247", ",,,,,,,,637,,,,,,,,,622,,,622,637,,,,,,,,,,637,637,,,,247,,,,,,,,247", ",,,290,,290,290,290,290,290,290,290,290,290,290,290,290,290,290,290", "290,290,290,290,290,290,290,290,290,290,290,,747,,247,,752,754,,290", ",290,757,,,759,290,,,,,,,764,,,,,,,,247,,,,,,,,290,,,,,247,,,,,,,616", "290,,,343,343,,,,,290,,,,,,,,,,247,,,,,,,,,,,,,,,,594,,,,,,,,,,,,,,", "247,,,,,,,,,,643,,315,,646,,,,,,,290,,,,,,,622,,659,,,,247,840,,786", "791,,,,,,,752,754,757,547,,,547,547,,,,,,786,,786,,247,,,643,,,315,", ",,,290,,,,,,,,,,,,,,,,,,,,,,,,,,,,290,290,290,,,307,,,,,,,,247,,,,,", ",,,,,,840,622,622,,,,,,290,682,290,,290,851,,,,855,,,,,748,247,,,,,", ",,,,,,,,,,,290,,247,,,,,,,769,,290,290,290,,,,,,,,,643,290,,247,290", "343,,729,,,,,,,,,290,,,,,,,547,,,,788,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,", "417,,,,786,,,,,,,,,,,,,,786,,,,,,290,,290,,,,,,,,838,,,290,,,,,,,,290", ",,,,,,,290,,,,,,,,,417,,,,,,,,,,,,,,,290,,,,,343,,,,,290,,,,,,290,,", ",,,,,,,,,,,,,,,,,,878,,,,,,,,,,290,,,,,,,,,,,,,,,,,,,,,,,,,895,,,,,", ",,,290,,,,,,,,,343,895,290,290,290,,,,,,,,,,,,,,,290,,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,290,,,,,,,,,,,,290,,,,,,,,,,,,,290", ",,,,,,,,,290,,,,,,,,,,,,,,,,,,,290"];

      racc_goto_table = arr = Opal.get('Array').$new(2207, nil);

      idx = 0;

      ($a = ($d = clist).$each, $a.$$p = (TMP_5 = function(str){var self = TMP_5.$$s || this, $a, $b, TMP_6;
if (str == null) str = nil;
      return ($a = ($b = str.$split(",", -1)).$each, $a.$$p = (TMP_6 = function(i){var self = TMP_6.$$s || this, $a;
if (i == null) i = nil;
        if ((($a = i['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            arr['$[]='](idx, i.$to_i())
          };
          return idx = idx['$+'](1);}, TMP_6.$$s = self, TMP_6), $a).call($b)}, TMP_5.$$s = self, TMP_5), $a).call($d);

      clist = ["21,18,7,59,22,41,29,29,29,8,105,47,107,32,78,107,107,21,21,54,54,54", "21,21,21,47,20,10,102,81,21,21,21,6,33,33,35,29,52,52,48,48,24,24,75", "75,55,55,14,14,55,43,21,21,50,50,20,21,21,136,138,21,21,21,46,60,4,60", "51,52,52,16,16,108,127,16,82,42,45,11,127,34,34,34,76,60,139,81,104", "58,142,106,58,77,77,145,33,33,48,21,2,7,11,21,21,21,21,21,21,7,7,61", "48,85,86,87,88,16,16,16,16,89,36,90,4,20,91,56,56,56,92,93,94,20,20", "36,95,38,47,96,124,124,97,39,124,36,36,98,99,100,22,145,101,79,103,135", "135,135,74,56,9,72,71,109,70,142,62,109,84,111,113,114,115,116,117,118", "122,123,80,18,18,18,125,29,126,18,83,31,31,31,128,129,130,54,54,21,21", "21,21,21,131,133,21,21,21,134,27,109,2,19,15,12,21,21,140,108,57,57", "5,1,,20,,17,,48,,,,,,,,106,48,78,,,20,,,,,60,,,,,,29,29,,,17,,,44,,29", ",,,54,54,,21,21,43,,41,,54,,105,21,,33,33,21,,,136,21,21,136,17,44,44", "44,52,76,102,11,135,135,21,135,,,127,45,81,52,,20,6,21,,139,20,,,,,", ",51,,44,44,,44,17,,106,9,106,42,,106,17,17,20,138,51,,51,135,4,77,104", ",9,,,,21,21,33,109,,,,,,44,,,,33,16,16,108,44,44,82,21,46,,,56,56,,52", "81,,58,58,21,56,106,,,107,,38,107,107,,81,38,39,,35,59,22,39,,35,,,106", ",10,,32,,,9,33,,4,,9,,109,23,33,17,,,,,55,43,,136,,29,8,31,31,,8,8,17", ",,,31,109,48,109,,21,48,23,23,23,14,,44,,14,,50,,,,50,,,,,22,,,,44,60", ",,,,,,48,,23,23,57,,57,34,,41,,,34,33,33,,,,,,109,29,,21,,17,,,,21,17", "7,,,,21,75,21,,23,,109,52,,51,51,,23,23,22,,136,21,17,24,20,,22,44,", ",,44,44,,34,21,21,34,,107,,48,21,,44,,75,,,52,,29,48,75,78,44,21,,,29", "21,20,20,,8,21,,21,,,,,,,,21,,56,,21,,21,20,,,105,20,81,81,,,20,59,16", ",18,18,,,,8,18,48,102,23,,81,48,,,,57,21,21,51,44,57,,21,,,23,,,,,,", ",,,,56,21,29,41,,,,,,,,,21,41,,,,,21,,,,,,21,21,,20,,21,,,,9,9,,52,57", "20,21,57,,54,,,,52,47,,,20,20,,,9,23,,,9,23,23,,,9,,,,,,,,,23,54,,,", ",,,,,21,23,,,,21,,17,,21,21,,18,,16,,,,,,33,,21,,,,,,,21,,20,81,,81", "20,20,,81,,44,56,,,17,17,44,,20,9,,,48,54,,,,,,,9,23,,,,17,21,,,17,", ",9,9,17,,,44,44,,,51,,,44,21,,21,21,,,,20,,,,,,44,16,,,44,,,,,44,48", ",,,,20,20,,,,,81,,,,,,,,51,,21,,,,21,,,22,,,,52,,17,57,21,,57,21,,,", ",9,17,,20,,,,,,,,,21,17,17,,,29,20,21,,20,,44,21,,,,,,,21,,21,44,,,", "20,,,,,,9,20,44,44,23,,20,44,,,23,,,20,,,,44,,,,9,9,,48,,,,,,,,17,,", ",17,17,,,,23,23,,,,57,57,23,17,,,,,28,,,,28,28,28,,23,9,,44,23,,,44", "44,23,,,28,28,28,,9,,,,44,,,,,,,28,28,,,17,,,,,9,,,,,,,9,,,,,9,,,,17", "17,,,,,,,,,,,44,,,,,,,,,,,,,23,,,,,,,,44,44,,23,,,,,,17,,,,17,53,23", "23,,,,23,,,,17,,,17,,,23,53,,53,53,53,53,53,,,,,44,,17,,44,,,,,17,,", ",,17,44,,,44,,,17,,,,,,,,,,,,,,44,23,,,,23,23,44,28,28,28,28,44,,28", ",,23,23,44,,,,,,,,,28,,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28", "28,28,28,28,28,28,28,28,28,28,28,,,,,,,23,,28,,28,,,,,28,,,,,,28,28", ",,,,23,23,,28,,,,,,,,,,,,,,,,,,,,,,,,,,25,,,,28,,,,,,,,,23,,,,23,,,", ",,,,,,,23,,,23,,,53,,,,,26,,,,,,,,,23,,,,,,,23,,,,,23,,,,,,,23,,,,,", ",26,,,,,26,26,,,26,,,,,,,,,53,,,53,53,,,,,37,37,,,,,,37,37,37,,,,,,", ",28,,,,,,37,26,26,26,26,,,,37,37,,,,,,,,,25,25,28,,28,28,28,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,,,28,,28,,28,,,,,,,,,,,,,,53,25,28,25,,,,,25,,,", ",,,,28,,,,,,,,,28,28,28,26,26,,,,,,,,28,26,,28,,,,,,,,,53,,,,,,,,,53", ",,53,53,,,,,,,,,,53,53,,,,28,,,,,,,,28,,,,37,,37,37,37,37,37,37,37,37", "37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,,28,,28,,28,28", ",37,,37,28,,,28,37,,,,,,,28,,,,,,,,28,,,,,,,,37,,,,,28,,,,,,,25,37,", ",26,26,,,,,37,,,,,,,,,,28,,,,,,,,,,,,,,,,26,,,,,,,,,,,,,,,28,,,,,,,", ",,25,,25,,25,,,,,,,37,,,,,,,53,,25,,,,28,28,,53,53,,,,,,,28,28,28,53", ",,53,53,,,,,,53,,53,,28,,,25,,,25,,,,,37,,,,,,,,,,,,,,,,,,,,,,,,,,,", "37,37,37,,,26,,,,,,,,28,,,,,,,,,,,,28,53,53,,,,,,37,26,37,,37,53,,,", "53,,,,,25,28,,,,,,,,,,,,,,,,,37,,28,,,,,,,25,,37,37,37,,,,,,,,,25,37", ",28,37,26,,26,,,,,,,,,37,,,,,,,53,,,,25,,,,,,,,,,,,,,,,,,,,,,,,,,,,", ",,25,,,,53,,,,,,,,,,,,,,53,,,,,,37,,37,,,,,,,,25,,,37,,,,,,,,37,,,,", ",,,37,,,,,,,,,25,,,,,,,,,,,,,,,37,,,,,26,,,,,37,,,,,,37,,,,,,,,,,,,", ",,,,,,,,25,,,,,,,,,,37,,,,,,,,,,,,,,,,,,,,,,,,,25,,,,,,,,,37,,,,,,,", ",26,25,37,37,37,,,,,,,,,,,,,,,37,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,37,,,,,,,,,,,,37,,,,,,,,,,,,,37,,,,,,,,,,37,,,,,,,,", ",,,,,,,,,,37"];

      racc_goto_check = arr = Opal.get('Array').$new(2207, nil);

      idx = 0;

      ($a = ($e = clist).$each, $a.$$p = (TMP_7 = function(str){var self = TMP_7.$$s || this, $a, $b, TMP_8;
if (str == null) str = nil;
      return ($a = ($b = str.$split(",", -1)).$each, $a.$$p = (TMP_8 = function(i){var self = TMP_8.$$s || this, $a;
if (i == null) i = nil;
        if ((($a = i['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            arr['$[]='](idx, i.$to_i())
          };
          return idx = idx['$+'](1);}, TMP_8.$$s = self, TMP_8), $a).call($b)}, TMP_7.$$s = self, TMP_7), $a).call($e);

      racc_goto_pointer = [nil, 219, 100, nil, 63, 119, 30, 2, -297, 130, -502, -604, -574, nil, 41, 202, 14, 223, -17, 147, 26, 0, -49, 416, -154, 1199, 1275, 97, 953, -16, nil, 165, -252, -166, 55, -228, -355, 1323, 107, 113, nil, -26, 45, -244, 256, -281, 1, -54, 33, nil, 47, 27, 7, 1022, -3, -264, 105, 190, -397, -247, -414, -388, -100, nil, nil, nil, nil, nil, nil, nil, 99, 108, 106, nil, 102, -300, -620, -475, -335, 91, -185, 26, -514, 121, -208, 62, 55, -592, 56, -590, -455, -740, -454, -233, -686, 72, -450, -233, -444, -682, 93, -166, -28, -396, -458, -46, -499, -311, -517, -383, nil, -75, nil, -99, -99, -724, -400, -510, -614, nil, nil, nil, 105, 104, 65, 105, -202, -306, 112, -551, -406, -399, nil, -531, -618, -579, -276, nil, -490, -249, -488, nil, -735, nil, nil, -386];

      racc_goto_default = [nil, nil, nil, 3, nil, 4, 350, 276, nil, 529, nil, 805, nil, 275, nil, nil, nil, 210, 16, 11, 211, 300, nil, 209, nil, 253, 15, nil, 19, 20, 21, nil, 25, 677, nil, nil, nil, 26, 29, nil, 31, 34, 33, nil, 207, 360, nil, 116, 431, 115, 69, nil, 42, 308, 310, nil, 311, 429, 624, 478, 251, nil, nil, 266, 43, 44, 45, 46, 47, 48, 49, nil, 267, 55, nil, nil, nil, nil, nil, nil, nil, 564, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, 323, 322, 693, 325, nil, 326, 327, 245, nil, 435, nil, nil, nil, nil, nil, nil, 68, 70, 71, 72, nil, nil, nil, nil, 601, nil, nil, nil, nil, 392, 733, 735, nil, 334, 329, 336, nil, 558, 559, 739, 339, 342, 258];

      racc_reduce_table = [0, 0, "racc_error", 1, 140, "_reduce_none", 2, 141, "_reduce_2", 0, 142, "_reduce_3", 1, 142, "_reduce_4", 3, 142, "_reduce_5", 1, 144, "_reduce_none", 4, 144, "_reduce_7", 4, 147, "_reduce_8", 2, 148, "_reduce_9", 0, 152, "_reduce_10", 1, 152, "_reduce_11", 3, 152, "_reduce_12", 0, 166, "_reduce_13", 4, 146, "_reduce_14", 3, 146, "_reduce_15", 3, 146, "_reduce_none", 3, 146, "_reduce_17", 2, 146, "_reduce_18", 3, 146, "_reduce_19", 3, 146, "_reduce_20", 3, 146, "_reduce_21", 3, 146, "_reduce_22", 3, 146, "_reduce_23", 4, 146, "_reduce_none", 3, 146, "_reduce_25", 3, 146, "_reduce_26", 3, 146, "_reduce_27", 6, 146, "_reduce_none", 5, 146, "_reduce_29", 5, 146, "_reduce_none", 5, 146, "_reduce_none", 3, 146, "_reduce_none", 3, 146, "_reduce_33", 3, 146, "_reduce_34", 3, 146, "_reduce_35", 1, 146, "_reduce_none", 1, 165, "_reduce_none", 3, 165, "_reduce_38", 3, 165, "_reduce_39", 2, 165, "_reduce_40", 2, 165, "_reduce_41", 1, 165, "_reduce_none", 1, 155, "_reduce_none", 1, 157, "_reduce_none", 1, 157, "_reduce_none", 2, 157, "_reduce_46", 2, 157, "_reduce_47", 2, 157, "_reduce_48", 1, 169, "_reduce_none", 4, 169, "_reduce_none", 4, 169, "_reduce_none", 4, 174, "_reduce_none", 2, 168, "_reduce_53", 3, 168, "_reduce_none", 4, 168, "_reduce_55", 5, 168, "_reduce_none", 4, 168, "_reduce_57", 5, 168, "_reduce_none", 2, 168, "_reduce_59", 2, 168, "_reduce_60", 1, 158, "_reduce_61", 3, 158, "_reduce_62", 1, 178, "_reduce_63", 3, 178, "_reduce_64", 1, 177, "_reduce_65", 2, 177, "_reduce_66", 3, 177, "_reduce_67", 5, 177, "_reduce_none", 2, 177, "_reduce_69", 4, 177, "_reduce_none", 2, 177, "_reduce_71", 1, 177, "_reduce_72", 3, 177, "_reduce_none", 1, 180, "_reduce_74", 3, 180, "_reduce_75", 2, 179, "_reduce_76", 3, 179, "_reduce_77", 1, 182, "_reduce_none", 3, 182, "_reduce_none", 1, 181, "_reduce_80", 4, 181, "_reduce_81", 3, 181, "_reduce_82", 3, 181, "_reduce_none", 3, 181, "_reduce_none", 3, 181, "_reduce_none", 2, 181, "_reduce_none", 1, 181, "_reduce_none", 1, 156, "_reduce_88", 4, 156, "_reduce_89", 3, 156, "_reduce_90", 3, 156, "_reduce_91", 3, 156, "_reduce_92", 3, 156, "_reduce_93", 2, 156, "_reduce_94", 1, 156, "_reduce_none", 1, 184, "_reduce_none", 2, 185, "_reduce_97", 1, 185, "_reduce_98", 3, 185, "_reduce_99", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_none", 1, 186, "_reduce_103", 1, 186, "_reduce_104", 1, 153, "_reduce_105", 1, 153, "_reduce_none", 1, 154, "_reduce_107", 3, 154, "_reduce_108", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 187, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 1, 188, "_reduce_none", 3, 167, "_reduce_183", 5, 167, "_reduce_184", 3, 167, "_reduce_185", 6, 167, "_reduce_186", 5, 167, "_reduce_187", 5, 167, "_reduce_none", 5, 167, "_reduce_none", 5, 167, "_reduce_none", 4, 167, "_reduce_none", 3, 167, "_reduce_none", 3, 167, "_reduce_193", 3, 167, "_reduce_194", 3, 167, "_reduce_195", 3, 167, "_reduce_196", 3, 167, "_reduce_197", 3, 167, "_reduce_198", 3, 167, "_reduce_199", 3, 167, "_reduce_200", 4, 167, "_reduce_201", 4, 167, "_reduce_202", 2, 167, "_reduce_203", 2, 167, "_reduce_204", 3, 167, "_reduce_205", 3, 167, "_reduce_206", 3, 167, "_reduce_207", 3, 167, "_reduce_208", 3, 167, "_reduce_209", 3, 167, "_reduce_210", 3, 167, "_reduce_211", 3, 167, "_reduce_212", 3, 167, "_reduce_213", 3, 167, "_reduce_214", 3, 167, "_reduce_215", 3, 167, "_reduce_216", 3, 167, "_reduce_217", 2, 167, "_reduce_218", 2, 167, "_reduce_219", 3, 167, "_reduce_220", 3, 167, "_reduce_221", 3, 167, "_reduce_222", 3, 167, "_reduce_223", 3, 167, "_reduce_224", 5, 167, "_reduce_225", 1, 167, "_reduce_none", 1, 164, "_reduce_none", 1, 161, "_reduce_228", 2, 161, "_reduce_229", 2, 161, "_reduce_230", 4, 161, "_reduce_231", 2, 161, "_reduce_232", 3, 196, "_reduce_233", 4, 196, "_reduce_234", 4, 196, "_reduce_none", 6, 196, "_reduce_none", 1, 197, "_reduce_237", 1, 197, "_reduce_none", 1, 170, "_reduce_239", 2, 170, "_reduce_240", 2, 170, "_reduce_241", 4, 170, "_reduce_242", 1, 170, "_reduce_243", 4, 200, "_reduce_none", 1, 200, "_reduce_none", 0, 202, "_reduce_246", 2, 173, "_reduce_247", 1, 201, "_reduce_none", 2, 201, "_reduce_249", 3, 201, "_reduce_250", 2, 199, "_reduce_251", 2, 198, "_reduce_252", 0, 198, "_reduce_253", 1, 193, "_reduce_254", 2, 193, "_reduce_255", 3, 193, "_reduce_256", 4, 193, "_reduce_257", 3, 163, "_reduce_258", 4, 163, "_reduce_259", 2, 163, "_reduce_260", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 1, 191, "_reduce_none", 0, 224, "_reduce_270", 4, 191, "_reduce_271", 4, 191, "_reduce_272", 3, 191, "_reduce_273", 3, 191, "_reduce_274", 2, 191, "_reduce_275", 4, 191, "_reduce_276", 3, 191, "_reduce_277", 3, 191, "_reduce_278", 1, 191, "_reduce_279", 4, 191, "_reduce_280", 3, 191, "_reduce_281", 1, 191, "_reduce_282", 5, 191, "_reduce_283", 4, 191, "_reduce_284", 3, 191, "_reduce_285", 2, 191, "_reduce_286", 1, 191, "_reduce_none", 2, 191, "_reduce_288", 2, 191, "_reduce_289", 6, 191, "_reduce_290", 6, 191, "_reduce_291", 0, 225, "_reduce_292", 0, 226, "_reduce_293", 7, 191, "_reduce_294", 0, 227, "_reduce_295", 0, 228, "_reduce_296", 7, 191, "_reduce_297", 5, 191, "_reduce_298", 4, 191, "_reduce_299", 5, 191, "_reduce_300", 0, 229, "_reduce_301", 0, 230, "_reduce_302", 9, 191, "_reduce_303", 0, 231, "_reduce_304", 6, 191, "_reduce_305", 0, 232, "_reduce_306", 0, 233, "_reduce_307", 8, 191, "_reduce_308", 0, 234, "_reduce_309", 0, 235, "_reduce_310", 6, 191, "_reduce_311", 0, 236, "_reduce_312", 6, 191, "_reduce_313", 0, 237, "_reduce_314", 0, 238, "_reduce_315", 9, 191, "_reduce_316", 1, 191, "_reduce_317", 1, 191, "_reduce_318", 1, 191, "_reduce_319", 1, 191, "_reduce_none", 1, 160, "_reduce_none", 1, 214, "_reduce_none", 1, 214, "_reduce_none", 1, 214, "_reduce_none", 2, 214, "_reduce_none", 1, 216, "_reduce_none", 1, 216, "_reduce_none", 1, 216, "_reduce_none", 2, 213, "_reduce_329", 3, 239, "_reduce_330", 2, 239, "_reduce_331", 1, 239, "_reduce_none", 1, 239, "_reduce_none", 3, 240, "_reduce_334", 3, 240, "_reduce_335", 1, 215, "_reduce_336", 5, 215, "_reduce_337", 1, 150, "_reduce_none", 2, 150, "_reduce_339", 1, 242, "_reduce_340", 3, 242, "_reduce_341", 3, 243, "_reduce_342", 1, 175, "_reduce_none", 2, 175, "_reduce_344", 1, 175, "_reduce_345", 3, 175, "_reduce_346", 1, 244, "_reduce_347", 2, 246, "_reduce_348", 1, 246, "_reduce_349", 6, 241, "_reduce_350", 4, 241, "_reduce_351", 4, 241, "_reduce_352", 2, 241, "_reduce_353", 2, 241, "_reduce_354", 4, 241, "_reduce_355", 2, 241, "_reduce_356", 2, 241, "_reduce_357", 1, 241, "_reduce_358", 0, 250, "_reduce_359", 5, 249, "_reduce_360", 2, 171, "_reduce_361", 4, 171, "_reduce_none", 4, 171, "_reduce_none", 2, 212, "_reduce_364", 4, 212, "_reduce_365", 3, 212, "_reduce_366", 4, 212, "_reduce_367", 3, 212, "_reduce_368", 2, 212, "_reduce_369", 1, 212, "_reduce_370", 0, 252, "_reduce_371", 5, 211, "_reduce_372", 0, 253, "_reduce_373", 5, 211, "_reduce_374", 0, 255, "_reduce_375", 6, 217, "_reduce_376", 1, 254, "_reduce_377", 1, 254, "_reduce_none", 6, 149, "_reduce_379", 0, 149, "_reduce_380", 1, 256, "_reduce_381", 1, 256, "_reduce_none", 1, 256, "_reduce_none", 2, 257, "_reduce_384", 1, 257, "_reduce_385", 2, 151, "_reduce_386", 1, 151, "_reduce_none", 1, 203, "_reduce_none", 1, 203, "_reduce_none", 1, 203, "_reduce_none", 1, 204, "_reduce_391", 1, 260, "_reduce_none", 2, 260, "_reduce_393", 3, 261, "_reduce_394", 1, 261, "_reduce_395", 3, 205, "_reduce_396", 3, 206, "_reduce_397", 3, 207, "_reduce_398", 3, 207, "_reduce_399", 1, 264, "_reduce_400", 3, 264, "_reduce_401", 1, 265, "_reduce_402", 2, 265, "_reduce_403", 3, 208, "_reduce_404", 3, 208, "_reduce_405", 1, 267, "_reduce_406", 3, 267, "_reduce_407", 1, 262, "_reduce_408", 2, 262, "_reduce_409", 1, 263, "_reduce_410", 2, 263, "_reduce_411", 1, 266, "_reduce_412", 0, 269, "_reduce_413", 3, 266, "_reduce_414", 0, 270, "_reduce_415", 4, 266, "_reduce_416", 1, 268, "_reduce_417", 1, 268, "_reduce_418", 1, 268, "_reduce_419", 1, 268, "_reduce_none", 2, 189, "_reduce_421", 1, 189, "_reduce_422", 1, 271, "_reduce_none", 1, 271, "_reduce_none", 1, 271, "_reduce_none", 1, 271, "_reduce_none", 3, 259, "_reduce_427", 1, 258, "_reduce_428", 1, 258, "_reduce_429", 2, 258, "_reduce_430", 2, 258, "_reduce_431", 2, 258, "_reduce_432", 2, 258, "_reduce_433", 1, 183, "_reduce_434", 1, 183, "_reduce_435", 1, 183, "_reduce_436", 1, 183, "_reduce_437", 1, 183, "_reduce_438", 1, 183, "_reduce_439", 1, 183, "_reduce_440", 1, 183, "_reduce_441", 1, 183, "_reduce_442", 1, 183, "_reduce_443", 1, 183, "_reduce_444", 1, 209, "_reduce_445", 1, 159, "_reduce_446", 1, 162, "_reduce_447", 1, 162, "_reduce_none", 1, 219, "_reduce_449", 3, 219, "_reduce_450", 2, 219, "_reduce_451", 4, 221, "_reduce_452", 2, 221, "_reduce_453", 6, 272, "_reduce_454", 4, 272, "_reduce_455", 4, 272, "_reduce_456", 2, 272, "_reduce_457", 4, 272, "_reduce_458", 2, 272, "_reduce_459", 2, 272, "_reduce_460", 1, 272, "_reduce_461", 0, 272, "_reduce_462", 1, 275, "_reduce_none", 1, 275, "_reduce_464", 1, 276, "_reduce_465", 1, 276, "_reduce_466", 1, 276, "_reduce_467", 1, 276, "_reduce_468", 1, 277, "_reduce_469", 3, 277, "_reduce_470", 1, 218, "_reduce_none", 1, 218, "_reduce_none", 1, 279, "_reduce_473", 3, 279, "_reduce_none", 1, 280, "_reduce_475", 3, 280, "_reduce_476", 1, 278, "_reduce_none", 4, 278, "_reduce_none", 3, 278, "_reduce_none", 2, 278, "_reduce_none", 1, 278, "_reduce_none", 1, 247, "_reduce_482", 3, 247, "_reduce_483", 3, 281, "_reduce_484", 1, 273, "_reduce_485", 3, 273, "_reduce_486", 1, 282, "_reduce_none", 1, 282, "_reduce_none", 2, 248, "_reduce_489", 1, 248, "_reduce_490", 1, 283, "_reduce_none", 1, 283, "_reduce_none", 2, 245, "_reduce_493", 2, 274, "_reduce_494", 0, 274, "_reduce_495", 1, 222, "_reduce_496", 4, 222, "_reduce_497", 0, 210, "_reduce_498", 2, 210, "_reduce_499", 1, 195, "_reduce_500", 3, 195, "_reduce_501", 3, 284, "_reduce_502", 2, 284, "_reduce_503", 1, 176, "_reduce_none", 1, 176, "_reduce_none", 1, 176, "_reduce_none", 1, 172, "_reduce_none", 1, 172, "_reduce_none", 1, 172, "_reduce_none", 1, 172, "_reduce_none", 1, 251, "_reduce_none", 1, 251, "_reduce_none", 1, 251, "_reduce_none", 1, 223, "_reduce_none", 1, 223, "_reduce_none", 0, 143, "_reduce_none", 1, 143, "_reduce_none", 0, 190, "_reduce_none", 1, 190, "_reduce_none", 0, 194, "_reduce_none", 1, 194, "_reduce_none", 1, 194, "_reduce_none", 1, 220, "_reduce_none", 1, 220, "_reduce_none", 1, 145, "_reduce_none", 2, 145, "_reduce_none", 0, 192, "_reduce_527"];

      racc_reduce_n = 528;

      racc_shift_n = 929;

      racc_token_table = $hash(false, 0, "error", 1, "kCLASS", 2, "kMODULE", 3, "kDEF", 4, "kUNDEF", 5, "kBEGIN", 6, "kRESCUE", 7, "kENSURE", 8, "kEND", 9, "kIF", 10, "kUNLESS", 11, "kTHEN", 12, "kELSIF", 13, "kELSE", 14, "kCASE", 15, "kWHEN", 16, "kWHILE", 17, "kUNTIL", 18, "kFOR", 19, "kBREAK", 20, "kNEXT", 21, "kREDO", 22, "kRETRY", 23, "kIN", 24, "kDO", 25, "kDO_COND", 26, "kDO_BLOCK", 27, "kDO_LAMBDA", 28, "kRETURN", 29, "kYIELD", 30, "kSUPER", 31, "kSELF", 32, "kNIL", 33, "kTRUE", 34, "kFALSE", 35, "kAND", 36, "kOR", 37, "kNOT", 38, "kIF_MOD", 39, "kUNLESS_MOD", 40, "kWHILE_MOD", 41, "kUNTIL_MOD", 42, "kRESCUE_MOD", 43, "kALIAS", 44, "kDEFINED", 45, "klBEGIN", 46, "klEND", 47, "k__LINE__", 48, "k__FILE__", 49, "k__ENCODING__", 50, "tIDENTIFIER", 51, "tFID", 52, "tGVAR", 53, "tIVAR", 54, "tCONSTANT", 55, "tLABEL", 56, "tCVAR", 57, "tNTH_REF", 58, "tBACK_REF", 59, "tSTRING_CONTENT", 60, "tINTEGER", 61, "tFLOAT", 62, "tREGEXP_END", 63, "tUPLUS", 64, "tUMINUS", 65, "tUMINUS_NUM", 66, "tPOW", 67, "tCMP", 68, "tEQ", 69, "tEQQ", 70, "tNEQ", 71, "tGEQ", 72, "tLEQ", 73, "tANDOP", 74, "tOROP", 75, "tMATCH", 76, "tNMATCH", 77, "tDOT", 78, "tDOT2", 79, "tDOT3", 80, "tAREF", 81, "tASET", 82, "tLSHFT", 83, "tRSHFT", 84, "tCOLON2", 85, "tCOLON3", 86, "tOP_ASGN", 87, "tASSOC", 88, "tLPAREN", 89, "tLPAREN2", 90, "tRPAREN", 91, "tLPAREN_ARG", 92, "ARRAY_BEG", 93, "tRBRACK", 94, "tLBRACE", 95, "tLBRACE_ARG", 96, "tSTAR", 97, "tSTAR2", 98, "tAMPER", 99, "tAMPER2", 100, "tTILDE", 101, "tPERCENT", 102, "tDIVIDE", 103, "tPLUS", 104, "tMINUS", 105, "tLT", 106, "tGT", 107, "tPIPE", 108, "tBANG", 109, "tCARET", 110, "tLCURLY", 111, "tRCURLY", 112, "tBACK_REF2", 113, "tSYMBEG", 114, "tSTRING_BEG", 115, "tXSTRING_BEG", 116, "tREGEXP_BEG", 117, "tWORDS_BEG", 118, "tAWORDS_BEG", 119, "tSTRING_DBEG", 120, "tSTRING_DVAR", 121, "tSTRING_END", 122, "tSTRING", 123, "tSYMBOL", 124, "tNL", 125, "tEH", 126, "tCOLON", 127, "tCOMMA", 128, "tSPACE", 129, "tSEMI", 130, "tLAMBDA", 131, "tLAMBEG", 132, "tLBRACK2", 133, "tLBRACK", 134, "tEQL", 135, "tLOWEST", 136, "-@NUM", 137, "+@NUM", 138);

      racc_nt_base = 139;

      racc_use_result_var = true;

      Opal.cdecl($scope, 'Racc_arg', [racc_action_table, racc_action_check, racc_action_default, racc_action_pointer, racc_goto_table, racc_goto_check, racc_goto_default, racc_goto_pointer, racc_nt_base, racc_reduce_table, racc_token_table, racc_shift_n, racc_reduce_n, racc_use_result_var]);

      Opal.cdecl($scope, 'Racc_token_to_s_table', ["$end", "error", "kCLASS", "kMODULE", "kDEF", "kUNDEF", "kBEGIN", "kRESCUE", "kENSURE", "kEND", "kIF", "kUNLESS", "kTHEN", "kELSIF", "kELSE", "kCASE", "kWHEN", "kWHILE", "kUNTIL", "kFOR", "kBREAK", "kNEXT", "kREDO", "kRETRY", "kIN", "kDO", "kDO_COND", "kDO_BLOCK", "kDO_LAMBDA", "kRETURN", "kYIELD", "kSUPER", "kSELF", "kNIL", "kTRUE", "kFALSE", "kAND", "kOR", "kNOT", "kIF_MOD", "kUNLESS_MOD", "kWHILE_MOD", "kUNTIL_MOD", "kRESCUE_MOD", "kALIAS", "kDEFINED", "klBEGIN", "klEND", "k__LINE__", "k__FILE__", "k__ENCODING__", "tIDENTIFIER", "tFID", "tGVAR", "tIVAR", "tCONSTANT", "tLABEL", "tCVAR", "tNTH_REF", "tBACK_REF", "tSTRING_CONTENT", "tINTEGER", "tFLOAT", "tREGEXP_END", "tUPLUS", "tUMINUS", "tUMINUS_NUM", "tPOW", "tCMP", "tEQ", "tEQQ", "tNEQ", "tGEQ", "tLEQ", "tANDOP", "tOROP", "tMATCH", "tNMATCH", "tDOT", "tDOT2", "tDOT3", "tAREF", "tASET", "tLSHFT", "tRSHFT", "tCOLON2", "tCOLON3", "tOP_ASGN", "tASSOC", "tLPAREN", "tLPAREN2", "tRPAREN", "tLPAREN_ARG", "ARRAY_BEG", "tRBRACK", "tLBRACE", "tLBRACE_ARG", "tSTAR", "tSTAR2", "tAMPER", "tAMPER2", "tTILDE", "tPERCENT", "tDIVIDE", "tPLUS", "tMINUS", "tLT", "tGT", "tPIPE", "tBANG", "tCARET", "tLCURLY", "tRCURLY", "tBACK_REF2", "tSYMBEG", "tSTRING_BEG", "tXSTRING_BEG", "tREGEXP_BEG", "tWORDS_BEG", "tAWORDS_BEG", "tSTRING_DBEG", "tSTRING_DVAR", "tSTRING_END", "tSTRING", "tSYMBOL", "tNL", "tEH", "tCOLON", "tCOMMA", "tSPACE", "tSEMI", "tLAMBDA", "tLAMBEG", "tLBRACK2", "tLBRACK", "tEQL", "tLOWEST", "\"-@NUM\"", "\"+@NUM\"", "$start", "program", "top_compstmt", "top_stmts", "opt_terms", "top_stmt", "terms", "stmt", "bodystmt", "compstmt", "opt_rescue", "opt_else", "opt_ensure", "stmts", "fitem", "undef_list", "expr_value", "lhs", "command_call", "mlhs", "var_lhs", "primary_value", "aref_args", "backref", "mrhs", "arg_value", "expr", "@1", "arg", "command", "block_command", "call_args", "block_call", "operation2", "command_args", "cmd_brace_block", "opt_block_var", "operation", "mlhs_basic", "mlhs_entry", "mlhs_head", "mlhs_item", "mlhs_node", "mlhs_post", "variable", "cname", "cpath", "fname", "op", "reswords", "symbol", "opt_nl", "primary", "none", "args", "trailer", "assocs", "paren_args", "opt_paren_args", "opt_block_arg", "block_arg", "call_args2", "open_args", "@2", "literal", "strings", "xstring", "regexp", "words", "awords", "var_ref", "assoc_list", "brace_block", "method_call", "lambda", "then", "if_tail", "do", "case_body", "for_var", "superclass", "term", "f_arglist", "singleton", "dot_or_colon", "@3", "@4", "@5", "@6", "@7", "@8", "@9", "@10", "@11", "@12", "@13", "@14", "@15", "@16", "@17", "f_larglist", "lambda_body", "block_param", "f_block_optarg", "f_block_opt", "block_args_tail", "f_block_arg", "opt_block_args_tail", "f_arg", "f_rest_arg", "do_block", "@18", "operation3", "@19", "@20", "cases", "@21", "exc_list", "exc_var", "numeric", "dsym", "string", "string1", "string_contents", "xstring_contents", "word_list", "word", "string_content", "qword_list", "string_dvar", "@22", "@23", "sym", "f_args", "f_optarg", "opt_f_block_arg", "f_norm_arg", "f_bad_arg", "f_arg_item", "f_margs", "f_marg", "f_marg_list", "f_opt", "restarg_mark", "blkarg_mark", "assoc"]);

      Opal.cdecl($scope, 'Racc_debug_parser', false);

      def.$_reduce_2 = function(val, _values, result) {
        var self = this;

        result = self.$new_compstmt(val['$[]'](0));
        return result;
      };

      def.$_reduce_3 = function(val, _values, result) {
        var self = this;

        result = self.$new_block();
        return result;
      };

      def.$_reduce_4 = function(val, _values, result) {
        var self = this;

        result = self.$new_block(val['$[]'](0));
        return result;
      };

      def.$_reduce_5 = function(val, _values, result) {
        var self = this;

        val['$[]'](0)['$<<'](val['$[]'](2));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_7 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](2);
        return result;
      };

      def.$_reduce_8 = function(val, _values, result) {
        var self = this;

        result = self.$new_body(val['$[]'](0), val['$[]'](1), val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_9 = function(val, _values, result) {
        var self = this;

        result = self.$new_compstmt(val['$[]'](0));
        return result;
      };

      def.$_reduce_10 = function(val, _values, result) {
        var self = this;

        result = self.$new_block();
        return result;
      };

      def.$_reduce_11 = function(val, _values, result) {
        var self = this;

        result = self.$new_block(val['$[]'](0));
        return result;
      };

      def.$_reduce_12 = function(val, _values, result) {
        var self = this;

        val['$[]'](0)['$<<'](val['$[]'](2));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_13 = function(val, _values, result) {
        var $a, $b, self = this;

        (($a = ["expr_fname"]), $b = self.$lexer(), $b['$lex_state='].apply($b, $a), $a[$a.length-1]);
        return result;
      };

      def.$_reduce_14 = function(val, _values, result) {
        var self = this;

        result = self.$new_alias(val['$[]'](0), val['$[]'](1), val['$[]'](3));
        return result;
      };

      def.$_reduce_15 = function(val, _values, result) {
        var self = this;

        result = self.$s("valias", self.$value(val['$[]'](1)).$to_sym(), self.$value(val['$[]'](2)).$to_sym());
        return result;
      };

      def.$_reduce_17 = function(val, _values, result) {
        var self = this;

        result = self.$s("valias", self.$value(val['$[]'](1)).$to_sym(), self.$value(val['$[]'](2)).$to_sym());
        return result;
      };

      def.$_reduce_18 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_19 = function(val, _values, result) {
        var self = this;

        result = self.$new_if(val['$[]'](1), val['$[]'](2), val['$[]'](0), nil);
        return result;
      };

      def.$_reduce_20 = function(val, _values, result) {
        var self = this;

        result = self.$new_if(val['$[]'](1), val['$[]'](2), nil, val['$[]'](0));
        return result;
      };

      def.$_reduce_21 = function(val, _values, result) {
        var self = this;

        result = self.$new_while(val['$[]'](1), val['$[]'](2), val['$[]'](0));
        return result;
      };

      def.$_reduce_22 = function(val, _values, result) {
        var self = this;

        result = self.$new_until(val['$[]'](1), val['$[]'](2), val['$[]'](0));
        return result;
      };

      def.$_reduce_23 = function(val, _values, result) {
        var self = this;

        result = self.$new_rescue_mod(val['$[]'](1), val['$[]'](0), val['$[]'](2));
        return result;
      };

      def.$_reduce_25 = function(val, _values, result) {
        var self = this;

        result = self.$new_assign(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_26 = function(val, _values, result) {
        var self = this;

        result = self.$s("masgn", val['$[]'](0), self.$s("to_ary", val['$[]'](2)));
        return result;
      };

      def.$_reduce_27 = function(val, _values, result) {
        var self = this;

        result = self.$new_op_asgn(val['$[]'](1), val['$[]'](0), val['$[]'](2));
        return result;
      };

      def.$_reduce_29 = function(val, _values, result) {
        var self = this;

        result = self.$s("op_asgn2", val['$[]'](0), self.$op_to_setter(val['$[]'](2)), self.$value(val['$[]'](3)).$to_sym(), val['$[]'](4));
        return result;
      };

      def.$_reduce_33 = function(val, _values, result) {
        var self = this;

        result = self.$new_assign(val['$[]'](0), val['$[]'](1), self.$s("svalue", val['$[]'](2)));
        return result;
      };

      def.$_reduce_34 = function(val, _values, result) {
        var self = this;

        result = self.$s("masgn", val['$[]'](0), self.$s("to_ary", val['$[]'](2)));
        return result;
      };

      def.$_reduce_35 = function(val, _values, result) {
        var self = this;

        result = self.$s("masgn", val['$[]'](0), val['$[]'](2));
        return result;
      };

      def.$_reduce_38 = function(val, _values, result) {
        var self = this;

        result = self.$s("and", val['$[]'](0), val['$[]'](2));
        return result;
      };

      def.$_reduce_39 = function(val, _values, result) {
        var self = this;

        result = self.$s("or", val['$[]'](0), val['$[]'](2));
        return result;
      };

      def.$_reduce_40 = function(val, _values, result) {
        var self = this;

        result = self.$new_unary_call(["!", []], val['$[]'](1));
        return result;
      };

      def.$_reduce_41 = function(val, _values, result) {
        var self = this;

        result = self.$new_unary_call(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_46 = function(val, _values, result) {
        var self = this;

        result = self.$new_return(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_47 = function(val, _values, result) {
        var self = this;

        result = self.$new_break(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_48 = function(val, _values, result) {
        var self = this;

        result = self.$new_next(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_53 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(nil, val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_55 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_57 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_59 = function(val, _values, result) {
        var self = this;

        result = self.$new_super(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_60 = function(val, _values, result) {
        var self = this;

        result = self.$new_yield(val['$[]'](1));
        return result;
      };

      def.$_reduce_61 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_62 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_63 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_64 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_65 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_66 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](val['$[]'](1));
        return result;
      };

      def.$_reduce_67 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](self.$s("splat", val['$[]'](2)));
        return result;
      };

      def.$_reduce_69 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](self.$s("splat"));
        return result;
      };

      def.$_reduce_71 = function(val, _values, result) {
        var self = this;

        result = self.$s("array", self.$s("splat", val['$[]'](1)));
        return result;
      };

      def.$_reduce_72 = function(val, _values, result) {
        var self = this;

        result = self.$s("array", self.$s("splat"));
        return result;
      };

      def.$_reduce_74 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_75 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_76 = function(val, _values, result) {
        var self = this;

        result = self.$s("array", val['$[]'](0));
        return result;
      };

      def.$_reduce_77 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](val['$[]'](1));
        return result;
      };

      def.$_reduce_80 = function(val, _values, result) {
        var self = this;

        result = self.$new_assignable(val['$[]'](0));
        return result;
      };

      def.$_reduce_81 = function(val, _values, result) {
        var $a, self = this, args = nil;

        args = (function() {if ((($a = val['$[]'](2)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return val['$[]'](2)
          } else {
          return []
        }; return nil; })();
        result = self.$s("attrasgn", val['$[]'](0), "[]=", ($a = self).$s.apply($a, ["arglist"].concat(args)));
        return result;
      };

      def.$_reduce_82 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), val['$[]'](2), []);
        return result;
      };

      def.$_reduce_88 = function(val, _values, result) {
        var self = this;

        result = self.$new_assignable(val['$[]'](0));
        return result;
      };

      def.$_reduce_89 = function(val, _values, result) {
        var self = this;

        result = self.$new_attrasgn(val['$[]'](0), "[]=", val['$[]'](2));
        return result;
      };

      def.$_reduce_90 = function(val, _values, result) {
        var self = this;

        result = self.$new_attrasgn(val['$[]'](0), self.$op_to_setter(val['$[]'](2)));
        return result;
      };

      def.$_reduce_91 = function(val, _values, result) {
        var self = this;

        result = self.$new_attrasgn(val['$[]'](0), self.$op_to_setter(val['$[]'](2)));
        return result;
      };

      def.$_reduce_92 = function(val, _values, result) {
        var self = this;

        result = self.$new_attrasgn(val['$[]'](0), self.$op_to_setter(val['$[]'](2)));
        return result;
      };

      def.$_reduce_93 = function(val, _values, result) {
        var self = this;

        result = self.$new_colon2(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_94 = function(val, _values, result) {
        var self = this;

        result = self.$new_colon3(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_97 = function(val, _values, result) {
        var self = this;

        result = self.$new_colon3(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_98 = function(val, _values, result) {
        var self = this;

        result = self.$new_const(val['$[]'](0));
        return result;
      };

      def.$_reduce_99 = function(val, _values, result) {
        var self = this;

        result = self.$new_colon2(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_103 = function(val, _values, result) {
        var $a, $b, self = this;

        (($a = ["expr_end"]), $b = self.$lexer(), $b['$lex_state='].apply($b, $a), $a[$a.length-1]);
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_104 = function(val, _values, result) {
        var $a, $b, self = this;

        (($a = ["expr_end"]), $b = self.$lexer(), $b['$lex_state='].apply($b, $a), $a[$a.length-1]);
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_105 = function(val, _values, result) {
        var self = this;

        result = self.$new_sym(val['$[]'](0));
        return result;
      };

      def.$_reduce_107 = function(val, _values, result) {
        var self = this;

        result = self.$s("undef", val['$[]'](0));
        return result;
      };

      def.$_reduce_108 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](val['$[]'](2));
        return result;
      };

      def.$_reduce_183 = function(val, _values, result) {
        var self = this;

        result = self.$new_assign(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_184 = function(val, _values, result) {
        var self = this;

        result = self.$new_assign(val['$[]'](0), val['$[]'](1), self.$s("rescue_mod", val['$[]'](2), val['$[]'](4)));
        return result;
      };

      def.$_reduce_185 = function(val, _values, result) {
        var self = this;

        result = self.$new_op_asgn(val['$[]'](1), val['$[]'](0), val['$[]'](2));
        return result;
      };

      def.$_reduce_186 = function(val, _values, result) {
        var self = this;

        result = self.$new_op_asgn1(val['$[]'](0), val['$[]'](2), val['$[]'](4), val['$[]'](5));
        return result;
      };

      def.$_reduce_187 = function(val, _values, result) {
        var self = this;

        result = self.$s("op_asgn2", val['$[]'](0), self.$op_to_setter(val['$[]'](2)), self.$value(val['$[]'](3)).$to_sym(), val['$[]'](4));
        return result;
      };

      def.$_reduce_193 = function(val, _values, result) {
        var self = this;

        result = self.$new_irange(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_194 = function(val, _values, result) {
        var self = this;

        result = self.$new_erange(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_195 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_196 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_197 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_198 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_199 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_200 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_201 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(self.$new_binary_call(self.$new_int(val['$[]'](1)), val['$[]'](2), val['$[]'](3)), ["-@", []], []);
        return result;
      };

      def.$_reduce_202 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(self.$new_binary_call(self.$new_float(val['$[]'](1)), val['$[]'](2), val['$[]'](3)), ["-@", []], []);
        return result;
      };

      def.$_reduce_203 = function(val, _values, result) {
        var $a, self = this;

        result = self.$new_call(val['$[]'](1), ["+@", []], []);
        if ((($a = ["int", "float"]['$include?'](val['$[]'](1).$type())) !== nil && (!$a.$$is_boolean || $a == true))) {
          result = val['$[]'](1)};
        return result;
      };

      def.$_reduce_204 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](1), ["-@", []], []);
        if (val['$[]'](1).$type()['$==']("int")) {
          val['$[]'](1)['$[]='](1, val['$[]'](1)['$[]'](1)['$-@']());
          result = val['$[]'](1);
        } else if (val['$[]'](1).$type()['$==']("float")) {
          val['$[]'](1)['$[]='](1, val['$[]'](1)['$[]'](1).$to_f()['$-@']());
          result = val['$[]'](1);};
        return result;
      };

      def.$_reduce_205 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_206 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_207 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_208 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_209 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_210 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_211 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_212 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_213 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_214 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_215 = function(val, _values, result) {
        var self = this;

        result = self.$new_unary_call(["!", []], self.$new_binary_call(val['$[]'](0), ["==", []], val['$[]'](2)));
        return result;
      };

      def.$_reduce_216 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_217 = function(val, _values, result) {
        var self = this;

        result = self.$new_not(val['$[]'](1), self.$new_binary_call(val['$[]'](0), ["=~", []], val['$[]'](2)));
        return result;
      };

      def.$_reduce_218 = function(val, _values, result) {
        var self = this;

        result = self.$new_unary_call(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_219 = function(val, _values, result) {
        var self = this;

        result = self.$new_unary_call(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_220 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_221 = function(val, _values, result) {
        var self = this;

        result = self.$new_binary_call(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_222 = function(val, _values, result) {
        var self = this;

        result = self.$new_and(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_223 = function(val, _values, result) {
        var self = this;

        result = self.$new_or(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_224 = function(val, _values, result) {
        var self = this;

        result = self.$s("defined", val['$[]'](2));
        return result;
      };

      def.$_reduce_225 = function(val, _values, result) {
        var self = this;

        result = self.$new_if(val['$[]'](1), val['$[]'](0), val['$[]'](2), val['$[]'](4));
        return result;
      };

      def.$_reduce_228 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_229 = function(val, _values, result) {
        var self = this;

        result = [val['$[]'](0)];
        return result;
      };

      def.$_reduce_230 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_231 = function(val, _values, result) {
        var $a, self = this;

        val['$[]'](0)['$<<'](($a = self).$s.apply($a, ["hash"].concat(val['$[]'](2))));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_232 = function(val, _values, result) {
        var $a, self = this;

        result = [($a = self).$s.apply($a, ["hash"].concat(val['$[]'](0)))];
        return result;
      };

      def.$_reduce_233 = function(val, _values, result) {
        var self = this;

        result = [];
        return result;
      };

      def.$_reduce_234 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_237 = function(val, _values, result) {
        var self = this;

        result = [];
        return result;
      };

      def.$_reduce_239 = function(val, _values, result) {
        var self = this;

        result = [val['$[]'](0)];
        return result;
      };

      def.$_reduce_240 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        self.$add_block_pass(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_241 = function(val, _values, result) {
        var self = this;

        result = [self.$new_hash(nil, val['$[]'](0), nil)];
        self.$add_block_pass(result, val['$[]'](1));
        return result;
      };

      def.$_reduce_242 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        result['$<<'](self.$new_hash(nil, val['$[]'](2), nil));
        return result;
      };

      def.$_reduce_243 = function(val, _values, result) {
        var self = this;

        result = [];
        self.$add_block_pass(result, val['$[]'](0));
        return result;
      };

      def.$_reduce_246 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cmdarg_push(1);
        return result;
      };

      def.$_reduce_247 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cmdarg_pop();
        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_249 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_250 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_251 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_pass(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_252 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_253 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_254 = function(val, _values, result) {
        var self = this;

        result = [val['$[]'](0)];
        return result;
      };

      def.$_reduce_255 = function(val, _values, result) {
        var self = this;

        result = [self.$new_splat(val['$[]'](0), val['$[]'](1))];
        return result;
      };

      def.$_reduce_256 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](val['$[]'](2));
        return result;
      };

      def.$_reduce_257 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](self.$new_splat(val['$[]'](2), val['$[]'](3)));
        return result;
      };

      def.$_reduce_258 = function(val, _values, result) {
        var $a, self = this;

        val['$[]'](0)['$<<'](val['$[]'](2));
        result = ($a = self).$s.apply($a, ["array"].concat(val['$[]'](0)));
        return result;
      };

      def.$_reduce_259 = function(val, _values, result) {
        var $a, self = this;

        val['$[]'](0)['$<<'](self.$s("splat", val['$[]'](3)));
        result = ($a = self).$s.apply($a, ["array"].concat(val['$[]'](0)));
        return result;
      };

      def.$_reduce_260 = function(val, _values, result) {
        var self = this;

        result = self.$s("splat", val['$[]'](1));
        return result;
      };

      def.$_reduce_270 = function(val, _values, result) {
        var self = this;

        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_271 = function(val, _values, result) {
        var self = this;

        result = self.$s("begin", val['$[]'](2));
        return result;
      };

      def.$_reduce_272 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_273 = function(val, _values, result) {
        var self = this;

        result = self.$new_paren(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_274 = function(val, _values, result) {
        var self = this;

        result = self.$new_colon2(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_275 = function(val, _values, result) {
        var self = this;

        result = self.$new_colon3(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_276 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), ["[]", []], val['$[]'](2));
        return result;
      };

      def.$_reduce_277 = function(val, _values, result) {
        var self = this;

        result = self.$new_array(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_278 = function(val, _values, result) {
        var self = this;

        result = self.$new_hash(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_279 = function(val, _values, result) {
        var self = this;

        result = self.$new_return(val['$[]'](0));
        return result;
      };

      def.$_reduce_280 = function(val, _values, result) {
        var self = this;

        result = self.$new_yield(val['$[]'](2));
        return result;
      };

      def.$_reduce_281 = function(val, _values, result) {
        var self = this;

        result = self.$s("yield");
        return result;
      };

      def.$_reduce_282 = function(val, _values, result) {
        var self = this;

        result = self.$s("yield");
        return result;
      };

      def.$_reduce_283 = function(val, _values, result) {
        var self = this;

        result = self.$s("defined", val['$[]'](3));
        return result;
      };

      def.$_reduce_284 = function(val, _values, result) {
        var self = this;

        result = self.$new_unary_call(["!", []], val['$[]'](2));
        return result;
      };

      def.$_reduce_285 = function(val, _values, result) {
        var self = this;

        result = self.$new_unary_call(["!", []], self.$new_nil(val['$[]'](0)));
        return result;
      };

      def.$_reduce_286 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(nil, val['$[]'](0), []);
        result['$<<'](val['$[]'](1));
        return result;
      };

      def.$_reduce_288 = function(val, _values, result) {
        var self = this;

        val['$[]'](0)['$<<'](val['$[]'](1));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_289 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_290 = function(val, _values, result) {
        var self = this;

        result = self.$new_if(val['$[]'](0), val['$[]'](1), val['$[]'](3), val['$[]'](4));
        return result;
      };

      def.$_reduce_291 = function(val, _values, result) {
        var self = this;

        result = self.$new_if(val['$[]'](0), val['$[]'](1), val['$[]'](4), val['$[]'](3));
        return result;
      };

      def.$_reduce_292 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cond_push(1);
        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_293 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cond_pop();
        return result;
      };

      def.$_reduce_294 = function(val, _values, result) {
        var self = this;

        result = self.$s("while", val['$[]'](2), val['$[]'](5));
        return result;
      };

      def.$_reduce_295 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cond_push(1);
        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_296 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cond_pop();
        return result;
      };

      def.$_reduce_297 = function(val, _values, result) {
        var self = this;

        result = self.$s("until", val['$[]'](2), val['$[]'](5));
        return result;
      };

      def.$_reduce_298 = function(val, _values, result) {
        var $a, self = this;

        result = ($a = self).$s.apply($a, ["case", val['$[]'](1)].concat(val['$[]'](3)));
        return result;
      };

      def.$_reduce_299 = function(val, _values, result) {
        var $a, self = this;

        result = ($a = self).$s.apply($a, ["case", nil].concat(val['$[]'](2)));
        return result;
      };

      def.$_reduce_300 = function(val, _values, result) {
        var self = this;

        result = self.$s("case", nil, val['$[]'](3));
        return result;
      };

      def.$_reduce_301 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cond_push(1);
        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_302 = function(val, _values, result) {
        var self = this;

        self.$lexer().$cond_pop();
        return result;
      };

      def.$_reduce_303 = function(val, _values, result) {
        var self = this;

        result = self.$s("for", val['$[]'](4), val['$[]'](1), val['$[]'](7));
        return result;
      };

      def.$_reduce_304 = function(val, _values, result) {
        var self = this;

        return result;
      };

      def.$_reduce_305 = function(val, _values, result) {
        var self = this;

        result = self.$new_class(val['$[]'](0), val['$[]'](1), val['$[]'](2), val['$[]'](4), val['$[]'](5));
        return result;
      };

      def.$_reduce_306 = function(val, _values, result) {
        var self = this;

        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_307 = function(val, _values, result) {
        var self = this;

        return result;
      };

      def.$_reduce_308 = function(val, _values, result) {
        var self = this;

        result = self.$new_sclass(val['$[]'](0), val['$[]'](3), val['$[]'](6), val['$[]'](7));
        return result;
      };

      def.$_reduce_309 = function(val, _values, result) {
        var self = this;

        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_310 = function(val, _values, result) {
        var self = this;

        return result;
      };

      def.$_reduce_311 = function(val, _values, result) {
        var self = this;

        result = self.$new_module(val['$[]'](0), val['$[]'](2), val['$[]'](4), val['$[]'](5));
        return result;
      };

      def.$_reduce_312 = function(val, _values, result) {
        var self = this;

        self.$push_scope();
        return result;
      };

      def.$_reduce_313 = function(val, _values, result) {
        var self = this;

        result = self.$new_def(val['$[]'](0), nil, val['$[]'](1), val['$[]'](3), val['$[]'](4), val['$[]'](5));
        self.$pop_scope();
        return result;
      };

      def.$_reduce_314 = function(val, _values, result) {
        var $a, $b, self = this;

        (($a = ["expr_fname"]), $b = self.$lexer(), $b['$lex_state='].apply($b, $a), $a[$a.length-1]);
        return result;
      };

      def.$_reduce_315 = function(val, _values, result) {
        var self = this;

        self.$push_scope();
        return result;
      };

      def.$_reduce_316 = function(val, _values, result) {
        var self = this;

        result = self.$new_def(val['$[]'](0), val['$[]'](1), val['$[]'](4), val['$[]'](6), val['$[]'](7), val['$[]'](8));
        self.$pop_scope();
        return result;
      };

      def.$_reduce_317 = function(val, _values, result) {
        var self = this;

        result = self.$new_break(val['$[]'](0));
        return result;
      };

      def.$_reduce_318 = function(val, _values, result) {
        var self = this;

        result = self.$s("next");
        return result;
      };

      def.$_reduce_319 = function(val, _values, result) {
        var self = this;

        result = self.$s("redo");
        return result;
      };

      def.$_reduce_329 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(nil, ["lambda", []], []);
        result['$<<'](self.$new_iter(val['$[]'](0), val['$[]'](1)));
        return result;
      };

      def.$_reduce_330 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_331 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_334 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_335 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_336 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_337 = function(val, _values, result) {
        var self = this;

        result = self.$new_if(val['$[]'](0), val['$[]'](1), val['$[]'](3), val['$[]'](4));
        return result;
      };

      def.$_reduce_339 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_340 = function(val, _values, result) {
        var self = this;

        result = self.$s("block", val['$[]'](0));
        return result;
      };

      def.$_reduce_341 = function(val, _values, result) {
        var self = this;

        val['$[]'](0)['$<<'](val['$[]'](2));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_342 = function(val, _values, result) {
        var self = this;

        result = self.$new_assign(self.$new_assignable(self.$new_ident(val['$[]'](0))), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_344 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_345 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_346 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_347 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_348 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_349 = function(val, _values, result) {
        var self = this;

        nil;
        return result;
      };

      def.$_reduce_350 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(val['$[]'](0), val['$[]'](2), val['$[]'](4), val['$[]'](5));
        return result;
      };

      def.$_reduce_351 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(val['$[]'](0), val['$[]'](2), nil, val['$[]'](3));
        return result;
      };

      def.$_reduce_352 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(val['$[]'](0), nil, val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_353 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(val['$[]'](0), nil, nil, nil);
        return result;
      };

      def.$_reduce_354 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(val['$[]'](0), nil, nil, val['$[]'](1));
        return result;
      };

      def.$_reduce_355 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(nil, val['$[]'](0), val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_356 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(nil, val['$[]'](0), nil, val['$[]'](1));
        return result;
      };

      def.$_reduce_357 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(nil, nil, val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_358 = function(val, _values, result) {
        var self = this;

        result = self.$new_block_args(nil, nil, nil, val['$[]'](0));
        return result;
      };

      def.$_reduce_359 = function(val, _values, result) {
        var self = this;

        self.$push_scope("block");
        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_360 = function(val, _values, result) {
        var self = this;

        result = self.$new_iter(val['$[]'](2), val['$[]'](3));
        self.$pop_scope();
        return result;
      };

      def.$_reduce_361 = function(val, _values, result) {
        var self = this;

        val['$[]'](0)['$<<'](val['$[]'](1));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_364 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(nil, val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_365 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_366 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), ["call", []], val['$[]'](2));
        return result;
      };

      def.$_reduce_367 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_368 = function(val, _values, result) {
        var self = this;

        result = self.$new_call(val['$[]'](0), val['$[]'](2));
        return result;
      };

      def.$_reduce_369 = function(val, _values, result) {
        var self = this;

        result = self.$new_super(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_370 = function(val, _values, result) {
        var self = this;

        result = self.$new_super(val['$[]'](0), nil);
        return result;
      };

      def.$_reduce_371 = function(val, _values, result) {
        var self = this;

        self.$push_scope("block");
        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_372 = function(val, _values, result) {
        var self = this;

        result = self.$new_iter(val['$[]'](2), val['$[]'](3));
        self.$pop_scope();
        return result;
      };

      def.$_reduce_373 = function(val, _values, result) {
        var self = this;

        self.$push_scope("block");
        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_374 = function(val, _values, result) {
        var self = this;

        result = self.$new_iter(val['$[]'](2), val['$[]'](3));
        self.$pop_scope();
        return result;
      };

      def.$_reduce_375 = function(val, _values, result) {
        var self = this;

        result = self.$lexer().$line();
        return result;
      };

      def.$_reduce_376 = function(val, _values, result) {
        var $a, $b, self = this, part = nil;

        part = self.$s("when", ($a = self).$s.apply($a, ["array"].concat(val['$[]'](2))), val['$[]'](4));
        result = [part];
        if ((($b = val['$[]'](5)) !== nil && (!$b.$$is_boolean || $b == true))) {
          ($b = result).$push.apply($b, [].concat(val['$[]'](5)))};
        return result;
      };

      def.$_reduce_377 = function(val, _values, result) {
        var self = this;

        result = [val['$[]'](0)];
        return result;
      };

      def.$_reduce_379 = function(val, _values, result) {
        var $a, self = this, exc = nil;

        exc = ((($a = val['$[]'](1)) !== false && $a !== nil) ? $a : self.$s("array"));
        if ((($a = val['$[]'](2)) !== nil && (!$a.$$is_boolean || $a == true))) {
          exc['$<<'](self.$new_assign(val['$[]'](2), val['$[]'](2), self.$s("gvar", "$!".$intern())))};
        result = [self.$s("resbody", exc, val['$[]'](4))];
        if ((($a = val['$[]'](5)) !== nil && (!$a.$$is_boolean || $a == true))) {
          result.$push(val['$[]'](5).$first())};
        return result;
      };

      def.$_reduce_380 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_381 = function(val, _values, result) {
        var self = this;

        result = self.$s("array", val['$[]'](0));
        return result;
      };

      def.$_reduce_384 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_385 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_386 = function(val, _values, result) {
        var $a, self = this;

        result = (function() {if ((($a = val['$[]'](1)['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$s("nil")
          } else {
          return val['$[]'](1)
        }; return nil; })();
        return result;
      };

      def.$_reduce_391 = function(val, _values, result) {
        var self = this;

        result = self.$new_str(val['$[]'](0));
        return result;
      };

      def.$_reduce_393 = function(val, _values, result) {
        var self = this;

        result = self.$str_append(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_394 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_395 = function(val, _values, result) {
        var self = this;

        result = self.$s("str", self.$value(val['$[]'](0)));
        return result;
      };

      def.$_reduce_396 = function(val, _values, result) {
        var self = this;

        result = self.$new_xstr(val['$[]'](0), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_397 = function(val, _values, result) {
        var self = this;

        result = self.$new_regexp(val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_398 = function(val, _values, result) {
        var self = this;

        result = self.$s("array");
        return result;
      };

      def.$_reduce_399 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_400 = function(val, _values, result) {
        var self = this;

        result = self.$s("array");
        return result;
      };

      def.$_reduce_401 = function(val, _values, result) {
        var self = this, part = nil;

        part = val['$[]'](1);
        if (part.$type()['$==']("evstr")) {
          part = self.$s("dstr", "", val['$[]'](1))};
        result = val['$[]'](0)['$<<'](part);
        return result;
      };

      def.$_reduce_402 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_403 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0).$concat([val['$[]'](1)]);
        return result;
      };

      def.$_reduce_404 = function(val, _values, result) {
        var self = this;

        result = self.$s("array");
        return result;
      };

      def.$_reduce_405 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_406 = function(val, _values, result) {
        var self = this;

        result = self.$s("array");
        return result;
      };

      def.$_reduce_407 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0)['$<<'](self.$s("str", self.$value(val['$[]'](1))));
        return result;
      };

      def.$_reduce_408 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_409 = function(val, _values, result) {
        var self = this;

        result = self.$str_append(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_410 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_411 = function(val, _values, result) {
        var self = this;

        result = self.$str_append(val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_412 = function(val, _values, result) {
        var self = this;

        result = self.$new_str_content(val['$[]'](0));
        return result;
      };

      def.$_reduce_413 = function(val, _values, result) {
        var $a, $b, self = this;

        result = self.$lexer().$strterm();
        (($a = [nil]), $b = self.$lexer(), $b['$strterm='].apply($b, $a), $a[$a.length-1]);
        return result;
      };

      def.$_reduce_414 = function(val, _values, result) {
        var $a, $b, self = this;

        (($a = [val['$[]'](1)]), $b = self.$lexer(), $b['$strterm='].apply($b, $a), $a[$a.length-1]);
        result = self.$new_evstr(val['$[]'](2));
        return result;
      };

      def.$_reduce_415 = function(val, _values, result) {
        var $a, $b, self = this;

        self.$lexer().$cond_push(0);
        self.$lexer().$cmdarg_push(0);
        result = self.$lexer().$strterm();
        (($a = [nil]), $b = self.$lexer(), $b['$strterm='].apply($b, $a), $a[$a.length-1]);
        (($a = ["expr_beg"]), $b = self.$lexer(), $b['$lex_state='].apply($b, $a), $a[$a.length-1]);
        return result;
      };

      def.$_reduce_416 = function(val, _values, result) {
        var $a, $b, self = this;

        (($a = [val['$[]'](1)]), $b = self.$lexer(), $b['$strterm='].apply($b, $a), $a[$a.length-1]);
        self.$lexer().$cond_lexpop();
        self.$lexer().$cmdarg_lexpop();
        result = self.$new_evstr(val['$[]'](2));
        return result;
      };

      def.$_reduce_417 = function(val, _values, result) {
        var self = this;

        result = self.$new_gvar(val['$[]'](0));
        return result;
      };

      def.$_reduce_418 = function(val, _values, result) {
        var self = this;

        result = self.$new_ivar(val['$[]'](0));
        return result;
      };

      def.$_reduce_419 = function(val, _values, result) {
        var self = this;

        result = self.$new_cvar(val['$[]'](0));
        return result;
      };

      def.$_reduce_421 = function(val, _values, result) {
        var $a, $b, self = this;

        result = self.$new_sym(val['$[]'](1));
        (($a = ["expr_end"]), $b = self.$lexer(), $b['$lex_state='].apply($b, $a), $a[$a.length-1]);
        return result;
      };

      def.$_reduce_422 = function(val, _values, result) {
        var self = this;

        result = self.$new_sym(val['$[]'](0));
        return result;
      };

      def.$_reduce_427 = function(val, _values, result) {
        var self = this;

        result = self.$new_dsym(val['$[]'](1));
        return result;
      };

      def.$_reduce_428 = function(val, _values, result) {
        var self = this;

        result = self.$new_int(val['$[]'](0));
        return result;
      };

      def.$_reduce_429 = function(val, _values, result) {
        var self = this;

        result = self.$new_float(val['$[]'](0));
        return result;
      };

      def.$_reduce_430 = function(val, _values, result) {
        var self = this;

        result = self.$negate_num(self.$new_int(val['$[]'](1)));
        return result;
      };

      def.$_reduce_431 = function(val, _values, result) {
        var self = this;

        result = self.$negate_num(self.$new_float(val['$[]'](1)));
        return result;
      };

      def.$_reduce_432 = function(val, _values, result) {
        var self = this;

        result = self.$new_int(val['$[]'](1));
        return result;
      };

      def.$_reduce_433 = function(val, _values, result) {
        var self = this;

        result = self.$new_float(val['$[]'](1));
        return result;
      };

      def.$_reduce_434 = function(val, _values, result) {
        var self = this;

        result = self.$new_ident(val['$[]'](0));
        return result;
      };

      def.$_reduce_435 = function(val, _values, result) {
        var self = this;

        result = self.$new_ivar(val['$[]'](0));
        return result;
      };

      def.$_reduce_436 = function(val, _values, result) {
        var self = this;

        result = self.$new_gvar(val['$[]'](0));
        return result;
      };

      def.$_reduce_437 = function(val, _values, result) {
        var self = this;

        result = self.$new_const(val['$[]'](0));
        return result;
      };

      def.$_reduce_438 = function(val, _values, result) {
        var self = this;

        result = self.$new_cvar(val['$[]'](0));
        return result;
      };

      def.$_reduce_439 = function(val, _values, result) {
        var self = this;

        result = self.$new_nil(val['$[]'](0));
        return result;
      };

      def.$_reduce_440 = function(val, _values, result) {
        var self = this;

        result = self.$new_self(val['$[]'](0));
        return result;
      };

      def.$_reduce_441 = function(val, _values, result) {
        var self = this;

        result = self.$new_true(val['$[]'](0));
        return result;
      };

      def.$_reduce_442 = function(val, _values, result) {
        var self = this;

        result = self.$new_false(val['$[]'](0));
        return result;
      };

      def.$_reduce_443 = function(val, _values, result) {
        var self = this;

        result = self.$new___FILE__(val['$[]'](0));
        return result;
      };

      def.$_reduce_444 = function(val, _values, result) {
        var self = this;

        result = self.$new___LINE__(val['$[]'](0));
        return result;
      };

      def.$_reduce_445 = function(val, _values, result) {
        var self = this;

        result = self.$new_var_ref(val['$[]'](0));
        return result;
      };

      def.$_reduce_446 = function(val, _values, result) {
        var self = this;

        result = self.$new_assignable(val['$[]'](0));
        return result;
      };

      def.$_reduce_447 = function(val, _values, result) {
        var self = this;

        result = self.$s("nth_ref", self.$value(val['$[]'](0)));
        return result;
      };

      def.$_reduce_449 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_450 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_451 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_452 = function(val, _values, result) {
        var $a, $b, self = this;

        result = val['$[]'](1);
        (($a = ["expr_beg"]), $b = self.$lexer(), $b['$lex_state='].apply($b, $a), $a[$a.length-1]);
        return result;
      };

      def.$_reduce_453 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_454 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(val['$[]'](0), val['$[]'](2), val['$[]'](4), val['$[]'](5));
        return result;
      };

      def.$_reduce_455 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(val['$[]'](0), val['$[]'](2), nil, val['$[]'](3));
        return result;
      };

      def.$_reduce_456 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(val['$[]'](0), nil, val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_457 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(val['$[]'](0), nil, nil, val['$[]'](1));
        return result;
      };

      def.$_reduce_458 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(nil, val['$[]'](0), val['$[]'](2), val['$[]'](3));
        return result;
      };

      def.$_reduce_459 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(nil, val['$[]'](0), nil, val['$[]'](1));
        return result;
      };

      def.$_reduce_460 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(nil, nil, val['$[]'](0), val['$[]'](1));
        return result;
      };

      def.$_reduce_461 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(nil, nil, nil, val['$[]'](0));
        return result;
      };

      def.$_reduce_462 = function(val, _values, result) {
        var self = this;

        result = self.$new_args(nil, nil, nil, nil);
        return result;
      };

      def.$_reduce_464 = function(val, _values, result) {
        var self = this;

        result = self.$value(val['$[]'](0)).$to_sym();
        self.$scope().$add_local(result);
        return result;
      };

      def.$_reduce_465 = function(val, _values, result) {
        var self = this;

        self.$raise("formal argument cannot be a constant");
        return result;
      };

      def.$_reduce_466 = function(val, _values, result) {
        var self = this;

        self.$raise("formal argument cannot be an instance variable");
        return result;
      };

      def.$_reduce_467 = function(val, _values, result) {
        var self = this;

        self.$raise("formal argument cannot be a class variable");
        return result;
      };

      def.$_reduce_468 = function(val, _values, result) {
        var self = this;

        self.$raise("formal argument cannot be a global variable");
        return result;
      };

      def.$_reduce_469 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_470 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_473 = function(val, _values, result) {
        var self = this;

        result = self.$s("lasgn", val['$[]'](0));
        return result;
      };

      def.$_reduce_475 = function(val, _values, result) {
        var self = this;

        result = self.$s("array", val['$[]'](0));
        return result;
      };

      def.$_reduce_476 = function(val, _values, result) {
        var self = this;

        val['$[]'](0)['$<<'](val['$[]'](2));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_482 = function(val, _values, result) {
        var self = this;

        result = [val['$[]'](0)];
        return result;
      };

      def.$_reduce_483 = function(val, _values, result) {
        var self = this;

        val['$[]'](0)['$<<'](val['$[]'](2));
        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_484 = function(val, _values, result) {
        var self = this;

        result = self.$new_assign(self.$new_assignable(self.$new_ident(val['$[]'](0))), val['$[]'](1), val['$[]'](2));
        return result;
      };

      def.$_reduce_485 = function(val, _values, result) {
        var self = this;

        result = self.$s("block", val['$[]'](0));
        return result;
      };

      def.$_reduce_486 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        val['$[]'](0)['$<<'](val['$[]'](2));
        return result;
      };

      def.$_reduce_489 = function(val, _values, result) {
        var self = this;

        result = (("*") + (self.$value(val['$[]'](1)))).$to_sym();
        return result;
      };

      def.$_reduce_490 = function(val, _values, result) {
        var self = this;

        result = "*";
        return result;
      };

      def.$_reduce_493 = function(val, _values, result) {
        var self = this;

        result = (("&") + (self.$value(val['$[]'](1)))).$to_sym();
        return result;
      };

      def.$_reduce_494 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_495 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      def.$_reduce_496 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_497 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](1);
        return result;
      };

      def.$_reduce_498 = function(val, _values, result) {
        var self = this;

        result = [];
        return result;
      };

      def.$_reduce_499 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_500 = function(val, _values, result) {
        var self = this;

        result = val['$[]'](0);
        return result;
      };

      def.$_reduce_501 = function(val, _values, result) {
        var $a, self = this;

        result = ($a = val['$[]'](0)).$push.apply($a, [].concat(val['$[]'](2)));
        return result;
      };

      def.$_reduce_502 = function(val, _values, result) {
        var self = this;

        result = [val['$[]'](0), val['$[]'](2)];
        return result;
      };

      def.$_reduce_503 = function(val, _values, result) {
        var self = this;

        result = [self.$new_sym(val['$[]'](0)), val['$[]'](1)];
        return result;
      };

      def.$_reduce_527 = function(val, _values, result) {
        var self = this;

        result = nil;
        return result;
      };

      return (def.$_reduce_none = function(val, _values, result) {
        var self = this;

        return val['$[]'](0);
      }, nil) && '_reduce_none';
    })(self, (($scope.get('Racc')).$$scope.get('Parser')))
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/parser/parser_scope"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$attr_reader', '$attr_accessor', '$==', '$<<', '$include?', '$has_local?']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $ParserScope(){};
      var self = $ParserScope = $klass($base, $super, 'ParserScope', $ParserScope);

      var def = self.$$proto, $scope = self.$$scope;

      def.locals = def.parent = def.block = nil;
      self.$attr_reader("locals");

      self.$attr_accessor("parent");

      def.$initialize = function(type) {
        var self = this;

        self.block = type['$==']("block");
        self.locals = [];
        return self.parent = nil;
      };

      def.$add_local = function(local) {
        var self = this;

        return self.locals['$<<'](local);
      };

      return (def['$has_local?'] = function(local) {
        var $a, $b, self = this;

        if ((($a = self.locals['$include?'](local)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return true};
        if ((($a = ($b = self.parent, $b !== false && $b !== nil ?self.block : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.parent['$has_local?'](local)};
        return false;
      }, nil) && 'has_local?';
    })(self, null)
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/parser"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $gvars = Opal.gvars, $range = Opal.range;

  Opal.add_stubs(['$require', '$attr_reader', '$new', '$parser=', '$parse_to_sexp', '$puts', '$line', '$lexer', '$column', '$[]', '$split', '$-', '$+', '$*', '$raise', '$push_scope', '$do_parse', '$pop_scope', '$next_token', '$last', '$parent=', '$<<', '$pop', '$inspect', '$value', '$token_to_str', '$s', '$source=', '$s0', '$source', '$s1', '$file', '$to_sym', '$nil?', '$==', '$length', '$size', '$type', '$each', '$!', '$add_local', '$scope', '$to_s', '$empty?', '$is_a?', '$new_splat', '$new_call', '$[]=', '$array', '$-@', '$===', '$new_gettable', '$type=', '$has_local?', '$>']);
  self.$require("opal/parser/sexp");
  self.$require("opal/parser/lexer");
  self.$require("opal/parser/grammar");
  self.$require("opal/parser/parser_scope");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $Parser(){};
      var self = $Parser = $klass($base, $super, 'Parser', $Parser);

      var def = self.$$proto, $scope = self.$$scope;

      def.lexer = def.file = def.scopes = nil;
      self.$attr_reader("lexer", "file", "scope");

      def.$parse = function(source, file) {
        var $a, $b, self = this, e = nil;
        if ($gvars.DEBUG == null) $gvars.DEBUG = nil;
        if ($gvars.VERBOSE == null) $gvars.VERBOSE = nil;
        if ($gvars.stderr == null) $gvars.stderr = nil;

        if (file == null) {
          file = "(string)"
        }
        try {
        self.file = file;
          self.scopes = [];
          self.lexer = $scope.get('Lexer').$new(source, file);
          (($a = [self]), $b = self.lexer, $b['$parser='].apply($b, $a), $a[$a.length-1]);
          return self.$parse_to_sexp();
        } catch ($err) {if (true) {e = $err;
          if ((($a = ((($b = $gvars.DEBUG) !== false && $b !== nil) ? $b : $gvars.VERBOSE)) !== nil && (!$a.$$is_boolean || $a == true))) {
            $gvars.stderr.$puts();
            $gvars.stderr.$puts(e);
            $gvars.stderr.$puts("Source: " + (self.file) + ":" + (self.$lexer().$line()) + ":" + (self.$lexer().$column()));
            $gvars.stderr.$puts(source.$split("\n")['$[]'](self.$lexer().$line()['$-'](1)));
            $gvars.stderr.$puts("~"['$*'](self.$lexer().$column())['$+']("^"));};
          return self.$raise(e);
          }else { throw $err; }
        };
      };

      def.$parse_to_sexp = function() {
        var self = this, result = nil;

        self.$push_scope();
        result = self.$do_parse();
        self.$pop_scope();
        return result;
      };

      def.$next_token = function() {
        var self = this;

        return self.lexer.$next_token();
      };

      def.$s = function(parts) {
        var self = this;

        parts = $slice.call(arguments, 0);
        return $scope.get('Sexp').$new(parts);
      };

      def.$push_scope = function(type) {
        var $a, $b, self = this, top = nil, scope = nil;

        if (type == null) {
          type = nil
        }
        top = self.scopes.$last();
        scope = $scope.get('ParserScope').$new(type);
        (($a = [top]), $b = scope, $b['$parent='].apply($b, $a), $a[$a.length-1]);
        self.scopes['$<<'](scope);
        return self.scope = scope;
      };

      def.$pop_scope = function() {
        var self = this;

        self.scopes.$pop();
        return self.scope = self.scopes.$last();
      };

      def.$on_error = function(t, val, vstack) {
        var $a, self = this;

        return self.$raise("parse error on value " + (self.$value(val).$inspect()) + " (" + (((($a = self.$token_to_str(t)) !== false && $a !== nil) ? $a : "?")) + ") :" + (self.file) + ":" + (self.$lexer().$line()));
      };

      def.$value = function(tok) {
        var self = this;

        return tok['$[]'](0);
      };

      def.$source = function(tok) {
        var self = this;

        if (tok !== false && tok !== nil) {
          return tok['$[]'](1)
          } else {
          return nil
        };
      };

      def.$s0 = function(type, source) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s(type);
        (($a = [source]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$s1 = function(type, first, source) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s(type, first);
        (($a = [source]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_nil = function(tok) {
        var self = this;

        return self.$s0("nil", self.$source(tok));
      };

      def.$new_self = function(tok) {
        var self = this;

        return self.$s0("self", self.$source(tok));
      };

      def.$new_true = function(tok) {
        var self = this;

        return self.$s0("true", self.$source(tok));
      };

      def.$new_false = function(tok) {
        var self = this;

        return self.$s0("false", self.$source(tok));
      };

      def.$new___FILE__ = function(tok) {
        var self = this;

        return self.$s1("str", self.$file(), self.$source(tok));
      };

      def.$new___LINE__ = function(tok) {
        var self = this;

        return self.$s1("int", self.$lexer().$line(), self.$source(tok));
      };

      def.$new_ident = function(tok) {
        var self = this;

        return self.$s1("identifier", self.$value(tok).$to_sym(), self.$source(tok));
      };

      def.$new_int = function(tok) {
        var self = this;

        return self.$s1("int", self.$value(tok), self.$source(tok));
      };

      def.$new_float = function(tok) {
        var self = this;

        return self.$s1("float", self.$value(tok), self.$source(tok));
      };

      def.$new_ivar = function(tok) {
        var self = this;

        return self.$s1("ivar", self.$value(tok).$to_sym(), self.$source(tok));
      };

      def.$new_gvar = function(tok) {
        var self = this;

        return self.$s1("gvar", self.$value(tok).$to_sym(), self.$source(tok));
      };

      def.$new_cvar = function(tok) {
        var self = this;

        return self.$s1("cvar", self.$value(tok).$to_sym(), self.$source(tok));
      };

      def.$new_const = function(tok) {
        var self = this;

        return self.$s1("const", self.$value(tok).$to_sym(), self.$source(tok));
      };

      def.$new_colon2 = function(lhs, tok, name) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("colon2", lhs, self.$value(name).$to_sym());
        (($a = [self.$source(tok)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_colon3 = function(tok, name) {
        var self = this;

        return self.$s1("colon3", self.$value(name).$to_sym(), self.$source(name));
      };

      def.$new_sym = function(tok) {
        var self = this;

        return self.$s1("sym", self.$value(tok).$to_sym(), self.$source(tok));
      };

      def.$new_alias = function(kw, new$, old) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("alias", new$, old);
        (($a = [self.$source(kw)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_break = function(kw, args) {
        var $a, self = this, sexp = nil;

        if (args == null) {
          args = nil
        }
        if ((($a = args['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          sexp = self.$s("break")
        } else if (args.$length()['$=='](1)) {
          sexp = self.$s("break", args['$[]'](0))
          } else {
          sexp = self.$s("break", ($a = self).$s.apply($a, ["array"].concat(args)))
        };
        return sexp;
      };

      def.$new_return = function(kw, args) {
        var $a, self = this, sexp = nil;

        if (args == null) {
          args = nil
        }
        if ((($a = args['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          sexp = self.$s("return")
        } else if (args.$length()['$=='](1)) {
          sexp = self.$s("return", args['$[]'](0))
          } else {
          sexp = self.$s("return", ($a = self).$s.apply($a, ["array"].concat(args)))
        };
        return sexp;
      };

      def.$new_next = function(kw, args) {
        var $a, self = this, sexp = nil;

        if (args == null) {
          args = []
        }
        if (args.$length()['$=='](1)) {
          sexp = self.$s("next", args['$[]'](0))
          } else {
          sexp = self.$s("next", ($a = self).$s.apply($a, ["array"].concat(args)))
        };
        return sexp;
      };

      def.$new_block = function(stmt) {
        var self = this, sexp = nil;

        if (stmt == null) {
          stmt = nil
        }
        sexp = self.$s("block");
        if (stmt !== false && stmt !== nil) {
          sexp['$<<'](stmt)};
        return sexp;
      };

      def.$new_compstmt = function(block) {
        var $a, $b, $c, self = this, comp = nil, result = nil;

        comp = (function() {if (block.$size()['$=='](1)) {
          return nil
        } else if (block.$size()['$=='](2)) {
          return block['$[]'](1)
          } else {
          return block
        }; return nil; })();
        if ((($a = ($b = (($c = comp !== false && comp !== nil) ? comp.$type()['$==']("begin") : $c), $b !== false && $b !== nil ?comp.$size()['$=='](2) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          result = comp['$[]'](1)
          } else {
          result = comp
        };
        return result;
      };

      def.$new_body = function(compstmt, res, els, ens) {
        var $a, $b, TMP_1, self = this, s = nil;

        s = ((($a = compstmt) !== false && $a !== nil) ? $a : self.$s("block"));
        if (res !== false && res !== nil) {
          s = self.$s("rescue", s);
          ($a = ($b = res).$each, $a.$$p = (TMP_1 = function(r){var self = TMP_1.$$s || this;
if (r == null) r = nil;
          return s['$<<'](r)}, TMP_1.$$s = self, TMP_1), $a).call($b);
          if (els !== false && els !== nil) {
            s['$<<'](els)};};
        if (ens !== false && ens !== nil) {
          return self.$s("ensure", s, ens)
          } else {
          return s
        };
      };

      def.$new_def = function(kw, recv, name, args, body, end_tok) {
        var $a, $b, self = this, sexp = nil;

        if ((($a = body.$type()['$==']("block")['$!']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          body = self.$s("block", body)};
        if (body.$size()['$=='](1)) {
          body['$<<'](self.$s("nil"))};
        sexp = self.$s("def", recv, self.$value(name).$to_sym(), args, body);
        (($a = [self.$source(kw)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_class = function(start, path, sup, body, endt) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("class", path, sup, body);
        (($a = [self.$source(start)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_sclass = function(kw, expr, body, end_tok) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("sclass", expr, body);
        (($a = [self.$source(kw)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_module = function(kw, path, body, end_tok) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("module", path, body);
        (($a = [self.$source(kw)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_iter = function(args, body) {
        var $a, self = this, s = nil;

        ((($a = args) !== false && $a !== nil) ? $a : args = nil);
        s = self.$s("iter", args);
        if (body !== false && body !== nil) {
          s['$<<'](body)};
        return s;
      };

      def.$new_if = function(if_tok, expr, stmt, tail) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("if", expr, stmt, tail);
        (($a = [self.$source(if_tok)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_while = function(kw, test, body) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("while", test, body);
        (($a = [self.$source(kw)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_until = function(kw, test, body) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("until", test, body);
        (($a = [self.$source(kw)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_rescue_mod = function(kw, expr, resc) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("rescue_mod", expr, resc);
        (($a = [self.$source(kw)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_array = function(start, args, finish) {
        var $a, $b, $c, self = this, sexp = nil;

        ((($a = args) !== false && $a !== nil) ? $a : args = []);
        sexp = ($a = self).$s.apply($a, ["array"].concat(args));
        (($b = [self.$source(start)]), $c = sexp, $c['$source='].apply($c, $b), $b[$b.length-1]);
        return sexp;
      };

      def.$new_hash = function(open, assocs, close) {
        var $a, $b, $c, self = this, sexp = nil;

        sexp = ($a = self).$s.apply($a, ["hash"].concat(assocs));
        (($b = [self.$source(open)]), $c = sexp, $c['$source='].apply($c, $b), $b[$b.length-1]);
        return sexp;
      };

      def.$new_not = function(kw, expr) {
        var self = this;

        return self.$s1("not", expr, self.$source(kw));
      };

      def.$new_paren = function(open, expr, close) {
        var $a, $b, self = this;

        if ((($a = ((($b = expr['$nil?']()) !== false && $b !== nil) ? $b : expr['$=='](["block"]))) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$s1("paren", self.$s0("nil", self.$source(open)), self.$source(open))
          } else {
          return self.$s1("paren", expr, self.$source(open))
        };
      };

      def.$new_args = function(norm, opt, rest, block) {
        var $a, $b, TMP_2, $c, TMP_3, self = this, res = nil, rest_str = nil;

        res = self.$s("args");
        if (norm !== false && norm !== nil) {
          ($a = ($b = norm).$each, $a.$$p = (TMP_2 = function(arg){var self = TMP_2.$$s || this;
if (arg == null) arg = nil;
          self.$scope().$add_local(arg);
            return res['$<<'](arg);}, TMP_2.$$s = self, TMP_2), $a).call($b)};
        if (opt !== false && opt !== nil) {
          ($a = ($c = opt['$[]']($range(1, -1, false))).$each, $a.$$p = (TMP_3 = function(_opt){var self = TMP_3.$$s || this;
if (_opt == null) _opt = nil;
          return res['$<<'](_opt['$[]'](1))}, TMP_3.$$s = self, TMP_3), $a).call($c)};
        if (rest !== false && rest !== nil) {
          res['$<<'](rest);
          rest_str = rest.$to_s()['$[]']($range(1, -1, false));
          if ((($a = rest_str['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            self.$scope().$add_local(rest_str.$to_sym())
          };};
        if (block !== false && block !== nil) {
          res['$<<'](block);
          self.$scope().$add_local(block.$to_s()['$[]']($range(1, -1, false)).$to_sym());};
        if (opt !== false && opt !== nil) {
          res['$<<'](opt)};
        return res;
      };

      def.$new_block_args = function(norm, opt, rest, block) {
        var $a, $b, TMP_4, $c, TMP_5, $d, self = this, res = nil, r = nil, b = nil, args = nil;

        res = self.$s("array");
        if (norm !== false && norm !== nil) {
          ($a = ($b = norm).$each, $a.$$p = (TMP_4 = function(arg){var self = TMP_4.$$s || this, $a;
if (arg == null) arg = nil;
          if ((($a = arg['$is_a?']($scope.get('Symbol'))) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$scope().$add_local(arg);
              return res['$<<'](self.$s("lasgn", arg));
              } else {
              return res['$<<'](arg)
            }}, TMP_4.$$s = self, TMP_4), $a).call($b)};
        if (opt !== false && opt !== nil) {
          ($a = ($c = opt['$[]']($range(1, -1, false))).$each, $a.$$p = (TMP_5 = function(_opt){var self = TMP_5.$$s || this;
if (_opt == null) _opt = nil;
          return res['$<<'](self.$s("lasgn", _opt['$[]'](1)))}, TMP_5.$$s = self, TMP_5), $a).call($c)};
        if (rest !== false && rest !== nil) {
          r = rest.$to_s()['$[]']($range(1, -1, false)).$to_sym();
          res['$<<'](self.$new_splat(nil, self.$s("lasgn", r)));
          self.$scope().$add_local(r);};
        if (block !== false && block !== nil) {
          b = block.$to_s()['$[]']($range(1, -1, false)).$to_sym();
          res['$<<'](self.$s("block_pass", self.$s("lasgn", b)));
          self.$scope().$add_local(b);};
        if (opt !== false && opt !== nil) {
          res['$<<'](opt)};
        args = (function() {if ((($a = (($d = res.$size()['$=='](2)) ? norm : $d)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return res['$[]'](1)
          } else {
          return self.$s("masgn", res)
        }; return nil; })();
        if (args.$type()['$==']("array")) {
          return self.$s("masgn", args)
          } else {
          return args
        };
      };

      def.$new_call = function(recv, meth, args) {
        var $a, $b, $c, self = this, sexp = nil;

        if (args == null) {
          args = nil
        }
        ((($a = args) !== false && $a !== nil) ? $a : args = []);
        sexp = self.$s("call", recv, self.$value(meth).$to_sym(), ($a = self).$s.apply($a, ["arglist"].concat(args)));
        (($b = [self.$source(meth)]), $c = sexp, $c['$source='].apply($c, $b), $b[$b.length-1]);
        return sexp;
      };

      def.$new_binary_call = function(recv, meth, arg) {
        var self = this;

        return self.$new_call(recv, meth, [arg]);
      };

      def.$new_unary_call = function(op, recv) {
        var self = this;

        return self.$new_call(recv, op, []);
      };

      def.$new_and = function(lhs, tok, rhs) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("and", lhs, rhs);
        (($a = [self.$source(tok)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_or = function(lhs, tok, rhs) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("or", lhs, rhs);
        (($a = [self.$source(tok)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_irange = function(beg, op, finish) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("irange", beg, finish);
        (($a = [self.$source(op)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$new_erange = function(beg, op, finish) {
        var $a, $b, self = this, sexp = nil;

        sexp = self.$s("erange", beg, finish);
        (($a = [self.$source(op)]), $b = sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return sexp;
      };

      def.$negate_num = function(sexp) {
        var self = this;

        sexp.$array()['$[]='](1, sexp.$array()['$[]'](1)['$-@']());
        return sexp;
      };

      def.$add_block_pass = function(arglist, block) {
        var self = this;

        if (block !== false && block !== nil) {
          arglist['$<<'](block)};
        return arglist;
      };

      def.$new_block_pass = function(amper_tok, val) {
        var self = this;

        return self.$s1("block_pass", val, self.$source(amper_tok));
      };

      def.$new_splat = function(tok, value) {
        var self = this;

        return self.$s1("splat", value, self.$source(tok));
      };

      def.$new_op_asgn = function(op, lhs, rhs) {
        var self = this, $case = nil, result = nil;

        $case = self.$value(op).$to_sym();if ("||"['$===']($case)) {result = self.$s("op_asgn_or", self.$new_gettable(lhs));
        result['$<<']((lhs['$<<'](rhs)));}else if ("&&"['$===']($case)) {result = self.$s("op_asgn_and", self.$new_gettable(lhs));
        result['$<<']((lhs['$<<'](rhs)));}else {result = lhs;
        result['$<<'](self.$new_call(self.$new_gettable(lhs), op, [rhs]));};
        return result;
      };

      def.$new_op_asgn1 = function(lhs, args, op, rhs) {
        var $a, $b, $c, self = this, arglist = nil, sexp = nil;

        arglist = ($a = self).$s.apply($a, ["arglist"].concat(args));
        sexp = self.$s("op_asgn1", lhs, arglist, self.$value(op), rhs);
        (($b = [self.$source(op)]), $c = sexp, $c['$source='].apply($c, $b), $b[$b.length-1]);
        return sexp;
      };

      def.$op_to_setter = function(op) {
        var self = this;

        return ((("") + (self.$value(op))) + "=").$to_sym();
      };

      def.$new_attrasgn = function(recv, op, args) {
        var $a, self = this, arglist = nil, sexp = nil;

        if (args == null) {
          args = []
        }
        arglist = ($a = self).$s.apply($a, ["arglist"].concat(args));
        sexp = self.$s("attrasgn", recv, op, arglist);
        return sexp;
      };

      def.$new_assign = function(lhs, tok, rhs) {
        var $a, $b, self = this, $case = nil;

        return (function() {$case = lhs.$type();if ("iasgn"['$===']($case) || "cdecl"['$===']($case) || "lasgn"['$===']($case) || "gasgn"['$===']($case) || "cvdecl"['$===']($case) || "nth_ref"['$===']($case)) {lhs['$<<'](rhs);
        return lhs;}else if ("call"['$===']($case) || "attrasgn"['$===']($case)) {lhs.$last()['$<<'](rhs);
        return lhs;}else if ("colon2"['$===']($case)) {lhs['$<<'](rhs);
        (($a = ["casgn"]), $b = lhs, $b['$type='].apply($b, $a), $a[$a.length-1]);
        return lhs;}else if ("colon3"['$===']($case)) {lhs['$<<'](rhs);
        (($a = ["casgn3"]), $b = lhs, $b['$type='].apply($b, $a), $a[$a.length-1]);
        return lhs;}else {return self.$raise("Bad lhs for new_assign: " + (lhs.$type()))}})();
      };

      def.$new_assignable = function(ref) {
        var $a, $b, self = this, $case = nil;

        $case = ref.$type();if ("ivar"['$===']($case)) {(($a = ["iasgn"]), $b = ref, $b['$type='].apply($b, $a), $a[$a.length-1])}else if ("const"['$===']($case)) {(($a = ["cdecl"]), $b = ref, $b['$type='].apply($b, $a), $a[$a.length-1])}else if ("identifier"['$===']($case)) {if ((($a = self.$scope()['$has_local?'](ref['$[]'](1))) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          self.$scope().$add_local(ref['$[]'](1))
        };
        (($a = ["lasgn"]), $b = ref, $b['$type='].apply($b, $a), $a[$a.length-1]);}else if ("gvar"['$===']($case)) {(($a = ["gasgn"]), $b = ref, $b['$type='].apply($b, $a), $a[$a.length-1])}else if ("cvar"['$===']($case)) {(($a = ["cvdecl"]), $b = ref, $b['$type='].apply($b, $a), $a[$a.length-1])}else {self.$raise($scope.get('SyntaxError'), "Bad new_assignable type: " + (ref.$type()))};
        return ref;
      };

      def.$new_gettable = function(ref) {
        var $a, $b, self = this, res = nil, $case = nil;

        res = (function() {$case = ref.$type();if ("lasgn"['$===']($case)) {return self.$s("lvar", ref['$[]'](1))}else if ("iasgn"['$===']($case)) {return self.$s("ivar", ref['$[]'](1))}else if ("gasgn"['$===']($case)) {return self.$s("gvar", ref['$[]'](1))}else if ("cvdecl"['$===']($case)) {return self.$s("cvar", ref['$[]'](1))}else if ("cdecl"['$===']($case)) {return self.$s("const", ref['$[]'](1))}else {return self.$raise("Bad new_gettable ref: " + (ref.$type()))}})();
        (($a = [ref.$source()]), $b = res, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return res;
      };

      def.$new_var_ref = function(ref) {
        var $a, $b, self = this, $case = nil, result = nil;

        return (function() {$case = ref.$type();if ("self"['$===']($case) || "nil"['$===']($case) || "true"['$===']($case) || "false"['$===']($case) || "line"['$===']($case) || "file"['$===']($case)) {return ref}else if ("const"['$===']($case)) {return ref}else if ("ivar"['$===']($case) || "gvar"['$===']($case) || "cvar"['$===']($case)) {return ref}else if ("int"['$===']($case)) {return ref}else if ("str"['$===']($case)) {return ref}else if ("identifier"['$===']($case)) {result = (function() {if ((($a = self.$scope()['$has_local?'](ref['$[]'](1))) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$s("lvar", ref['$[]'](1))
          } else {
          return self.$s("call", nil, ref['$[]'](1), self.$s("arglist"))
        }; return nil; })();
        (($a = [ref.$source()]), $b = result, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return result;}else {return self.$raise("Bad var_ref type: " + (ref.$type()))}})();
      };

      def.$new_super = function(kw, args) {
        var $a, $b, $c, self = this, sexp = nil;

        if ((($a = args['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          sexp = self.$s("super", nil)
          } else {
          sexp = self.$s("super", ($a = self).$s.apply($a, ["arglist"].concat(args)))
        };
        (($b = [self.$source(kw)]), $c = sexp, $c['$source='].apply($c, $b), $b[$b.length-1]);
        return sexp;
      };

      def.$new_yield = function(args) {
        var $a, self = this;

        ((($a = args) !== false && $a !== nil) ? $a : args = []);
        return ($a = self).$s.apply($a, ["yield"].concat(args));
      };

      def.$new_xstr = function(start_t, str, end_t) {
        var $a, $b, self = this, $case = nil;

        if (str !== false && str !== nil) {
          } else {
          return self.$s("xstr", "")
        };
        $case = str.$type();if ("str"['$===']($case)) {(($a = ["xstr"]), $b = str, $b['$type='].apply($b, $a), $a[$a.length-1])}else if ("dstr"['$===']($case)) {(($a = ["dxstr"]), $b = str, $b['$type='].apply($b, $a), $a[$a.length-1])}else if ("evstr"['$===']($case)) {str = self.$s("dxstr", "", str)};
        (($a = [self.$source(start_t)]), $b = str, $b['$source='].apply($b, $a), $a[$a.length-1]);
        return str;
      };

      def.$new_dsym = function(str) {
        var $a, $b, self = this, $case = nil;

        if (str !== false && str !== nil) {
          } else {
          return self.$s("sym", "")
        };
        $case = str.$type();if ("str"['$===']($case)) {(($a = ["sym"]), $b = str, $b['$type='].apply($b, $a), $a[$a.length-1]);
        str['$[]='](1, str['$[]'](1).$to_sym());}else if ("dstr"['$===']($case)) {(($a = ["dsym"]), $b = str, $b['$type='].apply($b, $a), $a[$a.length-1])}else if ("evstr"['$===']($case)) {str = self.$s("dsym", str)};
        return str;
      };

      def.$new_evstr = function(str) {
        var self = this;

        return self.$s("evstr", str);
      };

      def.$new_str = function(str) {
        var $a, $b, $c, self = this;

        if (str !== false && str !== nil) {
          } else {
          return self.$s("str", "")
        };
        if ((($a = ($b = (($c = str.$size()['$=='](3)) ? str['$[]'](1)['$==']("") : $c), $b !== false && $b !== nil ?str.$type()['$==']("str") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return str['$[]'](2)
        } else if ((($a = (($b = str.$type()['$==']("str")) ? str.$size()['$>'](3) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          (($a = ["dstr"]), $b = str, $b['$type='].apply($b, $a), $a[$a.length-1]);
          return str;
        } else if (str.$type()['$==']("evstr")) {
          return self.$s("dstr", "", str)
          } else {
          return str
        };
      };

      def.$new_regexp = function(reg, ending) {
        var $a, $b, self = this, $case = nil;

        if (reg !== false && reg !== nil) {
          } else {
          return self.$s("regexp", "")
        };
        return (function() {$case = reg.$type();if ("str"['$===']($case)) {return self.$s("regexp", reg['$[]'](1), self.$value(ending))}else if ("evstr"['$===']($case)) {return self.$s("dregx", "", reg)}else if ("dstr"['$===']($case)) {(($a = ["dregx"]), $b = reg, $b['$type='].apply($b, $a), $a[$a.length-1]);
        return reg;}else { return nil }})();
      };

      def.$str_append = function(str, str2) {
        var self = this;

        if (str !== false && str !== nil) {
          } else {
          return str2
        };
        if (str2 !== false && str2 !== nil) {
          } else {
          return str
        };
        if (str.$type()['$==']("evstr")) {
          str = self.$s("dstr", "", str)
        } else if (str.$type()['$==']("str")) {
          str = self.$s("dstr", str['$[]'](1))};
        str['$<<'](str2);
        return str;
      };

      return (def.$new_str_content = function(tok) {
        var self = this;

        return self.$s1("str", self.$value(tok), self.$source(tok));
      }, nil) && 'new_str_content';
    })(self, (($scope.get('Racc')).$$scope.get('Parser')))
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/fragment"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$attr_reader', '$to_s', '$line', '$column', '$inspect']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base, $super) {
      function $Fragment(){};
      var self = $Fragment = $klass($base, $super, 'Fragment', $Fragment);

      var def = self.$$proto, $scope = self.$$scope;

      def.sexp = def.code = nil;
      self.$attr_reader("code");

      def.$initialize = function(code, sexp) {
        var self = this;

        if (sexp == null) {
          sexp = nil
        }
        self.code = code.$to_s();
        return self.sexp = sexp;
      };

      def.$to_code = function() {
        var $a, self = this;

        if ((($a = self.sexp) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "/*:" + (self.sexp.$line()) + ":" + (self.sexp.$column()) + "*/" + (self.code)
          } else {
          return self.code
        };
      };

      def.$inspect = function() {
        var self = this;

        return "f(" + (self.code.$inspect()) + ")";
      };

      def.$line = function() {
        var $a, self = this;

        if ((($a = self.sexp) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.sexp.$line()
          } else {
          return nil
        };
      };

      return (def.$column = function() {
        var $a, self = this;

        if ((($a = self.sexp) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.sexp.$column()
          } else {
          return nil
        };
      }, nil) && 'column';
    })(self, null)
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/helpers"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module;

  Opal.add_stubs(['$valid_name?', '$inspect', '$=~', '$!', '$to_s', '$to_sym', '$+', '$indent', '$to_proc', '$compiler', '$parser_indent', '$push', '$current_indent', '$js_truthy_optimize', '$with_temp', '$fragment', '$expr', '$==', '$type', '$[]', '$uses_block!', '$scope', '$block_name', '$include?', '$dup']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base) {
        var self = $module($base, 'Helpers');

        var def = self.$$proto, $scope = self.$$scope, TMP_1;

        Opal.cdecl($scope, 'ES51_RESERVED_WORD', /^(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/);

        Opal.cdecl($scope, 'ES3_RESERVED_WORD_EXCLUSIVE', /^(?:int|byte|char|goto|long|final|float|short|double|native|throws|boolean|abstract|volatile|transient|synchronized)$/);

        Opal.cdecl($scope, 'IMMUTABLE_PROPS', /^(?:NaN|Infinity|undefined)$/);

        Opal.cdecl($scope, 'BASIC_IDENTIFIER_RULES', /^[$_a-z][$_a-z\d]*$/i);

        def.$property = function(name) {
          var $a, self = this;

          if ((($a = self['$valid_name?'](name)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return "." + (name)
            } else {
            return "[" + (name.$inspect()) + "]"
          };
        };

        def['$valid_name?'] = function(name) {
          var $a, $b, $c, self = this;

          return ($a = $scope.get('BASIC_IDENTIFIER_RULES')['$=~'](name), $a !== false && $a !== nil ?(((($b = ((($c = $scope.get('ES51_RESERVED_WORD')['$=~'](name)) !== false && $c !== nil) ? $c : $scope.get('ES3_RESERVED_WORD_EXCLUSIVE')['$=~'](name))) !== false && $b !== nil) ? $b : $scope.get('IMMUTABLE_PROPS')['$=~'](name)))['$!']() : $a);
        };

        def.$variable = function(name) {
          var $a, self = this;

          if ((($a = self['$valid_name?'](name.$to_s())) !== nil && (!$a.$$is_boolean || $a == true))) {
            return name
            } else {
            return "" + (name) + "$"
          };
        };

        def.$lvar_to_js = function(var$) {
          var $a, self = this;

          if ((($a = self['$valid_name?'](var$.$to_s())) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            var$ = "" + (var$) + "$"
          };
          return var$.$to_sym();
        };

        def.$mid_to_jsid = function(mid) {
          var $a, self = this;

          if ((($a = /\=|\+|\-|\*|\/|\!|\?|\<|\>|\&|\||\^|\%|\~|\[/['$=~'](mid.$to_s())) !== nil && (!$a.$$is_boolean || $a == true))) {
            return "['$" + (mid) + "']"
            } else {
            return ".$"['$+'](mid)
          };
        };

        def.$indent = TMP_1 = function() {
          var $a, $b, self = this, $iter = TMP_1.$$p, block = $iter || nil;

          TMP_1.$$p = null;
          return ($a = ($b = self.$compiler()).$indent, $a.$$p = block.$to_proc(), $a).call($b);
        };

        def.$current_indent = function() {
          var self = this;

          return self.$compiler().$parser_indent();
        };

        def.$line = function(strs) {
          var $a, self = this;

          strs = $slice.call(arguments, 0);
          self.$push("\n" + (self.$current_indent()));
          return ($a = self).$push.apply($a, [].concat(strs));
        };

        def.$empty_line = function() {
          var self = this;

          return self.$push("\n");
        };

        def.$js_truthy = function(sexp) {
          var $a, $b, TMP_2, self = this, optimize = nil;

          if ((($a = optimize = self.$js_truthy_optimize(sexp)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return optimize};
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_2 = function(tmp){var self = TMP_2.$$s || this;
if (tmp == null) tmp = nil;
          return [self.$fragment("((" + (tmp) + " = "), self.$expr(sexp), self.$fragment(") !== nil && (!" + (tmp) + ".$$is_boolean || " + (tmp) + " == true))")]}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };

        def.$js_falsy = function(sexp) {
          var $a, $b, TMP_3, self = this, mid = nil;

          if (sexp.$type()['$==']("call")) {
            mid = sexp['$[]'](2);
            if (mid['$==']("block_given?")) {
              self.$scope()['$uses_block!']();
              return "" + (self.$scope().$block_name()) + " === nil";};};
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_3 = function(tmp){var self = TMP_3.$$s || this;
if (tmp == null) tmp = nil;
          return [self.$fragment("((" + (tmp) + " = "), self.$expr(sexp), self.$fragment(") === nil || (" + (tmp) + ".$$is_boolean && " + (tmp) + " == false))")]}, TMP_3.$$s = self, TMP_3), $a).call($b);
        };

        def.$js_truthy_optimize = function(sexp) {
          var $a, self = this, mid = nil;

          if (sexp.$type()['$==']("call")) {
            mid = sexp['$[]'](2);
            if (mid['$==']("block_given?")) {
              return self.$expr(sexp)
            } else if ((($a = (($scope.get('Compiler')).$$scope.get('COMPARE'))['$include?'](mid.$to_s())) !== nil && (!$a.$$is_boolean || $a == true))) {
              return self.$expr(sexp)
            } else if (mid['$==']("==")) {
              return self.$expr(sexp)
              } else {
              return nil
            };
          } else if ((($a = ["lvar", "self"]['$include?'](sexp.$type())) !== nil && (!$a.$$is_boolean || $a == true))) {
            return [self.$expr(sexp.$dup()), self.$fragment(" !== false && "), self.$expr(sexp.$dup()), self.$fragment(" !== nil")]
            } else {
            return nil
          };
        };
                ;Opal.donate(self, ["$property", "$valid_name?", "$variable", "$lvar_to_js", "$mid_to_jsid", "$indent", "$current_indent", "$line", "$empty_line", "$js_truthy", "$js_falsy", "$js_truthy_optimize"]);
      })(self)
      
    })(self)
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/base"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $hash2 = Opal.hash2, $range = Opal.range;

  Opal.add_stubs(['$require', '$include', '$each', '$[]=', '$handlers', '$each_with_index', '$define_method', '$[]', '$+', '$attr_reader', '$type', '$compile', '$raise', '$is_a?', '$fragment', '$<<', '$unshift', '$reverse', '$push', '$new', '$error', '$scope', '$s', '$==', '$process', '$expr', '$add_scope_local', '$to_sym', '$add_scope_ivar', '$add_scope_gvar', '$add_scope_temp', '$helper', '$with_temp', '$to_proc', '$in_while?', '$instance_variable_get']);
  self.$require("opal/nodes/helpers");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $Base(){};
        var self = $Base = $klass($base, $super, 'Base', $Base);

        var def = self.$$proto, $scope = self.$$scope, TMP_6;

        def.sexp = def.fragments = def.compiler = def.level = nil;
        self.$include($scope.get('Helpers'));

        Opal.defs(self, '$handlers', function() {
          var $a, self = this;
          if (self.handlers == null) self.handlers = nil;

          return ((($a = self.handlers) !== false && $a !== nil) ? $a : self.handlers = $hash2([], {}));
        });

        Opal.defs(self, '$handle', function(types) {
          var $a, $b, TMP_1, self = this;

          types = $slice.call(arguments, 0);
          return ($a = ($b = types).$each, $a.$$p = (TMP_1 = function(type){var self = TMP_1.$$s || this;
if (type == null) type = nil;
          return $scope.get('Base').$handlers()['$[]='](type, self)}, TMP_1.$$s = self, TMP_1), $a).call($b);
        });

        Opal.defs(self, '$children', function(names) {
          var $a, $b, TMP_2, self = this;

          names = $slice.call(arguments, 0);
          return ($a = ($b = names).$each_with_index, $a.$$p = (TMP_2 = function(name, idx){var self = TMP_2.$$s || this, $a, $b, TMP_3;
if (name == null) name = nil;if (idx == null) idx = nil;
          return ($a = ($b = self).$define_method, $a.$$p = (TMP_3 = function(){var self = TMP_3.$$s || this;
              if (self.sexp == null) self.sexp = nil;

            return self.sexp['$[]'](idx['$+'](1))}, TMP_3.$$s = self, TMP_3), $a).call($b, name)}, TMP_2.$$s = self, TMP_2), $a).call($b);
        });

        self.$attr_reader("compiler", "type");

        def.$initialize = function(sexp, level, compiler) {
          var self = this;

          self.sexp = sexp;
          self.type = sexp.$type();
          self.level = level;
          return self.compiler = compiler;
        };

        def.$children = function() {
          var self = this;

          return self.sexp['$[]']($range(1, -1, false));
        };

        def.$compile_to_fragments = function() {
          var $a, $b, self = this;

          if ((($a = (($b = self['fragments'], $b != null && $b !== nil) ? 'instance-variable' : nil)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.fragments};
          self.fragments = [];
          self.$compile();
          return self.fragments;
        };

        def.$compile = function() {
          var self = this;

          return self.$raise("Not Implemented");
        };

        def.$push = function(strs) {
          var $a, $b, TMP_4, self = this;

          strs = $slice.call(arguments, 0);
          return ($a = ($b = strs).$each, $a.$$p = (TMP_4 = function(str){var self = TMP_4.$$s || this, $a;
            if (self.fragments == null) self.fragments = nil;
if (str == null) str = nil;
          if ((($a = str['$is_a?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
              str = self.$fragment(str)};
            return self.fragments['$<<'](str);}, TMP_4.$$s = self, TMP_4), $a).call($b);
        };

        def.$unshift = function(strs) {
          var $a, $b, TMP_5, self = this;

          strs = $slice.call(arguments, 0);
          return ($a = ($b = strs.$reverse()).$each, $a.$$p = (TMP_5 = function(str){var self = TMP_5.$$s || this, $a;
            if (self.fragments == null) self.fragments = nil;
if (str == null) str = nil;
          if ((($a = str['$is_a?']($scope.get('String'))) !== nil && (!$a.$$is_boolean || $a == true))) {
              str = self.$fragment(str)};
            return self.fragments.$unshift(str);}, TMP_5.$$s = self, TMP_5), $a).call($b);
        };

        def.$wrap = function(pre, post) {
          var self = this;

          self.$unshift(pre);
          return self.$push(post);
        };

        def.$fragment = function(str) {
          var self = this;

          return (($scope.get('Opal')).$$scope.get('Fragment')).$new(str, self.sexp);
        };

        def.$error = function(msg) {
          var self = this;

          return self.compiler.$error(msg);
        };

        def.$scope = function() {
          var self = this;

          return self.compiler.$scope();
        };

        def.$s = function(args) {
          var $a, self = this;

          args = $slice.call(arguments, 0);
          return ($a = self.compiler).$s.apply($a, [].concat(args));
        };

        def['$expr?'] = function() {
          var self = this;

          return self.level['$==']("expr");
        };

        def['$recv?'] = function() {
          var self = this;

          return self.level['$==']("recv");
        };

        def['$stmt?'] = function() {
          var self = this;

          return self.level['$==']("stmt");
        };

        def.$process = function(sexp, level) {
          var self = this;

          if (level == null) {
            level = "expr"
          }
          return self.compiler.$process(sexp, level);
        };

        def.$expr = function(sexp) {
          var self = this;

          return self.compiler.$process(sexp, "expr");
        };

        def.$recv = function(sexp) {
          var self = this;

          return self.compiler.$process(sexp, "recv");
        };

        def.$stmt = function(sexp) {
          var self = this;

          return self.compiler.$process(sexp, "stmt");
        };

        def.$expr_or_nil = function(sexp) {
          var self = this;

          if (sexp !== false && sexp !== nil) {
            return self.$expr(sexp)
            } else {
            return "nil"
          };
        };

        def.$add_local = function(name) {
          var self = this;

          return self.$scope().$add_scope_local(name.$to_sym());
        };

        def.$add_ivar = function(name) {
          var self = this;

          return self.$scope().$add_scope_ivar(name);
        };

        def.$add_gvar = function(name) {
          var self = this;

          return self.$scope().$add_scope_gvar(name);
        };

        def.$add_temp = function(temp) {
          var self = this;

          return self.$scope().$add_scope_temp(temp);
        };

        def.$helper = function(name) {
          var self = this;

          return self.compiler.$helper(name);
        };

        def.$with_temp = TMP_6 = function() {
          var $a, $b, self = this, $iter = TMP_6.$$p, block = $iter || nil;

          TMP_6.$$p = null;
          return ($a = ($b = self.compiler).$with_temp, $a.$$p = block.$to_proc(), $a).call($b);
        };

        def['$in_while?'] = function() {
          var self = this;

          return self.compiler['$in_while?']();
        };

        return (def.$while_loop = function() {
          var self = this;

          return self.compiler.$instance_variable_get("@while_loop");
        }, nil) && 'while_loop';
      })(self, null)
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/literal"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$push', '$to_s', '$type', '$children', '$value', '$recv?', '$wrap', '$inspect', '$===', '$new', '$flags', '$each_line', '$==', '$s', '$source=', '$+', '$line', '$include', '$stmt?', '$!', '$include?', '$compile_split_lines', '$needs_semicolon?', '$each_with_index', '$expr', '$[]', '$raise', '$last', '$each', '$requires_semicolon', '$helper', '$start', '$finish']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ValueNode(){};
        var self = $ValueNode = $klass($base, $super, 'ValueNode', $ValueNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("true", "false", "self", "nil");

        return (def.$compile = function() {
          var self = this;

          return self.$push(self.$type().$to_s());
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $NumericNode(){};
        var self = $NumericNode = $klass($base, $super, 'NumericNode', $NumericNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("int", "float");

        self.$children("value");

        return (def.$compile = function() {
          var $a, self = this;

          self.$push(self.$value().$to_s());
          if ((($a = self['$recv?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(", ")")
            } else {
            return nil
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $StringNode(){};
        var self = $StringNode = $klass($base, $super, 'StringNode', $StringNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("str");

        self.$children("value");

        return (def.$compile = function() {
          var self = this;

          return self.$push(self.$value().$inspect());
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $SymbolNode(){};
        var self = $SymbolNode = $klass($base, $super, 'SymbolNode', $SymbolNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("sym");

        self.$children("value");

        return (def.$compile = function() {
          var self = this;

          return self.$push(self.$value().$to_s().$inspect());
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $RegexpNode(){};
        var self = $RegexpNode = $klass($base, $super, 'RegexpNode', $RegexpNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("regexp");

        self.$children("value", "flags");

        return (def.$compile = function() {
          var self = this, $case = nil, message = nil;

          return (function() {$case = self.$value();if (""['$===']($case)) {return self.$push("/^/")}else if (/\?\<\w+\>/['$===']($case)) {message = "named captures are not supported in javascript: " + (self.$value().$inspect());
          return self.$push("self.$raise(new SyntaxError('" + (message) + "'))");}else {return self.$push("" + ($scope.get('Regexp').$new(self.$value()).$inspect()) + (self.$flags()))}})();
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base) {
        var self = $module($base, 'XStringLineSplitter');

        var def = self.$$proto, $scope = self.$$scope;

        def.$compile_split_lines = function(value, sexp) {
          var $a, $b, TMP_1, self = this, idx = nil;

          idx = 0;
          return ($a = ($b = value).$each_line, $a.$$p = (TMP_1 = function(line){var self = TMP_1.$$s || this, $a, $b, line_sexp = nil, frag = nil;
if (line == null) line = nil;
          if (idx['$=='](0)) {
              self.$push(line)
              } else {
              line_sexp = self.$s();
              (($a = [[sexp.$line()['$+'](idx), 0]]), $b = line_sexp, $b['$source='].apply($b, $a), $a[$a.length-1]);
              frag = $scope.get('Fragment').$new(line, line_sexp);
              self.$push(frag);
            };
            return idx = idx['$+'](1);}, TMP_1.$$s = self, TMP_1), $a).call($b);
        }
                ;Opal.donate(self, ["$compile_split_lines"]);
      })(self);

      (function($base, $super) {
        function $XStringNode(){};
        var self = $XStringNode = $klass($base, $super, 'XStringNode', $XStringNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.sexp = nil;
        self.$include($scope.get('XStringLineSplitter'));

        self.$handle("xstr");

        self.$children("value");

        def['$needs_semicolon?'] = function() {
          var $a, self = this;

          return ($a = self['$stmt?'](), $a !== false && $a !== nil ?self.$value().$to_s()['$include?'](";")['$!']() : $a);
        };

        def.$compile = function() {
          var $a, self = this;

          self.$compile_split_lines(self.$value().$to_s(), self.sexp);
          if ((($a = self['$needs_semicolon?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$push(";")};
          if ((($a = self['$recv?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(", ")")
            } else {
            return nil
          };
        };

        return (def.$start_line = function() {
          var self = this;

          return self.sexp.$line();
        }, nil) && 'start_line';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $DynamicStringNode(){};
        var self = $DynamicStringNode = $klass($base, $super, 'DynamicStringNode', $DynamicStringNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("dstr");

        return (def.$compile = function() {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = self.$children()).$each_with_index, $a.$$p = (TMP_2 = function(part, idx){var self = TMP_2.$$s || this, $a;
if (part == null) part = nil;if (idx == null) idx = nil;
          if (idx['$=='](0)) {
              } else {
              self.$push(" + ")
            };
            if ((($a = $scope.get('String')['$==='](part)) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$push(part.$inspect())
            } else if (part.$type()['$==']("evstr")) {
              self.$push("(");
              self.$push(self.$expr(part['$[]'](1)));
              self.$push(")");
            } else if (part.$type()['$==']("str")) {
              self.$push(part['$[]'](1).$inspect())
            } else if (part.$type()['$==']("dstr")) {
              self.$push("(");
              self.$push(self.$expr(part));
              self.$push(")");
              } else {
              self.$raise("Bad dstr part " + (part.$inspect()))
            };
            if ((($a = self['$recv?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              return self.$wrap("(", ")")
              } else {
              return nil
            };}, TMP_2.$$s = self, TMP_2), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $DynamicSymbolNode(){};
        var self = $DynamicSymbolNode = $klass($base, $super, 'DynamicSymbolNode', $DynamicSymbolNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("dsym");

        return (def.$compile = function() {
          var $a, $b, TMP_3, self = this;

          ($a = ($b = self.$children()).$each_with_index, $a.$$p = (TMP_3 = function(part, idx){var self = TMP_3.$$s || this, $a;
if (part == null) part = nil;if (idx == null) idx = nil;
          if (idx['$=='](0)) {
              } else {
              self.$push(" + ")
            };
            if ((($a = $scope.get('String')['$==='](part)) !== nil && (!$a.$$is_boolean || $a == true))) {
              return self.$push(part.$inspect())
            } else if (part.$type()['$==']("evstr")) {
              return self.$push(self.$expr(self.$s("call", part.$last(), "to_s", self.$s("arglist"))))
            } else if (part.$type()['$==']("str")) {
              return self.$push(part.$last().$inspect())
              } else {
              return self.$raise("Bad dsym part")
            };}, TMP_3.$$s = self, TMP_3), $a).call($b);
          return self.$wrap("(", ")");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $DynamicXStringNode(){};
        var self = $DynamicXStringNode = $klass($base, $super, 'DynamicXStringNode', $DynamicXStringNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$include($scope.get('XStringLineSplitter'));

        self.$handle("dxstr");

        def.$requires_semicolon = function(code) {
          var $a, self = this;

          return ($a = self['$stmt?'](), $a !== false && $a !== nil ?code['$include?'](";")['$!']() : $a);
        };

        return (def.$compile = function() {
          var $a, $b, TMP_4, self = this, needs_semicolon = nil;

          needs_semicolon = false;
          ($a = ($b = self.$children()).$each, $a.$$p = (TMP_4 = function(part){var self = TMP_4.$$s || this, $a;
            if (self.sexp == null) self.sexp = nil;
if (part == null) part = nil;
          if ((($a = $scope.get('String')['$==='](part)) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$compile_split_lines(part.$to_s(), self.sexp);
              if ((($a = self.$requires_semicolon(part.$to_s())) !== nil && (!$a.$$is_boolean || $a == true))) {
                return needs_semicolon = true
                } else {
                return nil
              };
            } else if (part.$type()['$==']("evstr")) {
              return self.$push(self.$expr(part['$[]'](1)))
            } else if (part.$type()['$==']("str")) {
              self.$compile_split_lines(part.$last().$to_s(), part);
              if ((($a = self.$requires_semicolon(part.$last().$to_s())) !== nil && (!$a.$$is_boolean || $a == true))) {
                return needs_semicolon = true
                } else {
                return nil
              };
              } else {
              return self.$raise("Bad dxstr part")
            }}, TMP_4.$$s = self, TMP_4), $a).call($b);
          if (needs_semicolon !== false && needs_semicolon !== nil) {
            self.$push(";")};
          if ((($a = self['$recv?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(", ")")
            } else {
            return nil
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $DynamicRegexpNode(){};
        var self = $DynamicRegexpNode = $klass($base, $super, 'DynamicRegexpNode', $DynamicRegexpNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("dregx");

        return (def.$compile = function() {
          var $a, $b, TMP_5, self = this;

          ($a = ($b = self.$children()).$each_with_index, $a.$$p = (TMP_5 = function(part, idx){var self = TMP_5.$$s || this, $a;
if (part == null) part = nil;if (idx == null) idx = nil;
          if (idx['$=='](0)) {
              } else {
              self.$push(" + ")
            };
            if ((($a = $scope.get('String')['$==='](part)) !== nil && (!$a.$$is_boolean || $a == true))) {
              return self.$push(part.$inspect())
            } else if (part.$type()['$==']("str")) {
              return self.$push(part['$[]'](1).$inspect())
              } else {
              return self.$push(self.$expr(part['$[]'](1)))
            };}, TMP_5.$$s = self, TMP_5), $a).call($b);
          return self.$wrap("(new RegExp(", "))");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $InclusiveRangeNode(){};
        var self = $InclusiveRangeNode = $klass($base, $super, 'InclusiveRangeNode', $InclusiveRangeNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("irange");

        self.$children("start", "finish");

        return (def.$compile = function() {
          var self = this;

          self.$helper("range");
          return self.$push("$range(", self.$expr(self.$start()), ", ", self.$expr(self.$finish()), ", false)");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ExclusiveRangeNode(){};
        var self = $ExclusiveRangeNode = $klass($base, $super, 'ExclusiveRangeNode', $ExclusiveRangeNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("erange");

        self.$children("start", "finish");

        return (def.$compile = function() {
          var self = this;

          self.$helper("range");
          return self.$push("$range(", self.$expr(self.$start()), ", ", self.$expr(self.$finish()), ", true)");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/variables"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$irb?', '$compiler', '$top?', '$scope', '$using_irb?', '$push', '$variable', '$to_s', '$var_name', '$with_temp', '$property', '$wrap', '$expr', '$value', '$add_local', '$recv?', '$[]', '$name', '$add_ivar', '$helper', '$==', '$handle_global_match', '$handle_post_match', '$handle_pre_match', '$add_gvar', '$index']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $LocalVariableNode(){};
        var self = $LocalVariableNode = $klass($base, $super, 'LocalVariableNode', $LocalVariableNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("lvar");

        self.$children("var_name");

        def['$using_irb?'] = function() {
          var $a, self = this;

          return ($a = self.$compiler()['$irb?'](), $a !== false && $a !== nil ?self.$scope()['$top?']() : $a);
        };

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this;

          if ((($a = self['$using_irb?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            return self.$push(self.$variable(self.$var_name().$to_s()))
          };
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_1 = function(tmp){var self = TMP_1.$$s || this;
if (tmp == null) tmp = nil;
          self.$push(self.$property(self.$var_name().$to_s()));
            return self.$wrap("((" + (tmp) + " = Opal.irb_vars", ") == null ? nil : " + (tmp) + ")");}, TMP_1.$$s = self, TMP_1), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $LocalAssignNode(){};
        var self = $LocalAssignNode = $klass($base, $super, 'LocalAssignNode', $LocalAssignNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("lasgn");

        self.$children("var_name", "value");

        def['$using_irb?'] = function() {
          var $a, self = this;

          return ($a = self.$compiler()['$irb?'](), $a !== false && $a !== nil ?self.$scope()['$top?']() : $a);
        };

        return (def.$compile = function() {
          var $a, self = this;

          if ((($a = self['$using_irb?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$push("Opal.irb_vars" + (self.$property(self.$var_name().$to_s())) + " = ");
            self.$push(self.$expr(self.$value()));
            } else {
            self.$add_local(self.$variable(self.$var_name().$to_s()));
            self.$push("" + (self.$variable(self.$var_name().$to_s())) + " = ");
            self.$push(self.$expr(self.$value()));
          };
          if ((($a = self['$recv?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(", ")")
            } else {
            return nil
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $InstanceVariableNode(){};
        var self = $InstanceVariableNode = $klass($base, $super, 'InstanceVariableNode', $InstanceVariableNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("ivar");

        self.$children("name");

        def.$var_name = function() {
          var self = this;

          return self.$name().$to_s()['$[]']($range(1, -1, false));
        };

        return (def.$compile = function() {
          var self = this, name = nil;

          name = self.$property(self.$var_name());
          self.$add_ivar(name);
          return self.$push("self" + (name));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $InstanceAssignNode(){};
        var self = $InstanceAssignNode = $klass($base, $super, 'InstanceAssignNode', $InstanceAssignNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("iasgn");

        self.$children("name", "value");

        def.$var_name = function() {
          var self = this;

          return self.$name().$to_s()['$[]']($range(1, -1, false));
        };

        return (def.$compile = function() {
          var self = this, name = nil;

          name = self.$property(self.$var_name());
          self.$push("self" + (name) + " = ");
          return self.$push(self.$expr(self.$value()));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $GlobalVariableNode(){};
        var self = $GlobalVariableNode = $klass($base, $super, 'GlobalVariableNode', $GlobalVariableNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("gvar");

        self.$children("name");

        def.$var_name = function() {
          var self = this;

          return self.$name().$to_s()['$[]']($range(1, -1, false));
        };

        def.$compile = function() {
          var self = this, name = nil;

          self.$helper("gvars");
          if (self.$var_name()['$==']("&")) {
            return self.$handle_global_match()
          } else if (self.$var_name()['$==']("'")) {
            return self.$handle_post_match()
          } else if (self.$var_name()['$==']("`")) {
            return self.$handle_pre_match()};
          name = self.$property(self.$var_name());
          self.$add_gvar(name);
          return self.$push("$gvars" + (name));
        };

        def.$handle_global_match = function() {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_2 = function(tmp){var self = TMP_2.$$s || this;
if (tmp == null) tmp = nil;
          return self.$push("((" + (tmp) + " = $gvars['~']) === nil ? nil : " + (tmp) + "['$[]'](0))")}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };

        def.$handle_pre_match = function() {
          var $a, $b, TMP_3, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_3 = function(tmp){var self = TMP_3.$$s || this;
if (tmp == null) tmp = nil;
          return self.$push("((" + (tmp) + " = $gvars['~']) === nil ? nil : " + (tmp) + ".$pre_match())")}, TMP_3.$$s = self, TMP_3), $a).call($b);
        };

        return (def.$handle_post_match = function() {
          var $a, $b, TMP_4, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_4 = function(tmp){var self = TMP_4.$$s || this;
if (tmp == null) tmp = nil;
          return self.$push("((" + (tmp) + " = $gvars['~']) === nil ? nil : " + (tmp) + ".$post_match())")}, TMP_4.$$s = self, TMP_4), $a).call($b);
        }, nil) && 'handle_post_match';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $GlobalAssignNode(){};
        var self = $GlobalAssignNode = $klass($base, $super, 'GlobalAssignNode', $GlobalAssignNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("gasgn");

        self.$children("name", "value");

        def.$var_name = function() {
          var self = this;

          return self.$name().$to_s()['$[]']($range(1, -1, false));
        };

        return (def.$compile = function() {
          var self = this, name = nil;

          self.$helper("gvars");
          name = self.$property(self.$var_name());
          self.$push("$gvars" + (name) + " = ");
          return self.$push(self.$expr(self.$value()));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $BackrefNode(){};
        var self = $BackrefNode = $klass($base, $super, 'BackrefNode', $BackrefNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("nth_ref");

        self.$children("index");

        return (def.$compile = function() {
          var $a, $b, TMP_5, self = this;

          self.$helper("gvars");
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_5 = function(tmp){var self = TMP_5.$$s || this;
if (tmp == null) tmp = nil;
          return self.$push("((" + (tmp) + " = $gvars['~']) === nil ? nil : " + (tmp) + "['$[]'](" + (self.$index()) + "))")}, TMP_5.$$s = self, TMP_5), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ClassVariableNode(){};
        var self = $ClassVariableNode = $klass($base, $super, 'ClassVariableNode', $ClassVariableNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("cvar");

        self.$children("name");

        return (def.$compile = function() {
          var $a, $b, TMP_6, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_6 = function(tmp){var self = TMP_6.$$s || this;
if (tmp == null) tmp = nil;
          return self.$push("((" + (tmp) + " = Opal.cvars['" + (self.$name()) + "']) == null ? nil : " + (tmp) + ")")}, TMP_6.$$s = self, TMP_6), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ClassVarAssignNode(){};
        var self = $ClassVarAssignNode = $klass($base, $super, 'ClassVarAssignNode', $ClassVarAssignNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("casgn");

        self.$children("name", "value");

        return (def.$compile = function() {
          var self = this;

          self.$push("(Opal.cvars['" + (self.$name()) + "'] = ");
          self.$push(self.$expr(self.$value()));
          return self.$push(")");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ClassVarDeclNode(){};
        var self = $ClassVarDeclNode = $klass($base, $super, 'ClassVarDeclNode', $ClassVarDeclNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("cvdecl");

        self.$children("name", "value");

        return (def.$compile = function() {
          var self = this;

          self.$push("(Opal.cvars['" + (self.$name()) + "'] = ");
          self.$push(self.$expr(self.$value()));
          return self.$push(")");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/constants"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$==', '$name', '$eof_content', '$compiler', '$push', '$expr', '$base', '$wrap', '$value']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ConstNode(){};
        var self = $ConstNode = $klass($base, $super, 'ConstNode', $ConstNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("const");

        self.$children("name");

        return (def.$compile = function() {
          var $a, $b, self = this;

          if ((($a = (($b = self.$name()['$==']("DATA")) ? self.$compiler().$eof_content() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("$__END__")
            } else {
            return self.$push("$scope.get('" + (self.$name()) + "')")
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ConstDeclarationNode(){};
        var self = $ConstDeclarationNode = $klass($base, $super, 'ConstDeclarationNode', $ConstDeclarationNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("cdecl");

        self.$children("name", "base");

        return (def.$compile = function() {
          var self = this;

          self.$push(self.$expr(self.$base()));
          return self.$wrap("Opal.cdecl($scope, '" + (self.$name()) + "', ", ")");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ConstAssignNode(){};
        var self = $ConstAssignNode = $klass($base, $super, 'ConstAssignNode', $ConstAssignNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("casgn");

        self.$children("base", "name", "value");

        return (def.$compile = function() {
          var self = this;

          self.$push("Opal.casgn(");
          self.$push(self.$expr(self.$base()));
          self.$push(", '" + (self.$name()) + "', ");
          self.$push(self.$expr(self.$value()));
          return self.$push(")");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ConstGetNode(){};
        var self = $ConstGetNode = $klass($base, $super, 'ConstGetNode', $ConstGetNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("colon2");

        self.$children("base", "name");

        return (def.$compile = function() {
          var self = this;

          self.$push("((");
          self.$push(self.$expr(self.$base()));
          return self.$push(").$$scope.get('" + (self.$name()) + "'))");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $TopConstNode(){};
        var self = $TopConstNode = $klass($base, $super, 'TopConstNode', $TopConstNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("colon3");

        self.$children("name");

        return (def.$compile = function() {
          var self = this;

          return self.$push("Opal.get('" + (self.$name()) + "')");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $TopConstAssignNode(){};
        var self = $TopConstAssignNode = $klass($base, $super, 'TopConstAssignNode', $TopConstAssignNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("casgn3");

        self.$children("name", "value");

        return (def.$compile = function() {
          var self = this;

          self.$push("Opal.casgn(Opal.Object, '" + (self.$name()) + "', ");
          self.$push(self.$expr(self.$value()));
          return self.$push(")");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["pathname"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $module = Opal.module;

  Opal.add_stubs(['$==', '$raise', '$attr_reader', '$path', '$start_with?', '$!', '$absolute?', '$sub', '$new']);
  (function($base, $super) {
    function $Pathname(){};
    var self = $Pathname = $klass($base, $super, 'Pathname', $Pathname);

    var def = self.$$proto, $scope = self.$$scope;

    def.path = nil;
    def.$initialize = function(path) {
      var self = this;

      if (path['$==']("\x00")) {
        self.$raise($scope.get('ArgumentError'))};
      return self.path = path;
    };

    self.$attr_reader("path");

    def['$=='] = function(other) {
      var self = this;

      return other.$path()['$=='](self.path);
    };

    def['$absolute?'] = function() {
      var self = this;

      return self.path['$start_with?']("/");
    };

    def['$relative?'] = function() {
      var self = this;

      return self['$absolute?']()['$!']();
    };

    def['$root?'] = function() {
      var self = this;

      return self.path['$==']("/");
    };

    def.$parent = function() {
      var $a, self = this, new_path = nil;

      new_path = self.path.$sub(/\/([^\/]+\/?$)/, "");
      if (new_path['$==']("")) {
        new_path = (function() {if ((($a = self['$absolute?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return "/"
          } else {
          return "."
        }; return nil; })()};
      return $scope.get('Pathname').$new(new_path);
    };

    def.$sub = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      return $scope.get('Pathname').$new(($a = self.path).$sub.apply($a, [].concat(args)));
    };

    def.$cleanpath = function() {
      var self = this;

      return Opal.normalize_loadable_path(self.path);
    };

    def.$to_path = function() {
      var self = this;

      return self.path;
    };

    def.$hash = function() {
      var self = this;

      return self.path;
    };

    Opal.defn(self, '$to_str', def.$to_path);

    return Opal.defn(self, '$to_s', def.$to_path);
  })(self, null);
  return (function($base) {
    var self = $module($base, 'Kernel');

    var def = self.$$proto, $scope = self.$$scope;

    def.$Pathname = function(path) {
      var self = this;

      return $scope.get('Pathname').$new(path);
    }
        ;Opal.donate(self, ["$Pathname"]);
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/runtime_helpers"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$new', '$children', '$==', '$include?', '$to_sym', '$<<', '$define_method', '$to_proc', '$meth', '$__send__', '$raise', '$helper', '$[]', '$arglist', '$js_truthy', '$js_falsy']);
  self.$require("set");
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $RuntimeHelpers(){};
        var self = $RuntimeHelpers = $klass($base, $super, 'RuntimeHelpers', $RuntimeHelpers);

        var def = self.$$proto, $scope = self.$$scope, TMP_1, $a, $b, TMP_2, $c, TMP_3;

        Opal.cdecl($scope, 'HELPERS', $scope.get('Set').$new());

        self.$children("recvr", "meth", "arglist");

        Opal.defs(self, '$compatible?', function(recvr, meth, arglist) {
          var $a, self = this;

          return (($a = recvr['$=='](["const", "Opal"])) ? $scope.get('HELPERS')['$include?'](meth.$to_sym()) : $a);
        });

        Opal.defs(self, '$helper', TMP_1 = function(name) {
          var $a, $b, self = this, $iter = TMP_1.$$p, block = $iter || nil;

          TMP_1.$$p = null;
          $scope.get('HELPERS')['$<<'](name);
          return ($a = ($b = self).$define_method, $a.$$p = block.$to_proc(), $a).call($b, "compile_" + (name));
        });

        def.$compile = function() {
          var $a, self = this;

          if ((($a = $scope.get('HELPERS')['$include?'](self.$meth().$to_sym())) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$__send__("compile_" + (self.$meth()))
            } else {
            return self.$raise("Helper not supported: " + (self.$meth()))
          };
        };

        ($a = ($b = self).$helper, $a.$$p = (TMP_2 = function(){var self = TMP_2.$$s || this, $a, sexp = nil;

        if ((($a = sexp = self.$arglist()['$[]'](1)) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            self.$raise("truthy? requires an object")
          };
          return self.$js_truthy(sexp);}, TMP_2.$$s = self, TMP_2), $a).call($b, "truthy?");

        return ($a = ($c = self).$helper, $a.$$p = (TMP_3 = function(){var self = TMP_3.$$s || this, $a, sexp = nil;

        if ((($a = sexp = self.$arglist()['$[]'](1)) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            self.$raise("falsy? requires an object")
          };
          return self.$js_falsy(sexp);}, TMP_3.$$s = self, TMP_3), $a).call($c, "falsy?");
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/call"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $hash2 = Opal.hash2, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$[]=', '$define_method', '$to_proc', '$handle_special', '$compile_default?', '$<<', '$method_calls', '$compiler', '$to_sym', '$meth', '$using_irb?', '$compile_irb_var', '$default_compile', '$mid_to_jsid', '$to_s', '$any?', '$==', '$first', '$[]', '$arglist', '$===', '$last', '$type', '$pop', '$iter', '$new_temp', '$scope', '$expr', '$recv', '$recv_sexp', '$s', '$!', '$insert', '$push', '$unshift', '$queue_temp', '$recvr', '$=~', '$with_temp', '$variable', '$intern', '$+', '$irb?', '$top?', '$nil?', '$include?', '$__send__', '$compatible?', '$compile', '$new', '$each', '$add_special', '$inline_operators?', '$operator_helpers', '$fragment', '$compile_default!', '$resolve', '$requires', '$file', '$dirname', '$cleanpath', '$join', '$Pathname', '$inspect', '$process', '$class_scope?', '$required_trees', '$handle_block_given_call', '$def?', '$mid', '$handle_part', '$map', '$expand_path', '$split', '$dynamic_require_severity', '$error', '$line', '$warning', '$inject']);
  self.$require("set");
  self.$require("pathname");
  self.$require("opal/nodes/base");
  self.$require("opal/nodes/runtime_helpers");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $CallNode(){};
        var self = $CallNode = $klass($base, $super, 'CallNode', $CallNode);

        var def = self.$$proto, $scope = self.$$scope, TMP_1, $a, $b, TMP_6, $c, TMP_8, $d, TMP_9, $e, TMP_10, $f, TMP_11, $g, TMP_12, $h, TMP_13, $i, TMP_14, $j, TMP_15;

        def.assignment = def.compiler = def.sexp = def.level = def.compile_default = nil;
        self.$handle("call");

        self.$children("recvr", "meth", "arglist", "iter");

        Opal.cdecl($scope, 'SPECIALS', $hash2([], {}));

        Opal.cdecl($scope, 'OPERATORS', $hash2(["+", "-", "*", "/", "<", "<=", ">", ">="], {"+": "plus", "-": "minus", "*": "times", "/": "divide", "<": "lt", "<=": "le", ">": "gt", ">=": "ge"}));

        Opal.defs(self, '$add_special', TMP_1 = function(name, options) {
          var $a, $b, self = this, $iter = TMP_1.$$p, handler = $iter || nil;

          if (options == null) {
            options = $hash2([], {})
          }
          TMP_1.$$p = null;
          $scope.get('SPECIALS')['$[]='](name, options);
          return ($a = ($b = self).$define_method, $a.$$p = handler.$to_proc(), $a).call($b, "handle_" + (name));
        });

        def.$compile = function() {
          var $a, self = this;

          self.$handle_special();
          if ((($a = self['$compile_default?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            return nil
          };
          self.$compiler().$method_calls()['$<<'](self.$meth().$to_sym());
          if ((($a = self['$using_irb?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compile_irb_var()};
          return self.$default_compile();
        };

        def.$default_compile = function() {
          var $a, $b, TMP_2, $c, self = this, mid = nil, splat = nil, block = nil, blktmp = nil, tmprecv = nil, recv_code = nil, call_recv = nil, args = nil;

          mid = self.$mid_to_jsid(self.$meth().$to_s());
          splat = ($a = ($b = self.$arglist()['$[]']($range(1, -1, false)))['$any?'], $a.$$p = (TMP_2 = function(a){var self = TMP_2.$$s || this;
if (a == null) a = nil;
          return a.$first()['$==']("splat")}, TMP_2.$$s = self, TMP_2), $a).call($b);
          if ((($a = ($c = $scope.get('Sexp')['$==='](self.$arglist().$last()), $c !== false && $c !== nil ?self.$arglist().$last().$type()['$==']("block_pass") : $c)) !== nil && (!$a.$$is_boolean || $a == true))) {
            block = self.$arglist().$pop()
          } else if ((($a = self.$iter()) !== nil && (!$a.$$is_boolean || $a == true))) {
            block = self.$iter()};
          if (block !== false && block !== nil) {
            blktmp = self.$scope().$new_temp()};
          if ((($a = ((($c = splat) !== false && $c !== nil) ? $c : blktmp)) !== nil && (!$a.$$is_boolean || $a == true))) {
            tmprecv = self.$scope().$new_temp()};
          if (block !== false && block !== nil) {
            block = self.$expr(block)};
          recv_code = self.$recv(self.$recv_sexp());
          call_recv = self.$s("js_tmp", ((($a = tmprecv) !== false && $a !== nil) ? $a : recv_code));
          if ((($a = (($c = blktmp !== false && blktmp !== nil) ? splat['$!']() : $c)) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$arglist().$insert(1, call_recv)};
          args = self.$expr(self.$arglist());
          if (tmprecv !== false && tmprecv !== nil) {
            self.$push("(" + (tmprecv) + " = ", recv_code, ")" + (mid))
            } else {
            self.$push(recv_code, mid)
          };
          if (blktmp !== false && blktmp !== nil) {
            self.$unshift("(" + (blktmp) + " = ");
            self.$push(", " + (blktmp) + ".$$p = ", block, ", " + (blktmp) + ")");};
          if (splat !== false && splat !== nil) {
            self.$push(".apply(", (((($a = tmprecv) !== false && $a !== nil) ? $a : recv_code)), ", ", args, ")")
          } else if (blktmp !== false && blktmp !== nil) {
            self.$push(".call(", args, ")")
            } else {
            self.$push("(", args, ")")
          };
          if (blktmp !== false && blktmp !== nil) {
            return self.$scope().$queue_temp(blktmp)
            } else {
            return nil
          };
        };

        def.$recv_sexp = function() {
          var $a, self = this;

          return ((($a = self.$recvr()) !== false && $a !== nil) ? $a : self.$s("self"));
        };

        def['$attr_assignment?'] = function() {
          var $a, self = this;

          return ((($a = self.assignment) !== false && $a !== nil) ? $a : self.assignment = self.$meth().$to_s()['$=~'](/^[\da-z]+\=$/i));
        };

        def.$compile_irb_var = function() {
          var $a, $b, TMP_3, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_3 = function(tmp){var self = TMP_3.$$s || this, lvar = nil, call = nil;
if (tmp == null) tmp = nil;
          lvar = self.$variable(self.$meth());
            call = self.$s("call", self.$s("self"), self.$meth().$intern(), self.$s("arglist"));
            return self.$push("((" + (tmp) + " = Opal.irb_vars." + (lvar) + ") == null ? ", self.$expr(call), " : " + (tmp) + ")");}, TMP_3.$$s = self, TMP_3), $a).call($b);
        };

        def.$compile_assignment = function() {
          var $a, $b, TMP_4, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_4 = function(args_tmp){var self = TMP_4.$$s || this, $a, $b, TMP_5;
if (args_tmp == null) args_tmp = nil;
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_5 = function(recv_tmp){var self = TMP_5.$$s || this, args = nil, mid = nil;
if (recv_tmp == null) recv_tmp = nil;
            args = self.$expr(self.$arglist());
              mid = self.$mid_to_jsid(self.$meth().$to_s());
              return self.$push("((" + (args_tmp) + " = [", args, "]), "['$+']("" + (recv_tmp) + " = "), self.$recv(self.$recv_sexp()), ", ", recv_tmp, mid, (((((".apply(") + (recv_tmp)) + ", ") + (args_tmp)) + "), ")['$+']("" + (args_tmp) + "[" + (args_tmp) + ".length-1])"));}, TMP_5.$$s = self, TMP_5), $a).call($b)}, TMP_4.$$s = self, TMP_4), $a).call($b);
        };

        def['$using_irb?'] = function() {
          var $a, $b, $c, $d, self = this;

          return ($a = ($b = ($c = ($d = self.compiler['$irb?'](), $d !== false && $d !== nil ?self.$scope()['$top?']() : $d), $c !== false && $c !== nil ?self.$arglist()['$=='](self.$s("arglist")) : $c), $b !== false && $b !== nil ?self.$recvr()['$nil?']() : $b), $a !== false && $a !== nil ?self.$iter()['$nil?']() : $a);
        };

        def.$handle_special = function() {
          var $a, self = this;

          self.compile_default = true;
          if ((($a = $scope.get('SPECIALS')['$include?'](self.$meth())) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.compile_default = false;
            return self.$__send__("handle_" + (self.$meth()));
          } else if ((($a = $scope.get('RuntimeHelpers')['$compatible?'](self.$recvr(), self.$meth(), self.$arglist())) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.compile_default = false;
            return self.$push($scope.get('RuntimeHelpers').$new(self.sexp, self.level, self.compiler).$compile());
            } else {
            return nil
          };
        };

        def['$compile_default!'] = function() {
          var self = this;

          return self.compile_default = true;
        };

        def['$compile_default?'] = function() {
          var self = this;

          return self.compile_default;
        };

        ($a = ($b = $scope.get('OPERATORS')).$each, $a.$$p = (TMP_6 = function(operator, name){var self = TMP_6.$$s || this, $a, $b, TMP_7;
if (operator == null) operator = nil;if (name == null) name = nil;
        return ($a = ($b = self).$add_special, $a.$$p = (TMP_7 = function(){var self = TMP_7.$$s || this, $a, lhs = nil, rhs = nil;

          if ((($a = self.$compiler()['$inline_operators?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$compiler().$operator_helpers()['$<<'](operator.$to_sym());
              $a = [self.$expr(self.$recvr()), self.$expr(self.$arglist()['$[]'](1))], lhs = $a[0], rhs = $a[1];
              self.$push(self.$fragment("$rb_" + (name) + "("));
              self.$push(lhs);
              self.$push(self.$fragment(", "));
              self.$push(rhs);
              return self.$push(self.$fragment(")"));
              } else {
              return self['$compile_default!']()
            }}, TMP_7.$$s = self, TMP_7), $a).call($b, operator.$to_sym())}, TMP_6.$$s = self, TMP_6), $a).call($b);

        ($a = ($c = self).$add_special, $a.$$p = (TMP_8 = function(){var self = TMP_8.$$s || this, $a, str = nil;

        self['$compile_default!']();
          str = $scope.get('DependencyResolver').$new(self.$compiler(), self.$arglist()['$[]'](1)).$resolve();
          if ((($a = str['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            self.$compiler().$requires()['$<<'](str)
          };
          return self.$push(self.$fragment(""));}, TMP_8.$$s = self, TMP_8), $a).call($c, "require");

        ($a = ($d = self).$add_special, $a.$$p = (TMP_9 = function(){var self = TMP_9.$$s || this, arg = nil, file = nil, dir = nil;

        arg = self.$arglist()['$[]'](1);
          file = self.$compiler().$file();
          if (arg['$[]'](0)['$==']("str")) {
            dir = $scope.get('File').$dirname(file);
            self.$compiler().$requires()['$<<'](self.$Pathname(dir).$join(arg['$[]'](1)).$cleanpath().$to_s());};
          self.$push(self.$fragment("self.$require(" + (file.$inspect()) + "+ '/../' + "));
          self.$push(self.$process(self.$arglist()));
          return self.$push(self.$fragment(")"));}, TMP_9.$$s = self, TMP_9), $a).call($d, "require_relative");

        ($a = ($e = self).$add_special, $a.$$p = (TMP_10 = function(){var self = TMP_10.$$s || this, $a, str = nil;

        if ((($a = self.$scope()['$class_scope?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self['$compile_default!']();
            str = $scope.get('DependencyResolver').$new(self.$compiler(), self.$arglist()['$[]'](2)).$resolve();
            if ((($a = str['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              } else {
              self.$compiler().$requires()['$<<'](str)
            };
            return self.$push(self.$fragment(""));
            } else {
            return nil
          }}, TMP_10.$$s = self, TMP_10), $a).call($e, "autoload");

        ($a = ($f = self).$add_special, $a.$$p = (TMP_11 = function(){var self = TMP_11.$$s || this, arg = nil, dir = nil, relative_path = nil, full_path = nil;

        arg = self.$arglist()['$[]'](1);
          if (arg['$[]'](0)['$==']("str")) {
            dir = $scope.get('File').$dirname(self.$compiler().$file());
            relative_path = arg['$[]'](1);
            full_path = self.$Pathname(dir).$join(relative_path).$cleanpath().$to_s();
            self.$compiler().$required_trees()['$<<'](full_path);
            arg['$[]='](1, full_path);};
          self['$compile_default!']();
          return self.$push(self.$fragment(""));}, TMP_11.$$s = self, TMP_11), $a).call($f, "require_tree");

        ($a = ($g = self).$add_special, $a.$$p = (TMP_12 = function(){var self = TMP_12.$$s || this;
          if (self.sexp == null) self.sexp = nil;

        return self.$push(self.$compiler().$handle_block_given_call(self.sexp))}, TMP_12.$$s = self, TMP_12), $a).call($g, "block_given?");

        ($a = ($h = self).$add_special, $a.$$p = (TMP_13 = function(){var self = TMP_13.$$s || this, $a;

        if ((($a = self.$scope()['$def?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push(self.$fragment(self.$scope().$mid().$to_s().$inspect()))
            } else {
            return self.$push(self.$fragment("nil"))
          }}, TMP_13.$$s = self, TMP_13), $a).call($h, "__callee__");

        ($a = ($i = self).$add_special, $a.$$p = (TMP_14 = function(){var self = TMP_14.$$s || this, $a;

        if ((($a = self.$scope()['$def?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push(self.$fragment(self.$scope().$mid().$to_s().$inspect()))
            } else {
            return self.$push(self.$fragment("nil"))
          }}, TMP_14.$$s = self, TMP_14), $a).call($i, "__method__");

        ($a = ($j = self).$add_special, $a.$$p = (TMP_15 = function(){var self = TMP_15.$$s || this;

        return self.$push(self.$fragment("debugger"))}, TMP_15.$$s = self, TMP_15), $a).call($j, "debugger");

        return (function($base, $super) {
          function $DependencyResolver(){};
          var self = $DependencyResolver = $klass($base, $super, 'DependencyResolver', $DependencyResolver);

          var def = self.$$proto, $scope = self.$$scope;

          def.sexp = def.compiler = nil;
          def.$initialize = function(compiler, sexp) {
            var self = this;

            self.compiler = compiler;
            return self.sexp = sexp;
          };

          def.$resolve = function() {
            var self = this;

            return self.$handle_part(self.sexp);
          };

          def.$handle_part = function(sexp) {
            var $a, $b, TMP_16, self = this, type = nil, _ = nil, recv = nil, meth = nil, args = nil, parts = nil, msg = nil, $case = nil;

            type = sexp.$type();
            if (type['$==']("str")) {
              return sexp['$[]'](1)
            } else if (type['$==']("call")) {
              $a = Opal.to_ary(sexp), _ = ($a[0] == null ? nil : $a[0]), recv = ($a[1] == null ? nil : $a[1]), meth = ($a[2] == null ? nil : $a[2]), args = ($a[3] == null ? nil : $a[3]);
              parts = ($a = ($b = args['$[]']($range(1, -1, false))).$map, $a.$$p = (TMP_16 = function(s){var self = TMP_16.$$s || this;
if (s == null) s = nil;
              return self.$handle_part(s)}, TMP_16.$$s = self, TMP_16), $a).call($b);
              if (recv['$=='](["const", "File"])) {
                if (meth['$==']("expand_path")) {
                  return ($a = self).$expand_path.apply($a, [].concat(parts))
                } else if (meth['$==']("join")) {
                  return self.$expand_path(parts.$join("/"))
                } else if (meth['$==']("dirname")) {
                  return self.$expand_path(parts['$[]'](0).$split("/")['$[]']($range(0, -1, true)).$join("/"))}};};
            msg = "Cannot handle dynamic require";
            return (function() {$case = self.compiler.$dynamic_require_severity();if ("error"['$===']($case)) {return self.compiler.$error(msg, self.sexp.$line())}else if ("warning"['$===']($case)) {return self.compiler.$warning(msg, self.sexp.$line())}else { return nil }})();
          };

          return (def.$expand_path = function(path, base) {
            var $a, $b, TMP_17, self = this;

            if (base == null) {
              base = ""
            }
            return ($a = ($b = (((("") + (base)) + "/") + (path)).$split("/")).$inject, $a.$$p = (TMP_17 = function(p, part){var self = TMP_17.$$s || this;
if (p == null) p = nil;if (part == null) part = nil;
            if (part['$==']("")) {
              } else if (part['$==']("..")) {
                p.$pop()
                } else {
                p['$<<'](part)
              };
              return p;}, TMP_17.$$s = self, TMP_17), $a).call($b, []).$join("/");
          }, nil) && 'expand_path';
        })(self, null);
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/call_special"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$=~', '$to_s', '$meth', '$with_temp', '$expr', '$arglist', '$mid_to_jsid', '$push', '$+', '$recv', '$recv_sexp', '$s', '$lhs', '$rhs', '$process', '$recvr', '$[]', '$args', '$op', '$===', '$compile_or', '$compile_and', '$compile_operator', '$to_sym', '$first_arg', '$mid']);
  self.$require("opal/nodes/base");
  self.$require("opal/nodes/call");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $AttrAssignNode(){};
        var self = $AttrAssignNode = $klass($base, $super, 'AttrAssignNode', $AttrAssignNode);

        var def = self.$$proto, $scope = self.$$scope, TMP_1;

        self.$handle("attrasgn");

        self.$children("recvr", "meth", "arglist");

        return (def.$default_compile = TMP_1 = function() {var $zuper = $slice.call(arguments, 0);
          var $a, $b, TMP_2, self = this, $iter = TMP_1.$$p, $yield = $iter || nil;

          TMP_1.$$p = null;
          if ((($a = ($b = self.$meth().$to_s()['$=~'](/^\w+=$/), ($b === nil || $b === false))) !== nil && (!$a.$$is_boolean || $a == true))) {
            return Opal.find_super_dispatcher(self, 'default_compile', TMP_1, $iter).apply(self, $zuper)};
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_2 = function(args_tmp){var self = TMP_2.$$s || this, $a, $b, TMP_3;
if (args_tmp == null) args_tmp = nil;
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_3 = function(recv_tmp){var self = TMP_3.$$s || this, args = nil, mid = nil;
if (recv_tmp == null) recv_tmp = nil;
            args = self.$expr(self.$arglist());
              mid = self.$mid_to_jsid(self.$meth().$to_s());
              return self.$push("((" + (args_tmp) + " = [", args, "]), "['$+']("" + (recv_tmp) + " = "), self.$recv(self.$recv_sexp()), ", ", recv_tmp, mid, (((((".apply(") + (recv_tmp)) + ", ") + (args_tmp)) + "), ")['$+']("" + (args_tmp) + "[" + (args_tmp) + ".length-1])"));}, TMP_3.$$s = self, TMP_3), $a).call($b)}, TMP_2.$$s = self, TMP_2), $a).call($b);
        }, nil) && 'default_compile';
      })(self, $scope.get('CallNode'));

      (function($base, $super) {
        function $Match3Node(){};
        var self = $Match3Node = $klass($base, $super, 'Match3Node', $Match3Node);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("match3");

        self.$children("lhs", "rhs");

        return (def.$compile = function() {
          var self = this, sexp = nil;

          sexp = self.$s("call", self.$lhs(), "=~", self.$s("arglist", self.$rhs()));
          return self.$push(self.$process(sexp, self.level));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $OpAsgnOrNode(){};
        var self = $OpAsgnOrNode = $klass($base, $super, 'OpAsgnOrNode', $OpAsgnOrNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("op_asgn_or");

        self.$children("recvr", "rhs");

        return (def.$compile = function() {
          var self = this, sexp = nil;

          sexp = self.$s("or", self.$recvr(), self.$rhs());
          return self.$push(self.$expr(sexp));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $OpAsgnAndNode(){};
        var self = $OpAsgnAndNode = $klass($base, $super, 'OpAsgnAndNode', $OpAsgnAndNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("op_asgn_and");

        self.$children("recvr", "rhs");

        return (def.$compile = function() {
          var self = this, sexp = nil;

          sexp = self.$s("and", self.$recvr(), self.$rhs());
          return self.$push(self.$expr(sexp));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $OpAsgn1Node(){};
        var self = $OpAsgn1Node = $klass($base, $super, 'OpAsgn1Node', $OpAsgn1Node);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("op_asgn1");

        self.$children("lhs", "args", "op", "rhs");

        def.$first_arg = function() {
          var self = this;

          return self.$args()['$[]'](1);
        };

        def.$compile = function() {
          var self = this, $case = nil;

          return (function() {$case = self.$op().$to_s();if ("||"['$===']($case)) {return self.$compile_or()}else if ("&&"['$===']($case)) {return self.$compile_and()}else {return self.$compile_operator()}})();
        };

        def.$compile_operator = function() {
          var $a, $b, TMP_4, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_4 = function(a){var self = TMP_4.$$s || this, $a, $b, TMP_5;
if (a == null) a = nil;
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_5 = function(r){var self = TMP_5.$$s || this, cur = nil, rhs = nil, call = nil;
if (r == null) r = nil;
            cur = self.$s("call", self.$s("js_tmp", r), "[]", self.$s("arglist", self.$s("js_tmp", a)));
              rhs = self.$s("call", cur, self.$op().$to_sym(), self.$s("arglist", self.$rhs()));
              call = self.$s("call", self.$s("js_tmp", r), "[]=", self.$s("arglist", self.$s("js_tmp", a), rhs));
              self.$push("(" + (a) + " = ", self.$expr(self.$first_arg()), ", " + (r) + " = ", self.$expr(self.$lhs()));
              return self.$push(", ", self.$expr(call), ")");}, TMP_5.$$s = self, TMP_5), $a).call($b)}, TMP_4.$$s = self, TMP_4), $a).call($b);
        };

        def.$compile_or = function() {
          var $a, $b, TMP_6, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_6 = function(a){var self = TMP_6.$$s || this, $a, $b, TMP_7;
if (a == null) a = nil;
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_7 = function(r){var self = TMP_7.$$s || this, aref = nil, aset = nil, orop = nil;
if (r == null) r = nil;
            aref = self.$s("call", self.$s("js_tmp", r), "[]", self.$s("arglist", self.$s("js_tmp", a)));
              aset = self.$s("call", self.$s("js_tmp", r), "[]=", self.$s("arglist", self.$s("js_tmp", a), self.$rhs()));
              orop = self.$s("or", aref, aset);
              self.$push("(" + (a) + " = ", self.$expr(self.$first_arg()), ", " + (r) + " = ", self.$expr(self.$lhs()));
              return self.$push(", ", self.$expr(orop), ")");}, TMP_7.$$s = self, TMP_7), $a).call($b)}, TMP_6.$$s = self, TMP_6), $a).call($b);
        };

        return (def.$compile_and = function() {
          var $a, $b, TMP_8, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_8 = function(a){var self = TMP_8.$$s || this, $a, $b, TMP_9;
if (a == null) a = nil;
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_9 = function(r){var self = TMP_9.$$s || this, aref = nil, aset = nil, andop = nil;
if (r == null) r = nil;
            aref = self.$s("call", self.$s("js_tmp", r), "[]", self.$s("arglist", self.$s("js_tmp", a)));
              aset = self.$s("call", self.$s("js_tmp", r), "[]=", self.$s("arglist", self.$s("js_tmp", a), self.$rhs()));
              andop = self.$s("and", aref, aset);
              self.$push("(" + (a) + " = ", self.$expr(self.$first_arg()), ", " + (r) + " = ", self.$expr(self.$lhs()));
              return self.$push(", ", self.$expr(andop), ")");}, TMP_9.$$s = self, TMP_9), $a).call($b)}, TMP_8.$$s = self, TMP_8), $a).call($b);
        }, nil) && 'compile_and';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $OpAsgn2Node(){};
        var self = $OpAsgn2Node = $klass($base, $super, 'OpAsgn2Node', $OpAsgn2Node);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("op_asgn2");

        self.$children("lhs", "mid", "op", "rhs");

        def.$meth = function() {
          var self = this;

          return self.$mid().$to_s()['$[]']($range(0, -2, false));
        };

        def.$compile = function() {
          var self = this, $case = nil;

          return (function() {$case = self.$op().$to_s();if ("||"['$===']($case)) {return self.$compile_or()}else if ("&&"['$===']($case)) {return self.$compile_and()}else {return self.$compile_operator()}})();
        };

        def.$compile_or = function() {
          var $a, $b, TMP_10, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_10 = function(tmp){var self = TMP_10.$$s || this, getr = nil, asgn = nil, orop = nil;
if (tmp == null) tmp = nil;
          getr = self.$s("call", self.$s("js_tmp", tmp), self.$meth(), self.$s("arglist"));
            asgn = self.$s("call", self.$s("js_tmp", tmp), self.$mid(), self.$s("arglist", self.$rhs()));
            orop = self.$s("or", getr, asgn);
            return self.$push("(" + (tmp) + " = ", self.$expr(self.$lhs()), ", ", self.$expr(orop), ")");}, TMP_10.$$s = self, TMP_10), $a).call($b);
        };

        def.$compile_and = function() {
          var $a, $b, TMP_11, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_11 = function(tmp){var self = TMP_11.$$s || this, getr = nil, asgn = nil, andop = nil;
if (tmp == null) tmp = nil;
          getr = self.$s("call", self.$s("js_tmp", tmp), self.$meth(), self.$s("arglist"));
            asgn = self.$s("call", self.$s("js_tmp", tmp), self.$mid(), self.$s("arglist", self.$rhs()));
            andop = self.$s("and", getr, asgn);
            return self.$push("(" + (tmp) + " = ", self.$expr(self.$lhs()), ", ", self.$expr(andop), ")");}, TMP_11.$$s = self, TMP_11), $a).call($b);
        };

        return (def.$compile_operator = function() {
          var $a, $b, TMP_12, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_12 = function(tmp){var self = TMP_12.$$s || this, getr = nil, oper = nil, asgn = nil;
if (tmp == null) tmp = nil;
          getr = self.$s("call", self.$s("js_tmp", tmp), self.$meth(), self.$s("arglist"));
            oper = self.$s("call", getr, self.$op(), self.$s("arglist", self.$rhs()));
            asgn = self.$s("call", self.$s("js_tmp", tmp), self.$mid(), self.$s("arglist", oper));
            return self.$push("(" + (tmp) + " = ", self.$expr(self.$lhs()), ", ", self.$expr(asgn), ")");}, TMP_12.$$s = self, TMP_12), $a).call($b);
        }, nil) && 'compile_operator';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/scope"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $hash2 = Opal.hash2;

  Opal.add_stubs(['$require', '$attr_accessor', '$attr_reader', '$indent', '$scope', '$compiler', '$scope=', '$call', '$==', '$!', '$class?', '$dup', '$push', '$map', '$ivars', '$gvars', '$parser_indent', '$empty?', '$join', '$+', '$proto', '$%', '$fragment', '$should_donate?', '$to_proc', '$def_in_class?', '$add_proto_ivar', '$include?', '$<<', '$has_local?', '$pop', '$next_temp', '$succ', '$uses_block!', '$identify!', '$unique_temp', '$add_scope_temp', '$parent', '$def?', '$type', '$mid']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ScopeNode(){};
        var self = $ScopeNode = $klass($base, $super, 'ScopeNode', $ScopeNode);

        var def = self.$$proto, $scope = self.$$scope, TMP_1, TMP_2;

        def.type = def.defs = def.parent = def.temps = def.locals = def.compiler = def.proto_ivars = def.methods = def.ivars = def.gvars = def.args = def.queue = def.unique = def.while_stack = def.identity = def.uses_block = nil;
        self.$attr_accessor("parent");

        self.$attr_accessor("name");

        self.$attr_accessor("block_name");

        self.$attr_reader("scope_name");

        self.$attr_reader("ivars");

        self.$attr_reader("gvars");

        self.$attr_accessor("mid");

        self.$attr_accessor("defs");

        self.$attr_reader("methods");

        self.$attr_accessor("uses_super");

        self.$attr_accessor("uses_zuper");

        self.$attr_accessor("catch_return");

        def.$initialize = TMP_1 = function() {var $zuper = $slice.call(arguments, 0);
          var self = this, $iter = TMP_1.$$p, $yield = $iter || nil;

          TMP_1.$$p = null;
          Opal.find_super_dispatcher(self, 'initialize', TMP_1, $iter).apply(self, $zuper);
          self.locals = [];
          self.temps = [];
          self.args = [];
          self.ivars = [];
          self.gvars = [];
          self.parent = nil;
          self.queue = [];
          self.unique = "a";
          self.while_stack = [];
          self.identity = nil;
          self.defs = nil;
          self.methods = [];
          self.uses_block = false;
          return self.proto_ivars = [];
        };

        def.$in_scope = TMP_2 = function() {
          var $a, $b, TMP_3, self = this, $iter = TMP_2.$$p, block = $iter || nil;

          TMP_2.$$p = null;
          return ($a = ($b = self).$indent, $a.$$p = (TMP_3 = function(){var self = TMP_3.$$s || this, $a, $b;
            if (self.parent == null) self.parent = nil;

          self.parent = self.$compiler().$scope();
            (($a = [self]), $b = self.$compiler(), $b['$scope='].apply($b, $a), $a[$a.length-1]);
            block.$call(self);
            return (($a = [self.parent]), $b = self.$compiler(), $b['$scope='].apply($b, $a), $a[$a.length-1]);}, TMP_3.$$s = self, TMP_3), $a).call($b);
        };

        def['$class_scope?'] = function() {
          var $a, self = this;

          return ((($a = self.type['$==']("class")) !== false && $a !== nil) ? $a : self.type['$==']("module"));
        };

        def['$class?'] = function() {
          var self = this;

          return self.type['$==']("class");
        };

        def['$module?'] = function() {
          var self = this;

          return self.type['$==']("module");
        };

        def['$sclass?'] = function() {
          var self = this;

          return self.type['$==']("sclass");
        };

        def['$top?'] = function() {
          var self = this;

          return self.type['$==']("top");
        };

        def['$iter?'] = function() {
          var self = this;

          return self.type['$==']("iter");
        };

        def['$def?'] = function() {
          var self = this;

          return self.type['$==']("def");
        };

        def['$def_in_class?'] = function() {
          var $a, $b, $c, self = this;

          return ($a = ($b = ($c = self.defs['$!'](), $c !== false && $c !== nil ?self.type['$==']("def") : $c), $b !== false && $b !== nil ?self.parent : $b), $a !== false && $a !== nil ?self.parent['$class?']() : $a);
        };

        def.$proto = function() {
          var self = this;

          return "def";
        };

        def['$should_donate?'] = function() {
          var self = this;

          return self.type['$==']("module");
        };

        def.$to_vars = function() {
          var $a, $b, $c, TMP_4, $d, TMP_5, $e, TMP_6, $f, TMP_7, self = this, vars = nil, iv = nil, gv = nil, indent = nil, str = nil, pvars = nil, result = nil;

          vars = self.temps.$dup();
          ($a = vars).$push.apply($a, [].concat(($b = ($c = self.locals).$map, $b.$$p = (TMP_4 = function(l){var self = TMP_4.$$s || this;
if (l == null) l = nil;
          return "" + (l) + " = nil"}, TMP_4.$$s = self, TMP_4), $b).call($c)));
          iv = ($b = ($d = self.$ivars()).$map, $b.$$p = (TMP_5 = function(ivar){var self = TMP_5.$$s || this;
if (ivar == null) ivar = nil;
          return "if (self" + (ivar) + " == null) self" + (ivar) + " = nil;\n"}, TMP_5.$$s = self, TMP_5), $b).call($d);
          gv = ($b = ($e = self.$gvars()).$map, $b.$$p = (TMP_6 = function(gvar){var self = TMP_6.$$s || this;
if (gvar == null) gvar = nil;
          return "if ($gvars" + (gvar) + " == null) $gvars" + (gvar) + " = nil;\n"}, TMP_6.$$s = self, TMP_6), $b).call($e);
          indent = self.compiler.$parser_indent();
          str = (function() {if ((($b = vars['$empty?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            return ""
            } else {
            return "var " + (vars.$join(", ")) + ";\n"
          }; return nil; })();
          if ((($b = self.$ivars()['$empty?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            } else {
            str = str['$+']("" + (indent) + (iv.$join(indent)))
          };
          if ((($b = self.$gvars()['$empty?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            } else {
            str = str['$+']("" + (indent) + (gv.$join(indent)))
          };
          if ((($b = ($f = self['$class?'](), $f !== false && $f !== nil ?self.proto_ivars['$empty?']()['$!']() : $f)) !== nil && (!$b.$$is_boolean || $b == true))) {
            pvars = ($b = ($f = self.proto_ivars).$map, $b.$$p = (TMP_7 = function(i){var self = TMP_7.$$s || this;
if (i == null) i = nil;
            return "" + (self.$proto()) + (i)}, TMP_7.$$s = self, TMP_7), $b).call($f).$join(" = ");
            result = "%s\n%s%s = nil;"['$%']([str, indent, pvars]);
            } else {
            result = str
          };
          return self.$fragment(result);
        };

        def.$to_donate_methods = function() {
          var $a, $b, self = this;

          if ((($a = ($b = self['$should_donate?'](), $b !== false && $b !== nil ?self.methods['$empty?']()['$!']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$fragment("%s;Opal.donate(self, [%s]);"['$%']([self.compiler.$parser_indent(), ($a = ($b = self.methods).$map, $a.$$p = "inspect".$to_proc(), $a).call($b).$join(", ")]))
            } else {
            return self.$fragment("")
          };
        };

        def.$add_scope_ivar = function(ivar) {
          var $a, self = this;

          if ((($a = self['$def_in_class?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.parent.$add_proto_ivar(ivar)
          } else if ((($a = self.ivars['$include?'](ivar)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return nil
            } else {
            return self.ivars['$<<'](ivar)
          };
        };

        def.$add_scope_gvar = function(gvar) {
          var $a, self = this;

          if ((($a = self.gvars['$include?'](gvar)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return nil
            } else {
            return self.gvars['$<<'](gvar)
          };
        };

        def.$add_proto_ivar = function(ivar) {
          var $a, self = this;

          if ((($a = self.proto_ivars['$include?'](ivar)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return nil
            } else {
            return self.proto_ivars['$<<'](ivar)
          };
        };

        def.$add_arg = function(arg) {
          var $a, self = this;

          if ((($a = self.args['$include?'](arg)) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            self.args['$<<'](arg)
          };
          return arg;
        };

        def.$add_scope_local = function(local) {
          var $a, self = this;

          if ((($a = self['$has_local?'](local)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return nil};
          return self.locals['$<<'](local);
        };

        def['$has_local?'] = function(local) {
          var $a, $b, self = this;

          if ((($a = ((($b = self.locals['$include?'](local)) !== false && $b !== nil) ? $b : self.args['$include?'](local))) !== nil && (!$a.$$is_boolean || $a == true))) {
            return true};
          if ((($a = ($b = self.parent, $b !== false && $b !== nil ?self.type['$==']("iter") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.parent['$has_local?'](local)};
          return false;
        };

        def.$add_scope_temp = function(tmps) {
          var $a, self = this;

          tmps = $slice.call(arguments, 0);
          return ($a = self.temps).$push.apply($a, [].concat(tmps));
        };

        def['$has_temp?'] = function(tmp) {
          var self = this;

          return self.temps['$include?'](tmp);
        };

        def.$new_temp = function() {
          var $a, self = this, tmp = nil;

          if ((($a = self.queue['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            return self.queue.$pop()
          };
          tmp = self.$next_temp();
          self.temps['$<<'](tmp);
          return tmp;
        };

        def.$next_temp = function() {
          var self = this, tmp = nil;

          tmp = "$" + (self.unique);
          self.unique = self.unique.$succ();
          return tmp;
        };

        def.$queue_temp = function(name) {
          var self = this;

          return self.queue['$<<'](name);
        };

        def.$push_while = function() {
          var self = this, info = nil;

          info = $hash2([], {});
          self.while_stack.$push(info);
          return info;
        };

        def.$pop_while = function() {
          var self = this;

          return self.while_stack.$pop();
        };

        def['$in_while?'] = function() {
          var self = this;

          return self.while_stack['$empty?']()['$!']();
        };

        def['$uses_block!'] = function() {
          var $a, $b, self = this;

          if ((($a = (($b = self.type['$==']("iter")) ? self.parent : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.parent['$uses_block!']()
            } else {
            self.uses_block = true;
            return self['$identify!']();
          };
        };

        def['$identify!'] = function() {
          var $a, self = this;

          if ((($a = self.identity) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.identity};
          self.identity = self.compiler.$unique_temp();
          if ((($a = self.parent) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.parent.$add_scope_temp(self.identity)};
          return self.identity;
        };

        def.$identity = function() {
          var self = this;

          return self.identity;
        };

        def.$find_parent_def = function() {
          var $a, $b, self = this, scope = nil;

          scope = self;
          while ((($b = scope = scope.$parent()) !== nil && (!$b.$$is_boolean || $b == true))) {
          if ((($b = scope['$def?']()) !== nil && (!$b.$$is_boolean || $b == true))) {
            return scope}};
          return nil;
        };

        def.$get_super_chain = function() {
          var $a, $b, self = this, chain = nil, scope = nil, defn = nil, mid = nil;

          $a = [[], self, "null", "null"], chain = $a[0], scope = $a[1], defn = $a[2], mid = $a[3];
          while (scope !== false && scope !== nil) {
          if (scope.$type()['$==']("iter")) {
            chain['$<<'](scope['$identify!']());
            if ((($b = scope.$parent()) !== nil && (!$b.$$is_boolean || $b == true))) {
              scope = scope.$parent()};
          } else if (scope.$type()['$==']("def")) {
            defn = scope['$identify!']();
            mid = "'" + (scope.$mid()) + "'";
            break;;
            } else {
            break;
          }};
          return [chain, defn, mid];
        };

        return (def['$uses_block?'] = function() {
          var self = this;

          return self.uses_block;
        }, nil) && 'uses_block?';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/module"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$name_and_base', '$helper', '$push', '$line', '$in_scope', '$name=', '$scope', '$add_temp', '$proto', '$stmt', '$body', '$s', '$empty_line', '$to_vars', '$to_donate_methods', '$==', '$type', '$cid', '$to_s', '$[]', '$expr', '$raise']);
  self.$require("opal/nodes/scope");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ModuleNode(){};
        var self = $ModuleNode = $klass($base, $super, 'ModuleNode', $ModuleNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("module");

        self.$children("cid", "body");

        def.$compile = function() {
          var $a, $b, TMP_1, self = this, name = nil, base = nil;

          $a = Opal.to_ary(self.$name_and_base()), name = ($a[0] == null ? nil : $a[0]), base = ($a[1] == null ? nil : $a[1]);
          self.$helper("module");
          self.$push("(function($base) {");
          self.$line("  var self = $module($base, '" + (name) + "');");
          ($a = ($b = self).$in_scope, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, $b, body_code = nil;

          (($a = [name]), $b = self.$scope(), $b['$name='].apply($b, $a), $a[$a.length-1]);
            self.$add_temp("" + (self.$scope().$proto()) + " = self.$$proto");
            self.$add_temp("$scope = self.$$scope");
            body_code = self.$stmt(((($a = self.$body()) !== false && $a !== nil) ? $a : self.$s("nil")));
            self.$empty_line();
            self.$line(self.$scope().$to_vars());
            self.$line(body_code);
            return self.$line(self.$scope().$to_donate_methods());}, TMP_1.$$s = self, TMP_1), $a).call($b);
          return self.$line("})(", base, ")");
        };

        return (def.$name_and_base = function() {
          var self = this;

          if (self.$cid().$type()['$==']("const")) {
            return [self.$cid()['$[]'](1).$to_s(), "self"]
          } else if (self.$cid().$type()['$==']("colon2")) {
            return [self.$cid()['$[]'](2).$to_s(), self.$expr(self.$cid()['$[]'](1))]
          } else if (self.$cid().$type()['$==']("colon3")) {
            return [self.$cid()['$[]'](1).$to_s(), "Opal.Object"]
            } else {
            return self.$raise("Bad receiver in module")
          };
        }, nil) && 'name_and_base';
      })(self, $scope.get('ScopeNode'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/class"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$name_and_base', '$helper', '$push', '$line', '$in_scope', '$name=', '$scope', '$add_temp', '$proto', '$body_code', '$empty_line', '$to_vars', '$super_code', '$sup', '$expr', '$stmt', '$returns', '$compiler', '$body', '$s']);
  self.$require("opal/nodes/module");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ClassNode(){};
        var self = $ClassNode = $klass($base, $super, 'ClassNode', $ClassNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("class");

        self.$children("cid", "sup", "body");

        def.$compile = function() {
          var $a, $b, TMP_1, self = this, name = nil, base = nil;

          $a = Opal.to_ary(self.$name_and_base()), name = ($a[0] == null ? nil : $a[0]), base = ($a[1] == null ? nil : $a[1]);
          self.$helper("klass");
          self.$push("(function($base, $super) {");
          self.$line("  function $" + (name) + "(){};");
          self.$line("  var self = $" + (name) + " = $klass($base, $super, '" + (name) + "', $" + (name) + ");");
          ($a = ($b = self).$in_scope, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, $b, body_code = nil;

          (($a = [name]), $b = self.$scope(), $b['$name='].apply($b, $a), $a[$a.length-1]);
            self.$add_temp("" + (self.$scope().$proto()) + " = self.$$proto");
            self.$add_temp("$scope = self.$$scope");
            body_code = self.$body_code();
            self.$empty_line();
            self.$line(self.$scope().$to_vars());
            return self.$line(body_code);}, TMP_1.$$s = self, TMP_1), $a).call($b);
          return self.$line("})(", base, ", ", self.$super_code(), ")");
        };

        def.$super_code = function() {
          var $a, self = this;

          if ((($a = self.$sup()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$expr(self.$sup())
            } else {
            return "null"
          };
        };

        return (def.$body_code = function() {
          var $a, self = this;

          return self.$stmt(self.$compiler().$returns(((($a = self.$body()) !== false && $a !== nil) ? $a : self.$s("nil"))));
        }, nil) && 'body_code';
      })(self, $scope.get('ModuleNode'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/singleton_class"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$push', '$in_scope', '$add_temp', '$line', '$to_vars', '$scope', '$stmt', '$returns', '$compiler', '$body', '$recv', '$object']);
  self.$require("opal/nodes/scope");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $SingletonClassNode(){};
        var self = $SingletonClassNode = $klass($base, $super, 'SingletonClassNode', $SingletonClassNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("sclass");

        self.$children("object", "body");

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this;

          self.$push("(function(self) {");
          ($a = ($b = self).$in_scope, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this;

          self.$add_temp("$scope = self.$$scope");
            self.$add_temp("def = self.$$proto");
            self.$line(self.$scope().$to_vars());
            return self.$line(self.$stmt(self.$compiler().$returns(self.$body())));}, TMP_1.$$s = self, TMP_1), $a).call($b);
          return self.$line("})(", self.$recv(self.$object()), ".$singleton_class())");
        }, nil) && 'compile';
      })(self, $scope.get('ScopeNode'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/iter"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$extract_opt_args', '$extract_block_arg', '$is_a?', '$last', '$args', '$==', '$type', '$[]', '$pop', '$length', '$args_to_params', '$<<', '$in_scope', '$identify!', '$scope', '$add_temp', '$compile_args', '$add_arg', '$push', '$-', '$block_name=', '$line', '$stmt', '$body', '$to_vars', '$unshift', '$join', '$each_with_index', '$variable', '$find', '$to_sym', '$expr', '$raise', '$shift', '$===', '$args_sexp', '$nil?', '$s', '$returns', '$compiler', '$body_sexp', '$each', '$next_temp']);
  self.$require("opal/nodes/scope");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $IterNode(){};
        var self = $IterNode = $klass($base, $super, 'IterNode', $IterNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("iter");

        self.$children("args_sexp", "body_sexp");

        def.$compile = function() {
          var $a, $b, TMP_1, self = this, opt_args = nil, block_arg = nil, splat = nil, len = nil, params = nil, to_vars = nil, identity = nil, body_code = nil;

          opt_args = self.$extract_opt_args();
          block_arg = self.$extract_block_arg();
          if ((($a = ($b = self.$args().$last()['$is_a?']($scope.get('Sexp')), $b !== false && $b !== nil ?self.$args().$last().$type()['$==']("splat") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            splat = self.$args().$last()['$[]'](1)['$[]'](1);
            self.$args().$pop();
            len = self.$args().$length();};
          params = self.$args_to_params(self.$args()['$[]']($range(1, -1, false)));
          if (splat !== false && splat !== nil) {
            params['$<<'](splat)};
          to_vars = identity = body_code = nil;
          ($a = ($b = self).$in_scope, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, $b, scope_name = nil;

          identity = self.$scope()['$identify!']();
            self.$add_temp("self = " + (identity) + ".$$s || this");
            self.$compile_args(self.$args()['$[]']($range(1, -1, false)), opt_args, params);
            if (splat !== false && splat !== nil) {
              self.$scope().$add_arg(splat);
              self.$push("" + (splat) + " = $slice.call(arguments, " + (len['$-'](1)) + ");");};
            if (block_arg !== false && block_arg !== nil) {
              (($a = [block_arg]), $b = self.$scope(), $b['$block_name='].apply($b, $a), $a[$a.length-1]);
              self.$scope().$add_temp(block_arg);
              scope_name = self.$scope()['$identify!']();
              self.$line("" + (block_arg) + " = " + (scope_name) + ".$$p || nil, " + (scope_name) + ".$$p = null;");};
            body_code = self.$stmt(self.$body());
            return to_vars = self.$scope().$to_vars();}, TMP_1.$$s = self, TMP_1), $a).call($b);
          self.$line(body_code);
          self.$unshift(to_vars);
          self.$unshift("(" + (identity) + " = function(" + (params.$join(", ")) + "){");
          return self.$push("}, " + (identity) + ".$$s = self, " + (identity) + ")");
        };

        def.$compile_args = function(args, opt_args, params) {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = args).$each_with_index, $a.$$p = (TMP_2 = function(arg, idx){var self = TMP_2.$$s || this, $a, $b, $c, $d, TMP_3, TMP_4, current_opt = nil;
if (arg == null) arg = nil;if (idx == null) idx = nil;
          if (arg.$type()['$==']("lasgn")) {
              arg = self.$variable(arg['$[]'](1));
              if ((($a = (($b = opt_args !== false && opt_args !== nil) ? current_opt = ($c = ($d = opt_args).$find, $c.$$p = (TMP_3 = function(s){var self = TMP_3.$$s || this;
if (s == null) s = nil;
              return s['$[]'](1)['$=='](arg.$to_sym())}, TMP_3.$$s = self, TMP_3), $c).call($d) : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
                return self.$push("if (" + (arg) + " == null) " + (arg) + " = ", self.$expr(current_opt['$[]'](2)), ";")
                } else {
                return self.$push("if (" + (arg) + " == null) " + (arg) + " = nil;")
              };
            } else if (arg.$type()['$==']("array")) {
              return ($a = ($b = arg['$[]']($range(1, -1, false))).$each_with_index, $a.$$p = (TMP_4 = function(_arg, _idx){var self = TMP_4.$$s || this;
if (_arg == null) _arg = nil;if (_idx == null) _idx = nil;
              _arg = self.$variable(_arg['$[]'](1));
                return self.$push("" + (_arg) + " = " + (params['$[]'](idx)) + "[" + (_idx) + "];");}, TMP_4.$$s = self, TMP_4), $a).call($b)
              } else {
              return self.$raise("Bad block arg type")
            }}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };

        def.$extract_opt_args = function() {
          var $a, $b, self = this, opt_args = nil;

          if ((($a = ($b = self.$args().$last()['$is_a?']($scope.get('Sexp')), $b !== false && $b !== nil ?self.$args().$last().$type()['$==']("block") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            opt_args = self.$args().$pop();
            opt_args.$shift();
            return opt_args;
            } else {
            return nil
          };
        };

        def.$extract_block_arg = function() {
          var $a, $b, self = this, block_arg = nil;

          if ((($a = ($b = self.$args().$last()['$is_a?']($scope.get('Sexp')), $b !== false && $b !== nil ?self.$args().$last().$type()['$==']("block_pass") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            block_arg = self.$args().$pop();
            return block_arg = block_arg['$[]'](1)['$[]'](1).$to_sym();
            } else {
            return nil
          };
        };

        def.$args = function() {
          var $a, $b, self = this;

          if ((($a = ((($b = $scope.get('Fixnum')['$==='](self.$args_sexp())) !== false && $b !== nil) ? $b : self.$args_sexp()['$nil?']())) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$s("array")
          } else if (self.$args_sexp().$type()['$==']("lasgn")) {
            return self.$s("array", self.$args_sexp())
            } else {
            return self.$args_sexp()['$[]'](1)
          };
        };

        def.$body = function() {
          var $a, self = this;

          return self.$compiler().$returns(((($a = self.$body_sexp()) !== false && $a !== nil) ? $a : self.$s("nil")));
        };

        return (def.$args_to_params = function(sexp) {
          var $a, $b, TMP_5, self = this, result = nil;

          result = [];
          ($a = ($b = sexp).$each, $a.$$p = (TMP_5 = function(arg){var self = TMP_5.$$s || this, ref = nil;
if (arg == null) arg = nil;
          if (arg['$[]'](0)['$==']("lasgn")) {
              ref = self.$variable(arg['$[]'](1));
              self.$scope().$add_arg(ref);
              return result['$<<'](ref);
            } else if (arg['$[]'](0)['$==']("array")) {
              return result['$<<'](self.$scope().$next_temp())
              } else {
              return self.$raise("Bad js_block_arg: " + (arg['$[]'](0)))
            }}, TMP_5.$$s = self, TMP_5), $a).call($b);
          return result;
        }, nil) && 'args_to_params';
      })(self, $scope.get('ScopeNode'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/def"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$mid_to_jsid', '$to_s', '$mid', '$===', '$last', '$args', '$pop', '$-', '$length', '$start_with?', '$to_sym', '$variable', '$[]', '$==', '$[]=', '$arity_check?', '$compiler', '$arity_check', '$in_scope', '$mid=', '$scope', '$recvr', '$defs=', '$uses_block!', '$add_arg', '$block_name=', '$process', '$stmt', '$returns', '$stmts', '$add_temp', '$line', '$each', '$expr', '$identity', '$uses_block?', '$unshift', '$current_indent', '$to_vars', '$uses_zuper', '$catch_return', '$push', '$recv', '$class?', '$include?', '$name', '$wrap', '$class_scope?', '$<<', '$methods', '$proto', '$iter?', '$type', '$top?', '$expr?', '$inspect', '$size', '$-@', '$<', '$+', '$each_with_index']);
  self.$require("opal/nodes/scope");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $DefNode(){};
        var self = $DefNode = $klass($base, $super, 'DefNode', $DefNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("def");

        self.$children("recvr", "mid", "args", "stmts");

        def.$compile = function() {
          var $a, $b, TMP_1, $c, self = this, jsid = nil, params = nil, scope_name = nil, opt = nil, argc = nil, block_name = nil, uses_splat = nil, splat = nil, arity_code = nil;

          jsid = self.$mid_to_jsid(self.$mid().$to_s());
          params = nil;
          scope_name = nil;
          if ((($a = $scope.get('Sexp')['$==='](self.$args().$last())) !== nil && (!$a.$$is_boolean || $a == true))) {
            opt = self.$args().$pop()};
          argc = self.$args().$length()['$-'](1);
          if ((($a = self.$args().$last().$to_s()['$start_with?']("&")) !== nil && (!$a.$$is_boolean || $a == true))) {
            block_name = self.$variable(self.$args().$pop().$to_s()['$[]']($range(1, -1, false))).$to_sym();
            argc = argc['$-'](1);};
          if ((($a = self.$args().$last().$to_s()['$start_with?']("*")) !== nil && (!$a.$$is_boolean || $a == true))) {
            uses_splat = true;
            if (self.$args().$last()['$==']("*")) {
              argc = argc['$-'](1)
              } else {
              splat = self.$args()['$[]'](-1).$to_s()['$[]']($range(1, -1, false)).$to_sym();
              self.$args()['$[]='](-1, splat);
              argc = argc['$-'](1);
            };};
          if ((($a = self.$compiler()['$arity_check?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            arity_code = self.$arity_check(self.$args(), opt, uses_splat, block_name, self.$mid())};
          ($a = ($b = self).$in_scope, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, $b, TMP_2, yielder = nil, stmt_code = nil;

          (($a = [self.$mid()]), $b = self.$scope(), $b['$mid='].apply($b, $a), $a[$a.length-1]);
            if ((($a = self.$recvr()) !== nil && (!$a.$$is_boolean || $a == true))) {
              (($a = [true]), $b = self.$scope(), $b['$defs='].apply($b, $a), $a[$a.length-1])};
            if (block_name !== false && block_name !== nil) {
              self.$scope()['$uses_block!']();
              self.$scope().$add_arg(block_name);};
            yielder = ((($a = block_name) !== false && $a !== nil) ? $a : "$yield");
            (($a = [yielder]), $b = self.$scope(), $b['$block_name='].apply($b, $a), $a[$a.length-1]);
            params = self.$process(self.$args());
            stmt_code = self.$stmt(self.$compiler().$returns(self.$stmts()));
            self.$add_temp("self = this");
            if (splat !== false && splat !== nil) {
              self.$line("" + (self.$variable(splat)) + " = $slice.call(arguments, " + (argc) + ");")};
            if (opt !== false && opt !== nil) {
              ($a = ($b = opt['$[]']($range(1, -1, false))).$each, $a.$$p = (TMP_2 = function(o){var self = TMP_2.$$s || this;
if (o == null) o = nil;
              if (o['$[]'](2)['$[]'](2)['$==']("undefined")) {
                  return nil;};
                self.$line("if (" + (self.$variable(o['$[]'](1))) + " == null) {");
                self.$line("  ", self.$expr(o));
                return self.$line("}");}, TMP_2.$$s = self, TMP_2), $a).call($b)};
            scope_name = self.$scope().$identity();
            if ((($a = self.$scope()['$uses_block?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$add_temp("$iter = " + (scope_name) + ".$$p");
              self.$add_temp("" + (yielder) + " = $iter || nil");
              self.$line("" + (scope_name) + ".$$p = null;");};
            self.$unshift("\n" + (self.$current_indent()), self.$scope().$to_vars());
            self.$line(stmt_code);
            if (arity_code !== false && arity_code !== nil) {
              self.$unshift(arity_code)};
            if ((($a = self.$scope().$uses_zuper()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$unshift("var $zuper = $slice.call(arguments, 0);")};
            if ((($a = self.$scope().$catch_return()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$unshift("try {\n");
              self.$line("} catch ($returner) { if ($returner === Opal.returner) { return $returner.$v }");
              return self.$push(" throw $returner; }");
              } else {
              return nil
            };}, TMP_1.$$s = self, TMP_1), $a).call($b);
          self.$unshift(") {");
          self.$unshift(params);
          self.$unshift("function(");
          if (scope_name !== false && scope_name !== nil) {
            self.$unshift("" + (scope_name) + " = ")};
          self.$line("}");
          if ((($a = self.$recvr()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$unshift("Opal.defs(", self.$recv(self.$recvr()), ", '$" + (self.$mid()) + "', ");
            self.$push(")");
          } else if ((($a = ($c = self.$scope()['$class?'](), $c !== false && $c !== nil ?["Object", "BasicObject"]['$include?'](self.$scope().$name()) : $c)) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$wrap("Opal.defn(self, '$" + (self.$mid()) + "', ", ")")
          } else if ((($a = self.$scope()['$class_scope?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$scope().$methods()['$<<']("$" + (self.$mid()));
            self.$unshift("" + (self.$scope().$proto()) + (jsid) + " = ");
          } else if ((($a = self.$scope()['$iter?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$wrap("Opal.defn(self, '$" + (self.$mid()) + "', ", ")")
          } else if (self.$scope().$type()['$==']("sclass")) {
            self.$unshift("self.$$proto" + (jsid) + " = ")
          } else if ((($a = self.$scope()['$top?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$unshift("Opal.Object.$$proto" + (jsid) + " = ")
            } else {
            self.$unshift("def" + (jsid) + " = ")
          };
          if ((($a = self['$expr?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(", ", nil) && '" + (self.$mid()) + "'")
            } else {
            return nil
          };
        };

        return (def.$arity_check = function(args, opt, splat, block_name, mid) {
          var $a, $b, self = this, meth = nil, arity = nil, aritycode = nil;

          meth = mid.$to_s().$inspect();
          arity = args.$size()['$-'](1);
          if (opt !== false && opt !== nil) {
            arity = arity['$-']((opt.$size()['$-'](1)))};
          if (splat !== false && splat !== nil) {
            arity = arity['$-'](1)};
          if ((($a = ((($b = opt) !== false && $b !== nil) ? $b : splat)) !== nil && (!$a.$$is_boolean || $a == true))) {
            arity = arity['$-@']()['$-'](1)};
          aritycode = "var $arity = arguments.length;";
          if (arity['$<'](0)) {
            return aritycode['$+']("if ($arity < " + ((arity['$+'](1))['$-@']()) + ") { Opal.ac($arity, " + (arity) + ", this, " + (meth) + "); }")
            } else {
            return aritycode['$+']("if ($arity !== " + (arity) + ") { Opal.ac($arity, " + (arity) + ", this, " + (meth) + "); }")
          };
        }, nil) && 'arity_check';
      })(self, $scope.get('ScopeNode'));

      (function($base, $super) {
        function $ArgsNode(){};
        var self = $ArgsNode = $klass($base, $super, 'ArgsNode', $ArgsNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("args");

        return (def.$compile = function() {
          var $a, $b, TMP_3, self = this;

          return ($a = ($b = self.$children()).$each_with_index, $a.$$p = (TMP_3 = function(child, idx){var self = TMP_3.$$s || this;
if (child == null) child = nil;if (idx == null) idx = nil;
          if (child.$to_s()['$==']("*")) {
              return nil;};
            child = child.$to_sym();
            if (idx['$=='](0)) {
              } else {
              self.$push(", ")
            };
            child = self.$variable(child);
            self.$scope().$add_arg(child.$to_sym());
            return self.$push(child.$to_s());}, TMP_3.$$s = self, TMP_3), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/if"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$truthy', '$falsy', '$skip_check_present?', '$push', '$js_truthy', '$test', '$indent', '$line', '$stmt', '$==', '$type', '$needs_wrapper?', '$wrap', '$returns', '$compiler', '$true_body', '$s', '$false_body', '$expr?', '$recv?']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $IfNode(){};
        var self = $IfNode = $klass($base, $super, 'IfNode', $IfNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("if");

        self.$children("test", "true_body", "false_body");

        Opal.cdecl($scope, 'RUBY_ENGINE_CHECK', ["call", ["const", "RUBY_ENGINE"], "==", ["arglist", ["str", "opal"]]]);

        Opal.cdecl($scope, 'RUBY_PLATFORM_CHECK', ["call", ["const", "RUBY_PLATFORM"], "==", ["arglist", ["str", "opal"]]]);

        def.$compile = function() {
          var $a, $b, TMP_1, $c, TMP_2, self = this, truthy = nil, falsy = nil;

          $a = [self.$truthy(), self.$falsy()], truthy = $a[0], falsy = $a[1];
          if ((($a = self['$skip_check_present?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            falsy = nil};
          self.$push("if (", self.$js_truthy(self.$test()), ") {");
          if (truthy !== false && truthy !== nil) {
            ($a = ($b = self).$indent, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this;

            return self.$line(self.$stmt(truthy))}, TMP_1.$$s = self, TMP_1), $a).call($b)};
          if (falsy !== false && falsy !== nil) {
            if (falsy.$type()['$==']("if")) {
              self.$line("} else ", self.$stmt(falsy))
              } else {
              ($a = ($c = self).$indent, $a.$$p = (TMP_2 = function(){var self = TMP_2.$$s || this;

              self.$line("} else {");
                return self.$line(self.$stmt(falsy));}, TMP_2.$$s = self, TMP_2), $a).call($c);
              self.$line("}");
            }
            } else {
            self.$push("}")
          };
          if ((($a = self['$needs_wrapper?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(function() {", "; return nil; })()")
            } else {
            return nil
          };
        };

        def['$skip_check_present?'] = function() {
          var $a, self = this;

          return ((($a = self.$test()['$==']($scope.get('RUBY_ENGINE_CHECK'))) !== false && $a !== nil) ? $a : self.$test()['$==']($scope.get('RUBY_PLATFORM_CHECK')));
        };

        def.$truthy = function() {
          var $a, self = this;

          if ((($a = self['$needs_wrapper?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compiler().$returns(((($a = self.$true_body()) !== false && $a !== nil) ? $a : self.$s("nil")))
            } else {
            return self.$true_body()
          };
        };

        def.$falsy = function() {
          var $a, self = this;

          if ((($a = self['$needs_wrapper?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compiler().$returns(((($a = self.$false_body()) !== false && $a !== nil) ? $a : self.$s("nil")))
            } else {
            return self.$false_body()
          };
        };

        return (def['$needs_wrapper?'] = function() {
          var $a, self = this;

          return ((($a = self['$expr?']()) !== false && $a !== nil) ? $a : self['$recv?']());
        }, nil) && 'needs_wrapper?';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/logic"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$in_while?', '$push', '$expr_or_nil', '$value', '$wrap', '$compile_while', '$iter?', '$scope', '$compile_iter', '$error', '$[]', '$while_loop', '$stmt?', '$[]=', '$identity', '$with_temp', '$expr', '$==', '$empty_splat?', '$type', '$recv', '$lhs', '$rhs', '$js_truthy_optimize', '$nil?', '$s', '$>', '$size', '$find_parent_def', '$expr?', '$def?', '$return_in_iter?', '$return_expr_in_def?', '$scope_to_catch_return', '$catch_return=', '$return_val', '$raise', '$to_s']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $NextNode(){};
        var self = $NextNode = $klass($base, $super, 'NextNode', $NextNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("next");

        self.$children("value");

        return (def.$compile = function() {
          var $a, self = this;

          if ((($a = self['$in_while?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("continue;")};
          self.$push(self.$expr_or_nil(self.$value()));
          return self.$wrap("return ", ";");
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $BreakNode(){};
        var self = $BreakNode = $klass($base, $super, 'BreakNode', $BreakNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("break");

        self.$children("value");

        def.$compile = function() {
          var $a, self = this;

          if ((($a = self['$in_while?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compile_while()
          } else if ((($a = self.$scope()['$iter?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compile_iter()
            } else {
            return self.$error("void value expression: cannot use break outside of iter/while")
          };
        };

        def.$compile_while = function() {
          var $a, self = this;

          if ((($a = self.$while_loop()['$[]']("closure")) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("return ", self.$expr_or_nil(self.$value()))
            } else {
            return self.$push("break;")
          };
        };

        return (def.$compile_iter = function() {
          var $a, self = this;

          if ((($a = self['$stmt?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            self.$error("break must be used as a statement")
          };
          self.$push(self.$expr_or_nil(self.$value()));
          return self.$wrap("return ($breaker.$v = ", ", $breaker)");
        }, nil) && 'compile_iter';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $RedoNode(){};
        var self = $RedoNode = $klass($base, $super, 'RedoNode', $RedoNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("redo");

        def.$compile = function() {
          var $a, self = this;

          if ((($a = self['$in_while?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compile_while()
          } else if ((($a = self.$scope()['$iter?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compile_iter()
            } else {
            return self.$push("REDO()")
          };
        };

        def.$compile_while = function() {
          var self = this;

          self.$while_loop()['$[]=']("use_redo", true);
          return self.$push("" + (self.$while_loop()['$[]']("redo_var")) + " = true");
        };

        return (def.$compile_iter = function() {
          var self = this;

          return self.$push("return " + (self.$scope().$identity()) + ".apply(null, $slice.call(arguments))");
        }, nil) && 'compile_iter';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $NotNode(){};
        var self = $NotNode = $klass($base, $super, 'NotNode', $NotNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("not");

        self.$children("value");

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_1 = function(tmp){var self = TMP_1.$$s || this;
if (tmp == null) tmp = nil;
          self.$push(self.$expr(self.$value()));
            return self.$wrap("(" + (tmp) + " = ", ", (" + (tmp) + " === nil || " + (tmp) + " === false))");}, TMP_1.$$s = self, TMP_1), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $SplatNode(){};
        var self = $SplatNode = $klass($base, $super, 'SplatNode', $SplatNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("splat");

        self.$children("value");

        def['$empty_splat?'] = function() {
          var $a, self = this;

          return ((($a = self.$value()['$=='](["nil"])) !== false && $a !== nil) ? $a : self.$value()['$=='](["paren", ["nil"]]));
        };

        return (def.$compile = function() {
          var $a, self = this;

          if ((($a = self['$empty_splat?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("[]")
          } else if (self.$value().$type()['$==']("sym")) {
            return self.$push("[", self.$expr(self.$value()), "]")
            } else {
            return self.$push(self.$recv(self.$value()))
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $OrNode(){};
        var self = $OrNode = $klass($base, $super, 'OrNode', $OrNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("or");

        self.$children("lhs", "rhs");

        return (def.$compile = function() {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_2 = function(tmp){var self = TMP_2.$$s || this;
if (tmp == null) tmp = nil;
          self.$push("(((" + (tmp) + " = ");
            self.$push(self.$expr(self.$lhs()));
            self.$push(") !== false && " + (tmp) + " !== nil) ? " + (tmp) + " : ");
            self.$push(self.$expr(self.$rhs()));
            return self.$push(")");}, TMP_2.$$s = self, TMP_2), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $AndNode(){};
        var self = $AndNode = $klass($base, $super, 'AndNode', $AndNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("and");

        self.$children("lhs", "rhs");

        return (def.$compile = function() {
          var $a, $b, TMP_3, self = this, truthy_opt = nil;

          truthy_opt = nil;
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_3 = function(tmp){var self = TMP_3.$$s || this, $a;
if (tmp == null) tmp = nil;
          if ((($a = truthy_opt = self.$js_truthy_optimize(self.$lhs())) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$push("((" + (tmp) + " = ", truthy_opt);
              self.$push(") ? ");
              self.$push(self.$expr(self.$rhs()));
              return self.$push(" : " + (tmp) + ")");
              } else {
              self.$push("(" + (tmp) + " = ");
              self.$push(self.$expr(self.$lhs()));
              self.$push(", " + (tmp) + " !== false && " + (tmp) + " !== nil ?");
              self.$push(self.$expr(self.$rhs()));
              return self.$push(" : " + (tmp) + ")");
            }}, TMP_3.$$s = self, TMP_3), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ReturnNode(){};
        var self = $ReturnNode = $klass($base, $super, 'ReturnNode', $ReturnNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("return");

        self.$children("value");

        def.$return_val = function() {
          var $a, self = this;

          if ((($a = self.$value()['$nil?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$expr(self.$s("nil"))
          } else if (self.$children().$size()['$>'](1)) {
            return self.$expr(($a = self).$s.apply($a, ["array"].concat(self.$children())))
            } else {
            return self.$expr(self.$value())
          };
        };

        def['$return_in_iter?'] = function() {
          var $a, $b, self = this, parent_def = nil;

          if ((($a = ($b = self.$scope()['$iter?'](), $b !== false && $b !== nil ?parent_def = self.$scope().$find_parent_def() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return parent_def
            } else {
            return nil
          };
        };

        def['$return_expr_in_def?'] = function() {
          var $a, $b, self = this;

          if ((($a = ($b = self['$expr?'](), $b !== false && $b !== nil ?self.$scope()['$def?']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$scope()
            } else {
            return nil
          };
        };

        def.$scope_to_catch_return = function() {
          var $a, self = this;

          return ((($a = self['$return_in_iter?']()) !== false && $a !== nil) ? $a : self['$return_expr_in_def?']());
        };

        return (def.$compile = function() {
          var $a, $b, self = this, def_scope = nil;

          if ((($a = def_scope = self.$scope_to_catch_return()) !== nil && (!$a.$$is_boolean || $a == true))) {
            (($a = [true]), $b = def_scope, $b['$catch_return='].apply($b, $a), $a[$a.length-1]);
            return self.$push("Opal.ret(", self.$return_val(), ")");
          } else if ((($a = self['$stmt?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("return ", self.$return_val())
            } else {
            return self.$raise($scope.get('SyntaxError'), "void value expression: cannot return as an expression")
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $JSReturnNode(){};
        var self = $JSReturnNode = $klass($base, $super, 'JSReturnNode', $JSReturnNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("js_return");

        self.$children("value");

        return (def.$compile = function() {
          var self = this;

          self.$push("return ");
          return self.$push(self.$expr(self.$value()));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $JSTempNode(){};
        var self = $JSTempNode = $klass($base, $super, 'JSTempNode', $JSTempNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("js_tmp");

        self.$children("value");

        return (def.$compile = function() {
          var self = this;

          return self.$push(self.$value().$to_s());
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $BlockPassNode(){};
        var self = $BlockPassNode = $klass($base, $super, 'BlockPassNode', $BlockPassNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("block_pass");

        self.$children("value");

        return (def.$compile = function() {
          var self = this;

          return self.$push(self.$expr(self.$s("call", self.$value(), "to_proc", self.$s("arglist"))));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/definitions"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$push', '$process', '$value', '$proto', '$scope', '$mid_to_jsid', '$to_s', '$[]', '$mid', '$new_name', '$old_name', '$class?', '$module?', '$<<', '$methods', '$old_mid', '$new_mid', '$!', '$stmt?', '$==', '$type', '$body', '$stmt', '$returns', '$compiler', '$wrap', '$each_with_index', '$expr', '$empty?', '$stmt_join', '$find_inline_yield', '$child_is_expr?', '$class_scope?', '$current_indent', '$raw_expression?', '$include?', '$first', '$===', '$[]=', '$+', '$s', '$has_temp?', '$add_temp']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $SvalueNode(){};
        var self = $SvalueNode = $klass($base, $super, 'SvalueNode', $SvalueNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("svalue");

        self.$children("value");

        return (def.$compile = function() {
          var self = this;

          return self.$push(self.$process(self.$value(), self.level));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $UndefNode(){};
        var self = $UndefNode = $klass($base, $super, 'UndefNode', $UndefNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("undef");

        self.$children("mid");

        return (def.$compile = function() {
          var self = this;

          return self.$push("delete " + (self.$scope().$proto()) + (self.$mid_to_jsid(self.$mid()['$[]'](1).$to_s())));
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $AliasNode(){};
        var self = $AliasNode = $klass($base, $super, 'AliasNode', $AliasNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("alias");

        self.$children("new_name", "old_name");

        def.$new_mid = function() {
          var self = this;

          return self.$mid_to_jsid(self.$new_name()['$[]'](1).$to_s());
        };

        def.$old_mid = function() {
          var self = this;

          return self.$mid_to_jsid(self.$old_name()['$[]'](1).$to_s());
        };

        return (def.$compile = function() {
          var $a, $b, self = this;

          if ((($a = ((($b = self.$scope()['$class?']()) !== false && $b !== nil) ? $b : self.$scope()['$module?']())) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$scope().$methods()['$<<']("$" + (self.$new_name()['$[]'](1)));
            return self.$push("Opal.defn(self, '$" + (self.$new_name()['$[]'](1)) + "', " + (self.$scope().$proto()) + (self.$old_mid()) + ")");
            } else {
            return self.$push("self.$$proto" + (self.$new_mid()) + " = self.$$proto" + (self.$old_mid()))
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $BeginNode(){};
        var self = $BeginNode = $klass($base, $super, 'BeginNode', $BeginNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("begin");

        self.$children("body");

        return (def.$compile = function() {
          var $a, $b, self = this;

          if ((($a = ($b = self['$stmt?']()['$!'](), $b !== false && $b !== nil ?self.$body().$type()['$==']("block") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$push(self.$stmt(self.$compiler().$returns(self.$body())));
            return self.$wrap("(function() {", "})()");
            } else {
            return self.$push(self.$process(self.$body(), self.level))
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ParenNode(){};
        var self = $ParenNode = $klass($base, $super, 'ParenNode', $ParenNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("paren");

        self.$children("body");

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this;

          if (self.$body().$type()['$==']("block")) {
            ($a = ($b = self.$body().$children()).$each_with_index, $a.$$p = (TMP_1 = function(child, idx){var self = TMP_1.$$s || this;
if (child == null) child = nil;if (idx == null) idx = nil;
            if (idx['$=='](0)) {
                } else {
                self.$push(", ")
              };
              return self.$push(self.$expr(child));}, TMP_1.$$s = self, TMP_1), $a).call($b);
            return self.$wrap("(", ")");
            } else {
            self.$push(self.$process(self.$body(), self.level));
            if ((($a = self['$stmt?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              return nil
              } else {
              return self.$wrap("(", ")")
            };
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $BlockNode(){};
        var self = $BlockNode = $klass($base, $super, 'BlockNode', $BlockNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("block");

        def.$compile = function() {
          var $a, $b, TMP_2, self = this;

          if ((($a = self.$children()['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("nil")};
          return ($a = ($b = self.$children()).$each_with_index, $a.$$p = (TMP_2 = function(child, idx){var self = TMP_2.$$s || this, $a, yasgn = nil;
            if (self.level == null) self.level = nil;
if (child == null) child = nil;if (idx == null) idx = nil;
          if (idx['$=='](0)) {
              } else {
              self.$push(self.$stmt_join())
            };
            if ((($a = yasgn = self.$find_inline_yield(child)) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$push(self.$compiler().$process(yasgn, self.level));
              self.$push(";");};
            self.$push(self.$compiler().$process(child, self.level));
            if ((($a = self['$child_is_expr?'](child)) !== nil && (!$a.$$is_boolean || $a == true))) {
              return self.$push(";")
              } else {
              return nil
            };}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };

        def.$stmt_join = function() {
          var $a, self = this;

          if ((($a = self.$scope()['$class_scope?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return "\n\n" + (self.$current_indent())
            } else {
            return "\n" + (self.$current_indent())
          };
        };

        def['$child_is_expr?'] = function(child) {
          var $a, self = this;

          return ($a = self['$raw_expression?'](child), $a !== false && $a !== nil ?["stmt", "stmt_closure"]['$include?'](self.level) : $a);
        };

        def['$raw_expression?'] = function(child) {
          var self = this;

          return ["xstr", "dxstr"]['$include?'](child.$type())['$!']();
        };

        return (def.$find_inline_yield = function(stmt) {
          var $a, $b, TMP_3, $c, TMP_4, self = this, found = nil, $case = nil, arglist = nil;

          found = nil;
          $case = stmt.$first();if ("js_return"['$===']($case)) {if ((($a = found = self.$find_inline_yield(stmt['$[]'](1))) !== nil && (!$a.$$is_boolean || $a == true))) {
            found = found['$[]'](2)}}else if ("array"['$===']($case)) {($a = ($b = stmt['$[]']($range(1, -1, false))).$each_with_index, $a.$$p = (TMP_3 = function(el, idx){var self = TMP_3.$$s || this;
if (el == null) el = nil;if (idx == null) idx = nil;
          if (el.$first()['$==']("yield")) {
              found = el;
              return stmt['$[]='](idx['$+'](1), self.$s("js_tmp", "$yielded"));
              } else {
              return nil
            }}, TMP_3.$$s = self, TMP_3), $a).call($b)}else if ("call"['$===']($case)) {arglist = stmt['$[]'](3);
          ($a = ($c = arglist['$[]']($range(1, -1, false))).$each_with_index, $a.$$p = (TMP_4 = function(el, idx){var self = TMP_4.$$s || this;
if (el == null) el = nil;if (idx == null) idx = nil;
          if (el.$first()['$==']("yield")) {
              found = el;
              return arglist['$[]='](idx['$+'](1), self.$s("js_tmp", "$yielded"));
              } else {
              return nil
            }}, TMP_4.$$s = self, TMP_4), $a).call($c);};
          if (found !== false && found !== nil) {
            if ((($a = self.$scope()['$has_temp?']("$yielded")) !== nil && (!$a.$$is_boolean || $a == true))) {
              } else {
              self.$scope().$add_temp("$yielded")
            };
            return self.$s("yasgn", "$yielded", found);
            } else {
            return nil
          };
        }, nil) && 'find_inline_yield';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/yield"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$find_yielding_scope', '$uses_block!', '$block_name', '$yields_single_arg?', '$push', '$expr', '$first', '$wrap', '$s', '$uses_splat?', '$scope', '$def?', '$parent', '$!', '$==', '$size', '$any?', '$type', '$handle', '$compile_call', '$children', '$stmt?', '$with_temp', '$[]', '$yield_args', '$var_name']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $BaseYieldNode(){};
        var self = $BaseYieldNode = $klass($base, $super, 'BaseYieldNode', $BaseYieldNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.$compile_call = function(children, level) {
          var $a, $b, self = this, yielding_scope = nil, block_name = nil;

          yielding_scope = self.$find_yielding_scope();
          yielding_scope['$uses_block!']();
          block_name = ((($a = yielding_scope.$block_name()) !== false && $a !== nil) ? $a : "$yield");
          if ((($a = self['$yields_single_arg?'](children)) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$push(self.$expr(children.$first()));
            return self.$wrap("Opal.yield1(" + (block_name) + ", ", ")");
            } else {
            self.$push(self.$expr(($a = self).$s.apply($a, ["arglist"].concat(children))));
            if ((($b = self['$uses_splat?'](children)) !== nil && (!$b.$$is_boolean || $b == true))) {
              return self.$wrap("Opal.yieldX(" + (block_name) + ", ", ")")
              } else {
              return self.$wrap("Opal.yieldX(" + (block_name) + ", [", "])")
            };
          };
        };

        def.$find_yielding_scope = function() {
          var $a, $b, $c, self = this, working = nil;

          working = self.$scope();
          while (working !== false && working !== nil) {
          if ((($b = ((($c = working.$block_name()) !== false && $c !== nil) ? $c : working['$def?']())) !== nil && (!$b.$$is_boolean || $b == true))) {
            break;};
          working = working.$parent();};
          return working;
        };

        def['$yields_single_arg?'] = function(children) {
          var $a, self = this;

          return ($a = self['$uses_splat?'](children)['$!'](), $a !== false && $a !== nil ?children.$size()['$=='](1) : $a);
        };

        return (def['$uses_splat?'] = function(children) {
          var $a, $b, TMP_1, self = this;

          return ($a = ($b = children)['$any?'], $a.$$p = (TMP_1 = function(child){var self = TMP_1.$$s || this;
if (child == null) child = nil;
          return child.$type()['$==']("splat")}, TMP_1.$$s = self, TMP_1), $a).call($b);
        }, nil) && 'uses_splat?';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $YieldNode(){};
        var self = $YieldNode = $klass($base, $super, 'YieldNode', $YieldNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("yield");

        return (def.$compile = function() {
          var $a, $b, TMP_2, self = this;

          self.$compile_call(self.$children(), self.level);
          if ((($a = self['$stmt?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("if (", " === $breaker) return $breaker.$v")
            } else {
            return ($a = ($b = self).$with_temp, $a.$$p = (TMP_2 = function(tmp){var self = TMP_2.$$s || this;
if (tmp == null) tmp = nil;
            return self.$wrap("(((" + (tmp) + " = ", ") === $breaker) ? $breaker.$v : " + (tmp) + ")")}, TMP_2.$$s = self, TMP_2), $a).call($b)
          };
        }, nil) && 'compile';
      })(self, $scope.get('BaseYieldNode'));

      (function($base, $super) {
        function $YasgnNode(){};
        var self = $YasgnNode = $klass($base, $super, 'YasgnNode', $YasgnNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("yasgn");

        self.$children("var_name", "yield_args");

        return (def.$compile = function() {
          var $a, self = this;

          self.$compile_call(($a = self).$s.apply($a, [].concat(self.$yield_args()['$[]']($range(1, -1, false)))), "stmt");
          return self.$wrap("if ((" + (self.$var_name()) + " = ", ") === $breaker) return $breaker.$v");
        }, nil) && 'compile';
      })(self, $scope.get('BaseYieldNode'));

      (function($base, $super) {
        function $ReturnableYieldNode(){};
        var self = $ReturnableYieldNode = $klass($base, $super, 'ReturnableYieldNode', $ReturnableYieldNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("returnable_yield");

        return (def.$compile = function() {
          var $a, $b, TMP_3, self = this;

          self.$compile_call(self.$children(), self.level);
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_3 = function(tmp){var self = TMP_3.$$s || this;
if (tmp == null) tmp = nil;
          return self.$wrap("return " + (tmp) + " = ", ", " + (tmp) + " === $breaker ? " + (tmp) + " : " + (tmp))}, TMP_3.$$s = self, TMP_3), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('BaseYieldNode'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/rescue"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$stmt?', '$lhs', '$returns', '$compiler', '$rhs', '$push', '$expr', '$body', '$rescue_val', '$wrap', '$line', '$process', '$body_sexp', '$ensr_sexp', '$wrap_in_closure?', '$begn', '$ensr', '$s', '$recv?', '$expr?', '$indent', '$body_code', '$each_with_index', '$==', '$type', '$[]', '$empty?', '$rescue_exprs', '$rescue_variable', '$[]=', '$rescue_body', '$===', '$include?', '$rescue_variable?', '$last', '$args', '$dup', '$pop']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $RescueModNode(){};
        var self = $RescueModNode = $klass($base, $super, 'RescueModNode', $RescueModNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("rescue_mod");

        self.$children("lhs", "rhs");

        def.$body = function() {
          var $a, self = this;

          if ((($a = self['$stmt?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$lhs()
            } else {
            return self.$compiler().$returns(self.$lhs())
          };
        };

        def.$rescue_val = function() {
          var $a, self = this;

          if ((($a = self['$stmt?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$rhs()
            } else {
            return self.$compiler().$returns(self.$rhs())
          };
        };

        return (def.$compile = function() {
          var $a, self = this;

          self.$push("try {", self.$expr(self.$body()), " } catch ($err) { ", self.$expr(self.$rescue_val()), " }");
          if ((($a = self['$stmt?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return nil
            } else {
            return self.$wrap("(function() {", "})()")
          };
        }, nil) && 'compile';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $EnsureNode(){};
        var self = $EnsureNode = $klass($base, $super, 'EnsureNode', $EnsureNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("ensure");

        self.$children("begn", "ensr");

        def.$compile = function() {
          var $a, self = this;

          self.$push("try {");
          self.$line(self.$compiler().$process(self.$body_sexp(), self.level));
          self.$line("} finally {");
          self.$line(self.$compiler().$process(self.$ensr_sexp(), self.level));
          self.$line("}");
          if ((($a = self['$wrap_in_closure?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(function() {", "; })()")
            } else {
            return nil
          };
        };

        def.$body_sexp = function() {
          var $a, self = this;

          if ((($a = self['$wrap_in_closure?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compiler().$returns(self.$begn())
            } else {
            return self.$begn()
          };
        };

        def.$ensr_sexp = function() {
          var $a, self = this;

          return ((($a = self.$ensr()) !== false && $a !== nil) ? $a : self.$s("nil"));
        };

        return (def['$wrap_in_closure?'] = function() {
          var $a, self = this;

          return ((($a = self['$recv?']()) !== false && $a !== nil) ? $a : self['$expr?']());
        }, nil) && 'wrap_in_closure?';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $RescueNode(){};
        var self = $RescueNode = $klass($base, $super, 'RescueNode', $RescueNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("rescue");

        self.$children("body");

        def.$compile = function() {
          var $a, $b, TMP_1, $c, TMP_2, self = this, handled_else = nil;

          handled_else = false;
          self.$push("try {");
          self.$line(($a = ($b = self).$indent, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this;
            if (self.level == null) self.level = nil;

          return self.$process(self.$body_code(), self.level)}, TMP_1.$$s = self, TMP_1), $a).call($b));
          self.$line("} catch ($err) {");
          ($a = ($c = self.$children()['$[]']($range(1, -1, false))).$each_with_index, $a.$$p = (TMP_2 = function(child, idx){var self = TMP_2.$$s || this, $a, $b, TMP_3;
if (child == null) child = nil;if (idx == null) idx = nil;
          if (child.$type()['$==']("resbody")) {
              } else {
              handled_else = true
            };
            if (idx['$=='](0)) {
              } else {
              self.$push("else ")
            };
            return self.$push(($a = ($b = self).$indent, $a.$$p = (TMP_3 = function(){var self = TMP_3.$$s || this;
              if (self.level == null) self.level = nil;

            return self.$process(child, self.level)}, TMP_3.$$s = self, TMP_3), $a).call($b));}, TMP_2.$$s = self, TMP_2), $a).call($c);
          if (handled_else !== false && handled_else !== nil) {
            } else {
            self.$push("else { throw $err; }")
          };
          self.$line("}");
          if ((($a = self['$expr?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(function() { ", "})()")
            } else {
            return nil
          };
        };

        return (def.$body_code = function() {
          var self = this;

          if (self.$body().$type()['$==']("resbody")) {
            return self.$s("nil")
            } else {
            return self.$body()
          };
        }, nil) && 'body_code';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $ResBodyNode(){};
        var self = $ResBodyNode = $klass($base, $super, 'ResBodyNode', $ResBodyNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("resbody");

        self.$children("args", "body");

        def.$compile = function() {
          var $a, $b, TMP_4, self = this, variable = nil;

          self.$push("if (");
          if ((($a = self.$rescue_exprs()['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$push("true")
            } else {
            self.$push("Opal.rescue($err, [");
            ($a = ($b = self.$rescue_exprs()).$each_with_index, $a.$$p = (TMP_4 = function(rexpr, idx){var self = TMP_4.$$s || this;
if (rexpr == null) rexpr = nil;if (idx == null) idx = nil;
            if (idx['$=='](0)) {
                } else {
                self.$push(", ")
              };
              return self.$push(self.$expr(rexpr));}, TMP_4.$$s = self, TMP_4), $a).call($b);
            self.$push("])");
          };
          self.$push(") {");
          if ((($a = variable = self.$rescue_variable()) !== nil && (!$a.$$is_boolean || $a == true))) {
            variable['$[]='](2, self.$s("js_tmp", "$err"));
            self.$push(self.$expr(variable), ";");};
          self.$line(self.$process(self.$rescue_body(), self.level));
          return self.$line("}");
        };

        def['$rescue_variable?'] = function(variable) {
          var $a, self = this;

          return ($a = $scope.get('Sexp')['$==='](variable), $a !== false && $a !== nil ?["lasgn", "iasgn"]['$include?'](variable.$type()) : $a);
        };

        def.$rescue_variable = function() {
          var $a, self = this;

          if ((($a = self['$rescue_variable?'](self.$args().$last())) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$args().$last().$dup()
            } else {
            return nil
          };
        };

        def.$rescue_exprs = function() {
          var $a, self = this, exprs = nil;

          exprs = self.$args().$dup();
          if ((($a = self['$rescue_variable?'](exprs.$last())) !== nil && (!$a.$$is_boolean || $a == true))) {
            exprs.$pop()};
          return exprs.$children();
        };

        return (def.$rescue_body = function() {
          var $a, self = this;

          return ((($a = self.$body()) !== false && $a !== nil) ? $a : self.$s("nil"));
        }, nil) && 'rescue_body';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/case"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$in_case', '$condition', '$[]=', '$case_stmt', '$add_local', '$push', '$expr', '$each_with_index', '$==', '$type', '$needs_closure?', '$returns', '$compiler', '$stmt', '$case_parts', '$!', '$wrap', '$stmt?', '$[]', '$s', '$js_truthy', '$when_checks', '$process', '$body_code', '$whens', '$body']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $CaseNode(){};
        var self = $CaseNode = $klass($base, $super, 'CaseNode', $CaseNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("case");

        self.$children("condition");

        def.$compile = function() {
          var $a, $b, TMP_1, self = this, handled_else = nil;

          handled_else = false;
          return ($a = ($b = self.$compiler()).$in_case, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, $b, TMP_2, $c;

          if ((($a = self.$condition()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$case_stmt()['$[]=']("cond", true);
              self.$add_local("$case");
              self.$push("$case = ", self.$expr(self.$condition()), ";");};
            ($a = ($b = self.$case_parts()).$each_with_index, $a.$$p = (TMP_2 = function(wen, idx){var self = TMP_2.$$s || this, $a, $b;
if (wen == null) wen = nil;if (idx == null) idx = nil;
            if ((($a = (($b = wen !== false && wen !== nil) ? wen.$type()['$==']("when") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
                if ((($a = self['$needs_closure?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                  self.$compiler().$returns(wen)};
                if (idx['$=='](0)) {
                  } else {
                  self.$push("else ")
                };
                return self.$push(self.$stmt(wen));
              } else if (wen !== false && wen !== nil) {
                handled_else = true;
                if ((($a = self['$needs_closure?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                  wen = self.$compiler().$returns(wen)};
                return self.$push("else {", self.$stmt(wen), "}");
                } else {
                return nil
              }}, TMP_2.$$s = self, TMP_2), $a).call($b);
            if ((($a = ($c = self['$needs_closure?'](), $c !== false && $c !== nil ?handled_else['$!']() : $c)) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$push("else { return nil }")};
            if ((($a = self['$needs_closure?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              return self.$wrap("(function() {", "})()")
              } else {
              return nil
            };}, TMP_1.$$s = self, TMP_1), $a).call($b);
        };

        def['$needs_closure?'] = function() {
          var self = this;

          return self['$stmt?']()['$!']();
        };

        def.$case_parts = function() {
          var self = this;

          return self.$children()['$[]']($range(1, -1, false));
        };

        return (def.$case_stmt = function() {
          var self = this;

          return self.$compiler().$case_stmt();
        }, nil) && 'case_stmt';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $WhenNode(){};
        var self = $WhenNode = $klass($base, $super, 'WhenNode', $WhenNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.level = nil;
        self.$handle("when");

        self.$children("whens", "body");

        def.$compile = function() {
          var $a, $b, TMP_3, self = this;

          self.$push("if (");
          ($a = ($b = self.$when_checks()).$each_with_index, $a.$$p = (TMP_3 = function(check, idx){var self = TMP_3.$$s || this, $a, call = nil;
if (check == null) check = nil;if (idx == null) idx = nil;
          if (idx['$=='](0)) {
              } else {
              self.$push(" || ")
            };
            if (check.$type()['$==']("splat")) {
              self.$push("(function($splt) { for (var i = 0; i < $splt.length; i++) {");
              self.$push("if ($splt[i]['$===']($case)) { return true; }");
              return self.$push("} return false; })(", self.$expr(check['$[]'](1)), ")");
            } else if ((($a = self.$case_stmt()['$[]']("cond")) !== nil && (!$a.$$is_boolean || $a == true))) {
              call = self.$s("call", check, "===", self.$s("arglist", self.$s("js_tmp", "$case")));
              return self.$push(self.$expr(call));
              } else {
              return self.$push(self.$js_truthy(check))
            };}, TMP_3.$$s = self, TMP_3), $a).call($b);
          return self.$push(") {", self.$process(self.$body_code(), self.level), "}");
        };

        def.$when_checks = function() {
          var self = this;

          return self.$whens().$children();
        };

        def.$case_stmt = function() {
          var self = this;

          return self.$compiler().$case_stmt();
        };

        return (def.$body_code = function() {
          var $a, self = this;

          return ((($a = self.$body()) !== false && $a !== nil) ? $a : self.$s("nil"));
        }, nil) && 'body_code';
      })(self, $scope.get('Base'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/super"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$children', '$arglist', '$iter', '$expr', '$iter_sexp', '$uses_block!', '$scope', '$def?', '$identify!', '$name', '$parent', '$defs', '$push', '$to_s', '$mid', '$iter?', '$get_super_chain', '$join', '$map', '$raise', '$s', '$handle', '$compile_dispatcher', '$wrap', '$has_splat?', '$args', '$fragment', '$uses_zuper=', '$any?', '$==', '$type']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $BaseSuperNode(){};
        var self = $BaseSuperNode = $klass($base, $super, 'BaseSuperNode', $BaseSuperNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$children("arglist", "iter");

        def.$compile_dispatcher = function() {
          var $a, $b, TMP_1, self = this, iter = nil, scope_name = nil, class_name = nil, chain = nil, cur_defn = nil, mid = nil, trys = nil;

          if ((($a = ((($b = self.$arglist()) !== false && $b !== nil) ? $b : self.$iter())) !== nil && (!$a.$$is_boolean || $a == true))) {
            iter = self.$expr(self.$iter_sexp())
            } else {
            self.$scope()['$uses_block!']();
            iter = "$iter";
          };
          if ((($a = self.$scope()['$def?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$scope()['$uses_block!']();
            scope_name = self.$scope()['$identify!']();
            class_name = (function() {if ((($a = self.$scope().$parent().$name()) !== nil && (!$a.$$is_boolean || $a == true))) {
              return "$" + (self.$scope().$parent().$name())
              } else {
              return "self.$$class.$$proto"
            }; return nil; })();
            if ((($a = self.$scope().$defs()) !== nil && (!$a.$$is_boolean || $a == true))) {
              self.$push("Opal.find_super_dispatcher(self, '" + (self.$scope().$mid().$to_s()) + "', " + (scope_name) + ", ");
              self.$push(iter);
              return self.$push(", " + (class_name) + ")");
              } else {
              self.$push("Opal.find_super_dispatcher(self, '" + (self.$scope().$mid().$to_s()) + "', " + (scope_name) + ", ");
              self.$push(iter);
              return self.$push(")");
            };
          } else if ((($a = self.$scope()['$iter?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            $a = Opal.to_ary(self.$scope().$get_super_chain()), chain = ($a[0] == null ? nil : $a[0]), cur_defn = ($a[1] == null ? nil : $a[1]), mid = ($a[2] == null ? nil : $a[2]);
            trys = ($a = ($b = chain).$map, $a.$$p = (TMP_1 = function(c){var self = TMP_1.$$s || this;
if (c == null) c = nil;
            return "" + (c) + ".$$def"}, TMP_1.$$s = self, TMP_1), $a).call($b).$join(" || ");
            return self.$push("Opal.find_iter_super_dispatcher(self, " + (mid) + ", (" + (trys) + " || " + (cur_defn) + "), null)");
            } else {
            return self.$raise("Cannot call super() from outside a method block")
          };
        };

        def.$args = function() {
          var $a, self = this;

          return ((($a = self.$arglist()) !== false && $a !== nil) ? $a : self.$s("arglist"));
        };

        return (def.$iter_sexp = function() {
          var $a, self = this;

          return ((($a = self.$iter()) !== false && $a !== nil) ? $a : self.$s("js_tmp", "null"));
        }, nil) && 'iter_sexp';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $DefinedSuperNode(){};
        var self = $DefinedSuperNode = $klass($base, $super, 'DefinedSuperNode', $DefinedSuperNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("defined_super");

        return (def.$compile = function() {
          var self = this;

          self.$compile_dispatcher();
          return self.$wrap("((", ") != null ? \"super\" : nil)");
        }, nil) && 'compile';
      })(self, $scope.get('BaseSuperNode'));

      (function($base, $super) {
        function $SuperNode(){};
        var self = $SuperNode = $klass($base, $super, 'SuperNode', $SuperNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("super");

        self.$children("arglist", "iter");

        def.$compile = function() {
          var $a, $b, self = this, splat = nil, args = nil;

          if ((($a = ((($b = self.$arglist()) !== false && $b !== nil) ? $b : self.$iter())) !== nil && (!$a.$$is_boolean || $a == true))) {
            splat = self['$has_splat?']();
            args = self.$expr(self.$args());
            if (splat !== false && splat !== nil) {
              } else {
              args = [self.$fragment("["), args, self.$fragment("]")]
            };
          } else if ((($a = self.$scope()['$def?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            (($a = [true]), $b = self.$scope(), $b['$uses_zuper='].apply($b, $a), $a[$a.length-1]);
            args = self.$fragment("$zuper");
            } else {
            args = self.$fragment("$slice.call(arguments)")
          };
          self.$compile_dispatcher();
          self.$push(".apply(self, ");
          ($a = self).$push.apply($a, [].concat(args));
          return self.$push(")");
        };

        return (def['$has_splat?'] = function() {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = self.$args().$children())['$any?'], $a.$$p = (TMP_2 = function(child){var self = TMP_2.$$s || this;
if (child == null) child = nil;
          return child.$type()['$==']("splat")}, TMP_2.$$s = self, TMP_2), $a).call($b);
        }, nil) && 'has_splat?';
      })(self, $scope.get('BaseSuperNode'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/version"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module;

  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    Opal.cdecl($scope, 'VERSION', "0.7.0.beta3")
    
  })(self)
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/top"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$push', '$version_comment', '$opening', '$in_scope', '$line', '$inspect', '$to_s', '$dynamic_require_severity', '$compiler', '$stmt', '$stmts', '$is_a?', '$add_temp', '$add_used_helpers', '$add_used_operators', '$to_vars', '$scope', '$compile_method_stubs', '$compile_irb_vars', '$compile_end_construct', '$closing', '$requirable?', '$cleanpath', '$Pathname', '$file', '$returns', '$body', '$irb?', '$to_a', '$helpers', '$each', '$operator_helpers', '$[]', '$method_missing?', '$method_calls', '$join', '$map', '$empty?', '$eof_content']);
  self.$require("pathname");
  self.$require("opal/version");
  self.$require("opal/nodes/scope");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $TopNode(){};
        var self = $TopNode = $klass($base, $super, 'TopNode', $TopNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("top");

        self.$children("body");

        def.$compile = function() {
          var $a, $b, TMP_1, self = this;

          self.$push(self.$version_comment());
          self.$opening();
          ($a = ($b = self).$in_scope, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, body_code = nil;

          self.$line("Opal.dynamic_require_severity = " + (self.$compiler().$dynamic_require_severity().$to_s().$inspect()) + ";");
            body_code = self.$stmt(self.$stmts());
            if ((($a = body_code['$is_a?']($scope.get('Array'))) !== nil && (!$a.$$is_boolean || $a == true))) {
              } else {
              body_code = [body_code]
            };
            self.$add_temp("self = Opal.top");
            self.$add_temp("$scope = Opal");
            self.$add_temp("nil = Opal.nil");
            self.$add_used_helpers();
            self.$add_used_operators();
            self.$line(self.$scope().$to_vars());
            self.$compile_method_stubs();
            self.$compile_irb_vars();
            self.$compile_end_construct();
            return self.$line(body_code);}, TMP_1.$$s = self, TMP_1), $a).call($b);
          return self.$closing();
        };

        def.$opening = function() {
          var $a, self = this, path = nil;

          if ((($a = self.$compiler()['$requirable?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            path = self.$Pathname(self.$compiler().$file()).$cleanpath().$to_s();
            return self.$line("Opal.modules[" + (path.$inspect()) + "] = function(Opal) {");
            } else {
            return self.$line("(function(Opal) {")
          };
        };

        def.$closing = function() {
          var $a, self = this;

          if ((($a = self.$compiler()['$requirable?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$line("};\n")
            } else {
            return self.$line("})(Opal);\n")
          };
        };

        def.$stmts = function() {
          var self = this;

          return self.$compiler().$returns(self.$body());
        };

        def.$compile_irb_vars = function() {
          var $a, self = this;

          if ((($a = self.$compiler()['$irb?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$line("if (!Opal.irb_vars) { Opal.irb_vars = {}; }")
            } else {
            return nil
          };
        };

        def.$add_used_helpers = function() {
          var $a, $b, TMP_2, self = this, helpers = nil;

          helpers = self.$compiler().$helpers().$to_a();
          return ($a = ($b = helpers.$to_a()).$each, $a.$$p = (TMP_2 = function(h){var self = TMP_2.$$s || this;
if (h == null) h = nil;
          return self.$add_temp("$" + (h) + " = Opal." + (h))}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };

        def.$add_used_operators = function() {
          var $a, $b, TMP_3, self = this, operators = nil;

          operators = self.$compiler().$operator_helpers().$to_a();
          return ($a = ($b = operators).$each, $a.$$p = (TMP_3 = function(op){var self = TMP_3.$$s || this, name = nil;
if (op == null) op = nil;
          name = (((($scope.get('Nodes')).$$scope.get('CallNode'))).$$scope.get('OPERATORS'))['$[]'](op);
            self.$line("function $rb_" + (name) + "(lhs, rhs) {");
            self.$line("  return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs " + (op) + " rhs : lhs['$" + (op) + "'](rhs);");
            return self.$line("}");}, TMP_3.$$s = self, TMP_3), $a).call($b);
        };

        def.$compile_method_stubs = function() {
          var $a, $b, TMP_4, self = this, calls = nil, stubs = nil;

          if ((($a = self.$compiler()['$method_missing?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            calls = self.$compiler().$method_calls();
            stubs = ($a = ($b = calls.$to_a()).$map, $a.$$p = (TMP_4 = function(k){var self = TMP_4.$$s || this;
if (k == null) k = nil;
            return "'$" + (k) + "'"}, TMP_4.$$s = self, TMP_4), $a).call($b).$join(", ");
            if ((($a = stubs['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              return nil
              } else {
              return self.$line("Opal.add_stubs([" + (stubs) + "]);")
            };
            } else {
            return nil
          };
        };

        def.$compile_end_construct = function() {
          var $a, self = this, content = nil;

          if ((($a = content = self.$compiler().$eof_content()) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$line("var $__END__ = Opal.Object.$new();");
            return self.$line("$__END__.$read = function() { return " + (content.$inspect()) + "; };");
            } else {
            return nil
          };
        };

        return (def.$version_comment = function() {
          var self = this;

          return "/* Generated by Opal " + ((($scope.get('Opal')).$$scope.get('VERSION'))) + " */";
        }, nil) && 'version_comment';
      })(self, $scope.get('ScopeNode'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/while"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$with_temp', '$js_truthy', '$test', '$in_while', '$wrap_in_closure?', '$[]=', '$while_loop', '$stmt', '$body', '$uses_redo?', '$push', '$while_open', '$while_close', '$line', '$compiler', '$wrap', '$[]', '$expr?', '$recv?']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $WhileNode(){};
        var self = $WhileNode = $klass($base, $super, 'WhileNode', $WhileNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("while");

        self.$children("test", "body");

        def.$compile = function() {
          var $a, $b, TMP_1, self = this;

          ($a = ($b = self).$with_temp, $a.$$p = (TMP_1 = function(redo_var){var self = TMP_1.$$s || this, $a, $b, TMP_2, test_code = nil;
if (redo_var == null) redo_var = nil;
          test_code = self.$js_truthy(self.$test());
            return ($a = ($b = self.$compiler()).$in_while, $a.$$p = (TMP_2 = function(){var self = TMP_2.$$s || this, $a, body_code = nil;

            if ((($a = self['$wrap_in_closure?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                self.$while_loop()['$[]=']("closure", true)};
              self.$while_loop()['$[]=']("redo_var", redo_var);
              body_code = self.$stmt(self.$body());
              if ((($a = self['$uses_redo?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                self.$push("" + (redo_var) + " = false; " + (self.$while_open()) + (redo_var) + " || ");
                self.$push(test_code);
                self.$push(self.$while_close());
                } else {
                self.$push(self.$while_open(), test_code, self.$while_close())
              };
              if ((($a = self['$uses_redo?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                self.$push("" + (redo_var) + " = false;")};
              return self.$line(body_code, "}");}, TMP_2.$$s = self, TMP_2), $a).call($b);}, TMP_1.$$s = self, TMP_1), $a).call($b);
          if ((($a = self['$wrap_in_closure?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$wrap("(function() {", "; return nil; })()")
            } else {
            return nil
          };
        };

        def.$while_open = function() {
          var self = this;

          return "while (";
        };

        def.$while_close = function() {
          var self = this;

          return ") {";
        };

        def['$uses_redo?'] = function() {
          var self = this;

          return self.$while_loop()['$[]']("use_redo");
        };

        return (def['$wrap_in_closure?'] = function() {
          var $a, self = this;

          return ((($a = self['$expr?']()) !== false && $a !== nil) ? $a : self['$recv?']());
        }, nil) && 'wrap_in_closure?';
      })(self, $scope.get('Base'));

      (function($base, $super) {
        function $UntilNode(){};
        var self = $UntilNode = $klass($base, $super, 'UntilNode', $UntilNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("until");

        def.$while_open = function() {
          var self = this;

          return "while (!(";
        };

        return (def.$while_close = function() {
          var self = this;

          return ")) {";
        }, nil) && 'while_close';
      })(self, $scope.get('WhileNode'));
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/for"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$with_temp', '$==', '$type', '$args_sexp', '$s', '$<<', '$body_sexp', '$first', '$insert', '$value', '$push', '$expr']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ForNode(){};
        var self = $ForNode = $klass($base, $super, 'ForNode', $ForNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("for");

        self.$children("value", "args_sexp", "body_sexp");

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_1 = function(loop_var){var self = TMP_1.$$s || this, $a, assign = nil, iter = nil, sexp = nil;
if (loop_var == null) loop_var = nil;
          if (self.$args_sexp().$type()['$==']("array")) {
              assign = self.$s("masgn", self.$args_sexp());
              assign['$<<'](self.$s("to_ary", self.$s("js_tmp", loop_var)));
              } else {
              assign = self.$args_sexp()['$<<'](self.$s("js_tmp", loop_var))
            };
            if ((($a = self.$body_sexp()) !== nil && (!$a.$$is_boolean || $a == true))) {
              if (self.$body_sexp().$first()['$==']("block")) {
                self.$body_sexp().$insert(1, assign);
                assign = self.$body_sexp();
                } else {
                assign = self.$s("block", assign, self.$body_sexp())
              }};
            iter = self.$s("iter", self.$s("lasgn", loop_var), assign);
            sexp = self.$s("call", self.$value(), "each", self.$s("arglist"), iter);
            return self.$push(self.$expr(sexp));}, TMP_1.$$s = self, TMP_1), $a).call($b);
        }, nil) && 'compile';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/hash"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $hash2 = Opal.hash2;

  Opal.add_stubs(['$require', '$handle', '$each_with_index', '$even?', '$<<', '$children', '$all?', '$include?', '$type', '$keys_and_values', '$simple_keys?', '$compile_hash2', '$compile_hash', '$helper', '$==', '$push', '$expr', '$wrap', '$times', '$inspect', '$to_s', '$[]', '$[]=', '$size', '$join']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $HashNode(){};
        var self = $HashNode = $klass($base, $super, 'HashNode', $HashNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("hash");

        def.$keys_and_values = function() {
          var $a, $b, TMP_1, self = this, keys = nil, values = nil;

          $a = [[], []], keys = $a[0], values = $a[1];
          ($a = ($b = self.$children()).$each_with_index, $a.$$p = (TMP_1 = function(obj, idx){var self = TMP_1.$$s || this, $a;
if (obj == null) obj = nil;if (idx == null) idx = nil;
          if ((($a = idx['$even?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              return keys['$<<'](obj)
              } else {
              return values['$<<'](obj)
            }}, TMP_1.$$s = self, TMP_1), $a).call($b);
          return [keys, values];
        };

        def['$simple_keys?'] = function(keys) {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = keys)['$all?'], $a.$$p = (TMP_2 = function(key){var self = TMP_2.$$s || this;
if (key == null) key = nil;
          return ["sym", "str"]['$include?'](key.$type())}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };

        def.$compile = function() {
          var $a, self = this, keys = nil, values = nil;

          $a = Opal.to_ary(self.$keys_and_values()), keys = ($a[0] == null ? nil : $a[0]), values = ($a[1] == null ? nil : $a[1]);
          if ((($a = self['$simple_keys?'](keys)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$compile_hash2(keys, values)
            } else {
            return self.$compile_hash()
          };
        };

        def.$compile_hash = function() {
          var $a, $b, TMP_3, self = this;

          self.$helper("hash");
          ($a = ($b = self.$children()).$each_with_index, $a.$$p = (TMP_3 = function(child, idx){var self = TMP_3.$$s || this;
if (child == null) child = nil;if (idx == null) idx = nil;
          if (idx['$=='](0)) {
              } else {
              self.$push(", ")
            };
            return self.$push(self.$expr(child));}, TMP_3.$$s = self, TMP_3), $a).call($b);
          return self.$wrap("$hash(", ")");
        };

        return (def.$compile_hash2 = function(keys, values) {
          var $a, $b, TMP_4, $c, TMP_5, self = this, hash_obj = nil, hash_keys = nil;

          $a = [$hash2([], {}), []], hash_obj = $a[0], hash_keys = $a[1];
          self.$helper("hash2");
          ($a = ($b = keys.$size()).$times, $a.$$p = (TMP_4 = function(idx){var self = TMP_4.$$s || this, $a, key = nil;
if (idx == null) idx = nil;
          key = keys['$[]'](idx)['$[]'](1).$to_s().$inspect();
            if ((($a = hash_obj['$include?'](key)) !== nil && (!$a.$$is_boolean || $a == true))) {
              } else {
              hash_keys['$<<'](key)
            };
            return hash_obj['$[]='](key, self.$expr(values['$[]'](idx)));}, TMP_4.$$s = self, TMP_4), $a).call($b);
          ($a = ($c = hash_keys).$each_with_index, $a.$$p = (TMP_5 = function(key, idx){var self = TMP_5.$$s || this;
if (key == null) key = nil;if (idx == null) idx = nil;
          if (idx['$=='](0)) {
              } else {
              self.$push(", ")
            };
            self.$push("" + (key) + ": ");
            return self.$push(hash_obj['$[]'](key));}, TMP_5.$$s = self, TMP_5), $a).call($c);
          return self.$wrap("$hash2([" + (hash_keys.$join(", ")) + "], {", "})");
        }, nil) && 'compile_hash2';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/array"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$empty?', '$children', '$push', '$each', '$==', '$type', '$expr', '$<<', '$fragment']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ArrayNode(){};
        var self = $ArrayNode = $klass($base, $super, 'ArrayNode', $ArrayNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("array");

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this, code = nil, work = nil, join = nil;

          if ((($a = self.$children()['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("[]")};
          $a = [[], []], code = $a[0], work = $a[1];
          ($a = ($b = self.$children()).$each, $a.$$p = (TMP_1 = function(child){var self = TMP_1.$$s || this, $a, splat = nil, part = nil;
if (child == null) child = nil;
          splat = child.$type()['$==']("splat");
            part = self.$expr(child);
            if (splat !== false && splat !== nil) {
              if ((($a = work['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                if ((($a = code['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                  code['$<<'](self.$fragment("[].concat("))['$<<'](part)['$<<'](self.$fragment(")"))
                  } else {
                  code['$<<'](self.$fragment(".concat("))['$<<'](part)['$<<'](self.$fragment(")"))
                }
                } else {
                if ((($a = code['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                  code['$<<'](self.$fragment("["))['$<<'](work)['$<<'](self.$fragment("]"))
                  } else {
                  code['$<<'](self.$fragment(".concat(["))['$<<'](work)['$<<'](self.$fragment("])"))
                };
                code['$<<'](self.$fragment(".concat("))['$<<'](part)['$<<'](self.$fragment(")"));
              };
              return work = [];
              } else {
              if ((($a = work['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                } else {
                work['$<<'](self.$fragment(", "))
              };
              return work['$<<'](part);
            };}, TMP_1.$$s = self, TMP_1), $a).call($b);
          if ((($a = work['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            join = [self.$fragment("["), work, self.$fragment("]")];
            if ((($a = code['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              code = join
              } else {
              code.$push([self.$fragment(".concat("), join, self.$fragment(")")])
            };
          };
          return self.$push(code);
        }, nil) && 'compile';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/defined"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $range = Opal.range;

  Opal.add_stubs(['$require', '$handle', '$children', '$type', '$value', '$===', '$push', '$inspect', '$to_s', '$expr', '$s', '$[]', '$respond_to?', '$__send__', '$mid_to_jsid', '$with_temp', '$handle_block_given_call', '$compiler', '$wrap', '$include?']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $DefinedNode(){};
        var self = $DefinedNode = $klass($base, $super, 'DefinedNode', $DefinedNode);

        var def = self.$$proto, $scope = self.$$scope;

        def.sexp = nil;
        self.$handle("defined");

        self.$children("value");

        def.$compile = function() {
          var $a, self = this, type = nil, $case = nil;

          type = self.$value().$type();
          return (function() {$case = type;if ("self"['$===']($case) || "nil"['$===']($case) || "false"['$===']($case) || "true"['$===']($case)) {return self.$push(type.$to_s().$inspect())}else if ("lasgn"['$===']($case) || "iasgn"['$===']($case) || "gasgn"['$===']($case) || "cvdecl"['$===']($case) || "masgn"['$===']($case) || "op_asgn_or"['$===']($case) || "op_asgn_and"['$===']($case)) {return self.$push("'assignment'")}else if ("paren"['$===']($case) || "not"['$===']($case)) {return self.$push(self.$expr(self.$s("defined", self.$value()['$[]'](1))))}else if ("lvar"['$===']($case)) {return self.$push("'local-variable'")}else {if ((($a = self['$respond_to?']("compile_" + (type))) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$__send__("compile_" + (type))
            } else {
            return self.$push("'expression'")
          }}})();
        };

        def.$compile_call = function() {
          var $a, $b, TMP_1, self = this, mid = nil, recv = nil;

          mid = self.$mid_to_jsid(self.$value()['$[]'](2).$to_s());
          recv = (function() {if ((($a = self.$value()['$[]'](1)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$expr(self.$value()['$[]'](1))
            } else {
            return "self"
          }; return nil; })();
          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_1 = function(tmp){var self = TMP_1.$$s || this;
if (tmp == null) tmp = nil;
          self.$push("(((" + (tmp) + " = ", recv, "" + (mid) + ") && !" + (tmp) + ".$$stub) || ", recv);
            return self.$push("['$respond_to_missing?']('" + (self.$value()['$[]'](2).$to_s()) + "') ? 'method' : nil)");}, TMP_1.$$s = self, TMP_1), $a).call($b);
        };

        def.$compile_ivar = function() {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_2 = function(tmp){var self = TMP_2.$$s || this, name = nil;
if (tmp == null) tmp = nil;
          name = self.$value()['$[]'](1).$to_s()['$[]']($range(1, -1, false));
            self.$push("((" + (tmp) + " = self['" + (name) + "'], " + (tmp) + " != null && " + (tmp) + " !== nil) ? ");
            return self.$push("'instance-variable' : nil)");}, TMP_2.$$s = self, TMP_2), $a).call($b);
        };

        def.$compile_super = function() {
          var self = this;

          return self.$push(self.$expr(self.$s("defined_super", self.$value())));
        };

        def.$compile_yield = function() {
          var self = this;

          self.$push(self.$compiler().$handle_block_given_call(self.sexp));
          return self.$wrap("((", ") != null ? \"yield\" : nil)");
        };

        def.$compile_xstr = function() {
          var self = this;

          self.$push(self.$expr(self.$value()));
          return self.$wrap("(typeof(", ") !== \"undefined\")");
        };

        Opal.defn(self, '$compile_dxstr', def.$compile_xstr);

        def.$compile_const = function() {
          var self = this;

          return self.$push("($scope." + (self.$value()['$[]'](1)) + " != null)");
        };

        def.$compile_colon2 = function() {
          var self = this;

          self.$push("(function(){ try { return ((");
          self.$push(self.$expr(self.$value()));
          self.$push(") != null ? 'constant' : nil); } catch (err) { if (err.$$class");
          return self.$push(" === Opal.NameError) { return nil; } else { throw(err); }}; })()");
        };

        def.$compile_colon3 = function() {
          var self = this;

          return self.$push("(Opal.Object.$$scope." + (self.$value()['$[]'](1)) + " == null ? nil : 'constant')");
        };

        def.$compile_cvar = function() {
          var self = this;

          return self.$push("(Opal.cvars['" + (self.$value()['$[]'](1)) + "'] != null ? 'class variable' : nil)");
        };

        def.$compile_gvar = function() {
          var $a, $b, TMP_3, self = this, name = nil;

          name = self.$value()['$[]'](1).$to_s()['$[]']($range(1, -1, false));
          if ((($a = ["~", "!"]['$include?'](name)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return self.$push("'global-variable'")
          } else if ((($a = ["`", "'", "+", "&"]['$include?'](name)) !== nil && (!$a.$$is_boolean || $a == true))) {
            return ($a = ($b = self).$with_temp, $a.$$p = (TMP_3 = function(tmp){var self = TMP_3.$$s || this;
if (tmp == null) tmp = nil;
            self.$push("((" + (tmp) + " = $gvars['~'], " + (tmp) + " != null && " + (tmp) + " !== nil) ? ");
              return self.$push("'global-variable' : nil)");}, TMP_3.$$s = self, TMP_3), $a).call($b)
            } else {
            return self.$push("($gvars[" + (name.$inspect()) + "] != null ? 'global-variable' : nil)")
          };
        };

        return (def.$compile_nth_ref = function() {
          var $a, $b, TMP_4, self = this;

          return ($a = ($b = self).$with_temp, $a.$$p = (TMP_4 = function(tmp){var self = TMP_4.$$s || this;
if (tmp == null) tmp = nil;
          self.$push("((" + (tmp) + " = $gvars['~'], " + (tmp) + " != null && " + (tmp) + " != nil) ? ");
            return self.$push("'global-variable' : nil)");}, TMP_4.$$s = self, TMP_4), $a).call($b);
        }, nil) && 'compile_nth_ref';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/masgn"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$children', '$new_temp', '$scope', '$==', '$type', '$rhs', '$-', '$size', '$push', '$expr', '$[]', '$raise', '$each_with_index', '$dup', '$<<', '$s', '$>=', '$[]=', '$to_sym', '$last', '$lhs', '$queue_temp']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $MassAssignNode(){};
        var self = $MassAssignNode = $klass($base, $super, 'MassAssignNode', $MassAssignNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("masgn");

        self.$children("lhs", "rhs");

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this, tmp = nil, len = nil;

          tmp = self.$scope().$new_temp();
          len = 0;
          if (self.$rhs().$type()['$==']("array")) {
            len = self.$rhs().$size()['$-'](1);
            self.$push("" + (tmp) + " = ", self.$expr(self.$rhs()));
          } else if (self.$rhs().$type()['$==']("to_ary")) {
            self.$push("" + (tmp) + " = Opal.to_ary(", self.$expr(self.$rhs()['$[]'](1)), ")")
          } else if (self.$rhs().$type()['$==']("splat")) {
            self.$push("(" + (tmp) + " = ", self.$expr(self.$rhs()['$[]'](1)), ")['$to_a'] && !" + (tmp) + "['$to_a'].$$stub ? (" + (tmp) + " = " + (tmp) + "['$to_a']())");
            self.$push(" : (" + (tmp) + ").$$is_array ? " + (tmp) + " : (" + (tmp) + " = [" + (tmp) + "])");
            } else {
            self.$raise("unsupported mlhs type")
          };
          ($a = ($b = self.$lhs().$children()).$each_with_index, $a.$$p = (TMP_1 = function(child, idx){var self = TMP_1.$$s || this, $a, $b, $c, $d, part = nil, assign = nil;
if (child == null) child = nil;if (idx == null) idx = nil;
          self.$push(", ");
            if (child.$type()['$==']("splat")) {
              if ((($a = part = child['$[]'](1)) !== nil && (!$a.$$is_boolean || $a == true))) {
                part = part.$dup();
                part['$<<'](self.$s("js_tmp", "$slice.call(" + (tmp) + ", " + (idx) + ")"));
                return self.$push(self.$expr(part));
                } else {
                return nil
              }
              } else {
              if (idx['$>='](len)) {
                assign = self.$s("js_tmp", "(" + (tmp) + "[" + (idx) + "] == null ? nil : " + (tmp) + "[" + (idx) + "])")
                } else {
                assign = self.$s("js_tmp", "" + (tmp) + "[" + (idx) + "]")
              };
              part = child.$dup();
              if ((($a = ((($b = ((($c = ((($d = child.$type()['$==']("lasgn")) !== false && $d !== nil) ? $d : child.$type()['$==']("iasgn"))) !== false && $c !== nil) ? $c : child.$type()['$==']("lvar"))) !== false && $b !== nil) ? $b : child.$type()['$==']("gasgn"))) !== nil && (!$a.$$is_boolean || $a == true))) {
                part['$<<'](assign)
              } else if (child.$type()['$==']("call")) {
                part['$[]='](2, ((("") + (part['$[]'](2))) + "=").$to_sym());
                part.$last()['$<<'](assign);
              } else if (child.$type()['$==']("attrasgn")) {
                part.$last()['$<<'](assign)
                } else {
                self.$raise("Bad lhs for masgn")
              };
              return self.$push(self.$expr(part));
            };}, TMP_1.$$s = self, TMP_1), $a).call($b);
          return self.$scope().$queue_temp(tmp);
        }, nil) && 'compile';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes/arglist"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$handle', '$each', '$==', '$first', '$expr', '$empty?', '$<<', '$fragment', '$+', '$children', '$push']);
  self.$require("opal/nodes/base");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'Nodes');

      var def = self.$$proto, $scope = self.$$scope;

      (function($base, $super) {
        function $ArglistNode(){};
        var self = $ArglistNode = $klass($base, $super, 'ArglistNode', $ArglistNode);

        var def = self.$$proto, $scope = self.$$scope;

        self.$handle("arglist");

        return (def.$compile = function() {
          var $a, $b, TMP_1, self = this, code = nil, work = nil, join = nil;

          $a = [[], []], code = $a[0], work = $a[1];
          ($a = ($b = self.$children()).$each, $a.$$p = (TMP_1 = function(current){var self = TMP_1.$$s || this, $a, splat = nil, arg = nil;
if (current == null) current = nil;
          splat = current.$first()['$==']("splat");
            arg = self.$expr(current);
            if (splat !== false && splat !== nil) {
              if ((($a = work['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                if ((($a = code['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                  code['$<<'](self.$fragment("[].concat("));
                  code['$<<'](arg);
                  code['$<<'](self.$fragment(")"));
                  } else {
                  code = code['$+'](".concat(" + (arg) + ")")
                }
                } else {
                if ((($a = code['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                  code['$<<']([self.$fragment("["), work, self.$fragment("]")])
                  } else {
                  code['$<<']([self.$fragment(".concat(["), work, self.$fragment("])")])
                };
                code['$<<']([self.$fragment(".concat("), arg, self.$fragment(")")]);
              };
              return work = [];
              } else {
              if ((($a = work['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
                } else {
                work['$<<'](self.$fragment(", "))
              };
              return work['$<<'](arg);
            };}, TMP_1.$$s = self, TMP_1), $a).call($b);
          if ((($a = work['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
            } else {
            join = work;
            if ((($a = code['$empty?']()) !== nil && (!$a.$$is_boolean || $a == true))) {
              code = join
              } else {
              code['$<<'](self.$fragment(".concat("))['$<<'](join)['$<<'](self.$fragment(")"))
            };
          };
          return ($a = self).$push.apply($a, [].concat(code));
        }, nil) && 'compile';
      })(self, $scope.get('Base'))
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/nodes"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice;

  Opal.add_stubs(['$require']);
  self.$require("opal/nodes/base");
  self.$require("opal/nodes/literal");
  self.$require("opal/nodes/variables");
  self.$require("opal/nodes/constants");
  self.$require("opal/nodes/call");
  self.$require("opal/nodes/call_special");
  self.$require("opal/nodes/module");
  self.$require("opal/nodes/class");
  self.$require("opal/nodes/singleton_class");
  self.$require("opal/nodes/iter");
  self.$require("opal/nodes/def");
  self.$require("opal/nodes/if");
  self.$require("opal/nodes/logic");
  self.$require("opal/nodes/definitions");
  self.$require("opal/nodes/yield");
  self.$require("opal/nodes/rescue");
  self.$require("opal/nodes/case");
  self.$require("opal/nodes/super");
  self.$require("opal/nodes/top");
  self.$require("opal/nodes/while");
  self.$require("opal/nodes/for");
  self.$require("opal/nodes/hash");
  self.$require("opal/nodes/array");
  self.$require("opal/nodes/defined");
  self.$require("opal/nodes/masgn");
  return self.$require("opal/nodes/arglist");
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/compiler"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $hash2 = Opal.hash2, $klass = Opal.klass;

  Opal.add_stubs(['$require', '$compile', '$new', '$[]', '$define_method', '$fetch', '$!', '$include?', '$raise', '$compiler_option', '$attr_reader', '$attr_accessor', '$s', '$parse', '$file', '$eof_content', '$lexer', '$flatten', '$process', '$join', '$map', '$to_proc', '$warn', '$+', '$<<', '$helpers', '$new_temp', '$queue_temp', '$push_while', '$pop_while', '$in_while?', '$==', '$fragment', '$handlers', '$type', '$compile_to_fragments', '$returns', '$===', '$[]=', '$>', '$length', '$=~', '$tap', '$source=', '$source', '$uses_block!', '$block_name', '$find_parent_def']);
  self.$require("set");
  self.$require("opal/parser");
  self.$require("opal/fragment");
  self.$require("opal/nodes");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    Opal.defs(self, '$compile', function(source, options) {
      var self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      return $scope.get('Compiler').$new(source, options).$compile();
    });

    (function($base, $super) {
      function $Compiler(){};
      var self = $Compiler = $klass($base, $super, 'Compiler', $Compiler);

      var def = self.$$proto, $scope = self.$$scope, TMP_3, TMP_4, TMP_5, TMP_6;

      def.parser = def.source = def.sexp = def.fragments = def.helpers = def.operator_helpers = def.method_calls = def.indent = def.unique = def.scope = def.case_stmt = def.handlers = def.requires = def.required_trees = nil;
      Opal.cdecl($scope, 'INDENT', "  ");

      Opal.cdecl($scope, 'COMPARE', ["<", ">", "<=", ">="]);

      Opal.defs(self, '$compiler_option', function(name, default_value, options) {
        var $a, $b, TMP_1, $c, self = this, mid = nil, valid_values = nil;

        if (options == null) {
          options = $hash2([], {})
        }
        mid = options['$[]']("as");
        valid_values = options['$[]']("valid_values");
        return ($a = ($b = self).$define_method, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, $b, TMP_2, $c, value = nil;
          if (self.options == null) self.options = nil;

        value = ($a = ($b = self.options).$fetch, $a.$$p = (TMP_2 = function(){var self = TMP_2.$$s || this;

          return default_value}, TMP_2.$$s = self, TMP_2), $a).call($b, name);
          if ((($a = (($c = valid_values !== false && valid_values !== nil) ? (valid_values['$include?'](value))['$!']() : $c)) !== nil && (!$a.$$is_boolean || $a == true))) {
            self.$raise($scope.get('ArgumentError'))};
          return value;}, TMP_1.$$s = self, TMP_1), $a).call($b, ((($c = mid) !== false && $c !== nil) ? $c : name));
      });

      self.$compiler_option("file", "(file)");

      self.$compiler_option("method_missing", true, $hash2(["as"], {"as": "method_missing?"}));

      self.$compiler_option("arity_check", false, $hash2(["as"], {"as": "arity_check?"}));

      self.$compiler_option("irb", false, $hash2(["as"], {"as": "irb?"}));

      self.$compiler_option("dynamic_require_severity", "error", $hash2(["valid_values"], {"valid_values": ["error", "warning", "ignore"]}));

      self.$compiler_option("requirable", false, $hash2(["as"], {"as": "requirable?"}));

      self.$compiler_option("inline_operators", false, $hash2(["as"], {"as": "inline_operators?"}));

      self.$attr_reader("result", "fragments");

      self.$attr_accessor("scope");

      self.$attr_reader("case_stmt");

      self.$attr_reader("eof_content");

      def.$initialize = function(source, options) {
        var self = this;

        if (options == null) {
          options = $hash2([], {})
        }
        self.source = source;
        self.indent = "";
        self.unique = 0;
        return self.options = options;
      };

      def.$compile = function() {
        var $a, $b, self = this;

        self.parser = $scope.get('Parser').$new();
        self.sexp = self.$s("top", ((($a = self.parser.$parse(self.source, self.$file())) !== false && $a !== nil) ? $a : self.$s("nil")));
        self.eof_content = self.parser.$lexer().$eof_content();
        self.fragments = self.$process(self.sexp).$flatten();
        return self.result = ($a = ($b = self.fragments).$map, $a.$$p = "code".$to_proc(), $a).call($b).$join("");
      };

      def.$source_map = function(source_file) {
        var $a, self = this;

        if (source_file == null) {
          source_file = nil
        }
        return (($scope.get('Opal')).$$scope.get('SourceMap')).$new(self.fragments, ((($a = source_file) !== false && $a !== nil) ? $a : self.$file()));
      };

      def.$helpers = function() {
        var $a, self = this;

        return ((($a = self.helpers) !== false && $a !== nil) ? $a : self.helpers = $scope.get('Set').$new(["breaker", "slice"]));
      };

      def.$operator_helpers = function() {
        var $a, self = this;

        return ((($a = self.operator_helpers) !== false && $a !== nil) ? $a : self.operator_helpers = $scope.get('Set').$new());
      };

      def.$method_calls = function() {
        var $a, self = this;

        return ((($a = self.method_calls) !== false && $a !== nil) ? $a : self.method_calls = $scope.get('Set').$new());
      };

      def.$error = function(msg, line) {
        var self = this;

        if (line == null) {
          line = nil
        }
        return self.$raise($scope.get('SyntaxError'), "" + (msg) + " :" + (self.$file()) + ":" + (line));
      };

      def.$warning = function(msg, line) {
        var self = this;

        if (line == null) {
          line = nil
        }
        return self.$warn("WARNING: " + (msg) + " -- " + (self.$file()) + ":" + (line));
      };

      def.$parser_indent = function() {
        var self = this;

        return self.indent;
      };

      def.$s = function(parts) {
        var self = this;

        parts = $slice.call(arguments, 0);
        return $scope.get('Sexp').$new(parts);
      };

      def.$fragment = function(str, sexp) {
        var self = this;

        if (sexp == null) {
          sexp = nil
        }
        return $scope.get('Fragment').$new(str, sexp);
      };

      def.$unique_temp = function() {
        var self = this;

        return "TMP_" + (self.unique = self.unique['$+'](1));
      };

      def.$helper = function(name) {
        var self = this;

        return self.$helpers()['$<<'](name);
      };

      def.$indent = TMP_3 = function() {
        var $a, self = this, $iter = TMP_3.$$p, block = $iter || nil, indent = nil, res = nil;

        TMP_3.$$p = null;
        indent = self.indent;
        self.indent = self.indent['$+']($scope.get('INDENT'));
        self.space = "\n" + (self.indent);
        res = ((($a = Opal.yieldX(block, [])) === $breaker) ? $breaker.$v : $a);
        self.indent = indent;
        self.space = "\n" + (self.indent);
        return res;
      };

      def.$with_temp = TMP_4 = function() {
        var $a, self = this, $iter = TMP_4.$$p, block = $iter || nil, tmp = nil, res = nil;

        TMP_4.$$p = null;
        tmp = self.scope.$new_temp();
        res = ((($a = Opal.yield1(block, tmp)) === $breaker) ? $breaker.$v : $a);
        self.scope.$queue_temp(tmp);
        return res;
      };

      def.$in_while = TMP_5 = function() {
        var $a, self = this, $iter = TMP_5.$$p, $yield = $iter || nil, result = nil;

        TMP_5.$$p = null;
        if (($yield !== nil)) {
          } else {
          return nil
        };
        self.while_loop = self.scope.$push_while();
        result = ((($a = Opal.yieldX($yield, [])) === $breaker) ? $breaker.$v : $a);
        self.scope.$pop_while();
        return result;
      };

      def.$in_case = TMP_6 = function() {
        var self = this, $iter = TMP_6.$$p, $yield = $iter || nil, old = nil;

        TMP_6.$$p = null;
        if (($yield !== nil)) {
          } else {
          return nil
        };
        old = self.case_stmt;
        self.case_stmt = $hash2([], {});
        if (Opal.yieldX($yield, []) === $breaker) return $breaker.$v;
        return self.case_stmt = old;
      };

      def['$in_while?'] = function() {
        var self = this;

        return self.scope['$in_while?']();
      };

      def.$process = function(sexp, level) {
        var $a, self = this, handler = nil;

        if (level == null) {
          level = "expr"
        }
        if (sexp['$=='](nil)) {
          return self.$fragment("")};
        if ((($a = handler = self.$handlers()['$[]'](sexp.$type())) !== nil && (!$a.$$is_boolean || $a == true))) {
          return handler.$new(sexp, level, self).$compile_to_fragments()
          } else {
          return self.$raise("Unsupported sexp: " + (sexp.$type()))
        };
      };

      def.$handlers = function() {
        var $a, self = this;

        return ((($a = self.handlers) !== false && $a !== nil) ? $a : self.handlers = (((($scope.get('Opal')).$$scope.get('Nodes'))).$$scope.get('Base')).$handlers());
      };

      def.$requires = function() {
        var $a, self = this;

        return ((($a = self.requires) !== false && $a !== nil) ? $a : self.requires = []);
      };

      def.$required_trees = function() {
        var $a, self = this;

        return ((($a = self.required_trees) !== false && $a !== nil) ? $a : self.required_trees = []);
      };

      def.$returns = function(sexp) {
        var $a, $b, TMP_7, self = this, $case = nil;

        if (sexp !== false && sexp !== nil) {
          } else {
          return self.$returns(self.$s("nil"))
        };
        return (function() {$case = sexp.$type();if ("break"['$===']($case) || "next"['$===']($case) || "redo"['$===']($case)) {return sexp}else if ("yield"['$===']($case)) {sexp['$[]='](0, "returnable_yield");
        return sexp;}else if ("scope"['$===']($case)) {sexp['$[]='](1, self.$returns(sexp['$[]'](1)));
        return sexp;}else if ("block"['$===']($case)) {if (sexp.$length()['$>'](1)) {
          sexp['$[]='](-1, self.$returns(sexp['$[]'](-1)))
          } else {
          sexp['$<<'](self.$returns(self.$s("nil")))
        };
        return sexp;}else if ("when"['$===']($case)) {sexp['$[]='](2, self.$returns(sexp['$[]'](2)));
        return sexp;}else if ("rescue"['$===']($case)) {sexp['$[]='](1, self.$returns(sexp['$[]'](1)));
        if ((($a = ($b = sexp['$[]'](2), $b !== false && $b !== nil ?sexp['$[]'](2)['$[]'](0)['$==']("resbody") : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          if ((($a = sexp['$[]'](2)['$[]'](2)) !== nil && (!$a.$$is_boolean || $a == true))) {
            sexp['$[]'](2)['$[]='](2, self.$returns(sexp['$[]'](2)['$[]'](2)))
            } else {
            sexp['$[]'](2)['$[]='](2, self.$returns(self.$s("nil")))
          }};
        return sexp;}else if ("ensure"['$===']($case)) {sexp['$[]='](1, self.$returns(sexp['$[]'](1)));
        return sexp;}else if ("begin"['$===']($case)) {sexp['$[]='](1, self.$returns(sexp['$[]'](1)));
        return sexp;}else if ("rescue_mod"['$===']($case)) {sexp['$[]='](1, self.$returns(sexp['$[]'](1)));
        sexp['$[]='](2, self.$returns(sexp['$[]'](2)));
        return sexp;}else if ("while"['$===']($case)) {return sexp}else if ("return"['$===']($case) || "js_return"['$===']($case)) {return sexp}else if ("xstr"['$===']($case)) {if ((($a = /return|;/['$=~'](sexp['$[]'](1))) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          sexp['$[]='](1, "return " + (sexp['$[]'](1)) + ";")
        };
        return sexp;}else if ("dxstr"['$===']($case)) {if ((($a = /return|;|\n/['$=~'](sexp['$[]'](1))) !== nil && (!$a.$$is_boolean || $a == true))) {
          } else {
          sexp['$[]='](1, "return " + (sexp['$[]'](1)))
        };
        return sexp;}else if ("if"['$===']($case)) {sexp['$[]='](2, self.$returns(((($a = sexp['$[]'](2)) !== false && $a !== nil) ? $a : self.$s("nil"))));
        sexp['$[]='](3, self.$returns(((($a = sexp['$[]'](3)) !== false && $a !== nil) ? $a : self.$s("nil"))));
        return sexp;}else {return ($a = ($b = self.$s("js_return", sexp)).$tap, $a.$$p = (TMP_7 = function(s){var self = TMP_7.$$s || this, $a, $b;
if (s == null) s = nil;
        return (($a = [sexp.$source()]), $b = s, $b['$source='].apply($b, $a), $a[$a.length-1])}, TMP_7.$$s = self, TMP_7), $a).call($b)}})();
      };

      return (def.$handle_block_given_call = function(sexp) {
        var $a, $b, self = this, scope = nil;

        self.scope['$uses_block!']();
        if ((($a = self.scope.$block_name()) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$fragment("(" + (self.scope.$block_name()) + " !== nil)", sexp)
        } else if ((($a = ($b = scope = self.scope.$find_parent_def(), $b !== false && $b !== nil ?scope.$block_name() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$fragment("(" + (scope.$block_name()) + " !== nil)", sexp)
          } else {
          return self.$fragment("false", sexp)
        };
      }, nil) && 'handle_block_given_call';
    })(self, null);
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal/erb"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $klass = Opal.klass, $gvars = Opal.gvars;

  Opal.add_stubs(['$require', '$compile', '$new', '$fix_quotes', '$find_contents', '$find_code', '$wrap_compiled', '$require_erb', '$prepared_source', '$gsub', '$+', '$=~', '$sub']);
  self.$require("opal/compiler");
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self.$$proto, $scope = self.$$scope;

    (function($base) {
      var self = $module($base, 'ERB');

      var def = self.$$proto, $scope = self.$$scope;

      Opal.defs(self, '$compile', function(source, file_name) {
        var self = this;

        if (file_name == null) {
          file_name = "(erb)"
        }
        return $scope.get('Compiler').$new(source, file_name).$compile();
      });

      (function($base, $super) {
        function $Compiler(){};
        var self = $Compiler = $klass($base, $super, 'Compiler', $Compiler);

        var def = self.$$proto, $scope = self.$$scope;

        def.prepared_source = def.source = def.file_name = nil;
        def.$initialize = function(source, file_name) {
          var $a, self = this;

          if (file_name == null) {
            file_name = "(erb)"
          }
          return $a = [source, file_name, source], self.source = $a[0], self.file_name = $a[1], self.result = $a[2];
        };

        def.$prepared_source = function() {
          var $a, self = this, source = nil;

          return ((($a = self.prepared_source) !== false && $a !== nil) ? $a : self.prepared_source = (function() {source = self.source;
          source = self.$fix_quotes(source);
          source = self.$find_contents(source);
          source = self.$find_code(source);
          source = self.$wrap_compiled(source);
          source = self.$require_erb(source);
          return source;})());
        };

        def.$compile = function() {
          var self = this;

          return $scope.get('Opal').$compile(self.$prepared_source());
        };

        def.$fix_quotes = function(result) {
          var self = this;

          return result.$gsub("\"", "\\\"");
        };

        Opal.cdecl($scope, 'BLOCK_EXPR', /\s+(do|\{)(\s*\|[^|]*\|)?\s*\Z/);

        def.$require_erb = function(result) {
          var self = this;

          return "require \"erb\";"['$+'](result);
        };

        def.$find_contents = function(result) {
          var $a, $b, TMP_1, self = this;

          return ($a = ($b = result).$gsub, $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this, $a, inner = nil;

          inner = (($a = $gvars['~']) === nil ? nil : $a['$[]'](1)).$gsub(/\\'/, "'").$gsub(/\\"/, "\"");
            if ((($a = inner['$=~']($scope.get('BLOCK_EXPR'))) !== nil && (!$a.$$is_boolean || $a == true))) {
              return "\")\noutput_buffer.append= " + (inner) + "\noutput_buffer.append(\""
              } else {
              return "\")\noutput_buffer.append=(" + (inner) + ")\noutput_buffer.append(\""
            };}, TMP_1.$$s = self, TMP_1), $a).call($b, /<%=([\s\S]+?)%>/);
        };

        def.$find_code = function(result) {
          var $a, $b, TMP_2, self = this;

          return ($a = ($b = result).$gsub, $a.$$p = (TMP_2 = function(){var self = TMP_2.$$s || this, $a;

          return "\")\n" + ((($a = $gvars['~']) === nil ? nil : $a['$[]'](1))) + "\noutput_buffer.append(\""}, TMP_2.$$s = self, TMP_2), $a).call($b, /<%([\s\S]+?)%>/);
        };

        return (def.$wrap_compiled = function(result) {
          var self = this, path = nil;

          path = self.file_name.$sub(/\.opalerb$/, "");
          return result = "Template.new('" + (path) + "') do |output_buffer|\noutput_buffer.append(\"" + (result) + "\")\noutput_buffer.join\nend\n";
        }, nil) && 'wrap_compiled';
      })(self, null);
      
    })(self)
    
  })(self);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal-parser"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $module = Opal.module, $hash2 = Opal.hash2;

  Opal.add_stubs(['$require', '$compile', '$eval']);
  self.$require("opal/compiler");
  self.$require("opal/erb");
  self.$require("opal/version");
  (function($base) {
    var self = $module($base, 'Kernel');

    var def = self.$$proto, $scope = self.$$scope;

    def.$eval = function(str) {
      var self = this, code = nil;

      code = $scope.get('Opal').$compile(str, $hash2(["file"], {"file": "(eval)"}));
      return eval(code);
    };

    def.$require_remote = function(url) {
      var self = this;

      
      var r = new XMLHttpRequest();
      r.open("GET", url, false);
      r.send('');
    
      return self.$eval(r.responseText);
    };
        ;Opal.donate(self, ["$eval", "$require_remote"]);
  })(self);
  
  Opal.compile = function(str, options) {
    if (options) {
      options = Opal.hash(options);
    }
    return Opal.Opal.$compile(str, options);
  };

  Opal.eval = function(str, options) {
   return eval(Opal.compile(str, options));
  };

  function run_ruby_scripts() {
    var tag, tags = document.getElementsByTagName('script');

    for (var i = 0, len = tags.length; i < len; i++) {
      tag = tags[i];
      if (tag.type === "text/ruby") {
        if (tag.src)       Opal.Kernel.$require_remote(tag.src);
        if (tag.innerHTML) Opal.Kernel.$eval(tag.innerHTML);
      }
    }
  }

  if (typeof(document) !== 'undefined') {
    if (window.addEventListener) {
      window.addEventListener('DOMContentLoaded', run_ruby_scripts, false);
    }
    else {
      window.attachEvent('onload', run_ruby_scripts);
    }
  }

};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["object_extensions"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass;

  Opal.add_stubs(['$sort', '$reject', '$include?', '$instance_variables', '$map', '$instance_variable_get', '$irb_instance_variables']);
  (function($base, $super) {
    function $Object(){};
    var self = $Object = $klass($base, $super, 'Object', $Object);

    var def = self.$$proto, $scope = self.$$scope;

    Opal.defn(self, '$irb_instance_variables', function() {
      var $a, $b, TMP_1, self = this, filtered = nil;

      filtered = ["@constructor", "@toString"];
      return ($a = ($b = self.$instance_variables()).$reject, $a.$$p = (TMP_1 = function(var$){var self = TMP_1.$$s || this;
if (var$ == null) var$ = nil;
      return filtered['$include?'](var$)}, TMP_1.$$s = self, TMP_1), $a).call($b).$sort();
    });

    return (Opal.defn(self, '$irb_instance_var_values', function() {
      var $a, $b, TMP_2, self = this;

      return ($a = ($b = self.$irb_instance_variables()).$map, $a.$$p = (TMP_2 = function(var_name){var self = TMP_2.$$s || this;
if (var_name == null) var_name = nil;
      return [var_name, self.$instance_variable_get("" + (var_name))]}, TMP_2.$$s = self, TMP_2), $a).call($b);
    }), nil) && 'irb_instance_var_values';
  })(self, null);
  return (function($base, $super) {
    function $Foo(){};
    var self = $Foo = $klass($base, $super, 'Foo', $Foo);

    var def = self.$$proto, $scope = self.$$scope;

    return (def.$initialize = function() {
      var self = this;

      self.a = "a";
      return self.b = "b";
    }, nil) && 'initialize'
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal_irb"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $gvars = Opal.gvars, $hash2 = Opal.hash2;

  Opal.add_stubs(['$require', '$Native', '$each', '$[]', '$is_a?', '$<<', '$sort_by', '$to_proc', '$uniq', '$attr_reader', '$compile', '$new']);
  self.$require("opal");
  self.$require("opal/compiler");
  self.$require("object_extensions");
  return (function($base, $super) {
    function $OpalIrb(){};
    var self = $OpalIrb = $klass($base, $super, 'OpalIrb', $OpalIrb);

    var def = self.$$proto, $scope = self.$$scope;

    def.$irb_vars = function() {
      var self = this;

      irbVars = [];
       for(variable in Opal.irb_vars) {
         if(Opal.irb_vars.hasOwnProperty(variable)) {
            irbVars.push([variable, Opal.irb_vars[variable]])
         }
       };
       return irbVars;
    };

    def.$opal_classes = function() {
      var $a, $b, TMP_1, $c, self = this, classes = nil;
      if ($gvars.opal_js_object == null) $gvars.opal_js_object = nil;

      classes = [];
      $gvars.opal_js_object = self.$Native(Opal);
      ($a = ($b = $gvars.opal_js_object).$each, $a.$$p = (TMP_1 = function(k){var self = TMP_1.$$s || this, $a, attr = nil;
        if ($gvars.opal_js_object == null) $gvars.opal_js_object = nil;
if (k == null) k = nil;
      attr = $gvars.opal_js_object['$[]'](k);
        if ((($a = attr['$is_a?']($scope.get('Class'))) !== nil && (!$a.$$is_boolean || $a == true))) {
          return classes['$<<'](attr)
          } else {
          return nil
        };}, TMP_1.$$s = self, TMP_1), $a).call($b);
      return ($a = ($c = classes.$uniq()).$sort_by, $a.$$p = "name".$to_proc(), $a).call($c);
    };

    self.$attr_reader("parser");

    return (def.$parse = function(cmd) {
      var self = this;

      return (($scope.get('Opal')).$$scope.get('Compiler')).$new(cmd, $hash2(["irb"], {"irb": true})).$compile();
    }, nil) && 'parse';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
Opal.modules["opal_irb_homebrew_console"] = function(Opal) {
  Opal.dynamic_require_severity = "error";
  var self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $hash2 = Opal.hash2, $range = Opal.range, $gvars = Opal.gvars;

  Opal.add_stubs(['$require', '$map', '$-', '$width', '$value', '$html', '$height', '$+', '$gsub', '$attr_reader', '$clone', '$new', '$on', '$handle_keypress', '$initialize_window', '$print_header', '$html=', '$inspect', '$unshift', '$==', '$[]', '$add_to_history', '$parse', '$log', '$backtrace', '$join', '$print', '$each_with_index', '$reverse', '$which', '$===', '$prevent_default', '$value=', '$escape_html', '$add_to_saved', '$!', '$process_saved', '$open_multiline_dialog', '$show_previous_history', '$show_next_history', '$ctrl_key', '$<', '$length', '$>', '$resize_input', '$focus', '$each', '$find', '$create_html', '$setup_cmd_line_methods', '$scroll_to_bottom', '$setup_multi_line', '$setValue', '$call', '$sub', '$getValue']);
  self.$require("opal");
  self.$require("opal-jquery");
  self.$require("opal_irb");
  return (function($base, $super) {
    function $OpalIRBHomebrewConsole(){};
    var self = $OpalIRBHomebrewConsole = $klass($base, $super, 'OpalIRBHomebrewConsole', $OpalIRBHomebrewConsole);

    var def = self.$$proto, $scope = self.$$scope;

    def.settings = def.inputdiv = def.inputl = def.input = def.inputcopy = def.prompt = def.output = def.history = def.multiline = def.saved = def.irb = def.historyi = def.editor = def.open_editor_dialog_function = nil;
    def.$reset_settings = function() {
      var self = this;

      return localStorage.clear();
    };

    def.$save_settings = function() {
      var self = this;

      return localStorage.settings = JSON.stringify( self.settings.$map());
    };

    def.$resize_input = function(e) {
      var self = this, width = nil, content = nil;

      width = self.inputdiv.$width()['$-'](self.inputl.$width());
      content = self.input.$value();
      self.inputcopy.$html(content);
      self.inputcopy.$width(width);
      self.input.$width(width);
      return self.input.$height(self.inputcopy.$height()['$+'](2));
    };

    def.$scroll_to_bottom = function() {
      var self = this;

      return window.scrollTo( 0, self.prompt[0].offsetTop);
    };

    Opal.cdecl($scope, 'DEFAULT_SETTINGS', $hash2(["max_lines", "max_depth", "show_hidden", "colorize"], {"max_lines": 500, "max_depth": 2, "show_hidden": false, "colorize": true}));

    def.$escape_html = function(s) {
      var self = this;

      return s.$gsub(/&/, "&amp;").$gsub(/</, "&lt;").$gsub(/>/, "&gt;");
    };

    self.$attr_reader("settings");

    def.$initialize = function(output, input, prompt, inputdiv, inputl, inputr, inputcopy, settings) {
      var $a, $b, TMP_1, self = this, myself = nil;

      if (settings == null) {
        settings = $hash2([], {})
      }
      $a = [output, input, prompt, inputdiv, inputl, inputr, inputcopy], self.output = $a[0], self.input = $a[1], self.prompt = $a[2], self.inputdiv = $a[3], self.inputl = $a[4], self.inputr = $a[5], self.inputcopy = $a[6];
      self.history = [];
      self.historyi = -1;
      self.saved = "";
      self.multiline = false;
      self.settings = $scope.get('DEFAULT_SETTINGS').$clone();
      self.irb = $scope.get('OpalIrb').$new();
      myself = self;
      ($a = ($b = self.input).$on, $a.$$p = (TMP_1 = function(evt){var self = TMP_1.$$s || this;
if (evt == null) evt = nil;
      return myself.$handle_keypress(evt)}, TMP_1.$$s = self, TMP_1), $a).call($b, "keydown");
      self.$initialize_window();
      return self.$print_header();
    };

    def.$print = function(args) {
      var $a, $b, self = this, s = nil, o = nil;

      s = args;
      o = self.output.$html()['$+'](s)['$+']("\n");
      (($a = [o]), $b = self.output, $b['$html='].apply($b, $a), $a[$a.length-1]);
      return nil;
    };

    def.$to_s = function() {
      var self = this;

      return $hash2(["history", "multiline", "settings"], {"history": self.history, "multiline": self.multiline, "settings": self.settings}).$inspect();
    };

    def.$add_to_history = function(s) {
      var self = this;

      self.history.$unshift(s);
      return self.historyi = -1;
    };

    def.$add_to_saved = function(s) {
      var self = this;

      self.saved = self.saved['$+']((function() {if (s['$[]']($range(0, -1, true))['$==']("\\")) {
        return s['$[]']($range(0, -1, true))
        } else {
        return s
      }; return nil; })());
      self.saved = self.saved['$+']("\n");
      return self.$add_to_history(s);
    };

    def.$clear = function() {
      var $a, $b, self = this;

      (($a = [""]), $b = self.output, $b['$html='].apply($b, $a), $a[$a.length-1]);
      return nil;
    };

    def.$process_saved = function() {
      var $a, self = this, compiled = nil, value = nil, output = nil, e = nil;

      try {
      compiled = self.irb.$parse(self.saved);
        self.$log(compiled);
        value = eval(compiled);
        $gvars._ = value;
        output = nodeutil.inspect( value, self.settings['$[]']("show_hidden"), self.settings['$[]']("max_depth"), self.settings['$[]']("colorize"));
      } catch ($err) {if (Opal.rescue($err, [$scope.get('Exception')])) {e = $err;
        if ((($a = e.$backtrace()) !== nil && (!$a.$$is_boolean || $a == true))) {
          output = ((("FOR:\n") + (compiled)) + "\n============\n")['$+'](e.$backtrace().$join("\n"))
          } else {
          output = e.toString()
        }
        }else { throw $err; }
      };
      self.saved = "";
      return self.$print(output);
    };

    def.$help = function() {
      var self = this, text = nil;

      text = [" ", "<strong>Features</strong>", "<strong>========</strong>", "+ <strong>Esc</strong> enters multiline mode.", "+ <strong>Up/Down arrow and ctrl-p/ctrl-n</strong> flips through line history.", "+ Access the internals of this console through <strong>$irb</strong>.", "+ <strong>clear</strong> clears this console.", "+ <strong>history</strong> shows line history.", " ", "<strong>@Settings</strong>", "<strong>========</strong>", "You can modify the behavior of this IRB by altering <strong>$irb.@settings</strong>:", " ", "+ <strong>max_lines</strong> (" + (self.settings['$[]']("max_lines")) + "): max line count of this console", "+ <strong>max_depth</strong> (" + (self.settings['$[]']("max_depth")) + "): max_depth in which to inspect outputted object", "+ <strong>show_hidden</strong> (" + (self.settings['$[]']("show_hidden")) + "): flag to output hidden (not enumerable) properties of objects", "+ <strong>colorize</strong> (" + (self.settings['$[]']("colorize")) + "): flag to colorize output (set to false if IRB is slow)", " ", " "].$join("\n");
      return self.$print(text);
    };

    def.$log = function(thing) {
      var self = this;

      return console.orig_log(thing);
    };

    def.$history = function() {
      var $a, $b, TMP_2, self = this;

      return ($a = ($b = self.history.$reverse()).$each_with_index, $a.$$p = (TMP_2 = function(line, i){var self = TMP_2.$$s || this;
if (line == null) line = nil;if (i == null) i = nil;
      return self.$print("" + (i) + ": " + (line))}, TMP_2.$$s = self, TMP_2), $a).call($b);
    };

    def.$handle_keypress = function(e) {
      var $a, $b, self = this, $case = nil, input = nil;

      return (function() {$case = e.$which();if ((13)['$===']($case)) {e.$prevent_default();
      input = self.input.$value();
      (($a = [""]), $b = self.input, $b['$value='].apply($b, $a), $a[$a.length-1]);
      self.$print(self.prompt.$html()['$+'](self.$escape_html(input)));
      if (input !== false && input !== nil) {
        self.$add_to_saved(input);
        if ((($a = ($b = input['$[]']($range(0, -1, true))['$==']("\\")['$!'](), $b !== false && $b !== nil ?self.multiline['$!']() : $b)) !== nil && (!$a.$$is_boolean || $a == true))) {
          return self.$process_saved()
          } else {
          return nil
        };
        } else {
        return nil
      };}else if ((27)['$===']($case)) {e.$prevent_default();
      return self.$open_multiline_dialog();}else if ((38)['$===']($case)) {e.$prevent_default();
      return self.$show_previous_history();}else if ((40)['$===']($case)) {e.$prevent_default();
      return self.$show_next_history();}else if ((80)['$===']($case)) {if ((($a = e.$ctrl_key()) !== nil && (!$a.$$is_boolean || $a == true))) {
        e.$prevent_default();
        return self.$show_previous_history();
        } else {
        return nil
      }}else if ((78)['$===']($case)) {if ((($a = e.$ctrl_key()) !== nil && (!$a.$$is_boolean || $a == true))) {
        e.$prevent_default();
        return self.$show_next_history();
        } else {
        return nil
      }}else { return nil }})();
    };

    def.$show_previous_history = function() {
      var $a, $b, self = this;

      if (self.historyi['$<'](self.history.$length()['$-'](1))) {
        self.historyi = self.historyi['$+'](1);
        return (($a = [self.history['$[]'](self.historyi)]), $b = self.input, $b['$value='].apply($b, $a), $a[$a.length-1]);
        } else {
        return nil
      };
    };

    def.$show_next_history = function() {
      var $a, $b, self = this;

      if (self.historyi['$>'](0)) {
        self.historyi = self.historyi['$+'](-1);
        return (($a = [self.history['$[]'](self.historyi)]), $b = self.input, $b['$value='].apply($b, $a), $a[$a.length-1]);
        } else {
        return nil
      };
    };

    def.$initialize_window = function() {
      var self = this;

      self.$resize_input();
      return self.input.$focus();
    };

    Opal.cdecl($scope, 'CMD_LINE_METHOD_DEFINITIONS', ["def help\n                                   $irb.help\n                                   nil\n                                 end", "def clear\n                                   $irb.clear\n                                   nil\n                                 end", "def history\n                                   $irb.history\n                                   nil\n                                 end"]);

    def.$setup_cmd_line_methods = function() {
      var $a, $b, TMP_3, self = this;

      return ($a = ($b = $scope.get('CMD_LINE_METHOD_DEFINITIONS')).$each, $a.$$p = (TMP_3 = function(method_defn){var self = TMP_3.$$s || this, compiled = nil;
        if (self.irb == null) self.irb = nil;
if (method_defn == null) method_defn = nil;
      compiled = self.irb.$parse(method_defn);
        return eval(compiled);}, TMP_3.$$s = self, TMP_3), $a).call($b);
    };

    def.$print_header = function() {
      var self = this;

      return self.$print(["# Opal v" + ((($scope.get('Opal')).$$scope.get('VERSION'))) + " IRB", "# <a href=\"https://github.com/fkchang/opal-irb\" target=\"_blank\">https://github.com/fkchang/opal-irb</a>", "# inspired by <a href=\"https://github.com/larryng/coffeescript-repl\" target=\"_blank\">https://github.com/larryng/coffeescript-repl</a>", "#", "# <strong>help</strong> for features and tips.", " "].$join("\n"));
    };

    Opal.defs(self, '$create_html', function(parent_container_id) {
      var $a, $b, self = this, parent = nil;

      parent = $scope.get('Element').$find(parent_container_id);
      return (($a = ["      <div id=\"outputdiv\">\n        <pre id=\"output\"></pre>\n      </div>\n      <div id=\"inputdiv\">\n        <div id=\"inputl\">\n          <pre id=\"prompt\">opal&gt;&nbsp;</pre>\n        </div>\n        <div id=\"inputr\">\n          <textarea id=\"input\" spellcheck=\"false\"></textarea>\n          <div id=\"inputcopy\"></div>\n        </div>\n"]), $b = parent, $b['$html='].apply($b, $a), $a[$a.length-1]);
    });

    Opal.defs(self, '$create', function(container_id) {
      var $a, $b, TMP_4, $c, TMP_5, $d, TMP_6, $e, TMP_7, $f, TMP_8, self = this, output = nil, input = nil, prompt = nil, inputdiv = nil, inputl = nil, inputr = nil, inputcopy = nil, irb = nil;

      self.$create_html(container_id);
      output = $scope.get('Element').$find("#output");
      input = $scope.get('Element').$find("#input");
      prompt = $scope.get('Element').$find("#prompt");
      inputdiv = $scope.get('Element').$find("#inputdiv");
      inputl = $scope.get('Element').$find("#inputl");
      inputr = $scope.get('Element').$find("#inputr");
      inputcopy = $scope.get('Element').$find("#inputcopy");
      irb = $scope.get('OpalIRBHomebrewConsole').$new(output, input, prompt, inputdiv, inputl, inputr, inputcopy);
      irb.$setup_cmd_line_methods();
      ($a = ($b = input).$on, $a.$$p = (TMP_4 = function(){var self = TMP_4.$$s || this;

      return irb.$scroll_to_bottom()}, TMP_4.$$s = self, TMP_4), $a).call($b, "keydown");
      ($a = ($c = $scope.get('Element').$find(window)).$on, $a.$$p = (TMP_5 = function(e){var self = TMP_5.$$s || this;
if (e == null) e = nil;
      return irb.$resize_input(e)}, TMP_5.$$s = self, TMP_5), $a).call($c, "resize");
      ($a = ($d = input).$on, $a.$$p = (TMP_6 = function(e){var self = TMP_6.$$s || this;
if (e == null) e = nil;
      return irb.$resize_input(e)}, TMP_6.$$s = self, TMP_6), $a).call($d, "keyup");
      ($a = ($e = input).$on, $a.$$p = (TMP_7 = function(e){var self = TMP_7.$$s || this;
if (e == null) e = nil;
      return irb.$resize_input(e)}, TMP_7.$$s = self, TMP_7), $a).call($e, "change");
      ($a = ($f = $scope.get('Element').$find("html")).$on, $a.$$p = (TMP_8 = function(e){var self = TMP_8.$$s || this;
if (e == null) e = nil;
      return input.$focus()}, TMP_8.$$s = self, TMP_8), $a).call($f, "click");
      
    console.orig_log = console.log
    console.log = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      console.orig_log(args);
      Opal.gvars["irb"].$print(args);
    };
    
      $gvars.irb = irb;
      return irb.$setup_multi_line();
    });

    def.$setup_multi_line = function() {
      var self = this, myself = nil;

      myself = self;
      
    $( ".dialog" ).dialog({
                            autoOpen: false,
                            show: "blind",
                            hide: "explode",
                            modal: true,
                            width: "500px",
                            title: "Multi Line Edit",
                            buttons: {
                              "Run it":  function() {
                                $( this ).dialog( "close" );
                                myself.$process_multiline();
                              },
                              "Cancel":  function() {
                                $( this ).dialog( "close" );
                           },
                        }
          });
      
      self.open_editor_dialog_function = function() {
          $( ".dialog" ).dialog( "open" );
          setTimeout(function(){editor.refresh();}, 20);
      }
      ;
      return self.editor = 
      editor = CodeMirror.fromTextArea(document.getElementById("multi_line_input"),
              {mode: "ruby",
                  lineNumbers: true,
                  matchBrackets: true,
                  keyMap: "emacs",
                  theme: "default"
              });

   ;
    };

    def.$open_multiline_dialog = function() {
      var self = this;

      self.editor.$setValue(self.input.$value());
      return self.open_editor_dialog_function.$call();
    };

    return (def.$process_multiline = function() {
      var $a, $b, self = this, multi_line_value = nil;

      multi_line_value = self.editor.$getValue().$sub(/(\n)+$/, "");
      self.$add_to_saved(multi_line_value);
      self.$print(multi_line_value);
      self.$process_saved();
      return (($a = [""]), $b = self.input, $b['$value='].apply($b, $a), $a[$a.length-1]);
    }, nil) && 'process_multiline';
  })(self, null);
};

/* Generated by Opal 0.7.0.beta3 */
(function(Opal) {
  Opal.dynamic_require_severity = "error";
  var $a, $b, TMP_1, self = Opal.top, $scope = Opal, nil = Opal.nil, $breaker = Opal.breaker, $slice = Opal.slice;

  Opal.add_stubs(['$require', '$ready?', '$create']);
  self.$require("opal");
  self.$require("opal-jquery");
  self.$require("opal-parser");
  self.$require("opal_irb_homebrew_console");
  return ($a = ($b = $scope.get('Document'))['$ready?'], $a.$$p = (TMP_1 = function(){var self = TMP_1.$$s || this;

  return $scope.get('OpalIRBHomebrewConsole').$create("#container")}, TMP_1.$$s = self, TMP_1), $a).call($b);
})(Opal);
