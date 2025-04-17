// Types for messages between UI and plugin
interface Message {
  type: 'list-collections' | 'preview-collection' | 'generate-docs';
  collectionName?: string;
}

// Color token data structures
interface ColorValue {
  hex: string;
  reference?: string;
}

interface ColorToken {
  name: string;
  group: string;
  subgroups: string[];
  key: string;
  modeValues: Map<string, ColorValue>; // Map of mode name to color value
}

interface PreviewToken {
  name: string;
  values: { [mode: string]: string }; // Mode name to RGBA value
}

// Constants for layout
const DOCS_PAGE_NAME = "📝 Design System Docs";
const COLORS_FRAME_NAME = "🎨 Alias Colors";
const SPACING = {
  FRAME_GAP: 24,
  TOKEN_GAP: 16,
  SWATCH_SIZE: 40,
  HEADING_TOP: 32,
  GROUP_GAP: 48
};

// Show the UI
figma.showUI(__html__, { width: 400, height: 480 });

// Handle messages from the UI
figma.ui.onmessage = async (msg: Message) => {
  // List collections request - called when UI first loads
  if (msg.type === 'list-collections') {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    console.log('[DEBUG] All collections:', cols);
    const colNames = cols.map((c: VariableCollection) => c.name);
    console.log('[DEBUG] Available collections:', colNames);
    figma.ui.postMessage({ type: 'collections', data: colNames });
    return;
  }

  // Preview collection - called when user selects a collection
  if (msg.type === 'preview-collection') {
    if (!msg.collectionName) return;
    
    console.log('[DEBUG] Generating preview for:', msg.collectionName);
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const col = cols.find((c: VariableCollection) => c.name === msg.collectionName);
    if (!col) {
      console.error(`Collection not found: ${msg.collectionName}`);
      return;
    }
    console.log('[DEBUG] Found collection:', col);

    // Get color variables and their preview values
    const allVars = await figma.variables.getLocalVariablesAsync();
    console.log('[DEBUG] All variables:', allVars);
    const colorVars = allVars.filter((v: Variable) => {
      const isColor = v.resolvedType === 'COLOR';
      const firstModeValue = v.valuesByMode[col.modes[0].modeId];
      // Compare the raw ID values instead of the full object
      const inCollection = v.variableCollectionId === col.id || 
                         (firstModeValue && 
                          typeof firstModeValue === 'object' &&
                          'type' in firstModeValue &&
                          firstModeValue.type === 'VARIABLE_ALIAS' && 
                          v.resolvedType === 'COLOR');
      console.log(`[DEBUG] Variable ${v.name}: type=${v.resolvedType}, isColor=${isColor}, inCollection=${inCollection}, variableCollectionId=${v.variableCollectionId}, targetCollectionId=${col.id}`);
      return isColor && inCollection;
    });

    const preview = colorVars.slice(0, 3).map((v: Variable): PreviewToken => {
      const values: { [mode: string]: string } = {};
      
      // Get values for all modes
      col.modes.forEach(mode => {
        const value = v.valuesByMode[mode.modeId];
        if (typeof value === 'object') {
          const color = value as RGB | RGBA;
          values[mode.name] = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${'a' in color ? color.a : 1})`;
        }
      });

      return {
        name: v.name,
        values
      };
    });

    console.log('Preview tokens:', preview);
    figma.ui.postMessage({ type: 'preview-tokens', data: preview });
    return;
  }

  // Generate full documentation
  if (msg.type === 'generate-docs') {
    if (!msg.collectionName) return;
    
    console.log('[DEBUG] Generating docs for:', msg.collectionName);
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    console.log('[DEBUG] All collections:', cols.map(c => ({ id: c.id, name: c.name })));
    const col = cols.find((c: VariableCollection) => c.name === msg.collectionName);
    if (!col) {
      figma.closePlugin(`Collection not found: ${msg.collectionName}`);
      return;
    }

    console.log('[DEBUG] Collection found:', {
      id: col.id,
      name: col.name,
      modes: col.modes.map(m => ({ id: m.modeId, name: m.name }))
    });

    // Get and process color variables
    const allVars = await figma.variables.getLocalVariablesAsync();
    console.log('[DEBUG] All variables:', allVars.map(v => ({
      name: v.name,
      type: v.resolvedType,
      collection: v.variableCollectionId
    })));

    const colorVars = allVars.filter((v: Variable) => {
      const isColor = v.resolvedType === 'COLOR';
      const firstModeValue = v.valuesByMode[col.modes[0].modeId];
      // Check both direct collection ID and referenced variable's collection
      const inCollection = v.variableCollectionId === col.id || 
                         (firstModeValue && 
                          typeof firstModeValue === 'object' &&
                          'type' in firstModeValue &&
                          firstModeValue.type === 'VARIABLE_ALIAS' && 
                          v.resolvedType === 'COLOR');
      
      console.log(`[DEBUG] Variable ${v.name}:`, {
        type: v.resolvedType,
        isColor,
        variableCollectionId: v.variableCollectionId,
        targetCollectionId: col.id,
        inCollection,
        valueType: typeof firstModeValue === 'object' && 'type' in firstModeValue ? firstModeValue.type : 'primitive'
      });
      return isColor && inCollection;
    });

    console.log('[DEBUG] Filtered color variables:', colorVars.map(v => v.name));

    // Parse and group tokens
    const tokensByGroup = new Map<string, ColorToken[]>();
    
    for (const v of colorVars) {
      const parts = v.name.split('.');
      if (parts.length < 2) {
        console.log(`[DEBUG] Skipping ${v.name} - insufficient name parts`);
        continue;
      }
      
      const group = parts[0];
      const key = parts[parts.length - 1];
      const subgroups = parts.slice(1, -1);
      
      const modeValues = new Map<string, ColorValue>();
      
      // Get values for all modes
      col.modes.forEach(mode => {
        const value = v.valuesByMode[mode.modeId];
        console.log(`[DEBUG] Mode ${mode.name} for ${v.name}:`, value);
        if (value && typeof value === 'object') {
          if ('type' in value && value.type === 'VARIABLE_ALIAS') {
            // Handle alias variables - get the raw value for this mode
            const resolvedValue = v.valuesByMode[mode.modeId];
            if (resolvedValue && typeof resolvedValue === 'object' && 'id' in resolvedValue) {
              // Get the referenced variable
              const referencedVar = allVars.find(ref => ref.id === resolvedValue.id);
              if (referencedVar) {
                const refValue = referencedVar.valuesByMode[mode.modeId];
                if (refValue && typeof refValue === 'object' && 'r' in refValue && 'g' in refValue && 'b' in refValue) {
                  modeValues.set(mode.name, {
                    hex: rgbToHex({
                      r: refValue.r as number,
                      g: refValue.g as number,
                      b: refValue.b as number
                    }),
                    reference: resolvedValue.id
                  });
                }
              }
            }
          } else if ('r' in value && 'g' in value && 'b' in value) {
            // Handle direct color values
            modeValues.set(mode.name, {
              hex: rgbToHex({
                r: value.r as number,
                g: value.g as number,
                b: value.b as number
              })
            });
          }
        }
      });

      // Skip if no valid color values found
      if (modeValues.size === 0) {
        console.log(`[DEBUG] Skipping token ${v.name} - no valid color values`);
        continue;
      }

      const token: ColorToken = {
        name: v.name,
        group,
        subgroups,
        key,
        modeValues
      };

      if (!tokensByGroup.has(group)) {
        tokensByGroup.set(group, []);
      }
      tokensByGroup.get(group)!.push(token);
    }

    console.log('[DEBUG] Final tokens by group:', Object.fromEntries(tokensByGroup));

    // Calculate position for new frame
    const currentPage = figma.currentPage;
    const existingFrames = currentPage.children;
    const yOffset = existingFrames.length > 0 
      ? Math.max(...existingFrames.map(f => f.y + f.height)) + SPACING.FRAME_GAP
      : 0;

    // Create the parent frame for all color tokens
    const parentFrame = figma.createFrame();
    parentFrame.name = `${COLORS_FRAME_NAME} - ${msg.collectionName}`;
    parentFrame.layoutMode = "VERTICAL";
    parentFrame.itemSpacing = SPACING.GROUP_GAP;
    parentFrame.paddingLeft = SPACING.FRAME_GAP;
    parentFrame.paddingRight = SPACING.FRAME_GAP;
    parentFrame.paddingTop = SPACING.FRAME_GAP;
    parentFrame.paddingBottom = SPACING.FRAME_GAP;
    parentFrame.fills = [];
    parentFrame.y = yOffset;

    // Process each group
    for (const [groupName, tokens] of tokensByGroup) {
      console.log(`Processing group ${groupName} with ${tokens.length} tokens`);
      
      // Create group heading
      const heading = figma.createText();
      heading.characters = groupName.toUpperCase();
      heading.fontSize = 14;
      heading.fontName = { family: "Inter", style: "Semi Bold" };
      heading.layoutAlign = "STRETCH";
      parentFrame.appendChild(heading);

      // Create group container
      const groupFrame = figma.createFrame();
      groupFrame.name = `${groupName}-tokens`;
      groupFrame.layoutMode = "VERTICAL";
      groupFrame.itemSpacing = SPACING.TOKEN_GAP;
      groupFrame.fills = [];
      groupFrame.layoutAlign = "STRETCH";
      parentFrame.appendChild(groupFrame);

      // Add each token
      for (const token of tokens) {
        console.log(`Processing token ${token.name} with modes:`, Array.from(token.modeValues.keys()));
        
        const tokenFrame = figma.createFrame();
        tokenFrame.name = token.name;
        tokenFrame.layoutMode = "HORIZONTAL";
        tokenFrame.itemSpacing = SPACING.TOKEN_GAP;
        tokenFrame.fills = [];
        tokenFrame.layoutAlign = "STRETCH";

        // Token name
        const nameText = figma.createText();
        nameText.characters = token.name;
        nameText.fontSize = 12;
        nameText.fontName = { family: "Inter", style: "Regular" };
        nameText.layoutGrow = 1;

        tokenFrame.appendChild(nameText);

        // Add swatches for each mode
        col.modes.forEach(mode => {
          const colorValue = token.modeValues.get(mode.name);
          if (colorValue) {
            const swatch = createSwatch(colorValue.hex, mode.name);
            tokenFrame.appendChild(swatch);
          }
        });

        groupFrame.appendChild(tokenFrame);
      }
    }

    // Add the parent frame to the current page
    currentPage.appendChild(parentFrame);
    
    // Adjust parent frame width
    parentFrame.layoutAlign = "STRETCH";
    parentFrame.resize(800, parentFrame.height);

    // Focus the view on the new frame
    figma.viewport.scrollAndZoomIntoView([parentFrame]);

    // Close plugin
    const totalTokens = Array.from(tokensByGroup.values()).reduce((sum, tokens) => sum + tokens.length, 0);
    const totalModes = col.modes.length;
    figma.closePlugin(`Generated ${totalTokens} color tokens with ${totalModes} modes in ${tokensByGroup.size} groups`);
  }
};

// Helper to convert RGB to hex
function rgbToHex(color: RGB | RGBA): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Helper to create a color swatch with label
function createSwatch(hex: string, label: string): FrameNode {
  const container = figma.createFrame();
  container.name = `${label}-swatch`;
  container.layoutMode = "VERTICAL";
  container.itemSpacing = 4;
  container.fills = [];

  const swatch = figma.createRectangle();
  swatch.name = "swatch";
  swatch.resize(SPACING.SWATCH_SIZE, SPACING.SWATCH_SIZE);
  swatch.cornerRadius = 4;
  
  // Convert hex to RGB for Figma's color format
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  swatch.fills = [{ type: 'SOLID', color: { r, g, b } }];

  const text = figma.createText();
  text.characters = hex;
  text.fontSize = 10;
  text.fontName = { family: "Inter", style: "Regular" };

  container.appendChild(swatch);
  container.appendChild(text);

  return container;
}