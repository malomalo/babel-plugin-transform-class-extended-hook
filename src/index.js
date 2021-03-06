import template from "@babel/template";
import traverse from '@babel/traverse';

export default function({ types: t }) {
    let SKIP = Symbol();

    function addHelperToFile(file) {
      var helperName = "__babelPluginTransformClassExtendedHook";
      if (file.scope.hasBinding(helperName)) return;

      var helper = template(`
        var helper = function(child, parent, childName) {
          if (childName) {
            Object.defineProperty(child, "name", { value: childName, configurable: true });
          }

          if ("extended" in parent) {
            if (typeof parent.extended == 'function') {
              var returnedNewChild = parent.extended(child);
              if (returnedNewChild !== void 0) {
                if (childName && typeof returnedNewChild == 'function' && returnedNewChild.name !== childName) {
                  Object.defineProperty(returnedNewChild, "name", { value: childName, configurable: true });
                }
                child = returnedNewChild;
              }
            } else {
              throw new TypeError("Attempted to call extended, but it was not a function");
            }
          }

          return child;
        }
      `);

      file.scope.push({
        id: t.identifier(helperName),
        init: helper().declarations[0].init
      });
    }

    function getChildName(path) {
      if (t.isIdentifier(path.node.id)) {
        return path.node.id.name;
      } else if (path.node.id == null && t.isVariableDeclarator(path.parentPath.node)) {
        return path.parentPath.node.id.name;
      }
    }

    function transform(childClassName, path) {
        var CHILD = path.scope.generateUidIdentifier(childClassName);
        var PARENT = path.node.superClass;
        var CHILD_NAME = childClassName ? t.stringLiteral(childClassName) : t.identifier("undefined");
        var binding = path.scope.getBinding(childClassName);
        
        if (PARENT.type === 'Identifier') {
            var CLASS_EXPRESSION = t.classDeclaration(
              CHILD,
              PARENT,
              path.node.body,
              path.node.decorators || []
            );

            traverse(CLASS_EXPRESSION, {
                Identifier({ node }, state) {
                    if (node.name === childClassName) {
                        node.name = CHILD.name;
                    }
                },
                Scope(path, state) {
                    if ( !path.scope.bindingIdentifierEquals(childClassName, binding.identifier) ) {
                        path.skip();
                    }
                }
            }, path.scope);
            
            // Don't transform *this* class expression, or we'll loop forever
            CLASS_EXPRESSION[SKIP] = true;
            
            return template(`
                (function(){
                  CLASS_EXPRESSION;
                  return __babelPluginTransformClassExtendedHook(CHILD, PARENT, CHILD_NAME);
                })();
              `)({
              CHILD,
              CLASS_EXPRESSION,
              PARENT: t.identifier(PARENT.name),
              CHILD_NAME
            });
        } else {
            var PARENTID = path.scope.generateUidIdentifier('parent');
            var CLASS_EXPRESSION = t.classDeclaration(
              CHILD,
              PARENTID,
              path.node.body,
              path.node.decorators || []
            );
            
            traverse(CLASS_EXPRESSION, {
                Identifier({ node }, state) {
                    if (node.name === childClassName) {
                        node.name = CHILD.name;
                    }
                },
                Scope(path, state) {
                    if ( !path.scope.bindingIdentifierEquals(childClassName, binding.identifier) ) {
                        path.skip();
                    }
                }
            }, path.scope);
            
            // Don't transform *this* class expression, or we'll loop forever
            CLASS_EXPRESSION[SKIP] = true;

            return template(`
                (function(){
                    var PARENTID = PARENT;
                    CLASS_EXPRESSION;
                    return __babelPluginTransformClassExtendedHook(CHILD, PARENTID, CHILD_NAME);
                })();
              `)({
              CHILD,
              CLASS_EXPRESSION,
              PARENTID,
              PARENT,
              CHILD_NAME
            });
        }
    }
    
    return {
        visitor: {
            "ClassDeclaration|ClassExpression"(path, state) {
                if (!path.node.superClass) return;
                if (path.node[SKIP]) return;
                addHelperToFile(state.file);
                
                var childClassName = getChildName(path);
                var expressionStatement = transform(childClassName, path);
            
                if (path.parent.type === 'ExportDefaultDeclaration') {
                    path.parentPath.insertBefore(
                        t.variableDeclaration(
                            "var", [
                                t.variableDeclarator(
                                    t.identifier(childClassName),
                                    expressionStatement.expression
                                )
                            ]
                        )
                    );
                    path.replaceWith(t.identifier(childClassName));
                } else if (t.isClassDeclaration(path.node)) {
                    path.replaceWith(t.variableDeclaration(
                        "let",
                        [
                            t.variableDeclarator(
                                t.identifier(childClassName),
                                expressionStatement.expression
                            )
                        ]
                    ));
                } else if (t.isClassExpression(path.node)) {
                    path.replaceWith(expressionStatement.expression);
                }
            }
        }
    };
};
