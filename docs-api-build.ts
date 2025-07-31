#!/usr/bin/env -S deno run -A

import { Application } from 'npm:typedoc@0.25.13';
import * as path from 'jsr:@std/path';
import { ensureDir } from 'jsr:@std/fs';


/**
 * Represents a comment block in TypeDoc's JSON output.
 * The `summary` field contains an array of text fragments that make up the main comment summary.
 */
interface TypeDocComment {
  summary?: Array<{ text: string }>;
}

/**
 * Represents the source location of a declaration in TypeDoc's JSON output.
 */
interface TypeDocSource {
  /** The file name where the declaration is defined. */
  fileName: string;
}

/**
 * Represents the flags associated with a declaration in TypeDoc's JSON output.
 * The `isPrivate` flag indicates whether the declaration is marked as private.
 */
interface TypeDocFlags {
  isPrivate?: boolean;
}

/**
 * Represents a type in TypeDoc's JSON output.
 * The `type` field indicates the kind of type (e.g., 'intrinsic', 'reference', 'array', etc.).
 * - `name` is present for named types (e.g., 'string', 'MyType').
 * - `elementType` is used for array or similar types.
 * - `types` is used for union or intersection types.
 * - `typeArguments` is used for generic types.
 */
interface TypeDocType {
  type: string;
  name?: string;
  elementType?: TypeDocType;
  types?: TypeDocType[];
  typeArguments?: TypeDocType[];
}

/**
 * Represents a function or method signature in TypeDoc's JSON output.
 * - `comment`: Optional documentation for the signature.
 * - `parameters`: Optional list of parameters, each with a name and type.
 * - `type`: Optional return type of the signature.
 */
interface TypeDocSignature {
  /** Optional documentation comment for the signature. */
  comment?: TypeDocComment;
  /** Optional list of parameters for the signature. */
  parameters?: Array<{
    /** Name of the parameter. */
    name: string;
    /** Optional type of the parameter. */
    type?: TypeDocType;
  }>;
  /** Optional return type of the signature. */
  type?: TypeDocType;
}

/**
 * Represents a declaration (class, interface, function, etc.) in TypeDoc's JSON output.
 *
 * - `name`: The name of the declaration.
 * - `kind`: Numeric TypeDoc kind identifier (e.g., class, interface, function).
 * - `comment`: Optional documentation comment for the declaration.
 * - `signatures`: Optional list of function/method signatures (for functions, methods, or constructors).
 * - `sources`: Optional array of source file references where the declaration is defined.
 * - `flags`: Optional flags (e.g., visibility, static, private).
 * - `type`: Optional type information (for type aliases, properties, etc.).
 * - `children`: Optional array of child declarations (e.g., class members, interface properties).
 * - `extendedTypes`: Optional array of types this declaration extends (for classes/interfaces).
 * - `implementedTypes`: Optional array of types this declaration implements (for classes).
 * - `inheritedFrom`: Optional information about the parent declaration if this is inherited.
 */
interface DeclarationReflection {
  /** The name of the declaration (e.g., class name, function name). */
  name: string;
  /** Numeric TypeDoc kind identifier (see TypeDoc enums for mapping). */
  kind: number;
  /** Optional documentation comment for the declaration. */
  comment?: TypeDocComment;
  /** Optional list of function/method signatures. */
  signatures?: TypeDocSignature[];
  /** Optional array of source file references. */
  sources?: TypeDocSource[];
  /** Optional flags (e.g., isPrivate, isStatic). */
  flags?: TypeDocFlags;
  /** Optional type information for the declaration. */
  type?: TypeDocType;
  /** Optional array of child declarations (e.g., class members). */
  children?: DeclarationReflection[];
  /** Optional array of types this declaration extends. */
  extendedTypes?: TypeDocType[];
  /** Optional array of types this declaration implements. */
  implementedTypes?: TypeDocType[];
  /** Optional information about the parent declaration if inherited. */
  inheritedFrom?: { name: string };
}

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
 * Represents the root project reflection in TypeDoc's JSON output.
 *
 * - `children`: Top-level declarations (classes, interfaces, functions, etc.) in the project.
 * - `comment`: Optional documentation comment for the project/module itself.
 */
