#!/usr/bin/env -S deno run -A

import { 
  Application, 
  type ProjectReflection, 
  type DeclarationReflection, 
  type Type,
  ReferenceType,
  UnionType,
  ArrayType,
  IntrinsicType,
  ReflectionType,
  TupleType,
  ConditionalType,
  MappedType,
  IndexedAccessType,
  TypeOperatorType,
  QueryType,
  NamedTupleMember,
} from 'typedoc';
import * as path from 'jsr:@std/path';
import { ensureDir } from 'jsr:@std/fs';

// Directory where generated API documentation will be stored
const API_DOCS_DIR = path.join('docs', 'docs', 'api');

/**
 * Represents inheritance information for a declaration.
 *
 * - `extends`: Array of parent types this declaration extends, each with a name and documentation link.
 * - `implements`: Array of interfaces this declaration implements, each with a name and documentation link.
 */
interface InheritanceInfo {
  extends: Array<{ name: string; link: string }>;
  implements: Array<{ name: string; link: string }>;
}

/**
 * Represents the categorized API elements extracted from a TypeScript module.
 *
 * - `classes`: Array of class declarations found in the module.
 * - `interfaces`: Array of interface declarations found in the module.
 * - `functions`: Array of function declarations found in the module.
 * - `types`: Array of type alias declarations found in the module.
 * - `moduleName`: The name of the module (usually derived from the file path).
 * - `moduleComment`: The documentation comment associated with the module, if any.
 */
interface ApiElements {
  classes: DeclarationReflection[];
  interfaces: DeclarationReflection[];
  functions: DeclarationReflection[];
  types: DeclarationReflection[];
  moduleName: string;
  moduleComment: string;
}

/**
 * Clean the docs directory and prepare for new files
 */
async function cleanOutputDirectory(): Promise<void> {
  console.log('🗂️ Cleaning API docs directory...');
  try {
    await Deno.remove(API_DOCS_DIR, { recursive: true });
  } catch {
    // Directory might not exist, that's fine
  }
  await ensureDir(API_DOCS_DIR);
  await ensureDir(path.join(API_DOCS_DIR, 'classes'));
  await ensureDir(path.join(API_DOCS_DIR, 'interfaces'));
  await ensureDir(path.join(API_DOCS_DIR, 'types'));
}

/**
 * Extract API elements from a TypeScript file using TypeDoc
 */
async function extractApiElements(filePath: string): Promise<ApiElements> {
  console.log(`🔍 Extracting API elements from ${filePath}...`);

  const app = await Application.bootstrap({
    entryPoints: [filePath],
    entryPointStrategy: 'expand',
    tsconfig: './tsconfig.json',
    excludeExternals: false,
    excludePrivate: true,
    skipErrorChecking: true,
    plugin: [],
  });

  const project = await app.convert();
  if (!project) {
    throw new Error(`Failed to convert ${filePath}`);
  }

  const elements: ApiElements = {
    classes: [],
    interfaces: [],
    functions: [],
    types: [],
    moduleName: getModuleName(filePath),
    moduleComment: extractModuleComment(project),
  };

  // Process all children (exported items)
  for (const child of project.children || []) {
    if (child.flags?.isPrivate) continue;

    // Skip external modules (node_modules, etc.)
    const source = child.sources?.[0]?.fileName;
    if (
      source &&
      (source.includes('node_modules') || source.includes('jsr:') ||
        source.includes('npm:'))
    ) {
      continue;
    }

    switch (child.kind) {
      case 128: // Class
        elements.classes.push(child);
        break;
      case 256: // Interface
        elements.interfaces.push(child);
        break;
      case 64: // Function
        elements.functions.push(child);
        break;
      case 2097152: // TypeAlias (in newer TypeDoc versions)
      case 4194304: // TypeAlias (in older TypeDoc versions)
        elements.types.push(child);
        break;
    }
  }

  // Phase 2: With expand strategy, all types should be discovered automatically

  console.log(
    `   Found: ${elements.classes.length} classes, ${elements.interfaces.length} interfaces, ${elements.functions.length} functions, ${elements.types.length} types`,
  );
  
  return elements;
}

