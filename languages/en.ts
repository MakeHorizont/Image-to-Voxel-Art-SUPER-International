
import { Translation } from './types';

export const en: Translation = {
  title: "IMAGE TO VOXEL ART",
  subtitle: "Create voxel art scenes inspired by any image, with Gemini 3.",
  status: {
    idle: "Idle",
    generating_image: "Generating Image...",
    generating_voxels: "Generating Voxels...",
    error: "Error",
  },
  buttons: {
    load_example: "Load Example",
    generate_new: "Generate New",
    view_scene: "View Scene",
    view_image: "View Image",
    download_img: "Download Img",
    export_html: "Export HTML",
    copy_code: "Copy Code",
    generate_voxels: "Generate Voxels",
    regenerate: "Regenerate",
    generate: "Generate",
    close: "Close",
    editing: "Editing",
    paste_image: "Paste Image",
  },
  inputs: {
    desc_label: "1) Object Description",
    desc_placeholder: "e.g. A tree house under the sea",
    style_label: "2) Style",
    style_placeholder: "e.g. Voxel art, cyberpunk, warm lighting",
    anim_label: "3) Animation & Interactivity",
    anim_placeholder: "e.g. Floating fish, swaying seaweed, bubbling effects",
    aspect_ratio: "Aspect Ratio",
    optimize_scene: "Optimise Scene",
    upload_text: "Upload Image",
    or_separator: "OR",
    drag_drop: "Drag and drop, paste (Ctrl+V)",
  },
  viewer: {
    loading_image: "Generating three.js scene with Gemini 2.5 Flash Image",
    loading_voxels: "Generating three.js scene with Gemini 3 Pro",
    thinking: "Thinking",
    placeholder: "Select an example, or generate your own!",
  },
  controls: {
    mode_orbit: "Mode: Orbit 🔄",
    mode_fly: "Mode: Fly ✈️",
    speed: "Speed:",
    help_text: "<b>Fly Controls:</b><br>WASD / Arrows to Move<br>Hold Left Click + Drag to Look<br>Q/E or Triggers to Up/Down<br>Xbox Gamepad Supported",
    toggle_fullscreen: "Toggle Fullscreen",
  }
};
