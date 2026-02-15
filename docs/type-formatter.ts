import {
  ArrayType,
  ConditionalType,
  type DeclarationReflection,
  IndexedAccessType,
  IntrinsicType,
  LiteralType,
  MappedType,
  NamedTupleMember,
  QueryType,
  ReferenceType,
  ReflectionType,
  TupleType,
  type Type,
  TypeOperatorType,
  UnionType,
} from 'typedoc';

/**
 * Represents inheritance information for a declaration.
 *
 * - `extends`: Array of parent types this declaration extends, each with a name
 *   and a link to the parent type.
 * - `implements`: Array of interfaces this declaration implements, each with a name
 *   and a link to the interface.
 */
export interface InheritanceInfo {
  extends: Array<{
    name: string;
    link: string;
    utilityTypeInfo?: UtilityTypeAnalysis; // Only present for utility types
  }>;
  implements: Array<{ name: string; link: string }>;
}

/**
 * Analysis result for TypeScript utility types like Omit, Pick, etc.
 */
export interface UtilityTypeAnalysis {
  utilityType: string;
  displayType: string;
  baseInterface: { name: string; link: string };
  operation: UtilityOperation;
  resolvedProperties?: ResolvedProperty[];
}

/**
 * Represents a resolved property with its documentation.
 */
export interface ResolvedProperty {
  name: string;
  type: string;
  documentation: string;
  isOptional: boolean;
  source: 'inherited' | 'own';
  sourceInterface?: string;
}

/**
 * Describes the operation performed by a utility type.
 */
export interface UtilityOperation {
  type: 'omit' | 'pick' | 'partial' | 'required';
  keys?: string[];
  description: string;
}

// ===================================================================
// CROSS-REFERENCE MAP BUILDING
// ===================================================================

/**
 * Builds a cross-reference map of all API elements for linking.
 *
 * @param allElements - An array of ApiElements objects containing the API
 *                      elements to build the cross-reference map for.
 * @returns A Map of element names to their corresponding file paths.
 */
export function buildCrossReferenceMap(
  allElements: Array<{
    classes: DeclarationReflection[];
    interfaces: DeclarationReflection[];
    types: DeclarationReflection[];
    functions: DeclarationReflection[];
  }>,
): Map<string, string> {
  const crossRefMap = new Map<string, string>();

  // Only map actually discovered and documented types
  for (const elements of allElements) {
    // Map classes - use absolute paths from API root
    for (const cls of elements.classes) {
      crossRefMap.set(cls.name, `/docs/api/classes/${cls.name.toLowerCase()}`);
    }

    // Map interfaces - use absolute paths from API root
    for (const iface of elements.interfaces) {
      crossRefMap.set(
        iface.name,
        `/docs/api/interfaces/${iface.name.toLowerCase()}`,
      );
    }

    // Map types - use absolute paths from API root
    for (const type of elements.types) {
      crossRefMap.set(type.name, `/docs/api/types/${type.name.toLowerCase()}`);
    }
  }

  console.log(`   Built cross-reference map with ${crossRefMap.size} entries`);
  return crossRefMap;
}

// ===================================================================
// INHERITANCE ANALYSIS
// ===================================================================

/**
 * Extracts inheritance information from a class or interface.
 *
 * @param element - The TypeDoc element to extract the inheritance information
 *                  from.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths for proper linking.
 * @returns An InheritanceInfo object containing the inheritance information.
 */
export function extractInheritanceInfo(
  element: DeclarationReflection,
  crossRefMap: Map<string, string>,
  allDeclarations?: Map<string, DeclarationReflection>,
): InheritanceInfo {
  const inheritance: InheritanceInfo = {
    extends: [],
    implements: [],
  };

  // Handle inheritance (extends)
  if (element.extendedTypes) {
    for (const extendedType of element.extendedTypes) {
      if (extendedType.type === 'reference' && extendedType.name) {
        // Skip external types we don't have docs for
        if (extendedType.name.includes('.')) {
          continue;
        }

        // Try utility type analysis first (for Omit, Pick, etc.)
        if (extendedType instanceof ReferenceType) {
          const utilityTypeResolution = analyzeUtilityTypeInheritance(
            extendedType,
            crossRefMap,
            allDeclarations,
          );

          if (utilityTypeResolution?.baseInterface) {
            // Show the meaningful parent interface instead of the utility type
            inheritance.extends.push({
              name: utilityTypeResolution.baseInterface.name,
              link: utilityTypeResolution.baseInterface.link,
              utilityTypeInfo: utilityTypeResolution,
            });
            continue;
          }
        }

        // Fallback to simple inheritance (existing logic)
        const parentInterfaceLink = crossRefMap.get(extendedType.name) ||
          (element.kind === 256
            ? `/docs/api/interfaces/${extendedType.name.toLowerCase()}`
            : `/docs/api/classes/${extendedType.name.toLowerCase()}`);

        inheritance.extends.push({
          name: extendedType.name,
          link: parentInterfaceLink,
        });
      }
    }
  }

  // Handle implementation (implements)
  if (element.implementedTypes) {
    for (const implementedType of element.implementedTypes) {
      if (implementedType.type === 'reference' && implementedType.name) {
        const implementedInterfaceLink =
          crossRefMap.get(implementedType.name) ||
          `/docs/api/interfaces/${implementedType.name.toLowerCase()}`;

        inheritance.implements.push({
          name: implementedType.name,
          link: implementedInterfaceLink,
        });
      }
    }
  }

  return inheritance;
}