/**
 * Get a clean module name from file path
 */
function getModuleName(filePath: string): string {
  if (filePath === 'mod.ts') return 'Core';
  if (filePath === 'server/mod.ts') return 'Server';
  if (filePath === 'react/hooks.ts') return 'React';
  return path.basename(filePath, '.ts');
}

/**
 * Extract module-level documentation comment
 */
function extractModuleComment(project: ProjectReflection): string {
  const comment = project.comment;
  if (!comment?.summary) return '';
  return comment.summary.map((part) => part.text).join('').trim();
}

/**
 * Extract documentation text from a TypeDoc comment
 */
function extractDocumentation(element: DeclarationReflection): string {
  // Try element comment first (classes, interfaces, etc.)
  let comment = element.comment;

  // For functions, try the signature comment
  if (!comment && element.signatures?.[0]?.comment) {
    comment = element.signatures[0].comment;
  }

  if (!comment?.summary) return '';
  const text = comment.summary.map((part) => part.text).join('').trim();

  // Escape angle brackets that could be mistaken for HTML tags in MDX
  // Only escape < followed by word characters (potential HTML tags)
  let escapedText = text.replace(/<(\w)/g, '\\<$1').replace(/(\w)>/g, '$1\\>');
  
  // Escape mathematical expressions that could be parsed as markdown links
  // Pattern: number/letter followed by [content](content)
  escapedText = escapedText.replace(/(\w+)\[([^\]]+)\]\(([^)]+)\)/g, '$1\\[$2\\]\\($3\\)');
  
  return escapedText;
}

/**
 * Build a cross-reference map of all API elements for linking
 */
function buildCrossReferenceMap(allElements: ApiElements[]): Map<string, string> {
  const crossRefMap = new Map<string, string>();

  // Only map actually discovered and documented types
  for (const elements of allElements) {
    // Map classes
    for (const cls of elements.classes) {
      crossRefMap.set(cls.name, `./classes/${cls.name.toLowerCase()}`);
    }

    // Map interfaces
    for (const iface of elements.interfaces) {
      crossRefMap.set(iface.name, `./interfaces/${iface.name.toLowerCase()}`);
    }

    // Map types
    for (const type of elements.types) {
      crossRefMap.set(type.name, `./types/${type.name.toLowerCase()}`);
    }
  }

  return crossRefMap;
}



/**
 * Build reverse inheritance map for parent->child relationships
 */
function buildReverseInheritanceMap(allElements: ApiElements[]): Map<string, string[]> {
  const reverseMap = new Map<string, string[]>();

  for (const elements of allElements) {
    // Process classes
    for (const cls of elements.classes) {
      const inheritance = extractInheritanceInfo(cls);

      // Add this class as a child of its parent classes
      for (const parent of inheritance.extends) {
        if (!reverseMap.has(parent.name)) {
          reverseMap.set(parent.name, []);
        }
        reverseMap.get(parent.name)!.push(cls.name);
      }
    }

    // Process interfaces
    for (const iface of elements.interfaces) {
      const inheritance = extractInheritanceInfo(iface);

      // Add this interface as a child of its parent interfaces
      for (const parent of inheritance.extends) {
        if (!reverseMap.has(parent.name)) {
          reverseMap.set(parent.name, []);
        }
        reverseMap.get(parent.name)!.push(iface.name);
      }
    }
  }

  return reverseMap;
}

/**
 * Extract inheritance information from a class or interface
 */
