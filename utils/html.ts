
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Translation } from "../languages/types";


/**
 * Extracts a complete HTML document from a string that might contain
 * conversational text, markdown code blocks, etc.
 */
export const extractHtmlFromText = (text: string): string => {
  if (!text) return "";

  // 1. Try to find a complete HTML document structure (most reliable)
  // Matches <!DOCTYPE html>...</html> or <html>...</html>, case insensitive, spanning multiple lines
  const htmlMatch = text.match(/(<!DOCTYPE html>|<html)[\s\S]*?<\/html>/i);
  if (htmlMatch) {
    return htmlMatch[0];
  }

  // 2. Fallback: Try to extract content from markdown code blocks if specific HTML tags weren't found
  const codeBlockMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 3. Return raw text if no structure is found (trim whitespace)
  return text.trim();
};

/**
 * Injects CSS into the HTML to hide common text elements (like loading screens,
 * info overlays, instructions)
 */
export const hideBodyText = (html: string): string => {
  const cssToInject = `
    <style>
      /* Hides common overlay IDs and classes used in Three.js examples and generated code */
      #info, #loading, #ui, #instructions, .label, .overlay, #description {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
      /* Ensure the body doesn't show selected text cursor interaction outside canvas */
      body {
        user-select: none !important;
        touch-action: none; /* Prevent browser zooming/scrolling on mobile */
      }
      canvas {
        outline: none;
        -webkit-tap-highlight-color: rgba(0,0,0,0);
      }
    </style>
  `;

  // Inject before closing head if possible, otherwise before closing body, or append
  if (html.toLowerCase().includes('</head>')) {
    return html.replace(/<\/head>/i, `${cssToInject}</head>`);
  }
  if (html.toLowerCase().includes('</body>')) {
    return html.replace(/<\/body>/i, `${cssToInject}</body>`);
  }
  return html + cssToInject;
};

/**
 * Modifies the HTML to attempt to expose internal Three.js variables to the window object
 * so the injected control script can access them.
 */
export const exposeThreeJSObjects = (html: string): string => {
  let modified = html;
  
  // 1. Expose THREE namespace globally so injected scripts can use THREE.Vector3, etc.
  // Matches: import * as THREE from '...'; and appends window.THREE = THREE;
  modified = modified.replace(
    /(import\s+\*\s+as\s+THREE\s+from\s+['"][^'"]+['"];?)/g,
    '$1 window.THREE = THREE;'
  );

  // 2. Expose camera, renderer, controls, AND SCENE using valid JS assignment
  // Replaces "const camera =" with "const camera = window.camera ="
  // Uses a specific regex that handles spacing flexibly
  modified = modified.replace(
    /(const|let|var)\s+(camera|renderer|controls|scene)\s*=/g, 
    '$1 $2 = window.$2 ='
  );

  return modified;
}

/**
 * Updates the camera position and controls target in the HTML string.
 * Used when exporting the scene with the current view.
 */
export const updateCameraSettings = (
    html: string, 
    position: {x: number, y: number, z: number}, 
    target: {x: number, y: number, z: number}
): string => {
    let modified = html;

    // 1. Update Camera Position
    // Regex handles: camera.position.set( x, y, z )
    const camRegex = /camera\.position\.set\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)/g;
    modified = modified.replace(camRegex, `camera.position.set(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);

    // 2. Update Controls Target
    // Case A: controls.target.set(...) already exists
    const targetRegex = /controls\.target\.set\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)/g;
    
    if (targetRegex.test(modified)) {
        modified = modified.replace(targetRegex, `controls.target.set(${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)})`);
    } else {
        // Case B: controls.target.set(...) does not exist. We must inject it after controls creation.
        // Look for: new OrbitControls(camera, renderer.domElement);
        const controlsCreationRegex = /(new\s+OrbitControls\s*\([^)]+\)\s*;)/g;
        modified = modified.replace(controlsCreationRegex, `$1 controls.target.set(${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)});`);
    }

    return modified;
};

/**
 * Injects a comprehensive control system for Orbit/Fly modes, WASD, and Gamepad support.
 */
export const injectGameControls = (html: string, t: Translation): string => {
  const controlScript = `
