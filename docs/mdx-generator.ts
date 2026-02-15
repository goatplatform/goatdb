import type { DeclarationReflection } from 'typedoc';
import {
  escapeForCodeTag,
  extractInheritanceInfo,
  formatLinkedType,
  formatLinkedTypeSignature,
  type InheritanceInfo,
} from './type-formatter.ts';

// ===================================================================
// DOCUMENTATION EXTRACTION AND UTILITIES
// ===================================================================

/**
 * Extracts documentation text from a TypeDoc comment.
 *
 * @param element - The TypeDoc element to extract the documentation from.
 * @returns The documentation text, or an empty string if no documentation is
 *          found.
 */
export function extractDocumentation(element: DeclarationReflection): string {
  // Try element comment first (classes, interfaces, etc.)
  let comment = element.comment;

  // For functions, try the signature comment
  if (!comment && element.signatures?.[0]?.comment) {
    comment = element.signatures[0].comment;
  }

  if (!comment?.summary) return '';

  let escapedText = comment.summary.map((part) => part.text).join('').trim();

  // Escape markdown links that might interfere with MDX
  // Pattern: number/letter followed by [content](content)
  escapedText = escapedText.replace(
    /(\w+)\[([^\]]+)\]\(([^)]+)\)/g,
    '$1\\[$2\\]\\($3\\)',
  );

  // Don't escape angle brackets or curly braces inside code blocks - split text and only escape outside blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks: string[] = [];
  let blockIndex = 0;

  // Replace code blocks with placeholders
  escapedText = escapedText.replace(codeBlockRegex, (match) => {
    const placeholder = `__CODE_BLOCK_${blockIndex}__`;
    codeBlocks[blockIndex] = match;
    blockIndex++;
    return placeholder;
  });

  // Escape angle brackets and curly braces only in non-code-block text
  escapedText = escapedText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  escapedText = escapedText.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

  // Restore code blocks
  codeBlocks.forEach((block, index) => {
    escapedText = escapedText.replace(`__CODE_BLOCK_${index}__`, block);
  });

  return escapedText;
}

// ===================================================================
// INHERITANCE MAPPING AND MEMBER ORGANIZATION
// ===================================================================

/**
 * Builds a reverse inheritance map for parent->child relationships.
 *
 * @param allElements - An array of ApiElements objects containing the API
 *                      elements to build the reverse inheritance map for.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths for proper linking.
 * @returns A Map of parent element names to their corresponding child
 *          element names.
 */