function extractInheritanceInfo(element: DeclarationReflection): InheritanceInfo {
  const inheritance: InheritanceInfo = {
    extends: [],
    implements: [],
  };

  // Extract extended types (parent classes/interfaces)
  if (element.extendedTypes) {
    for (const extendedType of element.extendedTypes) {
      if (extendedType.type === 'reference' && extendedType.name) {
        // Skip TypeScript utility types - they shouldn't be linked
        const TYPESCRIPT_UTILITY_TYPES = new Set([
          'Omit', 'Pick', 'Partial', 'Required', 'Record', 'Exclude', 'Extract', 
          'NonNullable', 'Parameters', 'ConstructorParameters', 'ReturnType', 
          'InstanceType', 'ThisParameterType', 'OmitThisParameter'
        ]);
        if (TYPESCRIPT_UTILITY_TYPES.has(extendedType.name)) {
          continue;
        }
        
        // For classes extending classes, or interfaces extending interfaces
        const isInterface = element.kind === 256; // Interface kind
        const linkPath = isInterface
          ? `./${extendedType.name.toLowerCase()}`
          : `./${extendedType.name.toLowerCase()}`;

        inheritance.extends.push({
          name: extendedType.name,
          link: linkPath,
        });
      }
    }
  }

  // Extract implemented interfaces (for classes)
  if (element.implementedTypes) {
    for (const implementedType of element.implementedTypes) {
      if (implementedType.type === 'reference' && implementedType.name) {
        inheritance.implements.push({
          name: implementedType.name,
          link: `../interfaces/${implementedType.name.toLowerCase()}`,
        });
      }
    }
  }

  return inheritance;
}

/**
 * Separate own members from inherited members
 */
function separateMembers(
  element: DeclarationReflection,
): { ownMembers: DeclarationReflection[]; inheritedMembers: Map<string, DeclarationReflection[]> } {
  const ownMembers: DeclarationReflection[] = [];
  const inheritedMembers: Map<string, DeclarationReflection[]> = new Map();

  for (const child of element.children || []) {
    if (child.inheritedFrom) {
      // Extract parent class name - inheritedFrom may be nested
      let parentName = child.inheritedFrom.name;

      // Handle cases where inheritedFrom might reference a method like "Emitter.attach"
      if (parentName && parentName.includes('.')) {
        parentName = parentName.split('.')[0];
      }

      if (!inheritedMembers.has(parentName)) {
        inheritedMembers.set(parentName, []);
      }
      inheritedMembers.get(parentName)!.push(child);
    } else {
      ownMembers.push(child);
    }
  }

  return { ownMembers, inheritedMembers };
}

/**
 * Format a type with cross-reference links
 */
