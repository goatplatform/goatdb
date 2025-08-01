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
 * - `extends`: Array of parent types this declaration extends, each with a name
 *   and a link to the parent type.
 * - `implements`: Array of interfaces this declaration implements, each with a name
 *   and a link to the interface.
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
 * - `moduleComment`: The documentation comment associated with the module, if
 *    any.
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
 * Extracts categorized API elements (classes, interfaces, functions, types)
 * from a TypeScript file using TypeDoc. Filters out private and external
 * (node_modules, jsr:, npm:) exports.
 *
 * @param filePath - Path to the TypeScript file to analyze.
 * @returns An ApiElements object containing discovered API elements and module
 *          metadata.
 */
async function extractApiElements(filePath: string): Promise<ApiElements> {
  console.log(`🔍 Extracting API elements from ${filePath}...`);

  // Initialize TypeDoc application for the given file
  const app = await Application.bootstrap({
    entryPoints: [filePath],
    entryPointStrategy: 'expand',
    tsconfig: './tsconfig.json',
    excludeExternals: false,
    excludePrivate: true,
    skipErrorChecking: true,
    plugin: [],
  });

  // Convert the project to a TypeDoc reflection tree
  const project = await app.convert();
  if (!project) {
    throw new Error(`Failed to convert ${filePath}`);
  }

  // Prepare the result structure
  const elements: ApiElements = {
    classes: [],
    interfaces: [],
    functions: [],
    types: [],
    moduleName: getModuleName(filePath),
    moduleComment: extractModuleComment(project),
  };

  // Iterate over all top-level exported children
  for (const child of project.children || []) {
    // Skip private members
    if (child.flags?.isPrivate) continue;

    // Skip items from external sources (node_modules, jsr:, npm:)
    const source = child.sources?.[0]?.fileName;
    if (
      source &&
      (source.includes('node_modules') ||
        source.includes('jsr:') ||
        source.includes('npm:'))
    ) {
      continue;
    }

    // Categorize by TypeDoc kind
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
      case 2097152: // TypeAlias (TypeDoc >=0.23)
      case 4194304: // TypeAlias (older TypeDoc)
        elements.types.push(child);
        break;
    }
  }

  // Log summary of discovered elements
  console.log(
    `   Found: ${elements.classes.length} classes, ${elements.interfaces.length} interfaces, ${elements.functions.length} functions, ${elements.types.length} types`,
  );

  return elements;
}


/**
 * Returns a human-friendly module name for a given file path.
 *
 * - "mod.ts"           → "Core"
 * - "server/mod.ts"    → "Server"
 * - "react/hooks.ts"   → "React"
 * - Otherwise, returns the file name (without ".ts" extension)
 */
function getModuleName(filePath: string): string {
  if (filePath === 'mod.ts') return 'Core';
  if (filePath === 'server/mod.ts') return 'Server';
  if (filePath === 'react/hooks.ts') return 'React';
  return path.basename(filePath, '.ts');
}

/**
 * Extracts the module-level documentation comment from a TypeDoc project.
 *
 * @param project - The TypeDoc project to extract the comment from.
 * @returns The module-level documentation comment, or an empty string if no
 *          comment is found.
 */
function extractModuleComment(project: ProjectReflection): string {
  const comment = project.comment;
  if (!comment?.summary) return '';
  return comment.summary.map((part) => part.text).join('').trim();
}

/**
 * Extracts documentation text from a TypeDoc comment.
 *
 * @param element - The TypeDoc element to extract the documentation from.
 * @returns The documentation text, or an empty string if no documentation is
 *          found.
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
  
  // Escape curly braces that could be mistaken for JSX expressions in MDX
  escapedText = escapedText.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  
  return escapedText;
}

/**
 * Builds a cross-reference map of all API elements for linking.
 *
 * @param allElements - An array of ApiElements objects containing the API
 *                      elements to build the cross-reference map for.
 * @returns A Map of element names to their corresponding file paths.
 */
function buildCrossReferenceMap(allElements: ApiElements[]): Map<string, string> {
  const crossRefMap = new Map<string, string>();

  // Only map actually discovered and documented types
  for (const elements of allElements) {
    // Map classes - use absolute paths from API root
    for (const cls of elements.classes) {
      crossRefMap.set(cls.name, `/api/classes/${cls.name.toLowerCase()}`);
    }

    // Map interfaces - use absolute paths from API root
    for (const iface of elements.interfaces) {
      crossRefMap.set(iface.name, `/api/interfaces/${iface.name.toLowerCase()}`);
    }

    // Map types - use absolute paths from API root
    for (const type of elements.types) {
      crossRefMap.set(type.name, `/api/types/${type.name.toLowerCase()}`);
    }
  }

  return crossRefMap;
}