// ===================================================================
// TYPE FORMATTING AND LINKING
// ===================================================================

/**
 * Formats a type with cross-reference links.
 *
 * @param type - The TypeDoc type to format.
 * @param crossRefMap - A Map of element names to their corresponding file
 *                      paths.
 * @returns The formatted type string.
 */
export function formatLinkedType(
  type: Type | undefined,
  crossRefMap: Map<string, string>,
): string {
  if (!type) return 'any';

  switch (type.type) {
    case 'intrinsic':
      if (type instanceof IntrinsicType) {
        return type.name || throwTypeError('intrinsic type missing name', type);
      }
      return 'any';

    case 'reference': {
      if (type instanceof ReferenceType) {
        const typeName = type.name ||
          throwTypeError('reference type missing name', type);

        // Don't link TypeScript utility types - render as inline code
        const TYPESCRIPT_UTILITY_TYPES = new Set([
          'Omit',
          'Pick',
          'Partial',
          'Required',
          'Record',
          'Exclude',
          'Extract',
          'NonNullable',
          'Parameters',
          'ConstructorParameters',
          'ReturnType',
          'InstanceType',
          'ThisParameterType',
          'OmitThisParameter',
        ]);
        if (TYPESCRIPT_UTILITY_TYPES.has(typeName)) {
          const typeArgs = type.typeArguments
            ? `<${
              type.typeArguments.map((t: Type) =>
                formatLinkedType(t, crossRefMap)
              ).join(', ')
            }>`
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
          ? `<${
            type.typeArguments.map((t: Type) =>
              formatLinkedType(t, crossRefMap)
            ).join(', ')
          }>`
          : '';
        return linkedName + typeArgs;
      }
      return 'any';
    }

    case 'union':
      if (type instanceof UnionType) {
        return type.types.map((t: Type) => formatLinkedType(t, crossRefMap))
          .join(' | ');
      }
      return 'any';

    case 'intersection':
      if (type instanceof UnionType) { // UnionType is used for both union and intersection
        return type.types.map((t: Type) => formatLinkedType(t, crossRefMap))
          .join(' & ');
      }
      return 'any';

    case 'array':
      if (type instanceof ArrayType) {
        return `${formatLinkedType(type.elementType, crossRefMap)}[]`;
      }
      return 'any[]';

    case 'tuple':
      if (type instanceof TupleType) {
        return `[${
          type.elements.map((t: Type) => formatLinkedType(t, crossRefMap)).join(
            ', ',
          )
        }]`;
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
      if (type instanceof LiteralType) {
        // For string literals, preserve quotes; for others, use the value directly
        return typeof type.value === 'string'
          ? `'${type.value}'`
          : String(type.value);
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
            const paramType = p.type
              ? formatLinkedType(p.type, crossRefMap)
              : 'any';
            return `${p.name}: ${paramType}`;
          }).join(', ') || '';
          const returnType = sig.type
            ? formatLinkedType(sig.type, crossRefMap)
            : 'void';
          return `(${params}) => ${returnType}`;
        } else if (type.declaration?.children) {
          // Object type
          const properties = type.declaration.children
            .filter((child) => !child.flags?.isPrivate)
            .map((child) => {
              const propType = child.type
                ? formatLinkedType(child.type, crossRefMap)
                : 'any';
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
    keys: Object.keys(type),
  };

  throw new Error(
    `TypeDoc type parsing error: ${message}. Type info: ${
      JSON.stringify(debugInfo, null, 2)
    }`,
  );
}

/**
 * Format a function signature with cross-reference links
 */
export function formatLinkedTypeSignature(
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
export function escapeForCodeTag(content: string): string {
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

/**
 * Collects type references from a TypeDoc type for validation purposes
 */
export function collectTypeReferences(
  type: Type,
  referencedTypes: Set<string>,
): void {
  switch (type.type) {
    case 'reference':
      if (type instanceof ReferenceType && type.name) {
        referencedTypes.add(type.name);
        // Recursively check type arguments
        if (type.typeArguments) {
          for (const typeArg of type.typeArguments) {
            collectTypeReferences(typeArg, referencedTypes);
          }
        }
      }
      break;

    case 'union':
    case 'intersection':
      if (type instanceof UnionType) {
        for (const unionType of type.types) {
          collectTypeReferences(unionType, referencedTypes);
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

    case 'namedTupleMember':
      if (type instanceof NamedTupleMember) {
        collectTypeReferences(type.element, referencedTypes);
      }
      break;

    case 'typeOperator':
      if (type instanceof TypeOperatorType) {
        collectTypeReferences(type.target, referencedTypes);
      }
      break;

    case 'indexedAccess':
      if (type instanceof IndexedAccessType) {
        collectTypeReferences(type.objectType, referencedTypes);
        collectTypeReferences(type.indexType, referencedTypes);
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

    case 'query':
      if (type instanceof QueryType) {
        collectTypeReferences(type.queryType, referencedTypes);
      }
      break;

    case 'reflection':
      if (type instanceof ReflectionType && type.declaration) {
        // Recursively check signatures and children
        if (type.declaration.signatures) {
          for (const sig of type.declaration.signatures) {
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
        if (type.declaration.children) {
          for (const child of type.declaration.children) {
            if (child.type) {
              collectTypeReferences(child.type, referencedTypes);
            }
          }
        }
      }
      break;

      // For other types (intrinsic, literal, etc.), no references to collect
  }
}

// ===================================================================
// UTILITY TYPE ANALYSIS
// ===================================================================

/**
 * Supported TypeScript utility types for inheritance analysis.
 */
const SUPPORTED_UTILITY_TYPES = new Set([
  'Omit',
  'Pick',
  'Partial',
  'Required',
]);

/**
 * Analyzes utility type inheritance to extract meaningful parent relationships.
 * Handles common TypeScript utility types like Omit, Pick, Partial, Required.
 *
 * @param extendedType - The TypeDoc reference type to analyze
 * @param crossRefMap - Cross-reference map for link resolution
 * @returns Analysis result or null if not a supported utility type
 */
export function analyzeUtilityTypeInheritance(
  extendedType: ReferenceType,
  crossRefMap: Map<string, string>,
  allDeclarations?: Map<string, DeclarationReflection>,
): UtilityTypeAnalysis | null {
  const utilityTypeName = extendedType.name;

  if (
    !SUPPORTED_UTILITY_TYPES.has(utilityTypeName) || !extendedType.typeArguments
  ) {
    return null;
  }

  try {
    const analysis: Partial<UtilityTypeAnalysis> = {
      utilityType: utilityTypeName,
      displayType: formatLinkedType(extendedType, crossRefMap),
    };

    switch (utilityTypeName) {
      case 'Omit':
        return analyzeOmitType(
          extendedType,
          analysis,
          crossRefMap,
          allDeclarations,
        );
      case 'Pick':
        return analyzePickType(
          extendedType,
          analysis,
          crossRefMap,
          allDeclarations,
        );
      case 'Partial':
        return analyzePartialType(
          extendedType,
          analysis,
          crossRefMap,
          allDeclarations,
        );
      case 'Required':
        return analyzeRequiredType(
          extendedType,
          analysis,
          crossRefMap,
          allDeclarations,
        );
      default:
        return null;
    }
  } catch (error) {
    console.warn(
      `Warning: Failed to analyze utility type ${utilityTypeName}:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Analyzes Omit<BaseType, Keys> utility type.
 */
function analyzeOmitType(
  extendedType: ReferenceType,
  analysis: Partial<UtilityTypeAnalysis>,
  crossRefMap: Map<string, string>,
  allDeclarations?: Map<string, DeclarationReflection>,
): UtilityTypeAnalysis | null {
  const typeArgs = extendedType.typeArguments!;
  if (typeArgs.length !== 2) {
    console.warn(
      `Warning: Omit type has ${typeArgs.length} arguments, expected 2`,
    );
    return null;
  }

  const [baseType, keysType] = typeArgs;

  const baseInterface = extractBaseInterface(baseType, crossRefMap);
  if (!baseInterface) {
    return null;
  }

  const omittedKeys = extractStringLiteralKeys(keysType);

  const result = {
    ...analysis,
    baseInterface,
    operation: {
      type: 'omit',
      keys: omittedKeys,
      description: omittedKeys.length > 0
        ? `excluding ${omittedKeys.map((k) => `'${k}'`).join(', ')}`
        : 'excluding specified keys',
    },
  } as UtilityTypeAnalysis;

  // Resolve actual properties if declarations are available
  if (allDeclarations) {
    result.resolvedProperties = resolveUtilityTypeProperties(
      result,
      crossRefMap,
      allDeclarations,
    );
  }

  return result;
}

/**
 * Analyzes Pick<BaseType, Keys> utility type.
 */
function analyzePickType(
  extendedType: ReferenceType,
  analysis: Partial<UtilityTypeAnalysis>,
  crossRefMap: Map<string, string>,
  allDeclarations?: Map<string, DeclarationReflection>,
): UtilityTypeAnalysis | null {
  const typeArgs = extendedType.typeArguments!;
  if (typeArgs.length !== 2) {
    console.warn(
      `Warning: Pick type has ${typeArgs.length} arguments, expected 2`,
    );
    return null;
  }

  const [baseType, keysType] = typeArgs;

  const baseInterface = extractBaseInterface(baseType, crossRefMap);
  if (!baseInterface) {
    console.warn('Warning: Could not extract base interface for Pick type');
    return null;
  }

  const pickedKeys = extractStringLiteralKeys(keysType);

  const result = {
    ...analysis,
    baseInterface,
    operation: {
      type: 'pick',
      keys: pickedKeys,
      description: pickedKeys.length > 0
        ? `selecting only ${pickedKeys.map((k) => `'${k}'`).join(', ')}`
        : 'selecting specified keys',
    },
  } as UtilityTypeAnalysis;

  if (allDeclarations) {
    result.resolvedProperties = resolveUtilityTypeProperties(
      result,
      crossRefMap,
      allDeclarations,
    );
  }

  return result;
}

/**
 * Analyzes Partial<BaseType> utility type.
 */
function analyzePartialType(
  extendedType: ReferenceType,
  analysis: Partial<UtilityTypeAnalysis>,
  crossRefMap: Map<string, string>,
  allDeclarations?: Map<string, DeclarationReflection>,
): UtilityTypeAnalysis | null {
  const typeArgs = extendedType.typeArguments!;
  if (typeArgs.length !== 1) {
    console.warn(
      `Warning: Partial type has ${typeArgs.length} arguments, expected 1`,
    );
    return null;
  }

  const baseInterface = extractBaseInterface(typeArgs[0], crossRefMap);
  if (!baseInterface) {
    console.warn('Warning: Could not extract base interface for Partial type');
    return null;
  }

  const result = {
    ...analysis,
    baseInterface,
    operation: {
      type: 'partial',
      description: 'making all properties optional',
    },
  } as UtilityTypeAnalysis;

  if (allDeclarations) {
    result.resolvedProperties = resolveUtilityTypeProperties(
      result,
      crossRefMap,
      allDeclarations,
    );
  }

  return result;
}

/**
 * Analyzes Required<BaseType> utility type.
 */
function analyzeRequiredType(
  extendedType: ReferenceType,
  analysis: Partial<UtilityTypeAnalysis>,
  crossRefMap: Map<string, string>,
  allDeclarations?: Map<string, DeclarationReflection>,
): UtilityTypeAnalysis | null {
  const typeArgs = extendedType.typeArguments!;
  if (typeArgs.length !== 1) {
    console.warn(
      `Warning: Required type has ${typeArgs.length} arguments, expected 1`,
    );
    return null;
  }

  const baseInterface = extractBaseInterface(typeArgs[0], crossRefMap);
  if (!baseInterface) {
    console.warn('Warning: Could not extract base interface for Required type');
    return null;
  }

  const result = {
    ...analysis,
    baseInterface,
    operation: {
      type: 'required',
      description: 'making all properties required',
    },
  } as UtilityTypeAnalysis;

  if (allDeclarations) {
    result.resolvedProperties = resolveUtilityTypeProperties(
      result,
      crossRefMap,
      allDeclarations,
    );
  }

  return result;
}

/**
 * Extracts base interface information from a TypeDoc Type.
 */
function extractBaseInterface(
  type: Type,
  crossRefMap: Map<string, string>,
): { name: string; link: string } | null {
  if (
    type.type !== 'reference' || !(type instanceof ReferenceType) || !type.name
  ) {
    return null;
  }

  // Skip external types (contain dots) or built-in types
  if (type.name.includes('.') || isBuiltInType(type.name)) {
    return null;
  }

  const link = crossRefMap.get(type.name);
  if (!link) {
    // Type not in crossRefMap - might be from another module
    // Return the name without a link for cross-module references
    return {
      name: type.name,
      link: '', // No link available
    };
  }

  return {
    name: type.name,
    link,
  };
}

/**
 * Extracts string literal keys from a union or single literal type.
 */
function extractStringLiteralKeys(type: Type): string[] {
  const keys: string[] = [];

  if (type.type === 'literal' && type instanceof LiteralType) {
    if (typeof type.value === 'string') {
      keys.push(type.value);
    }
  } else if (type.type === 'union' && type instanceof UnionType) {
    for (const unionMember of type.types) {
      if (
        unionMember.type === 'literal' && unionMember instanceof LiteralType
      ) {
        if (typeof unionMember.value === 'string') {
          keys.push(unionMember.value);
        }
      }
    }
  }

  return keys;
}

/**
 * Resolves actual properties from a base interface and applies utility type operations.
 * This function dynamically looks up the base type in TypeDoc's reflection system.
 */
function resolveUtilityTypeProperties(
  analysis: UtilityTypeAnalysis,
  crossRefMap: Map<string, string>,
  allDeclarations: Map<string, DeclarationReflection>,
): ResolvedProperty[] {
  const baseInterfaceName = analysis.baseInterface.name;
  const baseDeclaration = allDeclarations.get(baseInterfaceName);

  if (!baseDeclaration) {
    // Base interface not found - this is common for internal/cross-module types
    // Return empty array so we fall back to generic description
    return [];
  }

  let baseProperties: ResolvedProperty[] = [];

  // Handle type aliases with reflection types
  if (
    baseDeclaration.type?.type === 'reflection' &&
    baseDeclaration.type.declaration?.children
  ) {
    baseProperties = extractPropertiesFromChildren(
      baseDeclaration.type.declaration.children,
      baseInterfaceName,
      crossRefMap,
    );
  } // Handle interfaces with direct children
  else if (baseDeclaration.children) {
    baseProperties = extractPropertiesFromChildren(
      baseDeclaration.children,
      baseInterfaceName,
      crossRefMap,
    );
  }

  // Apply utility type operation (Omit, Pick, etc.)
  return applyUtilityOperation(baseProperties, analysis.operation);
}

/**
 * Extracts properties from TypeDoc children (works for both interfaces and type aliases)
 */
function extractPropertiesFromChildren(
  children: DeclarationReflection[],
  sourceInterface: string,
  crossRefMap: Map<string, string>,
): ResolvedProperty[] {
  return children
    .filter((child) => child.kind === 1024) // Property kind
    .map((prop) => ({
      name: prop.name,
      type: prop.type ? formatLinkedType(prop.type, crossRefMap) : 'any',
      documentation: prop.comment?.summary?.map((s) => s.text).join('') || '',
      isOptional: prop.flags?.isOptional || false,
      source: 'inherited' as const,
      sourceInterface,
    }));
}

/**
 * Applies utility type operations to a list of properties.
 */
function applyUtilityOperation(
  properties: ResolvedProperty[],
  operation: UtilityOperation,
): ResolvedProperty[] {
  switch (operation.type) {
    case 'omit': {
      const omittedKeys = new Set(operation.keys || []);
      return properties.filter((prop) => !omittedKeys.has(prop.name));
    }

    case 'pick': {
      const pickedKeys = new Set(operation.keys || []);
      return properties.filter((prop) => pickedKeys.has(prop.name));
    }

    case 'partial':
      return properties.map((prop) => ({ ...prop, isOptional: true }));

    case 'required':
      return properties.map((prop) => ({ ...prop, isOptional: false }));

    default:
      return properties;
  }
}

// ===================================================================
// TYPE CLASSIFICATION AND VALIDATION
// ===================================================================

/**
 * Classification result for a type name.
 */
export interface TypeClassification {
  classification: 'public' | 'internal' | 'builtin';
  stability: 'stable' | 'beta' | 'internal';
  module?: string;
}

/**
 * Classifies a type name based on its intended usage and stability.
 */
export function classifyType(
  typeName: string,
  sourceModule: string,
): TypeClassification {
  // Built-in types first
  if (isBuiltInType(typeName)) {
    return { classification: 'builtin', stability: 'stable' };
  }

  // Internal implementation types (marked with @internal or implementation details)
  const internalTypes = new Set([
    // Types we've explicitly marked with @internal JSDoc tags
    'DataChanges', // CRDT object diff (marked @internal)
    'Dictionary', // Internal collection abstraction (marked @internal)
    'EncodedItem', // Serialization representation (marked @internal)
    'Readwrite', // Utility type for removing readonly (marked @internal)

    // Other internal implementation types
    'MD5State', // Low-level hash implementation
    'MurmurHash3', // Low-level hash implementation
    'StaticAssets', // Build system internals
    'PrimitiveMap', // Internal collection type
    'OrderedMap', // Internal collection type
    'WritingDirection', // Internal string utility
    'Edit', // Internal CRDT type
    'FlatRepAtom', // Internal richtext type
    'CompareOptions', // Internal comparison options
    'EqualOptions', // Internal equality options
    // Pattern-based internal types
  ]);

  // Check explicit internal types first
  if (internalTypes.has(typeName)) {
    return { classification: 'internal', stability: 'internal' };
  }

  // Pattern-based internal types
  const internalPatterns = [
    /^_\w+/, // _InternalType
    /\w+Impl$/, // TypeImpl
    /\w+Internal$/, // TypeInternal
  ];

  for (const pattern of internalPatterns) {
    if (pattern.test(typeName)) {
      return { classification: 'internal', stability: 'internal' };
    }
  }

  // Module-specific types that are legitimate public API
  const moduleTypes: Record<string, string[]> = {
    'server': [
      'AppConfig',
      'BuilderInfo',
      'CompileOptions',
      'CPUArch',
      'TargetOS',
      'DebugServerOptions',
      'LiveReloadOptions',
      'ExecutableOptions',
      'EmailBuilder',
      'EmailInfo',
      'AutoCreateUserInfo',
      'DomainConfig',
      'EmailConfig',
      'EmailMessage',
      'EmailService',
      'OpenOptions',
    ],
    'react': [
      'UseItemOpts',
      'UseQueryOpts',
      'PropsWithPath',
    ],
    'core': [
      'QueryConfig',
      'AuthConfig',
      'AuthOp',
      'AuthRule',
      'AuthRuleInfo',
      'IterableFilterFunc',
      'ObjFieldsFilterFunc',
      'Predicate',
      'PredicateInfo',
      'SortDescriptor',
      'SortInfo',
      'Entry',
      'FieldDef',
      'FieldValue',
      'ItemConfig',
      'EmailLoginWithMagicLink',
      'GoatRequest',
      'ServeHandlerInfo',
      'RepoClient',
      'LogEntry',
      'Logger',
      'NormalizedLogEntry',
      'Severity',
    ],
  };

  // Check if this type belongs to a specific module
  for (const [moduleName, types] of Object.entries(moduleTypes)) {
    if (types.includes(typeName)) {
      return {
        classification: 'public',
        stability: 'stable',
        module: moduleName,
      };
    }
  }

  // Default: assume it's a public type from the current module
  return {
    classification: 'public',
    stability: 'stable',
    module: sourceModule,
  };
}

/**
 * Checks if a type name represents a built-in TypeScript/JavaScript type
 * that doesn't need to be documented.
 */
export function isBuiltInType(typeName: string): boolean {
  const builtInTypes = new Set([
    // Primitive types
    'string',
    'number',
    'boolean',
    'undefined',
    'null',
    'void',
    'any',
    'unknown',
    'never',
    'object',
    'symbol',
    'bigint',

    // Built-in objects
    'Array',
    'Object',
    'Function',
    'String',
    'Number',
    'Boolean',
    'Date',
    'RegExp',
    'Error',
    'Promise',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',

    // Web APIs / Node.js / Deno built-ins
    'Response',
    'Crypto',
    'CryptoKey',
    'CryptoKeyPair',
    'Iterable',
    'Generator',

    // TypeScript utility types
    'Omit',
    'Pick',
    'Partial',
    'Required',
    'Record',
    'Exclude',
    'Extract',
    'NonNullable',
    'Parameters',
    'ConstructorParameters',
    'ReturnType',
    'InstanceType',
    'ThisParameterType',
    'OmitThisParameter',

    // Single-letter generics
    'T',
    'U',
    'V',
    'K',
    'P',
    'R',
    'S',
    'N',
    'E',
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