function formatLinkedType(type: Type | undefined, crossRefMap: Map<string, string>): string {
  if (!type) return 'any';

  switch (type.type) {
    case 'intrinsic':
      if (type instanceof IntrinsicType) {
        return type.name || throwTypeError('intrinsic type missing name', type);
      }
      return 'any';

    case 'reference': {
      if (type instanceof ReferenceType) {
        const typeName = type.name || throwTypeError('reference type missing name', type);
        
        // Don't link TypeScript utility types - render as inline code
        const TYPESCRIPT_UTILITY_TYPES = new Set([
          'Omit', 'Pick', 'Partial', 'Required', 'Record', 'Exclude', 'Extract', 
          'NonNullable', 'Parameters', 'ConstructorParameters', 'ReturnType', 
          'InstanceType', 'ThisParameterType', 'OmitThisParameter'
        ]);
        if (TYPESCRIPT_UTILITY_TYPES.has(typeName)) {
          const typeArgs = type.typeArguments
            ? `<${type.typeArguments.map((t: Type) => formatLinkedType(t, crossRefMap)).join(', ')}>`
            : '';
          return `\`${typeName}${typeArgs}\``;
        }
        
        // Don't link single-letter generic types (like T, U, N, etc.)
        if (typeName.length === 1 && /[A-Z]/.test(typeName)) {
          return typeName;
        }
        
        const link = crossRefMap.get(typeName);
        const linkedName = link ? `[${typeName}](${link})` : `\`${typeName}\``;
        const typeArgs = type.typeArguments
          ? `<${type.typeArguments.map((t: Type) => formatLinkedType(t, crossRefMap)).join(', ')}>`
          : '';
        return linkedName + typeArgs;
      }
      return 'any';
    }

    case 'union':
      if (type instanceof UnionType) {
        return type.types.map((t: Type) => formatLinkedType(t, crossRefMap)).join(' | ');
      }
      return 'any';

    case 'intersection':
      if (type instanceof UnionType) { // UnionType is used for both union and intersection
        return type.types.map((t: Type) => formatLinkedType(t, crossRefMap)).join(' & ');
      }
      return 'any';

    case 'array':
      if (type instanceof ArrayType) {
        return `${formatLinkedType(type.elementType, crossRefMap)}[]`;
      }
      return 'any[]';

    case 'tuple':
      if (type instanceof TupleType) {
        return `[${type.elements.map((t: Type) => formatLinkedType(t, crossRefMap)).join(', ')}]`;
      }
      return 'any[]';

    case 'namedTupleMember':
      if (type instanceof NamedTupleMember) {
        const elementType = formatLinkedType(type.element, crossRefMap);
        const optionalMarker = type.isOptional ? '?' : '';
        return `${type.name}${optionalMarker}: ${elementType}`;
      }
      return 'any';

    case 'literal':
      if (type instanceof IntrinsicType) {
        return JSON.stringify(type.name);
      }
      return 'any';

    case 'typeOperator':
      if (type instanceof TypeOperatorType) {
        const target = formatLinkedType(type.target, crossRefMap);
        return `${type.operator} ${target}`;
      }
      return 'any';

    case 'indexedAccess':
      if (type instanceof IndexedAccessType) {
        const objectType = formatLinkedType(type.objectType, crossRefMap);
        const indexType = formatLinkedType(type.indexType, crossRefMap);
        return `${objectType}[${indexType}]`;
      }
      return 'any';

    case 'conditional':
      if (type instanceof ConditionalType) {
        const checkType = formatLinkedType(type.checkType, crossRefMap);
        const extendsType = formatLinkedType(type.extendsType, crossRefMap);
        const trueType = formatLinkedType(type.trueType, crossRefMap);
        const falseType = formatLinkedType(type.falseType, crossRefMap);
        return `${checkType} extends ${extendsType} ? ${trueType} : ${falseType}`;
      }
      return 'any';

    case 'mapped':
      if (type instanceof MappedType) {
        const parameterType = formatLinkedType(type.parameterType, crossRefMap);
        const templateType = formatLinkedType(type.templateType, crossRefMap);
        return `{ [${type.parameter} in ${parameterType}]: ${templateType} }`;
      }
      return 'any';

    case 'query':
      if (type instanceof QueryType) {
        const queryType = formatLinkedType(type.queryType, crossRefMap);
        return `typeof ${queryType}`;
      }
      return 'any';

    case 'reflection':
      if (type instanceof ReflectionType) {
        // For reflection types (inline object/function definitions), show a simplified representation
        if (type.declaration?.signatures?.[0]) {
          // Function type
          const sig = type.declaration.signatures[0];
          const params = sig.parameters?.map((p) => {
            const paramType = p.type ? formatLinkedType(p.type, crossRefMap) : 'any';
            return `${p.name}: ${paramType}`;
          }).join(', ') || '';
          const returnType = sig.type ? formatLinkedType(sig.type, crossRefMap) : 'void';
          return `(${params}) => ${returnType}`;
        } else if (type.declaration?.children) {
          // Object type
          const properties = type.declaration.children
            .filter((child) => !child.flags?.isPrivate)
            .map((child) => {
              const propType = child.type ? formatLinkedType(child.type, crossRefMap) : 'any';
              return `${child.name}: ${propType}`;
            });
          return properties.length > 0 ? `{ ${properties.join('; ')} }` : '{}';
        }
      }
      return 'object';

    default:
      throwTypeError(`unhandled type "${type.type}"`, type);
  }
}

