#!/usr/bin/env -S deno run -A
import { 
  Application, 
  type DeclarationReflection, 
} from 'typedoc';
import * as path from 'jsr:@std/path';
import { ensureDir } from 'jsr:@std/fs';

// Import functions from our new modules
import {
  buildCrossReferenceMap,
  collectTypeReferences,
  classifyType,
} from './type-formatter.ts';
import {
  buildReverseInheritanceMap,
  createClassMDX,
  createInterfaceMDX,
  createFunctionsMDX,
  createTypeMDX,
  extractDocumentation,
} from './mdx-generator.ts';

// Directory where generated API documentation will be stored
const API_DOCS_DIR = path.join('docs', 'docs', 'api');

/**
 * Configuration for a GoatDB module that should be documented.
 */
interface ModuleConfig {
  /** Unique module name (e.g., 'core', 'server', 'react') */
  name: string;
  /** Path to the module's entry point */
  entryPoint: string;
  /** API stability level */
  stability: 'stable' | 'beta' | 'internal';
  /** Modules this module can reference types from */
  dependencies?: string[];
}


// List of GoatDB modules to document
const GOATDB_MODULES: ModuleConfig[] = [
  {
    name: 'core',
    entryPoint: 'mod.ts',
    stability: 'stable',
  },
  {
    name: 'server',
    entryPoint: 'server/mod.ts',
    stability: 'stable',
    dependencies: ['core'],
  },
  {
    name: 'react',
    entryPoint: 'react/hooks.ts',
    stability: 'stable',
    dependencies: ['core'],
  },
];

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
 * - `moduleConfig`: Configuration for this module.
 */
interface ApiElements {
  classes: DeclarationReflection[];
  interfaces: DeclarationReflection[];
  functions: DeclarationReflection[];
  types: DeclarationReflection[];
  moduleName: string;
  moduleComment: string;
  moduleConfig: ModuleConfig;
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
 * @param moduleConfig - Configuration for the module being processed.
 * @returns An ApiElements object containing discovered API elements and module
 *          metadata.
 */
async function extractApiElements(moduleConfig: ModuleConfig): Promise<ApiElements> {
  const filePath = moduleConfig.entryPoint;
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
    moduleComment: '', // Skip module comments - they're for JSR registry, not API docs
    moduleConfig,
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

  // Build declarations map for property resolution
  const allDeclarations = new Map<string, DeclarationReflection>();
  for (const elements of allElements) {
    for (const cls of elements.classes) {
      allDeclarations.set(cls.name, cls);
    }
    for (const iface of elements.interfaces) {
      allDeclarations.set(iface.name, iface);
    }
    for (const type of elements.types) {
      allDeclarations.set(type.name, type);
    }
  }
  console.log(`🗂️ Built declarations map with ${allDeclarations.size} entries`);

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
      const filename = `functions-${elements.moduleName.toLowerCase()}`;
      content += `- **[${elements.moduleName} Functions](./${filename})**\n\n`;
    }
  }

  await Deno.writeTextFile(path.join(API_DOCS_DIR, 'index.mdx'), content);
}

/**
 * Validates configured modules and returns available module configurations.
 * Checks that entry points exist and logs warnings for missing modules.
 */
async function validateModuleConfigs(): Promise<ModuleConfig[]> {
  console.log('🔍 Validating module configurations...');
  
  const validModules: ModuleConfig[] = [];
  
  for (const moduleConfig of GOATDB_MODULES) {
    try {
      await Deno.stat(moduleConfig.entryPoint);
      validModules.push(moduleConfig);
      console.log(`   ✅ ${moduleConfig.name}: ${moduleConfig.entryPoint}`);
    } catch {
      console.warn(`   ⚠️  Module ${moduleConfig.name} entry point not found: ${moduleConfig.entryPoint}`);
    }
  }
  
  console.log(`   Found ${validModules.length} valid modules`);
  return validModules;
}

/**
 * Validates cross-references within module boundaries. Each module can only
 * reference types from itself and its declared dependencies.
 */