<script type="module">
// Note: We use dynamic import for GLTFExporter to ensure it loads after the main map is ready.

(function() {
    // --- Universal Control System Injection ---
    
    let mode = 'orbit'; // 'orbit' or 'fly'
    let moveState = { forward: false, backward: false, left: false, right: false, up: false, down: false };
    let flySpeed = 4.6;
    let euler = { x: 0, y: 0, z: 0 }; // Camera rotation tracking for fly mode
    let isDragging = false;
    let mobileControlsEnabled = false;
    
    // Mobile Touch State
    let touchState = {
        leftId: null, leftOrigin: {x:0, y:0}, leftCurr: {x:0, y:0},
        rightId: null, rightOrigin: {x:0, y:0}, rightCurr: {x:0, y:0}
    };
    
    let originalControlsUpdate = null;

    // --- UI CREATION ---
    const uiContainer = document.createElement('div');
    uiContainer.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; align-items: center; gap: 10px; font-family: sans-serif; flex-wrap: wrap; justify-content: flex-end;';
    
    // Mode Toggle
    const modeBtn = document.createElement('button');
    modeBtn.textContent = '${t.controls.mode_orbit}';
    modeBtn.style.cssText = 'padding: 8px 12px; background: #000; color: #fff; border: 2px solid #fff; cursor: pointer; font-weight: bold; border-radius: 8px; box-shadow: 2px 2px 0 rgba(0,0,0,0.5); white-space: nowrap; height: 36px; font-size: 14px;';
    
    // Fullscreen Button
    const fsBtn = document.createElement('button');
    fsBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:20px;height:20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>';
    fsBtn.title = "${t.controls.toggle_fullscreen}";
    fsBtn.style.cssText = 'padding: 6px; background: #000; color: #fff; border: 2px solid #fff; cursor: pointer; border-radius: 8px; box-shadow: 2px 2px 0 rgba(0,0,0,0.5); height: 36px; width: 36px; display: flex; align-items: center; justify-content: center;';
    
    fsBtn.onclick = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.log(e));
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    };

    // Speed Input Container
    const speedContainer = document.createElement('div');
    speedContainer.style.cssText = 'display: none; align-items: center; gap: 8px; background: rgba(0,0,0,0.8); padding: 0 12px; border-radius: 8px; color: white; border: 2px solid white; height: 36px; box-shadow: 2px 2px 0 rgba(0,0,0,0.5);';
    
    const speedLabel = document.createElement('span');
    speedLabel.textContent = '${t.controls.speed}';
    speedLabel.style.fontSize = '12px';
    speedLabel.style.fontWeight = 'bold';
    
    // Slider input (Min 4.6, Max 17.5)
    const speedInput = document.createElement('input');
    speedInput.type = 'range';
    speedInput.min = '4.6';
    speedInput.max = '17.5'; 
    speedInput.step = '0.1';
    speedInput.value = '4.6';
    speedInput.style.cssText = 'width: 80px; cursor: pointer;';
    
    const speedValue = document.createElement('span');
    speedValue.textContent = '4.6';
    speedValue.style.cssText = 'color: white; font-size: 11px; font-weight: bold; min-width: 25px; text-align: center;';

    speedInput.oninput = (e) => {
        const val = parseFloat(e.target.value);
        flySpeed = val;
        speedValue.textContent = val.toFixed(1);
    };

    speedContainer.appendChild(speedLabel);
    speedContainer.appendChild(speedInput);
    speedContainer.appendChild(speedValue);

    // Mobile Toggle
    const mobileContainer = document.createElement('label');
    mobileContainer.style.cssText = 'display: none; align-items: center; gap: 5px; background: #000; color: white; padding: 0 8px; height: 36px; border-radius: 8px; border: 2px solid white; font-size: 12px; font-weight: bold; cursor: pointer; user-select: none;';
    const mobileCheck = document.createElement('input');
    mobileCheck.type = 'checkbox';
    mobileContainer.appendChild(mobileCheck);
    mobileContainer.appendChild(document.createTextNode('Touch'));

    const helpText = document.createElement('div');
    helpText.style.cssText = 'position: fixed; bottom: 80px; right: 20px; background: rgba(0,0,0,0.7); color: white; padding: 10px; border-radius: 4px; font-size: 12px; pointer-events: none; display: none; text-align: right; line-height: 1.4;';
    helpText.innerHTML = '${t.controls.help_text}';
    
    uiContainer.appendChild(mobileContainer);
    uiContainer.appendChild(speedContainer);
    uiContainer.appendChild(modeBtn);
    uiContainer.appendChild(fsBtn);
    document.body.appendChild(uiContainer);
    document.body.appendChild(helpText);

    // --- MOBILE OVERLAY ---
    const mobileOverlay = document.createElement('div');
    mobileOverlay.style.cssText = 'display: none; position: fixed; inset: 0; z-index: 9998; pointer-events: none;';
    
    // Left Zone (Move)
    const leftZone = document.createElement('div');
    leftZone.style.cssText = 'position: absolute; bottom: 20px; left: 20px; width: 140px; height: 140px; background: rgba(255,255,255,0.1); border: 2px dashed rgba(255,255,255,0.3); border-radius: 50%; pointer-events: auto;';
    const leftStick = document.createElement('div');
    leftStick.style.cssText = 'position: absolute; top: 50%; left: 50%; width: 40px; height: 40px; background: rgba(255,255,255,0.5); border-radius: 50%; transform: translate(-50%, -50%); transition: transform 0.1s;';
    leftZone.appendChild(leftStick);
    
    // Right Zone (Look)
    const rightZone = document.createElement('div');
    rightZone.style.cssText = 'position: absolute; top: 0; right: 0; width: 50%; height: 100%; pointer-events: auto;';

    // Up/Down Buttons
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'position: absolute; bottom: 80px; right: 20px; display: flex; flex-direction: column; gap: 10px; pointer-events: auto;';
    
    const btnUp = document.createElement('button');
    btnUp.textContent = '▲';
    btnUp.style.cssText = 'width: 50px; height: 50px; background: rgba(0,0,0,0.5); color: white; border: 2px solid white; border-radius: 50%; font-size: 20px; touch-action: none;';
    
    const btnDown = document.createElement('button');
    btnDown.textContent = '▼';
    btnDown.style.cssText = 'width: 50px; height: 50px; background: rgba(0,0,0,0.5); color: white; border: 2px solid white; border-radius: 50%; font-size: 20px; touch-action: none;';

    btnContainer.appendChild(btnUp);
    btnContainer.appendChild(btnDown);
    
    mobileOverlay.appendChild(leftZone);
    mobileOverlay.appendChild(rightZone);
    mobileOverlay.appendChild(btnContainer);
    document.body.appendChild(mobileOverlay);

    // --- EXPORT STATE HELPER ---
    window.getSceneState = function() {
        const cam = window.camera;
        const THREE = window.THREE;
        if (!cam || !THREE) return null;

        const pos = cam.position;
        let target = new THREE.Vector3(0, 0, 0);

        if (mode === 'fly') {
           const dir = new THREE.Vector3(0, 0, -1);
           dir.applyQuaternion(cam.quaternion);
           target.copy(pos).add(dir.multiplyScalar(20));
        } else {
           if (window.controls && window.controls.target) {
               target.copy(window.controls.target);
           }
        }
        return {
            position: { x: pos.x, y: pos.y, z: pos.z },
            target: { x: target.x, y: target.y, z: target.z }
        };
    };

    // --- GLTF EXPORT HELPER ---
    window.exportGLTF = async function() {
        if (!window.THREE || !window.scene) {
            alert("Export Error: 'scene' object not found in window.");
            return;
        }
        try {
            // Use the Import Map path to ensure we use the SAME instance of Three.js
            const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
            const exporter = new GLTFExporter();
            exporter.parse(
                window.scene,
                function (result) {
                    const output = JSON.stringify(result, null, 2);
                    const blob = new Blob([output], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.style.display = 'none';
                    link.href = url;
                    link.download = 'voxel-scene.gltf';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                },
                function (error) {
                    console.error('An error happened during GLTF export:', error);
                    alert("Export logic failed: " + error.message);
                },
                { binary: false } 
            );
        } catch (e) {
            console.error(e);
            alert("Failed to load GLTFExporter. Check internet connection. Details: " + e.message);
        }
    };

    // --- GLB (Binary) EXPORT HELPER ---
    window.exportGLB = async function() {
        if (!window.THREE || !window.scene) {
             alert("Export Error: The 'scene' object was not found. Try regenerating the scene to fix variable scoping.");
             return;
        }
        try {
            // Use the Import Map path to ensure we use the SAME instance of Three.js
            const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
            const exporter = new GLTFExporter();
            exporter.parse(
                window.scene,
                function (result) {
                    const blob = new Blob([result], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.style.display = 'none';
                    link.href = url;
                    link.download = 'voxel-scene.glb';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                },
                function (error) { 
                    console.error(error); 
                    alert("Export parsing failed: " + error.message);
                },
                { binary: true }
            );
        } catch (e) {
            console.error(e);
            alert("Failed to load GLTFExporter. Check internet connection. Details: " + e.message);
        }
    };

    // --- MOBILE TOUCH LOGIC ---
    function handleTouch(e, type) {
        // Prevent default to stop scrolling
        if (e.target !== mobileCheck && e.target !== modeBtn && e.target !== speedInput) {
             // e.preventDefault(); 
        }

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            
            // Left Zone Logic
            const inLeft = t.clientX < window.innerWidth / 2 && t.clientY > window.innerHeight / 2;
            
            if (type === 'start') {
                if (inLeft && touchState.leftId === null) {
                    touchState.leftId = t.identifier;
                    touchState.leftOrigin = { x: t.clientX, y: t.clientY };
                    touchState.leftCurr = { x: t.clientX, y: t.clientY };
                    // Visual feedback
                    leftZone.style.left = (t.clientX - 70) + 'px';
                    leftZone.style.top = (t.clientY - 70) + 'px';
                    leftZone.style.bottom = 'auto';
                    leftStick.style.transform = 'translate(-50%, -50%)';
                } else if (!inLeft && touchState.rightId === null) {
                    touchState.rightId = t.identifier;
                    touchState.rightOrigin = { x: t.clientX, y: t.clientY };
                    touchState.rightCurr = { x: t.clientX, y: t.clientY };
                }
            } else if (type === 'move') {
                if (t.identifier === touchState.leftId) {
                    touchState.leftCurr = { x: t.clientX, y: t.clientY };
                    // Update stick visual
                    const dx = t.clientX - touchState.leftOrigin.x;
                    const dy = t.clientY - touchState.leftOrigin.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    const maxDist = 50;
                    const clampedDist = Math.min(dist, maxDist);
                    const angle = Math.atan2(dy, dx);
                    const stickX = Math.cos(angle) * clampedDist;
                    const stickY = Math.sin(angle) * clampedDist;
                    leftStick.style.transform = \`translate(calc(-50% + \${stickX}px), calc(-50% + \${stickY}px))\`;
                } else if (t.identifier === touchState.rightId) {
                    const dx = t.clientX - touchState.rightCurr.x;
                    const dy = t.clientY - touchState.rightCurr.y;
                    
                    if (window.camera && window.THREE) {
                        const sensitivity = 0.005;
                        euler.y -= dx * sensitivity;
                        euler.x -= dy * sensitivity;
                        const PI_2 = Math.PI / 2;
                        euler.x = Math.max(-PI_2, Math.min(PI_2, euler.x));
                        window.camera.quaternion.setFromEuler(new window.THREE.Euler(euler.x, euler.y, 0, 'YXZ'));
                    }
                    touchState.rightCurr = { x: t.clientX, y: t.clientY };
                }
            } else if (type === 'end') {
                if (t.identifier === touchState.leftId) {
                    touchState.leftId = null;
                    leftStick.style.transform = 'translate(-50%, -50%)';
                    // Reset left zone to default
                    leftZone.style.left = '20px';
                    leftZone.style.bottom = '20px';
                    leftZone.style.top = 'auto';
                } else if (t.identifier === touchState.rightId) {
                    touchState.rightId = null;
                }
            }
        }
    }

    mobileOverlay.addEventListener('touchstart', (e) => handleTouch(e, 'start'), {passive: false});
    mobileOverlay.addEventListener('touchmove', (e) => handleTouch(e, 'move'), {passive: false});
    mobileOverlay.addEventListener('touchend', (e) => handleTouch(e, 'end'), {passive: false});
    
    // Up/Down Buttons
    btnUp.addEventListener('touchstart', (e) => { e.preventDefault(); moveState.up = true; btnUp.style.background = 'rgba(255,255,255,0.3)'; });
    btnUp.addEventListener('touchend', (e) => { e.preventDefault(); moveState.up = false; btnUp.style.background = 'rgba(0,0,0,0.5)'; });
    btnDown.addEventListener('touchstart', (e) => { e.preventDefault(); moveState.down = true; btnDown.style.background = 'rgba(255,255,255,0.3)'; });
    btnDown.addEventListener('touchend', (e) => { e.preventDefault(); moveState.down = false; btnDown.style.background = 'rgba(0,0,0,0.5)'; });

    mobileCheck.onchange = (e) => {
        mobileControlsEnabled = e.target.checked;
        mobileOverlay.style.display = (mobileControlsEnabled && mode === 'fly') ? 'block' : 'none';
        
        // Hide overlay buttons if not in mobile mode to be clean
        if(!mobileControlsEnabled) {
            mobileOverlay.style.display = 'none';
        }
    };

    // Toggle Mode
    modeBtn.onclick = () => {
        // Ensure focus
        window.focus();
        if (document.activeElement) document.activeElement.blur();

        if (mode === 'orbit') {
            // SWITCH TO FLY
            mode = 'fly';
            modeBtn.textContent = '${t.controls.mode_fly}';
            modeBtn.style.background = '#2563eb';
            modeBtn.style.borderColor = '#fff';
            helpText.style.display = 'block';
            speedContainer.style.display = 'flex';
            mobileContainer.style.display = 'flex';
            
            if (mobileControlsEnabled) mobileOverlay.style.display = 'block';

            if (window.controls) {
                if (!originalControlsUpdate) originalControlsUpdate = window.controls.update;
                window.controls.update = () => {};
                window.controls.enabled = false;
                window.controls.autoRotate = false; 
            }
            
            if (window.camera && window.THREE) {
                const rotation = window.camera.rotation.clone().reorder('YXZ');
                euler.x = rotation.x;
                euler.y = rotation.y;
            }
        } else {
            // SWITCH TO ORBIT
            mode = 'orbit';
            modeBtn.textContent = '${t.controls.mode_orbit}';
            modeBtn.style.background = '#000';
            modeBtn.style.borderColor = '#fff';
            helpText.style.display = 'none';
            speedContainer.style.display = 'none';
            mobileContainer.style.display = 'none';
            mobileOverlay.style.display = 'none';
            
            if (window.controls) {
                if (originalControlsUpdate) window.controls.update = originalControlsUpdate;
                window.controls.enabled = true;
                window.controls.autoRotate = true; 
                
                if (window.camera && window.THREE) {
                     const dir = new window.THREE.Vector3(0, 0, -1);
                     dir.applyQuaternion(window.camera.quaternion);
                     const newTarget = window.camera.position.clone().add(dir.multiplyScalar(20));
                     window.controls.target.copy(newTarget);
                }
            }
        }
    };
    
    // Keyboard Handlers
    document.addEventListener('keydown', (e) => {
        if (mode !== 'fly') return;
        switch(e.code) {
            case 'KeyW': case 'ArrowUp': moveState.forward = true; break;
            case 'KeyS': case 'ArrowDown': moveState.backward = true; break;
            case 'KeyA': case 'ArrowLeft': moveState.left = true; break;
            case 'KeyD': case 'ArrowRight': moveState.right = true; break;
            case 'KeyQ': moveState.down = true; break;
            case 'KeyE': moveState.up = true; break;
            case 'ShiftLeft': flySpeed = 17.5; break; // Boost to max
        }
    });
    
    document.addEventListener('keyup', (e) => {
        switch(e.code) {
            case 'KeyW': case 'ArrowUp': moveState.forward = false; break;
            case 'KeyS': case 'ArrowDown': moveState.backward = false; break;
            case 'KeyA': case 'ArrowLeft': moveState.left = false; break;
            case 'KeyD': case 'ArrowRight': moveState.right = false; break;
            case 'KeyQ': moveState.down = false; break;
            case 'KeyE': moveState.up = false; break;
            case 'ShiftLeft': flySpeed = parseFloat(speedInput.value) || 4.6; break;
        }
    });

    // Mouse Look Handlers
    document.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !e.target.closest('button') && !e.target.closest('input')) { 
            isDragging = true;
            window.focus();
        }
    });
    
    document.addEventListener('mouseup', () => { isDragging = false; });
    document.addEventListener('mouseleave', () => { isDragging = false; });

    document.addEventListener('mousemove', (e) => {
        if (mode === 'fly' && isDragging && window.camera && window.THREE) {
            const sensitivity = 0.002;
            euler.y -= e.movementX * sensitivity;
            euler.x -= e.movementY * sensitivity;
            const PI_2 = Math.PI / 2;
            euler.x = Math.max(-PI_2, Math.min(PI_2, euler.x));
            window.camera.quaternion.setFromEuler(new window.THREE.Euler(euler.x, euler.y, 0, 'YXZ'));
        }
    });

    // Game Loop
    function updateControls() {
        requestAnimationFrame(updateControls);
        if (mode !== 'fly' || !window.camera || !window.THREE) return;
        
        let actualSpeed = flySpeed;
        
        const direction = new window.THREE.Vector3();
        const frontVector = new window.THREE.Vector3(0, 0, 0);
        const sideVector = new window.THREE.Vector3(0, 0, 0);

        // Keyboard/Gamepad inputs
        if (moveState.forward) frontVector.z -= 1;
        if (moveState.backward) frontVector.z += 1;
        if (moveState.left) sideVector.x -= 1;
        if (moveState.right) sideVector.x += 1;
        
        // Touch Input Integration
        if (touchState.leftId !== null) {
            const dx = touchState.leftCurr.x - touchState.leftOrigin.x;
            const dy = touchState.leftCurr.y - touchState.leftOrigin.y;
            // Normalize roughly
            sideVector.x += dx * 0.05;
            frontVector.z += dy * 0.05;
        }

        const gamepads = navigator.getGamepads();
        if (gamepads[0]) {
            const gp = gamepads[0];
            if (Math.abs(gp.axes[0]) > 0.1) sideVector.x += gp.axes[0];
            if (Math.abs(gp.axes[1]) > 0.1) frontVector.z += gp.axes[1];
            if (Math.abs(gp.axes[2]) > 0.1) euler.y -= gp.axes[2] * 0.05;
            if (Math.abs(gp.axes[3]) > 0.1) {
                euler.x -= gp.axes[3] * 0.05;
                const PI_2 = Math.PI / 2;
                euler.x = Math.max(-PI_2, Math.min(PI_2, euler.x));
            }
            if (gp.buttons[6]?.pressed || gp.buttons[1]?.pressed) moveState.down = true;
            else if (!moveState.down) moveState.down = false;
            if (gp.buttons[7]?.pressed || gp.buttons[0]?.pressed) moveState.up = true;
            else if (!moveState.up) moveState.up = false;
            
            window.camera.quaternion.setFromEuler(new window.THREE.Euler(euler.x, euler.y, 0, 'YXZ'));
        }
        
        if (moveState.up) window.camera.position.y += actualSpeed * 0.5;
        if (moveState.down) window.camera.position.y -= actualSpeed * 0.5;

        direction.addVectors(frontVector, sideVector).normalize().multiplyScalar(actualSpeed * 0.5);
        direction.applyQuaternion(window.camera.quaternion);
        window.camera.position.add(direction);
    }
    
    updateControls();
})();
</script>
  `;

  // Inject before closing body
  if (html.toLowerCase().includes('</body>')) {
    return html.replace(/<\/body>/i, `${controlScript}</body>`);
  }
  return html + controlScript;
};
