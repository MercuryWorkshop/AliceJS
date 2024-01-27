// The global list of "references", as captured by the proxy in stateful
let __reference_stack = [];

// We add some extra properties into various objects throughout, better to use symbols and not interfere
let ALICEJS_REFERENCES_MAPPING = Symbol();
let ALICEJS_REFERENCES_MARKER = Symbol();
let ALICEJS_STATEFUL_LISTENERS = Symbol();

// Say you have some code like
//// let state = stateful({
////    a: 1
//// })
//// let elm = <p>{window.use(state.a)}</p>
//
// According to the standard, the order of events is as follows:
// - the getter for window.use gets called, setting __reference_stack to an empty list
// - the proxy for state.a is triggered, pushing { state, "a", Proxy(state) } onto __reference_stack
// - the function that the getter returns is called, popping everything off the stack
// - the JSX factory h() is now passed the *reference* of state.a, not the value
Object.defineProperty(window, "use", {
  get: () => {
    __reference_stack = [];
    return (_sink, mapping) => {
      let references = __reference_stack;
      __reference_stack = [];

      references[ALICEJS_REFERENCES_MARKER] = true;
      if (mapping) references[ALICEJS_REFERENCES_MAPPING] = mapping;
      return references;
    };
  }
});
Object.assign(window, { h, stateful, handle, useValue });

// This wraps the target in a proxy, doing 2 things:
// - whenever a property is accessed, update the reference stack
// - whenever a property is set, notify the subscribed listeners
// This is what makes our "pass-by-reference" magic work
export function stateful(target) {
  target[ALICEJS_STATEFUL_LISTENERS] = [];

  const proxy = new Proxy(target, {
    get(target, property, proxy) {
      __reference_stack.push({ target, property, proxy });
      return Reflect.get(target, property, proxy);
    },
    set(target, property, val) {
      for (const listener of target[ALICEJS_STATEFUL_LISTENERS]) {
        listener(target, property, val);
      }
      return Reflect.set(target, property, val);
    },
  });

  return proxy;
}

export function isAJSReferences(arr) {
  return arr instanceof Array && ALICEJS_REFERENCES_MARKER in arr
}

// This lets you subscribe to a stateful object
export function handle(references, callback) {
  if (!isAJSReferences(references))
    throw new Error("Not an AliceJS reference set!");

  if (ALICEJS_REFERENCES_MAPPING in references) {
    const mapping = references[ALICEJS_REFERENCES_MAPPING];
    const used_props = [];
    const used_targets = [];

    const values = new Map();

    const pairs = [];

    const partial_update = (target, prop, val) => {
      if (used_props.includes(prop) && used_targets.includes(target)) {
        values.get(target)[prop] = val;
      }
    };

    const full_update = () => {
      const flattened_values = pairs.map(
        (pair) => values.get(pair[0])[pair[1]],
      );

      const value = mapping(...flattened_values.reverse());

      callback(value);
    };

    for (const p of references) {
      const target = p.target;
      const prop = p.property;

      used_props.push(prop);
      used_targets.push(target);

      pairs.push([target, prop]);

      if (!values.has(target)) {
        values.set(target, {});
      }

      partial_update(target, prop, target[prop]);

      target[ALICEJS_STATEFUL_LISTENERS].push((t, p, v) => {
        partial_update(t, p, v);
        full_update();
      });
    }
    full_update();
  } else {
    const reference = references[references.length - 1];
    const subscription = (target, prop, val) => {
      if (prop === reference.property && target === reference.target) {
        callback(val);
      }
    };
    reference.target[ALICEJS_STATEFUL_LISTENERS].push(subscription);
    subscription(reference.target, reference.property, reference.target[reference.property]);
  }
}

export function useValue(references) {
  let reference = references[references.length - 1];
  return reference.proxy[reference.property];
}