export function buildReverseInheritanceMap(
  allElements: Array<{
    classes: DeclarationReflection[];
    interfaces: DeclarationReflection[];
    functions: DeclarationReflection[];
    types: DeclarationReflection[];
  }>,
  crossRefMap: Map<string, string>,
): Map<string, string[]> {
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
 * Separates own members from inherited members.
 *
 * @param element - The TypeDoc element to separate the members from.
 * @returns An object containing two arrays:
 *          - `ownMembers`: An array of own members.
 *          - `inheritedMembers`: A Map of parent element names to their
 *            corresponding child members.
 */
export function separateMembers(
  element: DeclarationReflection,
): {
  ownMembers: DeclarationReflection[];
  inheritedMembers: Map<string, DeclarationReflection[]>;
} {
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
 * Builds the inheritance section for interface documentation.
 *
 * @param inheritance - Inheritance information extracted from the element
 * @returns Formatted MDX content for the inheritance section
 */
function buildInheritanceSection(inheritance: InheritanceInfo): string {
  if (inheritance.extends.length === 0) return '';

  const extendsLinks = inheritance.extends.map((parent) => {
    if (parent.utilityTypeInfo) {
      // Enhanced display for utility types
      const parentDisplay = parent.link
        ? `[${parent.name}](${parent.link})`
        : parent.name; // No link for cross-module references
      return `${parentDisplay} (${parent.utilityTypeInfo.operation.description})`;
    }
    // Standard display for simple inheritance
    return `[${parent.name}](${parent.link})`;
  }).join(', ');

  let section = `**Extends:** ${extendsLinks}\n\n`;

  // Show utility type context if available
  const utilityParent = inheritance.extends.find((p) => p.utilityTypeInfo);
  if (utilityParent?.utilityTypeInfo) {
    section +=
      `*Type composition: \`${utilityParent.utilityTypeInfo.displayType}\`*\n\n`;
  }

  return section;
}

// ===================================================================
// MDX CONTENT GENERATION
// ===================================================================

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
export function createClassMDX(
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
      `[${subclass}](/docs/api/classes/${subclass.toLowerCase()})`
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
      const parentLink = `/docs/api/classes/${parentName.toLowerCase()}`;
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
export function createInterfaceMDX(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
  reverseInheritanceMap: Map<string, string[]>,
  allDeclarations?: Map<string, DeclarationReflection>,
): string {
  const name = element.name;
  const doc = extractDocumentation(element);
  const inheritance = extractInheritanceInfo(
    element,
    crossRefMap,
    allDeclarations,
  );
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
  content += buildInheritanceSection(inheritance);

  // Show subinterfaces (interfaces that extend this interface)
  const subinterfaces = reverseInheritanceMap.get(name);
  if (subinterfaces && subinterfaces.length > 0) {
    const subinterfaceLinks = subinterfaces.map((subinterface) =>
      `[${subinterface}](/docs/api/interfaces/${subinterface.toLowerCase()})`
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

  // Inherited properties/methods
  const hasUtilityTypeParent = inheritance.extends.some((p) =>
    p.utilityTypeInfo
  );

  if (inheritedMembers.size > 0 || hasUtilityTypeParent) {
    content += `## Inherited Members\n\n`;

    // Handle utility type inheritance
    if (hasUtilityTypeParent) {
      const utilityParent = inheritance.extends.find((p) => p.utilityTypeInfo)!;
      const parentDisplay = utilityParent.link
        ? `[${utilityParent.name}](${utilityParent.link})`
        : utilityParent.name;

      content += `### From ${parentDisplay}\n\n`;

      // Show resolved properties if available
      const utilityInfo = utilityParent.utilityTypeInfo;
      if (
        utilityInfo?.resolvedProperties &&
        utilityInfo.resolvedProperties.length > 0
      ) {
        const properties = utilityInfo.resolvedProperties.filter((p) =>
          p.source === 'inherited'
        );

        if (properties.length > 0) {
          const propNames = properties.map((p) => `\`${p.name}\``).join(', ');
          content += `**Properties:** ${propNames}\n\n`;

          // Show details for each property
          for (const prop of properties) {
            content += `- **\`${prop.name}${
              prop.isOptional ? '?' : ''
            }: ${prop.type}\`**`;
            if (prop.documentation) {
              content += ` - ${prop.documentation}`;
            }
            content += `\n`;
          }
          content += `\n`;
        }
      } else if (utilityInfo) {
        // Fallback to generic description
        if (utilityInfo.operation.type === 'omit') {
          const omittedKeys = utilityInfo.operation.keys || [];
          content += `*All properties and methods from ${utilityParent.name}`;
          if (omittedKeys.length > 0) {
            content += ` except: ${
              omittedKeys.map((k) => `\`${k}\``).join(', ')
            }`;
          }
          content += `*\n\n`;
        } else if (utilityInfo.operation.type === 'pick') {
          const pickedKeys = utilityInfo.operation.keys || [];
          if (pickedKeys.length > 0) {
            content += `*Only these properties: ${
              pickedKeys.map((k) => `\`${k}\``).join(', ')
            }*\n\n`;
          }
        } else {
          content += `*${utilityInfo.operation.description}*\n\n`;
        }
      }

      content += `*See ${parentDisplay} for detailed documentation*\n\n`;
    }

    // Handle regular inherited members
    for (const [parentName, members] of inheritedMembers) {
      // Skip if this is a utility type that we already handled above
      const isUtilityTypeParent = inheritance.extends.some((p) =>
        p.utilityTypeInfo &&
        (parentName === 'Omit' || parentName === 'Pick' ||
          parentName === 'Partial' || parentName === 'Required')
      );

      if (isUtilityTypeParent) {
        continue; // Already handled above
      }

      // Skip if no parent link is available (external interfaces)
      const parentLink = crossRefMap.get(parentName);
      if (!parentLink) {
        continue;
      }

      const parentLink2 = `/docs/api/interfaces/${parentName.toLowerCase()}`;
      content += `### From [${parentName}](${parentLink2})\n\n`;

      const properties = members.filter((m) => m.kind === 1024);
      const methods = members.filter((m) => m.kind === 2048);

      if (properties.length > 0) {
        const propNames = properties.map((p) => `\`${p.name}\``).join(', ');
        content += `**Properties:** ${propNames}\n\n`;
      }

      if (methods.length > 0) {
        const methodNames = methods.map((m) => `\`${m.name}()\``).join(', ');
        content += `**Methods:** ${methodNames}\n\n`;
      }

      content +=
        `*See [${parentName}](${parentLink2}) for detailed documentation*\n\n`;
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
export function createFunctionsMDX(
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
export function createTypeMDX(
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
    content += `**Type:** <code>${
      escapeForCodeTag(`${name} = ${interactiveType}`)
    }</code>\n\n`;
  } else if (element.children && element.children.length > 0) {
    // Handle interface-like types that have properties as children
    content += `## Definition\n\n`;

    const properties = element.children
      .filter((child) => child.kind === 1024) // Property kind
      .map((prop) => {
        const propType = prop.type
          ? formatLinkedType(prop.type, crossRefMap)
          : 'any';
        const optional = prop.flags?.isOptional ? '?' : '';
        return `${prop.name}${optional}: ${propType}`;
      })
      .join('; ');

    if (properties) {
      const typeDefinition = `${name} = \{ ${properties} \}`;
      content += `**Type:** <code>${
        escapeForCodeTag(typeDefinition)
      }</code>\n\n`;
    }
  }

  return content;
}