/**
 * Builds a reverse inheritance map for parent->child relationships.
 *
 * @param allElements - An array of ApiElements objects containing the API
 *                      elements to build the reverse inheritance map for.
 * @returns A Map of parent element names to their corresponding child
 *          element names.
 */
function buildReverseInheritanceMap(allElements: ApiElements[], crossRefMap: Map<string, string>): Map<string, string[]> {
  const reverseMap = new Map<string, string[]>();

  for (const elements of allElements) {
    // Process classes
    for (const cls of elements.classes) {
      const inheritance = extractInheritanceInfo(cls, crossRefMap);

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
      const inheritance = extractInheritanceInfo(iface, crossRefMap);

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
 * Extracts inheritance information from a class or interface.
 *
 * @param element - The TypeDoc element to extract the inheritance information
 *                  from.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths for proper linking.
 * @returns An InheritanceInfo object containing the inheritance information.
 */
function extractInheritanceInfo(element: DeclarationReflection, crossRefMap: Map<string, string>): InheritanceInfo {
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
        
        // Use crossRefMap to get the correct link path (interfaces, classes, or types)
        const linkPath = crossRefMap.get(extendedType.name) || 
          (element.kind === 256 
            ? `/api/interfaces/${extendedType.name.toLowerCase()}`
            : `/api/classes/${extendedType.name.toLowerCase()}`);


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
        const linkPath = crossRefMap.get(implementedType.name) || 
          `/api/interfaces/${implementedType.name.toLowerCase()}`;
        
        inheritance.implements.push({
          name: implementedType.name,
          link: linkPath,
        });
      }
    }
  }

  return inheritance;
}

/**
 * Separates own members from inherited members.
 *
 * @param element - The TypeDoc element to separate the members from.
 * @returns An object containing two arrays:
 *          - `ownMembers`: An array of own members.
 *          - `inheritedMembers`: A Map of parent element names to their
 *            corresponding child members.
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
 * Formats a type with cross-reference links.
 *
 * @param type - The TypeDoc type to format.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths.
 * @returns The formatted type string.
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
          return `${typeName}${typeArgs}`;
        }
        
        // Don't link single-letter generic types (like T, U, N, etc.)
        if (typeName.length === 1 && /[A-Z]/.test(typeName)) {
          return typeName;
        }
        
        const link = crossRefMap.get(typeName);
        const linkedName = link ? `[${typeName}](${link})` : typeName;
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

    case 'predicate':
      // TypeScript predicate types (e.g., "arg is Type")
      return 'boolean';

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
  
  return `${element.name}(${params}): ${returnType}`;
}

/**
 * Escape content for use inside HTML <code> tags to prevent MDX JSX conflicts
 */
function escapeForCodeTag(content: string): string {
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

/**
 * Generates MDX content for a class.
 *
 * @param element - The TypeDoc element to generate the MDX content for.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths.
 * @param reverseInheritanceMap - A Map of parent element names to their
 *                                corresponding child element names.
 * @returns The MDX content for the class.
 */
function createClassMDX(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
  reverseInheritanceMap: Map<string, string[]>,
): string {
  const name = element.name;
  const doc = extractDocumentation(element);
  const inheritance = extractInheritanceInfo(element, crossRefMap);
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
      `[${subclass}](/api/classes/${subclass.toLowerCase()})`
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
    content += `**<code>${escapeForCodeTag(constructorSig)}</code>**\n\n`;

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
        content += `**<code>${escapeForCodeTag(sig)}</code>**\n\n`;
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
      const parentLink = `/api/classes/${parentName.toLowerCase()}`;
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
 * Generates MDX content for an interface.
 *
 * @param element - The TypeDoc element to generate the MDX content for.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths.
 * @param reverseInheritanceMap - A Map of parent element names to their
 *                                corresponding child element names.
 * @returns The MDX content for the interface.
 */
function createInterfaceMDX(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
  reverseInheritanceMap: Map<string, string[]>,
): string {
  const name = element.name;
  const doc = extractDocumentation(element);
  const inheritance = extractInheritanceInfo(element, crossRefMap);
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
      `[${parent.name}](${parent.link})`
    ).join(', ');
    content += `**Extends:** ${extendsLinks}\n\n`;
  }

  // Show subinterfaces (interfaces that extend this interface)
  const subinterfaces = reverseInheritanceMap.get(name);
  if (subinterfaces && subinterfaces.length > 0) {
    const subinterfaceLinks = subinterfaces.map((subinterface) =>
      `[${subinterface}](/api/interfaces/${subinterface.toLowerCase()})`
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
      content += `\`\`\`typescript\n${propSig}\n\`\`\`\n\n`;

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
        content += `**<code>${escapeForCodeTag(sig)}</code>**\n\n`;
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
      
      const parentLink = `/api/interfaces/${parentName.toLowerCase()}`;
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
 * Generates MDX content for functions.
 *
 * @param functions - An array of TypeDoc function elements to generate the
 *                    MDX content for.
 * @param moduleName - The name of the module to generate the MDX content for.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths.
 * @returns The MDX content for the functions.
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
      content += `**<code>${escapeForCodeTag(sig)}</code>**\n\n`;
    }

    const doc = extractDocumentation(fn);
    if (doc) {
      content += `${doc}\n\n`;
    }
  }

  return content;
}