// Actual JSX factory. Responsible for creating the HTML elements and all of the *reactive* syntactic sugar
export function h(type, props, ...children) {
  if (typeof type === "function") {
    let newthis = stateful(Object.create(type.prototype));

    for (const name in props) {
      const references = props[name];
      if (isAJSReferences(references) && name.startsWith("bind:")) {
        let reference = references[references.length - 1];
        const propname = name.substring(5);
        if (propname == "this") {
          reference.proxy[reference.property] = newthis;
        } else {
          // component two way data binding!! (exact same behavior as svelte:bind)
          let isRecursive = false;

          handle(references, value => {
            if (isRecursive) {
              isRecursive = false;
              return;
            }
            isRecursive = true;
            newthis[propname] = value
          });
          handle(use(newthis[propname]), value => {
            if (isRecursive) {
              isRecursive = false;
              return;
            }
            isRecursive = true;
            reference.proxy[reference.property] = value;
          });
        }
        delete props[name];
      }
    }
    Object.assign(newthis, props);

    let slot = [];
    for (const child of children) {
      JSXAddChild(child, slot.push.bind(slot));
    }

    let elm = type.apply(newthis, [slot]);
    elm.$ = newthis;
    newthis.root = elm;
    if (newthis.css) {
      elm.classList.add(newthis.css);
      elm.classList.add("self");
    }
    return elm;
  }


  const elm = document.createElement(type);

  for (const child of children) {
    JSXAddChild(child, elm.appendChild.bind(elm));
  }

  if (!props) return elm;

  function useProp(name, callback) {
    if (!(name in props)) return;
    let prop = props[name];
    callback(prop);
    delete props[name];
  }

  // insert an element at the start
  useProp("before", callback => {
    JSXAddChild(callback());
  })

  // if/then/else syntax
  useProp("if", condition => {
    let thenblock = props["then"];
    let elseblock = props["else"];

    if (isAJSReferences(condition)) {
      if (thenblock) elm.appendChild(thenblock);
      if (elseblock) elm.appendChild(elseblock);

      handle(condition, val => {
        if (thenblock) {
          if (val) {
            thenblock.style.display = "";
            if (elseblock) elseblock.style.display = "none";
          } else {
            thenblock.style.display = "none";

            if (elseblock) elseblock.style.display = "";
          }
        } else {
          if (val) {
            elm.style.display = "";
          } else {
            elm.style.display = "none";
          }
        }
      });
    } else {
      if (thenblock) {
        if (condition) {
          elm.appendChild(thenblock);
        } else if (elseblock) {
          elm.appendChild(elseblock);
        }
      } else {
        if (condition) {
          elm.appendChild(thenblock);
        } else if (elseblock) {
          elm.appendChild(elseblock);
        } else {
          elm.style.display = "none";
          return document.createTextNode("");
        }
      }
    }

    delete props["then"];
    delete props["else"];
  });

  if ("for" in props && "do" in props) {
    const predicate = props["for"];
    const closure = props["do"];

    if (isAJSReferences(predicate)) {
      const __elms = [];
      let lastpredicate = [];
      handle(predicate, val => {
        if (
          Object.keys(val).length &&
          Object.keys(val).length == lastpredicate.length
        ) {
          let i = 0;
          for (const index in val) {
            if (
              deepEqual(val[index], lastpredicate[index])
            ) {
              continue;
            }
            const part = closure(val[index], index, val);
            elm.replaceChild(part, __elms[i]);
            __elms[i] = part;

            i += 1;
          }
          lastpredicate = Object.keys(
            JSON.parse(JSON.stringify(val)),
          );
        } else {
          for (const part of __elms) {
            part.remove();
          }
          for (const index in val) {
            const value = val[index];

            const part = closure(value, index, val);
            if (part instanceof HTMLElement) {
              __elms.push(part);
              elm.appendChild(part);
            }
          }

          lastpredicate = [];
        }
      });
    } else {
      for (const index in predicate) {
        const value = predicate[index];

        const part = closure(value, index, predicate);
        if (part instanceof Node) elm.appendChild(part);

      }
    }

    delete props["for"];
    delete props["do"];
  }


  // insert an element at the end
  useProp("after", callback => {
    JSXAddChild(callback());
  })

  for (const name in props) {
    const references = props[name];
    if (isAJSReferences(references) && name.startsWith("bind:")) {
      let reference = references[references.length - 1];
      const propname = name.substring(5);
      if (propname == "this") {
        reference.proxy[reference.property] = elm;
      } else if (propname == "value") {
        handle(references, value => elm.value = value);
        elm.addEventListener("change", () => {
          reference.proxy[reference.property] = elm.value;
        })
      } else if (propname == "checked") {
        handle(references, value => elm.checked = value);
        elm.addEventListener("click", () => {
          reference.proxy[reference.property] = elm.checked;
        })
      }
      delete props[name];
    }
  }

  useProp("class", classlist => {
    if (typeof classlist === "string") {
      elm.className = classlist;
      return;
    }

    if (isAJSReferences(classlist)) {
      handle(classlist, classname => elm.className = classname);
      return;
    }

    for (const name of classlist) {
      if (isAJSReferences(name)) {
        let oldvalue = null;
        handle(name, value => {
          if (typeof oldvalue === "string") {
            elm.classList.remove(oldvalue);
          }
          elm.classList.add(value);
          oldvalue = value;
        });
      } else {
        elm.classList.add(name);
      }
    }
  });

  // apply the non-reactive properties
  for (const name in props) {
    const prop = props[name];
    if (isAJSReferences(prop)) {
      handle(prop, (val) => {
        JSXAddAttributes(elm, name, val);
      });
    } else {
      JSXAddAttributes(elm, name, prop);
    }
  }

  return elm;
}