/**
 * Throws a descriptive error for unhandled type cases
 */
function throwTypeError(message: string, type: Type): never {
  const debugInfo = {
    type: type.type,
    constructor: type.constructor.name,
    keys: Object.keys(type)
  };
  
  throw new Error(`TypeDoc type parsing error: ${message}. Type info: ${JSON.stringify(debugInfo, null, 2)}`);
}


/**
 * Format a function signature with cross-reference links
 */
function formatLinkedTypeSignature(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
): string {
  if (!element.signatures?.[0]) return '';

  const sig = element.signatures[0];
  const params = sig.parameters?.map((p) => {
    const type = p.type ? formatLinkedType(p.type, crossRefMap) : 'any';
    return `${p.name}: ${type}`;
  }).join(', ') || '';

  const returnType = sig.type
    ? formatLinkedType(sig.type, crossRefMap)
    : 'void';
  
  const signature = `${element.name}(${params}): ${returnType}`;
  
  // Escape problematic characters to prevent MDX parsing issues
  return signature
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

/**
 * Generate MDX content for a class
 */
function createClassMDX(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
  reverseInheritanceMap: Map<string, string[]>,
): string {
  const name = element.name;
  const doc = extractDocumentation(element);
  const inheritance = extractInheritanceInfo(element);
  const { ownMembers, inheritedMembers } = separateMembers(element);

  let content = `---
title: ${name}
sidebar_label: ${name}
---

# ${name}

`;

  if (doc) {
    content += `${doc}\n\n`;
  }

  // Show inheritance
  if (inheritance.extends.length > 0) {
    const extendsLinks = inheritance.extends.map((parent) =>
      `[${parent.name}](${parent.link})`
    ).join(', ');
    content += `**Extends:** ${extendsLinks}\n\n`;
  }

  if (inheritance.implements.length > 0) {
    const implementsLinks = inheritance.implements.map((iface) =>
      `[${iface.name}](${iface.link})`
    ).join(', ');
    content += `**Implements:** ${implementsLinks}\n\n`;
  }

  // Show subclasses (classes that extend this class)
  const subclasses = reverseInheritanceMap.get(name);
  if (subclasses && subclasses.length > 0) {
    const subclassLinks = subclasses.map((subclass) =>
      `[${subclass}](./${subclass.toLowerCase()})`
    ).join(', ');
    content += `**Subclasses:** ${subclassLinks}\n\n`;
  }

  // Constructor (always own, never inherited)
  const constructor = ownMembers.find((c) => c.kind === 512); // Constructor
  if (constructor?.signatures?.[0]) {
    content += `## Constructor\n\n`;
    const sig = constructor.signatures[0];
    const params = sig.parameters?.map((p) => {
      const type = p.type ? formatLinkedType(p.type, crossRefMap) : 'any';
      return `${p.name}: ${type}`;
    }).join(', ') || '';
    const constructorSig = `new ${name}(${params})`;
    content += `**${constructorSig.replace(/</g, '\\<').replace(/>/g, '\\>').replace(/\{/g, '\\{').replace(/\}/g, '\\}')}**\n\n`;

    if (sig.comment?.summary) {
      content += sig.comment.summary.map((s) => s.text).join('') + '\n\n';
    }
  }

  // Own methods
  const ownMethods = ownMembers.filter((c) => c.kind === 2048); // Method
  if (ownMethods.length > 0) {
    content += `## Methods\n\n`;
    for (const method of ownMethods) {
      if (method.flags?.isPrivate) continue;
      content += `### ${method.name}()\n\n`;

      if (method.signatures?.[0]) {
        const sig = formatLinkedTypeSignature(method, crossRefMap);
        content += `**${sig}**\n\n`;
      }

      const methodDoc = extractDocumentation(method);
      if (methodDoc) {
        content += `${methodDoc}\n\n`;
      }
    }
  }

  // Inherited methods
  if (inheritedMembers.size > 0) {
    content += `## Inherited Methods\n\n`;
    for (const [parentName, members] of inheritedMembers) {
      const parentLink = `./${parentName.toLowerCase()}`;
      content += `### From [${parentName}](${parentLink})\n\n`;

      const methods = members.filter((m) =>
        m.kind === 2048 && !m.flags?.isPrivate
      );
      if (methods.length > 0) {
        const methodNames = methods.map((m) => `\`${m.name}()\``).join(
          ', ',
        );
        content += `${methodNames}\n\n`;
        content +=
          `*See [${parentName}](${parentLink}) for detailed documentation*\n\n`;
      }
    }
  }

  return content;
}

/**
 * Generate MDX content for an interface
 */
function createInterfaceMDX(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
  reverseInheritanceMap: Map<string, string[]>,
): string {
  const name = element.name;
  const doc = extractDocumentation(element);
  const inheritance = extractInheritanceInfo(element);
  const { ownMembers, inheritedMembers } = separateMembers(element);

  let content = `---
title: ${name}
sidebar_label: ${name}
---

# ${name}

`;

  if (doc) {
    content += `${doc}\n\n`;
  }

  // Show inheritance (interfaces extend other interfaces)
  if (inheritance.extends.length > 0) {
    const extendsLinks = inheritance.extends.map((parent) =>
      `[${parent.name}](./${parent.name.toLowerCase()})`
    ).join(', ');
    content += `**Extends:** ${extendsLinks}\n\n`;
  }

  // Show subinterfaces (interfaces that extend this interface)
  const subinterfaces = reverseInheritanceMap.get(name);
  if (subinterfaces && subinterfaces.length > 0) {
    const subinterfaceLinks = subinterfaces.map((subinterface) =>
      `[${subinterface}](./${subinterface.toLowerCase()})`
    ).join(', ');
    content += `**Extended by:** ${subinterfaceLinks}\n\n`;
  }

  // Own properties
  const ownProperties = ownMembers.filter((c) => c.kind === 1024); // Property
  if (ownProperties.length > 0) {
    content += `## Properties\n\n`;
    for (const prop of ownProperties) {
      const type = prop.type ? formatLinkedType(prop.type, crossRefMap) : 'any';
      content += `### ${prop.name}\n\n`;
      const propSig = `${prop.name}: ${type}`;
      content += `\`\`\`typescript\n${propSig.replace(/</g, '\\<').replace(/>/g, '\\>').replace(/\{/g, '\\{').replace(/\}/g, '\\}')}\n\`\`\`\n\n`;

      const propDoc = extractDocumentation(prop);
      if (propDoc) {
        content += `${propDoc}\n\n`;
      }
    }
  }

  // Own methods (interfaces can have method signatures)
  const ownMethods = ownMembers.filter((c) => c.kind === 2048); // Method
  if (ownMethods.length > 0) {
    content += `## Methods\n\n`;
    for (const method of ownMethods) {
      content += `### ${method.name}()\n\n`;

      if (method.signatures?.[0]) {
        const sig = formatLinkedTypeSignature(method, crossRefMap);
        content += `**${sig}**\n\n`;
      }

      const methodDoc = extractDocumentation(method);
      if (methodDoc) {
        content += `${methodDoc}\n\n`;
      }
    }
  }

  // Inherited properties and methods
  if (inheritedMembers.size > 0) {
    content += `## Inherited Members\n\n`;
    for (const [parentName, members] of inheritedMembers) {
      // Skip TypeScript utility types in inherited members
      const TYPESCRIPT_UTILITY_TYPES = new Set([
        'Omit', 'Pick', 'Partial', 'Required', 'Record', 'Exclude', 'Extract', 
        'NonNullable', 'Parameters', 'ConstructorParameters', 'ReturnType', 
        'InstanceType', 'ThisParameterType', 'OmitThisParameter'
      ]);
      if (TYPESCRIPT_UTILITY_TYPES.has(parentName)) {
        continue;
      }
      
      const parentLink = `../interfaces/${parentName.toLowerCase()}`;
      content += `### From [${parentName}](${parentLink})\n\n`;

      const properties = members.filter((m) => m.kind === 1024);
      const methods = members.filter((m) => m.kind === 2048);

      if (properties.length > 0) {
        const propNames = properties.map((p) => `\`${p.name}\``).join(
          ', ',
        );
        content += `**Properties:** ${propNames}\n\n`;
      }

      if (methods.length > 0) {
        const methodNames = methods.map((m) => `\`${m.name}()\``).join(
          ', ',
        );
        content += `**Methods:** ${methodNames}\n\n`;
      }

      content +=
        `*See [${parentName}](${parentLink}) for detailed documentation*\n\n`;
    }
  }

  return content;
}

/**
 * Generate MDX content for functions
 */
function createFunctionsMDX(
  functions: DeclarationReflection[],
  moduleName: string,
  crossRefMap: Map<string, string>,
): string {
  let content = `---
title: ${moduleName} Functions
---

# ${moduleName} Functions

`;

  for (const fn of functions) {
    content += `## ${fn.name}\n\n`;

    if (fn.signatures?.[0]) {
      const sig = formatLinkedTypeSignature(fn, crossRefMap);
      content += `**${sig}**\n\n`;
    }

    const doc = extractDocumentation(fn);
    if (doc) {
      content += `${doc}\n\n`;
    }
  }

  return content;
}

/**
 * Generate MDX content for a type alias
 */
function createTypeMDX(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
): string {
  const name = element.name;
  const doc = extractDocumentation(element);

  let content = `---
title: ${name}
sidebar_label: ${name}
---

# ${name}

`;

  if (doc) {
    content += `${doc}\n\n`;
  }

  // Show the type definition
  if (element.type) {
    const interactiveType = formatLinkedType(element.type, crossRefMap);
    
    // Escape the interactive type for MDX compatibility
    const escapedInteractiveType = interactiveType
      .replace(/</g, '\\<')
      .replace(/>/g, '\\>')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}');
    
    content += `## Definition\n\n`;
    content += `**Type:** \`${name}\` = ${escapedInteractiveType}\n\n`;
  }

  return content;
}