interface ProjectReflection {
  /** Top-level declarations in the project (e.g., classes, interfaces, functions). */
  children?: DeclarationReflection[];
  /** Optional documentation comment for the project/module. */
  comment?: TypeDocComment;
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

// Directory where generated API documentation will be stored
const API_DOCS_DIR = path.join('docs', 'docs', 'api');

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
}

/**
 * Extract API elements from a TypeScript file using TypeDoc
 */
async function extractApiElements(filePath: string): Promise<ApiElements> {
  console.log(`🔍 Extracting API elements from ${filePath}...`);

  const app = await Application.bootstrap({
    entryPoints: [filePath],
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
      case 4194304: // TypeAlias
        elements.types.push(child);
        break;
    }
  }

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
 * Format a type for display
 */
function formatType(type: TypeDocType | undefined): string {
  if (!type) return 'any';

  switch (type.type) {
    case 'intrinsic':
      return type.name || 'unknown';
    case 'reference':
      return (type.name || 'unknown') +
        (type.typeArguments
          ? `<${type.typeArguments.map(formatType).join(', ')}>`
          : '');
    case 'union':
      return type.types?.map(formatType).join(' | ') || 'unknown';
    case 'array':
      return formatType(type.elementType) + '[]';
    default:
      return type.name || 'unknown';
  }
}

/**
 * Build a cross-reference map of all API elements for linking
 */
function buildCrossReferenceMap(allElements: ApiElements[]): Map<string, string> {
  const crossRefMap = new Map<string, string>();

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
 * TypeScript utility types that should not be linked
 */
const TYPESCRIPT_UTILITY_TYPES = new Set([
  'Omit', 'Pick', 'Partial', 'Required', 'Record', 'Exclude', 'Extract', 
  'NonNullable', 'Parameters', 'ConstructorParameters', 'ReturnType', 
  'InstanceType', 'ThisParameterType', 'OmitThisParameter'
]);

/**
 * Format a type with cross-reference links
 */
function formatLinkedType(type: TypeDocType | undefined, crossRefMap: Map<string, string>): string {
  if (!type) return 'any';

  switch (type.type) {
    case 'intrinsic':
      return type.name || 'unknown';
    case 'reference': {
      const typeName = type.name || 'unknown';
      
      // Don't link TypeScript utility types - render as inline code
      if (TYPESCRIPT_UTILITY_TYPES.has(typeName)) {
        const typeArgs = type.typeArguments
          ? `<${
            type.typeArguments.map((t: TypeDocType) => formatLinkedType(t, crossRefMap))
              .join(', ')
          }>`
          : '';
        return `\`${typeName}${typeArgs}\``;
      }
      
      // Don't link single-letter generic types (like T, U, N, etc.)
      if (typeName.length === 1 && /[A-Z]/.test(typeName)) {
        return typeName;
      }
      
      const link = crossRefMap.get(typeName);
      // Only create links if the type exists in our cross-reference map
      const linkedName = link ? `[${typeName}](${link})` : `\`${typeName}\``;
      const typeArgs = type.typeArguments
        ? `<${
          type.typeArguments.map((t: TypeDocType) => formatLinkedType(t, crossRefMap))
            .join(', ')
        }>`
        : '';
      return linkedName + typeArgs;
    }

    case 'union':
      return type.types?.map((t: TypeDocType) => formatLinkedType(t, crossRefMap)).join(
        ' | ',
      ) || 'unknown';
    case 'array':
      return formatLinkedType(type.elementType, crossRefMap) + '[]';
    default:
      return type.name || 'unknown';
  }
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
    content += `\`\`\`typescript\nnew ${name}(${params})\n\`\`\`\n\n`;

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
        content += `\`\`\`typescript\n${sig}\n\`\`\`\n\n`;
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
      content += `\`\`\`typescript\n${prop.name}: ${type}\n\`\`\`\n\n`;

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
        content += `\`\`\`typescript\n${sig}\n\`\`\`\n\n`;
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
      content += `\`\`\`typescript\n${sig}\n\`\`\`\n\n`;
    }

    const doc = extractDocumentation(fn);
    if (doc) {
      content += `${doc}\n\n`;
    }
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
      elements.functions.length === 0
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
  const entryPoints = ['mod.ts', 'server/mod.ts', 'react/hooks.ts'];
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