// glue for nested children
function JSXAddChild(child, cb) {
  if (isAJSReferences(child)) {
    let appended = [];
    handle(child, (val) => {
      if (appended.length > 1) {
        // this is why we don't encourage arrays (jank)
        appended.forEach(n => n.remove());
        appended = JSXAddChild(val, cb);
      } else if (appended.length > 0) {
        let old = appended[0];
        appended = JSXAddChild(val, cb);
        if (appended[0]) {
          old.replaceWith(appended[0])
        } else {
          old.remove();
        }
      } else {
        appended = JSXAddChild(val, cb);
      }
    });
  } else if (child instanceof Node) {
    cb(child);
    return [child];
  } else if (child instanceof Array) {
    let elms = [];
    for (const childchild of child) {
      elms = elms.concat(JSXAddChild(childchild, cb));
    }
    return elms;
  } else {
    let node = document.createTextNode(child);
    cb(node);
    return [node];
  }
}

// Where properties are assigned to elements, and where the *non-reactive* syntax sugar goes
function JSXAddAttributes(elm, name, prop) {
  if (typeof prop === "function" && name === "mount") {
    window.$el = elm;
    prop(elm);
    return;
  }

  if (typeof prop === "function" && name.startsWith("on:")) {
    const names = name.substring(3);
    for (const name of names.split("$")) {
      elm.addEventListener(name, (...args) => {
        window.$el = elm;
        prop(...args);
      });
    }
    return;
  }

  if (typeof prop === "function" && name.startsWith("observe")) {
    const observerclass = window[`${name.substring(8)}Observer`];
    if (!observerclass) {
      console.error(`Observer ${name} does not exist`);
      return;
    }
    const observer = new observerclass(entries => {
      for (const entry of entries) {
        window.$el = elm;
        prop(entry);
      }
    });
    observer.observe(elm);
    return;
  }

  elm.setAttribute(name, prop);
}

function deepEqual(object1, object2) {
  const keys1 = Object.keys(object1);
  const keys2 = Object.keys(object2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    const val1 = object1[key];
    const val2 = object2[key];
    const areObjects = isObject(val1) && isObject(val2);
    if (
      (areObjects && !deepEqual(val1, val2)) ||
      (!areObjects && val1 !== val2)
    ) {
      return false;
    }
  }

  return true;
}

function isObject(object) {
  return object != null && typeof object === "object";
}