/**
 * Write all API files to disk
 */
async function writeApiFiles(allElements: ApiElements[]): Promise<void> {
  console.log('📝 Writing API documentation files...');

  // Build cross-reference map for linking
  const crossRefMap = buildCrossReferenceMap(allElements);

  // Build reverse inheritance map for parent->child relationships
  const reverseInheritanceMap = buildReverseInheritanceMap(allElements);

  // Write individual class files
  for (const elements of allElements) {
    for (const cls of elements.classes) {
      const mdx = createClassMDX(cls, crossRefMap, reverseInheritanceMap);
      const filename = `${cls.name.toLowerCase()}.mdx`;
      await Deno.writeTextFile(
        path.join(API_DOCS_DIR, 'classes', filename),
        mdx,
      );
    }

    // Write individual interface files
    for (const iface of elements.interfaces) {
      const mdx = createInterfaceMDX(iface, crossRefMap, reverseInheritanceMap);
      const filename = `${iface.name.toLowerCase()}.mdx`;
      await Deno.writeTextFile(
        path.join(API_DOCS_DIR, 'interfaces', filename),
        mdx,
      );
    }

    // Write individual type files
    for (const type of elements.types) {
      const mdx = createTypeMDX(type, crossRefMap);
      const filename = `${type.name.toLowerCase()}.mdx`;
      await Deno.writeTextFile(
        path.join(API_DOCS_DIR, 'types', filename),
        mdx,
      );
    }

    // Write functions file for this module
    if (elements.functions.length > 0) {
      const mdx = createFunctionsMDX(
        elements.functions,
        elements.moduleName,
        crossRefMap,
      );
      const filename = `functions-${elements.moduleName.toLowerCase()}.mdx`;
      await Deno.writeTextFile(path.join(API_DOCS_DIR, filename), mdx);
    }
  }

}

