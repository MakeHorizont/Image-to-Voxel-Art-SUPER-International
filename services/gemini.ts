
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { GoogleGenAI, Modality } from "@google/genai";
import { extractHtmlFromText } from "../utils/html";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const IMAGE_SYSTEM_PROMPT = "Generate an isolated object/scene on a simple background.";

export const VOXEL_PROMPT = `
I have provided reference image(s). Code a beautiful voxel art scene inspired by this image using Three.js.

CRITICAL INSTRUCTION: You MUST construct the geometry using 3D primitives (THREE.BoxGeometry) to simulate voxels.
DO NOT create a 2D plane with the image mapped onto it.
DO NOT use TextureLoader to load the image as a background or sprite.
DO NOT just display the image. YOU ARE A VOXEL ENGINE.

REQUIREMENTS:
1. Write the code as a single-page HTML file.
2. Use 'three' and 'three/addons/...' imports from unpkg/esm.
3. Assign 'camera', 'renderer', and 'controls' to the 'window' object (window.camera = camera).
4. Assign 'scene' to the 'window' object (window.scene = scene) so it can be exported. THIS IS MANDATORY for GLB export.
5. Ensure 'window.THREE = THREE' is set.
6. Camera: Position it at [50, 50, 50] or similar to view the whole scene from isometric angle.
7. Controls: Ensure controls.target.set(0,0,0) so the scene is centered.
8. Geometry: Use InstancedMesh for performance if there are many blocks, or simple Mesh logic for fewer.
9. Loop through coordinates to place blocks. Do not hallucinate external assets.
`;

export const generateImage = async (prompt: string, aspectRatio: string = '1:1', optimize: boolean = true): Promise<string> => {
  try {
    let finalPrompt = prompt;

    // Apply the shortened optimization prompt if enabled
    if (optimize) {
      finalPrompt = `${IMAGE_SYSTEM_PROMPT}\n\nSubject: ${prompt}`;
    }

    // Note: gemini-2.5-flash-image now supports multiple aspect ratios.
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: finalPrompt,
          },
        ],
      },
      config: {
        responseModalities: [
            'IMAGE',
        ],
        imageConfig: {
          aspectRatio: aspectRatio,
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData) {
        const base64ImageBytes = part.inlineData.data;
        const mimeType = part.inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${base64ImageBytes}`;
    } else {
      throw new Error("No image generated.");
    }
  } catch (error) {
    console.error("Image generation failed:", error);
    throw error;
  }
};

export const generateVoxelScene = async (
  imagesBase64: string[], 
  promptContext: string,
  previousCode: string | null,
  onThoughtUpdate?: (thought: string) => void
): Promise<string> => {

  // Construct the contents payload
  const parts: any[] = [];

  // Add all images
  for (const img of imagesBase64) {
     const base64Data = img.split(',')[1] || img;
     const mimeMatch = img.match(/^data:(.*?);base64,/);
     const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
     
     parts.push({
        inlineData: {
            mimeType: mimeType,
            data: base64Data
        }
     });
  }

  let textPrompt = fullVoxelPrompt(promptContext);
  
  if (previousCode) {
      textPrompt += `\n\n--- EDITING MODE ---\nHere is the previous code I generated. Please update it based on the new context or images provided above. Keep the parts that work, but modify what is requested. Fix any bugs if reported.\n\nPREVIOUS CODE:\n\`\`\`html\n${previousCode.substring(0, 20000)}\n\`\`\``; // Limit context slightly if huge
  }

  parts.push({ text: textPrompt });

  try {
    // Using gemini-3-pro-preview for complex code generation with thinking
    const response = await ai.models.generateContentStream({
      model: 'gemini-3-pro-preview',
      contents: {
        parts: parts
      },
      config: {
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    });

    let fullHtml = "";

    for await (const chunk of response) {
      const candidates = chunk.candidates;
      if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
          const p = part as any;
          
          if (p.thought) {
            if (onThoughtUpdate && p.text) {
              onThoughtUpdate(p.text);
            }
          } else {
            if (p.text) {
              fullHtml += p.text;
            }
          }
        }
      }
    }

    return extractHtmlFromText(fullHtml);

  } catch (error) {
    console.error("Voxel scene generation failed:", error);
    throw error;
  }
};

function fullVoxelPrompt(userContext: string) {
    return `${VOXEL_PROMPT}\n\nSpecific Scene Details & Animations:\n${userContext}`;
}