/**
 * Generates MDX content for a type alias.
 *
 * @param element - The TypeDoc element to generate the MDX content for.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths.
 * @returns The MDX content for the type alias.
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
    
    content += `## Definition\n\n`;
    content += `**Type:** <code>${escapeForCodeTag(`${name} = ${interactiveType}`)}</code>\n\n`;
  } else if (element.children && element.children.length > 0) {
    // Handle interface-like types that have properties as children
    content += `## Definition\n\n`;
    
    const properties = element.children
      .filter((child) => child.kind === 1024) // Property kind
      .map((prop) => {
        const propType = prop.type ? formatLinkedType(prop.type, crossRefMap) : 'any';
        const optional = prop.flags?.isOptional ? '?' : '';
        return `${prop.name}${optional}: ${propType}`;
      })
      .join('; ');
    
    if (properties) {
      const typeDefinition = `${name} = \{ ${properties} \}`;
      content += `**Type:** <code>${escapeForCodeTag(typeDefinition)}</code>\n\n`;
    }
  }

  return content;
}


/**
 * Writes all API files to disk.
 *
 * @param allElements - An array of ApiElements objects containing the API
 *                      elements to write to disk.
 */
async function writeApiFiles(allElements: ApiElements[]): Promise<void> {
  console.log('📝 Writing API documentation files...');

  // Build cross-reference map for linking
  const crossRefMap = buildCrossReferenceMap(allElements);

  // Build reverse inheritance map for parent->child relationships
  const reverseInheritanceMap = buildReverseInheritanceMap(allElements, crossRefMap);

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
 * Generates the main index page.
 *
 * @param allElements - An array of ApiElements objects containing the API
 *                      elements to generate the index page for.
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
 * Discovers all TypeScript entry points that should be included in API documentation.
 * Automatically finds module exports and key type definition files.
 */
async function discoverEntryPoints(): Promise<string[]> {
  console.log('🔍 Discovering API entry points...');
  
  const entryPoints: string[] = [];
  
  // Main module export
  entryPoints.push('mod.ts');
  
  // Discover all mod.ts files (module entry points), but exclude test files
  try {
    for await (const entry of Deno.readDir('.')) {
      if (entry.isDirectory && entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'tests') {
        const modPath = `${entry.name}/mod.ts`;
        try {
          await Deno.stat(modPath);
          entryPoints.push(modPath);
        } catch {
          // File doesn't exist, skip
        }
      }
    }
  } catch (error) {
    console.warn('⚠️  Failed to scan for mod.ts files:', error);
  }
  
  // Core type definitions - these contain fundamental types referenced throughout
  const coreTypeFiles = [
    'base/core-types/index.ts',     // CoreValue, CoreObject, etc.
    'base/core-types/base.ts',      // CoreType enum, Dictionary
    'base/core-types/encoding/index.ts', // Encoder, Decoder, etc.
    'base/core-types/encoding/checksum.ts', // ChecksumEncoderOpts
    'base/core-types/encoding/base-encoder.ts', // BaseEncoder
    'base/interfaces.ts',           // Common interfaces like JSONValue
    'base/common.ts',               // Common types
    'base/bloom.ts',                // BloomFilter
    'base/timer.ts',                // Timer, TimerCallback
    'cfds/base/types/index.ts',     // ValueType, IValueTypeOperations, etc.
    'cfds/base/schema.ts',          // Schema, SchemaDataType, etc.
    'cfds/base/defs.ts',            // Core definitions
    'cfds/change/index.ts',         // Change types
    'cfds/richtext/model.ts',       // RichText, related interfaces
    'cfds/richtext/tree.ts',        // RichTextValue, ElementNode, TextNode
    'repo/commit.ts',               // Commit types
    'repo/repo.ts',                 // Repository types
    'repo/query.ts',                // Query types
    'repo/query-persistance.ts',    // QueryPersistence
    'db/session.ts',                // Session types
    'db/db.ts',                     // Database types
    'db/managed-item.ts',           // ItemConfig
    'server/build-info.ts',         // BuilderInfo
    'net/server/server.ts',         // ServerOptions
    'react/hooks.ts',               // React hooks
  ];
  
  // Add core type files that exist
  for (const file of coreTypeFiles) {
    try {
      await Deno.stat(file);
      entryPoints.push(file);
    } catch {
      console.warn(`⚠️  Core type file not found: ${file}`);
    }
  }
  
  const uniqueEntryPoints = [...new Set(entryPoints)];
  console.log(`   Found ${uniqueEntryPoints.length} entry points:`, uniqueEntryPoints);
  
  return uniqueEntryPoints;
}

/**
 * Validates that all type references in the documentation have corresponding
 * documented types. Throws an error if any references are broken.
 */
async function validateCrossReferences(allElements: ApiElements[]): Promise<void> {
  console.log('🔍 Validating cross-references...');
  
  const crossRefMap = buildCrossReferenceMap(allElements);
  const documentedTypes = new Set<string>();
  const referencedTypes = new Set<string>();
  
  // Collect all documented types
  for (const elements of allElements) {
    elements.classes.forEach(cls => documentedTypes.add(cls.name));
    elements.interfaces.forEach(iface => documentedTypes.add(iface.name));
    elements.types.forEach(type => documentedTypes.add(type.name));
  }
  
  // Collect all referenced types by scanning type information
  for (const elements of allElements) {
    // Scan classes
    for (const cls of elements.classes) {
      scanElementForTypeReferences(cls, referencedTypes);
    }
    
    // Scan interfaces
    for (const iface of elements.interfaces) {
      scanElementForTypeReferences(iface, referencedTypes);
    }
    
    // Scan types
    for (const type of elements.types) {
      scanElementForTypeReferences(type, referencedTypes);
    }
    
    // Scan functions
    for (const fn of elements.functions) {
      scanElementForTypeReferences(fn, referencedTypes);
    }
  }
  
  // Find missing types (referenced but not documented)
  const missingTypes = new Set<string>();
  for (const refType of referencedTypes) {
    if (!documentedTypes.has(refType) && !isBuiltInType(refType)) {
      missingTypes.add(refType);
    }
  }
  
  if (missingTypes.size > 0) {
    console.error(`❌ Found ${missingTypes.size} undocumented type references:`);
    for (const missing of Array.from(missingTypes).sort()) {
      console.error(`   - ${missing}`);
    }
    throw new Error(`API documentation is incomplete. ${missingTypes.size} referenced types are not documented. Add missing entry points or ensure types are properly exported.`);
  }
  
  console.log(`✅ Cross-reference validation passed. ${documentedTypes.size} types documented, ${referencedTypes.size} types referenced.`);
}

/**
 * Scans a TypeDoc element for type references and adds them to the set.
 */
function scanElementForTypeReferences(element: DeclarationReflection, referencedTypes: Set<string>): void {
  // Scan element type
  if (element.type) {
    collectTypeReferences(element.type, referencedTypes);
  }
  
  // Scan inheritance
  if (element.extendedTypes) {
    for (const extType of element.extendedTypes) {
      collectTypeReferences(extType, referencedTypes);
    }
  }
  
  if (element.implementedTypes) {
    for (const implType of element.implementedTypes) {
      collectTypeReferences(implType, referencedTypes);
    }
  }
  
  // Scan children (properties, methods, etc.)
  if (element.children) {
    for (const child of element.children) {
      scanElementForTypeReferences(child, referencedTypes);
    }
  }
  
  // Scan signatures (for functions/methods)
  if (element.signatures) {
    for (const sig of element.signatures) {
      if (sig.type) {
        collectTypeReferences(sig.type, referencedTypes);
      }
      if (sig.parameters) {
        for (const param of sig.parameters) {
          if (param.type) {
            collectTypeReferences(param.type, referencedTypes);
          }
        }
      }
    }
  }
}

/**
 * Recursively collects type references from a TypeDoc Type.
 */
function collectTypeReferences(type: Type, referencedTypes: Set<string>): void {
  switch (type.type) {
    case 'reference':
      if (type instanceof ReferenceType && type.name) {
        referencedTypes.add(type.name);
        if (type.typeArguments) {
          for (const arg of type.typeArguments) {
            collectTypeReferences(arg, referencedTypes);
          }
        }
      }
      break;
      
    case 'union':
    case 'intersection':
      if (type instanceof UnionType) {
        for (const subType of type.types) {
          collectTypeReferences(subType, referencedTypes);
        }
      }
      break;
      
    case 'array':
      if (type instanceof ArrayType) {
        collectTypeReferences(type.elementType, referencedTypes);
      }
      break;
      
    case 'tuple':
      if (type instanceof TupleType) {
        for (const element of type.elements) {
          collectTypeReferences(element, referencedTypes);
        }
      }
      break;
      
    case 'reflection':
      if (type instanceof ReflectionType && type.declaration) {
        scanElementForTypeReferences(type.declaration, referencedTypes);
      }
      break;
      
    case 'conditional':
      if (type instanceof ConditionalType) {
        collectTypeReferences(type.checkType, referencedTypes);
        collectTypeReferences(type.extendsType, referencedTypes);
        collectTypeReferences(type.trueType, referencedTypes);
        collectTypeReferences(type.falseType, referencedTypes);
      }
      break;
      
    case 'mapped':
      if (type instanceof MappedType) {
        collectTypeReferences(type.parameterType, referencedTypes);
        collectTypeReferences(type.templateType, referencedTypes);
      }
      break;
      
    case 'indexedAccess':
      if (type instanceof IndexedAccessType) {
        collectTypeReferences(type.objectType, referencedTypes);
        collectTypeReferences(type.indexType, referencedTypes);
      }
      break;
      
    case 'typeOperator':
      if (type instanceof TypeOperatorType) {
        collectTypeReferences(type.target, referencedTypes);
      }
      break;
      
    case 'query':
      if (type instanceof QueryType) {
        collectTypeReferences(type.queryType, referencedTypes);
      }
      break;
  }
}

/**
 * Checks if a type name is a built-in TypeScript type that doesn't need documentation.
 */
function isBuiltInType(typeName: string): boolean {
  const builtInTypes = new Set([
    // Primitive types
    'string', 'number', 'boolean', 'undefined', 'null', 'void', 'any', 'unknown', 'never',
    'object', 'symbol', 'bigint',
    
    // Built-in objects
    'Array', 'Object', 'Function', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
    'Error', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
    
    // Web APIs / Node.js / Deno built-ins
    'Response', 'Crypto', 'CryptoKey', 'CryptoKeyPair', 'Iterable', 'Generator',
    
    // TypeScript utility types
    'Omit', 'Pick', 'Partial', 'Required', 'Record', 'Exclude', 'Extract',
    'NonNullable', 'Parameters', 'ConstructorParameters', 'ReturnType',
    'InstanceType', 'ThisParameterType', 'OmitThisParameter',
    
    // Single-letter generics
    'T', 'U', 'V', 'K', 'P', 'R', 'S', 'N', 'E',
  ]);
  
  // Built-in types
  if (builtInTypes.has(typeName)) return true;
  
  // Single-letter generics
  if (/^[A-Z]$/.test(typeName)) return true;
  
  // Constants (starting with k)
  if (typeName.startsWith('k')) return true;
  
  // Internal/private types (containing dots, indicating nested access)
  if (typeName.includes('.')) return true;
  
  // Short generic-like names (often internal)
  if (/^[A-Z]{2,3}$/.test(typeName)) return true;
  
  return false;
}

/**
 * Main function - orchestrates the entire documentation build process.
 *
 * @returns A promise that resolves when the documentation build process is
 *          complete.
 */
export async function buildApiDocs(): Promise<void> {
  console.log('🚀 Building API documentation...');

  // Step 1: Prepare output directory
  await cleanOutputDirectory();

  // Step 2: Discover and extract API elements from entry points
  const entryPoints = await discoverEntryPoints();
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

  // Step 3: Validate that all referenced types are documented
  // TODO: Re-enable validation once all types are properly documented
  // await validateCrossReferences(allElements);

  // Step 4: Write all documentation files
  await writeApiFiles(allElements);

  // Step 5: Generate the index page
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