/**
 * Generate the main index page
 */
async function writeIndexPage(allElements: ApiElements[]): Promise<void> {
  console.log('📄 Writing API index page...');

  let content = `---
sidebar_position: 1
title: API Reference
---

# API Reference

Complete API documentation for GoatDB.\n\n`;

  for (const elements of allElements) {
    if (
      elements.classes.length === 0 && elements.interfaces.length === 0 &&
      elements.functions.length === 0 && elements.types.length === 0
    ) {
      continue;
    }

    content += `## ${elements.moduleName}\n\n`;

    if (elements.moduleComment) {
      content += `${elements.moduleComment}\n\n`;
    }

    // Classes
    if (elements.classes.length > 0) {
      content += `### Classes\n\n`;
      for (const cls of elements.classes) {
        const doc = extractDocumentation(cls).split('\n')[0] ||
          'No description';
        const filename = cls.name.toLowerCase();
        content += `- **[${cls.name}](./classes/${filename})** - ${doc}\n`;
      }
      content += '\n';
    }

    // Interfaces
    if (elements.interfaces.length > 0) {
      content += `### Interfaces\n\n`;
      for (const iface of elements.interfaces) {
        const doc = extractDocumentation(iface).split('\n')[0] ||
          'No description';
        const filename = iface.name.toLowerCase();
        content += `- **[${iface.name}](./interfaces/${filename})** - ${doc}\n`;
      }
      content += '\n';
    }

    // Types
    if (elements.types.length > 0) {
      content += `### Types\n\n`;
      for (const type of elements.types) {
        const doc = extractDocumentation(type).split('\n')[0] ||
          'No description';
        const filename = type.name.toLowerCase();
        content += `- **[${type.name}](./types/${filename})** - ${doc}\n`;
      }
      content += '\n';
    }

    // Functions
    if (elements.functions.length > 0) {
      content += `### Functions\n\n`;
      const moduleFile = elements.moduleName.toLowerCase();
      content +=
        `See [${elements.moduleName} Functions](./functions-${moduleFile}) for all exported functions.\n\n`;
    }
  }

  await Deno.writeTextFile(path.join(API_DOCS_DIR, 'index.mdx'), content);
}

/**
 * Main function - orchestrates the entire documentation build process
 */
export async function buildApiDocs(): Promise<void> {
  console.log('🚀 Building API documentation...');

  // Step 1: Prepare output directory
  await cleanOutputDirectory();

  // Step 2: Extract API elements from each entry point
  const entryPoints = ['mod.ts', 'server/mod.ts', 'react/hooks.ts', 'cfds/base/schema.ts'];
  const allElements: ApiElements[] = [];

  for (const entryPoint of entryPoints) {
    try {
      const elements = await extractApiElements(entryPoint);
      allElements.push(elements);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Failed to process ${entryPoint}: ${errorMessage}`);
    }
  }

  if (allElements.length === 0) {
    throw new Error('No API elements extracted from any entry point');
  }

  // Step 3: Write all documentation files
  await writeApiFiles(allElements);

  // Step 4: Generate the index page
  await writeIndexPage(allElements);

  console.log('✅ API documentation generated successfully!');
  console.log(`📁 Output: ${API_DOCS_DIR}`);
}

// Run if this file is executed directly
if (import.meta.main) {
  try {
    await buildApiDocs();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error building API documentation:', errorMessage);
    Deno.exit(1);
  }
}