function validateModularCrossReferences(allElements: ApiElements[]): void {
  console.log('🔍 Validating cross-references with module awareness...');
  
  // Create a map of module name to documented types
  const moduleTypes = new Map<string, Set<string>>();
  
  // Collect documented types by module
  for (const elements of allElements) {
    const types = new Set<string>();
    elements.classes.forEach(cls => types.add(cls.name));
    elements.interfaces.forEach(iface => types.add(iface.name));
    elements.types.forEach(type => types.add(type.name));
    moduleTypes.set(elements.moduleName, types);
  }
  
  let totalIssues = 0;
  
  // Validate each module's references
  for (const elements of allElements) {
    const moduleName = elements.moduleName;
    const moduleConfig = elements.moduleConfig;
    
    console.log(`   📦 Validating ${moduleName} module...`);
    
    // Collect allowed types (from this module and its dependencies)
    const allowedTypes = new Set<string>();
    
    // Add types from this module
    const thisModuleTypes = moduleTypes.get(moduleName);
    if (thisModuleTypes) {
      for (const type of thisModuleTypes) {
        allowedTypes.add(type);
      }
    }
    
    // Add types from dependency modules
    if (moduleConfig.dependencies) {
      for (const depModule of moduleConfig.dependencies) {
        const depTypes = moduleTypes.get(depModule);
        if (depTypes) {
          for (const type of depTypes) {
            allowedTypes.add(type);
          }
        }
      }
    }
    
    // Collect referenced types from this module
    const referencedTypes = new Set<string>();
    
    // Scan all elements in this module
    for (const cls of elements.classes) {
      scanElementForTypeReferences(cls, referencedTypes);
    }
    for (const iface of elements.interfaces) {
      scanElementForTypeReferences(iface, referencedTypes);
    }
    for (const type of elements.types) {
      scanElementForTypeReferences(type, referencedTypes);
    }
    for (const fn of elements.functions) {
      scanElementForTypeReferences(fn, referencedTypes);
    }
    
    // Find problematic references
    const problematicTypes: string[] = [];
    const internalTypes: string[] = [];
    
    for (const refType of referencedTypes) {
      const classification = classifyType(refType, moduleName);
      
      if (classification.classification === 'builtin') {
        // Built-in types are always OK
        continue;
      }
      
      if (classification.classification === 'internal') {
        // Internal types should not be referenced in public APIs
        internalTypes.push(refType);
        continue;
      }
      
      // Check if the type is allowed in this module's scope
      if (!allowedTypes.has(refType)) {
        // Check if it's a legitimate cross-module reference
        if (classification.module && classification.module !== moduleName) {
          const allowedModules = [moduleName, ...(moduleConfig.dependencies || [])];
          if (!allowedModules.includes(classification.module)) {
            problematicTypes.push(`${refType} (from ${classification.module} module)`);
          }
        } else {
          problematicTypes.push(refType);
        }
      }
    }
    
    // Report issues for this module
    if (internalTypes.length > 0) {
      console.warn(`   ⚠️  ${moduleName}: ${internalTypes.length} internal types referenced in public API:`);
      for (const type of internalTypes.sort()) {
        console.warn(`      - ${type} (internal implementation detail)`);
      }
      totalIssues += internalTypes.length;
    }
    
    if (problematicTypes.length > 0) {
      console.warn(`   ⚠️  ${moduleName}: ${problematicTypes.length} cross-module references without proper dependencies:`);
      for (const type of problematicTypes.sort()) {
        console.warn(`      - ${type}`);
      }
      totalIssues += problematicTypes.length;
    }
    
    if (internalTypes.length === 0 && problematicTypes.length === 0) {
      console.log(`      ✅ ${allowedTypes.size} types available, ${referencedTypes.size} types referenced, all valid`);
    }
  }
  
  if (totalIssues > 0) {
    console.warn(`\n⚠️  Found ${totalIssues} cross-reference issues. These indicate API design issues:`);
    console.warn('   - Internal types: Mark with @internal or refactor to avoid exposing in public API');
    console.warn('   - Cross-module types: Add module dependencies or re-export types properly');
    console.warn('   This is a warning only - documentation will still be generated.');
  } else {
    console.log(`\n✅ Cross-reference validation passed. All module boundaries respected.`);
  }
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
  
  // Scan signatures (functions, methods)
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
  
  // Scan children (properties, methods)
  if (element.children) {
    for (const child of element.children) {
      scanElementForTypeReferences(child, referencedTypes);
    }
  }
}

/**
 * Main function - orchestrates the entire documentation build process
 */
async function main(): Promise<void> {
  try {
    console.log('🚀 Starting API documentation build process...\n');

    // Step 1: Clean output directory
    await cleanOutputDirectory();

    // Step 2: Validate module configurations
    const validModules = await validateModuleConfigs();

    // Step 3: Extract API elements from all modules
    const allElements: ApiElements[] = [];
    for (const moduleConfig of validModules) {
      try {
        const elements = await extractApiElements(moduleConfig);
        allElements.push(elements);
      } catch (error) {
        console.warn(`⚠️  Failed to process ${moduleConfig.name}: ${(error as Error).message}`);
      }
    }

    // Step 4: Validate cross-references with module awareness
    validateModularCrossReferences(allElements);

    // Step 5: Write API files
    await writeApiFiles(allElements);

    // Step 6: Write index page
    await writeIndexPage(allElements);

    console.log('\n✅ API documentation build completed successfully!');
  } catch (error) {
    console.error('\n❌ API documentation build failed:', error);
    Deno.exit(1);
  }
}

// Run main function when script is executed directly
if (import.meta.main) {
  await main();
}